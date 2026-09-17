# Fieldnote Skills setup validation

Validation date: 2026-09-17. Implementation baseline:
`d1a45980acfa202bd187a8b0f839af309b6b3811` on
`codex/fieldnote-skills-setup`. This report covers local automated validation
and the outstanding rollout gates. It does **not** establish production
readiness or claim a completed live end-to-end setup.

## Environment and automated commands

Local runtime: Node `v25.2.1`, pnpm `10.27.0`, Next.js `16.3.4`, PostgreSQL 17
from `compose.yaml`. CI uses Node 24; this local run does not replace CI on
that runtime. Integration tests used only the existing disposable database
`fieldnote_issue32_fix1_test` on `localhost:55432`. Suites apply migrations and
clean their fixtures; no production database was accessed.

No `.env`, `.env.local`, or `.env.production.local` file was present. Provider
calls in tests use fakes. Tests/build made no live GitHub, E2B, or Anthropic
requests, and no live provider credentials were supplied. Unit tests include
loopback HTTP fixtures, so local networking permission was required. The first
Docker attempt was denied access to the local socket; the approved retry of
`docker compose up -d --wait` exited 0 with PostgreSQL healthy.

Clean unit/integration invocations retained only executable/runtime paths:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  NODE_ENV=test DEMO_MODE=true pnpm test

env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  NODE_ENV=test DEMO_MODE=false \
  TEST_DATABASE_URL=postgres://reliability:reliability@localhost:55432/fieldnote_issue32_fix1_test \
  pnpm test:integration
```

| Command                       | Observed outcome                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up -d --wait` | Exit 0 after local socket permission; PostgreSQL healthy                                                                            |
| `pnpm lint`                   | Exit 0                                                                                                                              |
| `pnpm typecheck`              | Exit 0                                                                                                                              |
| `pnpm test`                   | Exit 0; 173 files / 1,559 tests passed; 1 file / 3 tests skipped                                                                    |
| `pnpm test --reporter=dot`    | Exit 0; same unit counts, repeated to capture a compact summary                                                                     |
| `pnpm test:integration`       | Exit 0 after configuration repair; all 39 files / 341 tests passed                                                                  |
| `pnpm build`                  | Exit 0 with synthetic production configuration; compiled and generated all 15 static pages; setup and Inngest routes remain dynamic |

The final combined `pnpm check` also exited 0: lint, typecheck, 173 unit files /
1,559 passing tests (3 skipped), 39 integration files / 341 passing tests, and
the production build all completed. It used the exact build command below with
`NODE_ENV=production` omitted, the disposable `TEST_DATABASE_URL` above added,
and `pnpm build` replaced by `pnpm check`. Vitest sets its test environment and
Next.js sets production for its build. The parent build database remained
unroutable; integration configuration changes `DATABASE_URL` only in the test
process. No E2B, Anthropic, or release token was supplied. This combined check
ran after the integration configuration commit.

Documentation checks passed: `git diff --check` exited 0;
`pnpm exec prettier --check README.md docs/github-app.md docs/roadmap.md docs/validation-fieldnote-skills-setup.md`
exited 0 after formatting; a local filesystem check resolved all 29 relative
Markdown links in these four documents. External links were not fetched.

The first integration attempt incorrectly set `DEMO_MODE=true`: exit 1,
12 files failed / 27 passed and 44 tests failed / 259 passed. This was not a
valid CI-equivalent run. Correcting to `DEMO_MODE=false` with
`pnpm test:integration --reporter=dot` isolated the real configuration issue:
exit 1, 7 files failed / 32 passed and 8 tests failed / 295 passed, all remaining
failures due to unresolved `server-only` imports. The integration configuration
now uses the same Next.js empty-marker alias as the unit configuration. This
small test configuration correction was authorized separately from the docs;
production code and the Next.js server-only boundary were not changed. Existing
integration cases supply the regression check by exercising these imports.
The correction is commit `7fde151` (`test: resolve server-only in integration
suites`).

The production build followed `.github/workflows/ci.yml` with this exact
non-secret configuration. The generated key material was throwaway and was
neither printed nor retained:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  NODE_ENV=production DEMO_MODE=false APP_URL=https://ci.example.invalid \
  DATABASE_URL=postgres://ci:ci@127.0.0.1:1/ci_unreachable \
  GITHUB_APP_SLUG=ci-synthetic-app GITHUB_APP_ID=000000 \
  GITHUB_WEBHOOK_SECRET=ci-synthetic-webhook-secret \
  GITHUB_CLIENT_ID=ci-synthetic-client-id \
  GITHUB_CLIENT_SECRET=ci-synthetic-client-secret \
  INNGEST_DEV=0 INNGEST_EVENT_KEY=ci-synthetic-event-key \
  INNGEST_SIGNING_KEY=ci-synthetic-signing-key \
  sh -c 'export GITHUB_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null)"; export TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"; pnpm build'
```

## What automated coverage establishes

The suite exercises supported/unsupported agent evidence and confirmation,
complete byte-identical copies and lock hashes, profile merging, durable
conversation and ready-plan execution, authorization, duplicate dispatch and
provider response recovery, stale repository evidence, the three-repair bound,
terminal PR outcomes, and installation verification. PostgreSQL integration
cases exercise migrations, constraints, transactions, concurrent reservations,
and late verification ordering. Existing Monitor ingestion/metric suites run
alongside setup tests. Provider fakes prove the application contracts under
those fixtures, not live provider behavior or production scheduling.

The skipped three-test file is the opt-in live E2B sandbox suite. It was not run
because live E2B calls are outside this validation's authorization. Native
Codex/Claude discovery, browser navigation/resume, actual GitHub installation
permissions/webhooks, model output quality, and hosted Inngest scheduling have
not been demonstrated by these tests.

## Published prerequisite

The upstream release was published under separate explicit approval:
[`skills-v0.1.0`](https://github.com/dervalp/fieldnote-skills/releases/tag/skills-v0.1.0)
at immutable revision `c3c60c412cff443567372466666804df24360f31`, following
[upstream PR #9](https://github.com/dervalp/fieldnote-skills/pull/9) and successful
[Release workflow 35187949241](https://github.com/dervalp/fieldnote-skills/actions/runs/35187949241).
These are the existing publication evidence recorded in the implementation
ledger; this local validation did not re-query GitHub, merge, tag, or publish.
The provider is allowlisted to `dervalp/fieldnote-skills` and validates pinned
content before installation. A published release does not satisfy live
acceptance of the consuming application.

## Manual acceptance: pending authorization

No disposable-repository PRs were created, no acceptance merges were performed,
and no live E2B/Anthropic setup was run. The user has not authorized these
manual runs or their merges. Every row below remains **pending authorization**;
there are no acceptance screenshots or PR links to report.

| Repository shape or scenario      | Required evidence                                                                                                                                                   | Status                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Codex only                        | Confirm evidence; complete/resume conversation; all skills in `.agents/skills/`; lock hashes; native discovery; monitoring and human merge; verified default branch | Pending authorization |
| Claude Code only                  | Same flow with `.claude/skills/` and native Claude discovery                                                                                                        | Pending authorization |
| Codex and Claude Code             | Separate byte-identical complete copies at both roots, with both targets verified                                                                                   | Pending authorization |
| Codex and Claude Code plus Cursor | Unsupported Cursor evidence disclosed in UI/PR; no native Cursor adapter counted as installed                                                                       | Pending authorization |
| Close without merge               | Close an authorized setup PR; confirm no installation advancement                                                                                                   | Pending authorization |
| Update                            | A newer authorized immutable release appears as an update; no unsolicited PR; explicit profile values preserved and local skill drift surfaced                      | Pending authorization |
| Repair                            | Actionable CI/review feedback triggers bounded branch repair; ambiguous/unsafe feedback and three-round exhaustion require a human; no auto-merge                   | Pending authorization |
| Merge verification                | Explicitly approved human merge, fresh default-branch scan, complete lock/profile/supporting-file checks; current/outdated/partial/drifted UI reflects evidence     | Pending authorization |

For each approved shape, record detected evidence and human confirmation,
one-question-at-a-time interaction and resume after navigation, exact release
and committed hashes, CI/review monitoring while open, the human's merge,
default-branch verification SHA, and current/update-available presentation.
Capture redacted screenshots and PR links only after authorization; omit raw
source, credentials, and sandbox transcripts. An update run requiring a new
upstream test release also needs publication authorization. Human merge
authority remains required even after CI is green.

## Remaining rollout gates

Follow [GitHub App rollout and rollback](github-app.md#coordinated-rollout-and-rollback):
back up and migrate in journal order through `0023`, confirm the App permission
upgrade and review/check/workflow subscriptions, configure server-side authoring
keys, deploy the matching app and all 20 Inngest functions, and verify actual
reconciliation in the target environment. These operations, the acceptance
matrix, CI on Node 24, final whole-branch review, and production rollout/rollback
exercises remain outside this local evidence. Keep Act opt-in gated until the
required live results have been authorized, run, and reviewed.
