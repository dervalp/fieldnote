// The three built-in manifests, re-exported in one place. Importing this
// barrel has no side effect any more: registry.ts's builtInManifests() reads
// the modules directly, and a grader is resolved from the database, not from
// whichever module graph happened to import it.
export { AGENT_READINESS, agentReadinessManifest } from './agent-readiness';
export { DELIVERY_HEALTH, deliveryHealthManifest } from './delivery-health';
export { TEST_DISCIPLINE, testDisciplineManifest } from './test-discipline';
