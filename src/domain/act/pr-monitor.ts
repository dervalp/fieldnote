import { z } from 'zod';

const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const outcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('open'),
    headSha: z.string().min(1),
    mergedAt: z.null(),
    closedAt: z.null(),
  }),
  z.object({
    outcome: z.literal('closed'),
    headSha: z.string().min(1),
    mergedAt: z.null(),
    closedAt: timestamp,
  }),
  z.object({
    outcome: z.literal('merged'),
    headSha: z.string().min(1),
    mergedAt: timestamp,
    closedAt: timestamp,
  }),
]);
export type AuthoredPrOutcome = z.infer<typeof outcomeSchema>;
export function parseAuthoredPrOutcome(input: unknown): AuthoredPrOutcome {
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid authored pull request outcome');
  return parsed.data;
}

export interface Feedback {
  kind: 'ci' | 'review';
  reference: string;
  disposition: 'actionable' | 'ambiguous' | 'secret' | 'destructive';
  path?: string;
  instruction?: 'format';
}
export interface MonitorInput {
  outcome: 'open' | 'merged' | 'closed';
  failures: Feedback[];
  reviews: Feedback[];
  repairs: number;
  pending?: boolean;
  repairing?: boolean;
  permissionLost?: boolean;
  headChanged?: boolean;
}
export const humanReasons = [
  'ambiguous',
  'secret',
  'destructive',
  'permission_loss',
  'head_changed',
  'repair_limit',
  'invalid_repair',
  'repair_failed',
] as const;
export type HumanReason = (typeof humanReasons)[number];
export const monitorStopNote = (reason: HumanReason) =>
  `Setup pull request needs human action: ${reason}.`;
export function monitorStopReason(body: string): HumanReason {
  return humanReasons.find((reason) => body === monitorStopNote(reason)) ?? 'invalid_repair';
}
export type MonitorDecision =
  | { kind: 'verify' | 'closed' | 'wait' }
  | { kind: 'human-required'; reason: HumanReason }
  | { kind: 'repair'; trigger: Feedback };
export function monitorDecision(input: MonitorInput): MonitorDecision {
  if (input.outcome === 'merged') return { kind: 'verify' };
  if (input.outcome === 'closed') return { kind: 'closed' };
  if (input.permissionLost) return { kind: 'human-required', reason: 'permission_loss' };
  if (input.headChanged) return { kind: 'human-required', reason: 'head_changed' };
  const feedback = [...input.reviews, ...input.failures];
  for (const item of feedback)
    if (item.disposition !== 'actionable')
      return { kind: 'human-required', reason: item.disposition };
  if (input.pending || input.repairing) return { kind: 'wait' };
  if (!feedback.length) return { kind: 'wait' };
  if (input.repairs >= 3) return { kind: 'human-required', reason: 'repair_limit' };
  return { kind: 'repair', trigger: feedback[0] };
}

// Fail closed: arbitrary prose never becomes a model instruction. V1's safe
// automatic repair vocabulary is formatting an explicitly named managed file.
export function normalizeFeedback(
  kind: Feedback['kind'],
  reference: string,
  text: string,
  paths: string[],
): Feedback {
  const base = {
    kind,
    reference: /^(?:check|review|comment|status):\d+$/.test(reference) ? reference : 'review:0',
  };
  if (/secret|credential|token|password|private.?key/i.test(text))
    return { ...base, disposition: 'secret' };
  if (/\b(?:delete|remove|destroy|drop|force.?push|reset|merge|deploy)\b/i.test(text))
    return { ...base, disposition: 'destructive' };
  const match = /^(?:please\s+)?(?:format|fix formatting (?:in|of))\s+`?([^`\s]+)`?\.?$/i.exec(
    text.trim(),
  );
  if (
    text.length <= 1000 &&
    match &&
    paths.includes(match[1]) &&
    /^\.fieldnote\/(?:profile\.md|definition-of-done\.md|concerns\/[a-z0-9-]+\.md)$/.test(match[1])
  )
    return { ...base, disposition: 'actionable', path: match[1], instruction: 'format' };
  return { ...base, disposition: 'ambiguous' };
}
