export type SourceDocument = {
  path: string;
  blobSha: string;
  text: string;
};

export type RepositorySnapshot = {
  sha: string;
  complete: boolean;
  documents: SourceDocument[];
  metrics?: MetricsWindow | null;
  /** The grader's own sentence when its declared floor was not met. */
  incompleteReason?: string;
};

export type EvidenceLineRange = {
  path: string;
  blobSha: string;
  start: number;
  end: number;
};

export type CheckResult = {
  id: string;
  points: number;
  maxPoints: number;
  status: 'pass' | 'fail';
  paths: string[];
  lineRanges: EvidenceLineRange[];
  explanation: string;
};

export type GradeResult = {
  score: number | null;
  checks: CheckResult[];
  rubricVersion: string;
  evaluatorVersion: string;
  /** Present only for a grader that read a window. A saved report names the
   * dates it scored, so reopening it does not silently mean a different month. */
  window?: { start: string; endExclusive: string; days: number };
  incompleteReason?: string;
};

export type MetricReading = {
  /** Percentage on a 0–100 scale, unrounded. Null when nothing was measurable. */
  value: number | null;
  numerator: number;
  denominator: number;
};

export type MetricsWindow = {
  days: number;
  start: string;
  endExclusive: string;
  mergedPullRequests: number;
  // Keyed by the primitive's own metric names, so runCheck is a lookup rather
  // than a switch and a new metric is a change in one place.
  'first-pass-rate': MetricReading;
  'ci-success-rate': MetricReading;
  'ci-recovery-rate': MetricReading;
};

/** What a primitive is allowed to see: the evidence, never the manifest. */
export type CheckEvidence = {
  documents: SourceDocument[];
  metrics?: MetricsWindow | null;
};
