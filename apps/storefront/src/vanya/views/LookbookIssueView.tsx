'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useModalFocus } from '@/components/layout/useModalFocus';
import {
  issuePages,
  readPageNumber,
  spreadFor,
  type BookPage,
  type LookbookIssue,
} from '@/lib/lookbook-issue';
import { LookShopping } from './ShopStoryView';

function PageContent({
  page,
  issue,
  go,
}: {
  page: BookPage;
  issue: LookbookIssue;
  go: (page: number) => void;
}) {
  const look = issue.looks.find((l) => l.id === page.lookId);
  const label = (
    <p className="text-[11px] uppercase tracking-[.22em]">
      Edition {issue.number} / {String(page.number).padStart(2, '0')}
    </p>
  );
  if (page.kind === 'cover')
    return (
      <div className="relative h-full min-h-[560px] bg-[#38362d] text-white">
        <img
          src={issue.cover}
          alt="Deeksha in the rust wrap dress at the last light of day"
          className="absolute inset-0 w-full h-full object-contain"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/70" />
        <div className="relative p-8 sm:p-12 flex flex-col justify-between h-full min-h-[560px]">
          <p className="uppercase tracking-[.3em] text-xs">The lookbook / Women / 01</p>
          <div>
            <h2 className="font-editorial text-5xl sm:text-6xl leading-[1.05]">
              A city.
              <br />
              Three moods.
            </h2>
            <p className="text-sm mt-5">Twelve looks. One changing rhythm.</p>
            <button
              className="mt-8 border border-white/70 rounded-full px-6 py-3 text-sm"
              onClick={() => go(2)}
            >
              Open the book →
            </button>
          </div>
        </div>
      </div>
    );
  if (page.kind === 'photo' && look)
    return (
      <div className="h-full bg-[#faf7f2] flex flex-col">
        <img
          src={look.image}
          alt={look.alt}
          className="w-full h-[520px] object-contain bg-[#ebe1d4]"
        />
        <div className="p-7 sm:p-10 w-full">
          <p className="uppercase text-xs tracking-[.2em]">
            Look {look.id} / {look.model}
          </p>
          <h2 className="font-editorial text-4xl mt-3">{look.title}</h2>
          <p className="text-sm leading-6 mt-3 max-w-sm">{look.caption}</p>
          <button onClick={() => go(page.number + 1)} className="text-sm underline mt-4">
            See the pieces →
          </button>
        </div>
      </div>
    );
  if (page.kind === 'chapter' && page.chapter) {
    const chapter = page.chapter;
    const first = issue.looks.find((l) => l.id === chapter.lookIds[0])!;
    return (
      <div className="h-full p-7 sm:p-10 flex flex-col justify-between bg-[#ebe1d4]">
        {label}
        <div>
          <p className="uppercase text-xs tracking-[.2em]">{chapter.model}</p>
          <h2 className="font-editorial text-5xl mt-4">{chapter.title}</h2>
          <p className="leading-7 text-sm my-5">{chapter.intro}</p>
          <img
            src={first.image}
            alt={first.alt}
            loading="lazy"
            className="w-full h-64 object-contain"
          />
          <button className="underline text-sm mt-5" onClick={() => go(page.number + 1)}>
            Enter the chapter →
          </button>
        </div>
      </div>
    );
  }
  if (page.kind === 'products' && look)
    return (
      <div className="p-6 sm:p-9 h-full">
        {label}
        <p className="text-xs uppercase tracking-[.2em] mt-5">Look {look.id} / The pieces</p>
        <h2 className="font-editorial text-3xl mt-2 mb-5">{look.title}</h2>
        <div className="grid grid-cols-2 gap-3">
          {look.products.map((product) => (
            <div key={product.styleCode}>
              <img
                src={product.front}
                alt={product.colourName + ' ' + product.title + ', catalogue front view'}
                loading="lazy"
                className="w-full aspect-[4/5] object-contain bg-[#e6e4df]"
              />
              <p className="text-xs font-medium mt-2 leading-5">{product.title}</p>
              <p className="text-xs text-[#665b50]">{product.colourName}</p>
            </div>
          ))}
          {look.products.length === 1 && (
            <img
              src={look.products[0]!.detail}
              alt={look.products[0]!.title + ' fabric and construction detail'}
              loading="lazy"
              className="w-full aspect-[4/5] object-contain bg-[#e6e4df]"
            />
          )}
        </div>
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer underline">Fabric & construction details</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            {look.products.map((product) => (
              <img
                key={product.styleCode}
                src={product.detail}
                alt={product.colourName + ' ' + product.title + ' close detail'}
                loading="lazy"
                className="w-full aspect-square object-contain"
              />
            ))}
          </div>
        </details>
        {look.items.length ? (
          <LookShopping look={look} department={issue.department} />
        ) : (
          <p className="text-xs leading-5 mt-5">
            These catalogue references are not currently available to shop here. No similar item or
            colour is substituted.
          </p>
        )}
        <p className="text-[10px] leading-4 text-[#665b50] mt-4">
          Current price, size and stock appear in the shopping panel. Shoes, jewellery and bags may
          be styling only.
        </p>
      </div>
    );
  if (page.kind === 'contents')
    return (
      <div className="p-8 sm:p-12 h-full">
        {label}
        <h2 className="font-editorial text-4xl mt-14 mb-8">Inside this edition</h2>
        <nav aria-label="Edition chapters" className="space-y-8">
          {issue.chapters.map((chapter, i) => (
            <button
              key={chapter.title}
              onClick={() => go(chapter.start)}
              className="text-left w-full border-b border-[#c5b7a7] pb-6 flex justify-between gap-4"
            >
              <span>
                <span className="text-xs tracking-widest uppercase">
                  0{i + 1} / {chapter.model}
                </span>
                <span className="block font-editorial text-3xl mt-3">{chapter.title}</span>
                <span className="block text-xs mt-3">{chapter.lookIds.length} complete looks</span>
              </span>
              <span className="text-sm">{chapter.start}</span>
            </button>
          ))}
        </nav>
        <button className="text-sm underline mt-9" onClick={() => go(31)}>
          All twelve looks / page 31 →
        </button>
      </div>
    );
  if (page.kind === 'index')
    return (
      <div className="p-7 sm:p-10 h-full">
        {label}
        <h2 className="font-editorial text-4xl mt-6 mb-7">Find your moment</h2>
        <nav aria-label="Look index" className="grid grid-cols-2 gap-x-5 gap-y-5">
          {issue.looks.map((l) => {
            const target = issuePages(issue).find((p) => p.kind === 'photo' && p.lookId === l.id)!;
            return (
              <button
                key={l.id}
                onClick={() => go(target.number)}
                className="text-left border-b border-[#c5b7a7] pb-3"
              >
                <span className="text-[10px] uppercase tracking-wider">
                  {l.id} / {l.model}
                </span>
                <span className="block text-sm mt-1">{l.title} →</span>
              </button>
            );
          })}
        </nav>
        <p className="text-xs leading-5 mt-6">
          Open a look, then turn to its pieces to choose each size and shop current availability.
        </p>
      </div>
    );
  if (page.kind === 'back')
    return (
      <div className="bg-[#292820] text-[#faf7f2] p-8 sm:p-12 flex flex-col justify-between h-full">
        {label}
        <div>
          <h2 className="font-editorial text-5xl leading-tight">
            Keep your
            <br />
            own rhythm.
          </h2>
          <p className="text-sm leading-7 mt-7">
            Riya. Deeksha. Heena.
            <br />
            One city, seen three ways.
          </p>
          <Link href="/women/lookbook" className="underline text-sm inline-block mt-8">
            Explore more stories →
          </Link>
        </div>
        <p className="text-xs leading-6 opacity-80">
          AI-generated editorial and catalogue imagery for the preview collection. Garments follow
          the referenced catalogue masters. Product availability is confirmed online. Accessories
          may be styling only.
        </p>
      </div>
    );
  return (
    <div className="p-8 sm:p-12 flex flex-col justify-between h-full">
      {label}
      <div>
        <p className="uppercase text-xs tracking-[.2em]">A note from the edition</p>
        <h2 className="font-editorial text-5xl leading-tight my-8">
          Dress for
          <br />
          the moment.
        </h2>
        <p className="text-base leading-8">{issue.intro}</p>
        <p className="text-sm leading-7 mt-7">
          A collection is more than separate pieces. It is how they come together - and the moments
          you make in them.
        </p>
      </div>
      <p className="text-xs uppercase tracking-[.2em]">Morning / Afternoon / Evening</p>
    </div>
  );
}

export function LookbookIssueView({
  issue,
  catalogueUnavailable,
}: {
  issue: LookbookIssue;
  catalogueUnavailable: boolean;
}) {
  const pages = issuePages(issue);
  const [current, setCurrent] = useState(1);
  const [wide, setWide] = useState(false);
  const [mode, setMode] = useState<'book' | 'all'>('book');
  const [thumbnails, setThumbnails] = useState(false);
  const [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(false);
  const zoomDialog = useRef<HTMLDivElement>(null);
  const key = 'lookbook:' + issue.slug;
  useModalFocus(zoom, zoomDialog, () => setZoom(false));
  function go(number: number) {
    const value = Math.min(pages.length, Math.max(1, number));
    setCurrent(value);
    window.history.replaceState(null, '', '#page=' + value);
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Optional reading position. */
    }
    if (mode === 'all')
      document.getElementById('book-page-' + value)?.scrollIntoView({ block: 'start' });
  }
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(media.matches);
    const readHash = () => {
      const value = readPageNumber(window.location.hash, pages.length);
      if (value) setCurrent(value);
    };
    update();
    let value = readPageNumber(window.location.hash, pages.length);
    if (!value) {
      try {
        value = readPageNumber('#page=' + localStorage.getItem(key), pages.length);
      } catch {
        /* Optional. */
      }
    }
    if (value) setCurrent(value);
    media.addEventListener('change', update);
    window.addEventListener('hashchange', readHash);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('hashchange', readHash);
    };
  }, [key, pages.length]);
  const visible = wide ? spreadFor(current, pages) : [current];
  const previous = () => go((wide ? visible[0]! : current) - 1);
  const next = () => go((wide ? visible[visible.length - 1]! : current) + 1);
  const active = pages[current - 1]!;
  const activeLook = issue.looks.find((l) => l.id === active.lookId);
  const zoomImage =
    active.kind === 'cover'
      ? issue.cover
      : active.kind === 'photo'
        ? activeLook?.image
        : active.kind === 'chapter'
          ? issue.looks.find((l) => l.id === active.chapter?.lookIds[0])?.image
          : undefined;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        mode === 'all' ||
        zoom ||
        document.querySelector('[role="dialog"]') ||
        (target instanceof HTMLElement &&
          target.closest('input,select,textarea,button,a,[contenteditable="true"]'))
      )
        return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previous();
      }
      if (event.key === 'Home') {
        event.preventDefault();
        go(1);
      }
      if (event.key === 'End') {
        event.preventDefault();
        go(pages.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, wide, mode, zoom]);
  async function share() {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + window.location.pathname + '#page=' + current,
      );
      setMessage('Link to page ' + current + ' copied.');
    } catch {
      setMessage('Copy the page address from your browser to share this page.');
    }
  }
  return (
    <article className="w-full bg-[#e9e4dc] text-[#292820]">
      <header className="max-w-[1360px] mx-auto px-5 sm:px-9 pt-10 pb-7">
        <Link href="/women/lookbook" className="uppercase text-xs tracking-[.2em] underline">
          Women / Lookbook
        </Link>
        <div className="flex flex-wrap justify-between gap-5 mt-5 items-end">
          <div>
            <p className="uppercase text-xs tracking-[.2em]">
              Complete edition 01 / 32 pages / 12 looks
            </p>
            <h1 className="font-editorial text-4xl sm:text-5xl mt-3">{issue.title}</h1>
          </div>
          <a
            href={issue.pdf}
            download
            className="border border-[#afa294] rounded-full px-5 py-3 text-sm"
          >
            Download the complete PDF ↓
          </a>
        </div>
      </header>
      <div className="max-w-[1360px] mx-auto px-5 sm:px-9 pb-14">
        <div
          className="flex flex-wrap gap-3 items-center border-y border-[#cfc5b8] py-4 mb-5"
          role="group"
          aria-label="Book controls"
        >
          <button
            className="rounded-full border px-4 py-2 text-sm disabled:opacity-40"
            disabled={current === 1}
            onClick={previous}
          >
            ← Previous
          </button>
          <label className="text-sm">
            Page{' '}
            <select
              aria-label="Go to page"
              value={current}
              onChange={(e) => go(Number(e.target.value))}
              className="bg-transparent border rounded p-2 ml-1 max-w-[170px]"
            >
              {pages.map((p) => (
                <option key={p.number} value={p.number}>
                  {p.number} / {p.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-full border px-4 py-2 text-sm disabled:opacity-40"
            disabled={current === pages.length}
            onClick={next}
          >
            Next →
          </button>
          <button
            className="underline text-sm px-2 py-2"
            aria-expanded={thumbnails}
            onClick={() => setThumbnails(!thumbnails)}
          >
            Page overview
          </button>
          <button
            className="underline text-sm px-2 py-2"
            aria-pressed={mode === 'all'}
            onClick={() => setMode(mode === 'book' ? 'all' : 'book')}
          >
            {mode === 'book' ? 'Read continuously' : 'Book view'}
          </button>
          {zoomImage && (
            <button className="underline text-sm px-2 py-2" onClick={() => setZoom(true)}>
              Enlarge photo
            </button>
          )}
          <button className="underline text-sm px-2 py-2" onClick={() => void share()}>
            Share page
          </button>
        </div>
        <p className="text-xs mb-4" role="status" aria-live="polite">
          {message ||
            (mode === 'all'
              ? 'All 32 pages, in reading order.'
              : `Page ${current} of ${pages.length}: ${active.title}`)}
        </p>
        {catalogueUnavailable && (
          <p role="status" className="text-sm border border-[#c5b7a7] rounded p-4 mb-5">
            The catalogue could not be loaded. You can read the book; refresh later to shop its
            pieces.
          </p>
        )}
        {thumbnails && (
          <nav
            aria-label="Page overview"
            className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6"
          >
            {pages.map((p) => (
              <button
                key={p.number}
                onClick={() => {
                  go(p.number);
                  setThumbnails(false);
                }}
                aria-current={current === p.number ? 'page' : undefined}
                className={
                  'text-left p-3 min-h-20 bg-[#faf7f2] border ' +
                  (current === p.number ? 'border-[#292820]' : 'border-transparent')
                }
              >
                <span className="text-xs">{String(p.number).padStart(2, '0')}</span>
                <span className="block text-xs mt-2">{p.title}</span>
              </button>
            ))}
          </nav>
        )}
        <div
          role="region"
          aria-label="Lookbook reader"
          className={
            mode === 'all'
              ? 'max-w-3xl mx-auto space-y-8'
              : 'flex justify-center items-stretch shadow-2xl shadow-[#74654b]/20'
          }
        >
          {(mode === 'all' ? pages : visible.map((n) => pages[n - 1]!)).map((page) => (
            <section
              key={page.number}
              id={'book-page-' + page.number}
              aria-label={`Page ${page.number}: ${page.title}`}
              className={
                'bg-[#faf7f2] scroll-mt-36 overflow-hidden flex flex-col [&>div]:flex-1 ' +
                (mode === 'all'
                  ? 'min-h-[680px]'
                  : 'w-full min-h-[680px] max-w-[620px] lg:border-r border-[#d6cbbd]')
              }
            >
              <PageContent page={page} issue={issue} go={go} />
            </section>
          ))}
        </div>
        <nav
          aria-label="Quick chapter navigation"
          className="flex flex-wrap gap-6 justify-center text-sm mt-8"
        >
          {issue.chapters.map((c) => (
            <button key={c.title} className="underline py-2" onClick={() => go(c.start)}>
              {c.model} / {c.title}
            </button>
          ))}
          <button onClick={() => go(31)} className="underline py-2">
            All looks
          </button>
        </nav>
      </div>
      {zoom && zoomImage && (
        <div className="fixed inset-0 z-[110] bg-black/85 p-5 flex items-center justify-center">
          <div
            ref={zoomDialog}
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged editorial photo"
            tabIndex={-1}
            className="relative max-w-5xl w-full h-[90vh]"
          >
            <button
              className="absolute right-0 top-0 z-10 bg-white rounded-full px-5 py-3"
              onClick={() => setZoom(false)}
            >
              Close photo ✕
            </button>
            <img
              src={zoomImage}
              alt={activeLook?.alt ?? issue.title + ' editorial photo'}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
    </article>
  );
}
