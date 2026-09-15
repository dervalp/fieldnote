import type { GraderManifest } from './manifest';

/**
 * A user-facing word for a schema value is domain knowledge, tested where it
 * lives, never spelled in a component — the same reason finish-names.ts exists.
 *
 * The mode is the honesty the grader-factory design traded the README's "no LLM
 * judges anywhere in the pipeline" claim for. It is shown wherever a grade is
 * shown, which now means every card in the row.
 */
export const modeNames: Record<GraderManifest['mode'], string> = {
  deterministic: 'Deterministic',
  llm: 'Model-judged',
  hybrid: 'Hybrid',
};
