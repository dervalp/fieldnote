#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { type Env, type Stream, createOutput, shouldShowBanner } from './render.ts';
import { cliVersion } from './version.ts';
import { helpText } from './help.ts';
import { clearAuth, readAuth, writeAuth } from './config.ts';
import { awaitCallback, openBrowser } from './login.ts';
import { ApiError, exchangeCliToken, listGraders, revokeCliToken } from './api.ts';
import { gradeRun, type GradeRunOutcome } from './grade-run.ts';
import { gradeLines } from './grade-view.ts';
import { notBuiltYet, unbuiltCommand } from './unbuilt.ts';
import { TOKENS_PATH } from './urls.ts';

// --sha and --min are the only flags this dispatch reads that take a value —
// every other token that follows them is that value, not a positional or a
// separate flag, so both parsing helpers below have to agree on that.
const VALUE_FLAGS = new Set(['--sha', '--min']);

// Non-flag tokens, with a value flag's own value skipped rather than read as
// a positional. Without this, `fieldnote run --sha X` would misread X as the
// grader id — the exact bug a value-taking flag introduces that a bare
// boolean flag like --json never could.
function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

// `--name value`. A value that looks like another flag, or is empty or
// whitespace-only, is not a value — `--min ''` is not a quiet way to spell
// `--min 0`, it is the same "nothing to read" as `--min` on its own.
// Distinguishing that from a flag that was never given is what lets a caller
// tell a missing flag from a malformed one.
function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-') || value.trim() === '') return undefined;
  return value;
}

function flagGivenWithNoValue(argv: string[], name: string): boolean {
  const i = argv.indexOf(name);
  return i !== -1 && flagValue(argv, name) === undefined;
}

function baseUrl(env: Env): string {
  return env.FIELDNOTE_URL ?? 'https://fieldnote.dev';
}

// Every failure this dispatch reports is one line of human text, or one JSON
// object under --json — never both, never neither. `payload` is that JSON
// object verbatim: it always carries `error` and a human-readable `message`,
// plus whatever case-specific fields the caller has (an `errorCode`, a
// blocker's `reason`). `humanLines` is for the one case whose human rendering
// is not its message on one line — a blocker's own multi-line copy — and
// defaults to the message, prefixed the way every other line in this file is.
function fail(
  out: ReturnType<typeof createOutput>,
  json: boolean,
  exitCode: number,
  payload: { error: string; message: string } & Record<string, unknown>,
  humanLines?: string[],
): number {
  if (json) out.line(JSON.stringify(payload));
  else for (const line of humanLines ?? [`  ${payload.message}`]) out.line(line);
  return exitCode;
}

function notSignedIn(out: ReturnType<typeof createOutput>, json: boolean): number {
  return fail(out, json, 3, {
    error: 'not-signed-in',
    message: 'Not signed in. Run `fieldnote login`.',
  });
}

// A short, fixed phrase per reason, not scraped from the blocker's own
// lines: git.ts's dirty and unpushed copy both open with the same generic
// heading ("There is nothing here fieldnote can read yet.") and put the
// actual detail — which files, how many commits — several lines further in.
// Composing the message this way keeps it accurate regardless of which line
// git.ts happens to put first; `lines` below still carries the full detail.
const BLOCKED_MESSAGE: Record<'not-a-repo' | 'no-remote' | 'dirty' | 'unpushed', string> = {
  'not-a-repo': 'This is not a git repository.',
  'no-remote': 'This repository has no GitHub remote named origin.',
  dirty: 'There are uncommitted changes fieldnote cannot grade yet.',
  unpushed: 'There are commits that have not been pushed to GitHub yet.',
};

// Named once: it is printed as a line, sent as a JSON `message`, and read by
// a test that must not be pinning its own copy of the sentence.
const MIN_UNEVALUABLE = 'No score, so --min could not be evaluated.';

function reportApiError(
  out: ReturnType<typeof createOutput>,
  error: unknown,
  json: boolean,
): number {
  if (!(error instanceof ApiError)) throw error;
  return fail(out, json, error.exitCode, { error: 'api-error', message: error.message });
}

export async function run(argv: string[], stream: Stream, env: Env): Promise<number> {
  const json = argv.includes('--json');
  const out = createOutput(stream, env);
  const [command] = positionals(argv);

  if (argv.includes('--version')) {
    out.line(cliVersion());
    return 0;
  }

  if (command === undefined || argv.includes('--help') || argv.includes('-h')) {
    if (shouldShowBanner(stream, env, { json })) {
      out.banner();
      out.line('');
    }
    out.line(helpText());
    if (command === undefined) {
      out.line('');
      out.line('  fieldnote run       grade this repository');
      out.line('  fieldnote --help    everything else');
    }
    return 0;
  }

  // Every command help lists as unbuilt answers for itself, from the same
  // list help reads. A listed command that replies "Unknown command" would be
  // the worst of both: advertised and denied.
  if (unbuiltCommand(command)) {
    out.line(notBuiltYet(command));
    return 0;
  }

  if (command === 'whoami') {
    const auth = await readAuth(env);
    if (!auth) return notSignedIn(out, json);
    out.line(`  ${auth.login} · ${auth.workspace}`);
    return 0;
  }

  if (command === 'logout') {
    const base = baseUrl(env);
    const auth = await readAuth(env);
    const tokensUrl = new URL(TOKENS_PATH, base).toString();

    // Every ending of this branch goes through here, so the sentence a person
    // reads and the object a script parses can never describe different
    // events. Not fail(): all four endings are exit 0, and an `error` key
    // beside a zero exit would contradict itself.
    //
    // `signedOut`, `revoked` and `source` separate all four without anyone
    // parsing prose: nothing stored here is `source: null`, a failed revoke is
    // `source: 'file'` with `revoked: false`.
    const done = (result: {
      signedOut: boolean;
      revoked: boolean;
      source: 'env' | 'file' | null;
      message: string;
    }): number => {
      if (json) out.line(JSON.stringify({ ...result, tokensUrl }));
      else {
        out.line(`  ${result.message}`);
        // The environment case names where the token lives in its own
        // message; the other three point at the page that can revoke it.
        if (result.source !== 'env') out.line(`  Revoke the token itself at ${tokensUrl}.`);
      }
      return 0;
    };

    // A FIELDNOTE_TOKEN credential was never stored here, so there is nothing
    // on this machine to clear and nothing this machine owns to revoke. It is
    // typically one shared CI token: revoking it server-side would break every
    // other job on the box, and clearing a shadowed file while the variable is
    // still set would report a sign-out that did not happen.
    //
    // Exit 0, not 2: nothing failed. There is no stored credential here, the
    // command says so truthfully and names where the token actually lives. On
    // CI an environment-supplied token is the normal case, not an error, and a
    // cleanup step should not go red for it.
    if (auth?.source === 'env')
      return done({
        signedOut: false,
        revoked: false,
        source: 'env',
        message:
          'This machine is signed in through FIELDNOTE_TOKEN. Revoke that token where it is stored — fieldnote will not revoke a token it did not store.',
      });

    let revoked = false;
    if (auth) {
      try {
        await revokeCliToken(base, auth.token);
        revoked = true;
      } catch {
        // Best effort: clearing the local credential still happens below, and
        // the user is told honestly that the token itself may still be live.
        // revokeCliToken's own exit code and message are ignored here on
        // purpose — this branch always keeps going regardless of why the
        // revoke failed.
      }
    }
    await clearAuth();

    if (!auth)
      return done({
        signedOut: true,
        revoked: false,
        source: null,
        message: 'Signed out on this machine.',
      });
    if (revoked)
      return done({
        signedOut: true,
        revoked: true,
        source: 'file',
        message: 'Signed out on this machine. The token was revoked.',
      });
    return done({
      signedOut: true,
      revoked: false,
      source: 'file',
      message:
        'Signed out on this machine, but the token could not be revoked — it may still be live.',
    });
  }

  if (command === 'login') {
    const base = baseUrl(env);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    const userCode = randomBytes(4).toString('hex').toUpperCase();

    const pending = awaitCallback(0, state, 5 * 60_000);
    let port: number;
    try {
      ({ port } = await pending.address);
    } catch {
      out.line('');
      out.line('  Could not start the local sign-in server. Run `fieldnote login` again.');
      return 2;
    }
    const url = new URL('/cli/auth', base);
    url.searchParams.set('challenge', challenge);
    url.searchParams.set('redirect', `http://127.0.0.1:${port}`);
    url.searchParams.set('state', state);
    url.searchParams.set('code', userCode);

    out.line('');
    out.line('  Opening your browser to confirm this device.');
    out.line(`  ${url.toString()}`);
    out.line('');
    out.line(`  Confirm this code matches: ${userCode}`);
    openBrowser(url.toString());

    const result = await pending;
    if ('error' in result) {
      out.line('');
      out.line(
        result.error === 'timeout'
          ? '  Sign-in timed out. Run `fieldnote login` again.'
          : '  Sign-in could not be verified. Run `fieldnote login` again.',
      );
      return 2;
    }

    let body: { token: string; login: string; workspace: string };
    try {
      body = await exchangeCliToken(base, {
        code: result.code,
        verifier,
        label: env.HOSTNAME ?? hostname(),
      });
      await writeAuth(body);
    } catch {
      // Deliberately generic: the cause is a network or disk condition the user
      // cannot act on differently, and the response body may carry detail that
      // does not belong on a terminal. exchangeCliToken's own exit code and
      // message are ignored here on purpose — this branch always reports the
      // same thing regardless of what actually failed.
      out.line('  Sign-in failed. Run `fieldnote login` again.');
      return 2;
    }
    out.line('');
    out.line(`  Signed in as ${body.login}`);
    out.line(`  workspace   ${body.workspace}`);
    out.line('  token       ~/.fieldnote/auth.json (0600)');
    return 0;
  }

  if (command === 'graders') {
    const auth = await readAuth(env);
    if (!auth) return notSignedIn(out, json);
    try {
      const graders = await listGraders(baseUrl(env), auth.token);
      if (json) {
        out.line(JSON.stringify({ graders }));
        return 0;
      }
      if (graders.length === 0) {
        out.line('  No graders are available to this workspace.');
        return 0;
      }
      for (const grader of graders) {
        out.line(`  ${grader.id}  ${grader.version}  ${grader.mode}  ${grader.tagline}`);
      }
      return 0;
    } catch (error) {
      return reportApiError(out, error, json);
    }
  }

  if (command === 'run') {
    const auth = await readAuth(env);
    if (!auth) return notSignedIn(out, json);

    if (flagGivenWithNoValue(argv, '--sha')) {
      return fail(out, json, 2, {
        error: 'usage',
        message: '--sha requires a value: fieldnote run --sha <sha>',
      });
    }
    const sha = flagValue(argv, '--sha');

    let min: number | undefined;
    if (flagGivenWithNoValue(argv, '--min')) {
      return fail(out, json, 2, {
        error: 'usage',
        message: '--min requires a numeric value: fieldnote run --min <score>',
      });
    }
    const minRaw = flagValue(argv, '--min');
    if (minRaw !== undefined) {
      min = Number(minRaw);
      if (!Number.isFinite(min)) {
        return fail(out, json, 2, {
          error: 'usage',
          message: '--min requires a numeric value: fieldnote run --min <score>',
        });
      }
    }

    const grader = positionals(argv)[1];
    // Order is the spec's: credential, git state, blocker, request, poll,
    // render — gradeRun() owns everything from git state through the poll
    // loop; this dispatch owns the credential, the flags above, and turning
    // its outcome into lines and an exit code below.
    const progress = json ? null : out.progress();

    let outcome: GradeRunOutcome;
    try {
      outcome = await gradeRun({
        base: baseUrl(env),
        token: auth.token,
        cwd: process.cwd(),
        sha,
        grader,
        onProgress: (state) => progress?.state(state),
      });
    } catch (error) {
      progress?.done();
      return reportApiError(out, error, json);
    }
    progress?.done();

    if (outcome.kind === 'blocked') {
      return fail(
        out,
        json,
        2,
        {
          error: 'blocked',
          message: BLOCKED_MESSAGE[outcome.reason],
          reason: outcome.reason,
          lines: outcome.lines,
        },
        outcome.lines,
      );
    }

    if (outcome.kind === 'unknown-sha') {
      // git itself declined to resolve it, so the server would only refuse it
      // again half a second later, in the server's words rather than this
      // repository's.
      return fail(out, json, 2, {
        error: 'unknown-sha',
        message: `No commit ${outcome.sha} in this repository. Run \`git fetch\` if it is on the remote.`,
        sha: outcome.sha,
      });
    }

    if (outcome.kind === 'timeout') {
      return fail(out, json, 2, {
        error: 'timeout',
        message: 'The grade did not finish in time. Try again.',
      });
    }

    if (outcome.kind === 'failed') {
      // The column is nullable and nothing ties it to the failed state — say
      // what is known and no more. Never invent a reason that was not
      // recorded.
      const message = outcome.errorCode
        ? `The grade failed: ${outcome.errorCode}`
        : 'The grade failed. No reason was recorded.';
      return fail(out, json, 2, { error: 'failed', message, errorCode: outcome.errorCode });
    }

    if (outcome.kind === 'no-result') {
      return fail(out, json, 2, {
        error: 'no-result',
        message: 'The grade finished but recorded no result.',
      });
    }

    const { view } = outcome;

    // The null guard is not the question — `null < 90` is true in JS, and an
    // incomplete grade is genuinely not "below threshold", which is what exit
    // 1 means. The disposition is: a threshold that could not be evaluated is
    // not a threshold that was met, and exiting 0 would walk an ungradeable
    // repository through the CI gate --min exists to be.
    const unevaluable = min !== undefined && view.score === null;

    // The one outcome that is both a real grade and a non-zero exit, so
    // --json carries both: the whole result, because the evidence is real
    // data a wrapper should still get, plus the `error` key that makes the
    // exit code explicable to a wrapper reading .error. Still one object —
    // never the document with a second one glued to the end of it.
    if (json) {
      out.line(
        JSON.stringify(
          unevaluable ? { ...view, error: 'min-unevaluable', message: MIN_UNEVALUABLE } : view,
        ),
      );
    } else {
      out.lines(gradeLines(view));
      if (unevaluable) out.line(`  ${MIN_UNEVALUABLE}`);
    }

    if (unevaluable) return 2;
    if (min !== undefined && view.score !== null && view.score < min) return 1;
    return 0;
  }

  out.line(`  Unknown command: ${command}`);
  out.line('');
  out.line('  Did you mean one of these?');
  out.line('    fieldnote run       grade this repository');
  out.line('    fieldnote login     sign in');
  out.line('    fieldnote --help    everything else');
  return 2;
}

// The only place in the package that touches the process.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.stdout, process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // A stack trace is not a user interface. Anything that escapes run() is
      // "could not complete", which is exit code 2.
      process.stderr.write('fieldnote: something went wrong. Try again.\n');
      process.exitCode = 2;
    });
}
