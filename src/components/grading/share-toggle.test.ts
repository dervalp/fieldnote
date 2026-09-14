import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({ setPublicGrade: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ShareToggle } = await import('./share-toggle');

const props = {
  repositoryId: 'repo',
  graderId: 'fieldnote/agent-readiness',
  graderTitle: 'Agent Readiness',
  pagePath: '/r/acme/widgets/fieldnote/agent-readiness',
  badgePath: '/r/acme/widgets/fieldnote/agent-readiness/badge.svg',
  baseUrl: 'https://fieldnote.dev',
  isPrivate: false,
  shared: false,
  canShare: true,
};
const render = (over: Partial<typeof props> = {}) =>
  renderToStaticMarkup(createElement(ShareToggle, { ...props, ...over }));

test('an owner is offered the switch', () => {
  expect(render()).toContain('Share publicly');
});

test('a shared grade shows the link and the Markdown to paste', () => {
  const html = render({ shared: true });
  expect(html).toContain('Stop sharing publicly');
  expect(html).toContain('https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness');
  expect(html).toContain(
    '[![Agent Readiness](https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness/badge.svg)](https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness)',
  );
});

test('a member sees the state and no control', () => {
  const off = render({ canShare: false });
  expect(off).toContain('A workspace owner');
  expect(off).not.toContain('<button');
  expect(render({ canShare: false, shared: true })).toContain('Shared publicly');
});

test('a private repository is told what sharing reveals', () => {
  expect(render({ isPrivate: true })).toContain('never file names');
  expect(render({ isPrivate: false })).not.toContain('never file names');
});
