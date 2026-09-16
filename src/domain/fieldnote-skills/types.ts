import type { AgentId } from '../ai-involvement/types';
import { z } from 'zod';

export type SupportedSetupAgent = 'codex' | 'claude-code';

const agentIdSchema = z.enum([
  'claude-code',
  'codex',
  'copilot',
  'cursor',
  'devin',
  'gemini',
  'unidentified',
]) satisfies z.ZodType<AgentId>;

export const agentCandidateSchema = z.strictObject({
  agent: agentIdSchema,
  label: z.string(),
  supported: z.boolean(),
  confirmed: z.boolean(),
  evidence: z.array(
    z.strictObject({
      source: z.enum(['path', 'executed', 'configured', 'declared']),
      value: z.string(),
    }),
  ),
});

export const confirmedAgentSchema = z.strictObject({
  agent: agentIdSchema,
  supported: z.boolean(),
  skillsRoot: z.string().nullable(),
});

export type AgentCandidate = z.infer<typeof agentCandidateSchema>;
export type ConfirmedAgent = z.infer<typeof confirmedAgentSchema>;

export interface ReleaseFile {
  path: string;
  content: string;
  hash: `sha256:${string}`;
}

export interface SkillsRelease {
  release: string;
  revision: string;
  releaseLockHash: `sha256:${string}`;
  skills: Array<{ name: string; version: string; files: ReleaseFile[] }>;
}

export interface GeneratedFile {
  path: string;
  kind: 'profile' | 'definition-of-done' | 'concern';
  content: string;
  hash: `sha256:${string}`;
}

export interface RenderedInstallation {
  files: ReadonlyMap<string, string>;
  lockHash: `sha256:${string}`;
}

export interface SetupRepositorySnapshot {
  sha: string;
  complete: boolean;
  paths: string[];
  documents: Array<{ path: string; blobSha: string; text: string }>;
  candidates: AgentCandidate[];
}

export interface InstallationObservation {
  state: 'current' | 'outdated' | 'partial' | 'drifted';
  release: string;
  revision: string;
  lockHash: string;
  agents: ConfirmedAgent[];
  commitSha: string;
  reasons: string[];
}

export type InstallationState =
  | { kind: 'missing'; latest: string }
  | { kind: 'proposed'; runId: string; pullRequestUrl: string | null }
  | { kind: 'current'; release: string }
  | { kind: 'outdated'; installed: string; latest: string }
  | { kind: 'partial' | 'drifted'; release: string; reasons: string[] };
