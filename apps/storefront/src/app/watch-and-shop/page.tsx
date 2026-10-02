import Image from 'next/image';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { getWatchAndShopFeed } from '@/lib/api';

export default async function WatchAndShopPage() {
  const items = await getWatchAndShopFeed();

  if (items.length === 0) {
    return (
      <Container className="py-16 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Watch &amp; Shop</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Stories are being prepared</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-muted">
          Published shoppable media will appear here as soon as it is available.
        </p>
      </Container>
    );
  }

  return (
    <div className="snap-y snap-mandatory md:snap-none">
      {items.map((item, index) => (
        <section key={item.id} className="min-h-[calc(100svh-96px)] snap-start border-b border-border bg-[#151210] text-white md:min-h-0 md:bg-canvas md:text-ink">
          <Container className="grid min-h-[calc(100svh-96px)] items-center gap-0 px-0 md:min-h-0 md:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)] md:gap-12 md:px-gutter md:py-12">
            <div className="relative min-h-[calc(100svh-96px)] overflow-hidden bg-black md:min-h-0 md:aspect-[4/5] md:rounded-[24px]">
              {item.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                <video src={item.mediaUrl} poster={item.thumbnailUrl ?? undefined} controls playsInline preload={index === 0 ? 'metadata' : 'none'} className="absolute inset-0 h-full w-full object-cover" />
              ) : item.thumbnailUrl || item.mediaUrl ? (
                <Image src={item.thumbnailUrl ?? item.mediaUrl} alt={item.title} fill priority={index === 0} sizes="(max-width: 768px) 100vw, 60vw" className="object-cover" />
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-6 pt-24 md:hidden">
                <p className="text-[9px] uppercase tracking-[0.18em] text-white/70">{item.creatorAttribution ?? 'VANYA edit'}</p>
                <h1 className="mt-2 font-display text-3xl leading-tight">{item.title}</h1>
              </div>
            </div>

            <div className="hidden md:block">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">{item.creatorAttribution ?? 'VANYA edit'}</p>
              <h2 className="mt-2 font-display text-4xl tracking-[-0.03em] text-ink">{item.title}</h2>
              <p className="mt-8 text-[10px] uppercase tracking-[0.16em] text-ink-muted">Shop this story</p>
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {item.tags.map((tag) => (
                  <li key={tag.id}>
                    <Link href={`/product/${tag.style.id}`} className="flex min-h-[64px] items-center justify-between gap-4 py-3 text-sm text-ink hover:text-accent">
                      <span>{tag.style.name}{tag.colour ? ` · ${tag.colour.name}` : ''}{tag.size ? ` · ${tag.size.label}` : ''}</span>
                      <span aria-hidden>&rarr;</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-canvas p-5 text-ink md:hidden">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-accent">Shop this story</p>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {item.tags.map((tag) => (
                  <Link key={tag.id} href={`/product/${tag.style.id}`} className="min-w-[180px] rounded-[16px] border border-border bg-surface p-3 text-sm">
                    <span className="block font-medium">{tag.style.name}</span>
                    <span className="mt-1 block text-xs text-ink-muted">{[tag.colour?.name, tag.size?.label].filter(Boolean).join(' · ') || 'View options'}</span>
                  </Link>
                ))}
              </div>
            </div>
          </Container>
        </section>
      ))}
    </div>
  );
}
