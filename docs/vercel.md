# Vercel deployment

## Production

- Vercel project: `fieldnote` in the `dervalps-projects` scope.
- Public URL: <https://fieldnote-ashy.vercel.app>.
- Source: `dervalp/fieldnote`, production branch `main`, with automatic deploys.
- PostgreSQL is Neon. Migrations need the direct endpoint: `scripts/migrate.ts`
  prefers `DATABASE_URL_UNPOOLED` and falls back to `DATABASE_URL`, because
  Neon's pooled endpoint runs PgBouncer in transaction mode and discards the
  session state DDL depends on.
- `vercel.json` runs `pnpm db:migrate` before `pnpm build`, but **only when
  `VERCEL_ENV=production`**. A failed migration fails the build before it serves
  traffic. Preview builds do not migrate.
- `APP_URL` must be the production URL over HTTPS. Every OAuth redirect URI, the
  post-sign-in destination and the logout origin check are derived from it, so a
  stale value breaks sign-in rather than degrading it.
- The GitHub App credentials, webhook secret, token-encryption key, Inngest
  production keys and the E2B key are Vercel environment variables.

## This project used to deploy to Railway

It no longer does. The repository was renamed `pierrederval/ai-metrics` →
`dervalp/fieldnote`; GitHub keeps the old path as a redirect, so anything still
pointed at the old name keeps resolving and keeps looking healthy. That is the
trap: a leftover Railway service can go on building the old name and serving a
build from before the `/app` move, where `/app/dashboard`, `/cli/auth` and
`/settings/tokens` all return 404 while `/` still answers 200.

If you are diagnosing a 404, confirm which host you are on before reading
anything into the status codes. Vercel is the only deployment that counts.

## Sign-in depends on settings kept outside this repository

`/api/auth/login` builds `redirect_uri` as `APP_URL/api/auth/callback` and sends
the browser to GitHub. If GitHub will not accept that value, the browser never
comes back and **no request reaches this application at all** — the user sees a
GitHub error page, and the deployment logs show a 307 out of `/api/auth/login`
with no matching `/api/auth/callback`. That absence is the signature of a
misconfigured App; it is not an application bug, and no amount of reading this
codebase will explain it.

In the App's settings on GitHub, keep these in step with `APP_URL`:

| Setting | Value |
| --- | --- |
| Callback URL | `APP_URL/api/auth/callback` |
| Setup URL | `APP_URL/app/dashboard` |
| Webhook URL | `APP_URL/api/github/webhook` |

An empty or mismatched Callback URL fails only user sign-in. Webhooks keep
arriving and keep returning 200, so the App looks configured while nobody can
log in.

## Preview deployments

Vercel preview deployments are protected by Vercel SSO, and they inherit the
production `APP_URL`. A sign-in started on a preview URL therefore completes
against production and lands the session on the production domain. Treat
previews as useful for rendering and for build checks, not for exercising the
GitHub integration.

Adding a preview URL to the GitHub App as an extra callback is possible but
deliberately not done here: `*.vercel.app` is shared with other Vercel
customers, so no wildcard belongs in that list.

## References

- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel deployment protection](https://vercel.com/docs/deployment-protection)
- [Neon connection pooling](https://neon.tech/docs/connect/connection-pooling)
- [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
