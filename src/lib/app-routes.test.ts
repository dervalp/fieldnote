import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  appPrefix,
  appSections,
  dashboardPath,
  reposPath,
  repoPath,
  repoSectionPath,
  actRunPath,
  prPath,
  onboardingPath,
  accountSettingsPath,
  workspaceSettingsPath,
  publicGradePath,
  publicBadgePath,
} from './app-routes';

// Paths are spelled out here rather than composed from appPrefix. Building an
// expectation out of the same constant the implementation uses would assert
// nothing; these literals are the point of the suite.

test('every section sits under the prefix', () => {
  expect(appPrefix).toBe('/app');
  expect(dashboardPath()).toBe('/app/dashboard');
  expect(reposPath()).toBe('/app/repos');
  expect(onboardingPath()).toBe('/app/onboarding');
  expect(accountSettingsPath()).toBe('/app/settings/account');
  expect(workspaceSettingsPath()).toBe('/app/settings/workspace');
});

// The only test here that reads the filesystem, and the reason is the redirect
// table: next.config.ts 308s /repos/x to /app/repos/x with `permanent: true`.
// Rename a directory under src/app/app and fix up its callers and every other
// test still passes — while that permanent redirect keeps sending browsers to a
// URL that no longer exists, cached on the client and impossible to withdraw.
// So this compares `appSections` against what is actually on disk. The path is
// resolved from this file, not from process.cwd(), so it does not depend on
// where vitest was invoked; the comparison is order-insensitive because
// readdirSync order is not a guarantee worth being flaky over.
test('appSections names exactly the five directories under src/app/app', () => {
  const directories = readdirSync(join(import.meta.dirname, '..', 'app', 'app'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  expect([...directories].sort()).toEqual([...appSections].sort());
});

// Repository ids carry a colon. Encoding them exactly once, here, is the main
// reason this module exists: the escape was hand-written at ten call sites and
// a missed one is a 404 nobody notices until a colon shows up in an id.
test('ids are percent-encoded exactly once', () => {
  expect(repoPath('repository:1')).toBe('/app/repos/repository%3A1');
  expect(repoSectionPath('repository:1', 'delivery')).toBe(
    '/app/repos/repository%3A1/delivery',
  );
  expect(actRunPath('repository:1', 'run:2')).toBe(
    '/app/repos/repository%3A1/act/run%3A2',
  );
  expect(prPath('pr:9')).toBe('/app/prs/pr%3A9');
});

test('a query is accepted with or without its leading question mark', () => {
  expect(reposPath('?days=30')).toBe('/app/repos?days=30');
  expect(reposPath('days=30')).toBe('/app/repos?days=30');
  expect(repoPath('repo', '?from=2026-08-01&to=2026-08-30')).toBe(
    '/app/repos/repo?from=2026-08-01&to=2026-08-30',
  );
});

// An empty query must not leave a bare `?` on the URL: the sidebar and the tab
// bar both pass '' when no range is selected, and a trailing `?` would make
// pathname comparisons and cache keys differ for the same page.
test('an empty query leaves no trailing question mark', () => {
  expect(reposPath('')).toBe('/app/repos');
  expect(reposPath()).toBe('/app/repos');
  expect(repoSectionPath('repo', 'grading', '')).toBe('/app/repos/repo/grading');
});

test('workspace settings can carry the new-workspace hash', () => {
  expect(workspaceSettingsPath('#new-workspace')).toBe(
    '/app/settings/workspace#new-workspace',
  );
});

test('a public grade has one readable address, and its badge sits beneath it', () => {
  expect(publicGradePath('acme', 'widgets', 'fieldnote/agent-readiness')).toBe(
    '/r/acme/widgets/fieldnote/agent-readiness',
  );
  expect(publicBadgePath('acme', 'widgets', 'fieldnote/agent-readiness')).toBe(
    '/r/acme/widgets/fieldnote/agent-readiness/badge.svg',
  );
  expect(publicGradePath('a c', 'w/d', 'fieldnote/agent-readiness')).toBe(
    '/r/a%20c/w%2Fd/fieldnote/agent-readiness',
  );
});
