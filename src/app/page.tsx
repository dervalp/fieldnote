import { SiteNav } from '../components/marketing/site-nav';
import { Hero } from '../components/marketing/hero';
import {
  AgentWalkthrough,
  PullRequestStory,
  GradeProgress,
  EvidenceTrust,
} from '../components/marketing/improvement-story';
import { Signup } from '../components/marketing/signup';
import { SiteFooter } from '../components/marketing/site-footer';
import '../components/marketing/marketing.css';
import '../components/marketing/improvement-story.css';

export const metadata = {
  title: 'Get your ultimate harness',
  description:
    'Find your repository’s next improvement. Inspect agent-readiness checks, understand pull-request history, and trace each grade to its evidence.',
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
 *
 * Dropping that session check also dropped the last dynamic API on this page,
 * so / is now statically prerendered at build time and served from the
 * full-route cache. That is the behaviour we want for a landing page. But it
 * means anything added here that depends on who is visiting — a signed-in nav
 * state, a per-visitor greeting — has to opt back into dynamic rendering, or it
 * will be baked once at build time and shown to everyone.
 */
export default async function Landing() {
  return (
    <main id="main-content" className="mk-page" tabIndex={-1}>
      <div className="mk-shell">
        <SiteNav />
        <Hero />
      </div>
      <AgentWalkthrough />
      <PullRequestStory />
      <GradeProgress />
      <EvidenceTrust />
      <div className="mk-story-wash">
        <div className="mk-shell">
          <Signup />
        </div>
      </div>
      <div className="mk-shell">
        <SiteFooter />
      </div>
    </main>
  );
}
