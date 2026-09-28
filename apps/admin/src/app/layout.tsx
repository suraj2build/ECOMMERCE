import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Admin | Fashion Commerce Platform',
  description: 'Internal staff administration application.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
