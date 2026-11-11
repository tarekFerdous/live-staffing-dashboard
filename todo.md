# TODO

## Get the AWS account verified for CloudFront (blocks the live deploy)

The `LiveStaffingApp` deploy fails with:

> Your account must be verified before you can add new CloudFront resources. To verify your account, please contact AWS Support.

The rest works: CI checks pass and GitHub signs in to AWS through OIDC. The stack rolls back on failure, so nothing is left running or billing.

- [ ] Open a case at https://console.aws.amazon.com/support/home#/ ("Account and billing" is usually free).
      Ask them to verify the account for CloudFront. Include the error message and request ID
      `753a5278-f38a-8770-3ebd-d8e362613936` (CI run 42950559507).
- [ ] Once AWS confirms, re-run the failed deploy: `gh run rerun 42950559507 --failed` (or push any commit).
      No code change is needed.
- [ ] Check the remaining #13 / #14 criteria:
  - [ ] Deploy outputs print SiteUrl, ApiUrl and TableName
  - [ ] Manager page loads from the CloudFront URL with seeded data
  - [ ] CI smoke step passes (`GET <SiteUrl>/api/shifts/harbourfront-gala` → 200)
  - [ ] `pnpm destroy` removes the stack cleanly, then redeploy
- [ ] Check the deploy-only #20 / #21 criteria (M4, live updates):
  - [ ] CI step "Live-update smoke test (AppSync Events)" passes
  - [ ] A worker action in one browser appears on the manager page in another without a refresh
  - [ ] The pill shows Live on the deployed site; "Simulate outage" on/off recovers and applies missed changes
  - [ ] The publish DLQ (`PublishDlqUrl` output) stays empty after a few actions

## Optional

- [ ] Keep `main` green while waiting: gate the CI deploy job on a repo variable `DEPLOY_ENABLED == 'true'`
      and set it once the account is verified.
- [ ] Bump GitHub Actions off the deprecated Node 20 runtime (checkout, setup-node, pnpm/action-setup,
      configure-aws-credentials).
- [x] PRD #3: decide whether re-accepting after a cancel may overwrite `respondedAt`.
      Decided in M2: no. Timestamps are written with `if_not_exists`, so a re-invite keeps the first `invitedAt`
      and a re-accept keeps the first `respondedAt`.
