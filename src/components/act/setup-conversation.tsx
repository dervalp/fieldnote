import { Surface } from '@fieldnote/design-system';
import type { AgentCandidate } from '../../domain/fieldnote-skills/types';
import { SetupAnswerForm } from './setup-answer-form';
import { setupAdapters } from '../../domain/fieldnote-skills/adapters';
import type { SupportedSetupAgent } from '../../domain/fieldnote-skills/types';

export function SetupConversation({
  repositoryId,
  runId,
  state,
  candidates,
  notes,
}: {
  repositoryId: string;
  runId: string;
  state: 'exploring' | 'awaiting-input' | 'ready' | 'failed';
  candidates: AgentCandidate[];
  notes: Array<{
    id: string;
    speaker: 'agent' | 'human';
    kind: 'finding' | 'question' | 'answer' | 'remark';
    body: string;
  }>;
}) {
  const turns = notes.filter((note) => note.kind === 'question' || note.kind === 'answer');
  const lastTurn = turns.at(-1);
  const question = state === 'awaiting-input' && lastTurn?.kind === 'question' ? lastTurn : null;
  const previousTurn = turns.at(-2);
  const savedAnswer =
    state === 'exploring' && lastTurn?.kind === 'answer' && previousTurn?.kind === 'question'
      ? { questionId: previousTurn.id, answer: lastTurn.body }
      : null;
  const choices = [
    ...candidates.map(({ agent, label }) => ({ agent, label })),
    ...(Object.keys(setupAdapters) as SupportedSetupAgent[])
      .filter((agent) => !candidates.some((candidate) => candidate.agent === agent))
      .map((agent) => ({ agent, label: setupAdapters[agent].label })),
  ];
  return (
    <Surface>
      <h3>Setup conversation</h3>
      {candidates.length > 0 && (
        <>
          <h4>Detected agents</h4>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.agent}>
                <strong>{candidate.label}</strong>
                <ul>
                  {candidate.evidence.map((evidence, index) => (
                    <li key={index}>
                      {evidence.source}: <code>{evidence.value}</code>
                    </li>
                  ))}
                </ul>
                {!candidate.supported && (
                  <p>No native adapter will be installed for {candidate.label}.</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <ol aria-label="Setup notes">
        {notes.map((note) => (
          <li key={note.id}>
            <strong>{note.speaker === 'human' ? 'You' : 'Fieldnote'}</strong>
            {note.id === question?.id ? (
              <SetupAnswerForm
                key={question.id}
                repositoryId={repositoryId}
                runId={runId}
                questionId={question.id}
                question={question.body}
                agents={question.body.startsWith('[agents]') ? choices : []}
              />
            ) : (
              <p style={{ whiteSpace: 'pre-wrap' }}>{note.body}</p>
            )}
          </li>
        ))}
      </ol>
      {state === 'exploring' && <p>Exploring the repository. Reload to see the next question.</p>}
      {savedAnswer && (
        <>
          <p>Your last answer is saved. If exploration was interrupted, resume from that answer.</p>
          <SetupAnswerForm
            repositoryId={repositoryId}
            runId={runId}
            questionId={savedAnswer.questionId}
            savedAnswer={savedAnswer.answer}
            agents={[]}
          />
        </>
      )}
      {state === 'ready' && <p>Setup conversation complete.</p>}
      {state === 'failed' && <p>The setup could not finish. Your conversation has been saved.</p>}
    </Surface>
  );
}
