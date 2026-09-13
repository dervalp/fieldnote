import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Callback = { code: string } | { error: 'state_mismatch' | 'timeout' };

// The listener binds 127.0.0.1, never 0.0.0.0: a loopback listener reachable
// from the network is an open port on a laptop. It accepts exactly one
// request and closes on a timeout whether or not one ever arrives.
export function awaitCallback(
  port: number,
  state: string,
  timeoutMs: number,
): Promise<Callback> & { address: Promise<AddressInfo> } {
  let resolveAddress: (value: AddressInfo) => void;
  const address = new Promise<AddressInfo>((resolve) => {
    resolveAddress = resolve;
  });

  const result = new Promise<Callback>((resolve) => {
    let settled = false;
    const finish = (value: Callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(value);
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const ok = url.searchParams.get('state') === state;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end(
        ok ? 'Signed in. You can close this tab.' : 'This sign-in could not be verified.',
      );
      finish(ok ? { code: url.searchParams.get('code') ?? '' } : { error: 'state_mismatch' });
    });

    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
    server.listen(port, '127.0.0.1', () => resolveAddress(server.address() as AddressInfo));
  });

  return Object.assign(result, { address });
}

// Best effort, and deliberately silent on failure: the URL is printed too, so a
// machine with no browser is not an error — it is the device-code path.
export function openBrowser(url: string): void {
  try {
    const child =
      process.platform === 'darwin'
        ? spawn('open', [url], { stdio: 'ignore', detached: true })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true })
          : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // A missing opener is not a failure worth reporting.
  }
}
