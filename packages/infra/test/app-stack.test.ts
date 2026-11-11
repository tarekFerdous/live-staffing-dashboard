import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppStack } from '../lib/app-stack';
import { tagApp } from '../lib/config';

let t: Template;
beforeAll(() => {
  const site = mkdtempSync(join(tmpdir(), 'site-'));
  writeFileSync(join(site, 'index.html'), '<!doctype html>');
  const app = new App();
  tagApp(app);
  t = Template.fromStack(
    new AppStack(app, 'App', {
      env: { account: '123456789012', region: 'ca-central-1' },
      siteAssetPath: site,
    }),
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

  it('serves the built site from a Lambda layer on catch-all GET routes of the same API', () => {
    t.resourceCountIs('AWS::CloudFront::Distribution', 0);
    t.resourceCountIs('AWS::S3::Bucket', 0);
    t.resourceCountIs('AWS::Lambda::LayerVersion', 1);
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /{proxy+}' });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /' });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SITE_DIR: '/opt' } },
      Layers: [Match.anyValue()],
    });
  });

  it('serves the read and action routes from the HTTP API', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/shifts/{shiftId}' });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/shifts/{shiftId}/workers/{workerId}/actions',
    });
  });

  it('serves POST /api/demo/reset from its own Lambda', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /api/demo/reset' });
  });

  it('serves the event catch-up route from the HTTP API', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/shifts/{shiftId}/events' });
  });

  describe('live updates', () => {
    it('feeds the publisher from the table stream, filtered to new EVT# items and new META items', () => {
      const mappings = Object.values(t.findResources('AWS::Lambda::EventSourceMapping'));
      expect(mappings).toHaveLength(1);
      const m = mappings[0]!.Properties;
      expect(m.StartingPosition).toBe('LATEST');
      expect(m.BatchSize).toBe(1);
      expect(m.MaximumBatchingWindowInSeconds ?? 0).toBe(0);
      expect(m.BisectBatchOnFunctionError).toBe(true);
      expect(m.MaximumRetryAttempts).toBe(3);
      expect(m.DestinationConfig.OnFailure.Destination).toBeDefined();
      expect(m.FilterCriteria.Filters).toHaveLength(2);
      expect(JSON.parse(m.FilterCriteria.Filters[0].Pattern)).toEqual({
        eventName: ['INSERT'],
        dynamodb: { Keys: { SK: { S: [{ prefix: 'EVT#' }] } } },
      });
      // A reset writes META back last: that insert becomes the live reset message.
      expect(JSON.parse(m.FilterCriteria.Filters[1].Pattern)).toEqual({
        eventName: ['INSERT'],
        dynamodb: { Keys: { SK: { S: ['META'] } } },
      });
    });

    it('sends failed publishes to an SQS dead-letter queue', () => {
      const [queueId] = Object.keys(t.findResources('AWS::SQS::Queue'));
      expect(queueId).toBeDefined();
      const m = Object.values(t.findResources('AWS::Lambda::EventSourceMapping'))[0]!.Properties;
      expect(m.DestinationConfig.OnFailure.Destination).toEqual({ 'Fn::GetAtt': [queueId, 'Arn'] });
    });

    it('allows publishing with IAM only and subscribing with the API key only', () => {
      t.hasResourceProperties('AWS::AppSync::Api', {
        EventConfig: {
          AuthProviders: Match.arrayWith([{ AuthType: 'API_KEY' }, { AuthType: 'AWS_IAM' }]),
          ConnectionAuthModes: [{ AuthType: 'API_KEY' }],
          DefaultPublishAuthModes: [{ AuthType: 'AWS_IAM' }],
          DefaultSubscribeAuthModes: [{ AuthType: 'API_KEY' }],
        },
      });
      const namespaces = Object.values(t.findResources('AWS::AppSync::ChannelNamespace'));
      expect(namespaces).toHaveLength(1);
      expect(namespaces[0]!.Properties).toMatchObject({
        Name: 'shifts',
        PublishAuthModes: [{ AuthType: 'AWS_IAM' }],
        SubscribeAuthModes: [{ AuthType: 'API_KEY' }],
      });
    });

    it('gives the publisher role EventPublish and nothing else on the Event API', () => {
      const appsyncActions = Object.values(t.findResources('AWS::IAM::Policy')).flatMap((p) =>
        p.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) =>
          [s.Action].flat().filter((a) => a.startsWith('appsync:')),
        ),
      );
      expect(appsyncActions).toEqual(['appsync:EventPublish']);
    });

    it('creates a long-lived API key for browsers', () => {
      const keys = Object.values(t.findResources('AWS::AppSync::ApiKey'));
      expect(keys).toHaveLength(1);
      expect(keys[0]!.Properties.Expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600);
    });

    it('serves the realtime endpoints on GET /api/config and prints them', () => {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /api/config' });
      t.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            EVENTS_HTTP_HOST: Match.anyValue(),
            EVENTS_REALTIME_HOST: Match.anyValue(),
            EVENTS_API_KEY: Match.anyValue(),
          },
        },
      });
      t.hasOutput('EventsHttpHost', {});
      t.hasOutput('EventsRealtimeHost', {});
      t.hasOutput('EventsApiKey', {});
    });

    it('points the publisher at the Event API HTTP host', () => {
      t.hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: { EVENTS_HTTP_HOST: Match.anyValue() } },
      });
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

  it('prints the site URL, API URL and table name', () => {
    t.hasOutput('SiteUrl', {});
    t.hasOutput('ApiUrl', {});
    t.hasOutput('TableName', {});
  });

  it('can be destroyed cleanly (tables and the site layer are deleted with the stack)', () => {
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
    t.hasResource('AWS::Lambda::LayerVersion', { DeletionPolicy: 'Delete' });
  });

  it('tags resources with the project name', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([{ Key: 'project', Value: 'live-staffing' }]),
    });
  });
});
