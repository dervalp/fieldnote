# GitHub App setup

Create a GitHub.com App under Developer settings. Enable user authorization and expiring user tokens. Set the user callback to `APP_URL/api/auth/callback`, the setup URL to `APP_URL/app/dashboard`, and the webhook URL to `APP_URL/api/github/webhook`. The setup URL also lives in the App's own settings on GitHub, outside this repository, so repoint it there too: an App still pointing at `APP_URL/dashboard` costs every new install an extra redirect hop today, and will land on a 404 once the legacy redirects are retired.

Repository permissions (all read-only): Metadata (mandatory), Pull requests, Contents (commit and comparison file lists), Checks, Actions. No organization or user permissions are needed. Gate policy uses explicit administrator-selected names; branch protection/ruleset permissions are not required.

Subscribe to pull_request, pull_request_review, check_run, check_suite, workflow_run, installation, installation_repositories. Installation lifecycle events are delivered automatically where GitHub does not expose a subscription checkbox.

Generate a private key and place it in GITHUB_PRIVATE_KEY (escaped newlines accepted). Configure GITHUB_APP_SLUG, GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_WEBHOOK_SECRET; use at least 16 random characters for the webhook secret. Generate TOKEN_ENCRYPTION_KEY with `openssl rand -hex 32`. Set DEMO_MODE=false. In production APP_URL must use HTTPS and Inngest signing/event keys are required.

Install on selected repositories, sign in with GitHub, and choose a repository in onboarding to start its first analysis. Select required gates after the import discovers checks; saving a policy recomputes all imported PR projections and increments the visible policy version.

User access is checked with GitHub App user tokens against accessible installations and repositories on each protected request. Only users with GitHub repository administrator permission can change gates or request manual imports. Removed/suspended installations and repositories are denied. Credentials use AES-256-GCM at rest; browser sessions contain opaque random identifiers, stored hashed in PostgreSQL. OAuth state expires after ten minutes. User-token refresh is serialized per user.

The webhook verifies HMAC-SHA256 against raw bytes before parsing. Delivery identifiers are unique. Unsupported event names/actions remain stored with an explicit disposition once processing is enabled.

## Connect repositories and follow imports

Set `GITHUB_APP_SLUG` to the URL slug from `https://github.com/apps/<slug>`. Onboarding uses it for the install/access link. Installing the app or granting additional repositories makes them available for selection; it does not start tracking or import history. Organization approval may be required before repositories appear. After access is granted, use **Refresh repositories**, choose a repository, then **Start first analysis**. Starting analysis requires repository administrator permission. Other members with current GitHub access can read tracked records, but cannot start, refresh, or retry imports or change gate policy.

An initial import fixes a batch of the newest 100 PRs by creation date, including open, closed, and merged PRs, or all PRs when fewer exist. Repeated starts reuse the existing run. A partial retry creates a linked run using the same batch and preserves completed items; it only rehydrates unfinished items. A fresh refresh selects a new latest-100 batch. New webhook activity updates tracked repositories independently of that initial coverage. With no required-gate policy, imported PR and CI facts remain visible, while gate-dependent outcomes remain unknown. A zero-PR completion shows an empty record, not invented metrics.

The onboarding URL stores the repository and run ID so a reload can resume the persisted run. Status reads recheck current access; polling pauses while the browser tab is hidden and stops for terminal states or denied access. A repository administrator can request a fresh import from the repository page. The operator CLI `pnpm github:sync <repository-id>` also requests a fresh import, but only for an already tracked, active repository; it cannot enroll an installed repository.

## Import operations and release order

The database is the durable queue: starting analysis atomically sets `tracking_started_at` and creates a `repository_imports` row. An immediate event send is attempted after commit. If it fails, `reconcile-repository-imports` runs every minute and retries undispatched queued rows. Keep that Inngest function registered alongside the import worker. The separate raw-webhook reconciler continues to run every five minutes.

In the Inngest development or production UI, inspect `github/repository.sync.requested` events and the `sync-repository` function. Match `event.data.runId` to `repository_imports.id`; `event.data.repositoryId` identifies the repository. Event IDs use the run ID for deduplication. The worker records durable per-PR steps and separate completed/failed counts. Use read-only database inspection when diagnosing a run:

```sql
SELECT id, repository_id, state, total, completed, failed,
       retry_of, dispatched_at, created_at, finished_at
FROM repository_imports
WHERE id = '<run-id>';

SELECT number, state
FROM repository_import_items
WHERE run_id = '<run-id>'
ORDER BY number;
```

Before cutover, stop new legacy import requests and drain old active Inngest imports. Apply `drizzle/0001_high_hellcat.sql` with `pnpm db:migrate` before deploying the new application and worker definitions as one coordinated release. The migration marks non-demo repositories with existing PR evidence as tracked and leaves installed repositories without evidence untracked. Existing imported history remains readable without inventing a historical run.

Old repository-only sync events are incompatible: the new event schema requires both repository ID and run ID, and the worker verifies tracking and run ownership. Do not replay old events or fabricate run IDs to bypass enrollment. After migration and coordinated worker deployment, use the normal administrator action or the tracked-repository CLI to request a valid run. Confirm the queued-run reconciler is registered and follow its event/run ID before opening new requests. Migration tests and local fixtures do not establish production health; see [onboarding validation](validation-onboarding.md) for the checks actually performed.

## Dashboard evidence collection

`pull_request_review` submissions and dismissals and `pull_request` review-request transitions trigger hydration for tracked repositories. Workflow updates use the existing `workflow_run` subscription. Additional subscription: **Pull request review**. The app retains read-only permissions; no GitHub App configuration is changed by this code. The [PR timeline endpoint](https://docs.github.com/en/rest/issues/timeline#list-timeline-events-for-an-issue) accepts existing Pull requests read permission, so Issues permission and issue analytics are not needed.

Reviews and PR timeline events are paginated. Dismissals retain the target review ID and original decision where GitHub exposes it. Missing transitions, deleted history, and unresolved historical team membership remain incomplete. Successful review and CI dimensions persist independently; 403 and transient failures propagate to the existing five-retry hydration worker, while 404/410 historical unavailability is recorded as incomplete. Octokit retains its standard retry/throttling behavior.

[Workflow run attempt responses](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt) supply run-level outcomes and mutable `updated_at` metadata. The collector never derives outcomes from job totals or treats `updated_at` as exact completion. `source_updated_at` preserves that metadata; `terminal_observed_at` records a conservative terminal observation bound from REST receipt or a stored workflow webhook receipt. Repeated identical terminal snapshots retain the earliest observation; a changed conclusion gets a new bound. Historical cutoffs before that bound remain unknown without exact completion evidence. Operational charts may use a completion-day fallback only when start and terminal observation fall on the same UTC day; otherwise the completion day is unknown. Keep partial coverage visible. Existing provider checks remain in advanced gate analysis; unsupported provider-to-workflow mappings are explicitly incomplete for basic CI.

Apply `0003_review_dismissal_observation.sql` after the dashboard evidence migration before deploying these collectors. No source checkout, review/CI configuration changes, or additional write permissions are required.

## Dashboard release and background operations

Apply migrations in journal order with `pnpm db:migrate`, after the existing `0000` and onboarding `0001` migrations:

| Migration | Purpose |
| --- | --- |
| `0002_dashboard_evidence.sql` | Review and workflow-attempt evidence, PR links/completeness, retained backfill runs/items, and unique user interests |
| `0003_review_dismissal_observation.sql` | Dismissed review target identity and conservative workflow terminal observation time |
| `0004_foreground_hydration_lifecycle.sql` | Durable foreground hydration jobs and execution ownership |
| `0005_foreground_retry_deadlines.sql` | Persisted foreground retry time and error category |

Drain active old worker executions before the coordinated application/worker release, and apply all four migrations before starting the new collectors. Preserve raw evidence and import history. The current route `/api/inngest` must register all eight functions below; registration in source does not prove that a production scheduler is serving them.

| Function ID | Trigger and responsibility |
| --- | --- |
| `sync-repository` | `github/repository.sync.requested`, `{ repositoryId, runId }`: foreground latest-100 import |
| `sync-pull-request` | `github/pr.sync.requested`, `{ repositoryId, number, hydrationId?, sourceEventId? }`: foreground hydration; five retries, persisted deadline, terminal failure bookkeeping |
| `backfill-history` | `github/history.sync.requested`, `{ repositoryId, backfillId }`: one background discovery/hydration slice and next dispatch |
| `process-github-event` | `github/webhook.received`, `{ eventId }`: normalize a stored delivery and dispatch tracked activity |
| `recompute-pr` | `metrics/pr.recompute.requested`, `{ prId }`: advanced projection recomputation |
| `reconcile-repository-imports` | Every minute: recover foreground import dispatch |
| `reconcile-history-backfills` | Every minute: create missing post-import backfills and dispatch due/stale history work |
| `reconcile-github-events` | Every five minutes: recover raw delivery processing and durable foreground hydration |

A complete or partial first import starts history collection independently of its result. Existing tracked repositories with a completed/partial import and no backfill are picked up by reconciliation. A repository with older evidence but no import run needs a normal administrator refresh or `pnpm github:sync <repository-id>` first. The backfill fixes one calendar year at creation, discovers all-state PRs ordered by update time, and includes PRs opened before the cutoff if recently active. It checkpoints a page, sweep, and revision; a final discovery sweep detects source changes without repeating unchanged completed work. Refreshing the foreground import reuses the existing backfill rather than restarting it.

Inspect background status separately from `repository_imports`:

```sql
SELECT id, repository_id, cutoff, cursor, status, retry_at, error_category,
       dispatched_at, started_at, finished_at
FROM history_backfills
WHERE repository_id = '<repository-id>';

SELECT number, status, source_updated_at, retry_at, error_category
FROM history_backfill_items
WHERE backfill_id = '<backfill-id>'
ORDER BY number;

SELECT id, number, status, execution_id, retry_at, error_category,
       dispatched_at, updated_at
FROM foreground_hydrations
WHERE repository_id = '<repository-id>';
```

History event IDs contain the backfill ID and cursor revision; stale recovery adds a time slot. Undispatched work is recoverable, and dispatched history slices become eligible for recovery after 15 minutes. Foreground recovery waits at least one minute for an undispatched job, or 15 minutes since both dispatch and update for stale work, and never runs before `retry_at`. Its reconciler runs every five minutes. Do not clear deadlines or fabricate new run IDs to force retries.

Background slices yield to active imports, unprocessed webhook events, and queued/importing/retrying foreground jobs for the installation. Installation lock contention waits 30 seconds without shortening an existing retry deadline; foreground activity waits one minute. Rate-limit handling preserves GitHub retry/reset deadlines and propagates an installation pause to other background work. Inactive installations/repositories are excluded from recovery, and access is checked again before collection. A terminal unavailable PR item can leave a partial backfill; no automatic terminal-backfill restart action is exposed. Diagnose retained statuses rather than promising that a latest-100 refresh restarts historical failures.

Allow up to **13 PostgreSQL connections per application process** (ten data plus three PR-lock coordination connections), in addition to migration/operator connections. Background concurrency is bounded to three functions overall and one per repository, with an installation lock. These local integration checks are not a production capacity or scheduler test.

The read-only live App check on 2026-09-08 found **`pull_request_review` not subscribed**. Enable that subscription during rollout before relying on new review webhooks. This implementation did not change App configuration or permissions. REST hydration can still read available reviews, but the local smoke repository had no review or workflow histories. See [dashboard validation](validation-dashboard-metrics.md) for the exact evidence and limitations.
