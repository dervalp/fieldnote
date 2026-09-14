'use client';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import { setGradeSchedule } from '../../app/app/repos/[repoId]/grading/actions';

/**
 * One schedule, for one grader. Presence means on, so the button toggles
 * between writing the row and deleting it.
 *
 * A paused schedule keeps its row and says why: nothing is deleted, it
 * resumes by itself if the enabler's access comes back, and anyone else can
 * take it over by switching it off and on — which writes their own
 * enabled_by.
 */
export function ScheduleToggle({
  repositoryId,
  graderId,
  schedule,
  canRun,
}: {
  repositoryId: string;
  graderId: string;
  // Only what this component reads. `gradeSchedules()` returns a superset
  // that includes `enabledBy` — a foreign workspace's user id — which has no
  // reason to cross to the browser and must not be widened back onto this
  // prop.
  schedule: { paused: boolean } | null;
  canRun: boolean;
}) {
  const router = useRouter();
  const enabled = schedule !== null;
  const [error, action, pending] = useActionState(async () => {
    try {
      await setGradeSchedule(repositoryId, graderId, !enabled);
      router.refresh();
      return '';
    } catch {
      return 'Could not change the nightly schedule. Check your repository access and try again.';
    }
  }, '');
  if (!canRun) return null;
  return (
    <div className="grade-schedule">
      <form action={action}>
        <Button disabled={pending}>
          {pending ? 'Saving…' : enabled ? 'Turn off nightly grading' : 'Grade nightly'}
        </Button>
      </form>
      {enabled && schedule.paused && (
        <p className="muted">
          Paused — the person who turned this on no longer has access to this repository. Switch it
          off and on to take it over.
        </p>
      )}
      <p role="status">{error}</p>
    </div>
  );
}
