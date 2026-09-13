import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { gradePresentation } from '../../domain/grading/presentation';
import { GradeBanner } from '@fieldnote/design-system';
import { gradeBannerProps, gradeCardProps } from './grade-presentation';
import { AGENT_READINESS } from '../../domain/grading/graders/agent-readiness';

const bannerProps = (score: number) =>
  gradeBannerProps(
    gradeCardProps({
      score,
      repositoryName: 'demo/repo',
      sha: 'a'.repeat(40),
      rubricVersion: '0.1.0',
      checks: [],
      graderId: AGENT_READINESS,
    }),
  );

// gradePresentation is the single source of truth for tier label, colour and
// symbol shape/count (presentation.test.ts exercises that function itself).
// These tests don't hardcode a second tier list — each expectation is derived
// by calling the real function, then checked against what GradeBanner
// actually rendered, at every score the rubric can currently produce plus
// every finish boundary the design doc requires support for.
test.each([0, 49, 50, 69, 70, 79, 80, 89, 90, 99, 100])(
  'score %s: banner shows the score, gradePresentation label and symbol count',
  (score) => {
    const expected = gradePresentation(score);
    const html = renderToStaticMarkup(createElement(GradeBanner, bannerProps(score)));

    expect(html).toContain(`>${score}<`);
    expect(html).toContain(`>${expected.label}<`);

    const marker = expected.symbol === 'circle' ? '<circle' : 'm12 1';
    const otherMarker = expected.symbol === 'circle' ? 'm12 1' : '<circle';
    expect(html.split(marker).length - 1).toBe(expected.count);
    expect(html).not.toContain(otherMarker);
  },
);

test('banner carries no next-tier block, flavour line or scale — those stay on the full card', () => {
  const html = renderToStaticMarkup(createElement(GradeBanner, bannerProps(60)));
  expect(html).not.toContain('grade-card-scale');
  expect(html).not.toContain('grade-card-move');
  expect(html).not.toContain('Next tier');
  expect(html).not.toContain('Rubric');
});

test('untrusted score input is rejected at the seam', () => {
  // The banner is presentational now and would render whatever it is handed.
  // The seam is what refuses a score the rubric cannot produce, so that is
  // where this check belongs.
  expect(() => bannerProps(Number.NaN)).toThrow();
});
