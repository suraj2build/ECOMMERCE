'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Heart, Check, Star } from 'lucide-react';
import { Product } from '../types';
import { formatPrice } from '../utils/format';

interface ProductCardProps {
  product: Product;
  /** Kept for the design's call sites; the card links to the product page. */
  onSelectProduct?: (productId: string) => void;
  isWishlisted: boolean;
  onToggleWishlist: (productId: string) => void;
  onQuickAdd: (product: Product, selectedColor: string) => void;
  /** Adds to the real bag; rejects with a shopper-facing message. */
  onInstantAddSize?: (product: Product, colorName: string, size: string) => Promise<void> | void;
  fitBadge?: { size: string; detail: string };
}

export function ProductCard({
  product,
  isWishlisted,
  onToggleWishlist,
  onQuickAdd,
  onInstantAddSize,
  fitBadge,
}: ProductCardProps) {
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [addedSize, setAddedSize] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const href = `/product/${product.id}`;

  const currentColor = product.colors[selectedColorIndex] ?? product.colors[0] ?? { name: '', hex: 'transparent', images: [] };
  const primaryImage = currentColor.images[0];
  const hoverImage = currentColor.images[1] || currentColor.images[0];

  const handleSizeClick = async (e: React.MouseEvent, size: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (onInstantAddSize) {
      try {
        await onInstantAddSize(product, currentColor.name, size);
        setAddedSize(size);
        setTimeout(() => setAddedSize(null), 1200);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Could not add this size.');
        setTimeout(() => setNotice(null), 2500);
      }
    } else {
      onQuickAdd(product, currentColor.name);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="group flex flex-col bg-white rounded-2xl overflow-hidden border border-[#EFEBE4] hover:border-[#DFD9CE] hover:shadow-xl transition-all duration-300"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Product Image Stage */}
      <div className="relative aspect-[3/4] bg-[#F7F5F0] overflow-hidden cursor-pointer rounded-t-2xl">
        {/* The images are the link; the buttons below sit above it. */}
        <Link href={href} aria-label={product.title} className="absolute inset-0 block">
          {/* Primary Image */}
          {primaryImage && (
            <img
              src={primaryImage}
              alt={product.title}
              loading="lazy"
              className={`w-full h-full object-cover transition-opacity duration-500 ${
                isHovered && hoverImage !== primaryImage ? 'opacity-0' : 'opacity-100'
              }`}
            />
          )}

          {/* Hover Crossfade Image */}
          {hoverImage && (
            <img
              src={hoverImage}
              alt=""
              loading="lazy"
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                isHovered && hoverImage !== primaryImage ? 'opacity-100 scale-103' : 'opacity-0'
              }`}
            />
          )}
        </Link>

        {/* Top Badges (Discount / BestSeller / New / Tailored Fit) */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 z-10 max-w-[80%]">
          {fitBadge ? (
            <span className="px-2.5 py-1 bg-[#181716]/95 backdrop-blur-xs text-[#FAF8F5] text-[9px] uppercase tracking-wider font-semibold rounded-full shadow-md border border-[var(--color-primary)] flex items-center gap-1">
              <span className="text-[var(--color-primary)]">✦</span>
              <span className="truncate">Matches Size {fitBadge.size} ({fitBadge.detail})</span>
            </span>
          ) : (
            <>
              {product.mrp > product.price && (
                <span className="px-2.5 py-0.8 bg-[var(--color-primary,#947055)] text-white text-[9px] uppercase tracking-wider font-semibold rounded-full shadow-xs">
                  {product.discountPercent}% OFF
                </span>
              )}
              {product.badges?.includes('BESTSELLER') && (
                <span className="px-2.5 py-0.8 bg-[#25201B] text-white text-[9px] uppercase tracking-wider font-semibold rounded-full shadow-xs">
                  BESTSELLER
                </span>
              )}
            </>
          )}
        </div>

        {/* Wishlist Button (Heart) */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.8 }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleWishlist(product.id);
          }}
          className="absolute top-2.5 right-2.5 p-2 rounded-full bg-white/90 hover:bg-white text-[#161514] shadow-xs z-10 transition-colors cursor-pointer"
          aria-label={isWishlisted ? `Remove ${product.title} from wishlist` : `Save ${product.title} to wishlist`}
          aria-pressed={isWishlisted}
        >
          <Heart
            className={`w-4 h-4 stroke-[1.5] transition-colors ${
              isWishlisted
                ? 'fill-[var(--color-primary,#947055)] text-[var(--color-primary,#947055)]'
                : 'text-[#4A4540] hover:text-[var(--color-primary,#947055)]'
            }`}
          />
        </motion.button>

        {/* Quick Size Bar on Hover */}
        <div className="absolute bottom-0 inset-x-0 bg-white/95 backdrop-blur-xs p-2.5 border-t border-[var(--color-border)] translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out z-10">
          <div className="flex items-center justify-between text-[10px] text-[#706860] mb-1.5 font-semibold uppercase tracking-wider">
            <span>Instant Select Size</span>
            <span className="text-[var(--color-primary)]" role="status">{notice ?? 'Quick Add'}</span>
          </div>
          <div className="flex gap-1.5 justify-between">
            {product.sizes.map((s) => (
              <button
                type="button"
                key={s.size}
                disabled={!s.inStock}
                aria-label={`Add size ${s.size} to bag${s.inStock ? '' : ' (sold out)'}`}
                onClick={(e) => void handleSizeClick(e, s.size)}
                className={`flex-1 py-1.5 text-[11px] font-semibold rounded-xl transition-all ${
                  !s.inStock
                    ? 'bg-[#F2ECE3] text-[#B5ACA0] cursor-not-allowed line-through'
                    : addedSize === s.size
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[#FAF8F5] hover:bg-[var(--color-primary)] hover:text-white border border-[#E5DFD4] text-[#2E2A27]'
                }`}
              >
                {addedSize === s.size ? <Check className="w-3 h-3 mx-auto" /> : s.size}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Product Details Section */}
      <div className="p-3 sm:p-4 flex flex-col flex-1 justify-between bg-white border-t border-[var(--color-border)]">
        <div>
          {/* Fabric & Rating */}
          <div className="flex items-center justify-between text-[11px] text-[#756A5E] mb-1">
            <span className="uppercase tracking-wider truncate max-w-[140px] font-medium">
              {product.fabric.split(' ')[0]} {product.fabric.split(' ')[1] || ''}
            </span>
            {product.reviewCount > 0 && (
              <div className="flex items-center gap-1 text-[var(--color-primary)] font-semibold text-[10px]" aria-label={`Rated ${product.rating} out of 5`}>
                <Star className="w-3 h-3 fill-[var(--color-primary)]" />
                <span>{product.rating}</span>
              </div>
            )}
          </div>

          {/* Title */}
          <h3 className="text-xs sm:text-sm font-medium text-[#181716] group-hover:text-[var(--color-primary)] transition-colors line-clamp-1 cursor-pointer">
            <Link href={href}>{product.title}</Link>
          </h3>

          {/* Subtitle / Fit note */}
          <p className="text-[11px] text-[#756A5E] line-clamp-1 mt-0.5">
            {product.subtitle}
          </p>
        </div>

        {/* Pricing & Colour Swatches */}
        <div className="mt-3 pt-2.5 border-t border-[#F5F2EC] flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-sm sm:text-base font-bold text-[#181716]">
              {formatPrice(product.price)}
            </span>
            {product.mrp > product.price && (
              <span className="text-xs text-[#756A5E] line-through">
                {formatPrice(product.mrp)}
              </span>
            )}
          </div>

          {/* Color Switcher Swatches */}
          <div className="flex items-center gap-1.5">
            {product.colors.map((c, idx) => (
              <button
                type="button"
                key={c.name}
                aria-label={`Show ${c.name}`}
                aria-pressed={selectedColorIndex === idx}
                onClick={() => setSelectedColorIndex(idx)}
                className={`w-3.5 h-3.5 rounded-full border transition-all ${
                  selectedColorIndex === idx
                    ? 'ring-1.5 ring-[#181716] scale-110'
                    : 'border-black/20 opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
