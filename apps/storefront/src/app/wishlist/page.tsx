'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getWishlist, removeFromWishlist, moveWishlistItemToCart, type WishlistItemView } from '@/lib/cart';

export default function WishlistPage() {
  const [items, setItems] = useState<WishlistItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getWishlist().then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your wishlist.'));
  }, []);

  async function remove(skuId: string) {
    setPendingSkuId(skuId);
    try {
      setItems(await removeFromWishlist(skuId));
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove this item.'); }
    finally { setPendingSkuId(null); }
  }

  async function move(skuId: string) {
    setPendingSkuId(skuId);
    setMessage(null);
    try {
      await moveWishlistItemToCart(skuId, 1);
      window.dispatchEvent(new Event('fcp:cart-updated'));
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
      setItems((current) => current?.filter((item) => item.skuId !== skuId) ?? null);
      setMessage('Moved to bag.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move this item to your bag.'); }
    finally { setPendingSkuId(null); }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-gutter py-10 sm:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Saved for later</p>
      <h1 className="mt-2 font-display text-4xl text-[#181716] sm:text-5xl">Wishlist</h1>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
      {message ? <p role="status" className="mt-4 text-sm text-[#5f554c]">{message}</p> : null}
      {items === null && !error ? <p className="mt-8 text-sm text-[#6e6359]">Loading wishlist…</p> : null}

      {items && items.length === 0 ? (
        <div className="mt-10 rounded-[24px] border border-[#e6ddd0] bg-white p-8 text-center">
          <h2 className="font-display text-2xl text-[#181716]">Nothing saved yet</h2>
          <Link href="/" className="mt-6 inline-flex min-h-[46px] items-center rounded-full bg-[#181716] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white">Explore VANYA</Link>
        </div>
      ) : null}

      {items && items.length > 0 ? (
        <ul className="mt-8 grid grid-cols-2 gap-3 gap-y-8 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.skuId} className="overflow-hidden rounded-[18px] border border-[#e9e2d8] bg-white">
              <Link href={'/product/' + item.styleId} className="relative block aspect-[3/4] bg-[var(--color-surface-soft)]">
                {item.imageUrl ? <Image src={item.imageUrl} alt={item.styleName} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" /> : null}
              </Link>
              <div className="p-3.5">
                <p className="line-clamp-2 text-sm font-medium text-[#181716]">{item.styleName}</p>
                <p className="mt-1 text-xs text-[#6e6359]">{item.colourName} · {item.sizeLabel}</p>
                <p className="mt-2 text-sm font-semibold">&#8377;{item.currentPrice ?? '—'}</p>
                {!item.isPurchasable ? <p className="mt-2 text-xs text-danger">No longer available</p> : null}
                {item.isPurchasable && !item.inStock ? <p className="mt-2 text-xs text-danger">Out of stock</p> : null}
                <div className="mt-4 grid gap-2">
                  <button type="button" disabled={pendingSkuId === item.skuId || !item.isPurchasable || !item.inStock} onClick={() => void move(item.skuId)} className="min-h-[44px] rounded-full bg-[var(--color-primary)] px-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-50">Move to Bag</button>
                  <button type="button" disabled={pendingSkuId === item.skuId} onClick={() => void remove(item.skuId)} className="min-h-[40px] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5f554c] underline underline-offset-4">Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
