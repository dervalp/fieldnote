import { inngest } from '../client';
import { dispatchGrade } from '../dispatch-grade';
import {
  listGradeSchedules,
  scheduleAvailable,
  type GradeScheduleRow,
} from '../../db/queries/grade-schedules';
import {
  activeGradeRun,
  confirmGrade,
  latestFinishedGrade,
  scheduleGrade,
} from '../../db/queries/grade-runs';
import { resolveHeadSha } from '../../github/collect-files';
import { installedGrader } from '../../db/queries/graders';
import { changesOverTime } from '../../domain/grading/manifest';
import { sandboxFor } from '../../grading/evaluate';

/**
 * One schedule's decision, in the order the design gives: an available
 * repository and an unpaused schedule, no run already in flight, and something
 * that has actually changed since the last scored run.
 *
 * Returns the id of a run to dispatch, or null to skip. A skip is never an
 * error: one repository's bad night must not stop the pass.
 */
export async function scheduleIfDue(row: GradeScheduleRow): Promise<string | null> {
  // Steps 1 and 2: an available repository, and a schedule whose enabler still
  // has access. A paused schedule is skipped and its row survives.
  if (!(await scheduleAvailable(row))) return null;
  const installed = await installedGrader(row.workspaceId, row.graderId);
  // A schedule for a grader this workspace has uninstalled is inert, not fatal.
  if (!installed) return null;
  const manifest = installed.manifest;
  // A code grader with no sandbox to run in would otherwise create a run that
  // fails sandbox_unavailable every night. Skipped like any other skip: the
  // row survives, and the first night a sandbox exists it runs.
  try {
    sandboxFor(manifest);
  } catch {
    return null;
  }
  // Step 3. grade_runs_one_active would refuse the insert anyway; asking first
  // avoids manufacturing an error to swallow.
  if (await activeGradeRun(row.repositoryId, row.graderId)) return null;
  // Step 4. A grader whose evidence changes over time always runs — the
  // evidence moved by definition. Every other grader costs one sha lookup and
  // stops there if its last finished run, scored or too little to judge, was
  // this commit at this version: same commit, same program, same answer, and a
  // code grader would rent a box to be told it again. Keyed off the evidence
  // labels rather than manifest.subject, because the labels are what the skip
  // is actually about.
  if (!changesOverTime(manifest)) {
    let head: string;
    try {
      head = await resolveHeadSha(row.repositoryId);
    } catch {
      return null;
    }
    const latest = await latestFinishedGrade(row.repositoryId, row.graderId);
    if (latest?.sha === head && latest.rubricVersion === manifest.version) {
      // The skip is the evidence that this grade still holds, and the public
      // badge's staleness rule reads it.
      await confirmGrade(latest.id);
      return null;
    }
  }
  // Step 5.
  const run = await scheduleGrade(row);
  return run.state === 'queued' ? run.id : null;
}

/**
 * `0 3 * * *`, not the `* * * * *` the reconcilers use: those recover dropped
 * events, this creates work. Three in the morning UTC rather than midnight, so
 * the night's imports have landed before anything reads them.
 */
export const scheduleGrades = inngest.createFunction(
  { id: 'schedule-grades', triggers: [{ cron: '0 3 * * *' }] },
  async ({ step }) => {
    if (process.env.DEMO_MODE === 'true') return { demo: true };
    const rows = await step.run('list-schedules', listGradeSchedules);
    let created = 0;
    for (const row of rows) {
      const runId = await step.run(`schedule-${row.repositoryId}-${row.graderId}`, async () => {
        try {
          return await scheduleIfDue(row);
        } catch {
          // One repository's bad night must not stop the pass. The next tick
          // tries again; nothing was written.
          return null;
        }
      });
      if (!runId) continue;
      created += 1;
      await step.run(`dispatch-${runId}`, async () => {
        try {
          await dispatchGrade(runId);
        } catch {
          /* A queued run with no dispatch is what reconcile-grades is for. */
        }
      });
    }
    return { schedules: rows.length, created };
  },
);
