import Image from 'next/image';
import Link from 'next/link';
export interface VanyaProductCardData {
  id: string;
  name: string;
  brandName: string;
  thumbnailUrl: string | null;
  mrp: number | string;
  sellingPrice: number | string;
  isMarkdown: boolean;
  categoryName?: string;
  colours?: string[];
  inStock?: boolean;
}

export function VanyaProductCard({ product }: { product: VanyaProductCardData }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[18px] border border-[#efebe4] bg-white transition-all duration-300 hover:-translate-y-1 hover:border-[#dfd9ce] hover:shadow-[0_16px_35px_-18px_rgba(35,30,26,.24)]">
      <Link href={`/product/${product.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden bg-[var(--color-surface-soft)]">
          {product.thumbnailUrl ? (
            <Image
              src={product.thumbnailUrl}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[10px] uppercase tracking-[0.18em] text-ink-muted">Image coming soon</div>
          )}

          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1">
            {product.isMarkdown ? (
              <span className="rounded-full bg-[var(--color-primary)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
                Sale
              </span>
            ) : null}
            {product.inStock === false ? (
              <span className="rounded-full bg-[#181716]/90 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
                Out of stock
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-4">
          <div>
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.13em] text-[#6e6359]">
              <span className="truncate">{product.brandName}</span>
              {product.categoryName ? <span>{product.categoryName}</span> : null}
            </div>
            <h3 className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-[#181716] transition-colors group-hover:text-[var(--color-primary)]">
              {product.name}
            </h3>
            {(product.colours?.length ?? 0) > 0 ? (
              <p className="mt-1 text-[11px] text-[#6e6359]">
                {product.colours!.slice(0, 3).join(' · ')}
                {product.colours!.length > 3 ? ` +${product.colours!.length - 3}` : ''}
              </p>
            ) : null}
          </div>

          <div className="mt-3 flex items-baseline gap-2 border-t border-[#f5f2ec] pt-3">
            <span className="text-sm font-semibold text-[#181716]">&#8377;{product.sellingPrice}</span>
            {product.isMarkdown ? <span className="text-xs text-[#73685c] line-through">&#8377;{product.mrp}</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
