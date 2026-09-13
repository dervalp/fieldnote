import { registerGrader } from '../registry';

export const AGENT_READINESS = 'fieldnote/agent-readiness';

// fieldnote's own grader, and an ordinary one. It gets no private interface,
// no extra evidence and no code path of its own — which is the only way to
// find out whether the contract is any good before strangers depend on it.
//
// The five checks port exactly from the compiled-in evaluator: same ids, same
// order, same 20 points each, same explanations. The card tagline is new: the
// six per-finish flavour lines this grader used to supply are a deliberate
// loss, recorded in the design. Do not smuggle them back in as a special case.
export const agentReadinessManifest = registerGrader({
  id: AGENT_READINESS,
  version: '0.1.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository',
  mode: 'deterministic',
  category: 'agent-readiness',
  kind: 'declarative',
  needs: {
    'repo.files': ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/**/*.{md,markdown}'],
  },
  disclaimer: 'This file and documentation evidence is not semantic quality certification.',
  card: {
    tagline: 'Can an agent work in this repository at all?',
    groups: [
      { title: 'Instructions', checks: ['root-agent-instructions', 'root-readme'] },
      {
        title: 'Documented commands',
        checks: ['docs-markdown', 'documented-setup', 'documented-tests'],
      },
    ],
  },
  checks: [
    {
      id: 'root-agent-instructions',
      title: 'Agent instructions',
      points: 20,
      explain: {
        pass: 'Found root agent instructions.',
        fail: 'No nonempty root AGENTS.md or CLAUDE.md was found.',
      },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['AGENTS.md', 'CLAUDE.md'] },
    },
    {
      id: 'root-readme',
      title: 'Project documentation',
      points: 20,
      explain: {
        pass: 'Found a root README.md.',
        fail: 'No nonempty root README.md was found.',
      },
      primitive: 'file-exists',
      args: { root: true, nonempty: true, anyOf: ['README.md'], caseInsensitive: true },
    },
    {
      id: 'docs-markdown',
      title: 'Documentation',
      points: 20,
      explain: {
        pass: 'Found Markdown documentation beneath docs/.',
        fail: 'No nonempty Markdown documentation beneath docs/ was found.',
      },
      primitive: 'glob-count',
      args: { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true, nonempty: true, min: 1 },
    },
    // The scope order is load-bearing: the compiled-in evaluator scanned
    // READMEs, then root agent instructions, then docs, and that order is what
    // a reader of the evidence list sees.
    {
      id: 'documented-setup',
      title: 'Setup instructions',
      points: 20,
      explain: {
        pass: 'Found documented setup commands.',
        fail: 'No documented setup commands were found.',
      },
      primitive: 'heading-has-fence',
      args: {
        headings: ['setup', 'install', 'installation', 'getting started'],
        scope: [
          { pattern: 'README.md', caseInsensitive: true },
          { pattern: '{AGENTS,CLAUDE}.md' },
          { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true },
        ],
      },
    },
    {
      id: 'documented-tests',
      title: 'Validation commands',
      points: 20,
      explain: {
        pass: 'Found documented test commands.',
        fail: 'No documented test commands were found.',
      },
      primitive: 'heading-has-fence',
      args: {
        headings: ['test', 'testing', 'validation', 'verification', 'checks'],
        scope: [
          { pattern: 'README.md', caseInsensitive: true },
          { pattern: '{AGENTS,CLAUDE}.md' },
          { pattern: 'docs/**/*.{md,markdown}', caseInsensitive: true },
        ],
      },
    },
  ],
});
