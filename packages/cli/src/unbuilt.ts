// The commands fieldnote names but has not written yet.
//
// They are listed rather than hidden, and they live here rather than in
// help.ts so that the listing and the answer come from one place. A command
// that help advertises and the dispatch answers with "Unknown command" is
// worse than one nobody mentions — and that drift is exactly what two copies
// of this list would produce the first time one of them was edited.
export const REPOSITORY = 'https://github.com/dervalp/fieldnote';

export type Unbuilt = {
  command: string;
  group: 'GRADERS' | 'AGENTS';
  summary: string;
  detail: string[];
};

export const UNBUILT: readonly Unbuilt[] = [
  {
    command: 'publish',
    group: 'GRADERS',
    summary: 'publish a grader to the registry',
    detail: [
      'A grader is a manifest and a set of grader checks. Publishing one',
      'means anybody can grade against it and get the same answer you did.',
      'The registry is specified and unbuilt.',
    ],
  },
  {
    command: 'add',
    group: 'GRADERS',
    summary: 'install a grader from the registry',
    detail: [
      'Run someone else’s grader against your repository, pinned to a',
      'version so the score means the same thing next week.',
    ],
  },
  {
    command: 'update',
    group: 'GRADERS',
    summary: 'update an installed grader',
    detail: [
      'Move a pinned grader to a newer version, and say what changed about',
      'the score before it changes.',
    ],
  },
  {
    command: 'mcp',
    group: 'AGENTS',
    summary: 'serve fieldnote over MCP',
    detail: [
      'One stdio server, started by your coding agent, answering three',
      'questions from this repository’s own record.',
    ],
  },
];

export const NOT_BUILT_YET = 'not built yet';

export function unbuiltCommand(name: string): Unbuilt | undefined {
  return UNBUILT.find((entry) => entry.command === name);
}

// Printed when someone types one of them. It names what the command will do
// before inviting the reader to build it: an invitation with no description
// attached is a dead end wearing a friendly face.
export function notBuiltYet(command: string): string {
  const entry = unbuiltCommand(command);
  if (!entry) return '';
  return [
    `  fieldnote ${entry.command} — ${NOT_BUILT_YET}`,
    '',
    `  ${entry.summary}.`,
    '',
    ...entry.detail.map((line) => `  ${line}`),
    '',
    `  Come and contribute: ${REPOSITORY}`,
  ].join('\n');
}
