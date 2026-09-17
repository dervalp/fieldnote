import { beforeEach, expect, test, vi } from 'vitest';
import { renderInstallation } from '../domain/fieldnote-skills/render';
import { sha256, type InstallationLock } from '../domain/fieldnote-skills/lock';
import type { ConfirmedAgent, SkillsRelease } from '../domain/fieldnote-skills/types';
import { requiredProfileFacts } from '../domain/fieldnote-skills/profile-facts';
const deps = vi.hoisted(() => ({ repository: vi.fn() }));
vi.mock('./repositories', () => ({ repositoryClient: deps.repository }));
import {
  collectInstallationSnapshot,
  verifyFieldnoteInstallation,
} from './verify-fieldnote-installation';

const sha = 'a'.repeat(40);
const release: SkillsRelease = {
  release: 'skills-v0.1.0',
  revision: 'b'.repeat(40),
  releaseLockHash: sha256('release'),
  skills: ['plan', 'verify'].map((name) => ({
    name,
    version: '0.1.0',
    files: [{ path: 'SKILL.md', content: `# ${name}`, hash: sha256(`# ${name}`) }],
  })),
};
const agents: ConfirmedAgent[] = [
  { agent: 'codex', supported: true, skillsRoot: '.agents/skills' },
  { agent: 'claude-code', supported: true, skillsRoot: '.claude/skills' },
  { agent: 'cursor', supported: false, skillsRoot: null },
];
const profile = requiredProfileFacts
  .map((key) => {
    const [section, name] = key.split('.');
    return `## ${section}\n- **${name}** — explicit`;
  })
  .join('\n');
const configuration = [
  { path: '.fieldnote/profile.md', content: profile },
  { path: '.fieldnote/definition-of-done.md', content: '# Done' },
  { path: '.fieldnote/concerns/shared.md', content: '# Concerns' },
];
const expected = {
  setupRunId: 'run',
  agents,
  configurationPaths: configuration.map((file) => file.path),
};
const lockPath = '.fieldnote/skills.lock.json';
let files: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  files = new Map(renderInstallation({ release, setupRunId: 'run', agents, configuration }).files);
});
const verify = (latest = release.release) =>
  verifyFieldnoteInstallation({ commitSha: sha, complete: true, files }, release, {
    ...expected,
    latest,
  });
function alterLock(change: (lock: InstallationLock) => void) {
  const lock = JSON.parse(files.get(lockPath)!);
  change(lock);
  files.set(lockPath, JSON.stringify(lock));
}
test('validates every supported target while recording the unsupported confirmation', () => {
  expect(verify()).toMatchObject({
    state: 'current',
    release: 'skills-v0.1.0',
    agents,
    commitSha: sha,
    reasons: [],
  });
});
test('validates an older release before classifying it as outdated', () => {
  expect(verify('skills-v0.2.0').state).toBe('outdated');
  files.set('.agents/skills/plan/SKILL.md', 'changed');
  expect(verify('skills-v0.2.0').state).toBe('drifted');
});
test.each(['missing', 'malformed'])('%s lock is partial', (kind) => {
  if (kind === 'missing') files.delete(lockPath);
  else files.set(lockPath, 'source-private invalid');
  expect(verify().state).toBe('partial');
  expect(JSON.stringify(verify())).not.toContain('source-private');
});
test.each(['target', 'skill', 'file', 'configuration'])(
  'a missing %s cannot appear installed',
  (kind) => {
    if (kind === 'target')
      alterLock((lock) => {
        lock.agents.pop();
        lock.files = lock.files.filter(
          (file: { path: string }) => !file.path.startsWith('.claude/'),
        );
      });
    if (kind === 'skill')
      alterLock((lock) => {
        lock.skills.pop();
        lock.files = lock.files.filter((file: { path: string }) => !file.path.includes('/verify/'));
      });
    if (kind === 'file') files.delete('.agents/skills/plan/SKILL.md');
    if (kind === 'configuration') files.delete('.fieldnote/definition-of-done.md');
    expect(verify().state).toBe('partial');
  },
);
test.each(['revision', 'releaseLockHash', 'setupRunId', 'release'])(
  'rejects mismatched %s identity',
  (key) => {
    alterLock((lock) => {
      Object.assign(lock, {
        [key]:
          key === 'revision'
            ? 'c'.repeat(40)
            : key === 'releaseLockHash'
              ? sha256('other')
              : 'other',
      });
    });
    expect(verify().state).toBe('partial');
  },
);
test('matching locally rewritten hashes cannot authorize changed generic skills', () => {
  files.set('.agents/skills/plan/SKILL.md', 'changed');
  alterLock((lock) => {
    const file = lock.files.find(
      (file: { path: string }) => file.path === '.agents/skills/plan/SKILL.md',
    )!;
    file.hash = file.sourceHash = sha256('changed');
  });
  expect(verify().state).toBe('partial');
});
test.each([
  '# Empty profile',
  profile.replace('explicit', 'TBD'),
  `${profile}\n## Tracker\n- **kind** — duplicate`,
])('rejects incomplete or duplicate profile facts', (content) => {
  files.set('.fieldnote/profile.md', content);
  expect(verify().state).toBe('partial');
});
test('an incomplete collection is retryable, never a partial installation observation', () => {
  expect(() =>
    verifyFieldnoteInstallation({ commitSha: sha, complete: false, files }, release, {
      ...expected,
      latest: release.release,
    }),
  ).toThrow('Installation scan incomplete');
});

function provider(
  options: {
    visible?: boolean;
    blob?: Buffer;
    mode?: string;
    compareMissing?: boolean;
    truncated?: boolean;
  } = {},
) {
  const reads: string[] = [];
  const trees = new Map<
    string,
    Array<{ path: string; sha: string; type: string; mode: string; size?: number }>
  >();
  for (const [path, content] of files) {
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/') || 'root';
      const full = parts.slice(0, index + 1).join('/');
      const tree = trees.get(parent) ?? [];
      if (!tree.some((entry) => entry.path === parts[index]))
        tree.push({
          path: parts[index],
          sha: full,
          type: index === parts.length - 1 ? 'blob' : 'tree',
          mode: index === parts.length - 1 ? (options.mode ?? '100644') : '040000',
          size: options.blob?.length ?? Buffer.byteLength(content),
        });
      trees.set(parent, tree);
    }
  }
  deps.repository.mockResolvedValue({
    repo: { owner: 'o', name: 'r' },
    client: {
      rest: {
        repos: {
          get: async () => ({ data: { default_branch: 'fresh-default' } }),
          compareCommits: async () => {
            if (options.compareMissing) throw { status: 404 };
            return { data: { status: options.visible === false ? 'diverged' : 'ahead' } };
          },
        },
        pulls: { get: async () => ({ data: { merged: true, merge_commit_sha: 'c'.repeat(40) } }) },
        git: {
          getRef: async (input: { ref: string }) => {
            expect(input.ref).toBe('heads/fresh-default');
            return { data: { object: { sha } } };
          },
          getCommit: async () => ({ data: { tree: { sha: 'root' } } }),
          getTree: async ({ tree_sha }: { tree_sha: string }) => ({
            data: { truncated: options.truncated ?? false, tree: trees.get(tree_sha) ?? [] },
          }),
          getBlob: async ({ file_sha }: { file_sha: string }) => {
            reads.push(file_sha);
            const bytes = options.blob ?? Buffer.from(files.get(file_sha)!);
            return {
              data: { encoding: 'base64', size: bytes.length, content: bytes.toString('base64') },
            };
          },
        },
      },
    },
  });
  return reads;
}
const collect = () => collectInstallationSnapshot('repo', 42, expected.configurationPaths);
test('pins fresh default head and fetches the lock before only declared installation files', async () => {
  files.set('src/private.ts', 'private source');
  const reads = provider();
  const result = await collect();
  expect(result.commitSha).toBe(sha);
  expect(reads[0]).toBe(lockPath);
  expect(reads).not.toContain('src/private.ts');
  expect(result.files.has('.claude/skills/verify/SKILL.md')).toBe(true);
});
test('retries an invisible merge without fetching files', async () => {
  const reads = provider({ visible: false });
  await expect(collect()).rejects.toMatchObject({ code: 'merge_not_visible', retryable: true });
  expect(reads).toEqual([]);
});
test.each(['../private', 'src/private.ts', '.fieldnote/.env'])(
  'never fetches unsafe lock path %s',
  async (path) => {
    alterLock((lock) => {
      lock.files.push({ path, hash: sha256('x'), sourceHash: sha256('x') });
    });
    const reads = provider();
    const result = await collect();
    expect(reads).toEqual([lockPath]);
    expect(
      verifyFieldnoteInstallation(result, release, { ...expected, latest: release.release }).state,
    ).toBe('partial');
  },
);
test.each([Buffer.from([0xff]), Buffer.alloc(256 * 1024 + 1, 65), Buffer.from([0])])(
  'incomplete byte scans never return an observation',
  async (blob) => {
    provider({ blob });
    await expect(collect()).rejects.toMatchObject({ code: 'scan_incomplete' });
  },
);
test('symlinks cannot count as installed regular files', async () => {
  provider({ mode: '120000' });
  expect(
    verifyFieldnoteInstallation(await collect(), release, { ...expected, latest: release.release })
      .state,
  ).toBe('partial');
});
test('provider details are removed from retryable errors', async () => {
  deps.repository.mockRejectedValue(new Error('private token source'));
  await expect(collect()).rejects.toMatchObject({
    message: 'Installation verification temporarily unavailable',
    retryable: true,
  });
});
test('merge comparison propagation failures remain retryable', async () => {
  provider({ compareMissing: true });
  await expect(collect()).rejects.toMatchObject({ code: 'merge_not_visible', retryable: true });
});
test('truncated tree metadata cannot produce a partial installation', async () => {
  provider({ truncated: true });
  await expect(collect()).rejects.toMatchObject({ code: 'scan_incomplete' });
});
test('preserves a UTF-8 byte order mark in committed files for exact hash validation', async () => {
  files.set('.agents/skills/plan/SKILL.md', '\ufeff# plan');
  provider();
  expect((await collect()).files.get('.agents/skills/plan/SKILL.md')).toBe('\ufeff# plan');
});
