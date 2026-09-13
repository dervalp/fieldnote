import { unstable_rethrow } from 'next/navigation';
import { tokenHash } from '../../../../auth/crypto';
import { resolveToken, revokeToken } from '../../../../db/queries/cli-tokens';

const headers = { 'Cache-Control': 'private, no-store' };

// `fieldnote logout` clears the file locally; this lets it also kill the token
// server-side, so a laptop that is handed on does not leave a live credential
// behind. It authenticates by the bearer token itself and revokes only that
// token — it must never accept a token id in the body, which would let one
// token revoke another. A revoked or unknown token both look the same to an
// unauthenticated caller: "Not signed in."
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401, headers });
    const principal = await resolveToken(token);
    if ('error' in principal)
      return Response.json({ error: 'Not signed in.' }, { status: 401, headers });
    await revokeToken(tokenHash(token), principal.userId);
    return Response.json({ revoked: true }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: 'Try again.' }, { status: 503, headers });
  }
}
