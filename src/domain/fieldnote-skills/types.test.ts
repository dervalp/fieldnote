import { expect, test } from 'vitest';
import { agentCandidateSchema, confirmedAgentSchema } from './types';

const candidate = {
  agent: 'codex',
  label: 'Codex',
  supported: true,
  confirmed: false,
  evidence: [{ source: 'path', value: 'AGENTS.md' }],
};
const confirmed = { agent: 'codex', supported: true, skillsRoot: '.agents/skills' };

test('parses supported and unsupported persisted agent records', () => {
  expect(agentCandidateSchema.parse(candidate)).toEqual(candidate);
  expect(confirmedAgentSchema.parse(confirmed)).toEqual(confirmed);
  expect(
    confirmedAgentSchema.parse({ agent: 'cursor', supported: false, skillsRoot: null }),
  ).toEqual({ agent: 'cursor', supported: false, skillsRoot: null });
});

test.each([
  { ...candidate, agent: 'invented-agent' },
  { ...candidate, supported: 'true' },
  { ...candidate, confirmed: undefined },
  { ...candidate, extra: 'untrusted' },
  { ...candidate, evidence: [{ source: 'invented-source', value: 'AGENTS.md' }] },
  { ...candidate, evidence: [{ source: 'path', value: 123 }] },
  { ...candidate, evidence: [{ source: 'path', value: 'AGENTS.md', extra: true }] },
])('rejects malformed or additional candidate fields: %j', (value) => {
  expect(agentCandidateSchema.safeParse(value).success).toBe(false);
});

test.each([
  { ...confirmed, agent: 'invented-agent' },
  { ...confirmed, supported: 1 },
  { ...confirmed, skillsRoot: 123 },
  { ...confirmed, skillsRoot: undefined },
  { ...confirmed, extra: 'untrusted' },
])('rejects malformed or additional confirmed-agent fields: %j', (value) => {
  expect(confirmedAgentSchema.safeParse(value).success).toBe(false);
});
