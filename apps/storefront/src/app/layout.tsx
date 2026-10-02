import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { DepartmentProvider } from '@/components/layout/DepartmentContext';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-vanya-sans', display: 'swap' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-vanya-serif', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'VANYA — Indian Roots · Modern Form',
    template: '%s | VANYA',
  },
  description: 'Contemporary Indian fashion for women and men. Indian roots, modern form.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`} suppressHydrationWarning>
      <body>
        <DepartmentProvider>
          <Header />
          <main id="main-content">{children}</main>
          <Footer />
        </DepartmentProvider>
      </body>
    </html>
  );
}
