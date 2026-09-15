/**
 * The one id a demo installation ever has: the workspace DEMO_MODE resolves
 * every request to (workspaces/access.ts), and the workspace the demo seed
 * installs the built-in graders into (scripts/seed.ts). Defined once so the
 * two can never drift apart — they used to (`'demo'` vs `'demo-workspace'`),
 * which left `installedGraders(workspace.id)` resolving nothing and the
 * Grading tab rendering its "No graders installed" empty state for every
 * demo visitor.
 */
export const DEMO_WORKSPACE_ID = 'demo';
