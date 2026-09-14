import { expect, test } from 'vitest';
import { listGraders } from '../../domain/grading/registry';
// Side-effect import only, and deliberately the only grading import in this
// file: grade-runs.ts is the chokepoint every grader resolution passes
// through (requestGrade for the page, validateGradeRun for the Inngest
// worker), and importing a grader module registers it — there is no boot
// step in a serverless deployment to do that for us. This test proves the
// worker's half of that claim without any help from the page: it never
// imports domain/grading/graders or an individual grader module directly. If
// someone removes the barrel import from grade-runs.ts, this test goes back
// to seeing only whatever built-in some unrelated import happens to drag in
// — today that's a single grader, by accident — and fails.
import './grade-runs';

test('importing grade-runs alone registers every built-in grader', () => {
  const ids = listGraders().map((grader) => grader.id);
  expect(ids).toContain('fieldnote/agent-readiness');
  expect(ids).toContain('fieldnote/delivery-health');
  expect(ids).toContain('fieldnote/test-discipline');
});
