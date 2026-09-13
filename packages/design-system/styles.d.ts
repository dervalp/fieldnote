// The `./styles` export is a plain stylesheet with nothing behind it in
// TypeScript's module graph — `noUncheckedSideEffectImports` still requires a
// side-effect import to resolve to *something* with a declaration, so it gets
// an ambient one here rather than a change to the exports map in
// package.json.
declare module '@fieldnote/design-system/styles';
