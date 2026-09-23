import Link from 'next/link';
import { Container } from '../ui/Container';

/**
 * Navigational category tiles. Text/link configuration only - no
 * fabricated product imagery or counts. Backed by a small seed config
 * for now; M29 Admin/CMS will make this staff-editable and M10 will
 * back it with the real category taxonomy without a redesign.
 */
const CATEGORIES = [
  { label: 'Tops', href: '/category/tops' },
  { label: 'Dresses', href: '/category/dresses' },
  { label: 'Outerwear', href: '/category/outerwear' },
  { label: 'Bottoms', href: '/category/bottoms' },
];

export function ShopByCategory() {
  return (
    <section aria-labelledby="shop-by-category-heading" className="py-12">
      <Container>
        <h2 id="shop-by-category-heading" className="font-display text-2xl text-ink">
          Shop by Category
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {CATEGORIES.map((category) => (
            <li key={category.href}>
              <Link
                href={category.href}
                className="flex min-h-[96px] items-center justify-center rounded-sm border border-border bg-surface px-4 py-8 text-center text-sm text-ink transition-colors hover:border-ink"
              >
                {category.label}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
