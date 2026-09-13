import { globToRegExp } from './glob';
import { sectionsWithFencedBlock } from './markdown-sections';
import type { GraderCheck } from './manifest';
import type { CheckResult, EvidenceLineRange, SourceDocument } from './types';

// The rule for adding a primitive: it is extracted from a grader that earned
// it, never speculated into existence. All three below already existed inside
// readiness-v01 as isRootFile/presenceCheck, isDocsMarkdown/presenceCheck and
// documentedCommand/commandCheck. If a proposed primitive has no grader behind
// it, the answer is `kind: code`, not a fourth entry here.

function firstNonblankLine(document: SourceDocument): EvidenceLineRange | undefined {
  const index = document.text.split(/\r?\n/).findIndex((line) => line.trim().length > 0);
  if (index < 0) return undefined;
  return { path: document.path, blobSha: document.blobSha, start: index + 1, end: index + 1 };
}

// A document with no nonblank line still has a line 1 to point at. Evidence is
// the product, so a passing check always names somewhere to look.
function presence(document: SourceDocument, nonempty: boolean): EvidenceLineRange | undefined {
  const range = firstNonblankLine(document);
  if (range) return range;
  return nonempty
    ? undefined
    : { path: document.path, blobSha: document.blobSha, start: 1, end: 1 };
}

function result(
  check: GraderCheck,
  passed: boolean,
  lineRanges: EvidenceLineRange[],
  disclaimer: string,
): CheckResult {
  return {
    id: check.id,
    points: passed ? check.points : 0,
    maxPoints: check.points,
    status: passed ? 'pass' : 'fail',
    paths: passed ? lineRanges.map(({ path }) => path) : [],
    lineRanges: passed ? lineRanges : [],
    explanation: `${passed ? check.explain.pass : check.explain.fail} ${disclaimer}`,
  };
}

export function runCheck(
  check: GraderCheck,
  documents: SourceDocument[],
  disclaimer: string,
): CheckResult {
  if (check.primitive === 'file-exists') {
    const { root, nonempty, anyOf, caseInsensitive } = check.args;
    const names = caseInsensitive ? anyOf.map((name) => name.toLowerCase()) : anyOf;
    const evidence = documents.flatMap((document) => {
      if (root && document.path.includes('/')) return [];
      const path = caseInsensitive ? document.path.toLowerCase() : document.path;
      if (!names.includes(path)) return [];
      const range = presence(document, nonempty);
      return range ? [range] : [];
    });
    return result(check, evidence.length > 0, evidence, disclaimer);
  }

  if (check.primitive === 'glob-count') {
    const { pattern, caseInsensitive, nonempty, min } = check.args;
    const expression = globToRegExp(pattern, caseInsensitive);
    const evidence = documents.flatMap((document) => {
      if (!expression.test(document.path)) return [];
      const range = presence(document, nonempty);
      return range ? [range] : [];
    });
    return result(check, evidence.length >= min, evidence, disclaimer);
  }

  // heading-has-fence. Scope entries are honoured in the order the manifest
  // names them, and a document matched by two entries is scanned once — that
  // order is what a reader of the evidence list sees, so it is part of the
  // contract, not an implementation detail.
  const headings = new Set(check.args.headings.map((heading) => heading.toLowerCase()));
  const seen = new Set<string>();
  const scoped: SourceDocument[] = [];
  for (const entry of check.args.scope) {
    const expression = globToRegExp(entry.pattern, entry.caseInsensitive);
    for (const document of documents) {
      const key = `${document.path}::${document.blobSha}`;
      if (seen.has(key) || !expression.test(document.path)) continue;
      seen.add(key);
      scoped.push(document);
    }
  }
  const evidence = scoped.flatMap((document) => sectionsWithFencedBlock(document, headings));
  return result(check, evidence.length > 0, evidence, disclaimer);
}
