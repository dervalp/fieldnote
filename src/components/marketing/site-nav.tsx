import { Brand } from '@fieldnote/design-system';

/** The public header. Plain anchors throughout: this page is the only thing
 *  that renders it, and every destination is either an in-page anchor or the
 *  sign-in route. */
export function SiteNav() {
  return (
    <header className="mk-nav">
      <Brand href="/" />
      <nav className="mk-nav-links" aria-label="Sections">
        <a href="#rubric">The rubric</a>
        <a href="#how">How it works</a>
        <a href="#evidence">The evidence</a>
        <a href="#self-host">Self-host</a>
      </nav>
      <div className="mk-nav-actions">
        <a className="fn-button-quiet mk-nav-signin" href="/api/auth/login">
          Sign in
        </a>
        <a className="fn-button fn-button-lg" href="/api/auth/login">
          Try it now
        </a>
      </div>
    </header>
  );
}
