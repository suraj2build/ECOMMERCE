'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { buttonClassName } from '@/components/ui/Button';
import { getCart, type CartView } from '@/lib/cart';
import { previewCheckout, startCheckout, type Address, type CheckoutPreview } from '@/lib/checkout';
import { INDIAN_STATES } from '@/lib/indian-states';
import { getStoredSession } from '@/lib/customer-auth';
import { getLoyaltyBalance, type LoyaltyBalance, getStoreCredit, type StoreCreditBalance } from '@/lib/account';

const EMPTY_ADDRESS: Address = { line1: '', line2: '', landmark: '', city: '', state: '', stateCode: '', pincode: '' };

function isAddressComplete(a: Address): boolean {
  return Boolean(a.line1 && a.city && a.stateCode && /^[0-9]{6}$/.test(a.pincode));
}

/**
 * Checkout (M13, specs/12-checkout.md). A single-page flow: contact +
 * address + payment method, with a live order-review sidebar (CHK's
 * "address, shipping method, review" steps, collapsed onto one page
 * rather than a multi-step wizard - an engineering-default UX choice,
 * not a spec requirement). Reservation only happens on the real "Place
 * Order" submission (INV-002 - never on page load or while typing).
 */
export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [shippingAddress, setShippingAddress] = useState<Address>(EMPTY_ADDRESS);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billingAddress, setBillingAddress] = useState<Address>(EMPTY_ADDRESS);
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'PREPAID'>('COD');
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // M23 (specs/22-loyalty.md §8): only a signed-in customer has a
  // LoyaltyAccount to redeem against - a guest checkout simply never
  // shows this section (loyaltyPointsToRedeem is omitted entirely).
  const [loyaltyBalance, setLoyaltyBalance] = useState<LoyaltyBalance | null>(null);
  const [redeemPointsInput, setRedeemPointsInput] = useState('');

  // M24 (specs/23-promotions.md): the customer types a code and applies
  // it explicitly; `appliedCouponCode` (not the raw input) drives the
  // live server-revalidated preview, so a half-typed code never looks
  // like it's already discounting the order.
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | undefined>(undefined);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [storeCreditBalance, setStoreCreditBalance] = useState<StoreCreditBalance | null>(null);
  const [storeCreditInput, setStoreCreditInput] = useState('');

  useEffect(() => {
    void getCart().then(setCart);
    if (getStoredSession()) {
      getLoyaltyBalance()
        .then(setLoyaltyBalance)
        .catch(() => setLoyaltyBalance(null));
    }
    getStoreCredit()
      .then(setStoreCreditBalance)
      .catch(() => setStoreCreditBalance(null));
  }, []);

  useEffect(() => {
    if (!isAddressComplete(shippingAddress)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewCheckout(shippingAddress, appliedCouponCode)
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setPreviewError(null);
            // A successful preview (with or without a coupon) always
            // supersedes any earlier coupon-specific error.
            setCouponError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : 'Could not calculate your order total.';
            if (appliedCouponCode) {
              // A coupon that failed revalidation (expired/usage-cap
              // reached between typing and this preview) is reported
              // as a coupon-specific error and removed - the order
              // review itself is left showing whatever it last
              // successfully computed (e.g. an automatic promotion
              // that's still valid on its own), never blanked out just
              // because the coupon attempt failed. Removing it re-runs
              // this same effect (appliedCouponCode is a dependency),
              // which re-fetches a coupon-free preview immediately.
              setCouponError(message);
              setAppliedCouponCode(undefined);
            } else {
              setPreview(null);
              setPreviewError(message);
            }
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shippingAddress.line1, shippingAddress.city, shippingAddress.stateCode, shippingAddress.pincode, appliedCouponCode]);

  function handleApplyCoupon() {
    setCouponError(null);
    if (!couponCodeInput.trim()) return;
    setAppliedCouponCode(couponCodeInput.trim());
  }

  function handleRemoveCoupon() {
    setAppliedCouponCode(undefined);
    setCouponCodeInput('');
    setCouponError(null);
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!preview?.isServiceable) {
      setSubmitError('Please enter a serviceable delivery PIN code before placing your order.');
      return;
    }
    setSubmitting(true);
    const redeemPoints = loyaltyBalance ? parseInt(redeemPointsInput, 10) : NaN;
    const storeCreditToApply = storeCreditBalance ? parseFloat(storeCreditInput) : NaN;
    try {
      const session = await startCheckout({
        contactName,
        contactMobile,
        contactEmail: contactEmail || undefined,
        shippingAddress,
        billingAddress: billingSameAsShipping ? shippingAddress : billingAddress,
        paymentMethod,
        idempotencyKey,
        loyaltyPointsToRedeem: Number.isFinite(redeemPoints) && redeemPoints > 0 ? redeemPoints : undefined,
        couponCode: appliedCouponCode,
        storeCreditToApply: Number.isFinite(storeCreditToApply) && storeCreditToApply > 0 ? storeCreditToApply : undefined,
      });
      window.dispatchEvent(new Event('fcp:cart-updated'));
      router.push(`/checkout/${session.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not place your order.');
    } finally {
      setSubmitting(false);
    }
  }

  if (cart && cart.items.length === 0) {
    return (
      <Container className="py-8">
        <h1 className="font-display text-2xl text-ink">Checkout</h1>
        <p className="mt-4 text-sm text-ink-muted">Your bag is empty.</p>
      </Container>
    );
  }

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Checkout</h1>

      <form onSubmit={handlePlaceOrder} className="mt-6 grid gap-8 md:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <fieldset className="space-y-3">
            <legend className="font-display text-lg text-ink">Contact</legend>
            <input
              type="text"
              required
              placeholder="Full name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
            <input
              type="tel"
              required
              placeholder="10-digit mobile number"
              value={contactMobile}
              onChange={(e) => setContactMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </fieldset>

          <AddressFields legend="Shipping address" address={shippingAddress} onChange={setShippingAddress} />

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={billingSameAsShipping}
              onChange={(e) => setBillingSameAsShipping(e.target.checked)}
              className="h-5 w-5"
            />
            Billing address is the same as shipping
          </label>

          {!billingSameAsShipping && (
            <AddressFields legend="Billing address" address={billingAddress} onChange={setBillingAddress} />
          )}

          <fieldset className="space-y-2">
            <legend className="font-display text-lg text-ink">Payment method</legend>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink">
              <input type="radio" name="paymentMethod" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} className="h-5 w-5" />
              Cash on Delivery
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink">
              <input type="radio" name="paymentMethod" checked={paymentMethod === 'PREPAID'} onChange={() => setPaymentMethod('PREPAID')} className="h-5 w-5" />
              Pay online (UPI / Card / Net Banking)
            </label>
            {paymentMethod === 'PREPAID' && (
              <p role="status" className="text-xs text-ink-muted">
                Online payment is coming soon - you can place the order, but completing payment isn&apos;t available yet.
              </p>
            )}
            {paymentMethod === 'COD' && preview && !preview.codAvailable && (
              <p role="alert" className="text-xs text-danger">
                Cash on Delivery is not available for this PIN code.
              </p>
            )}
          </fieldset>

          {loyaltyBalance && loyaltyBalance.balance > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-display text-lg text-ink">Loyalty points</legend>
              <p className="text-sm text-ink-muted">
                You have {loyaltyBalance.balance} points available to redeem.
                {loyaltyBalance.pendingPoints > 0
                  ? ` (${loyaltyBalance.pendingPoints} more points are pending and not yet redeemable.)`
                  : ''}
              </p>
              <label htmlFor="redeem-points" className="sr-only">
                Points to redeem
              </label>
              <input
                id="redeem-points"
                type="number"
                min={0}
                max={loyaltyBalance.balance}
                placeholder="Points to redeem"
                value={redeemPointsInput}
                onChange={(e) => setRedeemPointsInput(e.target.value.replace(/\D/g, ''))}
                className="block min-h-[44px] w-full max-w-[200px] rounded-sm border border-border px-3 text-sm text-ink"
              />
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="font-display text-lg text-ink">Coupon code</legend>
            {appliedCouponCode ? (
              <div className="flex min-h-[44px] items-center justify-between rounded-sm border border-border px-3">
                <span className="text-sm text-ink">
                  {appliedCouponCode} applied
                  {preview && preview.promotionDiscountTotal > 0 ? ` - you saved ₹${preview.promotionDiscountTotal}` : ''}
                </span>
                <button type="button" onClick={handleRemoveCoupon} className="text-xs font-medium text-ink underline underline-offset-2">
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label htmlFor="coupon-code" className="sr-only">
                  Coupon code
                </label>
                <input
                  id="coupon-code"
                  type="text"
                  placeholder="Coupon code"
                  value={couponCodeInput}
                  onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                  className="block min-h-[44px] w-full max-w-[200px] rounded-sm border border-border px-3 text-sm text-ink"
                />
                <button type="button" onClick={handleApplyCoupon} className={buttonClassName('secondary', 'min-h-[44px]')}>
                  Apply
                </button>
              </div>
            )}
            {couponError && (
              <p role="alert" className="text-xs text-danger">
                {couponError}
              </p>
            )}
          </fieldset>

          {storeCreditBalance && storeCreditBalance.balance > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-display text-lg text-ink">Store credit</legend>
              <p className="text-sm text-ink-muted">You have ₹{storeCreditBalance.balance} of store credit available.</p>
              <label htmlFor="store-credit-amount" className="sr-only">
                Store credit to apply
              </label>
              <input
                id="store-credit-amount"
                type="number"
                min={0}
                max={storeCreditBalance.balance}
                placeholder="Amount to apply"
                value={storeCreditInput}
                onChange={(e) => setStoreCreditInput(e.target.value.replace(/[^0-9.]/g, ''))}
                className="block min-h-[44px] w-full max-w-[200px] rounded-sm border border-border px-3 text-sm text-ink"
              />
            </fieldset>
          )}
        </div>

        <div className="h-fit rounded-sm border border-border p-6">
          <h2 className="font-display text-lg text-ink">Order review</h2>
          {previewError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {previewError}
            </p>
          )}
          {!preview && !previewError && (
            <p className="mt-2 text-sm text-ink-muted">Enter your shipping address to see your order total.</p>
          )}
          {preview && (
            <div className="mt-3 space-y-2 text-sm">
              {!preview.isServiceable && (
                <p role="alert" className="text-danger">
                  Delivery is not currently available to this PIN code.
                </p>
              )}
              {preview.promotionDiscountTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">Discount ({preview.appliedPromotions.map((p) => p.name).join(', ')})</span>
                  <span className="text-ink">-&#8377;{preview.promotionDiscountTotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-muted">Subtotal</span>
                <span className="text-ink">&#8377;{preview.subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Shipping</span>
                <span className="text-ink">{preview.shippingCost === 0 ? 'Free' : `₹${preview.shippingCost}`}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span className="text-ink">Total (tax incl.)</span>
                <span className="text-ink">&#8377;{preview.grandTotal}</span>
              </div>
              {loyaltyBalance && parseInt(redeemPointsInput, 10) > 0 && (
                <p className="text-xs text-ink-muted">
                  {parseInt(redeemPointsInput, 10)} loyalty points will be applied at checkout - the final amount payable is
                  shown on your order confirmation.
                </p>
              )}
              {storeCreditBalance && parseFloat(storeCreditInput) > 0 && (
                <p className="text-xs text-ink-muted">
                  ₹{storeCreditInput} of store credit will be applied at checkout - the final amount payable is shown on
                  your order confirmation.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !preview?.isServiceable}
            className={buttonClassName('primary', 'mt-6 w-full')}
          >
            {submitting ? 'Placing order...' : 'Place Order'}
          </button>
          {submitError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {submitError}
            </p>
          )}
        </div>
      </form>
    </Container>
  );
}

function AddressFields({
  legend,
  address,
  onChange,
}: {
  legend: string;
  address: Address;
  onChange: (a: Address) => void;
}) {
  function update(field: keyof Address, value: string) {
    if (field === 'state') {
      const match = INDIAN_STATES.find((s) => s.name === value);
      onChange({ ...address, state: value, stateCode: match?.code ?? '' });
      return;
    }
    onChange({ ...address, [field]: value });
  }

  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-lg text-ink">{legend}</legend>
      <input
        type="text"
        required
        placeholder="House / Flat, Building, Street"
        value={address.line1}
        onChange={(e) => update('line1', e.target.value)}
        className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
      />
      <input
        type="text"
        placeholder="Locality / Area (optional)"
        value={address.line2 ?? ''}
        onChange={(e) => update('line2', e.target.value)}
        className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
      />
      <input
        type="text"
        placeholder="Landmark (optional)"
        value={address.landmark ?? ''}
        onChange={(e) => update('landmark', e.target.value)}
        className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          required
          placeholder="City"
          value={address.city}
          onChange={(e) => update('city', e.target.value)}
          className="min-h-[44px] rounded-sm border border-border px-3 text-sm text-ink"
        />
        <input
          type="text"
          required
          inputMode="numeric"
          maxLength={6}
          placeholder="PIN code"
          value={address.pincode}
          onChange={(e) => update('pincode', e.target.value.replace(/\D/g, ''))}
          className="min-h-[44px] rounded-sm border border-border px-3 text-sm text-ink"
        />
      </div>
      <select
        required
        value={address.state}
        onChange={(e) => update('state', e.target.value)}
        className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
      >
        <option value="">Select state</option>
        {INDIAN_STATES.map((s) => (
          <option key={s.code} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
