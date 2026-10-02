import Link from 'next/link';
import { Container } from '../ui/Container';

const sections = [
  {
    heading: 'Client Services',
    links: [
      { label: 'Track Order', href: '/orders' },
      { label: 'Returns & Exchanges', href: '/account' },
      { label: 'Your Account', href: '/account' },
      { label: 'Wishlist', href: '/wishlist' },
    ],
  },
  {
    heading: 'Discover',
    links: [
      { label: 'New In', href: '/category/new' },
      { label: 'Collections', href: '/collections' },
      { label: 'Watch & Shop', href: '/watch-and-shop' },
      { label: 'Search', href: '/search' },
    ],
  },
  {
    heading: 'VANYA',
    links: [
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-border bg-[#181512] text-[#f4eee6]">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:py-16">
        <div>
          <p className="font-display text-3xl uppercase tracking-[0.24em]">VANYA</p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-[#c9bbaa]">Indian roots · modern form</p>
          <p className="mt-5 max-w-xs text-sm leading-6 text-[#bfb3a7]">Contemporary Indian fashion shaped by craft, proportion and everyday ease.</p>
        </div>
        {sections.map((section) => (
          <nav key={section.heading} aria-label={section.heading}>
            <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#d9ccbd]">{section.heading}</h2>
            <ul className="mt-4 space-y-3">
              {section.links.map((link) => (
                <li key={link.href}><Link href={link.href} className="text-sm text-[#bfb3a7] transition-colors hover:text-white">{link.label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-t border-white/10 py-6 text-[10px] uppercase tracking-[0.16em] text-[#8f8478]">
        &copy; {new Date().getFullYear()} VANYA. All rights reserved.
      </Container>
    </footer>
  );
}
