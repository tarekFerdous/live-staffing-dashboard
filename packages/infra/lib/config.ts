import { Tags, type App } from 'aws-cdk-lib';

export const GITHUB_REPO = 'tarekFerdous/live-staffing-dashboard';
export const DEPLOY_ROLE_NAME = 'live-staffing-github-deploy';
export const APP_STACK_NAME = 'LiveStaffingApp';
export const BOOTSTRAP_STACK_NAME = 'LiveStaffingBootstrap';

/** Account and region always come from the CDK environment, never hard-coded. */
export const cdkEnv = () => ({
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ca-central-1',
});

export function tagApp(app: App) {
  Tags.of(app).add('project', 'live-staffing');
  Tags.of(app).add('owner', 'tarek');
}

/** The alert email lives only in the laptop environment, never in the repo. */
export function requireBudgetEmail(env: NodeJS.ProcessEnv = process.env): string {
  const email = env.BUDGET_ALERT_EMAIL?.trim();
  if (!email) {
    throw new Error(
      'BUDGET_ALERT_EMAIL is not set. Export the address that should receive budget alerts, e.g. ' +
        '`$env:BUDGET_ALERT_EMAIL="you@example.com"` (PowerShell) or `export BUDGET_ALERT_EMAIL=you@example.com`.',
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`BUDGET_ALERT_EMAIL "${email}" is not an email address.`);
  return email;
}
