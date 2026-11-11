import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppStack } from '../lib/app-stack';
import { tagApp } from '../lib/config';

// CloudFront's managed CachingDisabled policy id.
const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

let t: Template;
beforeAll(() => {
  const site = mkdtempSync(join(tmpdir(), 'site-'));
  writeFileSync(join(site, 'index.html'), '<!doctype html>');
  const app = new App();
  tagApp(app);
  t = Template.fromStack(
    new AppStack(app, 'App', { env: { account: '123456789012', region: 'ca-central-1' }, siteAssetPath: site }),
  );
});

describe('AppStack', () => {
  it('table is provisioned 5/5 with a NEW_IMAGE stream', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
    });
    const table = Object.values(t.findResources('AWS::DynamoDB::Table'))[0]!;
    expect(table.Properties.BillingMode).not.toBe('PAY_PER_REQUEST');
  });

  it('routes /api/* on CloudFront to the HTTP API with caching disabled', () => {
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!;
    const cfg = dist.Properties.DistributionConfig;
    const api = cfg.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === '/api/*');
    expect(api).toBeDefined();
    expect(api.CachePolicyId).toBe(CACHING_DISABLED);
    expect(api.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'POST']));
    const origin = cfg.Origins.find((o: { Id: string }) => o.Id === api.TargetOriginId);
    expect(origin.CustomOriginConfig.OriginProtocolPolicy).toBe('https-only');
    // The default behaviour serves the site from S3 through OAC.
    const s3Origin = cfg.Origins.find((o: { Id: string }) => o.Id === cfg.DefaultCacheBehavior.TargetOriginId);
    expect(s3Origin.OriginAccessControlId).toBeDefined();
  });

  it('serves the read and action routes from the HTTP API', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/shifts/{shiftId}' });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/shifts/{shiftId}/workers/{workerId}/actions',
    });
  });

  it('has a small provisioned idempotency table with a TTL, wired to the action Lambda', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      ProvisionedThroughput: { ReadCapacityUnits: 3, WriteCapacityUnits: 3 },
      TimeToLiveSpecification: { AttributeName: 'expiration', Enabled: true },
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: { TABLE_NAME: Match.anyValue(), IDEMPOTENCY_TABLE: Match.anyValue() },
      },
    });
  });

  it('keeps every table inside the always-free 25 RCU / 25 WCU', () => {
    const tables = Object.values(t.findResources('AWS::DynamoDB::Table'));
    const sum = (k: 'ReadCapacityUnits' | 'WriteCapacityUnits') =>
      tables.reduce((n, tb) => n + tb.Properties.ProvisionedThroughput[k], 0);
    expect(sum('ReadCapacityUnits')).toBeLessThanOrEqual(25);
    expect(sum('WriteCapacityUnits')).toBeLessThanOrEqual(25);
  });

  it('runs Lambdas on Node 22 arm64 with the table name', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
    });
  });

  it('sets a 7-day retention on every log group, and every function uses one', () => {
    const groups = Object.values(t.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.Properties.RetentionInDays).toBe(7);
    for (const [id, fn] of Object.entries(t.findResources('AWS::Lambda::Function'))) {
      expect(fn.Properties.LoggingConfig?.LogGroup, id).toBeDefined();
    }
  });

  it('keeps the bucket private', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('prints the site URL, API URL and table name', () => {
    t.hasOutput('SiteUrl', {});
    t.hasOutput('ApiUrl', {});
    t.hasOutput('TableName', {});
  });

  it('can be destroyed cleanly (table and bucket are deleted with the stack)', () => {
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
    t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
    t.hasResourceProperties('Custom::CDKBucketDeployment', { RetainOnDelete: false });
  });

  it('tags resources with the project name', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([{ Key: 'project', Value: 'live-staffing' }]),
    });
  });
});
