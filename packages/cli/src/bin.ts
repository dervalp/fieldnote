#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { type Env, type Stream, createOutput, shouldShowBanner } from './render.ts';
import { cliVersion } from './version.ts';
import { helpText } from './help.ts';
import { clearAuth, readAuth, writeAuth } from './config.ts';
import { awaitCallback, openBrowser } from './login.ts';
import { exchangeCliToken } from './api.ts';

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
  const [command] = argv.filter((arg) => !arg.startsWith('-'));

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
    const base = env.FIELDNOTE_URL ?? 'https://fieldnote.dev';
    const auth = await readAuth(env);
    let revoked = false;
    if (auth) {
      try {
        const response = await fetch(new URL('/api/cli/revoke', base), {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        revoked = response.ok;
      } catch {
        // Best effort: clearing the local credential still happens below, and
        // the user is told honestly that the token itself may still be live.
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
    const base = env.FIELDNOTE_URL ?? 'https://fieldnote.dev';
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
