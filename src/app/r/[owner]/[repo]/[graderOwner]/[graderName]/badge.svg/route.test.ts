import { beforeEach, expect, test, vi } from 'vitest';

const deps = vi.hoisted(() => ({ publicGrade: vi.fn() }));
vi.mock('../../../../../../../db/queries/public-grades', () => ({ publicGrade: deps.publicGrade }));

const { GET } = await import('./route');

const params = Promise.resolve({
  owner: 'acme',
  repo: 'widgets',
  graderOwner: 'fieldnote',
  graderName: 'agent-readiness',
});

beforeEach(() => {
  vi.resetAllMocks();
  deps.publicGrade.mockResolvedValue({ state: 'private' });
});

test('the grader id is rebuilt from its two segments', async () => {
  await GET(new Request('https://fieldnote.dev/r/acme/widgets/fieldnote/agent-readiness/badge.svg'), {
    params,
  });
  expect(deps.publicGrade).toHaveBeenCalledWith('acme', 'widgets', 'fieldnote/agent-readiness');
});

test('every state answers 200 with an SVG and the same cache policy', async () => {
  const response = await GET(new Request('https://fieldnote.dev/badge.svg'), { params });
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
  expect(await response.text()).toContain('private');
});
