export type Crumb = { label: string; href?: string };

// Presentational, and — like every component in this package — it renders a
// plain <a> rather than importing next/link. The trail comes from the section
// layout, which is the only place that knows the repository's name: AppShell
// renders above the route segment and cannot read it.
export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="fn-crumb" aria-label="Breadcrumb">
      {trail.map((crumb, index) => {
        const isLast = index === trail.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="fn-crumb__item">
            {index > 0 && (
              <span className="fn-crumb__sep" aria-hidden="true">
                /
              </span>
            )}
            {isLast ? (
              <span aria-current="page">{crumb.label}</span>
            ) : crumb.href ? (
              <a href={crumb.href}>{crumb.label}</a>
            ) : (
              <span>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
