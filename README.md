# Live Staffing Dashboard

A worker view and a manager dashboard for one event shift, with live updates, built on AWS serverless.

**Live URL:** _printed as `SiteUrl` after `pnpm run deploy`; see the latest CI run's "Smoke test" step._

## Layout

| Package | What it holds |
| --- | --- |
| `packages/domain` | Statuses, transition table, `deriveCounts`, Zod schemas. No AWS or React imports. |
| `packages/store` | DynamoDB single-table repository, seed data, reset script, test helpers. |
| `packages/functions` | Lambda handlers and a tiny local HTTP adapter that calls the same handlers. |
| `packages/web` | React + Vite + TanStack Query + Tailwind. Routes `/manager` and `/worker`. |
| `packages/infra` | CDK: `BootstrapStack` (OIDC role, budget) and `AppStack` (table, API, Lambdas, S3, CloudFront). |

### Data model

One partition per shift (`PK = SHIFT#<id>`):

| SK | Item |
| --- | --- |
| `META` | title, location, startsAt/endsAt (UTC), timezone (IANA), required, `seq`, `acceptedCount` |
| `WORKER#<id>` | name, participation, attendance, timestamps, `version` |
| `EVT#<seq>` | event log (from M2) |

Sort keys order as `EVT#…` < `META` < `WORKER#…`, so the snapshot is a single Query with `SK >= "META"`.
It never reads the event log. (The PRD's `SK < "EVT#"` would match nothing, because `META` and `WORKER#` sort after `EVT#`.)
Counts are never stored for display: the client derives them from the worker rows with `deriveCounts`.

## Local development

Requirements: Node 22, pnpm 10, Docker.

```sh
pnpm install
pnpm db:up        # DynamoDB Local on :8000
pnpm reset        # creates the table and seeds one shift + three Uninvited workers
pnpm dev          # API on :3001, web on http://localhost:5173 (proxies /api)
```

`pnpm reset` can be run at any time to restore the seeded state.

### Checks

```sh
pnpm lint && pnpm typecheck && pnpm test
```

Store and handler integration tests run against a real DynamoDB Local. They start one with Testcontainers,
or use `DYNAMODB_ENDPOINT` if it is set (CI uses a service container).

## AWS

Region `ca-central-1`, AWS profile `staffing`. Everything is sized for the always-free tier: DynamoDB provisioned 5/5,
arm64 Lambdas, 7-day log retention. All resources are tagged `project=live-staffing`.

### One-time setup (laptop)

```powershell
$env:BUDGET_ALERT_EMAIL = "you@example.com"   # never committed
pnpm bootstrap:aws                             # cdk bootstrap + BootstrapStack
```

This creates the GitHub OIDC provider, the `live-staffing-github-deploy` role, and a monthly cost budget that emails at
$0.01 actual and $1 forecast. CloudFormation won't accept absolute thresholds below 0.1, so the alerts are set as 1% and
100% of a $1 budget. If the account already has a GitHub OIDC provider, set `GITHUB_OIDC_PROVIDER_ARN` to reuse it.

Then store the role ARN (the `DeployRoleArn` output) as a repository **variable** (not a secret):

```sh
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::<account>:role/live-staffing-github-deploy"
```

### Deploying

```powershell
$env:AWS_PROFILE = "staffing"
pnpm run deploy          # builds the web app, deploys AppStack, prints SiteUrl / ApiUrl / TableName
pnpm run deploy:hotswap  # dev only: pushes Lambda code changes in seconds, bypassing CloudFormation
pnpm reset --stage       # restore the seeded state on the deployed table
pnpm destroy             # removes AppStack (table and bucket included)
```

Use `pnpm run deploy`, not `pnpm deploy`, because `deploy` is a built-in pnpm command.
The stack seeds the shift when it is first created, so a fresh deploy works without running `reset`.

### CI/CD

`.github/workflows/ci.yml`:

- **Every push and pull request:** install, lint, typecheck, unit and integration tests (DynamoDB Local service container).
  This job has `contents: read` only and never receives AWS credentials.
- **Push to `main`, after checks pass:** assumes `live-staffing-github-deploy` through OIDC (no stored AWS keys),
  deploys `AppStack`, then smoke-tests `GET <SiteUrl>/api/shifts/<id>`. Anything other than a 200 fails the workflow.

The deploy role trusts only `main` of this repo. The repo uses GitHub's immutable OIDC subject, so the trusted `sub` is
`repo:tarekFerdous@55275853/live-staffing-dashboard@1453375278:ref:refs/heads/main` (owner and repo ids included, so a
renamed or re-created repo with the same name can't match). Its only permission is `sts:AssumeRole` on the `cdk-*`
roles that `cdk bootstrap` created. Forks deploying to their own account must change `GITHUB_SUBJECT_PREFIX` in
`packages/infra/lib/config.ts`.
