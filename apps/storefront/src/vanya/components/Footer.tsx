'use client';

/**
 * The approved AI Studio footer (Stitch-Spark_Ai_Studio components/Footer.tsx).
 * Markup and classes are the design's own. Left out because they would state
 * unapproved or fabricated facts: the rewards earning rules (1 pt per ₹10,
 * festive multipliers, 100 pts = ₹50, tier perks), the "Trending Categories"
 * chart (invented demand data), the simulated newsletter sign-up (no
 * newsletter service; email updates are chosen in account preferences), and
 * an unconfirmed company name in the legal line. Delivery and returns come
 * from the shop's configured policies (GET /storefront/policies).
 */
import React from 'react';
import Link from 'next/link';
import { ShieldCheck, RefreshCw, Truck, HeartHandshake, Coins, Award, ArrowRight } from 'lucide-react';
import { PrivacyChoicesButton } from '@/components/consent/ConsentBanner';
import { useShop } from '../bridge/shop';
import { formatPrice } from '../utils/format';

export function Footer() {
  const { gender: currentGender, policies, hrefFor, navigate, openSizeGuide } = useShop();
  const { freeDeliveryAbove } = policies;
  const isMen = currentGender === 'men';
  const shop = (category: string) => hrefFor('plp', { gender: currentGender, category });

  return (
    <footer id="main-footer" className="bg-[#1A1816] text-[#FAF8F5] pt-14 pb-8 border-t border-[#312C28]">
      {/* Brand Trust Strip */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 border-b border-[#312C28]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
            <Truck className="w-5 h-5 text-[#D4AF37] shrink-0 mt-0.5" />
            <div>
              <h5 className="text-xs uppercase tracking-widest font-semibold text-[#EDE6DC]">
                {freeDeliveryAbove !== null ? 'Complimentary Shipping' : 'Delivery to Your PIN Code'}
              </h5>
              <p className="text-[11px] text-[#A69A8E] mt-0.5">
                {freeDeliveryAbove !== null
                  ? `Free delivery on orders above ${formatPrice(freeDeliveryAbove)}`
                  : 'PIN code checked before you pay'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
            <RefreshCw className="w-5 h-5 text-[#D4AF37] shrink-0 mt-0.5" />
            <div>
              <h5 className="text-xs uppercase tracking-widest font-semibold text-[#EDE6DC]">
                {/* EXC-002 decides size and colour exchanges. No day count: whether
                    exchanges share the return window (EXC-003) awaits Product Owner
                    confirmation, and categories/products may override it; each product
                    page shows its own window. */}
                Size &amp; Colour Exchanges
              </h5>
              <p className="text-[11px] text-[#A69A8E] mt-0.5">
                On eligible items, from your orders
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
            <HeartHandshake className="w-5 h-5 text-[#D4AF37] shrink-0 mt-0.5" />
            <div>
              <h5 className="text-xs uppercase tracking-widest font-semibold text-[#EDE6DC]">
                Artisanal Craft
              </h5>
              <p className="text-[11px] text-[#A69A8E] mt-0.5">
                Woven by master artisan clusters across India
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#D4AF37] shrink-0 mt-0.5" />
            <div>
              <h5 className="text-xs uppercase tracking-widest font-semibold text-[#EDE6DC]">
                Secure Checkout
              </h5>
              <p className="text-[11px] text-[#A69A8E] mt-0.5">
                UPI, NetBanking, Cards &amp; Cash on Delivery
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Vanya Rewards Loyalty Section */}
      <div id="vanya-rewards-footer-section" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 border-b border-[#312C28]">
        <div className="bg-gradient-to-r from-[#241F1A] via-[#2B231D] to-[#201A16] border border-[#44382B] rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-lg">
          {/* Subtle gold ambient glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-[10px] uppercase tracking-[0.24em] font-bold text-[#D4AF37]">
                  Vanya Rewards • The Atelier Loyalty Circle
                </span>
              </div>
              <h4 className="font-editorial text-2xl sm:text-3xl text-white font-normal mt-1 tracking-wide">
                Earn Handcrafted Privileges on Every Purchase
              </h4>
              <p className="text-xs text-[#B5A89B] max-w-2xl mt-1 leading-relaxed">
                Collect Atelier Points on your orders and redeem them at checkout.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Link
                href="/account/loyalty"
                className="px-6 py-2.5 bg-[#FAF8F5] hover:bg-[#EAE4D8] text-[#1A1816] text-xs font-semibold uppercase tracking-wider rounded-full transition-all flex items-center gap-2 cursor-pointer shadow-sm hover:shadow-md"
              >
                <Award className="w-3.5 h-3.5 text-[#C29B38]" />
                <span>Check Your Balance</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Links */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-[#292420]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* Brand Intro Column */}
          <div className="lg:col-span-3 space-y-3">
            <div className="font-editorial text-2xl sm:text-3xl tracking-[0.24em] font-normal uppercase text-white">
              VANYA
            </div>
            <span className="text-[9px] tracking-[0.28em] uppercase text-[#A89E92] font-light block">
              — INDIAN ROOTS · MODERN TODAY —
            </span>
            <p className="text-xs text-[#A89E92] font-light leading-relaxed max-w-xs pt-1 italic sm:not-italic">
              &ldquo;Modern Indian {isMen ? 'menswear' : 'womenswear'} for a more thoughtful tomorrow.&rdquo;
            </p>
          </div>

          {/* Column 1: Shop (Strictly dedicated to current gender catalog) */}
          <nav aria-label={`Shop ${isMen ? 'Men' : 'Women'}`} className="lg:col-span-2 space-y-3">
            <span className="text-xs uppercase tracking-[0.18em] font-medium text-white block">
              Shop {isMen ? 'Men' : 'Women'}
            </span>
            <ul className="space-y-2 text-xs text-[#A89E92] font-light">
              <li>
                <Link href={shop('all')} className="hover:text-white transition-colors cursor-pointer">
                  New In
                </Link>
              </li>
              <li>
                <Link href={shop(isMen ? 'Festive & Ceremonial' : 'Festive Silk Edit')} className="hover:text-white transition-colors cursor-pointer">
                  {isMen ? 'Festive & Ceremonial' : 'Festive Silk Edit'}
                </Link>
              </li>
              {(isMen
                ? ([['Bandhgalas & Jackets', 'Bandhgalas & Jackets'], ['Handloom Kurtas', 'Kurtas'], ['Linen & Silk Shirts', 'Linen & Silk Shirts'], ['Pleated Trousers', 'Pleated Trousers']] as const)
                : ([['Modern Sarees', 'Modern Sarees'], ['Co-ords & Sets', 'Co-ords & Sets'], ['Dresses & Drapes', 'Dresses']] as const)
              ).map(([label, category]) => (
                <li key={label}>
                  <Link href={shop(category)} className="hover:text-white transition-colors cursor-pointer">
                    {label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/collections" className="hover:text-white transition-colors cursor-pointer">
                  Collections
                </Link>
              </li>
              <li className="pt-1.5 border-t border-[#312C28]">
                <button
                  type="button"
                  onClick={() => navigate('gateway')}
                  className="text-[var(--color-primary-on-dark)] hover:underline transition-colors cursor-pointer font-medium flex items-center gap-1 text-[11px]"
                  title="Return to Atelier Gateway to choose department"
                >
                  <span>← Switch Department (Main Portal)</span>
                </button>
              </li>
            </ul>
          </nav>

          {/* Column 2: Help */}
          <nav aria-label="Help" className="lg:col-span-2 space-y-3">
            <span className="text-xs uppercase tracking-[0.18em] font-medium text-white block">
              Help
            </span>
            <ul className="space-y-2 text-xs text-[#A89E92] font-light">
              <li>
                <button type="button" onClick={() => openSizeGuide()} className="hover:text-white transition-colors cursor-pointer">
                  Size Guide
                </button>
              </li>
              <li>
                <Link href="/orders" className="hover:text-white transition-colors cursor-pointer">
                  Returns &amp; Exchanges
                </Link>
              </li>
              <li>
                <Link href="/orders" className="hover:text-white transition-colors cursor-pointer">
                  Track Order
                </Link>
              </li>
              <li>
                <Link href="/wishlist" className="hover:text-white transition-colors cursor-pointer">
                  Wishlist
                </Link>
              </li>
              <li>
                <Link href="/bag" className="hover:text-white transition-colors cursor-pointer">
                  Shopping Bag
                </Link>
              </li>
            </ul>
          </nav>

          {/* Column 3: About Vanya */}
          <div className="lg:col-span-2 space-y-3">
            <span className="text-xs uppercase tracking-[0.18em] font-medium text-white block">
              About Vanya
            </span>
            <ul className="space-y-2 text-xs text-[#A89E92] font-light">
              <li>
                <Link href="/watch-and-shop" className="hover:text-white transition-colors cursor-pointer">Watch &amp; Shop</Link>
              </li>
              <li>
                <Link href="/collections" className="hover:text-white transition-colors cursor-pointer">Craft &amp; Collections</Link>
              </li>
            </ul>
          </div>

          {/* Column 4: Join The Atelier */}
          <div className="lg:col-span-3 space-y-3.5">
            <span className="text-xs uppercase tracking-[0.18em] font-medium text-white block">
              Join The Atelier
            </span>
            <p className="text-xs text-[#A89E92] font-light">
              Exclusive updates, styling stories and early access.
            </p>
            <Link
              href="/account/preferences"
              className="inline-flex items-center gap-2 bg-[#12100E] border border-[#3A332C] px-4 py-2.5 text-xs text-white rounded-full hover:border-[#C5A278] transition-colors"
            >
              <span>Choose email updates in your account</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Legal & Copyright */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 border-t border-[#2B2622] flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#A39789] gap-3">
        <div>
          © {new Date().getFullYear()} VANYA. All rights reserved.
        </div>
        <nav aria-label="Legal" className="flex gap-4">
          <Link href="/legal/privacy" className="hover:text-[#B5A89B] cursor-pointer">Privacy Policy</Link>
          <span aria-hidden="true">•</span>
          <Link href="/legal/terms" className="hover:text-[#B5A89B] cursor-pointer">Terms of Service</Link>
          <PrivacyChoicesButton className="hover:text-[#B5A89B] cursor-pointer" />
        </nav>
      </div>
    </footer>
  );
}
