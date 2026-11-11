// One-time laptop deploy: `pnpm bootstrap:aws` (staffing profile).
import { App } from 'aws-cdk-lib';
import { BootstrapStack } from '../lib/bootstrap-stack';
import { BOOTSTRAP_STACK_NAME, cdkEnv, requireBudgetEmail, tagApp } from '../lib/config';

const app = new App();
tagApp(app);
new BootstrapStack(app, BOOTSTRAP_STACK_NAME, {
  env: cdkEnv(),
  budgetAlertEmail: requireBudgetEmail(),
  existingOidcProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN || undefined,
});
