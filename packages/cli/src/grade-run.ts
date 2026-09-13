import { ApiError, hasResult, pollGradeRun, requestGradeRun, type GradePoll } from './api.ts';
import { expandSha, gradeBlocker, readGitState } from './git.ts';
import type { GradeView } from './grade-view.ts';

type Blocker = NonNullable<ReturnType<typeof gradeBlocker>>;

export type GradeRunOptions = {
  base: string;
  token: string;
  cwd: string;
  // --sha and the grader id positional, exactly as bin.ts parsed them —
  // undefined means the flag was never given, not that it was given empty.
  sha?: string;
  grader?: string;
  // Called once per poll that actually returned a state (a transient poll
  // failure that gets retried is not a transition and is not reported).
  onProgress?: (state: GradePoll['state']) => void;
};

// Everything between "the developer typed fieldnote run" and "here is a
// graded result, or here is why there isn't one": git resolution, the
// work-in-progress guard and its --sha bypass, the request, and the poll
// loop with its own timeout and retry policy. This module never touches
// out.line, --json, or an exit code — bin.ts owns turning the outcome below
// into lines and an exit code; this owns none of that.
export type GradeRunOutcome =
  | ({ kind: 'blocked' } & Blocker)
  | { kind: 'unknown-sha'; sha: string }
  | { kind: 'timeout' }
  | { kind: 'failed'; errorCode: string | null }
  | { kind: 'no-result' }
  | { kind: 'graded'; view: GradeView };

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
// A transient failure (a timeout, a dropped connection) should not cost a
// ten-minute run its whole result — but an exitCode 3 means the token itself
// was rejected mid-run, and no amount of retrying fixes that.
const MAX_CONSECUTIVE_POLL_FAILURES = 4;
// Its own constant, not POLL_INTERVAL_MS: a flat one-second backoff only
// absorbs a dropped packet, not what actually happens during a ten-minute
// poll — a proxy restart, a deploy, a Wi-Fi handoff, a laptop waking — which
// run five to thirty seconds. 1s, 2s, 4s, 8s absorbs ~15s of that before
// giving up, and retuning the poll cadence no longer silently retunes this.
const POLL_RETRY_BACKOFF_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function gradeRun(options: GradeRunOptions): Promise<GradeRunOutcome> {
  const state = await readGitState(options.cwd);
  const blocker = gradeBlocker(state);
  // --sha is the developer naming a commit explicitly — exactly what the
  // dirty and unpushed refusals themselves suggest doing. It cannot conjure
  // a slug, so not-a-repo and no-remote still refuse.
  const bypassed =
    options.sha !== undefined && (blocker?.reason === 'dirty' || blocker?.reason === 'unpushed');
  if (blocker && !bypassed) return { kind: 'blocked', ...blocker };

  // Reachable here only because gradeBlocker already refused (and refused
  // without a bypass) whenever slug or sha could be null — not-a-repo and
  // no-remote returned above and are never bypassed.
  if (state.slug === null || state.sha === null) {
    throw new Error('unreachable: git state missing slug or sha past the blocker above');
  }
  const slug = state.slug;
  // What is sent to the server: the developer's own --sha, or the git-
  // resolved HEAD. Not what ends up in the rendered view — see below.
  //
  // --sha is expanded first. The POST schema requires a full 40-character
  // sha and this package offers abbreviations, so an unexpanded --sha — in
  // the exact form the refusal copy recommends — is a 400. rev-parse HEAD is
  // already 40 characters, so only the developer's own value is expanded.
  let shaToRequest = state.sha;
  if (options.sha !== undefined) {
    const expanded = await expandSha(options.cwd, options.sha);
    if (expanded === null) return { kind: 'unknown-sha', sha: options.sha };
    shaToRequest = expanded;
  }

  const requested = await requestGradeRun(options.base, options.token, {
    repository: slug,
    sha: shaToRequest,
    grader: options.grader,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;
  let poll: GradePoll;
  for (;;) {
    try {
      poll = await pollGradeRun(options.base, options.token, requested.runId);
    } catch (error) {
      // A 404 is the poll route saying the run is gone, or no longer visible
      // to this token's workspace. Neither heals on its own, so retrying it
      // spends the whole backoff ladder — about fifteen seconds — to report
      // the same sentence it already had.
      if (error instanceof ApiError && error.exitCode === 2 && error.status !== 404) {
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) throw error;
        if (Date.now() >= deadline) return { kind: 'timeout' };
        // 2^(n-1) * base: 1s, 2s, 4s, 8s for consecutive failures 1-4.
        await sleep(POLL_RETRY_BACKOFF_MS * 2 ** (consecutiveFailures - 1));
        continue;
      }
      // Not a transient exitCode-2 failure: an exitCode 3 (the token itself
      // rejected mid-run) or anything unexpected propagates immediately —
      // retrying either wastes ten minutes on something that cannot recover.
      throw error;
    }
    consecutiveFailures = 0;
    options.onProgress?.(poll.state);
    if (poll.state !== 'queued' && poll.state !== 'running') break;
    // A CLI that can hang forever is a CLI people stop trusting: the poll
    // ticks once a second and gives up after a ten-minute ceiling.
    if (Date.now() >= deadline) return { kind: 'timeout' };
    await sleep(POLL_INTERVAL_MS);
  }

  if (poll.state === 'failed') return { kind: 'failed', errorCode: poll.errorCode };
  if (!hasResult(poll)) return { kind: 'no-result' };

  // slug is what only the CLI knows (git.ts); requestedSha is what the POST
  // echoed back (api.ts) — not shaToRequest above. The server is the
  // authority on what it received, and grade-view.ts's own mismatch
  // disclosure only means what it says if this is the real echo rather than
  // a client-side reconstruction of it. The fallback to shaToRequest exists
  // only because api.ts validates no field of the response it casts — if
  // the server ever omitted requestedSha, this would otherwise hand
  // grade-view.ts an undefined string and throw inside .startsWith() after
  // a ten-minute wait the developer cannot get back.
  const view: GradeView = { ...poll, slug, requestedSha: requested.requestedSha ?? shaToRequest };
  return { kind: 'graded', view };
}
