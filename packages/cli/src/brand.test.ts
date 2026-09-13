import { describe, expect, it } from 'vitest';
import { SEAL, WORDMARK, lockup, DISCLAIMER, banner, disclaimer } from './brand';

const width = (line: string) => [...line].length;

describe('the lockup grid', () => {
  it('keeps every seal row eleven columns, so the three corners stay concentric', () => {
    for (const row of SEAL) expect(width(row)).toBe(11);
  });

  it('keeps every wordmark row twenty-five columns, so the letters stay on their baseline', () => {
    for (const row of WORDMARK) expect(width(row)).toBe(25);
  });

  it('is five rows of seal and three of wordmark', () => {
    expect(SEAL).toHaveLength(5);
    expect(WORDMARK).toHaveLength(3);
  });
});

describe('lockup', () => {
  it('sets the wordmark against rows two to four of the seal', () => {
    const lines = lockup({ columns: 80, unicode: true });
    expect(lines).toHaveLength(5);
    expect(lines[0].mark).toBe('');
    expect(lines[4].mark).toContain('AGPL-3.0-only');
    expect(lines[1].mark).toBe(WORDMARK[0]);
    expect(lines[2].mark).toBe(WORDMARK[1]);
    expect(lines[3].mark).toBe(WORDMARK[2]);
  });

  it('pads every seal segment to one width, so the wordmark starts on one column', () => {
    const lines = lockup({ columns: 80, unicode: true });
    const widths = new Set(lines.map((line) => width(line.seal)));
    expect(widths.size).toBe(1);
  });

  it('never exceeds the terminal it was measured against', () => {
    for (const columns of [80, 60, 46, 45, 38, 30, 29, 20]) {
      for (const line of lockup({ columns, unicode: true })) {
        expect(width(line.seal + line.mark)).toBeLessThanOrEqual(columns);
      }
    }
  });

  it('drops the box wordmark under 46 columns but keeps the seal', () => {
    const lines = lockup({ columns: 40, unicode: true });
    expect(lines.some((line) => line.seal.includes('╭'))).toBe(true);
    expect(lines.map((line) => line.mark).join('')).not.toContain('┌─┐┬');
    expect(lines.map((line) => line.mark).join('')).toContain('fieldnote');
  });

  it('drops the seal under 30 columns', () => {
    const lines = lockup({ columns: 26, unicode: true });
    expect(lines.map((line) => line.seal).join('')).not.toContain('╭');
    expect(lines.map((line) => line.mark).join(' ')).toContain('fieldnote');
  });

  it('uses no box drawing at all when the terminal cannot render it', () => {
    const rendered = lockup({ columns: 80, unicode: false })
      .map((line) => line.seal + line.mark)
      .join('\n');
    // eslint-disable-next-line no-control-regex
    expect(rendered).toMatch(/^[\x00-\x7F\n]*$/);
    expect(rendered).toContain('fieldnote');
  });
});

describe('disclaimer', () => {
  it('never truncates a trust claim', () => {
    for (const columns of [100, 80, 46, 38, 30, 24]) {
      const rendered = disclaimer(columns).join(' ').replace(/\s+/g, ' ');
      for (const word of DISCLAIMER.join(' ').split(/\s+/)) {
        expect(rendered).toContain(word);
      }
    }
  });

  it('wraps inside the measured width', () => {
    for (const columns of [100, 80, 46, 38, 30, 24]) {
      for (const line of disclaimer(columns)) {
        expect([...line].length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it('says the house is not exempt, which is the whole point of the paragraph', () => {
    expect(DISCLAIMER.join(' ')).toContain('including for the graders we wrote ourselves');
  });

  it('claims nothing is uploaded, which the server-side execution decision makes true', () => {
    expect(DISCLAIMER.join(' ')).toContain('Nothing on this machine is uploaded');
  });
});

describe('banner', () => {
  it('opens with the lockup and carries the disclaimer', () => {
    const lines = banner({ columns: 80, unicode: true });
    const text = lines.map((line) => line.seal + line.mark).join('\n');
    // The wordmark is one line and must match exactly; the disclaimer is
    // wrapped to the measure, so it is compared as flowed text.
    expect(text).toContain(WORDMARK[0]);
    expect(text.replace(/\s+/g, ' ')).toContain('Nothing on this machine is uploaded');
  });

  it('fits any terminal it is given', () => {
    for (const columns of [100, 80, 46, 38, 30, 24]) {
      for (const line of banner({ columns, unicode: true })) {
        expect([...(line.seal + line.mark)].length).toBeLessThanOrEqual(columns);
      }
    }
  });
});
