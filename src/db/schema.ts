import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  primaryKey,
  check,
  index,
  foreignKey,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ImportState, ItemState } from '../domain/import/types';
import type {
  Gate,
  PullRequestFacts,
  PrMetrics,
  CiCheck,
  ChangedFile,
} from '../domain/pull-request/types';
import type { ReviewEvent } from '../domain/dashboard/types';
import type {
  AgentMarker,
  AgentId,
  DetectionKind,
  DetectionSignal,
  EvidenceRef,
} from '../domain/ai-involvement/types';
const id = () => text('id').primaryKey();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const installations = pgTable('github_installations', {
  id: id(),
  githubInstallationId: text('github_installation_id').notNull().unique(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});
export const repositories = pgTable('repositories', {
  id: id(),
  installationId: text('installation_id')
    .notNull()
    .references(() => installations.id),
  githubRepositoryId: text('github_repository_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  defaultBranch: text('default_branch').notNull(),
  isPrivate: boolean('is_private').notNull(),
  active: boolean('active').notNull().default(true),
  isDemo: boolean('is_demo').notNull().default(false),
  actEnabled: boolean('act_enabled').notNull().default(false),
  trackingStartedAt: timestamp('tracking_started_at', { withTimezone: true }),
  syncStatus: text('sync_status').notNull().default('idle'),
  syncProgress: integer('sync_progress').notNull().default(0),
  syncError: text('sync_error'),
  createdAt: created(),
  updatedAt: updated(),
});
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    githubPrId: text('github_pr_id').notNull().unique(),
    githubPrNumber: integer('github_pr_number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    authorLogin: text('author_login').notNull(),
    headSha: text('head_sha').notNull(),
    headRef: text('head_ref'),
    baseSha: text('base_sha').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    agentProvider: text('agent_provider').notNull().default('unknown'),
    agentMarkers: jsonb('agent_markers')
      .$type<AgentMarker[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    facts: jsonb('facts').$type<PullRequestFacts>().notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('pr_repo_number').on(t.repositoryId, t.githubPrNumber),
    unique('pull_requests_id_repository_unique').on(t.id, t.repositoryId),
  ],
);
export const commits = pgTable(
  'commits',
  {
    id: id(),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    sha: text('sha').notNull(),
    authorLogin: text('author_login'),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('commit_pr_sha').on(t.pullRequestId, t.sha)],
);
export const revisions = pgTable('pr_revisions', {
  id: id(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .references(() => pullRequests.id),
  sha: text('sha').notNull(),
  previousSha: text('previous_sha'),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  diffComplete: boolean('diff_complete').notNull(),
  createdAt: created(),
});
export const ciRuns = pgTable('ci_runs', {
  id: id(),
  repositoryId: text('repository_id')
    .notNull()
    .references(() => repositories.id),
  githubRunId: text('github_run_id'),
  runAttempt: integer('run_attempt').notNull().default(1),
  headSha: text('head_sha').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  conclusion: text('conclusion'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
});
export const prRuns = pgTable(
  'pr_ci_runs',
  {
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    ciRunId: text('ci_run_id')
      .notNull()
      .references(() => ciRuns.id),
  },
  (t) => [primaryKey({ columns: [t.pullRequestId, t.ciRunId] })],
);
export const ciChecks = pgTable('ci_checks', {
  id: id(),
  ciRunId: text('ci_run_id')
    .notNull()
    .references(() => ciRuns.id),
  githubCheckRunId: text('github_check_run_id').notNull(),
  appId: text('app_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  conclusion: text('conclusion'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  normalized: jsonb('normalized').$type<CiCheck>().notNull(),
  createdAt: created(),
  updatedAt: updated(),
});
export const observations = pgTable('ci_observations', {
  id: id(),
  ciCheckId: text('ci_check_id')
    .notNull()
    .references(() => ciChecks.id),
  payload: jsonb('payload').$type<CiCheck>().notNull(),
  createdAt: created(),
});
export const changedFiles = pgTable('changed_files', {
  id: id(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .references(() => pullRequests.id),
  commitSha: text('commit_sha'),
  fromSha: text('from_sha'),
  provenance: text('provenance').notNull(),
  path: text('path').notNull(),
  changeType: text('change_type').notNull(),
  additions: integer('additions').notNull(),
  deletions: integer('deletions').notNull(),
  normalized: jsonb('normalized').$type<ChangedFile>().notNull(),
  createdAt: created(),
});
export const githubEvents = pgTable('github_events', {
  id: id(),
  deliveryId: text('delivery_id').notNull().unique(),
  eventName: text('event_name').notNull(),
  action: text('action'),
  installationId: text('installation_id'),
  repositoryId: text('repository_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
  disposition: text('disposition').notNull().default('pending'),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
});
export const gatePolicies = pgTable(
  'gate_policies',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    version: integer('version').notNull(),
    gates: jsonb('gates').$type<Gate[]>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.version] })],
);
export const prMetrics = pgTable('pr_metrics', {
  id: id(),
  pullRequestId: text('pull_request_id')
    .notNull()
    .unique()
    .references(() => pullRequests.id),
  ciAttemptCount: integer('ci_attempt_count').notNull(),
  firstPassGreen: boolean('first_pass_green'),
  eventuallyGreen: boolean('eventually_green'),
  attemptsToGreen: integer('attempts_to_green'),
  timeToFirstGreenSeconds: integer('time_to_first_green_seconds'),
  failedCheckCount: integer('failed_check_count').notNull(),
  uniqueFailedGateCount: integer('unique_failed_gate_count').notNull(),
  testFilesChanged: integer('test_files_changed').notNull(),
  harnessFilesChanged: integer('harness_files_changed').notNull(),
  harnessChangedAfterFailure: boolean('harness_changed_after_failure'),
  cleanGreen: boolean('clean_green'),
  evidenceStatus: text('evidence_status').notNull(),
  evidenceReasons: jsonb('evidence_reasons').$type<string[]>().notNull(),
  analyzerVersion: text('analyzer_version').notNull(),
  gatePolicyVersion: integer('gate_policy_version').notNull(),
  projection: jsonb('projection').$type<PrMetrics>().notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});
export const users = pgTable('users', {
  id: id(),
  login: text('login').notNull(),
  credentials: text('credentials').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: created(),
  updatedAt: updated(),
});
export const sessions = pgTable('sessions', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});

// Not a row in `sessions`. A session is a browser credential with a seven-day
// life and a cookie's semantics; conflating them is how a revoked CLI token
// keeps working. This one does not expire on purpose — a CLI that logs you out
// weekly is a CLI people stop using, and an expiring credential in CI is a
// broken pipeline at 3am. The price is that revocation has to be real.
export const cliTokens = pgTable(
  'cli_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default('grade'),
    label: text('label').notNull(),
    createdAt: created(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('cli_tokens_user').on(t.userId)],
);

// Pending CLI sign-ins. Rows live seconds and are deleted on use, so this is a
// queue rather than a record — but it must be shared storage, because the
// browser approves on one serverless instance and the CLI exchanges on another.
export const cliAuthCodes = pgTable('cli_auth_codes', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workspaceName: text('workspace_name').notNull(),
  login: text('login').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});

export const repositoryImports = pgTable(
  'repository_imports',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    retryOf: text('retry_of').references((): AnyPgColumn => repositoryImports.id),
    state: text('state').$type<ImportState>().notNull(),
    total: integer('total'),
    completed: integer('completed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    message: text('message'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: created(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'repository_imports_state',
      sql`${t.state} IN ('queued','discovering','importing','complete','partial','failed')`,
    ),
    check('repository_imports_total', sql`${t.total} BETWEEN 0 AND 100`),
    check('repository_imports_completed', sql`${t.completed} >= 0`),
    check('repository_imports_failed', sql`${t.failed} >= 0`),
    check(
      'repository_imports_counts',
      sql`${t.total} IS NULL OR ${t.completed} + ${t.failed} <= ${t.total}`,
    ),
    uniqueIndex('repository_imports_one_active')
      .on(t.repositoryId)
      .where(sql`${t.state} IN ('queued','discovering','importing')`),
    index('repository_imports_latest').on(t.repositoryId, t.createdAt.desc()),
    uniqueIndex('repository_imports_one_retry')
      .on(t.retryOf)
      .where(sql`${t.retryOf} IS NOT NULL`),
  ],
);
export const repositoryImportItems = pgTable(
  'repository_import_items',
  {
    runId: text('run_id')
      .notNull()
      .references(() => repositoryImports.id),
    number: integer('number').notNull(),
    state: text('state').$type<ItemState>().notNull().default('pending'),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.number] }),
    check('repository_import_items_number', sql`${t.number} > 0`),
    check('repository_import_items_state', sql`${t.state} IN ('pending','complete','failed')`),
  ],
);

export const dashboardPrEvidence = pgTable('dashboard_pr_evidence', {
  pullRequestId: text('pull_request_id')
    .primaryKey()
    .references(() => pullRequests.id),
  mergeHeadSha: text('merge_head_sha'),
  reviewExpected: boolean('review_expected'),
  ciExpected: boolean('ci_expected'),
  chronologyComplete: boolean('chronology_complete').notNull().default(false),
  reviewsComplete: boolean('reviews_complete').notNull().default(false),
  ciComplete: boolean('ci_complete').notNull().default(false),
  provenance: jsonb('provenance')
    .$type<{ chronology?: string[]; reviews?: string[]; ci?: string[] }>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updated(),
});

export const reviewEvents = pgTable(
  'review_events',
  {
    id: id(),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    sourceId: text('source_id').notNull(),
    dismissedReviewId: text('dismissed_review_id'),
    reviewerId: text('reviewer_id').notNull(),
    state: text('state').notNull(),
    commitSha: text('commit_sha'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    kind: text('kind').$type<ReviewEvent['kind']>().notNull(),
    source: text('source').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('review_events_source_identity').on(t.pullRequestId, t.source, t.sourceId),
    index('review_events_pr_time').on(t.pullRequestId, t.occurredAt),
    check(
      'review_events_kind',
      sql`${t.kind} IN ('review','requested','dismissed','request-removed')`,
    ),
  ],
);

export const workflowAttempts = pgTable(
  'workflow_attempts',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    runId: text('run_id').notNull(),
    attempt: integer('attempt').notNull(),
    headSha: text('head_sha').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    terminalObservedAt: timestamp('terminal_observed_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.repositoryId, t.runId, t.attempt] }),
    check('workflow_attempts_attempt', sql`${t.attempt} > 0`),
    index('workflow_attempts_sha').on(t.repositoryId, t.headSha),
  ],
);

export const prWorkflowAttempts = pgTable(
  'pr_workflow_attempts',
  {
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.id),
    repositoryId: text('repository_id').notNull(),
    runId: text('run_id').notNull(),
    attempt: integer('attempt').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'pr_workflow_attempts_pk',
      columns: [t.pullRequestId, t.repositoryId, t.runId, t.attempt],
    }),
    foreignKey({
      name: 'pr_workflow_attempts_workflow_attempt_fk',
      columns: [t.repositoryId, t.runId, t.attempt],
      foreignColumns: [
        workflowAttempts.repositoryId,
        workflowAttempts.runId,
        workflowAttempts.attempt,
      ],
    }),
    foreignKey({
      name: 'pr_workflow_attempts_pr_repository_fk',
      columns: [t.pullRequestId, t.repositoryId],
      foreignColumns: [pullRequests.id, pullRequests.repositoryId],
    }),
  ],
);

export const userInterests = pgTable(
  'user_interests',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    feature: text('feature').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.feature] })],
);

export const historyBackfills = pgTable(
  'history_backfills',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    cutoff: timestamp('cutoff', { withTimezone: true }).notNull(),
    cursor: text('cursor'),
    status: text('status').notNull(),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    errorCategory: text('error_category'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check(
      'history_backfills_status',
      sql`${t.status} IN ('queued','discovering','importing','retrying','complete','partial','failed')`,
    ),
    uniqueIndex('history_backfills_one_active')
      .on(t.repositoryId)
      .where(sql`${t.status} IN ('queued','discovering','importing','retrying')`),
    index('history_backfills_retry').on(t.status, t.retryAt),
  ],
);

export const historyBackfillItems = pgTable(
  'history_backfill_items',
  {
    backfillId: text('backfill_id')
      .notNull()
      .references(() => historyBackfills.id),
    number: integer('number').notNull(),
    status: text('status').notNull().default('pending'),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    errorCategory: text('error_category'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.backfillId, t.number] }),
    check('history_backfill_items_number', sql`${t.number} > 0`),
    check(
      'history_backfill_items_status',
      sql`${t.status} IN ('pending','importing','retrying','complete','failed')`,
    ),
    index('history_backfill_items_retry').on(t.status, t.retryAt),
  ],
);

export const foregroundHydrations = pgTable(
  'foreground_hydrations',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    number: integer('number').notNull(),
    sourceEventId: text('source_event_id'),
    status: text('status').notNull().default('queued'),
    executionId: text('execution_id'),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    errorCategory: text('error_category'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check('foreground_hydrations_number', sql`${t.number} > 0`),
    check(
      'foreground_hydrations_status',
      sql`${t.status} IN ('queued','importing','retrying','complete','failed')`,
    ),
    index('foreground_hydrations_active').on(t.repositoryId, t.status, t.updatedAt),
  ],
);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  defaultForUserId: text('default_for_user_id')
    .unique()
    .references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
});
export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').$type<'owner' | 'member'>().notNull(),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check('workspace_memberships_role', sql`${t.role} IN ('owner','member')`),
  ],
);
export const workspaceRepositories = pgTable(
  'workspace_repositories',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    connectedBy: text('connected_by')
      .notNull()
      .references(() => users.id),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.repositoryId] })],
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('workspace_invitations_open_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
  ],
);

export const invitationDeliveries = pgTable(
  'invitation_deliveries',
  {
    id: id(),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => workspaceInvitations.id),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    encryptedToken: text('encrypted_token'),
    encryptedPayload: text('encrypted_payload'),
    attempts: integer('attempts').notNull().default(0),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    state: text('state')
      .$type<'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'>()
      .notNull()
      .default('queued'),
    createdAt: created(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    providerId: text('provider_id'),
    errorCode: text('error_code'),
  },
  (t) => [
    index('invitation_deliveries_owner_time').on(t.requestedBy, t.createdAt),
    index('invitation_deliveries_workspace_time').on(t.workspaceId, t.createdAt),
    index('invitation_deliveries_invitation_time').on(t.invitationId, t.createdAt),
    check(
      'invitation_deliveries_state',
      sql`${t.state} IN ('queued','sending','sent','failed','cancelled')`,
    ),
  ],
);

export const gradingRubrics = pgTable(
  'grading_rubrics',
  {
    graderId: text('grader_id').notNull(),
    version: text('version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    // The full validated manifest. `definition` remains the rubric a run is
    // pinned to — checks and points, nothing operational — and is derived from
    // this, so the two can never disagree.
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.graderId, t.version] })],
);
export const gradeRuns = pgTable(
  'grade_runs',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    graderId: text('grader_id').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    requestedWorkspaceId: text('requested_workspace_id')
      .notNull()
      .references(() => workspaces.id),
    retryOf: text('retry_of').references((): AnyPgColumn => gradeRuns.id),
    state: text('state').$type<'queued' | 'running' | 'complete' | 'failed'>().notNull(),
    sha: text('sha'),
    result: jsonb('result').$type<import('../domain/grading/types').GradeResult>(),
    errorCode: text('error_code'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: created(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('grade_runs_state', sql`${t.state} IN ('queued','running','complete','failed')`),
    check('grade_runs_score', sql`(${t.result}->>'score')::integer BETWEEN 0 AND 100`),
    check(
      'grade_runs_result',
      sql`(${t.state} = 'complete' AND ${t.sha} IS NOT NULL AND ${t.completedAt} IS NOT NULL AND ${t.result} IS NOT NULL AND ${t.result}->>'score' IS NOT NULL) OR (${t.state} <> 'complete' AND ${t.result} IS NULL)`,
    ),
    uniqueIndex('grade_runs_one_active')
      .on(t.repositoryId, t.graderId)
      .where(sql`${t.state} IN ('queued','running')`),
    index('grade_runs_latest').on(t.repositoryId, t.createdAt.desc()),
  ],
);

export const authoringRuns = pgTable(
  'authoring_runs',
  {
    id: id(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    // Only 'plan' is written in this slice; 'execute' is accepted by the
    // constraint so the one-active-run index means the right thing when
    // execute runs arrive, without a later backfill.
    kind: text('kind').$type<'plan' | 'execute'>().notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    requestedWorkspaceId: text('requested_workspace_id')
      .notNull()
      .references(() => workspaces.id),
    retryOf: text('retry_of').references((): AnyPgColumn => authoringRuns.id),
    state: text('state').$type<'queued' | 'running' | 'complete' | 'failed'>().notNull(),
    sha: text('sha'),
    // Provenance, always recorded: something produced this plan.
    authorVersion: text('author_version').notNull(),
    // Null means no model authored this plan — true for the deterministic
    // floor, and true when a sandbox failed and the floor stood in for it.
    model: text('model'),
    sandboxId: text('sandbox_id'),
    errorCode: text('error_code'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: created(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('authoring_runs_state', sql`${t.state} IN ('queued','running','complete','failed')`),
    check('authoring_runs_kind', sql`${t.kind} IN ('plan','execute')`),
    // A plan's result is child rows, so "has at least one remedy" cannot be a
    // check constraint. completeAuthoringRun() enforces that; this enforces
    // what it can.
    check(
      'authoring_runs_complete',
      sql`(${t.state} = 'complete' AND ${t.sha} IS NOT NULL AND ${t.completedAt} IS NOT NULL) OR ${t.state} <> 'complete'`,
    ),
    uniqueIndex('authoring_runs_one_active')
      .on(t.repositoryId)
      .where(sql`${t.state} IN ('queued','running')`),
    index('authoring_runs_latest').on(t.repositoryId, t.createdAt.desc()),
  ],
);

export const authoringRemedies = pgTable(
  'authoring_remedies',
  {
    id: id(),
    authoringRunId: text('authoring_run_id')
      .notNull()
      .references(() => authoringRuns.id),
    // A readiness check id as it appears in GradeResult.checks[].id, e.g.
    // 'root-agent-instructions'. Not a CI check, not a row id.
    checkId: text('check_id').notNull(),
    path: text('path').notNull(),
    rationale: text('rationale').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [
    // One file routinely answers several failing checks, so path is not
    // unique on its own. The pair is what must not repeat.
    uniqueIndex('authoring_remedies_change').on(t.authoringRunId, t.checkId, t.path),
    uniqueIndex('authoring_remedies_order').on(t.authoringRunId, t.ordinal),
    check('authoring_remedies_ordinal', sql`${t.ordinal} >= 0`),
  ],
);

export const repoAiDetections = pgTable(
  'repo_ai_detections',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id),
    agent: text('agent').$type<AgentId>().notNull(),
    signal: text('signal').$type<DetectionSignal>().notNull(),
    kind: text('kind').$type<DetectionKind>().notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    occurrences: integer('occurrences'),
    evidence: jsonb('evidence').$type<EvidenceRef[]>().notNull(),
    detectorVersion: text('detector_version').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.repositoryId, t.agent, t.signal] }),
    check('repo_ai_detections_signal', sql`${t.signal} IN ('executed','configured','declared')`),
    check('repo_ai_detections_kind', sql`${t.kind} IN ('coding-agent','llm-in-ci')`),
    check('repo_ai_detections_occurrences', sql`${t.occurrences} IS NULL OR ${t.occurrences} >= 0`),
    index('repo_ai_detections_repository').on(t.repositoryId),
  ],
);

export const repoDetectionState = pgTable('repo_detection_state', {
  repositoryId: text('repository_id')
    .primaryKey()
    .references(() => repositories.id),
  scannedSha: text('scanned_sha'),
  detectorVersion: text('detector_version').notNull(),
  executedRefreshedAt: timestamp('executed_refreshed_at', { withTimezone: true }),
  configuredRefreshedAt: timestamp('configured_refreshed_at', { withTimezone: true }),
  incompleteReason: text('incomplete_reason'),
  updatedAt: updated(),
});
