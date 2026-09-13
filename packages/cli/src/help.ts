import { cliVersion } from './version.ts';
import { NOT_BUILT_YET, REPOSITORY, UNBUILT, type Unbuilt } from './unbuilt.ts';

const COMMAND_WIDTH = 20;

// Rows for one group, built from the one list of unbuilt commands rather than
// retyped here. The marker column is measured across every row so the help
// lines up whatever gets added to that list next.
const SUMMARY_WIDTH = Math.max(...UNBUILT.map((entry) => entry.summary.length)) + 2;

function unbuiltRows(group: Unbuilt['group']): string[] {
  return UNBUILT.filter((entry) => entry.group === group).map(
    (entry) =>
      `    ${entry.command.padEnd(COMMAND_WIDTH)}${entry.summary.padEnd(SUMMARY_WIDTH)}${NOT_BUILT_YET}`,
  );
}

// Four groups, not one list. A developer looking for "how do I score this
// repo" reads one group and stops. Commands that are not built are listed
// rather than hidden — a roadmap readable from the terminal beats a hidden
// one — and every one of them answers for itself when typed, so the listing
// never promises something the dispatch then denies.
export function helpText(): string {
  return [
    `  fieldnote ${cliVersion()} — grade what your agents work in`,
    `  work in progress · come and contribute: ${REPOSITORY}`,
    '',
    '  USAGE',
    '    fieldnote <command> [options]',
    '',
    '  GRADING',
    '    run [grader]        grade this repository at HEAD',
    '',
    '  GRADERS',
    '    graders             list graders available to this workspace',
    ...unbuiltRows('GRADERS'),
    '',
    '  ACCOUNT',
    '    login               sign in through your browser',
    '    logout              revoke this machine',
    '    whoami              who this machine is signed in as',
    '',
    '  AGENTS',
    ...unbuiltRows('AGENTS'),
    '',
    '  OPTIONS',
    '    --sha <sha>         bypass the work-in-progress guard; fieldnote still grades',
    '                        the default branch head',
    '    --min <score>       exit 1 if the grade scores below this threshold',
    '    --json              one object: the result, an "error" key, or a result carrying one',
    '    --version           print the version and exit',
    '',
    '  Exit codes: 0 success · 1 below threshold · 2 could not grade · 3 signed out',
  ].join('\n');
}
