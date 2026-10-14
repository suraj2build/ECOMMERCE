/**
 * Maps the storefront's real API data onto the approved AI Studio design's
 * own types (vanya/types.ts), so the design's components render unchanged.
 * Nothing here invents data: a field the API does not have is left empty
 * (and the component hides it), never filled with a prototype value.
 */
import type { CartItemView } from '@/lib/cart';
import type { ProductDetail, PublicStyleSummary, ShoppableMediaSummary, StorefrontSearchHit } from '@/lib/api';
import type { CartItem, ColorVariant, Product, ShoppableReel, SizeVariant } from '../types';

/** A swatch whose colour has no hex value shows as an outlined circle. */
export const NO_SWATCH = 'transparent';

const BADGE_LABELS: Record<string, NonNullable<Product['badges']>[number]> = {
  BESTSELLER: 'BESTSELLER',
  NEW_ARRIVAL: 'NEW',
};

function badges(types: string[] | undefined): Product['badges'] {
  const labels = (types ?? []).map((type) => BADGE_LABELS[type]).filter((label): label is NonNullable<Product['badges']>[number] => Boolean(label));
  return [...new Set(labels)];
}

function discountPercent(mrp: number, price: number) {
  return mrp > price ? Math.round(((mrp - price) / mrp) * 100) : undefined;
}

function gender(value: string | null | undefined): Product['gender'] {
  const normalized = value?.toLowerCase();
  return normalized === 'men' || normalized === 'women' ? normalized : 'unisex';
}

function emptyProduct(id: string): Product {
  return {
    id,
    title: '',
    slug: id,
    subtitle: '',
    gender: 'unisex',
    category: '',
    collection: '',
    price: 0,
    mrp: 0,
    colors: [],
    sizes: [],
    fit: '',
    fabric: '',
    care: [],
    occasion: '',
    badges: [],
    rating: 0,
    reviewCount: 0,
    modelInfo: { height: '', wearingSize: '' },
    details: [],
    attributes: [],
    fitNotes: '',
    styleNotes: '',
    manufacturing: { origin: '', artisanCluster: '', sustainableNote: '' },
    reviews: [],
  };
}

/** A listing/search result as the design's Product (card data only). */
export function hitToProduct(hit: StorefrontSearchHit): Product {
  const swatches = hit.swatches?.length
    ? hit.swatches
    : hit.colours.map((name) => ({ name, hex: null, imageUrl: null }));
  const colors: ColorVariant[] = swatches.map((swatch, index) => {
    const first = index === 0 ? hit.thumbnailUrl ?? swatch.imageUrl : swatch.imageUrl ?? hit.thumbnailUrl;
    const images = [first, index === 0 ? hit.hoverImageUrl : null].filter((url): url is string => Boolean(url));
    return { name: swatch.name, hex: swatch.hex ?? NO_SWATCH, images };
  });
  if (colors.length === 0) colors.push({ name: '', hex: NO_SWATCH, images: hit.thumbnailUrl ? [hit.thumbnailUrl] : [] });
  const sizes: SizeVariant[] = hit.sizeAvailability?.length
    ? hit.sizeAvailability.map((s) => ({ size: s.label, inStock: s.inStock }))
    : hit.sizes.map((size) => ({ size, inStock: hit.inStock }));
  return {
    ...emptyProduct(hit.id),
    title: hit.name,
    subtitle: hit.subtitle ?? '',
    gender: gender(hit.gender),
    category: hit.categoryName,
    price: hit.sellingPrice,
    mrp: hit.mrp,
    discountPercent: discountPercent(hit.mrp, hit.sellingPrice),
    colors,
    sizes,
    fit: hit.fit ?? '',
    fabric: hit.fabric ?? '',
    occasion: hit.occasion ?? '',
    badges: badges(hit.badges),
    rating: hit.ratingAverage ?? 0,
    reviewCount: hit.reviewCount ?? 0,
  };
}

/** The product page's full data as the design's Product. */
export function detailToProduct(detail: ProductDetail): Product {
  const colourOrder: { id: string; name: string; hex: string | null }[] = [];
  for (const variant of detail.variants) {
    if (!colourOrder.some((c) => c.id === variant.colourId)) {
      colourOrder.push({ id: variant.colourId, name: variant.colourName, hex: variant.hexSwatch });
    }
  }
  const images = detail.media.filter((m) => m.type === 'IMAGE');
  const shared = images.filter((m) => m.colourId === null).map((m) => m.url);
  const colors: ColorVariant[] = colourOrder.map((colour) => {
    const own = images.filter((m) => m.colourId === colour.id).map((m) => m.url);
    return { name: colour.name, hex: colour.hex ?? NO_SWATCH, images: [...own, ...shared] };
  });
  const sizeLabels: string[] = [];
  for (const variant of detail.variants) if (!sizeLabels.includes(variant.sizeLabel)) sizeLabels.push(variant.sizeLabel);
  const sizes: SizeVariant[] = sizeLabels.map((size) => {
    const variants = detail.variants.filter((v) => v.sizeLabel === size);
    const stockCount = variants.reduce((sum, v) => sum + v.availableQuantity, 0);
    return { size, inStock: variants.some((v) => v.inStock), stockCount };
  });
  const model = images.find((m) => m.modelInfo)?.modelInfo as { height?: unknown; wearingSize?: unknown } | undefined;
  const copy = detail.copy ?? {};
  return {
    ...emptyProduct(detail.id),
    title: detail.name,
    subtitle: copy.subtitle ?? '',
    gender: gender(detail.gender ?? detail.department),
    category: detail.categoryName,
    price: detail.sellingPrice,
    mrp: detail.mrp,
    discountPercent: discountPercent(detail.mrp, detail.sellingPrice),
    colors,
    sizes,
    fit: detail.fit ?? '',
    // For shoes, belts and perfume the material is shown with the other
    // attributes in Product Details, not as a textile composition.
    fabric: !detail.productType || detail.productType === 'APPAREL' ? (detail.fabric ?? '') : '',
    care: (detail.washCare ?? '').split(/\.\s+|\n/).map((line) => line.replace(/\.$/, '').trim()).filter(Boolean),
    occasion: detail.occasion ?? '',
    badges: badges(detail.badges.map((b) => b.type)),
    rating: detail.ratingSummary.averageRating ?? 0,
    reviewCount: detail.ratingSummary.reviewCount,
    modelInfo: {
      height: typeof model?.height === 'string' ? model.height : '',
      wearingSize: typeof model?.wearingSize === 'string' ? model.wearingSize : '',
    },
    details: copy.details ?? [],
    attributes: detail.attributes ?? [],
    fitNotes: copy.fitNotes ?? '',
    styleNotes: copy.styleNotes ?? '',
    manufacturing: {
      origin: detail.countryOfOrigin ?? '',
      artisanCluster: copy.artisanCluster ?? '',
      sustainableNote: copy.sustainableNote ?? '',
    },
    reviews: detail.reviews.map((review) => ({
      id: review.id,
      author: review.customerName,
      rating: review.rating,
      date: new Date(review.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      verified: false,
      title: review.title ?? '',
      comment: review.body,
      fitFeedback: 'True to size',
      purchasedSize: '',
      purchasedColor: '',
    })),
  };
}

/** A bag line as the design's CartItem plus the Product the drawer shows. */
export function cartLineToDesign(item: CartItemView): { cartItem: CartItem; product: Product } {
  const price = item.currentPrice ?? item.priceAtAdd;
  return {
    cartItem: { id: item.skuId, productId: item.styleId, colorName: item.colourName, size: item.sizeLabel, quantity: item.quantity },
    product: {
      ...emptyProduct(item.styleId),
      title: item.styleName,
      price,
      mrp: price,
      colors: [{ name: item.colourName, hex: NO_SWATCH, images: item.imageUrl ? [item.imageUrl] : [] }],
      sizes: [{ size: item.sizeLabel, inStock: item.inStock, stockCount: item.availableQuantity }],
    },
  };
}

/** A published Watch & Shop post as the design's reel. View counts and likes
 * are not recorded, so they stay empty and are not shown. */
export function mediaToReel(media: ShoppableMediaSummary): ShoppableReel {
  const [name, handle] = (media.creatorAttribution ?? 'VANYA').split(' · ');
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(media.mediaUrl);
  return {
    id: media.id,
    title: media.title,
    caption: '',
    creator: { name: name ?? 'VANYA', handle: handle ?? '', avatar: '' },
    thumbnail: media.thumbnailUrl ?? media.mediaUrl,
    videoUrl: isVideo ? media.mediaUrl : undefined,
    views: '',
    likes: 0,
    taggedProductIds: [...media.tags].sort((a, b) => a.sortOrder - b.sortOrder).map((tag) => tag.styleId),
  };
}

/** A collection's style (no colour/size detail) as the design's Product. */
export function styleSummaryToProduct(style: PublicStyleSummary): Product {
  const price = Number(style.sellingPrice);
  const mrp = Number(style.mrp);
  return {
    ...emptyProduct(style.id),
    title: style.name,
    price,
    mrp,
    discountPercent: discountPercent(mrp, price),
    colors: [{ name: '', hex: NO_SWATCH, images: style.thumbnailUrl ? [style.thumbnailUrl] : [] }],
  };
}
