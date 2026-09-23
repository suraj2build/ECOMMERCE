import Link from 'next/link';
import { Container } from '../ui/Container';

const FOOTER_SECTIONS = [
  {
    heading: 'Help',
    links: [
      { label: 'Track Order', href: '/help/track-order' },
      { label: 'Returns & Exchanges', href: '/help/returns' },
      { label: 'Shipping Info', href: '/help/shipping' },
      { label: 'Contact Us', href: '/help/contact' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms of Service', href: '/legal/terms' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface">
      <Container className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <p className="font-display text-lg text-ink">HOUSE</p>
          <p className="mt-2 max-w-xs text-sm text-ink-muted">
            Considered fashion, made to last. Delivered across India.
          </p>
        </div>
        {FOOTER_SECTIONS.map((section) => (
          <nav key={section.heading} aria-label={section.heading}>
            <h2 className="text-sm font-medium text-ink">{section.heading}</h2>
            <ul className="mt-3 space-y-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-ink-muted hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-t border-border py-6 text-xs text-ink-muted">
        &copy; {new Date().getFullYear()} House Label. All rights reserved.
      </Container>
    </footer>
  );
}
