#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { type Env, type Stream, createOutput, shouldShowBanner } from './render.ts';
import { cliVersion } from './version.ts';
import { helpText } from './help.ts';
import { clearAuth, readAuth, writeAuth } from './config.ts';
import { awaitCallback, openBrowser } from './login.ts';
import {
  ApiError,
  exchangeCliToken,
  hasResult,
  listGraders,
  pollGradeRun,
  requestGradeRun,
  revokeCliToken,
  type GradePoll,
} from './api.ts';
import { gradeBlocker, readGitState } from './git.ts';
import { gradeLines, type GradeView } from './grade-view.ts';

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

function reportApiError(
  out: ReturnType<typeof createOutput>,
  error: unknown,
  json: boolean,
): number {
  if (!(error instanceof ApiError)) throw error;
  return fail(out, json, error.exitCode, { error: 'api-error', message: error.message });
}

const COMING_SOON = [
  '  fieldnote over MCP — coming soon',
  '',
  '  One stdio server, started by your coding agent, answering three',
  "  questions from this repository's own record. Not built.",
  '',
  '  Tracked with Train in docs/roadmap.md.',
].join('\n');

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

  if (command === 'mcp') {
    out.line(COMING_SOON);
    return 0;
  }

  if (command === 'whoami') {
    const auth = await readAuth(env);
    if (!auth) {
      out.line('  Not signed in. Run `fieldnote login`.');
      return 3;
    }
    out.line(`  ${auth.login} · ${auth.workspace}`);
    return 0;
  }

  if (command === 'logout') {
    const base = baseUrl(env);
    const auth = await readAuth(env);
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
    if (!auth) {
      out.line('  Signed out on this machine.');
    } else if (revoked) {
      out.line('  Signed out on this machine. The token was revoked.');
    } else {
      out.line(
        '  Signed out on this machine, but the token could not be revoked — it may still be live.',
      );
    }
    out.line(`  Revoke the token itself at ${new URL('/settings/tokens', base)}.`);
    return 0;
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

    // Order is the spec's: credential, git state, blocker, request, poll, render.
    const state = await readGitState(process.cwd());
    const blocker = gradeBlocker(state);
    // --sha is the developer naming a commit explicitly — exactly what the
    // dirty and unpushed refusals themselves suggest doing. It cannot
    // conjure a slug, so not-a-repo and no-remote still refuse.
    const bypassed =
      sha !== undefined && (blocker?.reason === 'dirty' || blocker?.reason === 'unpushed');
    if (blocker && !bypassed) {
      return fail(
        out,
        json,
        2,
        {
          error: 'blocked',
          message: blocker.lines[0]?.trim() ?? 'Blocked.',
          reason: blocker.reason,
          lines: blocker.lines,
        },
        blocker.lines,
      );
    }

    // Reachable here only because gradeBlocker already refused (and refused
    // without a bypass) whenever slug or sha could be null — not-a-repo and
    // no-remote returned above and are never bypassed.
    if (state.slug === null || state.sha === null) {
      throw new Error('unreachable: git state missing slug or sha past the blocker above');
    }
    const slug = state.slug;
    // What is sent to the server: the developer's own --sha, or the git-
    // resolved HEAD. Not what ends up in the rendered view — see below.
    const shaToRequest = sha ?? state.sha;

    const base = baseUrl(env);
    let requested: Awaited<ReturnType<typeof requestGradeRun>>;
    try {
      requested = await requestGradeRun(base, auth.token, {
        repository: slug,
        sha: shaToRequest,
        grader,
      });
    } catch (error) {
      return reportApiError(out, error, json);
    }

    const progress = json ? null : out.progress();
    const POLL_INTERVAL_MS = 1_000;
    const POLL_TIMEOUT_MS = 10 * 60_000;
    // A transient failure (a timeout, a dropped connection) should not cost a
    // ten-minute run its whole result — but an exitCode 3 means the token
    // itself was rejected mid-run, and no amount of retrying fixes that.
    const MAX_CONSECUTIVE_POLL_FAILURES = 3;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;

    let poll: GradePoll;
    try {
      for (;;) {
        try {
          poll = await pollGradeRun(base, auth.token, requested.runId);
        } catch (error) {
          if (error instanceof ApiError && error.exitCode === 2) {
            consecutiveFailures += 1;
            if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) throw error;
            if (Date.now() >= deadline) {
              progress?.done();
              return fail(out, json, 2, {
                error: 'timeout',
                message: 'The grade did not finish in time. Try again.',
              });
            }
            await sleep(POLL_INTERVAL_MS);
            continue;
          }
          throw error;
        }
        consecutiveFailures = 0;
        progress?.state(poll.state);
        if (poll.state !== 'queued' && poll.state !== 'running') break;
        // A CLI that can hang forever is a CLI people stop trusting: the poll
        // ticks once a second and gives up after a ten-minute ceiling.
        if (Date.now() >= deadline) {
          progress?.done();
          return fail(out, json, 2, {
            error: 'timeout',
            message: 'The grade did not finish in time. Try again.',
          });
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      progress?.done();
      return reportApiError(out, error, json);
    }
    progress?.done();

    if (poll.state === 'failed') {
      // The column is nullable and nothing ties it to the failed state — say
      // what is known and no more. Never invent a reason that was not
      // recorded.
      const message = poll.errorCode
        ? `The grade failed: ${poll.errorCode}`
        : 'The grade failed. No reason was recorded.';
      return fail(out, json, 2, { error: 'failed', message, errorCode: poll.errorCode });
    }

    if (!hasResult(poll)) {
      return fail(out, json, 2, {
        error: 'no-result',
        message: 'The grade finished but recorded no result.',
      });
    }

    // slug is what only the CLI knows (git.ts); requestedSha is what the POST
    // echoed back (api.ts) — not shaToRequest above. The server is the
    // authority on what it received, and grade-view.ts's own mismatch
    // disclosure only means what it says if this is the real echo rather
    // than a client-side reconstruction of it.
    const view: GradeView = { ...poll, slug, requestedSha: requested.requestedSha };

    if (json) out.line(JSON.stringify(view));
    else out.lines(gradeLines(view));

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
