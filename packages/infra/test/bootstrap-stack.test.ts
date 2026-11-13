import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { BootstrapStack } from '../lib/bootstrap-stack';
import { requireBudgetEmail, tagApp } from '../lib/config';

function synth() {
  const app = new App();
  tagApp(app);
  const stack = new BootstrapStack(app, 'Bootstrap', {
    env: { account: '123456789012', region: 'ca-central-1' },
    budgetAlertEmail: 'owner@example.com',
  });
  return Template.fromStack(stack);
}

describe('BootstrapStack', () => {
  const t = synth();

  it('trusts only this repo main branch, with the STS audience', () => {
    const role = Object.values(t.findResources('AWS::IAM::Role'))[0]!;
    const statements = role.Properties.AssumeRolePolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(statements[0].Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        // GitHub's immutable subject for this repo (owner id 55275853, repo id 1453375278).
        'token.actions.githubusercontent.com:sub':
          'repo:tarekFerdous@55275853/live-staffing-dashboard@1453375278:ref:refs/heads/main',
      },
    });
    t.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('can do nothing but assume the cdk-* roles', () => {
    t.resourceCountIs('AWS::IAM::Role', 1);
    t.resourceCountIs('AWS::IAM::Policy', 0);
    // The only managed policy is the CFN execution policy (#84), attached to no role here.
    t.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    expect(Object.values(t.findResources('AWS::IAM::ManagedPolicy'))[0]!.Properties.Roles).toBeUndefined();
    const role = Object.values(t.findResources('AWS::IAM::Role'))[0]!;
    expect(role.Properties.RoleName).toBe('live-staffing-github-deploy');
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    const statements = role.Properties.Policies.flatMap(
      (p: { PolicyDocument: { Statement: unknown[] } }) => p.PolicyDocument.Statement,
    );
    expect(statements).toEqual([
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::123456789012:role/cdk-*']] },
      },
    ]);
  });

  it('has a monthly cost budget alerting at $0.01 actual and $1 forecast', () => {
    const budget = Object.values(t.findResources('AWS::Budgets::Budget'))[0]!.Properties;
    expect(budget.Budget).toMatchObject({ BudgetType: 'COST', TimeUnit: 'MONTHLY' });
    const limit = budget.Budget.BudgetLimit.Amount as number;
    const alerts = (
      budget.NotificationsWithSubscribers as {
        Notification: { NotificationType: string; Threshold: number; ThresholdType: string };
        Subscribers: unknown[];
      }[]
    ).map(({ Notification: n, Subscribers }) => ({
      type: n.NotificationType,
      dollars: n.ThresholdType === 'PERCENTAGE' ? (limit * n.Threshold) / 100 : n.Threshold,
      Subscribers,
    }));
    const subscribers = [{ SubscriptionType: 'EMAIL', Address: 'owner@example.com' }];
    expect(alerts).toEqual([
      { type: 'ACTUAL', dollars: 0.01, Subscribers: subscribers },
      { type: 'FORECASTED', dollars: 1, Subscribers: subscribers },
    ]);
  });

  it('passes CloudFormation schema validation (no budget threshold warnings)', () => {
    for (const n of Object.values(t.findResources('AWS::Budgets::Budget'))[0]!.Properties
      .NotificationsWithSubscribers) {
      expect(n.Notification.Threshold).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('tags resources with the project name', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      Tags: Match.arrayWith([{ Key: 'project', Value: 'live-staffing' }]),
    });
  });

  it('reuses an existing OIDC provider when given one', () => {
    const app = new App();
    const stack = new BootstrapStack(app, 'B', {
      env: { account: '123456789012', region: 'ca-central-1' },
      budgetAlertEmail: 'owner@example.com',
      existingOidcProviderArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
    });
    Template.fromStack(stack).resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });
});

describe('#84 scoped CloudFormation execution policy', () => {
  const t = synth();
  type Statement = { Sid: string; Action: string | string[]; Resource: unknown; Condition?: unknown };
  const policy = Object.values(t.findResources('AWS::IAM::ManagedPolicy'))[0]!.Properties;
  const statements = policy.PolicyDocument.Statement as Statement[];
  const actions = (s: Statement) => [s.Action].flat();
  /** Resolves CDK's Fn::Join of the partition into a plain ARN string, for matching. */
  const resources = (s: Statement): string[] =>
    [s.Resource]
      .flat()
      .map((r) =>
        typeof r === 'string'
          ? r
          : (r as { 'Fn::Join': [string, unknown[]] })['Fn::Join'][1]
              .map((part) => (typeof part === 'string' ? part : 'aws'))
              .join(''),
      );

  it('is a named managed policy, output for the re-bootstrap command', () => {
    expect(policy.ManagedPolicyName).toBe('live-staffing-cfn-exec');
    t.hasOutput('CfnExecPolicyArn', {});
  });

  it('allows nothing on every resource of every service (no AdministratorAccess)', () => {
    for (const s of statements) {
      expect(actions(s), s.Sid).not.toContain('*');
      if (resources(s).includes('*'))
        for (const a of actions(s)) expect(a, s.Sid).toMatch(/^(lambda|appsync|logs):/);
    }
  });

  it('covers only the services the stack uses', () => {
    const services = new Set(statements.flatMap((s) => actions(s).map((a) => a.split(':')[0])));
    expect([...services].sort()).toEqual(
      ['apigateway', 'appsync', 'dynamodb', 'iam', 'lambda', 'logs', 's3', 'ssm', 'sqs'].sort(),
    );
  });

  it('limits every IAM action to roles and policies named after the stack', () => {
    const iamStatements = statements.filter((s) => actions(s).some((a) => a.startsWith('iam:')));
    expect(iamStatements.length).toBeGreaterThan(0);
    for (const s of iamStatements) {
      for (const a of actions(s)) expect(a.startsWith('iam:'), `${s.Sid} mixes ${a} with IAM`).toBe(true);
      for (const r of resources(s))
        expect(r, s.Sid).toMatch(/^arn:aws:iam::123456789012:(role|policy)\/LiveStaffingApp-\*$/);
    }
  });

  it('attaches no managed policy but Lambda logging or the stack own policies', () => {
    const attach = statements.filter((s) => actions(s).includes('iam:AttachRolePolicy'));
    expect(attach).toHaveLength(1);
    const allowed = JSON.stringify(attach[0]!.Condition);
    expect(allowed).toContain('service-role/AWSLambdaBasicExecutionRole');
    expect(allowed).toContain('policy/LiveStaffingApp-*');
    expect(allowed).not.toMatch(/AdministratorAccess|PowerUser|IAMFullAccess/);
  });

  it('keeps data, functions, queues and logs on stack-prefixed names', () => {
    const prefixed = (sid: string, pattern: RegExp) => {
      const s = statements.find((x) => x.Sid === sid)!;
      for (const r of resources(s)) expect(r, sid).toMatch(pattern);
    };
    prefixed('DynamoDbStackTables', /:table\/LiveStaffingApp-\*/);
    prefixed('SqsStackQueues', /:LiveStaffingApp-\*$/);
    prefixed('LogsStackGroups', /:log-group:LiveStaffingApp-\*/);
    expect(resources(statements.find((x) => x.Sid === 'LambdaStackFunctions')!)).toContain(
      'arn:aws:lambda:ca-central-1:123456789012:function:LiveStaffingApp-*',
    );
  });

  it('is deployed with the CLI credentials, not through the scoped execution role', () => {
    // No asset/deploy role lookups: the default synthesizer would add the BootstrapVersion rule.
    expect(t.toJSON().Rules?.CheckBootstrapVersion).toBeUndefined();
  });
});

describe('requireBudgetEmail', () => {
  it('fails with a clear message when BUDGET_ALERT_EMAIL is missing', () => {
    expect(() => requireBudgetEmail({})).toThrow(/BUDGET_ALERT_EMAIL is not set/);
    expect(() => requireBudgetEmail({ BUDGET_ALERT_EMAIL: '  ' })).toThrow(/BUDGET_ALERT_EMAIL is not set/);
  });

  it('rejects something that is not an email and accepts one that is', () => {
    expect(() => requireBudgetEmail({ BUDGET_ALERT_EMAIL: 'nope' })).toThrow(/not an email/);
    expect(requireBudgetEmail({ BUDGET_ALERT_EMAIL: 'a@b.co' })).toBe('a@b.co');
  });
});
