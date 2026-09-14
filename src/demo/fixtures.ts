import { runDeclarative } from '../domain/grading/declarative';
import { agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import type { SourceDocument } from '../domain/grading/types';
import type { CiCheck, Conclusion, PullRequestFacts } from '../domain/pull-request/types';
export const demoPolicy = {
  version: 1,
  gates: [
    { appId: '15368', name: 'unit' },
    { appId: '15368', name: 'playwright' },
  ],
};
export function demoFacts(index: number): PullRequestFacts {
  const time = (minute: number) => new Date(Date.UTC(2026, 8, index + 1, 9, minute)).toISOString();
  const kind = index % 7,
    count = kind === 0 ? 1 : kind === 2 ? 3 : 2;
  const checks: CiCheck[] = [],
    revisions: PullRequestFacts['revisions'] = [];
  for (let i = 0; i < count; i++) {
    const sha = `demo-${index}-${i}`;
    revisions.push({
      sha,
      previousSha: i ? `demo-${index}-${i - 1}` : null,
      observedAt: time(i * 10),
      files: i
        ? [
            {
              path: kind === 3 ? 'tests/checkout.spec.ts' : 'src/checkout.ts',
              changeType: 'modified',
              additions: 3,
              deletions: 1,
            },
          ]
        : [],
      diffComplete: true,
    });
    for (const gate of demoPolicy.gates) {
      let conclusion: Conclusion | null =
        i === count - 1 && kind !== 4
          ? 'success'
          : gate.name === (index % 2 ? 'unit' : 'playwright')
            ? 'failure'
            : 'success';
      if (kind === 5 && i === count - 1) conclusion = null;
      checks.push({
        id: `${sha}-${gate.name}`,
        sha,
        ...gate,
        execution: 1,
        status: conclusion ? 'completed' : 'in_progress',
        conclusion,
        queuedAt: time(i * 10 + 1),
        startedAt: time(i * 10 + 1),
        completedAt: conclusion ? time(i * 10 + 4) : null,
      });
    }
  }
  if (kind === 6) {
    const failed = checks.find((c) => c.conclusion === 'failure')!;
    checks.push({
      ...failed,
      id: `${failed.id}-rerun`,
      execution: 2,
      conclusion: 'success',
      queuedAt: time(5),
      startedAt: time(5),
      completedAt: time(8),
    });
  }
  return {
    openedAt: time(0),
    mergedAt: kind < 4 ? time(30) : null,
    closedAt: kind === 5 ? null : time(30),
    checks,
    revisions,
    files: [
      { path: 'src/checkout.ts', changeType: 'modified', additions: 10, deletions: 4 },
      ...revisions.flatMap((r) => r.files),
    ],
    historyComplete: index !== 19,
    issues: index === 19 ? ['Historical revision chronology unavailable'] : [],
  };
}

// The commit the demo grade is pinned to. Nothing resolves it — the demo
// installation has no GitHub behind it — but the card and the evidence links
// both render it, so it is shaped like the sha a real run would pin.
export const demoGradeSha = '6b1f0a4c9d2e73815a0c4f6d8b3e12907c5a4d6e';

// checkout-service as a graded repository: it says what it is, how it is built
// and how to install it, and never says how to verify a change. That is four
// of the rubric's five checks — 80 of 100.
const demoDocuments: SourceDocument[] = [
  {
    path: 'README.md',
    blobSha: '1c4e9b2a7d05f386e4b1c9a2d70f5836b4e1c9a2',
    text: `# checkout-service

Checkout, payment retry, and inventory reservation for the storefront.

## Setup

\`\`\`bash
pnpm install
pnpm db:migrate
\`\`\`

## Architecture

Three services behind one gateway. See docs/architecture.md.
`,
  },
  {
    path: 'AGENTS.md',
    blobSha: '9a3f7c1e5b28d04a6f3c7e1b58d20a4f6c3e7b18',
    text: `# Working in checkout-service

Reservation, payment and fulfilment each own their tables and talk over the
event bus. Do not read another service's tables directly.

## Conventions

Money is integer minor units. A retried authorisation must never charge twice.
`,
  },
  {
    path: 'docs/architecture.md',
    blobSha: '4d8b2f6a0c93e175b8d2f6a0c93e175b8d2f6a0c',
    text: `# Architecture

The gateway holds the checkout session. Reservation places a hold, payment
authorises against that hold, and fulfilment releases it. Every transition is
an event; nothing calls across service boundaries synchronously.
`,
  },
];

// Graded by the real evaluator rather than written out by hand, so the seeded
// card cannot claim a score, a check id or an explanation the rubric would not
// produce. src/demo/fixtures.test.ts holds it to the shape the demo needs.
export const demoGrade = runDeclarative(agentReadinessManifest, {
  sha: demoGradeSha,
  complete: true,
  documents: demoDocuments,
});
