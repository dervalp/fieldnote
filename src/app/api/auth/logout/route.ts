import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { sessions } from '../../../../db/schema';
import { tokenHash } from '../../../../auth/crypto';
import { env } from '../../../../lib/env';
export async function POST(request: Request) {
  // Vercel terminates HTTPS before forwarding to the application server.
  const publicOrigin = new URL(env().integration?.APP_URL ?? request.url).origin;
  const origin = request.headers.get('origin');
  if (!origin || origin !== publicOrigin) return new Response('Invalid origin', { status: 403 });
  const jar = await cookies(),
    token = jar.get('reliability-session')?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.id, tokenHash(token)));
  jar.delete('reliability-session');
  return NextResponse.redirect(new URL('/signed-out', publicOrigin), 303);
}
