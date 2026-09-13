import Link from 'next/link';
import { Button } from '@fieldnote/design-system';
import { requestPlanRun } from '../../app/repos/[repoId]/grading/actions';
import type { ActAvailability } from '../../domain/act/availability';

// Nothing is rendered when Act is unavailable: the grading page already shows
// availabilityMessage() above, and a disabled button beside an explanation
// would say the same thing twice.
export function ActEntry({
  repositoryId,
  availability,
  latest,
}: {
  repositoryId: string;
  availability: ActAvailability;
  latest: { id: string; state: string } | null;
}) {
  if (!availability.available) return null;
  const href = `/repos/${encodeURIComponent(repositoryId)}/act/${encodeURIComponent(latest?.id ?? '')}`;
  if (latest?.state === 'queued' || latest?.state === 'running')
    return <p className="muted">Planning the fixes. Reload to see the plan when it is ready.</p>;
  if (latest?.state === 'complete')
    return (
      <p>
        <Link href={href}>Read the plan</Link>
      </p>
    );
  return (
    <form action={requestPlanRun.bind(null, repositoryId)}>
      <Button type="submit">Plan the fixes</Button>
    </form>
  );
}
