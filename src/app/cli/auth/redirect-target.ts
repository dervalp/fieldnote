// The CLI redirects only to a loopback listener it just opened. An unrestricted
// redirect here would let a crafted link turn a victim's own approval click into
// a token for their account, delivered to somebody else's server — so the origin
// is validated, not merely the parameter's presence.
export function isLoopbackRedirect(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}
