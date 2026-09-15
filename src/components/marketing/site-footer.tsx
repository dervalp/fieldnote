export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <p className="mk-footer-line">
        <strong>fieldnote</strong> · Evidence-first analytics for AI-written pull requests.
      </p>
      <nav className="mk-footer-links" aria-label="Footer">
        <a href="https://github.com/dervalp/fieldnote">Source</a>
        <a href="https://github.com/dervalp/fieldnote#readme">Documentation</a>
        <a href="https://github.com/dervalp/fieldnote/blob/main/LICENSE">AGPL-3.0</a>
        <a href="/api/auth/login">Sign in</a>
      </nav>
    </footer>
  );
}
