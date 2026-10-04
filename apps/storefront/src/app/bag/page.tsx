'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getCart, updateCartItemQuantity, removeCartItem, acceptCartItemPrice, type CartView } from '@/lib/cart';
import { cartItems, track } from '@/lib/tracking';
import { formatINR } from '@/lib/money';
import { CheckoutStepper } from '@/vanya/components/CheckoutStepper';
import { searchStorefront, type StorefrontSearchHit } from '@/lib/api';
import { hitToProduct } from '@/vanya/bridge/adapters';
import { ShopProductCard } from '@/vanya/bridge/ShopProductCard';

const CROSS_SELL_LIMIT = 6;

/** Same category+gender search the PDP's "You May Also Like" already
 * uses (vanya/views/PdpView.tsx) - one call per distinct pair present in
 * the bag, merged and deduped against what's already in it. Restrained on
 * purpose: this is a secondary section below the checkout CTA, not a
 * second storefront. */
async function loadCrossSell(cart: CartView): Promise<StorefrontSearchHit[]> {
  const pairs = new Map<string, { category: string; gender?: string }>();
  for (const item of cart.items) {
    if (!item.categorySlug) continue;
    const key = `${item.categorySlug}:${item.gender ?? ''}`;
    if (!pairs.has(key)) pairs.set(key, { category: item.categorySlug, gender: item.gender ?? undefined });
  }
  if (pairs.size === 0) return [];

  const inCartStyleIds = new Set(cart.items.map((i) => i.styleId));
  const results = await Promise.all(
    [...pairs.values()].map((p) => searchStorefront({ ...p, pageSize: CROSS_SELL_LIMIT }).catch(() => null)),
  );
  const seen = new Set<string>();
  const merged: StorefrontSearchHit[] = [];
  for (const result of results) {
    for (const hit of result?.hits ?? []) {
      if (inCartStyleIds.has(hit.id) || seen.has(hit.id)) continue;
      seen.add(hit.id);
      merged.push(hit);
      if (merged.length >= CROSS_SELL_LIMIT) break;
    }
    if (merged.length >= CROSS_SELL_LIMIT) break;
  }
  return merged;
}

export default function BagPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [crossSell, setCrossSell] = useState<StorefrontSearchHit[]>([]);

  async function refresh() {
    try { setCart(await getCart()); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load your bag.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void refresh();
    void getCart().then((loaded) => { if (loaded.items.length > 0) track.viewCart(cartItems(loaded.items)); }).catch(() => {});
  }, []);

  // Keyed on which styles are in the bag (not quantities), so a +/- click
  // doesn't re-fetch this; only a genuine add/remove does.
  const styleIdsKey = cart ? [...new Set(cart.items.map((i) => i.styleId))].sort().join(',') : '';
  useEffect(() => {
    if (!cart || cart.items.length === 0) { setCrossSell([]); return; }
    let cancelled = false;
    void loadCrossSell(cart).then((hits) => { if (!cancelled) setCrossSell(hits); });
    return () => { cancelled = true; };
  }, [styleIdsKey]);

  async function handleQuantityChange(skuId: string, quantity: number) {
    setPendingSkuId(skuId);
    try {
      setCart(quantity <= 0 ? await removeCartItem(skuId) : await updateCartItemQuantity(skuId, quantity));
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update quantity.');
    } finally { setPendingSkuId(null); }
  }

  // The shopper's explicit response to a priceChanged line - adopts the
  // current price already shown to them. Never triggered automatically.
  async function handleAcceptPrice(skuId: string) {
    setPendingSkuId(skuId);
    try {
      setCart(await acceptCartItemPrice(skuId));
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the price.');
    } finally { setPendingSkuId(null); }
  }

  const count = cart?.itemCount ?? 0;

  // The design has no separate bag page; this follows its bag drawer
  // (vanya/components/BagDrawer.tsx) at page width.
  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <CheckoutStepper current="bag" />
      <div className="border-b border-[#EAE3D7] pb-6 mb-8">
        <span className="text-[10px] tracking-[0.22em] uppercase text-[#756A5E] font-semibold">Shopping Bag</span>
        <h1 className="font-editorial text-3xl sm:text-4xl text-[#1A1816] font-normal mt-1">Review Bag ({count})</h1>
      </div>

      {loading ? <p className="text-xs text-[#756A5E]">Loading your bag…</p> : null}
      {error ? <p role="alert" className="mb-4 text-xs text-[#962E3B]">{error}</p> : null}

      {!loading && cart && cart.items.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <h2 className="font-editorial text-2xl text-[#6B5F53]">Your bag is empty</h2>
          <p className="text-xs text-[#756A5E] max-w-xs mx-auto">Explore our curated shirts, denims, and everyday essentials.</p>
          <Link href="/" className="mt-4 inline-flex px-8 py-3 bg-[#1F1C18] text-[#FAF8F5] text-xs uppercase tracking-[0.16em] font-semibold rounded-full hover:bg-black transition-colors">Continue Exploring</Link>
        </div>
      ) : null}

      {!loading && cart && cart.items.length > 0 ? (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] items-start">
          <ul className="divide-y divide-[#EFE8DC] rounded-2xl border border-[#EAE3D7] bg-white p-4 sm:p-6">
            {cart.items.map((item) => {
              const price = item.currentPrice ?? item.priceAtAdd;
              const busy = pendingSkuId === item.skuId;
              return (
                <li key={item.skuId} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                  <Link href={'/product/' + item.styleId} tabIndex={-1} aria-hidden="true" className="relative h-32 w-24 sm:h-36 sm:w-28 shrink-0 overflow-hidden rounded-xl bg-[#EFE9DF]">
                    {item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="112px" className="object-cover" /> : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={'/product/' + item.styleId} className="line-clamp-2 text-sm font-medium text-[#1A1816] hover:text-[#A85B3F]">{item.styleName}</Link>
                    <p className="text-[11px] text-[#7A6F64] mt-0.5">
                      Colour: <span className="font-medium text-[#2E2823]">{item.colourName}</span> | Size: <span className="font-medium text-[#2E2823]">{item.sizeLabel}</span>
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#1A1816]">{formatINR(price * item.quantity)}</p>
                    {item.quantity > 1 ? <p className="text-[11px] text-[#756A5E]">{formatINR(price)} each</p> : null}
                    {!item.isPurchasable ? <p role="alert" className="mt-1 text-[11px] text-[#962E3B]">This style is no longer available.</p> : null}
                    {item.isPurchasable && !item.inStock ? <p role="alert" className="mt-1 text-[11px] text-[#962E3B]">{item.availableQuantity === 0 ? 'Sold out in this size.' : `Only ${item.availableQuantity} left in this size.`}</p> : null}
                    {item.priceChanged ? (
                      <p role="status" className="mt-1 text-[11px] text-[#7A6F64]">
                        Price updated from {formatINR(item.priceAtAdd)} to {formatINR(item.currentPrice ?? item.priceAtAdd)}.{' '}
                        <button type="button" onClick={() => void handleAcceptPrice(item.skuId)} disabled={busy} className="font-semibold text-[#A85B3F] underline underline-offset-4 hover:text-[#8A4A33]">Update price</button>
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="inline-flex items-center overflow-hidden rounded-full border border-[#DFD6C8] bg-white">
                        <button type="button" onClick={() => void handleQuantityChange(item.skuId, item.quantity - 1)} disabled={busy} className="min-h-[44px] min-w-[44px] text-[#5C5146] hover:bg-[#F2ECE1]" aria-label={'Decrease quantity for ' + item.styleName}>−</button>
                        <span className="min-w-[32px] text-center text-xs font-semibold text-[#1A1816]">{item.quantity}</span>
                        <button type="button" onClick={() => void handleQuantityChange(item.skuId, item.quantity + 1)} disabled={busy} className="min-h-[44px] min-w-[44px] text-[#5C5146] hover:bg-[#F2ECE1]" aria-label={'Increase quantity for ' + item.styleName}>+</button>
                      </div>
                      <button type="button" onClick={() => void handleQuantityChange(item.skuId, 0)} disabled={busy} className="min-h-[44px] px-2 text-[11px] text-[#6E6358] hover:text-[#A85B3F] underline underline-offset-4">Remove</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <aside className="rounded-2xl border border-[#EAE3D7] bg-white p-5 sm:p-6 space-y-3 lg:sticky lg:top-28">
            <span className="text-[10px] tracking-[0.22em] uppercase text-[#756A5E] font-semibold">Order Summary</span>
            <div className="flex justify-between text-xs text-[#5C5146] pt-1">
              <span>Subtotal ({count} {count === 1 ? 'item' : 'items'})</span>
              <span className="font-semibold text-[#1A1816]">{formatINR(cart.subtotal)}</span>
            </div>
            <p className="text-[11px] leading-5 text-[#7A6F64]">Delivery charges, coupons, rewards and gift cards are shown and applied at checkout.</p>
            <p className="text-[10px] text-[#756A5E] text-right">Inclusive of all taxes</p>
            {cart.hasBlockingChanges ? <p role="alert" className="text-[11px] text-[#962E3B]">Remove or update the items marked in your bag before checkout.</p> : null}
            <Link href="/checkout" aria-disabled={cart.hasBlockingChanges} className={'w-full py-3.5 bg-[var(--color-primary)] text-white text-xs uppercase tracking-[0.18em] font-semibold rounded-full shadow-md flex items-center justify-center ' + (cart.hasBlockingChanges ? 'pointer-events-none opacity-50' : 'hover:bg-[var(--color-primary-hover)]')}>Proceed to Checkout</Link>
          </aside>
        </div>
      ) : null}

      {!loading && crossSell.length > 0 ? (
        <section aria-label="Complete your look" className="mt-12 border-t border-[#EAE3D7] pt-8">
          <h2 className="font-editorial text-xl sm:text-2xl text-[#1A1816] font-normal mb-4">Complete Your Look</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-3 lg:grid-cols-6">
            {crossSell.map((hit) => <ShopProductCard key={hit.id} product={hitToProduct(hit)} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
