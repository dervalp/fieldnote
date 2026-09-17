import { beforeEach, expect, test, vi } from 'vitest';
import { sha256 } from '../../domain/fieldnote-skills/lock';
import { authoredPrClient } from '../../github/testing/authored-pr-client';

const deps = vi.hoisted(() => ({
  loadRun: vi.fn(),
  loadPlan: vi.fn(),
  begin: vi.fn(),
  validate: vi.fn(),
  permissions: vi.fn(),
  fail: vi.fn(),
  head: vi.fn(),
  collect: vi.fn(),
  release: vi.fn(),
  reopen: vi.fn(),
  write: vi.fn(),
  record: vi.fn(),
  complete: vi.fn(),
  client: vi.fn(),
}));
vi.mock('../../db/queries/authoring-runs', () => ({
  loadAuthoringRun: deps.loadRun,
  beginAuthoring: deps.begin,
  validateAuthoringRun: deps.validate,
  failAuthoringRun: deps.fail,
}));
vi.mock('../../db/queries/fieldnote-setup', () => ({
  loadSetupPlan: deps.loadPlan,
  reopenSetupPlan: deps.reopen,
  recordAuthoredPullRequest: deps.record,
  completeSetupExecute: deps.complete,
}));
vi.mock('../../github/installation-permissions', () => ({
  fetchGrantedPermissions: deps.permissions,
}));
vi.mock('../../github/collect-files', () => ({ resolveHeadSha: deps.head }));
vi.mock('../../github/collect-fieldnote-setup', () => ({ collectFieldnoteSetup: deps.collect }));
vi.mock('../../github/repositories', () => ({ repositoryClient: deps.client }));
vi.mock('../../fieldnote-skills/github-release', () => ({ readSkillsRelease: deps.release }));
vi.mock('../../github/write-authored-pr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../github/write-authored-pr')>()),
  writeAuthoredPullRequest: deps.write,
}));
vi.mock('../client', () => ({
  inngest: { createFunction: (options: unknown, handler: unknown) => ({ options, handler }) },
}));
import { executeFieldnoteSetupFunction } from './execute-fieldnote-setup';
import { SetupWriteError } from '../../github/write-authored-pr';

const sha = 'a'.repeat(40),
  nextSha = 'b'.repeat(40);
const release = {
  release: 'skills-v0.1.0',
  revision: 'c'.repeat(40),
  releaseLockHash: sha256('lock'),
  skills: [
    {
      name: 'fieldnote-setup-profile',
      version: '1',
      files: [{ path: 'SKILL.md', content: 'trusted', hash: sha256('trusted') }],
    },
  ],
};
let run: Record<string, unknown>;
let plan: {
  run: Record<string, unknown>;
  proposal: Record<string, unknown>;
  files: Array<{ path: string; body: string; hash: string }>;
};
beforeEach(() => {
  vi.resetAllMocks();
  run = {
    id: 'execute',
    repositoryId: 'repo',
    kind: 'execute',
    workflow: 'fieldnote-setup',
    planRunId: 'plan',
    state: 'queued',
    createdAt: new Date('2026-09-16'),
  };
  plan = {
    run: { id: 'plan', repositoryId: 'repo', state: 'complete', sha },
    proposal: {
      state: 'ready',
      updatedAt: new Date('2026-09-16T00:00:00Z'),
      repositorySha: sha,
      skillsRelease: release.release,
      skillsRevision: release.revision,
      releaseLockHash: release.releaseLockHash,
      confirmedAgents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
      confirmedFacts: [],
    },
    files: [
      { path: '.fieldnote/profile.md', body: 'Complete profile', hash: sha256('Complete profile') },
    ],
  };
  deps.loadRun.mockImplementation(async () => structuredClone(run));
  deps.loadPlan.mockImplementation(async () => structuredClone(plan));
  deps.begin.mockImplementation(async () => {
    run.state = 'running';
    return structuredClone(run);
  });
  deps.permissions.mockResolvedValue({ contents: 'write', pullRequests: 'write' });
  deps.head.mockResolvedValue(sha);
  deps.collect.mockImplementation(async (_id, commit) => ({
    sha: commit,
    complete: true,
    paths: ['AGENTS.md'],
    documents: [{ path: 'AGENTS.md', blobSha: 'evidence', text: 'raw private source' }],
    candidates: [],
  }));
  deps.release.mockResolvedValue(release);
  deps.client.mockResolvedValue({ repo: { owner: 'octo', name: 'repo' }, client: {} });
  deps.write.mockImplementation(async (input) => {
    await input.authorize();
    return {
      number: 42,
      branch: 'fieldnote/setup-skills-v0.1.0',
      headSha: nextSha,
      url: 'https://github.test/pr/42',
    };
  });
  deps.complete.mockImplementation(async () => {
    run.state = 'complete';
  });
});
async function invoke(
  cache = new Map<string, unknown>(),
  proposalUpdatedAt: string | undefined = '2026-09-16T00:00:00.000Z',
) {
  const handler = (
    executeFieldnoteSetupFunction as unknown as { handler: (context: unknown) => Promise<unknown> }
  ).handler;
  await handler({
    event: { data: { runId: 'execute', proposalUpdatedAt } },
    step: {
      run: async (name: string, work: () => Promise<unknown>) => {
        if (!cache.has(name)) cache.set(name, await work());
        return cache.get(name);
      },
    },
  });
  return cache;
}
test('validates the deterministic installation, records PR before completion and uses stable retry steps', async () => {
  const cache = await invoke();
  expect([...cache.keys()]).toEqual(['begin', 'refresh', 'render', 'write-pr', 'complete']);
  expect(
    deps.write.mock.calls[0][0].files.has('.agents/skills/fieldnote-setup-profile/SKILL.md'),
  ).toBe(true);
  expect(deps.record).toHaveBeenCalledWith(
    expect.objectContaining({
      authoringRunId: 'execute',
      repositoryId: 'repo',
      number: 42,
      headSha: nextSha,
    }),
  );
  expect(deps.record.mock.invocationCallOrder[0]).toBeLessThan(
    deps.complete.mock.invocationCallOrder[0],
  );
  expect(JSON.stringify([...cache.values()])).not.toContain('raw private source');
  await invoke(cache);
  await invoke();
  expect(deps.write).toHaveBeenCalledTimes(1);
});
test('rebases unrelated movement onto the refreshed default head', async () => {
  deps.head.mockResolvedValue(nextSha);
  await invoke();
  expect(deps.write.mock.calls[0][0]).toMatchObject({
    expectedBaseSha: nextSha,
    proposalBaseSha: sha,
  });
  expect(deps.reopen).not.toHaveBeenCalled();
});
test('changed evidence reopens the plan for input without rendering or writing', async () => {
  deps.head.mockResolvedValue(nextSha);
  deps.collect.mockImplementation(async (_id, commit) => ({
    sha: commit,
    complete: true,
    paths: ['AGENTS.md'],
    documents: [{ path: 'AGENTS.md', blobSha: commit, text: 'private' }],
    candidates: [],
  }));
  await invoke();
  expect(deps.reopen).toHaveBeenCalledWith(
    'execute',
    expect.objectContaining({ sha: nextSha }),
    'setup_conflict',
  );
  expect(deps.write).not.toHaveBeenCalled();
  expect(deps.complete).not.toHaveBeenCalled();
});
test('renderer rejects unresolved configuration before Github mutation', async () => {
  plan.files[0] = { path: '.fieldnote/profile.md', body: 'TODO', hash: sha256('TODO') };
  await expect(invoke()).rejects.toThrow('Setup rendering failed');
  expect(deps.write).not.toHaveBeenCalled();
});
test('write authorization is checked again after rendering and provider errors stay sanitized', async () => {
  deps.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'write' });
  await expect(invoke()).rejects.toThrow('Setup unavailable');
  expect(deps.write).not.toHaveBeenCalled();
  expect(deps.fail).toHaveBeenCalledWith('execute', 'access_revoked');
});
test('retries the same PR when persistence fails after the external write', async () => {
  deps.record.mockRejectedValueOnce(new Error('database secret'));
  const cache = new Map<string, unknown>();
  await expect(invoke(cache)).rejects.toThrow('Setup pull request failed');
  expect(deps.complete).not.toHaveBeenCalled();
  await invoke(cache);
  expect(deps.write.mock.calls.map(([input]) => input.runId)).toEqual(['execute', 'execute']);
  expect(deps.complete).toHaveBeenCalledTimes(1);
});
test('destination conflict refreshes evidence and reopens the plan', async () => {
  deps.write.mockRejectedValueOnce(new SetupWriteError('setup_conflict'));
  await invoke();
  expect(deps.reopen).toHaveBeenCalledWith(
    'execute',
    expect.objectContaining({ sha }),
    'setup_conflict',
  );
  expect(deps.complete).not.toHaveBeenCalled();
});

test('permission loss after render stops before the writer starts', async () => {
  const cache = new Map<string, unknown>();
  deps.release.mockImplementationOnce(async () => {
    deps.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
    return release;
  });
  await expect(invoke(cache)).rejects.toThrow('Setup unavailable');
  expect(cache.has('render')).toBe(true);
  expect(deps.write).not.toHaveBeenCalled();
});

test('a changed pinned release or corrupted stored file cannot reach the writer', async () => {
  deps.release.mockResolvedValueOnce({ ...release, revision: 'd'.repeat(40) });
  await expect(invoke()).rejects.toThrow('Setup rendering failed');
  plan.files[0].hash = sha256('different');
  await expect(invoke()).rejects.toThrow('Setup rendering failed');
  expect(deps.write).not.toHaveBeenCalled();
});

test('an old proposal generation cannot execute or fail the renewed setup', async () => {
  await invoke(new Map(), '2026-09-15T00:00:00.000Z');
  expect(deps.begin).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
  expect(deps.fail).not.toHaveBeenCalled();
});

test('an execute event without a proposal generation cannot start work', async () => {
  const handler = (
    executeFieldnoteSetupFunction as unknown as { handler: (context: unknown) => Promise<unknown> }
  ).handler;
  await expect(
    handler({
      event: { data: { runId: 'execute' } },
      step: { run: (_name: string, work: () => Promise<unknown>) => work() },
    }),
  ).rejects.toThrow();
  expect(deps.begin).not.toHaveBeenCalled();
});

test('renewed execution generations are queued by run identity rather than dropped while an earlier invocation finishes', () => {
  const { options } = executeFieldnoteSetupFunction as unknown as {
    options: Record<string, unknown>;
  };
  expect(options.singleton).toBeUndefined();
  expect(options.concurrency).toEqual({ limit: 1, key: 'event.data.runId' });
});

test('temporary permission lookup failure preserves the execute for retry', async () => {
  deps.permissions.mockRejectedValueOnce(new Error('private provider timeout'));
  const cache = new Map<string, unknown>();
  await expect(invoke(cache)).rejects.toMatchObject({ code: 'github_unavailable' });
  expect(deps.fail).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
  expect(run.state).toBe('queued');
  await invoke(cache);
  expect(run.state).toBe('complete');
  expect(deps.record).toHaveBeenCalledTimes(1);
});

test('a transient per-mutation permission lookup retries with the real writer and adopts its partial branch', async () => {
  const { writeAuthoredPullRequest } = await vi.importActual<
    typeof import('../../github/write-authored-pr')
  >('../../github/write-authored-pr');
  const github = authoredPrClient(sha);
  deps.client.mockResolvedValue({ repo: { owner: 'octo', name: 'repo' }, client: github.client });
  deps.write.mockImplementation(writeAuthoredPullRequest);
  const createRef = github.api.git.createRef.getMockImplementation()!;
  github.api.git.createRef.mockImplementationOnce(async (args) => {
    const result = await createRef(args);
    deps.permissions.mockRejectedValueOnce(new Error('private provider timeout'));
    return result;
  });
  const cache = new Map<string, unknown>();
  await expect(invoke(cache)).rejects.toMatchObject({ code: 'github_unavailable' });
  expect(deps.fail).not.toHaveBeenCalled();
  expect(run.state).toBe('running');
  expect(github.api.pulls.create).not.toHaveBeenCalled();
  await invoke(cache);
  expect(run.state).toBe('complete');
  expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
  expect(github.api.git.createRef).toHaveBeenCalledTimes(1);
  expect(github.api.pulls.create).toHaveBeenCalledTimes(1);
  expect(deps.record).toHaveBeenCalledWith(
    expect.objectContaining({ number: 42, headSha: github.prs[0].head.sha }),
  );
});

test('the real writer recovers a PR after a persistence failure and default movement', async () => {
  const { writeAuthoredPullRequest } = await vi.importActual<
    typeof import('../../github/write-authored-pr')
  >('../../github/write-authored-pr');
  const github = authoredPrClient(sha);
  deps.client.mockResolvedValue({ repo: { owner: 'octo', name: 'repo' }, client: github.client });
  deps.write.mockImplementation(writeAuthoredPullRequest);
  deps.record.mockRejectedValueOnce(new Error('private database outage'));
  const cache = new Map<string, unknown>();
  await expect(invoke(cache)).rejects.toThrow('Setup pull request failed');
  const head = github.prs[0].head.sha;
  github.moveDefault('d'.repeat(40));
  await invoke(cache);
  expect(deps.reopen).not.toHaveBeenCalled();
  expect(deps.record).toHaveBeenLastCalledWith(
    expect.objectContaining({ number: 42, headSha: head }),
  );
  expect(run.state).toBe('complete');
  expect(github.api.git.createCommit).toHaveBeenCalledTimes(1);
  expect(github.api.pulls.create).toHaveBeenCalledTimes(1);
});

test('confirmed write denial at the real writer mutation boundary remains terminal', async () => {
  const { writeAuthoredPullRequest } = await vi.importActual<
    typeof import('../../github/write-authored-pr')
  >('../../github/write-authored-pr');
  const github = authoredPrClient(sha);
  deps.client.mockResolvedValue({ repo: { owner: 'octo', name: 'repo' }, client: github.client });
  deps.write.mockImplementation(writeAuthoredPullRequest);
  const createRef = github.api.git.createRef.getMockImplementation()!;
  github.api.git.createRef.mockImplementationOnce(async (args) => {
    const result = await createRef(args);
    deps.permissions.mockResolvedValue({ contents: 'read', pullRequests: 'read' });
    return result;
  });
  await expect(invoke()).rejects.toMatchObject({ name: 'NonRetriableError' });
  expect(deps.fail).toHaveBeenCalledWith('execute', 'access_revoked');
  expect(github.api.pulls.create).not.toHaveBeenCalled();
});

test('exhausted retries fail the matching generation without another unavailable permission lookup', async () => {
  deps.permissions.mockRejectedValue(new Error('private provider outage'));
  const { options } = executeFieldnoteSetupFunction as unknown as {
    options: { onFailure: (context: unknown) => Promise<unknown> };
  };
  await options.onFailure({
    event: {
      data: {
        event: { data: { runId: 'execute', proposalUpdatedAt: '2026-09-16T00:00:00.000Z' } },
      },
    },
  });
  expect(deps.fail).toHaveBeenCalledWith('execute', 'setup_failed');
  expect(deps.permissions).not.toHaveBeenCalled();
});
