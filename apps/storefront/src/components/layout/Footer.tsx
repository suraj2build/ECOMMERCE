import Link from 'next/link';
import { Container } from '../ui/Container';

const GROUPS = [
  {
    title: 'Client services',
    links: [
      ['Track order', '/orders'],
      ['Returns & exchanges', '/account'],
      ['Wishlist', '/wishlist'],
      ['Shopping bag', '/bag'],
    ],
  },
  {
    title: 'Discover VANYA',
    links: [
      ['Women', '/category/women'],
      ['Men', '/category/men'],
      ['Collections', '/collections'],
      ['Watch & Shop', '/watch-and-shop'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['Privacy', '/legal/privacy'],
      ['Terms', '/legal/terms'],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border bg-[#171411] text-[#f4eee6]">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:py-16">
        <div>
          <p className="font-display text-3xl uppercase tracking-[0.24em]">VANYA</p>
          <p className="mt-2 text-[9px] uppercase tracking-[0.22em] text-[#bdb2a5]">Indian roots · modern form</p>
          <p className="mt-5 max-w-xs text-xs leading-6 text-[#bdb2a5]">
            Timeless silhouettes and contemporary craftsmanship for modern India.
          </p>
        </div>
        {GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#f4eee6]">{group.title}</h2>
            <ul className="mt-4 space-y-3">
              {group.links.map(([label, href]) => (
                <li key={href + label}>
                  <Link href={href} className="text-xs text-[#bdb2a5] transition-colors hover:text-white">{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-t border-white/10 py-5 text-[9px] uppercase tracking-[0.16em] text-[#8f857a]">
        &copy; {new Date().getFullYear()} VANYA. India.
      </Container>
    </footer>
  );
}
