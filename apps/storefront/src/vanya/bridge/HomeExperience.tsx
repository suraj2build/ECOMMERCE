'use client';

/**
 * '/' as in the approved design: the Men/Women gateway until a department is
 * chosen, then that department's home. The choice is remembered in this
 * browser; "Atelier Portals" in the header returns to the gateway.
 */
import { useMemo } from 'react';
import type { ShoppableMediaSummary, StorefrontSearchHit } from '@/lib/api';
import { useDepartment } from '@/components/layout/DepartmentContext';
import { LandingGatewayView } from '../views/LandingGatewayView';
import { HomeView, type HomeEditorial } from '../views/HomeView';
import { useShop } from './shop';
import { hitToProduct, mediaToReel } from './adapters';

export interface DepartmentHome {
  products: StorefrontSearchHit[];
  reels: ShoppableMediaSummary[];
  gatewayImage: string | null;
  editorial: HomeEditorial;
}

export function HomeExperience({ men, women }: { men: DepartmentHome; women: DepartmentHome }) {
  const { department, hydrated, chooseDepartment } = useDepartment();
  const shop = useShop();
  const home = department === 'men' ? men : women;
  const products = useMemo(() => home.products.map(hitToProduct), [home.products]);
  const reels = useMemo(() => home.reels.map(mediaToReel), [home.reels]);

  if (!hydrated) return <div className="min-h-screen bg-[#0E0C0B]" aria-hidden />;

  if (!department) {
    return (
      <div className="min-h-screen w-full bg-[#100E0D]">
        <LandingGatewayView
          onSelectDepartment={(dept) => {
            chooseDepartment(dept);
            window.scrollTo({ top: 0 });
          }}
          onOpenSearch={() => shop.setSearchOpen(true)}
          onOpenBag={() => shop.setBagOpen(true)}
          cartCount={shop.cartCount}
          menHeroImage={men.gatewayImage}
          womenHeroImage={women.gatewayImage}
        />
      </div>
    );
  }

  return (
    <HomeView
      products={products}
      reels={reels}
      styledLooks={[]}
      activeGender={department}
      onSelectProduct={(productId) => shop.navigate('pdp', { productId })}
      onNavigate={shop.navigate}
      wishlistIds={shop.wishlistIds}
      onToggleWishlist={(productId) => void shop.toggleWishlist(productId)}
      onQuickAdd={(product, colorName) => shop.setQuickAdd({ product, colorName })}
      onInstantAddSize={(product, colorName, size) => shop.addToBag(product.id, colorName, size)}
      onOpenReel={(reelId) => shop.navigate('reels', { reelId })}
      recentlyViewedIds={[]}
      editorial={home.editorial}
      policies={shop.policies}
      hrefFor={shop.hrefFor}
    />
  );
}
