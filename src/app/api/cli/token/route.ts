import { createHash } from 'node:crypto';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { consumeAuthCode, issueToken } from '../../../../db/queries/cli-tokens';

const headers = { 'Cache-Control': 'private, no-store' };

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const bodySchema = z.object({
  code: z.string().min(1),
  verifier: z.string().min(32),
  label: z.string().min(1).max(80).default('unnamed machine'),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.safeParse(await request.json());
    if (!body.success)
      return Response.json({ error: 'Malformed request.' }, { status: 400, headers });

    // Single use: consuming deletes the code, so a replay of a leaked
    // redirect URL buys nothing.
    const pending = await consumeAuthCode(body.data.code);
    if (!pending)
      return Response.json(
        { error: 'This sign-in expired. Run `fieldnote login` again.' },
        { status: 400, headers },
      );

    if (pending.challenge !== challengeFor(body.data.verifier))
      return Response.json(
        { error: 'This sign-in could not be verified. Run `fieldnote login` again.' },
        { status: 400, headers },
      );

    const token = await issueToken(pending.userId, pending.workspaceId, body.data.label);
    return Response.json(
      { token, login: pending.login, workspace: pending.workspaceName },
      { headers },
    );
  } catch (error) {
    unstable_rethrow(error);
    return Response.json(
      { error: 'Sign-in is temporarily unavailable. Try again.' },
      { status: 503, headers },
    );
  }
}
