import { join } from 'node:path';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import { marshall } from '@aws-sdk/util-dynamodb';
import { seedItems, SEED } from '@staffing/store';
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
      stream: dynamodb.StreamViewType.NEW_IMAGE, // consumed by the publisher in M4
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

    const api = new apigw.HttpApi(this, 'HttpApi', { apiName: 'live-staffing' });
    api.addRoutes({
      path: '/api/shifts/{shiftId}',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetShiftIntegration', getShift),
    });

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
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(props.siteAssetPath)],
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
