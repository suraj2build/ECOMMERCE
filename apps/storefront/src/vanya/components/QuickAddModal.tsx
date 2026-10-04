'use client';

/**
 * The approved AI Studio quick-add sheet (Stitch-Spark_Ai_Studio
 * components/QuickAddModal.tsx). Sizes come from the live product, per
 * colour, so a sold-out size cannot be chosen; the add goes to the real bag.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import type { ProductDetail } from '@/lib/api';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { useShop } from '../bridge/shop';
import { NO_SWATCH } from '../bridge/adapters';
import { formatPrice } from '../utils/format';

export function QuickAddModal() {
  const { quickAdd, setQuickAdd } = useShop();
  if (!quickAdd) return null;
  return <QuickAddSheet key={quickAdd.product.id} onClose={() => setQuickAdd(null)} />;
}

function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const { quickAdd, loadProduct, addToBag, setBagOpen, openSizeGuide } = useShop();
  const product = quickAdd!.product;
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, sheetRef, onClose);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [selectedColor, setSelectedColor] = useState(quickAdd!.colorName || product.colors[0]?.name || '');
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [isAdded, setIsAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProduct(product.id)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setSelectedColor((current) => next.variants.some((v) => v.colourName === current) ? current : next.variants[0]?.colourName ?? current);
      })
      .catch(() => { if (!cancelled) setError('Sizes could not be loaded. Please open the product page.'); });
    return () => { cancelled = true; };
  }, [loadProduct, product.id]);

  const activeColorObj = product.colors.find((c) => c.name === selectedColor) || product.colors[0];
  const sizes = detail
    ? detail.variants
        .filter((v) => v.colourName === selectedColor)
        .map((v) => ({ size: v.sizeLabel, inStock: v.inStock, stockCount: v.availableQuantity }))
    : [];

  const handleAdd = async () => {
    if (!selectedSize) return;
    setBusy(true);
    setError(null);
    try {
      await addToBag(product.id, selectedColor, selectedSize);
      setIsAdded(true);
      setTimeout(() => {
        onClose();
        setBagOpen(true);
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to bag.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="quick-add-backdrop"
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-xs" />
      <div
        id="quick-add-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Quick add: ${product.title}`}
        tabIndex={-1}
        className="relative w-full sm:max-w-md bg-[#FAF8F5] rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl transition-all overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-[#EAE3D7]">
          <div className="flex gap-3 min-w-0">
            {activeColorObj?.images[0] ? (
              <img
                src={activeColorObj.images[0]}
                alt=""
                className="w-16 h-20 object-cover rounded-xl bg-[#EFE9DF]"
              />
            ) : (
              <span className="w-16 h-20 rounded-xl bg-[#EFE9DF] shrink-0" />
            )}
            <div className="min-w-0">
              <span className="text-[10px] tracking-[0.2em] text-[#756A5E] uppercase font-semibold">
                Quick Add
              </span>
              <h4 className="text-sm font-medium text-[#1A1816] line-clamp-1 mt-0.5">
                {product.title}
              </h4>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-semibold text-sm text-[#1A1816]">
                  {formatPrice(product.price)}
                </span>
                {product.mrp > product.price && (
                  <span className="text-xs text-[#756A5E] line-through">
                    {formatPrice(product.mrp)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            id="btn-close-quick-add"
            type="button"
            onClick={onClose}
            aria-label="Close quick add"
            className="text-[#645A50] hover:text-[#1A1816] p-2 -m-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Color Variants */}
        {product.colors.length > 0 && product.colors[0]!.name && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium text-[#443C35]">
                Colour: <strong className="font-semibold text-[#1A1816]">{selectedColor}</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {product.colors.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  aria-pressed={selectedColor === color.name}
                  onClick={() => { setSelectedColor(color.name); setSelectedSize(''); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-all ${
                    selectedColor === color.name
                      ? 'border-[#1A1816] bg-white font-medium shadow-xs'
                      : 'border-[#E0D8CB] bg-white/40 text-[#6B5F53] hover:border-[#1A1816]'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-black/10"
                    style={{ backgroundColor: color.hex === NO_SWATCH ? undefined : color.hex }}
                  />
                  <span>{color.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Size Selection */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-[#443C35]">Select Size</span>
            <button
              type="button"
              onClick={() => { onClose(); openSizeGuide(detail); }}
              className="text-[#A85B3F] hover:underline font-medium text-[11px] py-1"
            >
              Size Guide
            </button>
          </div>

          {!detail && !error && <p className="text-xs text-[#756A5E] py-3">Checking sizes…</p>}
          <div className="grid grid-cols-4 gap-2">
            {sizes.map((s) => {
              const isAvailable = s.inStock;
              const isSelected = selectedSize === s.size;

              return (
                <button
                  key={s.size}
                  type="button"
                  disabled={!isAvailable}
                  aria-pressed={isSelected}
                  aria-label={isAvailable ? `Size ${s.size}` : `Size ${s.size}, sold out`}
                  onClick={() => setSelectedSize(s.size)}
                  className={`py-2.5 text-xs font-medium rounded-xl border transition-all relative ${
                    !isAvailable
                      ? 'border-[#EBE4D8] bg-[#F5EFE6]/50 text-[#B5A99B] cursor-not-allowed line-through'
                      : isSelected
                      ? 'border-[#1A1816] bg-[#1A1816] text-[#FAF8F5]'
                      : 'border-[#DFD6C8] bg-white hover:border-[#1A1816] text-[#1A1816]'
                  }`}
                >
                  <span>{s.size}</span>
                  {s.stockCount > 0 && s.stockCount <= 3 && isAvailable && (
                    <span className="block text-[8px] text-[#A85B3F] font-normal leading-tight">
                      {s.stockCount} left
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-[#962E3B]">{error}</p>}

        {/* Add Button */}
        <div className="mt-6">
          <button
            id="btn-confirm-quick-add"
            type="button"
            disabled={!selectedSize || isAdded || busy}
            onClick={() => void handleAdd()}
            className={`w-full py-3.5 px-6 text-xs font-semibold uppercase tracking-[0.16em] rounded-full transition-all flex items-center justify-center gap-2 ${
              isAdded
                ? 'bg-[#3F6A48] text-white'
                : !selectedSize
                ? 'bg-[#DDD5C7] text-[#756A5E] cursor-not-allowed'
                : 'bg-[#1F1C18] text-[#FAF8F5] hover:bg-black active:scale-[0.99] shadow-sm'
            }`}
          >
            {isAdded ? (
              <>
                <Check className="w-4 h-4" />
                <span role="status">Added to Bag</span>
              </>
            ) : !selectedSize ? (
              'Select a Size to Add'
            ) : busy ? (
              'Adding…'
            ) : (
              'Add to Bag'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
