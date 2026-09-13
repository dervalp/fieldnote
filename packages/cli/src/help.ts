import { cliVersion } from './version.ts';

// Four groups, not one list. A developer looking for "how do I score this
// repo" reads one group and stops. Commands that are not built are listed
// rather than hidden — a roadmap readable from the terminal beats a hidden
// one — but a command that exists and fails is worse than one that does not,
// so only `mcp` appears, and only because its placeholder is honest.
export function helpText(): string {
  return [
    `  fieldnote ${cliVersion()} — grade what your agents work in`,
    '',
    '  USAGE',
    '    fieldnote <command> [options]',
    '',
    '  GRADING',
    '    run [grader]        grade this repository at HEAD',
    '',
    '  GRADERS',
    '    graders             list graders available to this workspace',
    '',
    '  ACCOUNT',
    '    login               sign in through your browser',
    '    logout              revoke this machine',
    '    whoami              who this machine is signed in as',
    '',
    '  AGENTS',
    '    mcp                 serve fieldnote over MCP       coming soon',
    '',
    '  OPTIONS',
    // --sha does not choose the commit that gets graded: requestGrade neither
    // accepts nor stores a sha, and the collection worker pins the
    // repository's default branch head. Saying "grade this commit" promised
    // something the system does not do.
    '    --sha <sha>         bypass the work-in-progress guard; fieldnote still grades',
    '                        the default branch head',
    '    --min <score>       exit 1 if the grade scores below this threshold',
    '    --json              one object: the result, an "error" key, or a result carrying one',
    '    --version           print the version and exit',
    '',
    '  Exit codes: 0 success · 1 below threshold · 2 could not grade · 3 signed out',
  ].join('\n');
}
