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
        'token.actions.githubusercontent.com:sub': 'repo:tarekFerdous/live-staffing-dashboard:ref:refs/heads/main',
      },
    });
    t.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it("can do nothing but assume the cdk-* roles", () => {
    t.resourceCountIs('AWS::IAM::Role', 1);
    t.resourceCountIs('AWS::IAM::Policy', 0);
    t.resourceCountIs('AWS::IAM::ManagedPolicy', 0);
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
