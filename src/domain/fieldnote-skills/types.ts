import type { AgentId } from '../ai-involvement/types';

export type SupportedSetupAgent = 'codex' | 'claude-code';

export interface AgentCandidate {
  agent: AgentId;
  label: string;
  supported: boolean;
  confirmed: boolean;
  evidence: Array<{ source: 'path' | 'executed' | 'configured' | 'declared'; value: string }>;
}

export interface ConfirmedAgent {
  agent: AgentId;
  supported: boolean;
  skillsRoot: string | null;
}

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
