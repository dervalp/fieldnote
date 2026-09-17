import { expect, test } from 'vitest';
import { authorSetupRepair, validateRepairReplacement } from './repair-setup';
import { e2bAuthoringSandbox, type AuthoringE2BSdk } from './e2b-sandbox';
const managed = new Map([
  ['.fieldnote/profile.md', 'profile  '],
  ['.agents/skills/skill/SKILL.md', 'immutable'],
  ['.fieldnote/skills.lock.json', 'generated lock'],
]);
test('repair author gets only managed map, normalized evidence and prior outcome metadata', async () => {
  let sent: unknown;
  const result = await authorSetupRepair(
    {
      run: async (input) => {
        sent = input;
        return {
          sandboxId: 'box',
          model: 'model',
          output: { generatedFiles: [{ path: '.fieldnote/profile.md', content: 'profile\n' }] },
          files: new Map([['.fieldnote/profile.md', 'profile\n']]),
        };
      },
    },
    managed,
    [
      {
        kind: 'ci',
        reference: 'check:1',
        disposition: 'actionable',
        path: '.fieldnote/profile.md',
        instruction: 'format',
      },
    ],
    [{ ordinal: 1, state: 'failed' }],
  );
  expect(result.get('.fieldnote/profile.md')).toBe('profile\n');
  expect(result.get('.agents/skills/skill/SKILL.md')).toBe('immutable');
  expect([...(sent as { files: Map<string, string> }).files.keys()]).toEqual([
    'evidence/.fieldnote/profile.md',
    'evidence/.agents/skills/skill/SKILL.md',
    'evidence/.fieldnote/skills.lock.json',
  ]);
  expect(JSON.parse((sent as { prompt: string }).prompt)).toEqual({
    evidence: [
      {
        kind: 'ci',
        reference: 'check:1',
        disposition: 'actionable',
        path: '.fieldnote/profile.md',
        instruction: 'format',
      },
    ],
    prior: [{ ordinal: 1, state: 'failed' }],
  });
});
test('replacement forbids deletion, additions, generic-skill changes, lock edits and credentials', () => {
  for (const replacement of [
    new Map(),
    new Map([...managed, ['README.md', 'new']]),
    new Map([...managed, ['.agents/skills/skill/SKILL.md', 'changed']]),
    new Map([...managed, ['.fieldnote/skills.lock.json', 'changed']]),
    new Map([...managed, ['.fieldnote/profile.md', 'password = actual-literal']]),
  ])
    expect(() => validateRepairReplacement(managed, replacement)).toThrow();
});
test('formatting cannot change whitespace inside a command or confirmed value', () => {
  const original = new Map([['.fieldnote/profile.md', '## Commands\n- **check** — pnpm test\n']]);
  const replacement = new Map([
    ['.fieldnote/profile.md', '## Commands\n- **check** — pn pmtest\n'],
  ]);
  expect(() => validateRepairReplacement(original, replacement)).toThrow();
});
test('E2B repair uses the repair contract and accepts only configuration output without a setup conversation', async () => {
  const uploads = new Map<string, string>();
  let killed = false;
  const sdk: AuthoringE2BSdk = {
    create: async () => ({
      sandboxId: 'repair-box',
      kill: async () => {
        killed = true;
        return true;
      },
      files: {
        write: async (path, data) => {
          uploads.set(path, data);
        },
      },
      commands: {
        run: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            generatedFiles: [{ path: '.fieldnote/profile.md', content: 'profile\n' }],
          }),
          stderr: '',
        }),
      },
    }),
  };
  const sandbox = e2bAuthoringSandbox(
    { apiKey: 'fixture', anthropicApiKey: 'fixture', model: 'fixture' },
    sdk,
    'repair',
  );
  const output = await sandbox.run({
    files: new Map([['evidence/.fieldnote/profile.md', 'profile  ']]),
    prompt: '{}',
    mode: 'write-generated',
  });
  expect(output.files.get('.fieldnote/profile.md')).toBe('profile\n');
  expect(JSON.parse(uploads.get('/workspace/runtime/request.json')!).system).toContain(
    'Repair formatting',
  );
  expect(killed).toBe(true);
});
