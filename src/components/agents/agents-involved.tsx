import Link from 'next/link';
import { catalogue } from '../../domain/ai-involvement/catalogue';
import type { Detection, DetectionSignal } from '../../domain/ai-involvement/types';
import type { DetectionState } from '../../db/queries/ai-involvement';
import { repoSectionPath } from '../../lib/app-routes';
import './agents-involved.css';

function agentLabel(agent: Detection['agent']) {
  return catalogue.find((entry) => entry.agent === agent)?.label ?? agent;
}

const chipClass: Record<DetectionSignal, 'ran' | 'idle' | 'none'> = {
  executed: 'ran',
  configured: 'idle',
  declared: 'none',
};

const rank: Record<DetectionSignal, number> = { executed: 0, configured: 1, declared: 2 };

export type AgentChip = {
  agent: Detection['agent'];
  label: string;
  state: 'ran' | 'idle' | 'none';
};

export type AgentsInvolvedSummary = {
  ranCount: number;
  chips: AgentChip[];
  subtitle: string;
};

/**
 * Pure by design: chips and the subtitle are derived entirely from the
 * Detection rows loadDetections already returns, never from the preview's
 * invented copy ("None configured but idle. No LLM steps in CI."). There is
 * no detector signal for "no LLM steps in CI" as a distinct claim — that
 * would mean scanning workflow definitions, which detectExecuted does not do
 * — so this never asserts it; it only describes counts the detections
 * actually carry.
 */
export function summarizeAgentsInvolved(detections: Detection[]): AgentsInvolvedSummary {
  const sorted = [...detections].sort(
    (a, b) =>
      rank[a.signal] - rank[b.signal] ||
      (b.occurrences ?? 0) - (a.occurrences ?? 0) ||
      a.agent.localeCompare(b.agent),
  );
  const chips = sorted.map((d) => ({
    agent: d.agent,
    label: agentLabel(d.agent),
    state: chipClass[d.signal],
  }));
  const ranCount = detections.filter((d) => d.signal === 'executed').length;
  const configuredCount = detections.filter((d) => d.signal === 'configured').length;
  const declaredCount = detections.filter((d) => d.signal === 'declared').length;

  const parts: string[] = [];
  if (configuredCount > 0) {
    parts.push(`${configuredCount} configured but idle`);
  }
  if (declaredCount > 0) {
    parts.push(`${declaredCount} declared with no run evidence`);
  }
  const subtitle = parts.length
    ? `${parts.join('. ')}.`
    : ranCount > 0
      ? 'Every detected agent has run.'
      : 'No agent found in accessible pull request history.';

  return { ranCount, chips, subtitle };
}

export function AgentsInvolved({
  detections,
  state,
  repoId,
}: {
  detections: Detection[];
  state: DetectionState | null;
  repoId: string;
}) {
  const href = repoSectionPath(repoId, 'ai-involvement');
  if (!state) {
    return (
      <div className="bigcard">
        <span className="t">Agents involved</span>
        <span className="s">
          Not scanned yet. This repository has not been checked for AI involvement.
        </span>
        <Link className="l" href={href}>
          See the evidence →
        </Link>
      </div>
    );
  }
  const { ranCount, chips, subtitle } = summarizeAgentsInvolved(detections);
  if (!chips.length) {
    return (
      <div className="bigcard">
        <span className="t">Agents involved</span>
        <span className="s">
          No AI involvement detected. No agent found in accessible pull request history.
        </span>
        <Link className="l" href={href}>
          See the evidence →
        </Link>
      </div>
    );
  }
  return (
    <div className="bigcard">
      <span className="t">Agents involved</span>
      <span className="v">
        {ranCount}
        <span> {ranCount === 1 ? 'has run' : 'have run'}</span>
      </span>
      <div className="agentchips">
        {chips.map((chip) => (
          <span key={chip.agent} className={chip.state === 'ran' ? 'chip' : `chip ${chip.state}`}>
            {chip.label}
          </span>
        ))}
      </div>
      <span className="s">{subtitle}</span>
      <Link className="l" href={href}>
        See the evidence →
      </Link>
    </div>
  );
}
