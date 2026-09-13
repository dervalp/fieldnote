/* The package's public surface.
 *
 * Admission test for anything exported here: the app renders it AND the
 * landing page renders it. That is what keeps charts, the PR table, the
 * repository picker, import progress, cohort comparison, the grading report,
 * the sidebar, the workspace switcher and the account menu out — they are
 * product surfaces, not system parts.
 */
export { Brand } from './brand';
export { Button } from './button';
export { Badge } from './badge';
export { Surface } from './surface';
export { StatCard } from './stat-card';
export { Notice } from './notice';
export { Field } from './field';
export { DataTable } from './data-table';
export { GradeCard } from './grade-card';
export { GradeBanner } from './grade-banner';
export type { GradeCardProps, GradeFinish, GradeMove, GradeNextTier } from './grade-card';
