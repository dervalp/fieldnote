// Product URLs the CLI prints, spelled here rather than inline.
//
// They cannot come from src/lib/app-routes.ts: this is a publishable package
// with no build step, and reaching outside it would break the tarball — the
// same boundary that keeps the grading domain server-side. So the app owns the
// real definition and this is a copy, which means the copy needs a keeper:
// src/lib/app-routes.cli-agreement.test.ts fails if the two ever disagree.
//
// A path, not a URL. The caller resolves it against whichever host it is
// signed in to, which is not always fieldnote.dev.
export const TOKENS_PATH = '/app/settings/tokens';
