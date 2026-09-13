import type { Auth } from './config.ts';

// The only module in this package that touches the network. Every request
// goes through call(), which is where the status-to-exit-code mapping, the
// timeout and the non-JSON guard all live exactly once.

const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  readonly exitCode: 2 | 3;

  constructor(message: string, exitCode: 2 | 3) {
    super(message);
    this.name = 'ApiError';
    this.exitCode = exitCode;
  }
}

export type GradeCheck = {
  id: string;
  points: number;
  maxPoints: number;
  status: 'pass' | 'fail';
  paths: string[];
  lineRanges: { path: string; blobSha: string; start: number; end: number }[];
  explanation: string;
};

export type NextTier = {
  targetScore: number;
  targetFinish: string;
  moves: { id: string; title: string; points: number }[];
};

export type GradeComplete = {
  state: 'complete';
  score: number | null;
  incompleteReason?: string;
  checks: GradeCheck[];
  titles: Record<string, string>;
  graderId: string;
  graderVersion: string;
  rubricVersion: string;
  evaluatorVersion: string;
  mode: 'deterministic' | 'llm' | 'hybrid';
  tagline: string;
  disclaimer: string;
  gradedSha: string | null;
  presentation: { label: string; finish: string } | null;
  nextTier: NextTier | null;
  url: string;
};

export type GradePoll =
  | { state: 'queued' | 'running' }
  | { state: 'failed'; errorCode: string | null }
  | ({ state: 'complete' } & Partial<Omit<GradeComplete, 'state'>>);

// A poll can legitimately be `{ state: 'complete' }` with nothing else: the
// run finished but its stored result was null. Callers must not assume a
// complete state carries a result — this is the one place that checks.
// `score` may itself be null (evidence collection was incomplete), so this
// tests presence, not truthiness.
export function hasResult(poll: GradePoll): poll is GradeComplete {
  return poll.state === 'complete' && 'score' in poll && 'checks' in poll;
}

export type GraderSummary = {
  id: string;
  version: string;
  mode: 'deterministic' | 'llm' | 'hybrid';
  category: string;
  tagline: string;
};

async function call<T>(
  base: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const url = new URL(path, base);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError('The server did not respond in time. Try again.', 2);
    }
    // Deliberately generic: a connection failure's own message may name an
    // internal host, and that is not a user interface.
    throw new ApiError('Could not reach fieldnote. Try again.', 2);
  }

  if (response.ok) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('fieldnote returned something unexpected. Try again.', 2);
    }
  }

  const exitCode: 2 | 3 = response.status === 401 || response.status === 403 ? 3 : 2;
  let serverMessage: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') serverMessage = body.error;
  } catch {
    // A non-JSON error body (a proxy, a load balancer) carries nothing safe
    // to show — never surface the body itself.
  }
  throw new ApiError(
    serverMessage ?? 'fieldnote returned something unexpected. Try again.',
    exitCode,
  );
}

export function requestGradeRun(
  base: string,
  token: string,
  body: { repository: string; sha: string; grader?: string },
): Promise<{
  runId: string;
  graderId: string;
  mode: 'deterministic' | 'llm' | 'hybrid';
  requestedSha: string;
}> {
  return call(base, '/api/cli/grades', { method: 'POST', token, body });
}

export function pollGradeRun(base: string, token: string, runId: string): Promise<GradePoll> {
  return call(base, `/api/cli/grades/${runId}`, { token });
}

export async function listGraders(base: string, token: string): Promise<GraderSummary[]> {
  const { graders } = await call<{ graders: GraderSummary[] }>(base, '/api/cli/graders', { token });
  return graders;
}

export function exchangeCliToken(
  base: string,
  body: { code: string; verifier: string; label: string },
): Promise<Auth> {
  return call(base, '/api/cli/token', { method: 'POST', body });
}
