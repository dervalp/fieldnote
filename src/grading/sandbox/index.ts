import { SandboxUnavailableError } from './errors';
import { localSandbox } from './local';
import type { Sandbox } from './port';

/**
 * Which substrate runs a code grader. Production never falls back to the
 * local adapter: that would silently drop the network lock in exactly the
 * environment it exists for.
 */
export function selectSandbox(env: NodeJS.ProcessEnv = process.env): Sandbox {
  if (env.NODE_ENV === 'production') throw new SandboxUnavailableError(false);
  return localSandbox;
}
