import Link from 'next/link';
import { buttonClassName } from '../ui/Button';
import { Container } from '../ui/Container';

/**
 * Editorial hero campaign module. Image-led per the design-system
 * requirement; content is configuration for now (M29 Admin/CMS will
 * make this staff-editable without a redesign, per the Phase 2
 * instruction's "structure merchandising modules so M29 CMS can control
 * content later").
 */
export function Hero() {
  return (
    <section aria-label="Campaign" className="relative flex min-h-[70vh] items-end bg-ink text-canvas md:min-h-[80vh]">
      <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
      <Container className="relative z-10 pb-16 pt-32">
        <p className="text-xs uppercase tracking-[0.2em] text-canvas/80">Autumn/Winter</p>
        <h1 className="mt-3 max-w-xl font-display text-4xl leading-tight md:text-6xl">
          Considered fashion, made to last
        </h1>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/category/women" className={buttonClassName('inverse')}>
            Shop Women
          </Link>
          <Link href="/category/men" className={buttonClassName('inverse-outline')}>
            Shop Men
          </Link>
        </div>
      </Container>
    </section>
  );
}
