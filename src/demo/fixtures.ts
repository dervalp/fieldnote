import { runDeclarative } from '../domain/grading/declarative';
import { assembleCodeResult } from '../domain/grading/code';
import { agentReadinessManifest } from '../domain/grading/graders/agent-readiness';
import { deliveryHealthManifest } from '../domain/grading/graders/delivery-health';
import { testDisciplineManifest } from '../domain/grading/graders/test-discipline';
import type { CodeManifest } from '../domain/grading/manifest';
import type { MetricsWindow, SourceDocument, TreeEntry } from '../domain/grading/types';
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

// The window the demo delivery grade is scored over. It is written out rather
// than aggregated from the seeded pull requests: the seed's dates move with
// whatever the demo fixture says, and the card should show a stable number.
export const demoDeliveryWindow: MetricsWindow = {
  days: 30,
  start: '2026-08-31T00:00:00.000Z',
  endExclusive: '2026-09-30T00:00:00.000Z',
  mergedPullRequests: 24,
  // 17 of 24 merged clean — a repository that ships, with room to improve.
  'first-pass-rate': { numerator: 17, denominator: 24, value: (100 * 17) / 24 },
  'ci-success-rate': { numerator: 38, denominator: 40, value: 95 },
  // Two runs went red and neither came back. This is the failing check, and
  // the one that makes the delivery card read differently from the readiness
  // card beside it.
  'ci-recovery-rate': { numerator: 0, denominator: 2, value: 0 },
};

// Graded by the real evaluator, for the same reason demoGrade is: a seeded
// card must not claim a score, a check id or an explanation the rubric would
// not produce.
export const demoDeliveryGrade = runDeclarative(deliveryHealthManifest, {
  sha: demoGradeSha,
  complete: true,
  documents: [],
  metrics: demoDeliveryWindow,
});

// The demo checkout service's file list. Seven source files in three folders;
// four have tests, and the gateway folder has none — the failing check, and
// what makes this card read differently from the other two.
export const demoTestDisciplineTree: TreeEntry[] = [
  'package.json',
  'README.md',
  'src/checkout/cart.test.ts',
  'src/checkout/cart.ts',
  'src/checkout/payment.test.ts',
  'src/checkout/payment.ts',
  'src/checkout/shipping.ts',
  'src/gateway/routes.ts',
  'src/gateway/session.ts',
  'src/inventory/reservation.ts',
  'src/inventory/stock.test.ts',
  'src/inventory/stock.ts',
  'tests/inventory/reservation.spec.ts',
].map((path) => ({ path, size: 512 }));

// A hand-written answer, not the program's output: the product only ever runs
// a grader's program in a sandbox, and a fixture must not become the one place
// it runs anywhere else. src/demo/fixtures.test.ts proves the program says
// exactly this about the tree above.
export const demoTestDisciplineAnswer = {
  checks: [
    {
      id: 'tests-exist',
      status: 'pass',
      paths: [
        'src/checkout/cart.test.ts',
        'src/checkout/payment.test.ts',
        'src/inventory/stock.test.ts',
        'tests/inventory/reservation.spec.ts',
      ],
    },
    {
      id: 'tests-beside-source',
      status: 'pass',
      paths: [
        'src/checkout/cart.test.ts',
        'src/checkout/payment.test.ts',
        'src/inventory/stock.test.ts',
        'tests/inventory/reservation.spec.ts',
      ],
      count: { matched: 4, of: 7 },
    },
    {
      id: 'tests-in-every-folder',
      status: 'fail',
      paths: ['src/checkout/cart.test.ts', 'src/inventory/stock.test.ts'],
      count: { matched: 2, of: 3 },
    },
  ],
};

// Assembled by the real answer assembly, for the reason demoGrade is graded by
// the real evaluator: a seeded card must not claim a score, a check id or an
// explanation the contract would not produce.
export const demoTestDisciplineGrade = assembleCodeResult(
  testDisciplineManifest as CodeManifest,
  { evidence: { tree: demoTestDisciplineTree } },
  demoTestDisciplineAnswer,
).result;
