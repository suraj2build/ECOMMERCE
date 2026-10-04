'use client';

/**
 * Connects the approved AI Studio design's components to the real backend.
 * In the prototype, App.tsx held the bag, wishlist and navigation in memory;
 * here the same handlers call the live cart, wishlist, product and tracking
 * APIs, so every price, stock check and order goes through the real domain.
 */
import type { CmsNavItem } from '@/lib/cms-links';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getProductDetailLive, type ProductDetail } from '@/lib/api';
import {
  addToCart as apiAddToCart,
  addToWishlist,
  getCart,
  getWishlist,
  removeCartItem,
  removeFromWishlist,
  updateCartItemQuantity,
  type CartView,
  type WishlistItemView,
} from '@/lib/cart';
import { getLoyaltyBalance } from '@/lib/account';
import { getStoredSession } from '@/lib/customer-auth';
import { track } from '@/lib/tracking';
import { useDepartment } from '@/components/layout/DepartmentContext';
import type { CartItem, Gender, Product } from '../types';
import { cartLineToDesign, detailToProduct } from './adapters';

export type View = 'gateway' | 'home' | 'plp' | 'pdp' | 'reels' | 'wishlist' | 'order-status' | 'bag' | 'admin-insights';
export interface NavigateParams {
  gender?: Gender;
  category?: string;
  productId?: string;
  reelId?: string;
  orderId?: string;
}

export interface CategoryLink {
  name: string;
  slug: string;
}

export interface FooterMenus {
  about: CmsNavItem[];
  social: CmsNavItem[];
}
const NO_FOOTER_MENUS: FooterMenus = { about: [], social: [] };

/** Shop-wide delivery and returns terms (GET /storefront/policies). A value
 * is null unless the shop has confirmed it, so no component shows a guess. */
export interface ShopPolicies {
  freeDeliveryAbove: number | null;
  deliveryCharge: number | null;
  returnWindowDays: number | null;
}

interface ShopContextValue {
  gender: 'men' | 'women';
  categories: CategoryLink[];
  policies: ShopPolicies;
  /** Footer links published in the CMS navigation menus (cleaned, safe links only). */
  footerMenus: FooterMenus;
  cart: CartView | null;
  cartItems: CartItem[];
  cartProducts: Product[];
  cartCount: number;
  wishlistIds: Set<string>;
  wishlistItems: WishlistItemView[];
  loyaltyPoints: number | null;
  navigate: (view: string, params?: NavigateParams) => void;
  hrefFor: (view: string, params?: NavigateParams) => string;
  /** Adds one size of a colour to the real bag; throws with a shopper-facing message. */
  addToBag: (productId: string, colorName: string, size: string, quantity?: number) => Promise<void>;
  updateQuantity: (cartItemId: string, delta: number) => Promise<void>;
  removeItem: (cartItemId: string) => Promise<void>;
  /** Saves a bag line to the wishlist (same size) and takes it out of the bag. */
  moveToWishlist: (cartItemId: string) => Promise<void>;
  toggleWishlist: (productId: string, colorName?: string, size?: string) => Promise<void>;
  loadProduct: (productId: string) => Promise<ProductDetail>;
  bagOpen: boolean;
  setBagOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  sizeGuide: { open: boolean; product: ProductDetail | null };
  openSizeGuide: (product?: ProductDetail | null) => void;
  closeSizeGuide: () => void;
  quickAdd: { product: Product; colorName: string } | null;
  setQuickAdd: (value: { product: Product; colorName: string } | null) => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export function slugify(name: string) {
  return name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function ShopProvider({ categories, policies, footerMenus = NO_FOOTER_MENUS, children }: { categories: CategoryLink[]; policies: ShopPolicies; footerMenus?: FooterMenus; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { department, chooseDepartment, clearDepartment } = useDepartment();
  const gender = department ?? 'women';
  const [cart, setCart] = useState<CartView | null>(null);
  const [wishlistItems, setWishlistItems] = useState<WishlistItemView[]>([]);
  const [loyaltyPoints, setLoyaltyPoints] = useState<number | null>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sizeGuide, setSizeGuide] = useState<{ open: boolean; product: ProductDetail | null }>({ open: false, product: null });
  const [quickAdd, setQuickAdd] = useState<{ product: Product; colorName: string } | null>(null);
  const details = useRef(new Map<string, Promise<ProductDetail>>());

  const refreshCart = useCallback(async () => {
    try { setCart(await getCart()); } catch { /* Navigation stays usable without a bag count. */ }
  }, []);
  const refreshWishlist = useCallback(async () => {
    try { setWishlistItems(await getWishlist()); } catch { /* Navigation stays usable. */ }
  }, []);
  const refreshRewards = useCallback(async () => {
    if (!getStoredSession()) { setLoyaltyPoints(null); return; }
    try { setLoyaltyPoints((await getLoyaltyBalance()).balance); } catch { setLoyaltyPoints(null); }
  }, []);

  useEffect(() => {
    void refreshCart();
    void refreshWishlist();
    void refreshRewards();
    const identity = () => { void refreshCart(); void refreshWishlist(); void refreshRewards(); };
    const cartChanged = () => void refreshCart();
    const wishlistChanged = () => void refreshWishlist();
    window.addEventListener('fcp:cart-updated', cartChanged);
    window.addEventListener('fcp:wishlist-updated', wishlistChanged);
    window.addEventListener('fcp:customer-session-updated', identity);
    window.addEventListener('storage', identity);
    return () => {
      window.removeEventListener('fcp:cart-updated', cartChanged);
      window.removeEventListener('fcp:wishlist-updated', wishlistChanged);
      window.removeEventListener('fcp:customer-session-updated', identity);
      window.removeEventListener('storage', identity);
    };
  }, [pathname, refreshCart, refreshWishlist, refreshRewards]);

  // Opening the bag shows current prices and stock, not the last snapshot.
  useEffect(() => { if (bagOpen) void refreshCart(); }, [bagOpen, refreshCart]);

  const categorySlug = useCallback((name: string) => categories.find((c) => c.name === name)?.slug ?? slugify(name), [categories]);

  const hrefFor = useCallback((view: string, params: NavigateParams = {}) => {
    const dept = params.gender === 'men' || params.gender === 'women' ? params.gender : gender;
    switch (view) {
      case 'gateway':
      case 'home':
        return '/';
      case 'plp':
        return !params.category || params.category === 'all' || params.category === 'new'
          ? `/category/${dept}`
          : `/category/${categorySlug(params.category)}?gender=${dept}`;
      case 'pdp':
        return params.productId ? `/product/${params.productId}` : `/category/${dept}`;
      case 'reels':
        return params.reelId ? `/watch-and-shop?reel=${params.reelId}` : '/watch-and-shop';
      case 'wishlist':
        return '/wishlist';
      case 'bag':
        return '/bag';
      case 'order-status':
        return params.orderId ? `/orders/${params.orderId}` : '/orders';
      default:
        return '/';
    }
  }, [gender, categorySlug]);

  const navigate = useCallback((view: string, params: NavigateParams = {}) => {
    if (view === 'gateway') clearDepartment();
    else if (params.gender === 'men' || params.gender === 'women') chooseDepartment(params.gender);
    router.push(hrefFor(view, params));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [chooseDepartment, clearDepartment, hrefFor, router]);

  const loadProduct = useCallback((productId: string) => {
    let pending = details.current.get(productId);
    if (!pending) {
      pending = getProductDetailLive(productId);
      details.current.set(productId, pending);
      pending.catch(() => details.current.delete(productId));
      // Stock changes: a resolved detail is reused briefly, then refetched.
      setTimeout(() => details.current.delete(productId), 30_000);
    }
    return pending;
  }, []);

  const addToBag = useCallback(async (productId: string, colorName: string, size: string, quantity = 1) => {
    const detail = await getProductDetailLive(productId);
    details.current.set(productId, Promise.resolve(detail));
    const variant = detail.variants.find((v) => v.colourName === colorName && v.sizeLabel === size)
      ?? detail.variants.find((v) => v.sizeLabel === size && v.inStock);
    if (!variant) throw new Error('This size is not available.');
    if (!variant.inStock) throw new Error('This size is sold out.');
    const next = await apiAddToCart(variant.skuId, quantity);
    setCart(next);
    window.dispatchEvent(new Event('fcp:cart-updated'));
    track.addToCart({ skuCode: variant.skuCode, styleCode: detail.styleCode, name: detail.name, variant: `${variant.colourName} / ${variant.sizeLabel}`, price: detail.sellingPrice });
  }, []);

  const updateQuantity = useCallback(async (cartItemId: string, delta: number) => {
    const line = cart?.items.find((item) => item.skuId === cartItemId);
    if (!line) return;
    const quantity = line.quantity + delta;
    setCart(quantity > 0 ? await updateCartItemQuantity(cartItemId, quantity) : await removeCartItem(cartItemId));
    window.dispatchEvent(new Event('fcp:cart-updated'));
  }, [cart]);

  const removeItem = useCallback(async (cartItemId: string) => {
    setCart(await removeCartItem(cartItemId));
    window.dispatchEvent(new Event('fcp:cart-updated'));
  }, []);

  const moveToWishlist = useCallback(async (cartItemId: string) => {
    if (!wishlistItems.some((item) => item.skuId === cartItemId)) {
      setWishlistItems(await addToWishlist(cartItemId));
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
    }
    setCart(await removeCartItem(cartItemId));
    window.dispatchEvent(new Event('fcp:cart-updated'));
  }, [wishlistItems]);

  const toggleWishlist = useCallback(async (productId: string, colorName?: string, size?: string) => {
    const saved = wishlistItems.filter((item) => item.styleId === productId);
    if (saved.length > 0) {
      let latest = wishlistItems;
      for (const item of saved) latest = await removeFromWishlist(item.skuId);
      setWishlistItems(latest);
    } else {
      // The wishlist keeps a size: the chosen one, else the first available.
      const detail = await loadProduct(productId);
      const variants = detail.variants.filter((v) => !colorName || v.colourName === colorName);
      const variant = variants.find((v) => v.sizeLabel === size) ?? variants.find((v) => v.inStock) ?? variants[0] ?? detail.variants[0];
      if (!variant) return;
      setWishlistItems(await addToWishlist(variant.skuId));
      track.addToWishlist({ skuCode: variant.skuCode, styleCode: detail.styleCode, name: detail.name, variant: `${variant.colourName} / ${variant.sizeLabel}`, price: detail.sellingPrice });
    }
    window.dispatchEvent(new Event('fcp:wishlist-updated'));
  }, [wishlistItems, loadProduct]);

  const value = useMemo<ShopContextValue>(() => {
    const lines = (cart?.items ?? []).map(cartLineToDesign);
    return {
      gender,
      categories,
      policies,
      footerMenus,
      cart,
      cartItems: lines.map((l) => l.cartItem),
      cartProducts: lines.map((l) => l.product),
      cartCount: cart?.itemCount ?? 0,
      wishlistIds: new Set(wishlistItems.map((item) => item.styleId)),
      wishlistItems,
      loyaltyPoints,
      navigate,
      hrefFor,
      addToBag,
      updateQuantity,
      removeItem,
      moveToWishlist,
      toggleWishlist,
      loadProduct,
      bagOpen,
      setBagOpen,
      searchOpen,
      setSearchOpen,
      sizeGuide,
      openSizeGuide: (product?: ProductDetail | null) => setSizeGuide({ open: true, product: product ?? null }),
      closeSizeGuide: () => setSizeGuide((current) => ({ ...current, open: false })),
      quickAdd,
      setQuickAdd,
    };
  }, [gender, categories, policies, footerMenus, cart, wishlistItems, loyaltyPoints, navigate, hrefFor, addToBag, updateQuantity, removeItem, moveToWishlist, toggleWishlist, loadProduct, bagOpen, searchOpen, sizeGuide, quickAdd]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const value = useContext(ShopContext);
  if (!value) throw new Error('useShop must be used inside ShopProvider');
  return value;
}

export { detailToProduct };
