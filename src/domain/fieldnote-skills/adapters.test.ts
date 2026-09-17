import { describe, expect, test } from 'vitest';
import type { Detection } from '../ai-involvement/types';
import { detectAgentCandidates } from './adapters';

const detection = (overrides: Partial<Detection> = {}): Detection => ({
  agent: 'codex',
  kind: 'coding-agent',
  signal: 'executed',
  firstSeenAt: null,
  lastSeenAt: null,
  occurrences: 1,
  evidence: [],
  ...overrides,
});

describe('detectAgentCandidates', () => {
  test('merges repository and historical evidence without confirming it', () => {
    expect(
      detectAgentCandidates({ paths: ['AGENTS.md', '.claude/settings.json'], detections: [] }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'codex', supported: true, confirmed: false }),
        expect.objectContaining({ agent: 'claude-code', supported: true, confirmed: false }),
      ]),
    );
  });

  test('reports unsupported detections without blocking supported targets', () => {
    const candidates = detectAgentCandidates({
      paths: ['.cursor/rules'],
      detections: [],
    });

    expect(candidates).toContainEqual(expect.objectContaining({ agent: 'cursor', supported: false }));
  });

  test('deduplicates evidence and orders candidates by the catalogue', () => {
    expect(
      detectAgentCandidates({
        paths: ['.claude/settings.json', 'AGENTS.md', 'AGENTS.md'],
        detections: [
          detection({
            agent: 'codex',
            evidence: [{ source: 'branch-prefix', value: 'codex/', prCount: 2 }],
          }),
          detection({
            agent: 'codex',
            evidence: [{ source: 'branch-prefix', value: 'codex/', prCount: 1 }],
          }),
        ],
      }),
    ).toEqual([
      {
        agent: 'claude-code',
        label: 'Claude Code',
        supported: true,
        confirmed: false,
        evidence: [{ source: 'path', value: '.claude/settings.json' }],
      },
      {
        agent: 'codex',
        label: 'Codex',
        supported: true,
        confirmed: false,
        evidence: [
          { source: 'path', value: 'AGENTS.md' },
          { source: 'executed', value: 'codex/' },
        ],
      },
    ]);
  });
});
