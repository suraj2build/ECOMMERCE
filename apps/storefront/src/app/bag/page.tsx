'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getCart, updateCartItemQuantity, removeCartItem, type CartView } from '@/lib/cart';

/**
 * Bag / Cart (M12, specs/11-wishlist-cart.md). Client-rendered - cart
 * state is per-visitor (guest session or logged-in customer), never
 * something Next.js should cache or render server-side. Re-validates
 * price/availability on every load (the GET /storefront/cart response
 * already does this server-side) and surfaces price/stock changes
 * clearly rather than silently proceeding - spec requirement. Checkout
 * itself is honestly not wired up yet - M13's own milestone, same
 * PDP/Cart-style honesty M09/M11 used for their own not-yet-built
 * dependencies.
 */
export default function BagPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSkuId, setPendingSkuId] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      setCart(await getCart());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your bag.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleQuantityChange(skuId: string, quantity: number) {
    setPendingSkuId(skuId);
    try {
      setCart(await updateCartItemQuantity(skuId, quantity));
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update quantity.');
    } finally {
      setPendingSkuId(null);
    }
  }

  async function handleRemove(skuId: string) {
    setPendingSkuId(skuId);
    try {
      setCart(await removeCartItem(skuId));
      window.dispatchEvent(new Event('fcp:cart-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this item.');
    } finally {
      setPendingSkuId(null);
    }
  }

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Your Bag</h1>

      {loading && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      {!loading && cart && cart.items.length === 0 && (
        <div className="mt-8">
          <p className="text-sm text-ink-muted">Your bag is empty.</p>
          <Link href="/" className={buttonClassName('primary', 'mt-4')}>
            Continue shopping
          </Link>
        </div>
      )}

      {!loading && cart && cart.items.length > 0 && (
        <div className="mt-6 grid gap-8 md:grid-cols-[1fr_320px]">
          <ul className="space-y-6">
            {cart.items.map((item) => (
              <li key={item.skuId} className="flex gap-4 border-b border-border pb-6">
                <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-sm bg-surface">
                  {item.imageUrl && (
                    <Image src={item.imageUrl} alt={item.styleName} fill sizes="80px" className="object-cover" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-ink">{item.styleName}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {item.colourName} &middot; {item.sizeLabel}
                  </p>
                  <p className="mt-2 text-sm text-ink">&#8377;{item.currentPrice ?? item.priceAtAdd}</p>

                  {!item.isPurchasable && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      This item is no longer available and won&apos;t be included at checkout.
                    </p>
                  )}
                  {item.isPurchasable && !item.inStock && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      Only {item.availableQuantity} left - reduce the quantity to continue.
                    </p>
                  )}
                  {item.priceChanged && (
                    <p role="status" className="mt-2 text-xs text-ink-muted">
                      Price changed since you added this item (was &#8377;{item.priceAtAdd}).
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <label htmlFor={`qty-${item.skuId}`} className="sr-only">
                      Quantity for {item.styleName}
                    </label>
                    <select
                      id={`qty-${item.skuId}`}
                      value={item.quantity}
                      disabled={pendingSkuId === item.skuId}
                      onChange={(e) => handleQuantityChange(item.skuId, Number(e.target.value))}
                      className="min-h-[44px] rounded-sm border border-border px-2 text-sm text-ink"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.skuId)}
                      disabled={pendingSkuId === item.skuId}
                      className="min-h-[44px] text-sm text-ink underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="h-fit rounded-sm border border-border p-6">
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? '' : 's'})</span>
              <span className="text-ink">&#8377;{cart.subtotal}</span>
            </div>
            {cart.hasBlockingChanges && (
              <p role="alert" className="mt-3 text-xs text-danger">
                Some items need your attention before you can check out.
              </p>
            )}
            <button
              type="button"
              disabled={cart.hasBlockingChanges}
              className={buttonClassName('primary', 'mt-4 w-full')}
              onClick={() => setCheckoutMessage('Checkout is coming soon - not yet built.')}
            >
              Checkout
            </button>
            {checkoutMessage && (
              <p role="status" className="mt-2 text-xs text-ink-muted">
                {checkoutMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </Container>
  );
}
