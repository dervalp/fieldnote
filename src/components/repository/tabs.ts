// Pure routing description for the repository tab bar. No JSX, no client
// runtime: selection is expressed by route, so the routing logic is testable
// without rendering a component or pulling next/link into the test graph.
import { repoPath, repoSectionPath } from '../../lib/app-routes';

export type RepositoryTabSegment = null | 'grading' | 'ai-involvement' | 'delivery' | 'settings';

export interface RepositoryTab {
  /** The route segment one level below the repository layout; null is the landing view. */
  segment: RepositoryTabSegment;
  label: string;
}

export const tabs: RepositoryTab[] = [
  { segment: null, label: 'Agents' },
  { segment: 'grading', label: 'Readiness' },
  { segment: 'ai-involvement', label: 'Involvement' },
  { segment: 'delivery', label: 'Delivery' },
  { segment: 'settings', label: 'Settings' },
];

/** `segment` is what useSelectedLayoutSegment() returns for the repository layout. */
export function isActive(tab: RepositoryTab, segment: string | null): boolean {
  return tab.segment === segment;
}

/**
 * `search` is the current query string (with or without its leading `?`), which
 * the tab bar reads from useSearchParams(). It is carried across every tab
 * because the date range arrives in the URL from /repos and is preserved by the
 * body links between views — a tab that dropped it would silently reset the
 * range the reader chose. Nothing is filtered out: a view ignores the params it
 * does not read, and preserving all of them is what keeps `projection` (and the
 * selected saved `run`) alive across a round trip, the same way DateRange
 * preserves unrelated params.
 */
export function tabHref(repoId: string, tab: RepositoryTab, search = ''): string {
  return tab.segment ? repoSectionPath(repoId, tab.segment, search) : repoPath(repoId, search);
}

/**
 * Which tab holds the bar's single tab stop. Falls back to the first tab, so a
 * route added under [repoId] without a tab entry cannot leave every anchor at
 * tabIndex -1 and the whole bar unreachable by keyboard.
 */
export function focusIndex(segment: string | null): number {
  const selected = tabs.findIndex((tab) => isActive(tab, segment));
  return selected === -1 ? 0 : selected;
}

/** The single panel all five tabs control; shared so the id cannot drift. */
export const TAB_PANEL_ID = 'repo-panel';
