import { Surface } from '@fieldnote/design-system';
import { requireTrackedRepository } from '../../../../auth/access';
import { loadDetections } from '../../../../db/queries/ai-involvement';
import { catalogue } from '../../../../domain/ai-involvement/catalogue';
import type { Detection, EvidenceRef } from '../../../../domain/ai-involvement/types';
import { Badge } from '@fieldnote/design-system';
import { AgentMark } from '../../../../components/ai-involvement/marks';
import { pageRouteId } from '../../../../lib/page-route-id';

export const dynamic = 'force-dynamic';

function agentLabel(agent: Detection['agent']) {
  return catalogue.find((entry) => entry.agent === agent)?.label ?? agent;
}

function formatStamp(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}

// One proof line per EvidenceRef, in a monospace stack, so the reader can
// check the claim without us ever rendering commit or PR text.
function ProofLine({ evidence }: { evidence: EvidenceRef }) {
  return (
    <span className="ai-proof">
      {evidence.source}, {evidence.value}, {evidence.prCount} PRs
    </span>
  );
}

function DetectionRow({ detection }: { detection: Detection }) {
  const ran = detection.signal === 'executed';
  const setup = detection.signal === 'configured';
  return (
    <tr>
      <td className={`ai-agent-cell${ran ? ' is-ran' : setup ? ' is-setup' : ''}`}>
        <span className="ai-agent-id">
          <AgentMark agent={detection.agent} />
          <span className="ai-agent-name">{agentLabel(detection.agent)}</span>
        </span>
        <span className="ai-kind">
          {detection.kind === 'llm-in-ci' ? 'LLM in CI' : 'Coding agent'}
        </span>
      </td>
      <td className="ai-evidence">
        <div>
          <Badge tone={ran ? 'positive' : setup ? 'caution' : 'neutral'}>
            {ran ? 'Ran' : setup ? 'Set up' : detection.signal}
          </Badge>
          {detection.evidence.map((evidence, index) => (
            <ProofLine key={index} evidence={evidence} />
          ))}
        </div>
      </td>
      <td className="num">
        {detection.occurrences !== null ? `${detection.occurrences} PRs` : '—'}
      </td>
      <td className="num">{detection.lastSeenAt ? detection.lastSeenAt.slice(0, 10) : '—'}</td>
    </tr>
  );
}

function InvolvementTable({ detections }: { detections: Detection[] }) {
  const ran = detections.filter((detection) => detection.signal === 'executed').length;
  const setup = detections.filter((detection) => detection.signal === 'configured').length;
  const llm = detections.filter((detection) => detection.kind === 'llm-in-ci').length;
  return (
    <>
      <div className="ai-strip">
        <span>
          <b>{ran}</b> agent{ran === 1 ? '' : 's'} {ran === 1 ? 'has' : 'have'} run
        </span>
        <span>
          <b>{setup}</b> set up but idle
        </span>
        <span>
          <b>{llm}</b> LLM step{llm === 1 ? '' : 's'} in CI
        </span>
      </div>
      {detections.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Evidence</th>
                <th scope="col">Activity</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {detections.map((detection) => (
                <DetectionRow key={detection.agent} detection={detection} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No AI involvement detected in accessible pull request history.</p>
      )}
    </>
  );
}

function NotScanned() {
  return (
    <div className="ai-empty">
      <strong>We haven&apos;t scanned this repository yet.</strong>
      Repository files have not been read, so anything set up but idle is still invisible.
    </div>
  );
}

export default async function AiInvolvement({ params }: { params: Promise<{ repoId: string }> }) {
  const repoId = pageRouteId((await params).repoId);
  const repo = await requireTrackedRepository(repoId);
  const { detections, state } = await loadDetections(repo.id);
  return (
    <div className="metrics-page">
      {/* Identity and the back-link live in the repository layout header. */}
      <div className="eyebrow panel-eyebrow">Repository / Involvement</div>
      <h2>AI involvement</h2>
      <p className="page-intro">
        Every AI signal we can prove in this repository, with the evidence behind it. Detector v0.1.
      </p>
      <Surface>
        {state ? <InvolvementTable detections={detections} /> : <NotScanned />}
        {state?.executedRefreshedAt && (
          <p className="ai-stamp">Scanned {formatStamp(state.executedRefreshedAt)}</p>
        )}
      </Surface>
    </div>
  );
}
