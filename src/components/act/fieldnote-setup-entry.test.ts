import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({ requestFieldnoteSetup: vi.fn() }));
import { FieldnoteSetupEntry } from './fieldnote-setup-entry';
import type { InstallationState } from '../../domain/fieldnote-skills/types';

const render = (props: Partial<Parameters<typeof FieldnoteSetupEntry>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(FieldnoteSetupEntry, {
      repositoryId: 'repository:1',
      installation: { kind: 'missing', latest: 'skills-v0.1.0' },
      progress: null,
      canStart: true,
      ...props,
    }),
  );

test('missing setup offers setup without needing a readiness grade', () => {
  expect(render()).toContain('Set up Fieldnote');
  expect(render()).toContain('<form');
});
test.each([
  [{ kind: 'current', release: 'skills-v0.1.0' }, 'Fieldnote Skills v0.1.0 installed'],
  [
    { kind: 'outdated', installed: 'skills-v0.1.0', latest: 'skills-v0.2.0' },
    'Update Fieldnote to v0.2.0',
  ],
  [
    { kind: 'drifted', release: 'skills-v0.1.0', reasons: ['Modified skill file'] },
    'Repair Fieldnote setup',
  ],
  [
    { kind: 'partial', release: 'skills-v0.1.0', reasons: ['Missing profile'] },
    'Repair Fieldnote setup',
  ],
] satisfies Array<[InstallationState, string]>)(
  'presents installation state %j',
  (installation, copy) => {
    const html = render({ installation });
    expect(html).toContain(copy);
    if ('reasons' in installation) expect(html).toContain(installation.reasons[0]);
    if (installation.kind === 'current') expect(html).not.toContain('<form');
  },
);
test.each([
  ['exploring', 'Exploring the repository'],
  ['awaiting-input', 'Waiting for your answer'],
  ['preparing', 'Preparing the setup pull request'],
  ['open', 'Monitoring the setup pull request'],
  ['verifying', 'Verifying the installation'],
] as const)('resumes %s instead of starting a duplicate setup', (state, copy) => {
  const html = render({
    progress: {
      runId: 'run:2',
      state,
      pullRequestUrl: state === 'open' ? 'https://github.com/acme/repo/pull/1' : null,
    },
  });
  expect(html).toContain(copy);
  expect(html).toContain('/app/repos/repository%3A1/act/run%3A2');
  expect(html).not.toContain('<form');
  if (state === 'open') expect(html).toContain('href="https://github.com/acme/repo/pull/1"');
});
test('cannot start setup without opt-in and write permissions', () => {
  expect(render({ canStart: false })).not.toContain('<form');
});
