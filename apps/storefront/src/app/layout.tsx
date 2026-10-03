import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { DepartmentProvider } from '@/components/layout/DepartmentContext';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ConsentBanner } from '@/components/consent/ConsentBanner';
import { SITE_URL } from '@/lib/api';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'VANYA — Indian Roots · Modern Form',
    template: '%s | VANYA',
  },
  description: 'Modern Indian menswear and womenswear. Timeless silhouettes, contemporary craftsmanship.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="women" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <DepartmentProvider>
          <Header />
          <main id="main-content">{children}</main>
          <Footer />
          <ConsentBanner />
        </DepartmentProvider>
      </body>
    </html>
  );
}
