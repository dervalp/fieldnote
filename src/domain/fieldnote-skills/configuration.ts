/** Required repository configuration for authoring, execution, and verification. */
export const requiredConfiguration = [
  '.fieldnote/profile.md',
  '.fieldnote/definition-of-done.md',
  '.fieldnote/concerns/shared.md',
] as const;

export function configurationProblems(files: ReadonlyMap<string, string>): string[] {
  return requiredConfiguration.flatMap((path) => {
    const content = files.get(path);
    if (content === undefined) return [`Missing ${path}.`];
    if (!content.trim() || /\b(?:TODO|TBD|unknown)\b/i.test(content))
      return [`Unresolved ${path}.`];
    return [];
  });
}
export function assertCompleteConfiguration(files: ReadonlyMap<string, string>): void {
  if (configurationProblems(files).length)
    throw new Error('Required Fieldnote configuration is missing or unresolved.');
}

export const supportingConfigurationDefaults = [
  {
    path: requiredConfiguration[1],
    content:
      '# Definition of done\n\nFollow the repository acceptance criteria and the check and preflight commands in `.fieldnote/profile.md`. Record the verification performed and any remaining limitations in the pull request.\n',
  },
  {
    path: requiredConfiguration[2],
    content:
      '# Shared concerns\n\nFollow repository instructions and the confirmed facts in `.fieldnote/profile.md`. Review correctness, test coverage, security, and compatibility for each change, and explain relevant risks in the pull request.\n',
  },
];
