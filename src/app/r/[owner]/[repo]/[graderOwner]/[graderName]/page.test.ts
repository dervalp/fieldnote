import { expect, test, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const deps = vi.hoisted(() => ({ publicGrade: vi.fn() }));
vi.mock('../../../../../../db/queries/public-grades', () => ({ publicGrade: deps.publicGrade }));

const { default: PublicGrade, generateMetadata } = await import('./page');
const { agentReadinessManifest } = await import('../../../../../../domain/grading/graders/agent-readiness');
const { publicGrader } = await import('../../../../../../domain/grading/public-grade');

const grader = publicGrader(agentReadinessManifest);
const repository = { owner: 'acme', name: 'widgets', isPrivate: false };
const grade = {
  score: 80,
  sha: 'a'.repeat(40),
  computedAt: new Date('2026-09-01T00:00:00.000Z'),
  rubricVersion: agentReadinessManifest.version,
  evaluatorVersion: agentReadinessManifest.evaluatorVersion,
  checks: [
    {
      id: 'root-readme',
      points: 20,
      maxPoints: 20,
      status: 'pass' as const,
      paths: ['README.md'],
      lineRanges: [],
      explanation: 'Found a root README.md. Evidence, not certification.',
    },
  ],
};
const params = (owner = 'acme', repo = 'widgets') =>
  Promise.resolve({ owner, repo, graderOwner: 'fieldnote', graderName: 'agent-readiness' });

beforeEach(() => {
  vi.resetAllMocks();
});

test('a graded page shows the card, the commit and the checks', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, manifest: agentReadinessManifest, grade, stale: false });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('Agent Readiness');
  expect(html).toContain('acme / widgets');
  expect(html).toContain('aaaaaaa');
  expect(html).toContain('Found a root README.md');
  expect(html).not.toContain('more than 30 days');
});

// The private and ungraded branches each have an h1; the graded one had none,
// which left the page a heading short of an outline.
test('a graded page has a heading naming the repository and the grader', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, manifest: agentReadinessManifest, grade, stale: false });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('<h1>Agent Readiness · acme/widgets</h1>');
});

test('a stale grade says so on the page', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, manifest: agentReadinessManifest, grade, stale: true });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('more than 30 days');
});

test('an ungraded pair invites nothing and claims nothing', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'ungraded', repository, grader });
  const html = renderToStaticMarkup(await PublicGrade({ params: params() }));
  expect(html).toContain('Not graded yet.');
  expect(html).not.toContain('out of 100');
});

test('every private address renders the same page, whatever was asked for', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  const first = renderToStaticMarkup(await PublicGrade({ params: params('acme', 'widgets') }));
  const second = renderToStaticMarkup(await PublicGrade({ params: params('someone', 'secret-repo') }));
  expect(first).toBe(second);
  expect(first).toContain('This grade is private.');
  expect(first).not.toContain('secret-repo');
  expect(first).not.toContain('acme');
});

test('a private page is not indexed, and a graded one is', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  expect(await generateMetadata({ params: params() })).toMatchObject({
    robots: { index: false, follow: false },
  });
  deps.publicGrade.mockResolvedValue({ state: 'graded', repository, grader, manifest: agentReadinessManifest, grade, stale: false });
  const metadata = await generateMetadata({ params: params() });
  expect(metadata.robots).toBeUndefined();
  expect(metadata.title).toContain('Agent Readiness');
});

test('the grader id is rebuilt from its two segments', async () => {
  deps.publicGrade.mockResolvedValue({ state: 'private' });
  await PublicGrade({ params: params() });
  expect(deps.publicGrade).toHaveBeenCalledWith('acme', 'widgets', 'fieldnote/agent-readiness');
});
