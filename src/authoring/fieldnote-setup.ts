import 'server-only';
import { z } from 'zod';
import {
  loadSetupPlan,
  appendSetupAnswer,
  saveSetupResult,
  type SetupReleaseIdentity,
} from '../db/queries/fieldnote-setup';
import { validateAuthoringRun } from '../db/queries/authoring-runs';
import { readSkillsRelease } from '../fieldnote-skills/github-release';
import { collectFieldnoteSetup } from '../github/collect-fieldnote-setup';
import {
  confirmedAgentSchema,
  type ConfirmedAgent,
  type SetupRepositorySnapshot,
} from '../domain/fieldnote-skills/types';
import { setupAdapters } from '../domain/fieldnote-skills/adapters';
import { authorSetupProfile, type SetupAuthorInput } from './setup-author';
import { localAuthoringSandbox } from './local-sandbox';
import { e2bAuthoringSandbox } from './e2b-sandbox';
import { authoringEnv } from '../lib/env';
import { assertCredentialFree } from './sandbox';

export async function authorPinnedSetup(
  identity: SetupReleaseIdentity,
  snapshot: SetupRepositorySnapshot,
  notes: SetupAuthorInput['notes'],
  confirmedAgents: ConfirmedAgent[],
  confirmedFacts: SetupAuthorInput['confirmedFacts'],
) {
  const release = await readSkillsRelease(identity.release);
  if (
    release.revision !== identity.revision ||
    release.releaseLockHash !== identity.releaseLockHash
  )
    throw new Error('Pinned release changed');
  const content = release.skills
    .find((skill) => skill.name === 'fieldnote-setup-profile')
    ?.files.find((file) => file.path === 'SKILL.md')?.content;
  if (!content) throw new Error('Setup skill missing');
  const config = authoringEnv();
  const sandbox = config
    ? e2bAuthoringSandbox({
        apiKey: config.E2B_API_KEY,
        anthropicApiKey: config.ANTHROPIC_API_KEY,
        model: config.FIELDNOTE_AUTHORING_MODEL,
      })
    : localAuthoringSandbox();
  return authorSetupProfile(sandbox, {
    snapshot,
    notes,
    confirmedAgents,
    confirmedFacts,
    setupSkill: { revision: release.revision, content },
  });
}

function confirmAgents(
  formData: FormData,
  answer: string,
  plan: NonNullable<Awaited<ReturnType<typeof loadSetupPlan>>>,
  question: string,
): ConfirmedAgent[] {
  if (!question.startsWith('[agents]') && plan.proposal?.confirmedAgents?.length)
    return plan.proposal.confirmedAgents;
  const selected = formData.getAll('agents');
  // Agent selection is explicit. A plain yes confirms the displayed candidates;
  // speculative mentions in arbitrary prose never count as confirmation.
  const candidates = plan.proposal!.detectedAgents;
  const named = /^yes[;,]\s*(.+?)\s+(?:is|are)\s+correct[.!]?$/i.exec(answer);
  const namedCandidates = named?.[1]
    .split(/,\s*|\s+and\s+/i)
    .map((label) =>
      candidates.find((candidate) => candidate.label.toLowerCase() === label.trim().toLowerCase()),
    );
  const ids = selected.length
    ? selected
    : /^yes[.!]?$/i.test(answer)
      ? candidates.map((candidate) => candidate.agent)
      : namedCandidates?.every((candidate) => candidate !== undefined)
        ? namedCandidates.map((candidate) => candidate.agent)
        : [];
  if (!ids.length) throw new Error('Confirm the coding agents using the agent selections or Yes.');
  return [...new Set(ids)].map((id) => {
    const agent = confirmedAgentSchema.shape.agent.parse(id);
    const adapter = setupAdapters[agent as keyof typeof setupAdapters];
    return { agent, supported: Boolean(adapter), skillsRoot: adapter?.skillsRoot ?? null };
  });
}

// The action authorizes the repository before this trusted service sees any run.
export async function answerSetupPlan(
  repositoryId: string,
  runId: string,
  formData: FormData,
): Promise<void> {
  const answer = z.string().trim().min(1).max(16_384).parse(formData.get('answer'));
  assertCredentialFree(answer);
  const plan = await loadSetupPlan(runId);
  if (
    !plan ||
    plan.run.repositoryId !== repositoryId ||
    plan.run.state !== 'running' ||
    !plan.run.sha ||
    !plan.proposal ||
    !['awaiting-input', 'exploring'].includes(plan.proposal.state)
  )
    throw new Error('Setup is not awaiting input');
  await validateAuthoringRun(plan.run);
  const turns = plan.notes.filter((note) => note.kind === 'question' || note.kind === 'answer');
  const last = turns.at(-1);
  const resuming =
    plan.proposal.state === 'exploring' && last?.kind === 'answer' && last.body === answer;
  const question = resuming ? turns.at(-2) : last;
  const pending =
    turns.filter((note) => note.kind === 'question').length -
    turns.filter((note) => note.kind === 'answer').length;
  if (question?.kind !== 'question' || pending !== (resuming ? 0 : 1))
    throw new Error('Setup requires exactly one pending question');
  const submittedQuestion = formData.get('questionId');
  if (submittedQuestion !== question.id) throw new Error('Setup question has changed');
  const confirmedAgents = resuming
    ? (plan.proposal.confirmedAgents ?? [])
    : confirmAgents(formData, answer, plan, question.body);
  const answerId = await appendSetupAnswer(
    repositoryId,
    runId,
    question.id,
    answer,
    confirmedAgents,
  );
  try {
    const persisted = await loadSetupPlan(runId);
    if (!persisted?.proposal || persisted.run.state !== 'running') return;
    await validateAuthoringRun(persisted.run);
    const snapshot = await collectFieldnoteSetup(repositoryId, plan.run.sha);
    const result = await authorPinnedSetup(
      {
        release: persisted.proposal.skillsRelease,
        revision: persisted.proposal.skillsRevision,
        releaseLockHash: persisted.proposal.releaseLockHash as `sha256:${string}`,
      },
      { ...snapshot, candidates: persisted.proposal.detectedAgents },
      persisted.notes,
      persisted.proposal.confirmedAgents ?? [],
      persisted.proposal.confirmedFacts,
    );
    await validateAuthoringRun(persisted.run);
    // Persists the result and, when ready, queues its execute in one transaction.
    await saveSetupResult(runId, result, answerId);
  } catch {
    // The persisted answer can be resubmitted to resume; no raw provider errors
    // or repository bytes are returned through this browser boundary.
    throw new Error('Setup authoring failed. Submit the same answer to retry.');
  }
}
