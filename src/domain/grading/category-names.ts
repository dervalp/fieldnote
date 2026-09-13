import type { GRADER_CATEGORIES } from './manifest';

/**
 * The browsing axis, spelled for a reader rather than for a URL. The schema
 * value is a slug because a marketplace filters on it; the card is read by a
 * person, and `agent-readiness` on a card is a leaked identifier.
 */
export const categoryNames: Record<(typeof GRADER_CATEGORIES)[number], string> = {
  'harness-integrity': 'Harness integrity',
  'delivery-health': 'Delivery health',
  'agent-readiness': 'Agent readiness',
  architecture: 'Architecture',
  'test-discipline': 'Test discipline',
  'code-quality': 'Code quality',
  documentation: 'Documentation',
  'supply-chain': 'Supply chain',
};
