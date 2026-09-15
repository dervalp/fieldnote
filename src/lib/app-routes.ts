// The one place the /app prefix is spelled, and the one place a route id is
// percent-encoded. Moving the product again is an edit to `appPrefix` plus a
// regenerated redirect table in next.config.ts.
//
// Deliberately dependency-free. next.config.ts is checked against
// `appSections` by src/lib/legacy-redirects.test.ts rather than importing this
// module, so nothing here may ever grow an import.
//
// Not for tests. A test that builds its expected href from these functions
// asserts nothing at all; test files spell their paths out.
//
// Kept apart from navigation-path.ts on purpose: that normalises an *incoming*
// pathname so it can be compared, this constructs *outgoing* ones.

export const appPrefix = '/app';

/** The five product sections. The legacy redirect table covers exactly these. */
export const appSections = ['dashboard', 'repos', 'prs', 'settings', 'onboarding'] as const;

/**
 * Accepts a search string with or without its leading `?` — callers read it
 * from useSearchParams() (no `?`) or from a helper that includes one — and
 * drops an empty one, so a page with no range selected does not get a bare
 * trailing `?` that makes two URLs for the same view.
 */
function withQuery(path: string, query: string): string {
  const search = query.startsWith('?') ? query.slice(1) : query;
  return search ? `${path}?${search}` : path;
}

export function dashboardPath(query = ''): string {
  return withQuery(`${appPrefix}/dashboard`, query);
}

export function reposPath(query = ''): string {
  return withQuery(`${appPrefix}/repos`, query);
}

// Repository ids look like `repository:1`. pageRouteId() decodes this back on
// the way in; the two are a pair and must stay one encode to one decode.
export function repoPath(repoId: string, query = ''): string {
  return withQuery(`${appPrefix}/repos/${encodeURIComponent(repoId)}`, query);
}

/**
 * The static route segments directly under src/app/app/repos/[repoId]/.
 *
 * A closed union rather than `string`: a typo — `'ai-involvment'` — used to
 * compile, lint and pass while producing a 404, which is the exact class of bug
 * this module exists to prevent.
 *
 * `act` is deliberately absent. There is no page at .../act; only
 * .../act/[runId], and actRunPath builds that one.
 */
export type RepoSection = 'grading' | 'ai-involvement' | 'delivery' | 'settings';

/** `segment` is a static route segment — grading, ai-involvement, delivery, settings. */
export function repoSectionPath(repoId: string, segment: RepoSection, query = ''): string {
  return withQuery(`${appPrefix}/repos/${encodeURIComponent(repoId)}/${segment}`, query);
}

/** Two ids, both encoded: the repository and the authoring run. */
export function actRunPath(repoId: string, runId: string): string {
  return `${appPrefix}/repos/${encodeURIComponent(repoId)}/act/${encodeURIComponent(runId)}`;
}

export function prPath(prId: string): string {
  return `${appPrefix}/prs/${encodeURIComponent(prId)}`;
}

export function onboardingPath(query = ''): string {
  return withQuery(`${appPrefix}/onboarding`, query);
}

export function accountSettingsPath(): string {
  return `${appPrefix}/settings/account`;
}

/** `hash` carries the `#new-workspace` deep link from the workspace switcher. */
export function workspaceSettingsPath(hash = ''): string {
  return `${appPrefix}/settings/workspace${hash}`;
}

/** Where a CLI token is revoked. The CLI prints this URL, so it is a public
 * address in a way the other settings pages are not — a developer reads it off
 * their terminal and types it. */
export function tokensSettingsPath(): string {
  return `${appPrefix}/settings/tokens`;
}

// The public surface. Readable on purpose: a badge has to be recognisable in a
// README to do its job. A grader id is `owner/name`, and it stays two segments
// here so a route beneath it (badge.svg) is possible at all.
export function publicGradePath(owner: string, repo: string, graderId: string): string {
  const [graderOwner, graderName] = graderId.split('/');
  return `/r/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(graderOwner)}/${encodeURIComponent(graderName)}`;
}

export function publicBadgePath(owner: string, repo: string, graderId: string): string {
  return `${publicGradePath(owner, repo, graderId)}/badge.svg`;
}
