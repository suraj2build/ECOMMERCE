export type Gender = 'women' | 'men' | 'all';

export interface GarmentDimensions {
  shoulder: number; // in inches
  chest: number; // in inches (chest or bust)
  waist?: number; // in inches
  inseam?: number; // in inches (for trousers, sets, pajamas)
  length?: number; // in inches (garment vertical drop)
}

export interface FitFilterCriteria {
  unit: 'in' | 'cm';
  shoulder?: number; // target shoulder width
  chest?: number; // target chest/bust circumference
  waist?: number; // target waist
  inseam?: number; // target inseam length
  length?: number; // target garment length
  tolerance?: number; // tolerance margin (default +/- 1 inch)
  easePreference?: 'tailored' | 'classic' | 'relaxed';
}

export interface ColorVariant {
  name: string;
  hex: string;
  images: string[];
}

export interface SizeVariant {
  size: string;
  inStock: boolean;
  stockCount?: number; // e.g. 2 or 3 for low stock demonstration
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  verified: boolean;
  title: string;
  comment: string;
  fitFeedback: 'True to size' | 'Runs slightly small' | 'Runs slightly large';
  userImage?: string;
  purchasedSize: string;
  purchasedColor: string;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  subtitle: string;
  gender: 'women' | 'men' | 'unisex';
  category: string;
  collection: string;
  price: number;
  mrp: number;
  discountPercent?: number;
  colors: ColorVariant[];
  sizes: SizeVariant[];
  fit: string;
  fabric: string;
  care: string[];
  occasion: string;
  badges?: ('NEW' | 'BESTSELLER' | 'LIMITED' | 'LOW STOCK' | 'POPULAR' | 'EXCLUSIVE' | 'LIMITED EDITION')[];
  rating: number;
  reviewCount: number;
  modelInfo: {
    height: string;
    wearingSize: string;
  };
  details: string[];
  /** Type-specific attributes (shoe closure, belt buckle, fragrance notes...) shown in Product Details (AO-D2). */
  attributes: Array<{ label: string; value: string }>;
  fitNotes: string;
  styleNotes: string;
  manufacturing: {
    origin: string;
    artisanCluster: string;
    sustainableNote: string;
  };
  reviews: Review[];
}

export interface ShoppableReel {
  id: string;
  title: string;
  caption: string;
  creator: {
    name: string;
    handle: string;
    avatar: string;
  };
  thumbnail: string;
  videoUrl?: string;
  views: string;
  likes: number;
  taggedProductIds: string[];
}

export interface StyledLook {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  season: string;
  taggedProductIds: string[];
}

export interface CartItem {
  id: string; // unique item uuid
  productId: string;
  colorName: string;
  size: string;
  quantity: number;
}

export interface WishlistItem {
  productId: string;
  selectedColor?: string;
  selectedSize?: string;
}

export interface FilterState {
  gender: Gender;
  categories: string[];
  sizes: string[];
  colors: string[];
  priceRange: [number, number];
  fabrics: string[];
  occasions: string[];
  fits: string[];
  sortBy: 'featured' | 'newest' | 'price-asc' | 'price-desc' | 'rating';
  inStockOnly: boolean;
}

export type OrderProgressStepKey =
  | 'confirmed'
  | 'crafting'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered';

export interface OrderTimelineEvent {
  id: string;
  stepKey: OrderProgressStepKey;
  title: string;
  description: string;
  timestamp: string;
  location?: string;
  isCompleted: boolean;
}

export interface OrderItemSummary {
  productId: string;
  title: string;
  subtitle?: string;
  colorName: string;
  size: string;
  quantity: number;
  price: number;
  image: string;
}

export interface CustomerOrder {
  id: string; // e.g. VAN-8921-DEL
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderDate: string;
  estimatedDeliveryDate: string;
  currentStep: OrderProgressStepKey;
  stepNumber: number; // 1 to 5
  statusLabel: string;
  statusBadgeVariant: 'warning' | 'info' | 'primary' | 'success';
  items: OrderItemSummary[];
  shippingAddress: {
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  payment: {
    method: string;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
    isPaid: boolean;
  };
  carrier: {
    name: string;
    trackingNumber: string;
    trackingUrl?: string;
    serviceType: string;
    currentLocation?: string;
    deliveryOtpRequired?: boolean;
    assignedRider?: {
      name: string;
      phone: string;
    };
  };
  timeline: OrderTimelineEvent[];
}

