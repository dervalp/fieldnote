'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { advanceCarousel } from './carousel-state';

/** Slides are rendered on the server; only playback belongs to the browser.
 * Without hydration, every slide remains readable and controls stay hidden. */
export function StoryCarousel({
  label,
  labels,
  slides,
  variant = 'terminal',
}: {
  label: string;
  labels: string[];
  slides: ReactNode[];
  variant?: 'terminal' | 'timeline';
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setEnhanced(true);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPaused(preference.matches);
    const preferenceChanged = () => setPaused(preference.matches);
    preference.addEventListener('change', preferenceChanged);
    const element = root.current;
    let intersecting = false;
    const updateVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry.isIntersecting;
        updateVisibility();
      },
      { threshold: 0.35 },
    );
    if (element) observer.observe(element);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', preferenceChanged);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!enhanced || paused || !visible || focused) return;
    const timer = window.setTimeout(() => {
      setIndex(advanceCarousel({ index, count: slides.length, paused, visible, focused }));
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [enhanced, index, paused, visible, focused, slides.length]);

  return (
    <div
      ref={root}
      className={`mk-story-carousel mk-story-carousel-${variant}`}
      role="region"
      aria-label={label}
      aria-roledescription={enhanced ? 'carousel' : undefined}
      data-enhanced={enhanced}
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="mk-story-slides" aria-live={paused || focused ? 'polite' : 'off'}>
        {slides.map((slide, position) => (
          <div
            className="mk-story-slide"
            key={labels[position]}
            id={`${id}-${position}`}
            role="group"
            aria-label={`${position + 1} of ${slides.length}: ${labels[position]}`}
            aria-hidden={enhanced && position !== index ? true : undefined}
            inert={enhanced && position !== index ? true : undefined}
            data-active={position === index}
          >
            {slide}
          </div>
        ))}
      </div>
      <div className="mk-story-tabs" aria-label="Choose a stage">
        {labels.map((name, position) => (
          <button
            key={name}
            type="button"
            aria-pressed={position === index}
            aria-controls={`${id}-${position}`}
            onClick={() => setIndex(position)}
          >
            <span>0{position + 1}</span> {name}
          </button>
        ))}
      </div>
      <div className="mk-story-controls">
        <span>
          {index + 1} / {slides.length}
        </span>
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? 'Play sequence' : 'Pause sequence'}
        </button>
      </div>
    </div>
  );
}
