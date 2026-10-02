import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'inverse-outline';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]',
  secondary: 'bg-white text-[#181716] border border-[#d8d0c6] hover:border-[#181716]',
  ghost: 'bg-transparent text-[#181716] hover:bg-[var(--color-surface-soft)]',
  inverse: 'bg-white text-[#181716] hover:bg-[#f4eee7]',
  'inverse-outline': 'bg-black/20 text-white border border-white/80 hover:bg-white hover:text-[#181716]',
};

export function buttonClassName(variant: ButtonVariant = 'primary', className = ''): string {
  return `inline-flex min-h-[46px] items-center justify-center rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] transition-all focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClassName(variant, className)} {...props} />;
}
