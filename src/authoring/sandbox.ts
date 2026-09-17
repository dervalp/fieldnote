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
  assertCredentialFree(input.prompt);
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
    assertCredentialFree(text);
  }
}

const credentialField = (key: string) =>
  /(?:password|passwd|pwd|secret|token|apikey|accesskey(?:id)?|privatekey|signingkey|encryptionkey|accountkey|storagekey|authorization|connectionstring)$/i.test(
    key.replace(/[_.-]/g, ''),
  );

function literalCredential(value: unknown): boolean {
  if (value === null || value === false || value === true) return false;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  let text = String(value).trim();
  const quoted = /^("(?:\\.|[^"\\])*"|'[^']*'|`[^`]*`)(\s*[,}\]].*)?$/.exec(text);
  if (quoted) text = quoted[1].slice(1, -1);
  else text = text.replace(/[,;]$/, '').trim();
  if (!text || /^(?:null|true|false|TODO|TBD|REDACTED|\(none\)|\*+|<[^>]+>)$/i.test(text))
    return false;
  // A reference is not a credential. Defaults or appended literal material are
  // deliberately not treated as references, since those can contain a secret.
  return (
    !/^(?:Bearer\s+)?\$(?:[A-Z_]\w*|\{[A-Z_]\w*\}|\{\{\s*(?:secrets|env|vars)\.[\w.]+\s*\}\})$/i.test(
      text,
    ) && !/^(?:process\.env\.[A-Z_]\w*|os\.environ\[["'][A-Z_]\w*["']\])$/i.test(text)
  );
}

/** Reject high-confidence credential material without including input in errors.
 * This detects literals, not every possible encoding; it never rewrites evidence. */
export function assertCredentialFree(content: string): void {
  const reject = () => {
    throw new Error('Authoring input contains credential material.');
  };
  const inspect = (text: string, depth: number): void => {
    if (
      /-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/.test(text) ||
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,})|(?:sk|rk)_live_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/.test(
        text,
      )
    )
      reject();
    for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s@]+)@/gi))
      if (literalCredential(match[1])) reject();
    // JSON parsing exposes nested objects and escaped strings in durable notes
    // and in the constructed prompt, instead of scanning only their encoding.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* YAML/dotenv/prose below. */
    }
    if (parsed !== undefined && depth < 20) {
      const visit = (value: unknown, credentialContext = false): void => {
        if (credentialContext && literalCredential(value)) reject();
        if (typeof value === 'string') {
          if (value !== text) inspect(value, depth + 1);
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) visit(item, credentialContext);
          return;
        }
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const namedCredential = typeof record.name === 'string' && credentialField(record.name);
        for (const [key, item] of Object.entries(record)) {
          visit(
            item,
            credentialContext || credentialField(key) || (key === 'value' && namedCredential),
          );
        }
      };
      visit(parsed);
      return;
    }
    let envName: string | undefined;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (const match of line.matchAll(
        /(?:^|[\s{[,])["'`]?([A-Za-z_][\w.-]*)["'`]?[ \t]*[:=][ \t]*/g,
      )) {
        const key = match[1];
        let value = line
          .slice(match.index! + match[0].length)
          .replace(/\s+#.*$/, '')
          .trim();
        if (key === 'name') envName = value.replace(/^["']|["',]+$/g, '');
        if (!credentialField(key) && !(key === 'value' && envName && credentialField(envName)))
          continue;
        if (
          /^[|>][+-]?$/.test(value) ||
          (!value && (lines[index + 1]?.search(/\S/) ?? -1) > line.search(/\S/))
        )
          value = lines[index + 1]?.trim() ?? '';
        if (literalCredential(value)) reject();
        if (key === 'value') envName = undefined;
      }
    }
  };
  inspect(content, 0);
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
