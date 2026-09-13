import { unstable_rethrow } from 'next/navigation';
import { resolveToken } from '../../../db/queries/cli-tokens';
import { withPrincipal } from '../../../auth/principal';

const headers = { 'Cache-Control': 'private, no-store' };

// The 401 every CLI route answers with, exported so that the one route that
// authenticates outside withCliPrincipal (revoke) says the same sentence.
// The remedy is part of the sentence: the CLI already tells the developer to
// run `fieldnote login` when it notices this itself, and the same condition
// should not read differently depending on which side noticed it.
export const unauthorized = () =>
  Response.json({ error: 'Not signed in. Run `fieldnote login`.' }, { status: 401, headers });

// next/navigation's own `isRedirectError` / `isHTTPAccessFallbackError` live
// under a `client/components` path that is meant for client components, not
// a stable public API, and this repo's AGENTS.md warns this Next version
// differs from training data — so the digest is matched here instead of
// importing that internal. Verified by reading
// node_modules/next/dist/client/components/redirect-error.js and
// .../http-access-fallback/http-access-fallback.js in the Next version this
// repo pins: a redirect() throw carries a digest beginning `NEXT_REDIRECT`,
// and notFound() throws one that is exactly `NEXT_HTTP_ERROR_FALLBACK;404`
// (the same prefix is shared with forbidden()/unauthorized(), which use
// other status suffixes — 404 is the one notFound() writes).
function digestOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' ? digest : undefined;
}

const isRedirectThrow = (error: unknown) => digestOf(error)?.startsWith('NEXT_REDIRECT') ?? false;
const isNotFoundThrow = (error: unknown) => digestOf(error) === 'NEXT_HTTP_ERROR_FALLBACK;404';

// Accepts only a well-formed `Bearer <token>` value (optional trailing
// whitespace tolerated, since some clients pad it). A missing scheme, the
// wrong scheme, or an empty token all come back undefined and 401 the same
// way a missing header does — resolveToken() never sees anything that was
// not actually offered as a bearer token.
//
// Exported because the revoke route authenticates the same bearer token
// without going through withCliPrincipal. It used to carry its own copy of
// this regex under a comment asking the two not to drift; two definitions of
// "what counts as a credential" is the shape of a future auth bug, and a
// comment is not a constraint.
export function bearerToken(request: Request): string | undefined {
  return request.headers.get('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
}

// Every CLI route goes through this door, so authenticating the bearer token,
// enforcing scope, and converting Next's control-flow throws into JSON exist
// once rather than per route.
//
// Two conversions matter here, for the same reason. sessionUser() redirects
// when the principal's user row is gone, and requireWorkspace() — which a
// handler calls on the way to doing anything — calls notFound() when a
// token's pinned workspace is not one of the caller's memberships, or the
// caller has none at all; the two collapse into the same call and cannot be
// told apart here. Uncaught, a redirect becomes a 307 that a CLI HTTP client
// follows into a sign-in page's HTML, and notFound() renders an HTML 404
// page — neither is something a CLI client can act on.
//
// The digest predicates below must run before unstable_rethrow: it rethrows
// both a redirect and a notFound by design (that is its job for React
// Server Components), so running it first would undo exactly the
// conversion this module exists to do.
export async function withCliPrincipal(
  request: Request,
  scope: 'grade',
  handler: () => Promise<Response>,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return unauthorized();

  try {
    const principal = await resolveToken(token);
    // A revoked token and one that never existed are indistinguishable here on
    // purpose: an unauthenticated caller learns nothing about which it was.
    if ('error' in principal) return unauthorized();

    if (principal.scope !== scope)
      return Response.json(
        { error: `This token cannot ${scope}. Run \`fieldnote login\` again.` },
        { status: 403, headers },
      );

    return await withPrincipal(
      { userId: principal.userId, workspaceId: principal.workspaceId, source: 'cli' },
      handler,
    );
  } catch (error) {
    if (isRedirectThrow(error)) return unauthorized();
    // Not invented: requireWorkspace() cannot tell "your token's workspace
    // isn't one of your memberships" apart from "you have no memberships at
    // all", so neither is asserted here — only what the operator can do.
    if (isNotFoundThrow(error))
      return Response.json(
        {
          error:
            'The workspace pinned to this token is unavailable. Sign in to fieldnote and re-pin a workspace, then run `fieldnote login` again.',
        },
        { status: 404, headers },
      );
    unstable_rethrow(error);
    // Never the token or the header — only the failure itself, so an
    // operator debugging a CLI 503 has something to go on.
    console.error('withCliPrincipal: request failed', error);
    return Response.json(
      { error: 'fieldnote is temporarily unavailable. Try again.' },
      { status: 503, headers },
    );
  }
}
