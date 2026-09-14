import { registerGrader } from '../registry';

export const DELIVERY_HEALTH = 'fieldnote/delivery-health';

// The second built-in, and the first consumer of fieldnote.metrics — the scope
// family no competing tool can offer, which is why it was chosen over another
// file-reading grader. It is an ordinary grader: it gets no private interface,
// no extra evidence and no code path of its own.
//
// The thresholds are this grader's judgement and nothing else's. Changing one
// is a version bump, because a repository's score would move underneath it.
//
// 0.2.0 changes only the subject, which is part of the hashed rubric
// definition — leaving it at 0.1.0 throws `Rubric version definition
// mismatch` on the first grade request against a database that already holds
// the 0.1.0 row. Runs recorded against 0.1.0 keep pointing at the 0.1.0
// rubric, which still exists and still renders.
export const deliveryHealthManifest = registerGrader({
  id: DELIVERY_HEALTH,
  version: '0.2.0',
  evaluatorVersion: '1.0.0',
  subject: 'repository_window',
  mode: 'deterministic',
  category: 'delivery-health',
  kind: 'declarative',
  needs: {
    'fieldnote.metrics': {
      windowDays: 30,
      // Below this there is no delivery record to read, and a quiet month is
      // not a delivery failure. The run reports no score rather than a bad one.
      minMergedPullRequests: 10,
      insufficientReason:
        'Fewer than ten pull requests merged in this window — not enough delivery record to judge.',
    },
  },
  disclaimer: 'This is a record of how work reached green, not a judgement of the code.',
  card: {
    title: 'Delivery Health',
    tagline: 'Does work here reach green cleanly, or by attrition?',
    groups: [
      { title: 'Merging', checks: ['merges-land-clean'] },
      { title: 'Continuous integration', checks: ['ci-ends-green', 'failures-get-fixed'] },
    ],
  },
  checks: [
    {
      id: 'merges-land-clean',
      title: 'Merges land clean',
      points: 40,
      explain: {
        pass: 'Most merged pull requests passed review and CI on the first attempt.',
        fail: 'Too few merged pull requests passed review and CI on the first attempt.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'first-pass-rate', atLeastPercent: 60 },
    },
    {
      id: 'ci-ends-green',
      title: 'CI ends green',
      points: 30,
      explain: {
        pass: 'CI runs finished successfully.',
        fail: 'Too many CI runs ended red.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'ci-success-rate', atLeastPercent: 90 },
    },
    {
      id: 'failures-get-fixed',
      title: 'Failures get fixed',
      points: 30,
      explain: {
        pass: 'Most CI failures were brought back to green.',
        fail: 'Too many CI failures were left red.',
      },
      primitive: 'metric-threshold',
      args: { metric: 'ci-recovery-rate', atLeastPercent: 50 },
    },
  ],
});
