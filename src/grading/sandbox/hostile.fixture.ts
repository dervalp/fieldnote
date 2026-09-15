/**
 * A program that tries everything "What a grader never receives" forbids, and
 * reports what happened instead of an answer. Shared by the local suite and
 * the live E2B suite so both prove the same list. `network` is off for the
 * local suite: the local adapter cannot block it and the test must not depend
 * on the internet.
 */
export function hostileGrader({ hostPath, network }: { hostPath: string; network: boolean }): string {
  return `import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const attempt = (action) => { try { action(); return 'allowed'; } catch { return 'refused'; } };
export default async function grade() {
  const report = {
    env: Object.keys(process.env),
    passwd: attempt(() => readFileSync('/etc/passwd')),
    host: attempt(() => readFileSync(${JSON.stringify(hostPath)})),
    write: attempt(() => writeFileSync(new URL('./escape.txt', import.meta.url), 'x')),
    spawn: attempt(() => { const child = spawnSync('/bin/echo', ['hi']); if (child.error) throw child.error; }),
  };
  ${
    network
      ? `try { await fetch('https://example.com', { signal: AbortSignal.timeout(5000) }); report.network = 'allowed'; } catch { report.network = 'refused'; }`
      : ''
  }
  return report;
}
`;
}
