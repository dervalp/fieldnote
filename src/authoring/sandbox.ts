import { assertSafeRelativePath } from '../domain/fieldnote-skills/lock';

export interface AuthoringSandbox {
  run(input: {
    files: ReadonlyMap<string, string>;
    prompt: string;
    mode: 'read-only' | 'write-generated';
  }): Promise<{ sandboxId: string; model: string; output: unknown; files: Map<string, string> }>;
}

export function validateAuthoringInput(input: Parameters<AuthoringSandbox['run']>[0]) {
  if (input.files.size > 401 || Buffer.byteLength(input.prompt) > 1024 * 1024)
    throw new Error('Authoring evidence exceeds bounds.');
  let bytes = 0;
  for (const [path, text] of input.files) {
    assertSafeRelativePath(path);
    if (!path.startsWith('evidence/') && path !== 'skill/fieldnote-setup-profile/SKILL.md')
      throw new Error('Invalid authoring evidence path.');
    if (
      /(?:^|\/)\.env|(?:secret|credential|password|private[._-]?key|access[._-]?token)|\.(?:pem|key|p12|pfx)$/i.test(
        path,
      )
    )
      throw new Error('Secret evidence path is forbidden.');
    const size = Buffer.byteLength(text);
    bytes += size;
    if (size > 256 * 1024 || bytes > 4 * 1024 * 1024 + 256 * 1024 || text.includes('\0'))
      throw new Error('Authoring evidence exceeds bounds.');
  }
}

export function validateGeneratedPath(path: string) {
  assertSafeRelativePath(path);
  if (
    !/^\.fieldnote\/(?:profile\.md|definition-of-done\.md|concerns\/[a-z0-9][a-z0-9-]*\.md)$/.test(
      path,
    )
  )
    throw new Error('Invalid generated configuration path.');
}
