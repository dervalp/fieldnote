import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
vi.mock('../../app/app/repos/[repoId]/grading/actions', () => ({ answerFieldnoteSetup: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { SetupConversation } from './setup-conversation';

const props = {
  repositoryId: 'repo',
  runId: 'run',
  state: 'awaiting-input' as const,
  candidates: [
    {
      agent: 'codex' as const,
      label: 'Codex',
      supported: true,
      confirmed: false,
      evidence: [{ source: 'path' as const, value: 'AGENTS.md' }],
    },
    {
      agent: 'cursor' as const,
      label: 'Cursor',
      supported: false,
      confirmed: false,
      evidence: [{ source: 'configured' as const, value: '.cursor/rules' }],
    },
  ],
  notes: [
    { id: 'z', speaker: 'agent' as const, kind: 'finding' as const, body: 'Found test commands.' },
    { id: 'a', speaker: 'agent' as const, kind: 'question' as const, body: '[old] Old question?' },
    { id: 'c', speaker: 'human' as const, kind: 'answer' as const, body: 'Earlier answer.' },
    {
      id: 'b',
      speaker: 'agent' as const,
      kind: 'question' as const,
      body: '[agents] Which agents should be installed?',
    },
  ],
};
const render = (overrides: Partial<Parameters<typeof SetupConversation>[0]> = {}) =>
  renderToStaticMarkup(createElement(SetupConversation, { ...props, ...overrides }));
test('keeps durable notes in database order and renders exactly one current question', () => {
  const html = render();
  expect(html.indexOf('Found test commands.')).toBeLessThan(html.indexOf('Old question?'));
  expect(html.indexOf('Old question?')).toBeLessThan(html.indexOf('Earlier answer.'));
  expect(html.indexOf('Earlier answer.')).toBeLessThan(
    html.indexOf('Which agents should be installed?'),
  );
  expect(html.match(/Which agents should be installed\?/g)).toHaveLength(1);
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html).toContain('name="questionId" value="b"');
  expect(html).toContain('name="answer"');
});
test('shows evidence beside candidates and explicit unchecked agent selections', () => {
  const html = render();
  expect(html).toContain('AGENTS.md');
  expect(html).toContain('.cursor/rules');
  expect(html).toContain('No native adapter will be installed');
  expect(html).toContain('name="agents" value="codex"');
  expect(html).toContain('name="agents" value="cursor"');
  expect(html).not.toContain('checked=""');
});
test('exploring has no answer form for a stale question', () => {
  const html = render({ state: 'exploring' });
  expect(html).toContain('Exploring the repository');
  expect(html).not.toContain('<form');
});
test('later questions do not resubmit agent selection', () => {
  const html = render({
    notes: [
      ...props.notes.slice(0, 3),
      { id: 'last', speaker: 'agent', kind: 'question', body: '[Tracker.kind] Which tracker?' },
    ],
  });
  expect(html).toContain('name="questionId" value="last"');
  expect(html).not.toContain('name="agents"');
});
test('a repository without detections can explicitly select a supported agent', () => {
  const html = render({ candidates: [] });
  expect(html).toContain('name="agents" value="codex"');
  expect(html).toContain('name="agents" value="claude-code"');
  expect(html).not.toContain('Detected agents');
});
test('completed conversation does not claim it is still preparing a PR', () => {
  const html = render({ state: 'ready' });
  expect(html).not.toContain('Preparing the setup pull request');
  expect(html).toContain('Setup conversation complete');
  expect(html).not.toContain('<form');
});
test('a remark after the current question retains its database position', () => {
  const html = render({
    notes: [
      ...props.notes,
      {
        id: 'remark',
        speaker: 'agent',
        kind: 'remark',
        body: 'Additional context after the question.',
      },
    ],
  });
  expect(html.indexOf('Which agents should be installed?')).toBeLessThan(
    html.indexOf('Additional context after the question.'),
  );
});
test('reload after author failure can resume the durable answer without a new question', () => {
  const html = render({
    state: 'exploring',
    notes: [
      ...props.notes,
      { id: 'saved', speaker: 'human', kind: 'answer', body: 'Yes; Codex is correct.' },
    ],
  });
  expect(html).toContain('Resume saved answer');
  expect(html).toContain('name="questionId" value="b"');
  expect(html).toContain('name="answer" value="Yes; Codex is correct."');
  expect(html).not.toContain('<textarea');
  expect(html.match(/Which agents should be installed\?/g)).toHaveLength(1);
});
test('initial exploration has no question or resume action', () => {
  const html = render({ state: 'exploring', notes: [] });
  expect(html).not.toContain('<form');
  expect(html).not.toContain('Resume saved answer');
});
