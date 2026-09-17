export const agentIds = [
  'claude-code',
  'codex',
  'copilot',
  'cursor',
  'devin',
  'gemini',
  'unidentified',
] as const;
export type AgentId = (typeof agentIds)[number];

export type DetectionKind = 'coding-agent' | 'llm-in-ci';

export type DetectionSignal = 'executed' | 'configured' | 'declared';

export type MarkerSource = 'commit-trailer' | 'pr-body';

export type EvidenceSource =
  MarkerSource | 'check-app' | 'commit-author' | 'pr-author' | 'review-author' | 'branch-prefix';

export interface AgentMarker {
  agent: AgentId;
  source: MarkerSource;
  ref: string;
}

export interface EvidenceRef {
  source: EvidenceSource;
  value: string;
  prCount: number;
}

export interface Detection {
  agent: AgentId;
  kind: DetectionKind;
  signal: DetectionSignal;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrences: number | null;
  evidence: EvidenceRef[];
}

export const DETECTOR_VERSION = '0.1.0';

export interface CatalogueEntry {
  agent: AgentId;
  label: string;
  kind: DetectionKind;
  checkAppIds: readonly string[];
  botLogins: readonly string[];
  reviewerIds: readonly string[];
  branchPrefixes: readonly string[];
  trailerPatterns: readonly string[];
  bodyPatterns: readonly string[];
}
