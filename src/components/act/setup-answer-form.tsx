'use client';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fieldnote/design-system';
import { answerFieldnoteSetup } from '../../app/app/repos/[repoId]/grading/actions';
import type { AgentCandidate } from '../../domain/fieldnote-skills/types';

export function SetupAnswerForm({
  repositoryId,
  runId,
  questionId,
  question,
  agents,
  savedAnswer,
}: {
  repositoryId: string;
  runId: string;
  questionId: string;
  question?: string;
  agents: Pick<AgentCandidate, 'agent' | 'label'>[];
  savedAnswer?: string;
}) {
  const router = useRouter();
  const answer = answerFieldnoteSetup.bind(null, repositoryId, runId);
  const [state, action, pending] = useActionState(async (_: { error?: string }, form: FormData) => {
    try {
      await answer(form);
      router.refresh();
      return {};
    } catch {
      return {
        error: 'Unable to save this answer. Reload to check the current question, then try again.',
      };
    }
  }, {});
  return (
    <form action={action} className="settings-form">
      <input type="hidden" name="questionId" value={questionId} />
      {savedAnswer === undefined && (
        <label htmlFor={`answer-${questionId}`} style={{ whiteSpace: 'pre-wrap' }}>
          {question}
        </label>
      )}
      {agents.length > 0 && (
        <fieldset>
          <legend>Confirm the agents your team uses</legend>
          {agents.map((agent) => (
            <label key={agent.agent}>
              <input type="checkbox" name="agents" value={agent.agent} /> {agent.label}
            </label>
          ))}
        </fieldset>
      )}
      {savedAnswer !== undefined ? (
        <input type="hidden" name="answer" value={savedAnswer} />
      ) : (
        <textarea
          id={`answer-${questionId}`}
          name="answer"
          required
          maxLength={8000}
          rows={4}
          disabled={pending}
        />
      )}
      <Button type="submit" disabled={pending}>
        {pending
          ? 'Saving answer…'
          : savedAnswer !== undefined
            ? 'Resume saved answer'
            : 'Send answer'}
      </Button>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
