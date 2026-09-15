import { describe, expect, it } from 'vitest';
import { advanceCarousel } from './carousel-state';

describe('marketing carousel playback', () => {
  const playing = { index: 0, count: 3, paused: false, visible: true, focused: false };
  it('advances and wraps through the complete sequence', () => {
    expect(advanceCarousel(playing)).toBe(1);
    expect(advanceCarousel({ ...playing, index: 2 })).toBe(0);
  });
  it('does not skip content while paused, offscreen, or keyboard focused', () => {
    expect(advanceCarousel({ ...playing, paused: true })).toBe(0);
    expect(advanceCarousel({ ...playing, visible: false })).toBe(0);
    expect(advanceCarousel({ ...playing, focused: true })).toBe(0);
  });
  it('does not advance a one-slide sequence', () => {
    expect(advanceCarousel({ ...playing, count: 1 })).toBe(0);
  });
});
