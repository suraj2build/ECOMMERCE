'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { getProductDetailLive, type ProductDetail } from '@/lib/api';
import { useShop } from '@/vanya/bridge/shop';
import { formatPrice } from '../utils/format';
import type { Look, Story } from '@/lib/lookbook';

/** `getProductDetailLive` throws `Could not load product (${status})` for
 * any non-OK response. A definite 404 (genuinely unmapped/unpublished
 * product) and a transient backend/network failure must not render the
 * same "unavailable" message - only the former is a normal editorial
 * state, the latter is an outage worth a retry, not a quiet dead end. */
function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /\(404\)/.test(error.message);
}

type LoadedItem = { status: 'ok'; product: ProductDetail } | { status: 'unavailable' } | { status: 'error' };

export function LookShopping({ look, department }: { look: Look; department: Story['department'] }) {
  const { addToBag } = useShop();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LoadedItem[]>([]);
  const [sizes, setSizes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [loadToken, setLoadToken] = useState(0);
  const pending = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialog, () => {
    if (!pending.current) setOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setMessage('');
    setItems([]);
    setSizes({});
    Promise.all(
      look.items.map(async (item): Promise<LoadedItem> => {
        try {
          const product = await getProductDetailLive(item.styleId);
          return (product.gender ?? product.department ?? '').toLowerCase() === department
            ? { status: 'ok', product }
            : { status: 'unavailable' };
        } catch (error) {
          return { status: isNotFoundError(error) ? 'unavailable' : 'error' };
        }
      }),
    ).then((next) => {
      if (active) {
        setItems(next);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [open, look, department, loadToken]);

  async function add(index: number) {
    if (pending.current) return;
    const item = look.items[index]!;
    pending.current = true;
    setBusy(index);
    setMessage('');
    try {
      const fresh = await getProductDetailLive(item.styleId);
      if ((fresh.gender ?? fresh.department ?? '').toLowerCase() !== department)
        throw new Error('This piece is unavailable.');
      const variant = fresh.variants.find(
        (v) => v.colourId === item.colourId && v.sizeId === sizes[index],
      );
      if (!variant?.inStock || variant.availableQuantity < 1)
        throw new Error('This colour and size is no longer available. Please choose again.');
      try {
        // addToBag (shop.tsx) resolves the variant again, calls the cart
        // API, syncs the shared bag/cart state, and records the add-to-cart
        // analytics event - all of which a one-off addToCart() call here
        // would otherwise skip.
        await addToBag(item.styleId, variant.colourName, variant.sizeLabel, 1);
      } catch (error) {
        throw new Error(
          (error instanceof Error ? error.message : 'Could not confirm this add.') +
            ' Check your bag before retrying.',
        );
      }
      setMessage(fresh.name + ' added to your bag.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not add this item. Check your bag before retrying.',
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  if (!look.items.length)
    return (
      <p className="text-sm leading-6 mt-5">
        Editorial inspiration. Product shopping will appear here when the exact pictured pieces are
        linked. Accessories may be styling only.
      </p>
    );
  return (
    <>
      <div className="flex flex-wrap gap-4 mt-6">
        <button
          className="rounded-full bg-[#241F1A] text-white px-6 py-3"
          onClick={() => setOpen(true)}
        >
          Shop this look · {look.items.length} {look.items.length === 1 ? 'piece' : 'pieces'}
        </button>
        {look.items.map((item) => (
          <Link
            key={item.styleId + item.colourId}
            className="underline text-sm self-center"
            href={'/product/' + item.styleId}
          >
            Product details
          </Link>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-end">
          <button
            aria-label="Close shopping backdrop"
            disabled={busy !== null}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label={'Shop ' + look.title}
            tabIndex={-1}
            className="relative bg-[#FAF7F2] text-[#241F1A] w-full sm:max-w-lg p-6 rounded-t-3xl sm:rounded-none overflow-auto max-h-[85vh] sm:h-full sm:max-h-screen"
          >
            <div className="flex justify-between gap-4">
              <h3 className="font-editorial text-3xl">Shop this look</h3>
              <button
                disabled={busy !== null}
                onClick={() => setOpen(false)}
                aria-label="Close shopping panel"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm">{look.title}</p>
            <p role="status" aria-live="polite" className="text-sm my-4">
              {loading ? 'Loading current sizes and prices…' : message}
            </p>
            {!loading &&
              look.items.map((item, index) => {
                const loaded = items[index];
                if (!loaded || loaded.status === 'unavailable')
                  return (
                    <p key={index} className="border-t py-5">
                      This pictured piece is unavailable.
                    </p>
                  );
                if (loaded.status === 'error')
                  return (
                    <p key={index} className="border-t py-5">
                      Couldn&rsquo;t load this piece right now.{' '}
                      <button type="button" className="underline" onClick={() => setLoadToken((n) => n + 1)}>
                        Retry
                      </button>
                    </p>
                  );
                const product = loaded.product;
                const variants = product.variants.filter((v) => v.colourId === item.colourId);
                if (!variants.length)
                  return (
                    <p key={index} className="border-t py-5">
                      This pictured piece is unavailable.
                    </p>
                  );
                return (
                  <div key={index} className="border-t border-[#cec4b8] py-5">
                    <Link href={'/product/' + item.styleId} className="underline">
                      {product.name}
                    </Link>
                    <p className="text-sm my-2">
                      {variants[0]!.colourName} · {formatPrice(product.sellingPrice)}
                    </p>
                    <label className="text-sm" htmlFor={'size-' + index}>
                      Choose size
                    </label>
                    <select
                      id={'size-' + index}
                      value={sizes[index] ?? ''}
                      onChange={(event) => setSizes({ ...sizes, [index]: event.target.value })}
                      className="block border p-3 w-full mt-2 bg-white"
                      disabled={busy !== null}
                    >
                      <option value="">Select a size</option>
                      {variants.map((v) => (
                        <option key={v.skuId} value={v.sizeId} disabled={!v.inStock}>
                          {v.sizeLabel}
                          {!v.inStock ? ' — sold out' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!sizes[index] || busy !== null}
                      onClick={() => void add(index)}
                      className="bg-[#241F1A] text-white px-5 py-3 rounded-full mt-4 disabled:opacity-50"
                    >
                      {busy === index ? 'Adding…' : 'Add this piece'}
                    </button>
                  </div>
                );
              })}
            <Link href="/bag" className="underline text-sm">
              View your bag
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

export function ShopStoryView({ story }: { story: Story }) {
  return (
    <article className="max-w-[1440px] mx-auto w-full">
      <header className="grid lg:grid-cols-2">
        <div className="p-6 sm:p-12 lg:py-24 flex flex-col justify-center">
          <Link
            href={'/' + story.department + '/lookbook'}
            className="text-xs uppercase tracking-[.2em] underline"
          >
            {story.department} / Lookbook
          </Link>
          <h1 className="font-editorial text-5xl sm:text-7xl mt-8 mb-6">{story.title}</h1>
          <p className="leading-7 max-w-lg">{story.intro}</p>
          <nav aria-label="Story chapters" className="flex flex-wrap gap-4 mt-8">
            {story.looks.map((look, i) => (
              <a key={i} href={'#look-' + i} className="text-sm underline">
                {String(i + 1).padStart(2, '0')} {look.title}
              </a>
            ))}
          </nav>
        </div>
        <img
          src={story.cover}
          alt={story.title + ' cover'}
          className="w-full h-[500px] sm:h-[650px] object-cover object-top"
          fetchPriority="high"
        />
      </header>
      <div className="px-6 sm:px-12 py-14 space-y-24">
        {story.looks.map((look, index) => (
          <section
            id={'look-' + index}
            key={index}
            className={'grid lg:grid-cols-2 gap-8 lg:gap-16 items-center scroll-mt-40'}
          >
            <img
              src={look.image}
              alt={look.alt}
              loading="lazy"
              className={
                'w-full rounded-2xl max-h-[800px] object-cover object-top ' +
                (index % 2 ? 'lg:order-2' : '')
              }
            />
            <div>
              <p className="text-xs uppercase tracking-[.25em]">
                Look {String(index + 1).padStart(2, '0')} / {story.occasion}
              </p>
              <h2 className="font-editorial text-4xl sm:text-5xl my-5">{look.title}</h2>
              <p className="text-sm leading-7">{look.caption}</p>
              <LookShopping look={look} department={story.department} />
            </div>
          </section>
        ))}
      </div>
      <div className="px-6 sm:px-12 py-10 border-t">
        <Link href={'/' + story.department + '/lookbook'} className="underline">
          Explore more stories →
        </Link>
      </div>
    </article>
  );
}
