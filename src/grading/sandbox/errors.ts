/**
 * The substrate a code grader runs on could not be used. Carries no vendor
 * message: a provider error can hold request metadata, and nothing from one is
 * stored or logged.
 */
export class SandboxUnavailableError extends Error {
  constructor(readonly retryable: boolean) {
    super('The grading sandbox is unavailable.');
    this.name = 'SandboxUnavailableError';
  }
}
