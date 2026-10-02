'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getCart, removeCartItem, updateCartItemQuantity, type CartView } from '@/lib/cart';
import { useModalFocus } from './useModalFocus';

export function VanyaBagDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(open, dialogRef, onClose);
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSku, setPendingSku] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCart(null);
    setError(null);
    getCart()
      .then((next) => { if (!cancelled) setCart(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your bag.'); });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function changeQuantity(skuId: string, quantity: number) {
    setPendingSku(skuId);
    setError(null);
    try {
      const next = quantity <= 0 ? await removeCartItem(skuId) : await updateCartItemQuantity(skuId, quantity);
      setCart(next);
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your bag.');
    } finally {
      setPendingSku(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button type="button" aria-label="Close shopping bag" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        className="relative z-10 flex h-full w-full max-w-lg flex-col bg-[#faf8f5] shadow-2xl sm:rounded-l-[26px]"
      >
        <div className="flex items-center justify-between border-b border-[#eae3d7] bg-white/80 p-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6e6359]">Shopping bag</p>
            <h2 className="mt-1 font-display text-2xl text-[#181716]">Review Bag ({cart?.itemCount ?? 0})</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] text-xl text-[#181716]" aria-label="Close bag">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? <p role="alert" className="mb-4 text-sm text-danger">{error}</p> : null}
          {!cart ? <p className="text-sm text-[#6e6359]">Loading bag…</p> : null}
          {cart && cart.items.length === 0 ? (
            <div className="py-20 text-center">
              <h3 className="font-display text-2xl text-[#181716]">Your bag is empty</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#6e6359]">Explore the current VANYA edit and add a size when something feels right.</p>
              <button type="button" onClick={onClose} className="mt-6 rounded-full bg-[#181716] px-7 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white">Continue shopping</button>
            </div>
          ) : null}

          {cart && cart.items.length > 0 ? (
            <ul className="divide-y divide-[#e9e1d6]">
              {cart.items.map((item) => (
                <li key={item.skuId} className="flex gap-4 py-5 first:pt-0">
                  <Link href={'/product/' + item.styleId} onClick={onClose} className="relative h-32 w-24 shrink-0 overflow-hidden rounded-[14px] bg-white">
                    {item.imageUrl ? <Image src={item.imageUrl} alt={item.styleName} fill sizes="96px" className="object-cover" /> : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={'/product/' + item.styleId} onClick={onClose} className="line-clamp-2 text-sm font-medium text-[#181716] hover:text-[var(--color-primary)]">{item.styleName}</Link>
                        <p className="mt-1 text-xs text-[#6e6359]">{item.colourName} · {item.sizeLabel}</p>
                      </div>
                      <button type="button" onClick={() => void changeQuantity(item.skuId, 0)} disabled={pendingSku === item.skuId} className="min-h-[36px] text-[11px] text-[#5f554c] underline underline-offset-3">Remove</button>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[#181716]">&#8377;{item.currentPrice ?? item.priceAtAdd}</p>
                    {item.priceChanged ? <p role="status" className="mt-1 text-[11px] text-[#5f554c]">Price updated from &#8377;{item.priceAtAdd}.</p> : null}
                    {!item.isPurchasable ? <p role="alert" className="mt-1 text-[11px] text-danger">No longer available.</p> : null}
                    {item.isPurchasable && !item.inStock ? <p role="alert" className="mt-1 text-[11px] text-danger">Only {item.availableQuantity} available.</p> : null}
                    <div className="mt-3 inline-flex items-center overflow-hidden rounded-full border border-[#d9d0c4] bg-white">
                      <button type="button" onClick={() => void changeQuantity(item.skuId, item.quantity - 1)} disabled={pendingSku === item.skuId} className="min-h-[36px] min-w-[36px]" aria-label={'Decrease quantity for ' + item.styleName}>−</button>
                      <span className="min-w-[30px] text-center text-xs font-semibold">{item.quantity}</span>
                      <button type="button" onClick={() => void changeQuantity(item.skuId, item.quantity + 1)} disabled={pendingSku === item.skuId} className="min-h-[36px] min-w-[36px]" aria-label={'Increase quantity for ' + item.styleName}>+</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {cart && cart.items.length > 0 ? (
          <div className="border-t border-[#e6ddd0] bg-white p-5">
            <div className="flex justify-between text-sm text-[#5f554c]"><span>Subtotal ({cart.itemCount} items)</span><strong className="text-[#181716]">&#8377;{cart.subtotal}</strong></div>
            <p className="mt-2 text-[11px] leading-5 text-[#6e6359]">Discounts, shipping, loyalty and store credit are calculated at checkout.</p>
            {cart.hasBlockingChanges ? <p role="alert" className="mt-2 text-xs text-danger">Resolve unavailable or changed items before checkout.</p> : null}
            <Link
              href="/checkout"
              onClick={(event) => { if (cart.hasBlockingChanges) event.preventDefault(); else onClose(); }}
              aria-disabled={cart.hasBlockingChanges}
              className={'mt-4 flex min-h-[50px] items-center justify-center rounded-full bg-[var(--color-primary)] px-6 text-xs font-semibold uppercase tracking-[0.16em] text-white ' + (cart.hasBlockingChanges ? 'pointer-events-none opacity-50' : 'hover:bg-[var(--color-primary-hover)]')}
            >
              Proceed to Checkout
            </Link>
            <Link href="/bag" onClick={onClose} className="mt-2 flex min-h-[40px] items-center justify-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5f554c] underline underline-offset-4">View full bag</Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
