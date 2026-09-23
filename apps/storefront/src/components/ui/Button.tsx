import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'inverse-outline';

// Each variant is a complete, self-contained class set - never combined
// with another variant's classes via string concatenation, since two
// utility classes setting the same CSS property (e.g. text-ink and
// text-canvas both set `color`) race on Tailwind's generated stylesheet
// order rather than on className string order. `inverse` exists
// specifically for a dark/image background (e.g. the Hero) instead of
// overriding `secondary`'s ink-colored defaults from the call site.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'bg-transparent text-ink border border-ink hover:bg-ink hover:text-canvas',
  ghost: 'bg-transparent text-ink hover:bg-surface',
  inverse: 'bg-canvas text-ink hover:bg-canvas/90',
  'inverse-outline': 'bg-transparent text-canvas border border-canvas hover:bg-canvas hover:text-ink',
};

/** Shared class string so a real <a>/<Link> can look like a button without nesting interactive elements inside a <button>. */
export function buttonClassName(variant: ButtonVariant = 'primary', className = ''): string {
  return `inline-flex min-h-[44px] items-center justify-center rounded-sm px-6 py-2.5 text-sm font-medium tracking-wide transition-colors focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClassName(variant, className)} {...props} />;
}
