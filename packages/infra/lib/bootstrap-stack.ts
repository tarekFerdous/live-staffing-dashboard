import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { DEPLOY_ROLE_NAME, GITHUB_REPO } from './config';

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
export const BUDGET_LIMIT_USD = 1;

export type BootstrapStackProps = StackProps & {
  budgetAlertEmail: string;
  githubRepo?: string;
  /** Reuse an OIDC provider that already exists in the account (only one per URL is allowed). */
  existingOidcProviderArn?: string;
};

/**
 * Deployed once from the laptop. Lets GitHub Actions on `main` deploy with
 * short-lived credentials, and emails the owner as soon as anything costs money.
 */
export class BootstrapStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);
    const repo = props.githubRepo ?? GITHUB_REPO;

    const providerArn =
      props.existingOidcProviderArn ??
      new iam.CfnOIDCProvider(this, 'GithubOidc', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIdList: ['sts.amazonaws.com'],
      }).attrArn;

    this.deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: DEPLOY_ROLE_NAME,
      description: `GitHub Actions deploys from ${repo} main only`,
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${repo}:ref:refs/heads/main`,
        },
      }),
      // CI holds no rights of its own: it can only step into the roles `cdk bootstrap` created.
      inlinePolicies: {
        AssumeCdkRoles: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-*`],
            }),
          ],
        }),
      },
    });

    // Thresholds are percentages of the $1 limit: CloudFormation rejects absolute
    // thresholds below 0.1, so $0.01 is expressed as 1% of $1.
    new CfnBudget(this, 'CostBudget', {
      budget: {
        budgetName: 'live-staffing-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: BUDGET_LIMIT_USD, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 1, // 1% of $1 = $0.01
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetAlertEmail }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100, // 100% of $1 = $1
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetAlertEmail }],
        },
      ],
    });

    new CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
  }
}
