import { expect, test } from 'vitest';
import { renderInstallation } from './render';
import { parseInstallationLock, renderInstallationLock, sha256 } from './lock';
import { supportingConfigurationDefaults } from './configuration';
import { gitBlobHash, managedDriftQuestion, hasManagedDriftApproval, questionNote } from './drift';
import { verifyFieldnoteInstallation } from '../../github/verify-fieldnote-installation';

const content = 'print("safe check")';
const release = {
  release: 'skills-v0.1.0',
  revision: 'a'.repeat(40),
  releaseLockHash: sha256('lock'),
  skills: [
    {
      name: 'fieldnote-testing',
      version: '1',
      files: [{ path: 'scripts/check.py', content, hash: sha256(content) }],
    },
  ],
};
const path = '.agents/skills/fieldnote-testing/scripts/check.py';
const installation = renderInstallation({
  release,
  setupRunId: 'old',
  agents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
  configuration: [
    { path: '.fieldnote/profile.md', content: 'Profile' },
    ...supportingConfigurationDefaults,
  ],
});
const snapshot = {
  sha: 'b'.repeat(40),
  complete: true,
  paths: ['.fieldnote/skills.lock.json'],
  candidates: [],
  documents: [
    {
      path: '.fieldnote/skills.lock.json',
      text: installation.files.get('.fieldnote/skills.lock.json')!,
      blobSha: 'lock',
    },
  ],
  managedFiles: [{ path, blobSha: gitBlobHash(content), mode: '100644', type: 'blob' }],
};
test.each(['missing', 'malformed', 'unverifiable', 'invalid-declaration'] as const)(
  '%s lock is repairable partial drift, never fresh setup or a fatal parse error',
  (kind) => {
    const files = new Map(installation.files);
    if (kind === 'missing') files.delete('.fieldnote/skills.lock.json');
    else if (kind === 'malformed')
      files.set('.fieldnote/skills.lock.json', 'private malformed lock');
    else {
      const lock = parseInstallationLock(files.get('.fieldnote/skills.lock.json')!);
      if (kind === 'unverifiable') lock.revision = 'c'.repeat(40);
      else
        lock.files.push({
          path: `.agents/skills/fieldnote-testing/${'x'.repeat(241)}`,
          hash: sha256('x'),
          sourceHash: sha256('x'),
        });
      files.set('.fieldnote/skills.lock.json', renderInstallationLock(lock));
    }
    const partial = {
      ...snapshot,
      paths: [...files.keys()],
      documents: [...files]
        .filter(([path]) => path === '.fieldnote/skills.lock.json')
        .map(([path, text]) => ({ path, text, blobSha: gitBlobHash(text) })),
    };
    expect(
      verifyFieldnoteInstallation({ complete: true, commitSha: partial.sha, files }, release, {
        setupRunId: 'old',
        agents: [{ agent: 'codex', supported: true, skillsRoot: '.agents/skills' }],
        latest: release.release,
        configurationPaths: [...files.keys()].filter(
          (path) => path.endsWith('.md') && path.startsWith('.fieldnote/'),
        ),
      }).state,
    ).toBe('partial');
    const question = managedDriftQuestion(partial, release, release)!;
    expect(question).toMatchObject({ key: 'managed-drift' });
    expect(JSON.stringify(question)).not.toContain('private malformed lock');
    expect(question.evidence.join('\n')).toContain(path);
    const note = {
      speaker: 'agent' as const,
      kind: 'question' as const,
      body: questionNote(question),
    };
    for (const answer of ['No', 'Yes', 'Maybe'])
      expect(
        hasManagedDriftApproval(
          [note, { speaker: 'human', kind: 'answer', body: answer }],
          question,
        ),
      ).toBe(false);
    const approved = [
      note,
      { speaker: 'human' as const, kind: 'answer' as const, body: 'Replace managed skills' },
    ];
    expect(hasManagedDriftApproval(approved, question)).toBe(true);
    const changedLock = managedDriftQuestion(
      {
        ...partial,
        documents: [
          {
            path: '.fieldnote/skills.lock.json',
            blobSha: 'changed',
            text: `${partial.documents[0]?.text ?? 'new malformed lock'}\n `,
          },
        ],
      },
      release,
      release,
    )!;
    expect(hasManagedDriftApproval(approved, changedLock)).toBe(false);
    for (const change of [
      { blobSha: gitBlobHash('another local change') },
      { mode: '100755' },
      { path: `${path}.moved` },
    ]) {
      const changed = managedDriftQuestion(
        { ...partial, managedFiles: [{ ...snapshot.managedFiles[0], ...change }] },
        release,
        release,
      )!;
      expect(hasManagedDriftApproval(approved, changed)).toBe(false);
    }
    expect(
      hasManagedDriftApproval(
        approved,
        managedDriftQuestion(partial, release, { ...release, release: 'skills-v0.2.0' })!,
      ),
    ).toBe(false);
  },
);
test('no lock and no managed copies remains genuinely fresh setup', () => {
  expect(
    managedDriftQuestion(
      { ...snapshot, documents: [], paths: [], managedFiles: [] },
      release,
      release,
    ),
  ).toBeNull();
});
test('unchanged installed generic bytes are not drift during a legitimate release update', () => {
  expect(
    managedDriftQuestion(snapshot, release, { ...release, release: 'skills-v0.2.0' }),
  ).toBeNull();
});
test('a changed non-document managed file has an exact reason and approval is bound to its bytes and target', () => {
  const changed = {
    ...snapshot,
    managedFiles: [{ ...snapshot.managedFiles[0], blobSha: gitBlobHash('changed') }],
  };
  const question = managedDriftQuestion(changed, release, release)!;
  expect(question.evidence.join('\n')).toContain(`Modified managed file: ${path}`);
  const notes = [
    { speaker: 'agent' as const, kind: 'question' as const, body: questionNote(question) },
    { speaker: 'human' as const, kind: 'answer' as const, body: 'Replace managed skills' },
  ];
  expect(hasManagedDriftApproval(notes, question)).toBe(true);
  for (const answer of [
    'No',
    'Yes',
    'Maybe replace managed skills',
    'Do not replace managed skills',
  ])
    expect(hasManagedDriftApproval([notes[0], { ...notes[1], body: answer }], question)).toBe(
      false,
    );
  const changedAgain = managedDriftQuestion(
    {
      ...changed,
      managedFiles: [{ ...changed.managedFiles[0], blobSha: gitBlobHash('another change') }],
    },
    release,
    release,
  )!;
  expect(hasManagedDriftApproval(notes, changedAgain)).toBe(false);
  const otherTarget = managedDriftQuestion(changed, release, {
    ...release,
    release: 'skills-v0.2.0',
  })!;
  expect(hasManagedDriftApproval(notes, otherTarget)).toBe(false);
});

test('unexpected lock-declared managed files have bounded exact reasons and cannot reuse approval after their bytes change', () => {
  const extraPath = '.agents/skills/fieldnote-extra/SKILL.md';
  const lock = parseInstallationLock(snapshot.documents[0].text);
  lock.files.push({ path: extraPath, hash: sha256('extra'), sourceHash: sha256('extra') });
  const declared = {
    ...snapshot,
    documents: [{ ...snapshot.documents[0], text: renderInstallationLock(lock) }],
    managedFiles: [
      ...snapshot.managedFiles,
      { path: extraPath, blobSha: gitBlobHash('extra'), mode: '100644', type: 'blob' },
    ],
  };
  const question = managedDriftQuestion(declared, release, release)!;
  expect(question.evidence.join('\n')).toContain(
    `Unexpected managed file declared in lock: ${extraPath}.`,
  );
  const changed = managedDriftQuestion(
    {
      ...declared,
      managedFiles: declared.managedFiles.map((file) =>
        file.path === extraPath ? { ...file, blobSha: gitBlobHash('changed extra') } : file,
      ),
    },
    release,
    release,
  )!;
  expect(
    hasManagedDriftApproval(
      [
        { speaker: 'agent', kind: 'question', body: questionNote(question) },
        { speaker: 'human', kind: 'answer', body: 'Replace managed skills' },
      ],
      changed,
    ),
  ).toBe(false);
});
