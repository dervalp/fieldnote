import { beforeEach, expect, test, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  load: vi.fn(),
  validate: vi.fn(),
  append: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  collect: vi.fn(),
  author: vi.fn(),
}));
vi.mock('../db/queries/fieldnote-setup', () => ({
  loadSetupPlan: deps.load,
  appendSetupAnswer: deps.append,
  saveSetupResult: deps.save,
}));
vi.mock('../db/queries/authoring-runs', () => ({ validateAuthoringRun: deps.validate }));
vi.mock('../fieldnote-skills/github-release', () => ({ readSkillsRelease: deps.read }));
vi.mock('../github/collect-fieldnote-setup', () => ({ collectFieldnoteSetup: deps.collect }));
vi.mock('./setup-author', () => ({ authorSetupProfile: deps.author }));
vi.mock('./e2b-sandbox', () => ({ e2bAuthoringSandbox: vi.fn() }));
vi.mock('../lib/env', () => ({ authoringEnv: () => null }));
import { answerSetupPlan } from './fieldnote-setup';

const sha = 'a'.repeat(40),
  revision = 'b'.repeat(40),
  releaseLockHash = `sha256:${'c'.repeat(64)}`;
const agents = [
  { agent: 'codex', label: 'Codex', supported: true, confirmed: false, evidence: [] },
];
let plan: {
  run: Record<string, unknown>;
  proposal: Record<string, unknown>;
  notes: Array<Record<string, unknown>>;
  files: unknown[];
};
const form = (answer: string) => {
  const data = new FormData();
  data.set('answer', answer);
  data.set('questionId', 'question');
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  plan = {
    run: {
      id: 'run',
      repositoryId: 'repo',
      kind: 'plan',
      workflow: 'fieldnote-setup',
      state: 'running',
      sha,
    },
    proposal: {
      state: 'awaiting-input',
      repositorySha: sha,
      skillsRelease: 'skills-v0.1.0',
      skillsRevision: revision,
      releaseLockHash,
      detectedAgents: agents,
      confirmedAgents: null,
      confirmedFacts: [],
    },
    notes: [
      { id: 'question', speaker: 'agent', kind: 'question', body: '[agents] Confirm Codex?' },
    ],
    files: [],
  };
  deps.load.mockImplementation(async () => structuredClone(plan));
  deps.append.mockImplementation(async (_repo, _run, _question, answer, confirmedAgents) => {
    if (plan.notes.at(-1)?.kind === 'answer' && plan.notes.at(-1)?.body === answer) return 'answer';
    plan.proposal.state = 'exploring';
    plan.proposal.confirmedAgents = confirmedAgents;
    plan.notes.push({ id: 'answer', speaker: 'human', kind: 'answer', body: answer });
    return 'answer';
  });
  deps.collect.mockResolvedValue({
    sha,
    complete: true,
    paths: [],
    documents: [],
    candidates: agents,
  });
  deps.read.mockResolvedValue({
    release: 'skills-v0.1.0',
    revision,
    releaseLockHash,
    skills: [
      { name: 'fieldnote-setup-profile', files: [{ path: 'SKILL.md', content: 'trusted setup' }] },
    ],
  });
  deps.author.mockResolvedValue({
    state: 'awaiting-input',
    findings: [],
    nextQuestion: { key: 'Tracker.kind', text: 'Which tracker?', evidence: ['No tracker'] },
    confirmedAgents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
    files: [],
    model: 'local',
    sandboxId: 'local',
  });
});

test('records the human confirmation and resumes with persisted notes and pinned evidence', async () => {
  await answerSetupPlan('repo', 'run', form('Yes; Codex is correct.'));
  expect(deps.append).toHaveBeenCalledWith('repo', 'run', 'question', 'Yes; Codex is correct.', [
    { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
  ]);
  expect(deps.collect).toHaveBeenCalledWith('repo', sha);
  expect(deps.author).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      notes: expect.arrayContaining([expect.objectContaining({ body: 'Yes; Codex is correct.' })]),
      confirmedAgents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
    }),
  );
  expect(deps.save).toHaveBeenCalledWith(
    'run',
    expect.objectContaining({ state: 'awaiting-input' }),
    'answer',
  );
});

test('passes a ready result to the transactional result-and-execute persistence boundary', async () => {
  deps.author.mockResolvedValue({
    state: 'ready',
    nextQuestion: null,
    files: [{ path: '.fieldnote/profile.md', content: 'profile', hash: 'hash', kind: 'profile' }],
    findings: [],
    confirmedAgents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
  });
  await answerSetupPlan('repo', 'run', form('Yes'));
  expect(deps.save).toHaveBeenCalledWith(
    'run',
    expect.objectContaining({ state: 'ready' }),
    'answer',
  );
});

test.each(['other-repository', 'complete', 'missing-question', 'two-questions'])(
  'rejects %s before writing an answer or using providers',
  async (scenario) => {
    if (scenario === 'other-repository') plan.run.repositoryId = 'other';
    if (scenario === 'complete') plan.run.state = 'complete';
    if (scenario === 'missing-question') plan.notes = [];
    if (scenario === 'two-questions')
      plan.notes.push({ id: 'q2', speaker: 'agent', kind: 'question', body: 'Other?' });
    await expect(answerSetupPlan('repo', 'run', form('Yes'))).rejects.toThrow();
    expect(deps.append).not.toHaveBeenCalled();
    expect(deps.collect).not.toHaveBeenCalled();
  },
);

test.each(['', ' ', 'x'.repeat(16_385)])('rejects an empty or oversized answer', async (answer) => {
  await expect(answerSetupPlan('repo', 'run', form(answer))).rejects.toThrow();
  expect(deps.append).not.toHaveBeenCalled();
});

test('does not treat an ambiguous answer as agent confirmation', async () => {
  await expect(answerSetupPlan('repo', 'run', form('Maybe Codex, not sure'))).rejects.toThrow(
    'Confirm the coding agents',
  );
  expect(deps.append).not.toHaveBeenCalled();
});

test.each([null, 'stale-question'])(
  'rejects a missing or stale question identity before appending or authoring: %s',
  async (id) => {
    const data = form('Yes');
    if (id === null) data.delete('questionId');
    else data.set('questionId', id);
    await expect(answerSetupPlan('repo', 'run', data)).rejects.toThrow(
      'Setup question has changed',
    );
    expect(deps.append).not.toHaveBeenCalled();
    expect(deps.author).not.toHaveBeenCalled();
  },
);

test('the same persisted answer can resume after an author outage', async () => {
  deps.author.mockRejectedValueOnce(new Error('private provider payload'));
  await expect(answerSetupPlan('repo', 'run', form('Yes'))).rejects.toThrow(
    'Setup authoring failed',
  );
  expect(plan.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  await answerSetupPlan('repo', 'run', form('Yes'));
  expect(plan.notes.filter((note) => note.kind === 'answer')).toHaveLength(1);
  expect(deps.save).toHaveBeenCalledTimes(1);
});

test('next-turn author input includes persisted facts and pinned candidates', async () => {
  const facts = [
    { key: 'Commands.check', value: 'pnpm test', evidence: ['package.json scripts.test'] },
  ];
  plan.proposal.confirmedFacts = facts;
  deps.collect.mockResolvedValue({ sha, complete: true, paths: [], documents: [], candidates: [] });
  await answerSetupPlan('repo', 'run', form('Yes'));
  expect(deps.author).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      confirmedFacts: facts,
      snapshot: expect.objectContaining({ candidates: agents }),
    }),
  );
});

test('does not confirm every detected agent from a qualified yes', async () => {
  plan.proposal.detectedAgents = [
    ...agents,
    { agent: 'claude-code', label: 'Claude Code', supported: true, confirmed: false, evidence: [] },
  ];
  await expect(answerSetupPlan('repo', 'run', form('Yes, only Codex'))).rejects.toThrow(
    'Confirm the coding agents',
  );
  expect(deps.append).not.toHaveBeenCalled();
});

test('accepts explicit supported agents even when no agent was detected', async () => {
  plan.proposal.detectedAgents = [];
  const data = form('Use Codex');
  data.append('agents', 'codex');
  await answerSetupPlan('repo', 'run', data);
  expect(deps.append).toHaveBeenCalledWith('repo', 'run', 'question', 'Use Codex', [
    { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
  ]);
});
test('confirms an undetected unsupported agent alongside Codex without promising a native adapter', async () => {
  const data = form('Use Codex and Cursor');
  data.append('agents', 'codex');
  data.append('agents', 'cursor');
  await answerSetupPlan('repo', 'run', data);
  expect(deps.append).toHaveBeenCalledWith('repo', 'run', 'question', 'Use Codex and Cursor', [
    { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
    { agent: 'cursor', supported: false, skillsRoot: null },
  ]);
  expect(deps.author).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      confirmedAgents: [
        { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
        { agent: 'cursor', supported: false, skillsRoot: null },
      ],
    }),
  );
});

test('an agent clarification can replace an unsupported-only confirmation', async () => {
  plan.proposal.confirmedAgents = [{ agent: 'cursor', supported: false, skillsRoot: null }];
  const data = form('Use Codex');
  data.append('agents', 'codex');
  await answerSetupPlan('repo', 'run', data);
  expect(deps.append).toHaveBeenCalledWith('repo', 'run', 'question', 'Use Codex', [
    { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
  ]);
});

test('refuses changed release bytes instead of authoring with a different release', async () => {
  deps.read.mockResolvedValue({ revision: 'd'.repeat(40), releaseLockHash });
  await expect(answerSetupPlan('repo', 'run', form('Yes'))).rejects.toThrow(
    'Setup authoring failed',
  );
  expect(deps.author).not.toHaveBeenCalled();
});
