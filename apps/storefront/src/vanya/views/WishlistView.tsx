'use client';

/**
 * The approved AI Studio wishlist (Stitch-Spark_Ai_Studio views/WishlistView.tsx)
 * over the real wishlist. Each saved piece keeps the colour and size it was
 * saved in; "Move to Bag" moves that exact size with live stock checks.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, ArrowRight, Trash2, ShoppingBag } from 'lucide-react';
import { getWishlist, moveWishlistItemToCart, removeFromWishlist, type WishlistItemView } from '@/lib/cart';
import { formatPrice } from '../utils/format';
import { useShop } from '../bridge/shop';

export function WishlistView() {
  const { gender, hrefFor } = useShop();
  const [items, setItems] = useState<WishlistItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    getWishlist().then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your wishlist.'));
  }, []);

  async function run(skuId: string, action: () => Promise<void>) {
    setPending(skuId);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your wishlist.');
    } finally {
      setPending(null);
    }
  }

  const remove = (skuId: string) => run(skuId, async () => {
    setItems(await removeFromWishlist(skuId));
    window.dispatchEvent(new Event('fcp:wishlist-updated'));
  });

  const move = (skuId: string) => run(skuId, async () => {
    await moveWishlistItemToCart(skuId, 1);
    setItems((current) => current?.filter((item) => item.skuId !== skuId) ?? null);
    window.dispatchEvent(new Event('fcp:cart-updated'));
    window.dispatchEvent(new Event('fcp:wishlist-updated'));
    setMessage('Moved to bag.');
  });

  const count = items?.length ?? 0;

  return (
    <div id="wishlist-page" className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* Header */}
      <div className="border-b border-[#EAE3D7] pb-6 mb-8">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 fill-[#A85B3F] text-[#A85B3F]" />
          <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#756A5E]">Personal Curation</span>
        </div>
        <h1 className="font-editorial text-3xl sm:text-4xl text-[#1A1816] font-normal mt-1">
          Saved Garments ({count})
        </h1>
        <p className="text-xs text-[#7A6F64] mt-1">
          Pieces you have set aside. Move them to your bag whenever you are ready.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 text-xs text-[#962E3B]">{error}</p>}
      {message && <p role="status" className="mb-4 text-xs text-[#2E5836] font-medium">{message}</p>}
      {items === null && !error && <p className="text-xs text-[#7A6F64]">Loading your wishlist…</p>}

      {items && items.length === 0 ? (
        <div className="py-20 text-center space-y-4 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-full bg-[#F2ECE1] mx-auto flex items-center justify-center text-[#756A5E]">
            <Heart className="w-7 h-7 stroke-[1.2]" />
          </div>
          <h2 className="font-editorial text-2xl text-[#1A1816]">Your wishlist is currently empty</h2>
          <p className="text-xs text-[#7A6F64] leading-relaxed">
            As you explore our daily wear and business casual edits, tap the heart icon on any piece to save it here.
          </p>
          <Link
            href={hrefFor('plp', { gender })}
            className="mt-2 inline-flex items-center gap-2 px-8 py-3.5 bg-[#1A1816] text-white text-xs uppercase tracking-[0.16em] font-semibold rounded-full hover:bg-black transition-all cursor-pointer shadow-md"
          >
            <span>Explore The Collection</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : items && items.length > 0 ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((item) => {
            const href = hrefFor('pdp', { productId: item.styleId });
            const busy = pending === item.skuId;
            const canMove = item.isPurchasable && item.inStock;
            return (
              <li key={item.skuId} className="bg-[#FAF7F2] border border-[#E8E1D5] rounded-2xl overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md transition-shadow">
                <div>
                  {/* Image */}
                  <div className="aspect-[3/4] bg-[#EFE9DF] overflow-hidden relative group rounded-t-2xl">
                    <Link href={href} tabIndex={-1} aria-hidden="true" className="block w-full h-full">
                      {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void remove(item.skuId)}
                      disabled={busy}
                      className="absolute top-3 right-3 p-2.5 bg-white/90 hover:bg-white rounded-full text-[#6E6358] hover:text-[#962E3B] transition-colors shadow-xs cursor-pointer"
                      title="Remove"
                      aria-label={`Remove ${item.styleName} from wishlist`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <Link href={href} className="text-xs sm:text-sm font-medium text-[#1A1816] line-clamp-1 hover:text-[#A85B3F]">
                      {item.styleName}
                    </Link>
                    <p className="text-[11px] text-[#7A6F64] mt-0.5">{item.colourName} · Size {item.sizeLabel}</p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-semibold text-xs text-[#1A1816]">
                        {item.currentPrice === null ? 'Price unavailable' : formatPrice(item.currentPrice)}
                      </span>
                    </div>
                    {!item.isPurchasable && <p className="mt-1 text-[11px] text-[#962E3B]">No longer available</p>}
                    {item.isPurchasable && !item.inStock && <p className="mt-1 text-[11px] text-[#962E3B]">Sold out in this size</p>}
                  </div>
                </div>

                {/* Move to bag button */}
                <div className="p-4 pt-0">
                  <button
                    type="button"
                    onClick={() => void move(item.skuId)}
                    disabled={busy || !canMove}
                    aria-label="Move to Bag"
                    className="w-full py-3 bg-[#1F1C18] hover:bg-black text-[#FAF8F5] text-[11px] uppercase tracking-wider font-semibold rounded-full transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>Move to Bag ({item.sizeLabel})</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
