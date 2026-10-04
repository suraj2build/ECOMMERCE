import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { DepartmentProvider } from '@/components/layout/DepartmentContext';
import { ConsentBanner } from '@/components/consent/ConsentBanner';
import { PreviewBanner } from '@/components/layout/PreviewBanner';
import { SITE_URL, getStorefrontCategories, getStorefrontPolicies } from '@/lib/api';
import { FOOTER_MENU_KEYS, cleanMenu } from '@/lib/cms-links';
import { getNavigationMenuItems } from '@/lib/lookups';
import { ShopProvider, type ShopPolicies } from '@/vanya/bridge/shop';
import { StoreShell } from '@/vanya/bridge/StoreShell';
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [categories, terms, aboutItems, socialItems] = await Promise.all([
    getStorefrontCategories(),
    getStorefrontPolicies(),
    getNavigationMenuItems(FOOTER_MENU_KEYS.about),
    getNavigationMenuItems(FOOTER_MENU_KEYS.social),
  ]);
  // Footer About and social links are whatever staff publish in the CMS menus.
  const footerMenus = { about: cleanMenu(aboutItems), social: cleanMenu(socialItems) };
  // Delivery figures are shown only once the shop has confirmed them.
  const confirmed = terms?.shipping.confirmed === true;
  const policies: ShopPolicies = {
    freeDeliveryAbove: confirmed && terms!.shipping.freeAboveAmount > 0 ? terms!.shipping.freeAboveAmount : null,
    deliveryCharge: confirmed ? terms!.shipping.flatAmount : null,
    returnWindowDays: terms?.returns.defaultWindowDays ?? null,
  };

  return (
    <html lang="en" data-theme="women" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <DepartmentProvider>
          <ShopProvider categories={categories.filter((c) => c.slug)} policies={policies} footerMenus={footerMenus}>
            <PreviewBanner />
            <StoreShell>{children}</StoreShell>
            <ConsentBanner />
          </ShopProvider>
        </DepartmentProvider>
      </body>
    </html>
  );
}
