// A manifest names evidence with globs, so fieldnote needs a matcher. This is
// deliberately the smallest one that covers what a declarative grader can
// request: `**/` for directory depth, `*` and `?` within a segment, and
// `{a,b}` for extensions. Everything else is literal. A third-party manifest
// is untrusted input, so the compiled expression must never be able to
// backtrack catastrophically — every construct here is linear.
const LITERAL = /[\\^$.*+?()[\]{}|]/g;

export function globToRegExp(pattern: string, caseInsensitive = false): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern.startsWith('**/', i)) {
        source += '(?:[^/]+/)*';
        i += 2;
      } else if (pattern.startsWith('**', i)) {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const branches = pattern
          .slice(i + 1, close)
          .split(',')
          .map((branch) => branch.replace(LITERAL, '\\$&'));
        source += `(?:${branches.join('|')})`;
        i = close;
        continue;
      }
    }
    source += char.replace(LITERAL, '\\$&');
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'i' : '');
}
