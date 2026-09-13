import { globToRegExp } from './glob';
import { sectionsWithFencedBlock } from './markdown-sections';
import { UTC_DAY_MS } from '../dashboard/range';
import type { GraderCheck } from './manifest';
import type { CheckEvidence, CheckResult, EvidenceLineRange, SourceDocument } from './types';

// The rule for adding a primitive: it is extracted from a grader that earned
// it, never speculated into existence. All three below already existed inside
// readiness-v01 as isRootFile/presenceCheck, isDocsMarkdown/presenceCheck and
// documentedCommand/commandCheck. If a proposed primitive has no grader behind
// it, the answer is `kind: code`, not a fourth entry here.
// `metric-threshold` is the fourth, extracted the same way: all three metrics
// it can read are computed today by aggregatePeriod() and rendered on the
// Delivery tab. fieldnote/delivery-health earned it.

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
  evidence: CheckEvidence,
  disclaimer: string,
): CheckResult {
  const documents = evidence.documents;

  if (check.primitive === 'metric-threshold') {
    const { metric, atLeastPercent } = check.args;
    const window = evidence.metrics;
    // A manifest that reaches here declared fieldnote.metrics — parseManifest
    // refuses otherwise — and the dispatcher collects what a manifest declared.
    // A missing window is a wiring bug, not a state a repository can be in.
    if (!window) throw new Error('Metric evidence is missing for a metric-threshold check');
    const reading = window[metric];
    // endExclusive is midnight after the last counted day; a reader wants the
    // last day that counted.
    const ending = new Date(Date.parse(window.endExclusive) - UTC_DAY_MS)
      .toISOString()
      .slice(0, 10);
    // The rounded value is compared and the rounded value is printed, so the
    // number a reader sees is the number that decided the check.
    const rounded = reading.value === null ? null : Math.round(reading.value);
    const passed = rounded !== null && rounded >= atLeastPercent;
    const measured =
      rounded === null
        ? `Nothing measurable in the ${window.days} days ending ${ending}.`
        : `Measured ${rounded}% (${reading.numerator} of ${reading.denominator}) over the ${window.days} days ending ${ending}, against a ${atLeastPercent}% bar.`;
    return {
      id: check.id,
      points: passed ? check.points : 0,
      maxPoints: check.points,
      status: passed ? 'pass' : 'fail',
      // A metric check has nothing to point at. Its evidence is the number,
      // which is why the measurement is in the explanation rather than absent.
      paths: [],
      lineRanges: [],
      explanation: `${passed ? check.explain.pass : check.explain.fail} ${measured} ${disclaimer}`,
    };
  }

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

  if (check.primitive === 'heading-has-fence') {
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

  // Exhaustiveness check: all union members must be handled above.
  const never: never = check;
  throw new Error(`Primitive '${(never as any).primitive}' is not implemented.`);
}
