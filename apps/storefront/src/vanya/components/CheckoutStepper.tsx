import Link from 'next/link';

export type CheckoutStep = 'bag' | 'address' | 'payment';

const STEPS: { key: CheckoutStep; label: string }[] = [
  { key: 'bag', label: 'Bag' },
  { key: 'address', label: 'Address' },
  { key: 'payment', label: 'Payment' },
];

/**
 * A visual Bag -> Address -> Payment progress indicator. This never implies
 * separate pages or routes for Address/Payment - checkout stays the single
 * page it already is (see app/checkout/page.tsx's own doc comment); on that
 * page `current` is driven by a scroll-spy over its two existing sections,
 * honestly reflecting "which part of the one page you're looking at" rather
 * than pretending they're independent steps.
 */
export function CheckoutStepper({
  current,
  bagHref = '/bag',
}: {
  /** 'complete' shows every step as done (the post-order confirmation page). */
  current: CheckoutStep | 'complete';
  bagHref?: string;
}) {
  const currentIndex = current === 'complete' ? STEPS.length : STEPS.findIndex((s) => s.key === current);

  return (
    <ol aria-label="Checkout progress" className="mb-6 flex items-center gap-2 text-xs sm:gap-4">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        const badgeClass = isCurrent
          ? 'bg-[var(--color-primary)] text-white'
          : isDone
          ? 'bg-[#EAE3D7] text-[#5C5146]'
          : 'border border-[#DDD3C5] text-[#B9AE9F]';
        const labelClass = isCurrent ? 'text-[#1A1816] font-semibold' : isDone ? 'text-[#756A5E]' : 'text-[#B9AE9F]';
        const content = (
          <span className={`flex items-center gap-1.5 ${labelClass}`}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${badgeClass}`}>
              {isDone ? '✓' : i + 1}
            </span>
            {step.label}
          </span>
        );
        return (
          <li key={step.key} className="flex items-center gap-2 sm:gap-4">
            {step.key === 'bag' && isDone ? (
              <Link href={bagHref} aria-current={isCurrent ? 'step' : undefined}>
                {content}
              </Link>
            ) : (
              <span aria-current={isCurrent ? 'step' : undefined}>{content}</span>
            )}
            {i < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-4 bg-[#DDD3C5] sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
