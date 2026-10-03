'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getCart, updateCartItemQuantity, removeCartItem, type CartView } from '@/lib/cart';
import { cartItems, track } from '@/lib/tracking';

export default function BagPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);

  async function refresh() {
    try { setCart(await getCart()); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load your bag.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void refresh();
    void getCart().then((loaded) => { if (loaded.items.length > 0) track.viewCart(cartItems(loaded.items)); }).catch(() => {});
  }, []);

  async function handleQuantityChange(skuId: string, quantity: number) {
    setPendingSkuId(skuId);
    try {
      setCart(quantity <= 0 ? await removeCartItem(skuId) : await updateCartItemQuantity(skuId, quantity));
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update quantity.');
    } finally { setPendingSkuId(null); }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-gutter py-10 sm:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Your selection</p>
      <h1 className="mt-2 font-display text-4xl text-[#181716] sm:text-5xl">Shopping Bag</h1>

      {loading ? <p className="mt-8 text-sm text-[#6e6359]">Loading bag…</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}

      {!loading && cart && cart.items.length === 0 ? (
        <div className="mt-10 rounded-[24px] border border-[#e6ddd0] bg-white p-8 text-center">
          <h2 className="font-display text-2xl text-[#181716]">Your bag is empty</h2>
          <p className="mt-2 text-sm text-[#6e6359]">Explore the latest VANYA edit when you’re ready.</p>
          <Link href="/" className="mt-6 inline-flex min-h-[46px] items-center rounded-full bg-[#181716] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white">Continue shopping</Link>
        </div>
      ) : null}

      {!loading && cart && cart.items.length > 0 ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
          <ul className="divide-y divide-[#e8dfd3] rounded-[24px] border border-[#e6ddd0] bg-white p-5 sm:p-6">
            {cart.items.map((item) => (
              <li key={item.skuId} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                <Link href={'/product/' + item.styleId} aria-label="View product image" className="relative h-36 w-28 shrink-0 overflow-hidden rounded-[16px] bg-[var(--color-surface-soft)]">
                  {item.imageUrl ? <Image src={item.imageUrl} alt={item.styleName} fill sizes="112px" className="object-cover" /> : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={'/product/' + item.styleId} aria-label="View product details" className="line-clamp-2 text-sm font-medium text-[#181716] hover:text-[var(--color-primary)]">{item.styleName}</Link>
                  <p className="mt-1 text-xs text-[#6e6359]">{item.colourName} · {item.sizeLabel}</p>
                  <p className="mt-2 text-sm font-semibold text-[#181716]">&#8377;{item.currentPrice ?? item.priceAtAdd}</p>
                  {!item.isPurchasable ? <p role="alert" className="mt-2 text-xs text-danger">This style is no longer purchasable.</p> : null}
                  {item.isPurchasable && !item.inStock ? <p role="alert" className="mt-2 text-xs text-danger">Only {item.availableQuantity} available.</p> : null}
                  {item.priceChanged ? <p role="status" className="mt-2 text-xs text-[#5f554c]">Price changed from &#8377;{item.priceAtAdd}.</p> : null}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="inline-flex overflow-hidden rounded-full border border-[#d8d0c6]">
                      <button type="button" onClick={() => void handleQuantityChange(item.skuId, item.quantity - 1)} disabled={pendingSkuId === item.skuId} className="min-h-[44px] min-w-[44px]" aria-label={'Decrease quantity for ' + item.styleName}>−</button>
                      <span className="min-w-[36px] self-center text-center text-xs font-semibold">{item.quantity}</span>
                      <button type="button" onClick={() => void handleQuantityChange(item.skuId, item.quantity + 1)} disabled={pendingSkuId === item.skuId} className="min-h-[44px] min-w-[44px]" aria-label={'Increase quantity for ' + item.styleName}>+</button>
                    </div>
                    <button type="button" onClick={() => void handleQuantityChange(item.skuId, 0)} disabled={pendingSkuId === item.skuId} className="min-h-[44px] text-xs text-[#5f554c] underline underline-offset-4">Remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <aside className="h-fit rounded-[24px] border border-[#e6ddd0] bg-white p-6 lg:sticky lg:top-28">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6e6359]">Order summary</p>
            <div className="mt-4 flex justify-between text-sm"><span className="text-[#5f554c]">Subtotal ({cart.itemCount} items)</span><span className="font-semibold text-[#181716]">&#8377;{cart.subtotal}</span></div>
            <p className="mt-4 text-xs leading-5 text-[#6e6359]">Shipping, promotions, loyalty and store credit are calculated by the live checkout service.</p>
            {cart.hasBlockingChanges ? <p role="alert" className="mt-3 text-xs text-danger">Some items need attention before checkout.</p> : null}
            <Link href="/checkout" aria-disabled={cart.hasBlockingChanges} className={'mt-6 flex min-h-[50px] items-center justify-center rounded-full bg-[var(--color-primary)] px-6 text-xs font-semibold uppercase tracking-[0.15em] text-white ' + (cart.hasBlockingChanges ? 'pointer-events-none opacity-50' : 'hover:bg-[var(--color-primary-hover)]')}>Proceed to Checkout</Link>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
