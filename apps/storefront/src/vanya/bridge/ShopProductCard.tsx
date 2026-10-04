'use client';

import { ProductCard } from '../components/ProductCard';
import type { Product } from '../types';
import { useShop } from './shop';

/** The design's product card, wired to the real wishlist, quick add and bag. */
export function ShopProductCard({ product }: { product: Product }) {
  const { wishlistIds, toggleWishlist, setQuickAdd, addToBag } = useShop();
  return (
    <ProductCard
      product={product}
      isWishlisted={wishlistIds.has(product.id)}
      onToggleWishlist={(id) => void toggleWishlist(id)}
      onQuickAdd={(p, colorName) => setQuickAdd({ product: p, colorName })}
      onInstantAddSize={(p, colorName, size) => addToBag(p.id, colorName, size)}
    />
  );
}
