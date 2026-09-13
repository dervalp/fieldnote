import { expect, test } from 'vitest';
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import nextConfig from '../../next.config';
import { appPrefix, appSections } from './app-routes';

// These drive the real redirect table from next.config.ts, not a copy of it.
// Paths are spelled out rather than built from appPrefix: the point is to
// assert what a browser actually receives.

const follow = async (pathAndQuery: string) => {
  const response = await unstable_getResponseFromNextConfig({
    url: `https://fieldnote.test${pathAndQuery}`,
    nextConfig,
  });
  return {
    status: response.status,
    location: getRedirectUrl(response),
  };
};

// The whole reason this is 308 rather than 307 is that the move is permanent.
// The cost is that browsers cache it forever and a wrong destination cannot be
// withdrawn, which is why the table is tested by exercise and not by shape.
test('a legacy deep link keeps its dynamic segment, its encoding and every query param', async () => {
  const { status, location } = await follow(
    '/repos/repository%3A1/delivery?days=90&projection=gate-policy',
  );
  expect(status).toBe(308);
  expect(location).toBe(
    'https://fieldnote.test/app/repos/repository%3A1/delivery?days=90&projection=gate-policy',
  );
});

// ?days= threads through the sidebar, the repo tab bar and the body links. A
// redirect that dropped it would silently reset every reader's date range.
test('an explicit from/to range survives the redirect', async () => {
  const { location } = await follow('/dashboard?from=2026-08-01&to=2026-08-30');
  expect(location).toBe(
    'https://fieldnote.test/app/dashboard?from=2026-08-01&to=2026-08-30',
  );
});

test('a bare section root redirects as well as a deep path', async () => {
  expect((await follow('/repos')).location).toBe('https://fieldnote.test/app/repos');
  expect((await follow('/prs')).location).toBe('https://fieldnote.test/app/prs');
  expect((await follow('/onboarding')).location).toBe('https://fieldnote.test/app/onboarding');
  expect((await follow('/settings/account')).location).toBe(
    'https://fieldnote.test/app/settings/account',
  );
});

test('bare /app lands on the overview', async () => {
  expect((await follow('/app')).location).toBe('https://fieldnote.test/app/dashboard');
});

// The regression test for the bug this whole change exists to fix. If / ever
// redirects again, the marketing site is invisible again.
//
// Asserted on the status rather than on getRedirectUrl() returning null: a
// non-match is defined by not being a redirect, and that holds whatever the
// helper hands back for a response with no Location.
test('/ is not redirected anywhere', async () => {
  expect([307, 308]).not.toContain((await follow('/')).status);
});

test('the public surfaces are left alone', async () => {
  for (const path of ['/signed-out', '/invitations/abc123', '/api/auth/login']) {
    expect([307, 308]).not.toContain((await follow(path)).status);
  }
});

// next.config.ts deliberately imports nothing from src/, so this is what keeps
// the table and the route module from drifting apart.
test('the table covers exactly the five sections app-routes names', async () => {
  const redirects = await nextConfig.redirects!();
  const sectionEntries = redirects.filter((entry) => entry.source !== appPrefix);
  expect(sectionEntries.map((entry) => entry.source).sort()).toEqual(
    [...appSections].map((section) => `/${section}/:path*`).sort(),
  );
  for (const entry of sectionEntries) {
    expect(entry.destination).toBe(`${appPrefix}${entry.source}`);
    expect(entry.permanent).toBe(true);
  }
});
