import { catalogue } from '../ai-involvement/catalogue';
import type { AgentId, Detection } from '../ai-involvement/types';
import type { AgentCandidate, SupportedSetupAgent } from './types';

export const setupAdapters = {
  codex: { label: 'Codex', skillsRoot: '.agents/skills' },
  'claude-code': { label: 'Claude Code', skillsRoot: '.claude/skills' },
} as const;

type CandidateEvidence = AgentCandidate['evidence'][number];

const pathRules: Array<{ agent: AgentId; matches: (path: string) => boolean }> = [
  { agent: 'codex', matches: (path) => path === 'AGENTS.md' || path.startsWith('.agents/') },
  {
    agent: 'claude-code',
    matches: (path) => path === 'CLAUDE.md' || path.startsWith('.claude/'),
  },
  { agent: 'copilot', matches: (path) => path === '.github/copilot-instructions.md' },
  { agent: 'cursor', matches: (path) => path.startsWith('.cursor/') },
  { agent: 'devin', matches: (path) => path.startsWith('.devin/') },
  { agent: 'gemini', matches: (path) => path === 'GEMINI.md' || path.startsWith('.gemini/') },
];

function isSupported(agent: AgentId): agent is SupportedSetupAgent {
  return agent in setupAdapters;
}

function labelFor(agent: AgentId): string {
  return catalogue.find((entry) => entry.agent === agent)?.label ?? agent;
}

function addEvidence(
  candidates: Map<AgentId, CandidateEvidence[]>,
  agent: AgentId,
  evidence: CandidateEvidence,
): void {
  const current = candidates.get(agent) ?? [];
  if (!current.some((entry) => entry.source === evidence.source && entry.value === evidence.value)) {
    current.push(evidence);
    candidates.set(agent, current);
  }
}

/**
 * Finds candidate coding agents from repository paths and prior observations.
 * Detection is deliberately non-authoritative: confirmation is persisted from
 * explicit human input by the setup workflow.
 */
export function detectAgentCandidates(input: {
  paths: string[];
  detections: Detection[];
}): AgentCandidate[] {
  const evidenceByAgent = new Map<AgentId, CandidateEvidence[]>();

  for (const path of input.paths) {
    for (const rule of pathRules) {
      if (rule.matches(path)) addEvidence(evidenceByAgent, rule.agent, { source: 'path', value: path });
    }
  }

  for (const detection of input.detections) {
    if (detection.evidence.length === 0) {
      addEvidence(evidenceByAgent, detection.agent, {
        source: detection.signal,
        value: detection.agent,
      });
      continue;
    }
    for (const evidence of detection.evidence) {
      addEvidence(evidenceByAgent, detection.agent, {
        source: detection.signal,
        value: evidence.value,
      });
    }
  }

  const catalogueOrder = new Map(catalogue.map((entry, index) => [entry.agent, index]));
  return [...evidenceByAgent.entries()]
    .map(([agent, evidence]) => ({
      agent,
      label: labelFor(agent),
      supported: isSupported(agent),
      confirmed: false,
      evidence,
    }))
    .sort(
      (left, right) =>
        (catalogueOrder.get(left.agent) ?? Number.MAX_SAFE_INTEGER) -
          (catalogueOrder.get(right.agent) ?? Number.MAX_SAFE_INTEGER) ||
        left.agent.localeCompare(right.agent),
    );
}
