import { inngest } from '../client';
import { authoredPrMonitorData, authoredPrRepairData } from '../events';
import { monitorDecision } from '../../domain/act/pr-monitor';
import {
  loadAuthoredPrMonitor,
  reservePrRepair,
  finishPrRepair,
  recordPrOutcome,
  recordMonitorHumanRequired,
} from '../../db/queries/authored-pr-monitor';
import {
  observeAuthoredPr,
  repairAuthoredPr,
  recoverPublishedPrRepair,
} from '../../github/monitor-authored-pr';
import { SetupWriteError } from '../../github/write-authored-pr';

export const monitorAuthoredPrFunction = inngest.createFunction(
  {
    id: 'monitor-authored-pr',
    triggers: [{ event: 'repository/authored-pr.monitor.requested' }],
    retries: 3,
    concurrency: { limit: 1, key: 'event.data.authoredPrId' },
  },
  async ({ event, step }) => {
    const { authoredPrId } = authoredPrMonitorData.parse(event.data);
    const decision = await step.run('observe-and-decide', async () => {
      try {
        const context = await loadAuthoredPrMonitor(authoredPrId);
        if (!context) return null;
        const snapshot = await observeAuthoredPr(context);
        await recordPrOutcome(authoredPrId, snapshot);
        if (context.humanRequired && snapshot.outcome === 'open') return { kind: 'wait' as const };
        // An unfinished reservation is resumed, never allocated another ordinal.
        const reserved = context.repairs.find((repair) =>
          ['queued', 'running'].includes(repair.state),
        );
        const result = monitorDecision({
          ...snapshot,
          repairs: reserved ? reserved.ordinal - 1 : context.repairs.length,
          headChanged:
            snapshot.headChanged || (snapshot.headSha !== context.pr.headSha && !reserved),
        });
        if (result.kind === 'human-required')
          await recordMonitorHumanRequired(authoredPrId, result.reason);
        if (result.kind === 'repair' || (reserved && result.kind === 'wait')) {
          const trigger = result.kind === 'repair' ? result.trigger : undefined;
          const repair =
            reserved ??
            (trigger ? await reservePrRepair(authoredPrId, snapshot.headSha, trigger) : null);
          return repair ? { kind: 'repair' as const, repairId: repair.id } : null;
        }
        return result;
      } catch (error) {
        if (error instanceof SetupWriteError && error.code === 'access_revoked') {
          await recordMonitorHumanRequired(authoredPrId, 'permission_loss');
          return null;
        }
        throw new Error('Setup monitoring temporarily unavailable');
      }
    });
    if (decision?.kind === 'verify') {
      await step.sendEvent('verify-installation', {
        name: 'repository/fieldnote.installation.verify.requested',
        data: { authoredPrId },
      });
    }
    if (decision?.kind === 'repair' && 'repairId' in decision) {
      await step.sendEvent('dispatch-repair', {
        // Reconciliation must redeliver after failure-handler retries exhaust.
        // The PR-locked publication gate, not event-ID expiry, owns idempotency.
        name: 'repository/authored-pr.repair.requested',
        data: { authoredPrId, repairId: decision.repairId },
      });
    }
  },
);

export const repairAuthoredPrFunction = inngest.createFunction(
  {
    id: 'repair-authored-pr',
    triggers: [{ event: 'repository/authored-pr.repair.requested' }],
    retries: 3,
    concurrency: { limit: 1, key: 'event.data.authoredPrId' },
    onFailure: async ({ event }) => {
      const { authoredPrId, repairId } = authoredPrRepairData.parse(event.data.event.data);
      await recoverPublishedPrRepair(authoredPrId, repairId);
    },
  },
  async ({ event, step }) => {
    const { authoredPrId, repairId } = authoredPrRepairData.parse(event.data);
    for (let poll = 0; ; poll++) {
      const result = await step.run(`repair-${poll}`, async () => {
        try {
          const result = await repairAuthoredPr(authoredPrId, repairId);
          await finishPrRepair(repairId, result);
          return result;
        } catch (error) {
          if (error instanceof SetupWriteError && error.code === 'repair_obsolete')
            return { obsolete: true };
          if (error instanceof SetupWriteError && error.code === 'repair_pending')
            return { pending: true };
          if (
            error instanceof SetupWriteError &&
            ['access_revoked', 'setup_conflict', 'invalid_installation'].includes(error.code)
          ) {
            const reason =
              error.code === 'access_revoked'
                ? 'permission_loss'
                : error.code === 'setup_conflict'
                  ? 'head_changed'
                  : 'invalid_repair';
            await finishPrRepair(repairId, { errorCode: reason });
            await recordMonitorHumanRequired(authoredPrId, reason);
            return { errorCode: reason };
          }
          throw new Error('Setup repair temporarily unavailable');
        }
      });
      if (!('pending' in result)) return result;
      // Keep this delivery on the same ordinal while checks settle. Any later
      // duplicate must still pass the transaction's attempt-state guard.
      await step.sleep(`wait-for-checks-${poll}`, '1m');
    }
  },
);
