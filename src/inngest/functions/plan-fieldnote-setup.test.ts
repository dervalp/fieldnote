import { beforeEach, expect, test, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  load: vi.fn(),
  validate: vi.fn(),
  begin: vi.fn(),
  fail: vi.fn(),
  pinSha: vi.fn(),
  sha: vi.fn(),
  latest: vi.fn(),
  read: vi.fn(),
  collect: vi.fn(),
  saveSnapshot: vi.fn(),
  author: vi.fn(),
  saveResult: vi.fn(),
}));
vi.mock('../../db/queries/authoring-runs', () => ({
  validateAuthoringRun: deps.validate,
  beginAuthoring: deps.begin,
  failAuthoringRun: deps.fail,
  pinAuthoringSha: deps.pinSha,
}));
vi.mock('../../db/queries/fieldnote-setup', () => ({
  loadSetupPlan: deps.load,
  saveSetupSnapshot: deps.saveSnapshot,
  saveSetupResult: deps.saveResult,
}));
vi.mock('../../github/collect-files', () => ({ resolveHeadSha: deps.sha }));
vi.mock('../../github/collect-fieldnote-setup', () => ({ collectFieldnoteSetup: deps.collect }));
vi.mock('../../fieldnote-skills/github-release', () => ({
  latestSkillsRelease: deps.latest,
  readSkillsRelease: deps.read,
}));
vi.mock('../../authoring/setup-author', () => ({ authorSetupProfile: deps.author }));
vi.mock('../../authoring/e2b-sandbox', () => ({ e2bAuthoringSandbox: vi.fn() }));
vi.mock('../../lib/env', () => ({ authoringEnv: () => null }));
// Capture our registered orchestration, without invoking Inngest or providers.
vi.mock('../client', () => ({
  inngest: { createFunction: (options: unknown, handler: unknown) => ({ options, handler }) },
}));
import { planFieldnoteSetupFunction } from './plan-fieldnote-setup';

const sha = 'a'.repeat(40);
const release = {
  release: 'skills-v0.1.0',
  revision: 'b'.repeat(40),
  releaseLockHash: `sha256:${'c'.repeat(64)}`,
  skills: [
    {
      name: 'fieldnote-setup-profile',
      version: '1',
      files: [{ path: 'SKILL.md', content: 'trusted setup', hash: `sha256:${'d'.repeat(64)}` }],
    },
  ],
};
const snapshot = {
  sha,
  complete: true,
  paths: ['AGENTS.md'],
  documents: [{ path: 'AGENTS.md', blobSha: sha, text: 'private repository content' }],
  candidates: [
    {
      agent: 'codex',
      label: 'Codex',
      supported: true,
      confirmed: false,
      evidence: [{ source: 'path', value: 'AGENTS.md' }],
    },
  ],
};
let plan: {
  run: Record<string, unknown>;
  proposal: Record<string, unknown> | null;
  notes: Array<Record<string, unknown>>;
  files: unknown[];
};
beforeEach(() => {
  vi.resetAllMocks();
  plan = {
    run: {
      id: 'run',
      repositoryId: 'repo',
      kind: 'plan',
      workflow: 'fieldnote-setup',
      state: 'queued',
      sha: null,
    },
    proposal: null,
    notes: [],
    files: [],
  };
  deps.load.mockImplementation(async () => structuredClone(plan));
  deps.begin.mockImplementation(async () => {
    plan.run.state = 'running';
    return plan.run;
  });
  deps.latest.mockResolvedValue(release);
  deps.read.mockResolvedValue(release);
  deps.sha.mockResolvedValue(sha);
  deps.pinSha.mockImplementation(async (_id, value) => {
    plan.run.sha = value;
    return value;
  });
  deps.collect.mockResolvedValue(snapshot);
  deps.saveSnapshot.mockImplementation(async () => {
    plan.proposal = {
      state: 'exploring',
      detectedAgents: snapshot.candidates,
      confirmedAgents: null,
    };
  });
  deps.author.mockImplementation(async () => {
    expect(plan.proposal?.detectedAgents).toEqual(snapshot.candidates);
    return {
      state: 'awaiting-input',
      findings: ['Found Codex'],
      confirmedFacts: [],
      nextQuestion: { key: 'agents', text: 'Confirm Codex?', evidence: ['AGENTS.md'] },
      confirmedAgents: [],
      files: [],
      sandboxId: 'local',
      model: 'local',
    };
  });
  deps.saveResult.mockImplementation(async () => {
    plan.proposal!.state = 'awaiting-input';
  });
});

async function invoke(cache = new Map<string, unknown>()) {
  const outputs: unknown[] = [];
  const handler = (
    planFieldnoteSetupFunction as unknown as { handler: (context: unknown) => Promise<unknown> }
  ).handler;
  await handler({
    event: { data: { runId: 'run' } },
    step: {
      run: async (name: string, work: () => Promise<unknown>) => {
        if (!cache.has(name)) cache.set(name, await work());
        outputs.push(cache.get(name));
        return cache.get(name);
      },
    },
  });
  return { cache, outputs };
}

test('pins once, persists candidates before authoring, and emits no repository documents in stable steps', async () => {
  const { cache, outputs } = await invoke();
  expect([...cache.keys()]).toEqual(['begin', 'pin-release', 'pin-commit', 'collect', 'explore']);
  expect(deps.saveResult).toHaveBeenCalledWith(
    'run',
    expect.objectContaining({ state: 'awaiting-input' }),
    null,
  );
  expect(JSON.stringify(outputs)).not.toContain('private repository content');
  await invoke(cache);
  await invoke();
  expect(deps.latest).toHaveBeenCalledTimes(1);
  expect(deps.sha).toHaveBeenCalledTimes(1);
  expect(deps.author).toHaveBeenCalledTimes(1);
});

test('revoked access fails safely before release, repository, or model reads', async () => {
  deps.validate.mockRejectedValue(new Error('secret token'));
  await expect(invoke()).rejects.toThrow('Setup unavailable');
  expect(deps.fail).toHaveBeenCalledWith('run', 'access_revoked');
  expect(deps.latest).not.toHaveBeenCalled();
  expect(deps.collect).not.toHaveBeenCalled();
});

test('provider failures are sanitized before entering step logs', async () => {
  deps.latest.mockRejectedValue(new Error('secret token'));
  await expect(invoke()).rejects.toThrow('Setup release resolution failed');
});

test('does not restart completed setup runs', async () => {
  plan.run.state = 'complete';
  await invoke();
  expect(deps.begin).not.toHaveBeenCalled();
  expect(deps.latest).not.toHaveBeenCalled();
});
