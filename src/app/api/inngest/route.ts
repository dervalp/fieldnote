import { gradeRepositoryFunction } from '../../../inngest/functions/grade-repository';
import { reconcileGrades } from '../../../inngest/functions/reconcile-grades';
import { scheduleGrades } from '../../../inngest/functions/schedule-grades';
import { planRepositoryFunction } from '../../../inngest/functions/plan-repository';
import { planFieldnoteSetupFunction } from '../../../inngest/functions/plan-fieldnote-setup';
import { executeFieldnoteSetupFunction } from '../../../inngest/functions/execute-fieldnote-setup';
import { reconcileAuthoring } from '../../../inngest/functions/reconcile-authoring';
import {
  monitorAuthoredPrFunction,
  repairAuthoredPrFunction,
} from '../../../inngest/functions/monitor-authored-pr';
import { sendInvitationFunction } from '../../../inngest/functions/send-invitation';
import { reconcileInvitations } from '../../../inngest/functions/reconcile-invitations';
import {
  historyBackfillFunction,
  reconcileHistoryBackfills,
} from '../../../inngest/functions/backfill-history';
import { reconcileImports } from '../../../inngest/functions/reconcile-imports';
import { syncRepositoryFunction } from '../../../inngest/functions/sync-repository';
import { syncPullRequestFunction } from '../../../inngest/functions/sync-pull-request';
import { serve } from 'inngest/next';
import { inngest } from '../../../inngest/client';
import { processGithubEvent } from '../../../inngest/functions/process-github-event';
import { reconcileEvents } from '../../../inngest/functions/reconcile';
import { recomputePrFunction } from '../../../inngest/functions/recompute-pr';
export const runtime = 'nodejs';
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    historyBackfillFunction,
    reconcileHistoryBackfills,
    gradeRepositoryFunction,
    reconcileGrades,
    scheduleGrades,
    planRepositoryFunction,
    planFieldnoteSetupFunction,
    executeFieldnoteSetupFunction,
    reconcileAuthoring,
    monitorAuthoredPrFunction,
    repairAuthoredPrFunction,
    sendInvitationFunction,
    reconcileInvitations,
    syncRepositoryFunction,
    syncPullRequestFunction,
    processGithubEvent,
    reconcileEvents,
    reconcileImports,
    recomputePrFunction,
  ],
});
