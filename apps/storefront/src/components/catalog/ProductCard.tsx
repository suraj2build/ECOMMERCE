import Image from 'next/image';
import Link from 'next/link';

export interface ProductCardData {
  id: string;
  name: string;
  brandName: string;
  thumbnailUrl: string | null;
  mrp: string | number;
  sellingPrice: string | number;
  isMarkdown: boolean;
  inStock?: boolean;
  colours?: string[];
  sizes?: string[];
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <article className="group">
      <Link href={`/product/${product.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-[18px] bg-[var(--color-surface-soft)]">
          {product.thumbnailUrl ? (
            <Image
              src={product.thumbnailUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-center text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              Image coming soon
            </div>
          )}
          {product.inStock === false && (
            <span className="absolute bottom-3 left-3 rounded-full bg-canvas/95 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink">
              Out of stock
            </span>
          )}
          {product.isMarkdown && (
            <span className="absolute left-3 top-3 rounded-full bg-accent px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent-ink">
              Sale
            </span>
          )}
        </div>

        <div className="px-1 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{product.brandName}</p>
          <h3 className="mt-1 line-clamp-1 text-sm font-medium leading-snug text-ink transition-colors group-hover:text-accent">
            {product.name}
          </h3>
          <p className="mt-1.5 flex items-center gap-2 text-sm">
            <span className={product.isMarkdown ? 'font-semibold text-danger' : 'font-medium text-ink'}>&#8377;{product.sellingPrice}</span>
            {product.isMarkdown && <span className="text-xs text-ink-muted line-through">&#8377;{product.mrp}</span>}
          </p>
          {product.colours && product.colours.length > 0 && (
            <p className="mt-1 text-[10px] text-ink-muted">
              {product.colours.slice(0, 2).join(' · ')}{product.colours.length > 2 ? ` +${product.colours.length - 2}` : ''}
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
