import { SiteNav } from '../components/marketing/site-nav';
import { Hero } from '../components/marketing/hero';
import { TierLadder } from '../components/marketing/tier-ladder';
import { RubricGrid } from '../components/marketing/rubric-grid';
import { LoopStages } from '../components/marketing/loop-stages';
import { MetricTable } from '../components/marketing/metric-table';
import { Guarantees } from '../components/marketing/guarantees';
import { Signup } from '../components/marketing/signup';
import { SiteFooter } from '../components/marketing/site-footer';
import '../components/marketing/marketing.css';

export const metadata = {
  title: 'Get your ultimate harness',
  description:
    'Agent readiness, graded out of 100. fieldnote scores the repository your coding agents work in, across five deterministic checks with file and line evidence — no LLM judges.',
};

/**
 * The public landing page, and the third public surface alongside /signed-out
 * and /invitations/[token].
 *
 * It renders for everyone, signed in or not. It used to redirect a visitor
 * holding a session to /dashboard, which made the pitch unreadable to anyone
 * with an account — no way to check a metric definition or link a colleague
 * without signing out. The product now lives under /app, so / is free to be
 * the website unconditionally.
 *
 * No (app) route group is needed for this. The root layout is thin — html,
 * body, the skip link and the stylesheet import — and the app shell is applied
 * per section under src/app/app/. So this page sits at / with its own <main>.
 *
 * That <main id="main-content"> is required rather than decorative: the root
 * layout renders a skip link pointing at it, and this page supplies no
 * AppShell to provide one.
 */
export default async function Landing() {
  return (
    <main id="main-content" className="mk-page" tabIndex={-1}>
      <div className="mk-shell">
        <SiteNav />
        <Hero />
        <TierLadder />
        <RubricGrid />
        <LoopStages />
        <MetricTable />
        <Guarantees />
        <Signup />
        <SiteFooter />
      </div>
    </main>
  );
}
