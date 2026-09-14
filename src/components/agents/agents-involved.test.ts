import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { summarizeAgentsInvolved, AgentsInvolved } from './agents-involved';
import type { Detection } from '../../domain/ai-involvement/types';
import type { DetectionState } from '../../db/queries/ai-involvement';

vi.mock('next/link', () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => createElement('a', { href, className }, children),
}));

const d = (agent: string, signal: Detection['signal'], occurrences: number | null = 1): Detection =>
  ({
    agent,
    occurrences,
    signal,
    kind: 'coding-agent',
    evidence: [],
    firstSeenAt: null,
    lastSeenAt: '2026-09-01T00:00:00Z',
  }) as Detection;

const state: DetectionState = {
  scannedSha: null,
  detectorVersion: '0.1.0',
  executedRefreshedAt: null,
  configuredRefreshedAt: null,
  incompleteReason: null,
};

test('ran count only counts executed detections, chips carry every detection', () => {
  const summary = summarizeAgentsInvolved([
    d('codex', 'executed'),
    d('cursor', 'executed'),
    d('devin', 'configured'),
    d('gemini', 'declared'),
  ]);
  expect(summary.ranCount).toBe(2);
  expect(summary.chips).toHaveLength(4);
  expect(summary.chips.map((c) => c.state)).toEqual(['ran', 'ran', 'idle', 'none']);
});

test('the subtitle is built from real configured/declared counts, never the preview copy', () => {
  const summary = summarizeAgentsInvolved([d('codex', 'configured'), d('cursor', 'declared')]);
  expect(summary.subtitle).toBe('1 configured but idle. 1 declared with no run evidence.');
  // The preview's invented "No LLM steps in CI" claim has no detector
  // signal behind it and must never appear.
  expect(summary.subtitle).not.toContain('LLM steps in CI');
});

test('every detection executed reports it plainly, with the singular verb at one', () => {
  expect(summarizeAgentsInvolved([d('codex', 'executed')]).subtitle).toBe(
    'Every detected agent has run.',
  );
});

test('no detections at all yields an empty-history subtitle', () => {
  expect(summarizeAgentsInvolved([]).subtitle).toBe(
    'No agent found in accessible pull request history.',
  );
});

test('an unscanned repository renders the not-scanned state, not a zero count', () => {
  const html = renderToStaticMarkup(
    createElement(AgentsInvolved, { detections: [], state: null, repoId: 'repository:1' }),
  );
  expect(html).toContain('Not scanned yet');
  expect(html).not.toContain('class="v"');
});

test('a scanned repository with no detections renders the empty state, not a zero count', () => {
  const html = renderToStaticMarkup(
    createElement(AgentsInvolved, { detections: [], state, repoId: 'repository:1' }),
  );
  expect(html).toContain('No AI involvement detected');
  expect(html).not.toContain('class="v"');
});

test("the evidence link always points at this repository's involvement route", () => {
  const html = renderToStaticMarkup(
    createElement(AgentsInvolved, {
      detections: [d('codex', 'executed')],
      state,
      repoId: 'repository:1',
    }),
  );
  expect(html).toContain('href="/app/repos/repository%3A1/ai-involvement"');
});
