# Live Staffing Dashboard

A worker view and a manager dashboard for one event shift, with live updates, built on AWS serverless.

**Live URL:** _printed as `SiteUrl` after `pnpm run deploy`; see the latest CI run's "Smoke test" step._

## Layout

| Package              | What it holds                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/domain`    | Statuses, transition table, `deriveCounts`, Zod schemas. No AWS or React imports.               |
| `packages/store`     | DynamoDB single-table repository, seed data, reset script, test helpers.                        |
| `packages/functions` | Lambda handlers and a tiny local HTTP adapter that calls the same handlers.                     |
| `packages/web`       | React + Vite + TanStack Query + Tailwind. Routes `/manager` and `/worker`.                      |
| `packages/infra`     | CDK: `BootstrapStack` (OIDC role, budget) and `AppStack` (table, API, Lambdas, S3, CloudFront). |

### Data model

One partition per shift (`PK = SHIFT#<id>`):

| SK            | Item                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `META`        | title, location, startsAt/endsAt (UTC), timezone (IANA), required, `seq`, `acceptedCount`     |
| `WORKER#<id>` | name, participation, attendance, timestamps, `version`                                        |
| `EVT#<seq>`   | append-only event log: `{ seq, type, workerId, actor, row, at }` with the full new worker row |

Sort keys order as `EVT#…` < `META` < `WORKER#…`, so the snapshot is a single Query with `SK >= "META"`.
It never reads the event log. (The PRD's `SK < "EVT#"` would match nothing, because `META` and `WORKER#` sort after `EVT#`.)
Counts are never stored for display: the client derives them from the worker rows with `deriveCounts`.

### Actions (write path)

`POST /api/shifts/{shiftId}/workers/{workerId}/actions` with body `{ action, expectedVersion? }` and an
`Idempotency-Key` header. The actions are `invite` (manager), `accept`, `decline`, `cancel`, `check_in` and `check_out`
(worker). `check_in` needs Accepted + Not started and sets `checkedInAt`; `check_out` needs Checked in and sets
`checkedOutAt`, and Checked out is final. Participation stays Accepted through both, so filled places don't change.

Timestamps come from the Lambda clock, not the browser. A client clock can be wrong or deliberately changed, and a
retried request would carry a different time; the server stamps once and the write condition keeps that first value.

Each action is one read of META and the worker row, followed by a single `TransactWriteItems`:

1. **Worker row:** updated only from an allowed from-state and the version that was read. It gets `version + 1`, and
   its timestamp is set with `if_not_exists`, so a timestamp is never overwritten.
2. **META:** `seq = seq + 1`, only if `seq` still has the value that was read. `accept` also requires
   `acceptedCount < required` and adds 1; `cancel` subtracts 1.
3. **Event:** puts `EVT#<seq>` with the full new row.

If another write got in first, the Lambda re-reads and decides again, up to 3 retries with jittered backoff.

| Outcome                                                   | Response                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| Applied                                                   | `200 { worker, seq }`                                         |
| Already in the target state (double click, lost response) | `200 { worker }` with the stored row, no new event            |
| Stale `expectedVersion`                                   | `409 VERSION_CONFLICT` with `current`                         |
| Not allowed from the current state                        | `409 INVALID_TRANSITION` with `current` and a readable reason |
| No free place                                             | `409 SHIFT_FULL`, "No places left"                            |
| Malformed body or missing key                             | `422` (key not recorded)                                      |
| Same key, different body                                  | `422 IDEMPOTENCY_KEY_REUSED`                                  |

Idempotency uses Powertools for AWS Lambda, keyed on the `Idempotency-Key` header plus the path. Records live in their
own table (provisioned 3/3, 1-hour TTL). A repeated key returns the byte-identical first response. The web client makes
one key per click and reuses it on its automatic retries.

The per-shift `seq` serializes all writes to one shift. That is fine for a handful of people acting on one shift. It
would stop scaling at sustained concurrent writes to the same shift (roughly tens per second), where retries pile up.
At that point, guard capacity and order events per worker instead.

## Local mode (no AWS account)

Requirements: Docker, plus Node 22 and pnpm 10 for `pnpm reset`.

```sh
pnpm install
docker compose up   # DynamoDB Local + local API and live channel + Vite on http://localhost:5173
pnpm reset          # creates the tables and seeds one shift + three Uninvited workers
pnpm smoke:local    # optional: act once and check the change arrives over the local WebSocket
```

Live updates work exactly as in the cloud. The handlers depend on three ports, each with a cloud and a local adapter:

| Port              | Cloud                                          | Local                                                                                     |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AssignmentStore` | DynamoDB                                       | DynamoDB Local (same code, other endpoint)                                                |
| `ChangeFeed`      | DynamoDB Streams → Lambda event source mapping | polls DynamoDB Local's stream API (`local/changeFeed.ts`)                                 |
| `Publisher`       | AppSync Events HTTP publish (SigV4)            | in-process `ws` server speaking the AppSync Events WebSocket protocol (`local/events.ts`) |

The page reads `GET /api/config` at start-up to find its live channel (`wss://…appsync-realtime-api…` in the
cloud, `/event/realtime` on its own origin locally), so one web build runs in both modes. Source is bind-mounted:
API changes restart the server and page changes hot-reload within seconds. `pnpm reset` can be run at any time.

Without the `app` container: `pnpm db:up` then `pnpm dev` (API on :3001, web on :5173, both proxied the same way).

## Pages

- **Manager** (`/manager`): counts first (filled of required, remaining, checked in, checked out), the worker table
  with status chips, then the activity timeline (last 50 changes, newest first, times in the shift's timezone).
  The timeline loads the end of the event log once, then takes each live or caught-up event as it arrives; after an
  outage the catch-up fills the gap in order. Manager actions are never optimistic.
- **Worker** (`/worker`): the worker's own status and buttons. Actions are optimistic: the expected row (predicted
  with the same domain rules the server runs) shows at once; a refusal puts the previous row back and shows the
  server's message; success swaps in the server's row, and the live event for the same `seq` is ignored as a duplicate.
- **Theme:** follows the system setting; the header's Theme menu overrides it (remembered in `localStorage` when
  available). Colours are CSS variable tokens; status chips use semantic colours separate from the violet accent.
  Below 640 px the worker table turns into one card per worker, so nothing scrolls sideways at 400 px.

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
- **Every push and pull request, local mode:** `docker compose up --wait`, `pnpm reset`, `pnpm smoke:local` (one action,
  received over the local WebSocket). No AWS credentials.
- **Push to `main`, after checks pass:** assumes `live-staffing-github-deploy` through OIDC (no stored AWS keys),
  deploys `AppStack`, then smoke-tests `GET <SiteUrl>/api/shifts/<id>`. Anything other than a 200 fails the workflow.

The deploy role trusts only `main` of this repo. The repo uses GitHub's immutable OIDC subject, so the trusted `sub` is
`repo:tarekFerdous@55275853/live-staffing-dashboard@1453375278:ref:refs/heads/main` (owner and repo ids included, so a
renamed or re-created repo with the same name can't match). Its only permission is `sts:AssumeRole` on the `cdk-*`
roles that `cdk bootstrap` created. Forks deploying to their own account must change `GITHUB_SUBJECT_PREFIX` in
`packages/infra/lib/config.ts`.
