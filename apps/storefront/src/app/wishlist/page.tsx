'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getWishlist, removeFromWishlist, moveWishlistItemToCart, type WishlistItemView } from '@/lib/cart';

/**
 * Wishlist (M12, specs/11-wishlist-cart.md, CART-001/003). Client-
 * rendered for the same reason as /bag - per-visitor state. Sharing
 * (CART-003) is explicitly FUTURE_CONSIDERATION and not built here.
 */
export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItemView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [movedMessage, setMovedMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      setItems(await getWishlist());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your wishlist.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleRemove(skuId: string) {
    setPendingSkuId(skuId);
    try {
      setItems(await removeFromWishlist(skuId));
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this item.');
    } finally {
      setPendingSkuId(null);
    }
  }

  async function handleMoveToCart(skuId: string) {
    setPendingSkuId(skuId);
    setMovedMessage(null);
    try {
      await moveWishlistItemToCart(skuId, 1);
      window.dispatchEvent(new Event('fcp:cart-updated'));
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
      setItems((prev) => prev?.filter((i) => i.skuId !== skuId) ?? null);
      setMovedMessage('Moved to bag.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move this item to your bag.');
    } finally {
      setPendingSkuId(null);
    }
  }

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Your Wishlist</h1>

      {loading && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      {movedMessage && (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          {movedMessage}
        </p>
      )}

      {!loading && items && items.length === 0 && (
        <div className="mt-8">
          <p className="text-sm text-ink-muted">Nothing saved yet.</p>
          <Link href="/" className={buttonClassName('primary', 'mt-4')}>
            Continue shopping
          </Link>
        </div>
      )}

      {!loading && items && items.length > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <li key={item.skuId} className="flex flex-col">
              <Link href={`/product/${item.styleId}`} className="relative aspect-[3/4] overflow-hidden rounded-sm bg-surface">
                {item.imageUrl && <Image src={item.imageUrl} alt={item.styleName} fill sizes="25vw" className="object-cover" />}
              </Link>
              <p className="mt-2 text-sm text-ink">{item.styleName}</p>
              <p className="text-xs text-ink-muted">
                {item.colourName} &middot; {item.sizeLabel}
              </p>
              <p className="mt-1 text-sm text-ink">&#8377;{item.currentPrice ?? '—'}</p>
              {!item.isPurchasable && <p className="mt-1 text-xs text-danger">No longer available</p>}
              {item.isPurchasable && !item.inStock && <p className="mt-1 text-xs text-danger">Out of stock</p>}

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pendingSkuId === item.skuId || !item.isPurchasable || !item.inStock}
                  onClick={() => handleMoveToCart(item.skuId)}
                  className={buttonClassName('secondary', 'flex-1 px-2 text-xs')}
                >
                  Move to Bag
                </button>
                <button
                  type="button"
                  disabled={pendingSkuId === item.skuId}
                  onClick={() => handleRemove(item.skuId)}
                  aria-label={`Remove ${item.styleName} from wishlist`}
                  className="min-h-[44px] min-w-[44px] px-2 text-xs text-ink underline"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
