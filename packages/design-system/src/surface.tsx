import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type SurfaceProps = {
  as?: 'section' | 'div';
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'section'>, 'className' | 'children'> & {
    // React's own HTML attribute types carry no index signature for arbitrary
    // data-* attributes, and several migrated call sites (the basic
    // dashboard's KPI cards) key off one.
    [attribute: `data-${string}`]: string | number | boolean | undefined;
  };

/**
 * The glass card the whole product sits on. Renders a `<section>` by default —
 * which is also what the bare element selector in components.css styles, so
 * existing app markup and this component land on exactly the same treatment.
 * `as="div"` is for the places where a section would be a landmark the page
 * does not want.
 *
 * Every prop other than `as`/`className`/`children` passes straight through to
 * the rendered element — `id`, `style`, `aria-*`, `data-*` — because the
 * `<section>`s this replaced carried exactly those, and a primitive that
 * swallows them makes migrating a call site a rewrite rather than a rename.
 */
export function Surface({ as = 'section', className, children, ...rest }: SurfaceProps) {
  const classes = ['fn-surface', className].filter(Boolean).join(' ');
  const Tag = as;
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
