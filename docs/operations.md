# Operations

Everything needed to run `fieldnote` beyond the seeded demo: tests, continuous
integration, production configuration, and operator commands. For the product
overview see the [README](../README.md); for architecture see
[architecture.md](architecture.md).

## Run tests and checks

Create the dedicated integration database once:

```bash
docker compose exec postgres createdb -U reliability reliability_test
```

Then run:

```bash
pnpm test              # deterministic unit and domain tests, no database
pnpm test:integration  # PostgreSQL and hydration tests
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm test:integration` refuses any database whose name does not end in `_test`.
`pnpm check` runs the complete suite and the production build.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs five separate
checks on every pull request into `main` and every push to `main`: `lint`,
`typecheck`, `unit`, `integration`, and `build`. Each appears as its own GitHub
check run.

The `integration` job supplies a `postgres:17-alpine` service whose default
database is the dedicated `_test` database, so it needs no `createdb` step and
the suites apply their own migrations. The `build` job uses synthetic,
non-secret production configuration generated per run; it reads no repository
secret and never reaches a database.

## Production configuration

The production build requires `DEMO_MODE=false`, an HTTPS `APP_URL`, and the
GitHub, encryption, and Inngest configuration described in
[GitHub App setup](github-app.md). Do not use the development demo
configuration for a production build.

The application rejects demo mode when `NODE_ENV=production`.

The [dashboard validation report](validation-dashboard-metrics.md) records a
build with synthetic, non-secret configuration. It is a validation record, not
a deployment check.

## Enable GitHub integration

Follow [docs/github-app.md](github-app.md), set `DEMO_MODE=false`, and fill
every GitHub and encryption variable in `.env`. Apply migrations, start the
application, then start the durable worker UI:

```bash
pnpm db:migrate
pnpm dev
pnpm inngest:dev
```

Configure the GitHub App webhook as `APP_URL/api/github/webhook`, install the
app, and sign in through `/api/auth/login`. Installation grants repository
availability. In onboarding, a repository administrator chooses a repository
and starts its latest-100-PR analysis. Administrators can retry partial
imports, request a fresh batch, and select required gates from the repository
page. Set `GITHUB_APP_SLUG` for the access-management link.

## History and visibility

Overview and repository dashboards share UTC date ranges, merged-PR counts,
review-aware first-pass outcomes, and workflow success including reruns. Basic
metrics do not require an advanced gate policy. Missing historical evidence
stays unknown.

Free access shows the latest 100 PRs per repository by creation time.
Background collection retains one year of PR activity independently of that
visibility limit. Expanded-history interest registration does not unlock access
or send notifications.

Apply the dashboard migrations and register the background and recovery workers
together; see
[release operations](github-app.md#dashboard-release-and-background-operations).

## Operator commands

Request a fresh import for an already tracked repository by internal repository
ID:

```bash
pnpm github:sync repository:123456789
```

| Command                 | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `pnpm dev`              | Run the Next.js application                      |
| `pnpm inngest:dev`      | Run Inngest locally against `/api/inngest`       |
| `pnpm db:migrate`       | Apply checked-in Drizzle migrations              |
| `pnpm db:seed`          | Repeatably create the 21-PR demo dataset         |
| `pnpm github:sync <id>` | Queue a historical repository import             |
| `pnpm test`             | Run deterministic unit/domain tests              |
| `pnpm test:integration` | Run PostgreSQL and hydration tests               |
| `pnpm check`            | Run lint, types, all tests, and production build |
