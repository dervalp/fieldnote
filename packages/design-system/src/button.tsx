import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from 'react';

const VARIANT = {
  accent: '',
  secondary: 'fn-button-secondary',
  quiet: 'fn-button-quiet',
} as const;

export type ButtonVariant = keyof typeof VARIANT;
export type ButtonSize = 'md' | 'lg';

type Shared = { variant?: ButtonVariant; size?: ButtonSize };

/**
 * `accent` is the default rust fill, `secondary` the ink fill the sign-in
 * button uses, `quiet` an underlined run of text that happens to be a button.
 *
 * `type` is forwarded rather than defaulted: a button inside a form without an
 * explicit type submits it, and several callers rely on exactly that.
 *
 * `as="a"` is what makes a genuine link — the repository header's "GitHub ↗" —
 * renderable without becoming a `<button>`. The union below is discriminated
 * on `as`, so `href` (and the rest of `AnchorHTMLAttributes`) is assignable
 * only on the `as="a"` branch; the `<button>` branch has no `href` to accept
 * it.
 *
 * `ref` is declared explicitly (React 19's "ref as a prop": no `forwardRef`
 * needed) rather than left to `ButtonHTMLAttributes`/`AnchorHTMLAttributes`,
 * neither of which carries it — a real call site (the dashboard's history
 * dialog trigger) holds a ref to the rendered element for focus management.
 * It is spread onto the host element with everything else, so it reaches the
 * DOM node the way any other native prop does.
 */
export type ButtonProps =
  | ({ as?: 'button'; ref?: Ref<HTMLButtonElement> } & Shared &
      ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: 'a'; ref?: Ref<HTMLAnchorElement> } & Shared & AnchorHTMLAttributes<HTMLAnchorElement>);

export function Button(props: ButtonProps) {
  const { variant = 'accent', size = 'md', className, as, ...rest } = props;
  const classes = ['fn-button', VARIANT[variant], size === 'lg' ? 'fn-button-lg' : '', className]
    .filter(Boolean)
    .join(' ');
  if (as === 'a') {
    return <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
  }
  return <button className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} />;
}
