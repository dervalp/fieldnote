// Three named slots, each with a rule about what belongs in it. A control added
// later is a child of one slot, not an append to a flex row — which is the
// difference between this and the .page-topline it replaces.
function Context({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__context">{children}</div>;
}
function Utility({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__utility">{children}</div>;
}
function Identity({ children }: { children?: React.ReactNode }) {
  return <div className="fn-topbar__identity">{children}</div>;
}

export function TopBar({ children }: { children: React.ReactNode }) {
  return <header className="fn-topbar">{children}</header>;
}
TopBar.Context = Context;
TopBar.Utility = Utility;
TopBar.Identity = Identity;
