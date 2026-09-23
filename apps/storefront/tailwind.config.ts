import type { Config } from 'tailwindcss';

/**
 * Design system foundation (M09, specs/08-storefront.md "Design system").
 * Token-based: every color/radius/shadow value here reads from a CSS
 * custom property (defined in src/styles/tokens.css), never a hard-coded
 * hex/px value, so a brand override (multi-brand requirement,
 * specs/31-organization-locations.md) only needs to redefine the CSS
 * variables under a `[data-brand="..."]` selector - no Tailwind
 * config/rebuild required to add a new owned brand's palette.
 *
 * Restrained editorial aesthetic per the Phase 2 instruction: minimal
 * shadow scale, restrained radii, no generic SaaS/dashboard chrome.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    fontFamily: {
      display: ['var(--font-display)', 'serif'],
      sans: ['var(--font-sans)', 'sans-serif'],
    },
    extend: {
      colors: {
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        ink: 'var(--color-ink)',
        'ink-muted': 'var(--color-ink-muted)',
        border: 'var(--color-border)',
        accent: 'var(--color-accent)',
        'accent-ink': 'var(--color-accent-ink)',
        danger: 'var(--color-danger)',
        success: 'var(--color-success)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        subtle: 'var(--shadow-subtle)',
      },
      maxWidth: {
        container: 'var(--container-max)',
      },
      spacing: {
        gutter: 'var(--gutter)',
      },
    },
  },
  plugins: [],
};

export default config;
