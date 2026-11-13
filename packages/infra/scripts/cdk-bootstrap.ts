// #84 Runs `cdk bootstrap` with the scoped CloudFormation execution policy that BootstrapStack created
// (its ARN is in bootstrap-outputs.json), so bootstrapping never falls back to AdministratorAccess.
// Part of `pnpm bootstrap:aws`, after BootstrapStack is deployed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOTSTRAP_STACK_NAME } from '../lib/config';

const outputs = JSON.parse(readFileSync(join(import.meta.dirname, '../bootstrap-outputs.json'), 'utf8'))[
  BOOTSTRAP_STACK_NAME
] as Record<string, string> | undefined;
const policyArn = outputs?.CfnExecPolicyArn;
if (!policyArn)
  throw new Error('bootstrap-outputs.json has no CfnExecPolicyArn. Deploy BootstrapStack first.');

const account = policyArn.split(':')[4];
const region = process.env.CDK_DEFAULT_REGION ?? 'ca-central-1';
console.log(`cdk bootstrap aws://${account}/${region} with ${policyArn}`);
execFileSync(
  'cdk',
  [
    'bootstrap',
    `aws://${account}/${region}`,
    '--profile',
    process.env.AWS_PROFILE ?? 'staffing',
    '--cloudformation-execution-policies',
    policyArn,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
