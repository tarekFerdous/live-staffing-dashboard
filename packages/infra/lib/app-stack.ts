import { join } from 'node:path';
import { CfnOutput, Duration, Expiration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { marshall } from '@aws-sdk/util-dynamodb';
import { EVT_PREFIX, IDEMPOTENCY_THROUGHPUT, seedItems, SEED } from '@staffing/store';
import type { Construct } from 'constructs';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const LAMBDA_DIR = join(REPO_ROOT, 'packages/functions/src/lambda');
const LOG_RETENTION = logs.RetentionDays.ONE_WEEK;

export type AppStackProps = StackProps & {
  /** Built frontend (`packages/web/dist`). */
  siteAssetPath: string;
};

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // ── Data ────────────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED, // 5/5 stays in the always-free tier
      readCapacity: 5,
      writeCapacity: 5,
      stream: dynamodb.StreamViewType.NEW_IMAGE, // consumed by the live-update publisher
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Seeds the shift once, when the stack (and so the table) is first created,
    // so a fresh deploy is usable without CI needing any DynamoDB permissions.
    new cr.AwsCustomResource(this, 'SeedShift', {
      onCreate: {
        service: 'DynamoDB',
        action: 'batchWriteItem',
        parameters: {
          RequestItems: {
            [table.tableName]: seedItems().map((item) => ({ PutRequest: { Item: marshall(item) } })),
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`seed-${SEED.shift.id}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['dynamodb:BatchWriteItem'], resources: [table.tableArn] }),
      ]),
      installLatestAwsSdk: false,
      logGroup: this.logGroup('SeedShiftLogs'),
    });

    // ── API ─────────────────────────────────────────────────────────────────
    const getShift = this.fn('GetShift', 'getShift.ts', { TABLE_NAME: table.tableName });
    table.grantReadData(getShift);
    const getEvents = this.fn('GetEvents', 'getEvents.ts', { TABLE_NAME: table.tableName });
    table.grantReadData(getEvents);

    // Powertools idempotency records: one per Idempotency-Key, expired by TTL after an hour.
    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: IDEMPOTENCY_THROUGHPUT.ReadCapacityUnits,
      writeCapacity: IDEMPOTENCY_THROUGHPUT.WriteCapacityUnits,
      timeToLiveAttribute: 'expiration',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const postAction = this.fn('PostAction', 'postAction.ts', {
      TABLE_NAME: table.tableName,
      IDEMPOTENCY_TABLE: idempotencyTable.tableName,
    });
    table.grantReadWriteData(postAction);
    idempotencyTable.grantReadWriteData(postAction);

    const api = new apigw.HttpApi(this, 'HttpApi', { apiName: 'live-staffing' });
    api.addRoutes({
      path: '/api/shifts/{shiftId}',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetShiftIntegration', getShift),
    });
    api.addRoutes({
      path: '/api/shifts/{shiftId}/events',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetEventsIntegration', getEvents),
    });
    api.addRoutes({
      path: '/api/shifts/{shiftId}/workers/{workerId}/actions',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('PostActionIntegration', postAction),
    });

    // ── Live updates: table stream → publisher → AppSync Events → browsers ──
    // Browsers hold a subscribe-only API key (a demo limit; Cognito would replace it).
    // Publishing is IAM-only, so only the publisher's role can put events on a channel.
    const apiKey = { authorizationType: appsync.AppSyncAuthorizationType.API_KEY };
    const iamAuth = { authorizationType: appsync.AppSyncAuthorizationType.IAM };
    const eventApi = new appsync.EventApi(this, 'EventApi', {
      apiName: 'live-staffing-events',
      authorizationConfig: {
        authProviders: [
          {
            ...apiKey,
            apiKeyConfig: {
              description: 'Browser subscribe key',
              expires: Expiration.after(Duration.days(365)),
            },
          },
          iamAuth,
        ],
        connectionAuthModeTypes: [apiKey.authorizationType],
        defaultPublishAuthModeTypes: [iamAuth.authorizationType],
        defaultSubscribeAuthModeTypes: [apiKey.authorizationType],
      },
    });
    eventApi.addChannelNamespace('Shifts', {
      channelNamespaceName: 'shifts',
      authorizationConfig: {
        publishAuthModeTypes: [iamAuth.authorizationType],
        subscribeAuthModeTypes: [apiKey.authorizationType],
      },
    });
    const subscribeKey = Object.values(eventApi.apiKeys)[0]!;

    const publishDlq = new sqs.Queue(this, 'PublishDlq', {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const publisher = this.fn('Publisher', 'publisher.ts', { EVENTS_HTTP_HOST: eventApi.httpDns });
    eventApi.grantPublish(publisher);
    publisher.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1,
        maxBatchingWindow: Duration.seconds(0),
        bisectBatchOnError: true,
        retryAttempts: 3,
        onFailure: new SqsDlq(publishDlq),
        // Only new event-log items: every committed change writes exactly one, and
        // a cancelled transaction writes none, so nothing rolled back is ever pushed.
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('INSERT'),
            dynamodb: { Keys: { SK: { S: lambda.FilterRule.beginsWith(EVT_PREFIX) } } },
          }),
        ],
      }),
    );

    // ── Site + CDN (one origin for site and API: no CORS) ───────────────────
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // Emptied on destroy by the BucketDeployment below (retainOnDelete: false).
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Client-side routes (/manager, /worker) serve index.html. Done in a viewer
    // function, not distribution error responses, so API 404s stay intact.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        'function handler(event) { var r = event.request; if (r.uri.indexOf(".") === -1) { r.uri = "/index.html"; } return r; }',
      ),
    });

    const apiDomain = Fn.select(2, Fn.split('/', api.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, 'Site', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [
        s3deploy.Source.asset(props.siteAssetPath),
        // Read by the page at start-up, so one build works against any stack.
        s3deploy.Source.jsonData('config.json', {
          realtime: {
            httpHost: eventApi.httpDns,
            realtimeHost: eventApi.realtimeDns,
            apiKey: subscribeKey.attrApiKey,
          },
        }),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      retainOnDelete: false,
      memoryLimit: 256,
      logGroup: this.logGroup('DeploySiteLogs'),
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ShiftId', { value: SEED.shift.id });
    new CfnOutput(this, 'EventsHttpHost', { value: eventApi.httpDns });
    new CfnOutput(this, 'EventsRealtimeHost', { value: eventApi.realtimeDns });
    // Subscribe-only and already public in config.json; printed for the CI smoke test.
    new CfnOutput(this, 'EventsApiKey', { value: subscribeKey.attrApiKey });
    new CfnOutput(this, 'PublishDlqUrl', { value: publishDlq.queueUrl });
  }

  private logGroup(id: string) {
    return new logs.LogGroup(this, id, { retention: LOG_RETENTION, removalPolicy: RemovalPolicy.DESTROY });
  }

  private fn(id: string, file: string, environment: Record<string, string>) {
    return new NodejsFunction(this, id, {
      entry: join(LAMBDA_DIR, file),
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment,
      logGroup: this.logGroup(`${id}Logs`),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        mainFields: ['module', 'main'],
        // The Node 22 runtime ships AWS SDK v3.
        externalModules: ['@aws-sdk/*'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
