/** A completed access query proved that the recorded author no longer has access. */
export class AuthoringAccessRevokedError extends Error {
  constructor() {
    super('Plan access revoked');
    this.name = 'AuthoringAccessRevokedError';
  }
}
