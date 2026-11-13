// #84 What CloudFormation may do when CDK deploys the AppStack, instead of AdministratorAccess.
// `cdk bootstrap --cloudformation-execution-policies <arn>` gives this policy to the CFN execution
// role (see the README's Deploy section). Only the services the stack uses; IAM only on roles and
// policies named after the stack, and managed-policy attachment only for Lambda's basic logging role.
import * as iam from 'aws-cdk-lib/aws-iam';
import { APP_STACK_NAME } from './config';

export const CFN_EXEC_POLICY_NAME = 'live-staffing-cfn-exec';

export type Scope = { partition: string; account: string; region: string; stackName?: string };

export function cfnExecPolicyStatements({
  partition: p,
  account,
  region,
  stackName = APP_STACK_NAME,
}: Scope): iam.PolicyStatement[] {
  const arn = (service: string, resource: string, r = region, a = account) =>
    `arn:${p}:${service}:${r}:${a}:${resource}`;
  const prefixed = `${stackName}-*`;
  const lambdaBasic = `arn:${p}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`;

  return [
    new iam.PolicyStatement({
      sid: 'DynamoDbStackTables',
      actions: ['dynamodb:*'],
      resources: [arn('dynamodb', `table/${prefixed}`), arn('dynamodb', `table/${prefixed}/stream/*`)],
    }),
    new iam.PolicyStatement({
      sid: 'LambdaStackFunctions',
      actions: ['lambda:*'],
      resources: [
        arn('lambda', `function:${prefixed}`),
        arn('lambda', 'layer:*'),
        arn('lambda', 'event-source-mapping:*'),
      ],
    }),
    // These Lambda calls take no resource ARN.
    new iam.PolicyStatement({
      sid: 'LambdaUnscoped',
      actions: [
        'lambda:CreateEventSourceMapping',
        'lambda:ListEventSourceMappings',
        'lambda:GetEventSourceMapping',
        'lambda:ListLayers',
        'lambda:ListLayerVersions',
        'lambda:GetAccountSettings',
      ],
      resources: ['*'],
    }),
    new iam.PolicyStatement({
      sid: 'HttpApi',
      actions: ['apigateway:*'],
      resources: [`arn:${p}:apigateway:${region}::/*`],
    }),
    new iam.PolicyStatement({
      // CreateApi takes no resource ARN; AppSync grants no IAM, so it is no escalation path.
      sid: 'AppSyncEvents',
      actions: ['appsync:*'],
      resources: ['*'],
    }),
    new iam.PolicyStatement({
      sid: 'SqsStackQueues',
      actions: ['sqs:*'],
      resources: [arn('sqs', prefixed)],
    }),
    new iam.PolicyStatement({
      sid: 'LogsStackGroups',
      actions: ['logs:*'],
      resources: [arn('logs', `log-group:${prefixed}`), arn('logs', `log-group:${prefixed}:*`)],
    }),
    new iam.PolicyStatement({
      sid: 'LogsDescribe',
      actions: ['logs:DescribeLogGroups'],
      resources: ['*'],
    }),
    // The template's BootstrapVersion rule, and Lambda code/layers from the CDK assets bucket.
    new iam.PolicyStatement({
      sid: 'CdkBootstrapReads',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [arn('ssm', 'parameter/cdk-bootstrap/*')],
    }),
    new iam.PolicyStatement({
      sid: 'CdkAssetReads',
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [`arn:${p}:s3:::cdk-*-assets-${account}-${region}/*`],
    }),
    new iam.PolicyStatement({
      sid: 'IamStackRoles',
      actions: [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:GetRole',
        'iam:UpdateRole',
        'iam:UpdateRoleDescription',
        'iam:UpdateAssumeRolePolicy',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:ListRoleTags',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:DetachRolePolicy',
        'iam:PassRole',
      ],
      resources: [arn('iam', `role/${prefixed}`, '')],
    }),
    new iam.PolicyStatement({
      sid: 'IamStackPolicies',
      actions: [
        'iam:CreatePolicy',
        'iam:DeletePolicy',
        'iam:GetPolicy',
        'iam:CreatePolicyVersion',
        'iam:DeletePolicyVersion',
        'iam:GetPolicyVersion',
        'iam:ListPolicyVersions',
        'iam:TagPolicy',
        'iam:UntagPolicy',
      ],
      resources: [arn('iam', `policy/${prefixed}`, '')],
    }),
    // Only Lambda's logging policy or the stack's own policies can be attached: never an admin policy.
    new iam.PolicyStatement({
      sid: 'IamAttachOnlyKnownPolicies',
      actions: ['iam:AttachRolePolicy'],
      resources: [arn('iam', `role/${prefixed}`, '')],
      conditions: { ArnLike: { 'iam:PolicyARN': [lambdaBasic, arn('iam', `policy/${prefixed}`, '')] } },
    }),
  ];
}
