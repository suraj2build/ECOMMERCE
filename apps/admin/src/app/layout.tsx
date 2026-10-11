import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

// Self-hosted at build time (next/font) - no runtime request, no layout
// shift. Exposed as a CSS variable so globals.css's font-family token
// picks it up without hardcoding the font name in more than one place.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: 'Admin | Fashion Commerce Platform',
  description: 'Internal staff administration application.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
