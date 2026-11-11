# TODO

## Get the AWS account verified for CloudFront, then bring CloudFront back

Creating a CloudFront distribution fails with:

> Your account must be verified before you can add new CloudFront resources. To verify your account, please contact AWS Support.

Workaround in place: the site is served by a `Site` Lambda (built app as a Lambda layer) on catch-all GET routes of the
HTTP API, so everything deploys without CloudFront. `SiteUrl` is the `execute-api` URL for now.

- [ ] Open a case at https://console.aws.amazon.com/support/home#/ ("Account and billing" is usually free).
      Ask them to verify the account for CloudFront. Include the error message and request IDs
      `753a5278-f38a-8770-3ebd-d8e362613936` (CI run 42950559507) and `ffb3d3d9-7aea-4c73-bdd8-0da8b9408d7e` (CI run 43001256024).
- [ ] Once AWS confirms, restore CloudFront + S3: bring back the "Site + CDN" block of `packages/infra/lib/app-stack.ts`
      and its tests from commit `706197f`, remove the `Site` Lambda, layer and catch-all routes, and redeploy.
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
