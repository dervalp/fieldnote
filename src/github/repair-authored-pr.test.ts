import { expect, test, vi } from 'vitest';
import { authoredPrClient } from './testing/authored-pr-client';
import { writePrRepair } from './repair-authored-pr';
const sha = 'a'.repeat(40);
function fixture() {
  const github = authoredPrClient(sha);
  github.refs.set('heads/fieldnote/setup', sha);
  const updateRef = vi.fn(
    async ({ ref, sha: next, force }: { ref: string; sha: string; force: boolean }) => {
      if (force || github.commits.get(next)?.parents[0]?.sha !== github.refs.get(ref))
        throw { status: 422 };
      github.refs.set(ref, next);
      return { data: {} };
    },
  );
  Object.assign(github.api.git, { updateRef });
  const authorize = vi.fn(async () => {});
  return {
    ...github,
    updateRef,
    input: {
      owner: 'octo',
      repo: 'repo',
      branch: 'fieldnote/setup',
      expectedHeadSha: sha,
      repairId: 'repair-1',
      commitDate: '2026-09-17T10:00:00Z',
      files: new Map([['.fieldnote/profile.md', 'profile']]),
      managedPaths: ['.fieldnote/profile.md'],
      authorize,
    },
  };
}
test('repair fast-forwards the same branch, retains unrelated files, and reauthorizes every mutation', async () => {
  const f = fixture();
  const result = await writePrRepair(f.input, f.client);
  expect(f.refs.get('heads/fieldnote/setup')).toBe(result.headSha);
  expect(f.updateRef).toHaveBeenCalledWith({
    owner: 'octo',
    repo: 'repo',
    ref: 'heads/fieldnote/setup',
    sha: result.headSha,
    force: false,
  });
  expect(f.commits.get(result.headSha)?.parents).toEqual([{ sha }]);
  expect(f.input.authorize).toHaveBeenCalledTimes(4);
  expect(f.trees.get(f.commits.get(result.headSha)!.tree.sha)?.map((entry) => entry.path)).toEqual([
    'README.md',
    '.fieldnote/profile.md',
  ]);
});
test.each(['before', 'publish'])(
  'a foreign head moving %s cannot be overwritten',
  async (phase) => {
    const f = fixture();
    if (phase === 'before') f.refs.set('heads/fieldnote/setup', 'foreign');
    else
      f.input.authorize.mockImplementation(async () => {
        if (f.input.authorize.mock.calls.length === 4)
          f.refs.set('heads/fieldnote/setup', 'foreign');
      });
    await expect(writePrRepair(f.input, f.client)).rejects.toMatchObject({
      code: 'setup_conflict',
    });
    expect(f.refs.get('heads/fieldnote/setup')).toBe('foreign');
    expect(f.updateRef).not.toHaveBeenCalled();
  },
);
test('out-of-map paths and permission loss cannot publish a branch mutation', async () => {
  const f = fixture();
  await expect(
    writePrRepair({ ...f.input, files: new Map([['src/app.ts', 'bad']]) }, f.client),
  ).rejects.toMatchObject({ code: 'invalid_installation' });
  expect(f.input.authorize).not.toHaveBeenCalled();
  const { SetupWriteError } = await import('./write-authored-pr');
  f.input.authorize.mockRejectedValue(new SetupWriteError('access_revoked'));
  await expect(writePrRepair(f.input, f.client)).rejects.toMatchObject({ code: 'access_revoked' });
  expect(f.updateRef).not.toHaveBeenCalled();
});
test('a lost update response is adopted on retry and no extra commit is published', async () => {
  const f = fixture();
  const update = f.updateRef.getMockImplementation()!;
  f.updateRef.mockImplementationOnce(async (input) => {
    await update(input);
    throw { status: 503, message: 'private-token' };
  });
  await expect(writePrRepair(f.input, f.client)).rejects.toMatchObject({
    code: 'github_unavailable',
  });
  const head = f.refs.get('heads/fieldnote/setup');
  await expect(writePrRepair(f.input, f.client)).resolves.toEqual({ headSha: head });
  expect(f.updateRef).toHaveBeenCalledTimes(1);
});
