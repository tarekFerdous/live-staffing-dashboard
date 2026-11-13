import { join } from 'node:path';
import { CfnOutput, Duration, Expiration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { marshall } from '@aws-sdk/util-dynamodb';
import { EVT_PREFIX, IDEMPOTENCY_THROUGHPUT, META_SK, seedItems, SEED } from '@staffing/store';
import type { Construct } from 'constructs';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const LAMBDA_DIR = join(REPO_ROOT, 'packages/functions/src/lambda');
const LOG_RETENTION = logs.RetentionDays.ONE_WEEK;

/**
 * #77 API Gateway throttles (requests per second, burst). The default covers page loads and the
 * 6 s safety-net reads with plenty of room; writes are capped harder, and reset hardest.
 */
export const THROTTLE = {
  default: { rateLimit: 50, burstLimit: 100 },
  routes: {
    'POST /api/shifts/{shiftId}/workers/{workerId}/actions': { rateLimit: 10, burstLimit: 20 },
    'POST /api/demo/reset': { rateLimit: 1, burstLimit: 2 },
  },
} as const;

/**
 * #77 Reserved concurrency per function, an upper bound on Lambda spend under a flood. It needs an
 * account concurrency limit of 1,000 (see the README's "Rate limits" section).
 */
export const RESERVED_CONCURRENCY = { enabled: false, postAction: 5, others: 3 } as const;

/** #94 Memory for every function, chosen from cold-start measurements (README "Cold starts"). */
export const FUNCTION_MEMORY_MB = 512;

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
    const actionRoutes = api.addRoutes({
      path: '/api/shifts/{shiftId}/workers/{workerId}/actions',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('PostActionIntegration', postAction),
    });

    // Demo reset: puts the seed back and bumps the epoch (no auth: a demo affordance only).
    const demoReset = this.fn('DemoReset', 'demoReset.ts', { TABLE_NAME: table.tableName });
    table.grantReadWriteData(demoReset);
    const resetRoutes = api.addRoutes({
      path: '/api/demo/reset',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('DemoResetIntegration', demoReset),
    });

    // #77 Stage throttles: the default for every route, tighter overrides for writes and reset.
    // Over the limit, API Gateway answers 429 itself, before any Lambda or table is touched.
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.default.rateLimit,
      throttlingBurstLimit: THROTTLE.default.burstLimit,
    };
    // RouteSettings is a raw JSON map in CDK, passed through as is: CloudFormation's PascalCase keys.
    stage.routeSettings = Object.fromEntries(
      Object.entries(THROTTLE.routes).map(([key, t]) => [
        key,
        { ThrottlingRateLimit: t.rateLimit, ThrottlingBurstLimit: t.burstLimit },
      ]),
    );
    // Route settings name routes by key, so the routes must exist before the stage refers to them.
    for (const route of [...actionRoutes, ...resetRoutes]) api.defaultStage!.node.addDependency(route);

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

    // Tells the page where the live channel is, so one web build runs locally and here.
    const getConfig = this.fn('GetConfig', 'getConfig.ts', {
      EVENTS_HTTP_HOST: eventApi.httpDns,
      EVENTS_REALTIME_HOST: eventApi.realtimeDns,
      EVENTS_API_KEY: subscribeKey.attrApiKey,
    });
    api.addRoutes({
      path: '/api/config',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetConfigIntegration', getConfig),
    });

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
        // Plus new META items: only a reset inserts META (actions update it), and the
        // publisher turns that into a live reset message.
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('INSERT'),
            dynamodb: { Keys: { SK: { S: lambda.FilterRule.beginsWith(EVT_PREFIX) } } },
          }),
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('INSERT'),
            dynamodb: { Keys: { SK: { S: lambda.FilterRule.isEqual(META_SK) } } },
          }),
        ],
      }),
    );

    // ── Site (one origin for site and API: no CORS) ─────────────────────────
    // Temporary: the account can't create CloudFront distributions until AWS verifies it
    // (see todo.md), so the built app is a Lambda layer served by catch-all GET routes
    // (`/` and `/{proxy+}`) on the same HTTP API. The more specific /api/* routes always win.
    // To restore CloudFront + S3, bring back this block as it was in commit 706197f.
    const siteFiles = new lambda.LayerVersion(this, 'SiteFiles', {
      code: lambda.Code.fromAsset(props.siteAssetPath),
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      description: 'Built web app (packages/web/dist), mounted at /opt',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // The CSP's connect-src names this stage's own AppSync hosts, so each stage's policy is exact.
    const site = this.fn('Site', 'site.ts', {
      SITE_DIR: '/opt',
      EVENTS_HTTP_HOST: eventApi.httpDns,
      EVENTS_REALTIME_HOST: eventApi.realtimeDns,
    });
    site.addLayers(siteFiles);
    api.addRoutes({
      path: '/{proxy+}',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.HEAD],
      integration: new HttpLambdaIntegration('SiteIntegration', site),
    });
    api.addRoutes({
      path: '/',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.HEAD],
      integration: new HttpLambdaIntegration('SiteRootIntegration', site),
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'SiteUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ShiftId', { value: SEED.shift.id });
    new CfnOutput(this, 'EventsHttpHost', { value: eventApi.httpDns });
    new CfnOutput(this, 'EventsRealtimeHost', { value: eventApi.realtimeDns });
    // Subscribe-only and already public on /api/config; printed for reference.
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
      // #94: Lambda's CPU scales with memory. At 512 MB the first DynamoDB call after a cold start
      // (SDK setup and signing, CPU-bound) takes about half as long as at 256 MB; see the README.
      memorySize: FUNCTION_MEMORY_MB,
      timeout: Duration.seconds(10),
      environment,
      logGroup: this.logGroup(`${id}Logs`),
      reservedConcurrentExecutions: RESERVED_CONCURRENCY.enabled
        ? id === 'PostAction'
          ? RESERVED_CONCURRENCY.postAction
          : RESERVED_CONCURRENCY.others
        : undefined,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        mainFields: ['module', 'main'],
        // #94: the AWS SDK is bundled (ES modules, tree-shaken, minified) rather than loaded from the
        // runtime's copy, which loads whole CommonJS clients and is slower to start.
        externalModules: [],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
