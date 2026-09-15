import { parseManifest, type GraderManifest } from './manifest';
import { agentReadinessManifest } from './graders/agent-readiness';
import { deliveryHealthManifest } from './graders/delivery-health';
import { testDisciplineManifest } from './graders/test-discipline';

/**
 * fieldnote's own graders, as code. They are where a built-in is written,
 * reviewed and tested — and from slice 6 they are a *seed*: seedBuiltInGraders()
 * publishes them into the registry, where they are ordinary rows resolved by
 * the same query a stranger's grader is. Nothing else reads this list.
 */
export function builtInManifests(): GraderManifest[] {
  return [agentReadinessManifest, deliveryHealthManifest, testDisciplineManifest];
}

export { parseManifest };
