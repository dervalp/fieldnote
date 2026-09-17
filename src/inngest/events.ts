import { z } from 'zod';
export const eventData = z.object({ eventId: z.string().min(1) });
export const prSyncData = z.object({
  repositoryId: z.string().min(1),
  number: z.number().int().positive(),
  hydrationId: z.string().min(1).optional(),
  sourceEventId: z.string().min(1).optional(),
});
export const repositorySyncData = z.object({
  repositoryId: z.string().min(1),
  runId: z.string().min(1),
});
export const historySyncData = z.object({
  repositoryId: z.string().min(1),
  backfillId: z.string().min(1),
});
export const recomputeData = z.object({ prId: z.string().min(1) });
export const invitationSendData = z.object({ deliveryId: z.string().min(1) });
export const gradeRequestedData = z.object({ runId: z.string().min(1) });
export const authoredPrMonitorData = z.object({ authoredPrId: z.string().min(1) });
export const authoredPrRepairData = authoredPrMonitorData.extend({ repairId: z.string().min(1) });
export const authoringPlanRequestedData = z.object({ runId: z.string().min(1) });
export const fieldnoteSetupPlanRequestedData = z.object({ runId: z.string().min(1) });
export const fieldnoteSetupExecuteRequestedData = z.object({
  runId: z.string().min(1),
  proposalUpdatedAt: z.iso.datetime(),
});
export interface ReliabilityEvents {
  'repository/authored-pr.monitor.requested': z.infer<typeof authoredPrMonitorData>;
  'repository/authored-pr.repair.requested': z.infer<typeof authoredPrRepairData>;
  'repository/fieldnote.installation.verify.requested': z.infer<typeof authoredPrMonitorData>;
  'repository/grade.requested': z.infer<typeof gradeRequestedData>;
  'repository/authoring.plan.requested': z.infer<typeof authoringPlanRequestedData>;
  'repository/fieldnote.setup.plan.requested': z.infer<typeof fieldnoteSetupPlanRequestedData>;
  'repository/fieldnote.setup.execute.requested': z.infer<
    typeof fieldnoteSetupExecuteRequestedData
  >;
  'workspace/invitation.send.requested': z.infer<typeof invitationSendData>;
  'github/webhook.received': z.infer<typeof eventData>;
  'github/history.sync.requested': z.infer<typeof historySyncData>;
  'github/pr.sync.requested': z.infer<typeof prSyncData>;
  'github/repository.sync.requested': z.infer<typeof repositorySyncData>;
  'metrics/pr.recompute.requested': z.infer<typeof recomputeData>;
}
