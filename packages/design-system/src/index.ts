/* The package's public surface.
 *
 * Admission test for anything exported here: the app renders it AND the
 * landing page renders it. That is what keeps charts, the PR table, the
 * repository picker, import progress, cohort comparison, the grading report,
 * the sidebar, the workspace switcher and the account menu out — they are
 * product surfaces, not system parts.
 *
 * TopBar and Breadcrumb are the application shell's own chrome, and pass the
 * same test the other way round: the shell renders them, and the landing
 * page's nav is the same trail of context read from a different source.
 */
export { Brand } from './brand';
export { Button } from './button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './button';
export { Badge } from './badge';
export { Surface } from './surface';
export { StatCard } from './stat-card';
export { Notice } from './notice';
export { Field } from './field';
export { DataTable } from './data-table';
export { TopBar } from './top-bar';
export { Breadcrumb, type Crumb } from './breadcrumb';
export { GradeCard } from './grade-card';
export { GradeBanner } from './grade-banner';
export type { GradeCardProps, GradeFinish, GradeMove, GradeNextTier } from './grade-card';
