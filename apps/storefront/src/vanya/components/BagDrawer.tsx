'use client';

/**
 * The approved AI Studio bag drawer (Stitch-Spark_Ai_Studio
 * components/BagDrawer.tsx), reading the real bag. Left out because they were
 * prototype figures: the VANYA10 demo coupon (coupons are applied at
 * checkout, against the real promotions), the ₹1,999 free-delivery threshold
 * and ₹150 charge (shown only when the shop has confirmed its delivery terms)
 * and the "points you'll earn" estimate (the earning rate is not published).
 */
import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { X, Trash2, Heart, Plus, Minus, ArrowRight, ShieldCheck, Tag } from 'lucide-react';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { useShop } from '../bridge/shop';
import { formatPrice } from '../utils/format';

export function BagDrawer() {
  const { bagOpen, setBagOpen } = useShop();
  if (!bagOpen) return null;
  return <BagPanel onClose={() => setBagOpen(false)} />;
}

function BagPanel({ onClose }: { onClose: () => void }) {
  const { cart, policies, updateQuantity, removeItem, moveToWishlist, hrefFor } = useShop();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, panelRef, onClose);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = cart?.items ?? [];
  const count = cart?.itemCount ?? 0;
  const subtotal = cart?.subtotal ?? 0;
  const freeShippingThreshold = policies.freeDeliveryAbove;
  const isFreeShipping = freeShippingThreshold !== null && subtotal >= freeShippingThreshold;
  const amountNeededForFreeShipping = freeShippingThreshold === null ? 0 : Math.max(0, freeShippingThreshold - subtotal);
  const shipping = isFreeShipping ? 0 : policies.deliveryCharge;

  async function run(skuId: string, action: () => Promise<void>) {
    setPending(skuId);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your bag.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      id="bag-drawer-backdrop"
      className="fixed inset-0 z-[70] flex justify-end"
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-xs" />
      <div
        id="bag-drawer-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        tabIndex={-1}
        className="relative w-full max-w-md sm:max-w-lg bg-[#FAF8F5] h-full shadow-2xl flex flex-col justify-between overflow-hidden sm:rounded-l-3xl"
      >
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-[#EAE3D7] flex items-center justify-between bg-white/80">
          <div>
            <span className="text-[10px] tracking-[0.22em] uppercase text-[#756A5E] font-semibold">
              Shopping Bag
            </span>
            <h3 className="font-editorial text-2xl text-[#1A1816] font-normal leading-tight">
              Review Bag ({count})
            </h3>
          </div>
          <button
            id="btn-close-bag"
            type="button"
            onClick={onClose}
            className="p-2.5 -mr-1 text-[#5C5146] hover:text-black rounded-full"
            aria-label="Close bag"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Free Shipping Progress Ribbon (only with confirmed delivery terms) */}
        {freeShippingThreshold !== null && items.length > 0 && (
          <div className="px-5 py-2.5 bg-[#F2ECE1] border-b border-[#E4DDD0] text-xs">
            {isFreeShipping ? (
              <div className="flex items-center gap-2 text-[#2E5836] font-semibold text-[11px]">
                <ShieldCheck className="w-4 h-4 text-[#3F6A48]" />
                <span>Your order qualifies for free delivery.</span>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-[#554A41]">
                  <span>
                    Add <strong>{formatPrice(amountNeededForFreeShipping)}</strong> more for free delivery
                  </span>
                  <span className="font-medium">
                    {Math.round((subtotal / freeShippingThreshold) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-[#DDD4C6] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[var(--color-primary)] h-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (subtotal / freeShippingThreshold) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scrollable Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 divide-y divide-[#EFE8DC]">
          {error && <p role="alert" className="pb-3 text-xs text-[#962E3B]">{error}</p>}
          {!cart ? (
            <p className="py-20 text-center text-xs text-[#756A5E]">Loading your bag…</p>
          ) : items.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <h4 className="font-editorial text-2xl text-[#6B5F53]">Your bag is empty</h4>
              <p className="text-xs text-[#756A5E] max-w-xs mx-auto">
                Explore our curated shirts, denims, and everyday essentials.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-8 py-3 bg-[#1F1C18] text-[#FAF8F5] text-xs uppercase tracking-[0.16em] font-semibold rounded-full hover:bg-black transition-colors cursor-pointer shadow-xs"
              >
                Continue Exploring
              </button>
            </div>
          ) : (
            items.map((item) => {
              const price = item.currentPrice ?? item.priceAtAdd;
              const busy = pending === item.skuId;
              const productHref = hrefFor('pdp', { productId: item.styleId });
              return (
                <div key={item.skuId} className="py-4 first:pt-0 last:pb-0 flex gap-3.5">
                  <Link href={productHref} onClick={onClose} tabIndex={-1} aria-hidden="true" className="shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="w-20 h-26 object-cover rounded-xl bg-[#EFE9DF] cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    ) : (
                      <span className="block w-20 h-26 rounded-xl bg-[#EFE9DF]" />
                    )}
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={productHref}
                          onClick={onClose}
                          className="text-xs sm:text-sm font-medium text-[#1A1816] line-clamp-1 cursor-pointer hover:text-[#A85B3F]"
                        >
                          {item.styleName}
                        </Link>
                        <button
                          type="button"
                          onClick={() => void run(item.skuId, () => removeItem(item.skuId))}
                          disabled={busy}
                          className="text-[#756A5E] hover:text-[#A85B3F] transition-colors p-2 -mr-2 -mt-1.5"
                          title="Remove item"
                          aria-label="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-[11px] text-[#7A6F64] mt-0.5">
                        Colour: <span className="font-medium text-[#2E2823]">{item.colourName}</span> | Size: <span className="font-medium text-[#2E2823]">{item.sizeLabel}</span>
                      </p>

                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-semibold text-xs sm:text-sm text-[#1A1816]">
                          {formatPrice(price * item.quantity)}
                        </span>
                      </div>
                      {item.priceChanged && (
                        <p role="status" className="mt-0.5 text-[11px] text-[#7A6F64]">
                          Price updated from {formatPrice(item.priceAtAdd)}.
                        </p>
                      )}
                      {!item.isPurchasable && (
                        <p className="mt-0.5 text-[11px] text-[#962E3B]">No longer available.</p>
                      )}
                      {item.isPurchasable && !item.inStock && (
                        <p className="mt-0.5 text-[11px] text-[#962E3B]">
                          {item.availableQuantity === 0 ? 'Sold out in this size.' : `Only ${item.availableQuantity} left in this size.`}
                        </p>
                      )}
                    </div>

                    {/* Bottom Controls: Quantity & Move to Wishlist */}
                    <div className="flex items-center justify-between pt-2">
                      {/* Quantity Control */}
                      <div className="flex items-center border border-[#DFD6C8] bg-white rounded-full overflow-hidden">
                        <button
                          type="button"
                          onClick={() => void run(item.skuId, () => updateQuantity(item.skuId, -1))}
                          disabled={busy}
                          className="p-2 hover:bg-[#F2ECE1] transition-colors text-[#5C5146]"
                          aria-label={`Decrease quantity for ${item.styleName}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2 text-xs font-semibold text-[#1A1816]" aria-label={`Quantity ${item.quantity}`}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => void run(item.skuId, () => updateQuantity(item.skuId, 1))}
                          disabled={busy}
                          className="p-2 hover:bg-[#F2ECE1] transition-colors text-[#5C5146]"
                          aria-label={`Increase quantity for ${item.styleName}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Move to wishlist */}
                      <button
                        type="button"
                        onClick={() => void run(item.skuId, () => moveToWishlist(item.skuId))}
                        disabled={busy}
                        className="text-[11px] text-[#6E6358] hover:text-[#A85B3F] flex items-center gap-1 transition-colors py-2"
                      >
                        <Heart className="w-3 h-3 stroke-[1.5]" />
                        <span>Save for later</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Order Summary */}
        {cart && items.length > 0 && (
          <div className="p-4 sm:p-5 border-t border-[#EAE3D7] bg-white space-y-3">
            <p className="flex items-center gap-2 text-[11px] text-[#6E6358]">
              <Tag className="w-3.5 h-3.5 text-[#9E9184]" />
              <span>Coupons, rewards and gift cards can be applied at checkout.</span>
            </p>

            {/* Calculations Breakdown */}
            <div className="space-y-1.5 text-xs text-[#5C5146] border-t border-[#EFE9DF] pt-2">
              <div className="flex justify-between">
                <span>Subtotal ({count} {count === 1 ? 'item' : 'items'})</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>{shipping === null ? 'Shown at checkout' : shipping === 0 ? 'FREE' : formatPrice(shipping)}</span>
              </div>
              {shipping !== null && (
                <div className="flex justify-between text-sm font-semibold text-[#1A1816] pt-1 border-t border-[#EFE9DF]">
                  <span>Order Total</span>
                  <span>{formatPrice(subtotal + shipping)}</span>
                </div>
              )}
              <p className="text-[10px] text-[#756A5E] text-right">
                Inclusive of all taxes
              </p>
            </div>

            {cart.hasBlockingChanges && (
              <p role="alert" className="text-[11px] text-[#962E3B]">
                Remove or update the items marked above before checkout.
              </p>
            )}

            {/* Checkout CTA */}
            <Link
              id="btn-proceed-checkout"
              href="/checkout"
              aria-disabled={cart.hasBlockingChanges}
              onClick={(event) => { if (cart.hasBlockingChanges) event.preventDefault(); else onClose(); }}
              className={`w-full py-3.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs uppercase tracking-[0.18em] font-semibold transition-all rounded-full shadow-md flex items-center justify-center gap-2 group active:scale-[0.99] cursor-pointer ${cart.hasBlockingChanges ? 'pointer-events-none opacity-50' : ''}`}
            >
              <span>Proceed to Checkout</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>

            <div className="flex items-center justify-between pt-1 text-[11px]">
              <Link href="/bag" onClick={onClose} className="py-2 text-[#5C5146] hover:text-[#1A1816] underline underline-offset-4">
                View full bag
              </Link>
              <Link href="/orders" onClick={onClose} className="py-2 text-[#756A5E] hover:text-[#1A1816] hover:underline transition-colors">
                Already ordered? Track your package status →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
