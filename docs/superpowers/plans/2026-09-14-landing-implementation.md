# Approved landing page implementation

**Goal:** Implement the approved September 14 visual study on the public landing page.

**Architecture:** Keep the hero and brand components. Server components supply the narrative and analyzer-derived PR evidence. A small reusable client carousel controls only selection, visibility-aware playback, and transitions. CSS is scoped to marketing.

**Tech stack:** Next.js 16.3.4, React 19, existing design-system tokens, CSS animations.

**Approved design:** `docs/superpowers/previews/2026-09-14-landing-visual.html`, including all subsequent user corrections. The user approved implementation in this task.

## Constraints

- Preserve original logo and hero animation; remove the zero-LLM claim.
- Hero flows directly into the compact agent terminal. Do not restore the removed introductory section.
- Keep the dark PR timeline, prismatic progress, revised trust copy and real GitHub CTA.
- No dead navigation or Explore the example links.
- Terminal tokens and runs are illustrative, not measured product telemetry.
- PR claims come from the existing analyzer fixture.
- Independent carousel pause controls, reduced-motion support, keyboard operation, visible static fallback, and no hover-induced stalls.

## Tasks

- [x] Add carousel lifecycle with regression coverage for visibility, pause, selection, and wraparound. Keep all slides readable without JavaScript.
- [x] Add server-rendered terminal, evidence, progress and trust sections. Wire public page and anchors; remove obsolete public copy.
- [x] Port the approved responsive layout to scoped CSS using shared tokens and the existing prismatic card.
- [x] Run unit tests, lint, typecheck, production build, and browser review of playback and narrow layout. Fix failures before reporting completion.

Implementation stays on `codex/landing-improvement-story` in the current checkout. No deployment requested.

## Verification

- 936 unit tests passed across 119 files. Existing CLI loopback tests required execution outside the restricted sandbox.
- ESLint, TypeScript and Next.js production build passed. Public landing route remains statically prerendered.
- Browser checks at 390px and 1440px: no horizontal overflow; manual selection, automatic advancement, pause/play, and dark-surface contrast verified.
- Server-rendering coverage confirms static examples and all in-page anchors.
- Independent code review found dark-note specificity issue; corrected and browser verified.
- Local review server: http://localhost:3014. No deployment performed.
