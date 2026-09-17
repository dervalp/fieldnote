import type { AuthoringSandbox } from './sandbox';
import { validateAuthoringInput } from './sandbox';
import { supportingConfigurationDefaults } from '../domain/fieldnote-skills/configuration';
import {
  profileValues,
  requiredFactsForProfile,
  unresolved,
  type SetupAuthorOutput,
  type SetupAuthorInput,
} from './setup-author';

/** Deliberately deterministic: this development adapter never calls a model. */
export function localAuthoringSandbox(): AuthoringSandbox {
  return {
    async run(input) {
      validateAuthoringInput(input);
      const request = JSON.parse(input.prompt) as {
        notes?: SetupAuthorInput['notes'];
        confirmedAgents?: SetupAuthorInput['confirmedAgents'];
        confirmedFacts?: SetupAuthorInput['confirmedFacts'];
      };
      let profile = input.files.get('evidence/.fieldnote/profile.md') ?? '# Fieldnote profile\n';
      const values = profileValues(profile);
      for (const fact of request.confirmedFacts ?? []) {
        if (unresolved(values.get(fact.key))) values.set(fact.key, fact.value);
      }
      const required = requiredFactsForProfile(values);
      // A human answer follows the question's explicit profile key. Never interpret commands.
      let questionKey: string | undefined;
      for (const note of request.notes ?? []) {
        if (note.speaker === 'agent' && note.kind === 'question')
          questionKey = /\[([A-Za-z]+\.[A-Za-z]+)\]/.exec(note.body)?.[1];
        if (
          note.speaker !== 'human' ||
          note.kind !== 'answer' ||
          !questionKey ||
          unresolved(note.body) ||
          !unresolved(values.get(questionKey))
        )
          continue;
        const key = required.find((key) => key === questionKey);
        if (!key) continue;
        values.set(key, note.body.trim());
      }
      const confirmedFacts: SetupAuthorOutput['confirmedFacts'] = required.flatMap((key) => {
        const value = values.get(key);
        return unresolved(value)
          ? []
          : [
              {
                key,
                value: value!,
                evidence: request.confirmedFacts?.find(
                  (fact) => fact.key === key && fact.value === value,
                )?.evidence ?? ['Existing profile or human answer.'],
              },
            ];
      });
      const missing = required.find((key) => unresolved(values.get(key)));
      const ready =
        !missing &&
        input.mode === 'write-generated' &&
        request.confirmedAgents?.some((agent) => agent.supported);
      if (ready) {
        // Preserve existing lines; replace only TODO/missing values.
        for (const [key, value] of values) {
          const [section, name] = key.split('.');
          const original = profileValues(profile).get(key);
          if (!unresolved(original)) continue;
          const heading = section === 'MergePolicy' ? 'Merge policy' : section;
          if (original !== undefined)
            profile = profile.replace(`- **${name}** — ${original}`, `- **${name}** — ${value}`);
          else profile += `\n## ${heading}\n- **${name}** — ${value}\n`;
        }
      }
      const output: SetupAuthorOutput = {
        state: ready ? 'ready' : 'awaiting-input',
        findings: [
          'Inspected the bounded repository snapshot with the deterministic local author.',
        ],
        nextQuestion: ready
          ? null
          : {
              key: missing ?? 'agents',
              text: missing
                ? `[${missing}] What value should the skills use for this fact?`
                : 'Which supported coding agents should receive Fieldnote skills?',
              evidence: ['This required fact needs human confirmation.'],
            },
        confirmedFacts,
        generatedFiles: ready
          ? [
              { path: '.fieldnote/profile.md', content: profile },
              ...supportingConfigurationDefaults.map((file) => ({
                path: file.path,
                content: input.files.get(`evidence/${file.path}`) ?? file.content,
              })),
            ]
          : [],
      };
      return {
        sandboxId: 'local-authoring',
        model: 'deterministic-local',
        output,
        files: new Map(output.generatedFiles.map((file) => [file.path, file.content])),
      };
    },
  };
}
