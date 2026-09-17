import 'server-only';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { Sandbox, type CommandResult, type CommandStartOpts, type SandboxOpts } from 'e2b';
import { z } from 'zod';
import {
  authoringSystemContract,
  parseAuthoringOutput,
  setupAuthorOutputSchema,
} from './setup-author';
import { validateAuthoringInput, validateGeneratedPath, type AuthoringSandbox } from './sandbox';

export interface AuthoringE2BSdk {
  create(options: SandboxOpts): Promise<{
    sandboxId: string;
    kill(): Promise<boolean>;
    files: { write(path: string, data: string): Promise<unknown> };
    commands: { run(command: string, options?: CommandStartOpts): Promise<CommandResult> };
  }>;
}

export const authoringReadPolicy: HookCallback = async function (input) {
  if (input.hook_event_name !== 'PreToolUse') return {};
  let allowed = ['Read', 'Glob', 'Grep'].includes(input.tool_name);
  const data = input.tool_input as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') allowed = false;
  const path = input.tool_name === 'Read' ? data?.file_path : (data?.path ?? '/workspace/evidence');
  if (typeof path !== 'string' || path.includes('\\') || path.includes('\0')) allowed = false;
  if (typeof path === 'string') {
    const absolute = path.startsWith('/') ? path : `/workspace/evidence/${path}`;
    if (
      absolute.split('/').includes('..') ||
      absolute.split('/').includes('.') ||
      absolute.includes('//')
    )
      allowed = false;
    if (!(
      absolute === '/workspace/evidence' ||
      absolute.startsWith('/workspace/evidence/') ||
      absolute === '/workspace/skill/fieldnote-setup-profile/SKILL.md'
    ))
      allowed = false;
  }
  if (
    input.tool_name === 'Glob' &&
    (typeof data?.pattern !== 'string' ||
      data.pattern.startsWith('/') ||
      data.pattern.includes('..') ||
      data.pattern.includes('\\'))
  )
    allowed = false;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: allowed ? 'allow' : 'deny',
      permissionDecisionReason: 'Read only the uploaded evidence and pinned skill.',
    },
  };
};

/** Pure policy builder: never starts a process or sends data. */
export function authoringAgentOptions(
  apiKey: string,
  model: string,
  systemPrompt: string,
): Options {
  return {
    cwd: '/workspace/evidence',
    model,
    systemPrompt,
    tools: ['Read', 'Glob', 'Grep'],
    allowedTools: ['Read', 'Glob', 'Grep'],
    settingSources: [],
    skills: [],
    plugins: [],
    mcpServers: {},
    permissionMode: 'default',
    persistSession: false,
    maxTurns: 24,
    env: {
      ANTHROPIC_API_KEY: apiKey,
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/user',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'fieldnote/0.1.0',
    },
    hooks: { PreToolUse: [{ hooks: [authoringReadPolicy] }] },
  };
}

/** Serialize only the self-contained hook; data options survive bundler renaming. */
export function authoringRunnerSource() {
  const { hooks: _hooks, ...options } = authoringAgentOptions('', '', '');
  void _hooks;
  return `import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'node:fs/promises';
const authoringReadPolicy = ${authoringReadPolicy.toString()};
const request = JSON.parse(await readFile('/workspace/runtime/request.json', 'utf8'));
const options = ${JSON.stringify(options)};
options.model = request.model;
options.systemPrompt = request.system;
options.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
options.hooks = { PreToolUse: [{ hooks: [authoringReadPolicy] }] };
const session = query({ prompt: request.prompt, options });
try {
  let result;
  for await (const message of session) {
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success' || message.is_error) throw new Error('Authoring failed');
    result = message.structured_output ?? JSON.parse(message.result);
  }
  if (result === undefined) throw new Error('Missing authoring result');
  const encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) throw new Error('Output exceeds bounds');
  process.stdout.write(encoded);
} finally { session.close(); }
`;
}

/** Fresh five-minute box per run; never inherits the worker's environment. */
export function e2bAuthoringSandbox(
  credentials: { apiKey: string; anthropicApiKey: string; model: string },
  sdk: AuthoringE2BSdk = Sandbox,
): AuthoringSandbox {
  return {
    async run(input) {
      validateAuthoringInput(input);
      let box: Awaited<ReturnType<AuthoringE2BSdk['create']>> | undefined;
      try {
        box = await sdk.create({
          apiKey: credentials.apiKey,
          envs: {},
          timeoutMs: 300_000,
          requestTimeoutMs: 30_000,
          network: {
            allowOut: ['registry.npmjs.org', 'api.anthropic.com'],
            denyOut: ['0.0.0.0/0'],
            allowPublicTraffic: false,
          },
        });
        // Trusted, fixed bootstrap only. Uploaded evidence manifests are never
        // used as package-manager input or executed as repository commands.
        await box.commands.run(
          'mkdir -p /workspace/runtime /workspace/evidence /workspace/.fieldnote && chown -R user:user /workspace',
          { user: 'root', envs: {}, timeoutMs: 30_000 },
        );
        await box.commands.run(
          'npm install --prefix /workspace/runtime --ignore-scripts --no-audit --no-fund --save-exact @anthropic-ai/claude-agent-sdk@0.3.273',
          { envs: {}, timeoutMs: 90_000 },
        );
        const evidence = [...input.files];
        for (let index = 0; index < evidence.length; index += 16) {
          const destination = box;
          await Promise.all(
            evidence
              .slice(index, index + 16)
              .map(([path, content]) => destination.files.write(`/workspace/${path}`, content)),
          );
        }
        await box.files.write('/workspace/runtime/runner.mjs', authoringRunnerSource());
        await box.files.write(
          '/workspace/runtime/request.json',
          JSON.stringify({
            model: credentials.model,
            prompt: input.prompt,
            system: `${authoringSystemContract}\nOutput a JSON object matching this schema, without markdown fences:\n${JSON.stringify(z.toJSONSchema(setupAuthorOutputSchema))}`,
          }),
        );
        const options = authoringAgentOptions(credentials.anthropicApiKey, credentials.model, '');
        // Explicitly clear the Node runner's shell environment too; the SDK's
        // env option independently replaces the Claude subprocess environment.
        const result = await box.commands.run(
          'env -i ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/user CLAUDE_AGENT_SDK_CLIENT_APP=fieldnote/0.1.0 node /workspace/runtime/runner.mjs',
          {
            envs: options.env as Record<string, string>,
            timeoutMs: 300_000,
          },
        );
        if (result.exitCode !== 0 || Buffer.byteLength(result.stdout) > 2 * 1024 * 1024)
          throw new Error('Invalid runner result');
        const output = parseAuthoringOutput(JSON.parse(result.stdout));
        if (input.mode === 'read-only' && output.generatedFiles.length)
          throw new Error('Read-only generation');
        const files = new Map<string, string>();
        // Model tools cannot write. Trusted host code materializes only the
        // outside-sandbox-validated proposals, under a fresh .fieldnote/ root.
        for (const file of output.generatedFiles) {
          validateGeneratedPath(file.path);
          await box.files.write(`/workspace/${file.path}`, file.content);
          files.set(file.path, file.content);
        }
        return { sandboxId: box.sandboxId, model: credentials.model, output, files };
      } catch {
        // Vendor exceptions can contain headers, evidence or credentials.
        throw new Error('Authoring sandbox failed.');
      } finally {
        if (box) {
          try {
            await box.kill();
          } catch {
            /* E2B's five-minute lifetime is the cleanup backstop. */
          }
        }
      }
    },
  };
}
