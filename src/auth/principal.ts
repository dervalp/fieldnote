import { AsyncLocalStorage } from 'node:async_hooks';

// Who a request is acting as, when that is not a browser cookie.
//
// The entire authorization stack reads cookies: sessionUser() does, and
// requireWorkspace() does for the workspace preference. A bearer token cannot
// reach any of it. Duplicating the authorization logic for /api/cli/* would
// put "may this principal grade this repository" in two places, and they would
// diverge the first time one was fixed. Minting a session cookie for a CLI
// token would silently give it a browser session's blast radius.
//
// So the principal becomes explicit and request-scoped. An empty store means
// the cookie path, which is byte-for-byte today's behaviour — the existing
// session suites are the proof, and they pass unchanged.
//
// `source` is carried because an audit log and a rate limit both need it, and
// adding it later means a migration.
export type Principal = {
  userId: string;
  workspaceId: string;
  source: 'session' | 'cli';
};

const storage = new AsyncLocalStorage<Principal>();

export function withPrincipal<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
  return storage.run(principal, fn);
}

export function currentPrincipal(): Principal | undefined {
  return storage.getStore();
}
