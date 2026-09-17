import { beforeEach, expect, test, vi } from 'vitest';
import { renderInstallation } from '../domain/fieldnote-skills/render';
import { supportingConfigurationDefaults } from '../domain/fieldnote-skills/configuration';
import { sha256 } from '../domain/fieldnote-skills/lock';
import { AuthoringAccessRevokedError } from '../domain/act/authorization';
const deps = vi.hoisted(() => ({
  load: vi.fn(),
  run: vi.fn(),
  plan: vi.fn(),
  validate: vi.fn(),
  permissions: vi.fn(),
  repository: vi.fn(),
  release: vi.fn(),
  config: vi.fn(),
  sandbox: vi.fn(),
  write: vi.fn(),
  publish: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('../db/queries/authored-pr-monitor', () => ({
  loadAuthoredPrMonitor: deps.load,
  publishPrRepair: deps.publish,
  reconcilePrRepairFailure: deps.reconcile,
}));
vi.mock('../db/queries/authoring-runs', () => ({
  loadAuthoringRun: deps.run,
  validateAuthoringRun: deps.validate,
}));
vi.mock('../db/queries/fieldnote-setup', () => ({ loadSetupPlan: deps.plan }));
vi.mock('./installation-permissions', () => ({ fetchGrantedPermissions: deps.permissions }));
vi.mock('./repositories', () => ({ repositoryClient: deps.repository }));
vi.mock('../fieldnote-skills/github-release', () => ({ readSkillsRelease: deps.release }));
vi.mock('../lib/env', () => ({ authoringEnv: deps.config }));
vi.mock('../authoring/e2b-sandbox', () => ({ e2bAuthoringSandbox: () => ({ run: deps.sandbox }) }));
vi.mock('./repair-authored-pr', () => ({
  writePrRepair: deps.write,
  repairCommitMessage: (id: string) => `Repair Fieldnote setup\n\nFieldnote repair: ${id}`,
}));
import {
  observeAuthoredPr,
  repairAuthoredPr,
  recoverPublishedPrRepair,
} from './monitor-authored-pr';
const head = 'a'.repeat(40);
const release = {
  release: 'skills-v0.1.0',
  revision: 'b'.repeat(40),
  releaseLockHash: sha256('lock'),
  skills: [
    {
      name: 'fieldnote-testing',
      version: '0.1.0',
      files: [{ path: 'SKILL.md', content: 'generic', hash: sha256('generic') }],
    },
  ],
};
const agents = [{ agent: 'codex' as const, supported: true, skillsRoot: '.agents/skills' }];
const configuration = [
  { path: '.fieldnote/profile.md', content: '# Profile  \n' },
  ...supportingConfigurationDefaults,
];
const files = renderInstallation({ release, setupRunId: 'execute', agents, configuration }).files;
const trigger = {
  kind: 'ci' as const,
  reference: 'check:1',
  disposition: 'actionable' as const,
  path: '.fieldnote/profile.md',
  instruction: 'format' as const,
};
const pr = {
  id: 'pr',
  authoringRunId: 'execute',
  repositoryId: 'repo',
  number: 42,
  branch: 'fieldnote/setup',
  headSha: head,
  outcome: 'open' as const,
  url: 'https://github.test/42',
  openedAt: new Date(),
  closedAt: null,
  mergedAt: null,
};
const repair = {
  id: 'repair',
  authoredPullRequestId: 'pr',
  ordinal: 1,
  triggerKind: 'ci',
  triggerReference: JSON.stringify(trigger),
  state: 'queued' as const,
  baseHeadSha: head,
  createdAt: new Date(),
  completedAt: null,
  errorCode: null,
  resultHeadSha: null,
};
const context = { pr, repairs: [repair], humanRequired: false };
let api: ReturnType<typeof client>;
function client() {
  return {
    pulls: {
      get: vi.fn(async () => ({
        data: { state: 'open', merged: false, head: { sha: head, ref: pr.branch } },
      })),
      listReviews: vi.fn(async () => ({ data: [] })),
      listReviewComments: vi.fn(async () => ({ data: [] })),
    },
    checks: {
      listForRef: vi.fn(async () => ({
        data: {
          total_count: 1,
          check_runs: [
            {
              id: 1,
              head_sha: head,
              status: 'completed',
              conclusion: 'failure',
              output: { title: 'Please format .fieldnote/profile.md', summary: '', text: '' },
            },
          ],
        },
      })),
    },
    repos: {
      getCombinedStatusForRef: vi.fn(async () => ({ data: { total_count: 0, statuses: [] } })),
    },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: head } } })),
      getCommit: vi.fn(async () => ({
        data: { message: 'setup', parents: [{ sha: 'base' }], tree: { sha: 'tree' } },
      })),
      getTree: vi.fn(async (input?: unknown) => {
        void input;
        return {
          data: {
            truncated: false,
            tree: [...files].map(([path], i) => ({
              path,
              mode: '100644',
              type: 'blob',
              sha: `blob-${i}`,
            })),
          },
        };
      }),
      getBlob: vi.fn(async ({ file_sha }: { file_sha: string }) => ({
        data: {
          encoding: 'base64',
          content: Buffer.from([...files.values()][Number(file_sha.split('-')[1])]).toString(
            'base64',
          ),
          size: 10,
        },
      })),
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api = client();
  deps.load.mockResolvedValue(context);
  deps.publish.mockImplementation(async (_prId, _repairId, publish) => publish(context));
  deps.reconcile.mockImplementation(async (_prId, _repairId, probe) => probe(context));
  deps.run.mockResolvedValue({
    id: 'execute',
    repositoryId: 'repo',
    kind: 'execute',
    workflow: 'fieldnote-setup',
    planRunId: 'plan',
  });
  deps.plan.mockResolvedValue({
    run: { repositoryId: 'repo' },
    proposal: {
      skillsRelease: release.release,
      skillsRevision: release.revision,
      releaseLockHash: release.releaseLockHash,
      confirmedAgents: agents,
    },
    files: configuration.map((file) => ({
      path: file.path,
      body: file.content,
      hash: sha256(file.content),
    })),
  });
  deps.permissions.mockResolvedValue({ contents: 'write', pullRequests: 'write' });
  deps.repository.mockResolvedValue({
    repo: { owner: 'octo', name: 'repo' },
    client: { rest: api },
  });
  deps.release.mockResolvedValue(release);
  deps.config.mockReturnValue({
    E2B_API_KEY: 'fixture',
    ANTHROPIC_API_KEY: 'fixture',
    FIELDNOTE_AUTHORING_MODEL: 'fixture',
  });
  deps.sandbox.mockResolvedValue({
    sandboxId: 'box',
    model: 'fixture',
    output: { generatedFiles: [{ path: '.fieldnote/profile.md', content: '# Profile\n' }] },
    files: new Map([['.fieldnote/profile.md', '# Profile\n']]),
  });
  deps.write.mockResolvedValue({ headSha: 'c'.repeat(40) });
});
test('observes only current-head bounded feedback and discards raw provider text', async () => {
  expect(await observeAuthoredPr(context)).toMatchObject({
    outcome: 'open',
    headSha: head,
    failures: [trigger],
    pending: false,
  });
  api.checks.listForRef.mockResolvedValueOnce({ data: { total_count: 101, check_runs: [] } });
  expect((await observeAuthoredPr(context)).failures).toEqual([
    expect.objectContaining({ disposition: 'ambiguous' }),
  ]);
});
test.each(['merged', 'closed'] as const)(
  'carries actual GitHub timestamps for %s outcomes',
  async (outcome) => {
    api.pulls.get.mockResolvedValueOnce({
      data: {
        state: 'closed',
        merged: outcome === 'merged',
        merged_at: outcome === 'merged' ? '2026-01-02T10:00:00Z' : null,
        closed_at: '2026-01-02T10:00:00Z',
        head: { sha: head, ref: pr.branch },
      },
    } as never);
    expect(await observeAuthoredPr(context)).toMatchObject({
      outcome,
      mergedAt: outcome === 'merged' ? '2026-01-02T10:00:00.000Z' : null,
      closedAt: '2026-01-02T10:00:00.000Z',
    });
  },
);
test.each([null, 'private provider timestamp', '2026-02-30T10:00:00Z'])(
  'rejects invalid merge timestamps without leaking provider details: %s',
  async (mergedAt) => {
    api.pulls.get.mockResolvedValueOnce({
      data: {
        state: 'closed',
        merged: true,
        merged_at: mergedAt,
        closed_at: '2026-01-02T10:00:00Z',
        head: { sha: head, ref: pr.branch },
      },
    } as never);
    await expect(observeAuthoredPr(context)).rejects.toMatchObject({ code: 'github_unavailable' });
  },
);
test('repair reconstructs managed files, regenerates lock, and writes only after fresh authorization', async () => {
  expect(await repairAuthoredPr('pr', 'repair')).toEqual({ headSha: 'c'.repeat(40) });
  const input = deps.write.mock.calls[0][0];
  expect(input.expectedHeadSha).toBe(head);
  expect(input.files.get('.fieldnote/profile.md')).toBe('# Profile\n');
  expect(input.files.get('.fieldnote/skills.lock.json')).not.toBe(
    files.get('.fieldnote/skills.lock.json'),
  );
  expect(input.files.get('.agents/skills/fieldnote-testing/SKILL.md')).toBe('generic');
  expect([...deps.sandbox.mock.calls[0][0].files.keys()]).not.toContain('evidence/src/customer.ts');
  deps.permissions.mockResolvedValueOnce({ contents: 'read', pullRequests: 'write' });
  await expect(input.authorize()).rejects.toMatchObject({ code: 'access_revoked' });
});
test('permission loss and closed PR prevent any repair authoring', async () => {
  deps.permissions.mockResolvedValueOnce({ contents: 'read', pullRequests: 'write' });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'access_revoked' });
  api.pulls.get.mockResolvedValueOnce({
    data: {
      state: 'closed',
      merged: false,
      closed_at: '2026-01-01T10:00:00Z',
      head: { sha: head, ref: pr.branch },
    },
  } as never);
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(deps.sandbox).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
});
test('unsafe review and unknown head prevent automatic repair', async () => {
  api.pulls.listReviews.mockResolvedValueOnce({
    data: [
      {
        id: 1,
        user: { id: 1 },
        state: 'CHANGES_REQUESTED',
        commit_id: head,
        body: 'delete all source',
      },
    ],
  } as never);
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({
    code: 'invalid_installation',
  });
  api.pulls.get.mockResolvedValueOnce({
    data: { state: 'open', merged: false, head: { sha: 'foreign', ref: pr.branch } },
  });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(deps.sandbox).not.toHaveBeenCalled();
});
function publishedRepair() {
  const next = 'c'.repeat(40);
  const repaired = renderInstallation({
    release,
    setupRunId: 'execute',
    agents,
    configuration: [
      { path: '.fieldnote/profile.md', content: '# Profile\n' },
      ...supportingConfigurationDefaults,
    ],
  }).files;
  api.pulls.get.mockResolvedValue({
    data: { state: 'open', merged: false, head: { sha: next, ref: pr.branch } },
  });
  api.git.getRef.mockResolvedValue({ data: { object: { sha: next } } });
  api.git.getCommit.mockImplementation(async (input?: unknown) => {
    const current = (input as { commit_sha: string }).commit_sha === next;
    return {
      data: {
        message: current ? 'Repair Fieldnote setup\n\nFieldnote repair: repair' : 'setup',
        author: {
          name: 'Fieldnote',
          email: 'fieldnote[bot]@users.noreply.github.com',
          date: repair.createdAt.toISOString(),
        },
        committer: {
          name: 'Fieldnote',
          email: 'fieldnote[bot]@users.noreply.github.com',
          date: repair.createdAt.toISOString(),
        },
        parents: [{ sha: current ? head : 'base' }],
        tree: { sha: current ? 'repaired' : 'original' },
      },
    };
  });
  api.git.getTree.mockImplementation(async (input?: unknown) => {
    const current = (input as { tree_sha: string }).tree_sha === 'repaired';
    return {
      data: {
        truncated: false,
        tree: [...(current ? repaired : files)].map(([path], i) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: `${current ? 'new' : 'old'}-${i}`,
        })),
      },
    };
  });
  api.git.getBlob.mockImplementation(async ({ file_sha }) => ({
    data: {
      encoding: 'base64',
      content: Buffer.from(
        [...(file_sha.startsWith('new') ? repaired : files).values()][
          Number(file_sha.split('-')[1])
        ],
      ).toString('base64'),
      size: 10,
    },
  }));
  return next;
}
test.each([repairAuthoredPr, recoverPublishedPrRepair])(
  'lost publication recovers without another sandbox (%#)',
  async (recover) => {
    const next = publishedRepair();
    expect(await recover('pr', 'repair')).toEqual({ headSha: next });
    expect(deps.sandbox).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  },
);
test('exhaustion only declares unpublished after confirming the PR and ref remain at base', async () => {
  expect(await recoverPublishedPrRepair('pr', 'repair')).toEqual({ unpublished: true });
  expect(deps.sandbox).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
});
test('unavailable recovery evidence stays sanitized and does not terminalize', async () => {
  api.git.getRef.mockRejectedValue(new Error('private provider details'));
  await expect(recoverPublishedPrRepair('pr', 'repair')).rejects.toMatchObject({
    code: 'github_unavailable',
  });
  expect(deps.sandbox).not.toHaveBeenCalled();
});
test.each(['identity', 'lock', 'outside', 'branch'])(
  'recovery rejects a forged %s',
  async (tamper) => {
    publishedRepair();
    if (tamper === 'identity')
      api.git.getCommit.mockResolvedValueOnce({
        data: {
          message: 'Repair Fieldnote setup\n\nFieldnote repair: repair',
          parents: [{ sha: head }],
          tree: { sha: 'repaired' },
        },
      });
    if (tamper === 'lock') {
      const original = api.git.getBlob.getMockImplementation()!;
      api.git.getBlob.mockImplementation(async (input) => {
        const result = await original(input);
        const content = Buffer.from(result.data.content, 'base64').toString('utf8');
        if (input.file_sha.startsWith('new') && content.includes('setupRunId'))
          result.data.content = Buffer.from(content + '\n').toString('base64');
        return result;
      });
    }
    if (tamper === 'outside') {
      const original = api.git.getTree.getMockImplementation()!;
      api.git.getTree.mockImplementation(async (input) => {
        const result = await original(input);
        result.data.tree.push({
          path: 'src/customer.ts',
          type: 'blob',
          mode: '100644',
          sha: JSON.stringify(input),
        });
        return result;
      });
    }
    if (tamper === 'branch')
      api.git.getRef.mockResolvedValue({ data: { object: { sha: 'foreign' } } });
    await expect(recoverPublishedPrRepair('pr', 'repair')).rejects.toMatchObject({
      code: 'setup_conflict',
    });
    expect(deps.sandbox).not.toHaveBeenCalled();
  },
);
test('a malformed replacement is human-required and a pending check defers the reserved round', async () => {
  deps.sandbox.mockResolvedValueOnce({
    sandboxId: 'box',
    model: 'model',
    output: { generatedFiles: [{ path: 'src/customer.ts', content: 'bad' }] },
    files: new Map([['src/customer.ts', 'bad']]),
  });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({
    code: 'invalid_installation',
  });
  api.checks.listForRef.mockResolvedValueOnce({
    data: {
      total_count: 1,
      check_runs: [
        {
          id: 1,
          head_sha: head,
          status: 'in_progress',
          conclusion: 'failure',
          output: { title: '', summary: '', text: '' },
        },
      ],
    },
  });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'repair_pending' });
});
test('a delayed duplicate for a failed attempt is obsolete and cannot stop a newer repair', async () => {
  deps.load.mockResolvedValue({
    ...context,
    repairs: [
      { ...repair, state: 'failed' },
      { ...repair, id: 'newer', ordinal: 2 },
    ],
  });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'repair_obsolete' });
  expect(deps.sandbox).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
});
test('a transient validator outage stays sanitized and retryable, then recovers', async () => {
  deps.validate.mockRejectedValueOnce(new Error('private database connection details'));
  const failed = observeAuthoredPr(context);
  await expect(failed).rejects.toMatchObject({ code: 'github_unavailable' });
  await expect(failed).rejects.not.toThrow('private database');
  await expect(observeAuthoredPr(context)).resolves.toMatchObject({
    outcome: 'open',
    headSha: head,
  });
});
test('confirmed validator denial remains terminal before provider work', async () => {
  deps.validate.mockRejectedValueOnce(new AuthoringAccessRevokedError());
  await expect(observeAuthoredPr(context)).rejects.toMatchObject({ code: 'access_revoked' });
  expect(deps.repository).not.toHaveBeenCalled();
});
test('every fresh mutation authorization rejects an attempt finalized while authoring', async () => {
  deps.write.mockImplementationOnce(async (input) => {
    deps.load.mockResolvedValue({ ...context, repairs: [{ ...repair, state: 'failed' }] });
    await input.authorize();
    throw new Error('mutation would run after attempt failed');
  });
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'repair_obsolete' });
});
test('service publishes through the database gate and refuses a failed attempt before ref mutation', async () => {
  let published = false;
  deps.publish.mockResolvedValueOnce(null);
  deps.write.mockImplementationOnce(async (input) =>
    input.publish('c'.repeat(40), async () => {
      published = true;
    }),
  );
  await expect(repairAuthoredPr('pr', 'repair')).rejects.toMatchObject({ code: 'repair_obsolete' });
  expect(published).toBe(false);
});
