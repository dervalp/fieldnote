import { z } from 'zod';

// Profile v0.1 vocabulary, shared by persistence and the author boundary.
export const requiredProfileFacts = [
  'Tracker.kind',
  'Tracker.repo',
  'Tracker.epicLink',
  'Tracker.blockedBy',
  'Labels.ready',
  'Labels.needsPrd',
  'Commands.check',
  'Commands.preflight',
  'Commands.mutation',
  'Docs.definitionOfDone',
  'Docs.pullRequest',
  'Docs.testing',
  'Docs.verification',
  'Docs.ciTriage',
  'Docs.plans',
  'Parallelism.waveSize',
  'MergePolicy.strictStatusChecks',
  'MergePolicy.adminMerge',
  'Git.baseRemote',
  'Git.baseBranch',
] as const;
const localizationProfileFacts = [
  'Localization.canonicalLocale',
  'Localization.locales',
  'Localization.catalogs',
] as const;
export const profileFactKeySchema = z.enum([...requiredProfileFacts, ...localizationProfileFacts]);
export const unresolved = (value: string | undefined) =>
  !value || /\b(?:TODO|TBD|unknown|unresolved)\b/i.test(value) || value === '?';

const text = z.string().trim().min(1).max(16_384);
export const confirmedProfileFactsSchema = z
  .array(
    z.strictObject({
      key: profileFactKeySchema,
      value: text.refine((value) => !unresolved(value), 'Unresolved confirmed fact.'),
      evidence: z.array(text).min(1).max(40),
    }),
  )
  .max(100)
  .refine(
    (facts) => new Set(facts.map((fact) => fact.key)).size === facts.length,
    'Duplicate confirmed fact.',
  );
export type ConfirmedProfileFact = z.infer<typeof confirmedProfileFactsSchema>[number];

export function requiredFactsForProfile(values: ReadonlyMap<string, string>) {
  return [
    ...requiredProfileFacts,
    ...([...values.keys()].some((key) => key.startsWith('Localization.'))
      ? localizationProfileFacts
      : []),
  ];
}
