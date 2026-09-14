// The sandbox port Act's plan 2b designed — create, write, run, destroy — with
// "run the agent" generalised to running a command, because a grading run has
// no agent. Four operations rather than one runGrader() call, because Act's
// plan run holds a box across several commands and a single call is the
// interface it could not adopt.

export type SandboxHandle = { readonly id: string; readonly root: string };

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  overflowed: boolean;
};

/**
 * A rejection from any operation means the substrate failed, and is always a
 * SandboxUnavailableError. A program failing — a crash, a timeout, too much
 * output — is a resolved ExecResult: that is the program's outcome, not the
 * sandbox's.
 */
export interface Sandbox {
  create(): Promise<SandboxHandle>;
  write(handle: SandboxHandle, name: string, contents: string): Promise<void>;
  exec(
    handle: SandboxHandle,
    command: readonly string[],
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<ExecResult>;
  destroy(handle: SandboxHandle): Promise<void>;
}
