'use client';

/**
 * The approved AI Studio listing (Stitch-Spark_Ai_Studio views/PlpView.tsx).
 * Results, counts and filter options come from the real search index and the
 * page URL, so a filtered listing can be shared, reloaded and paged. Desktop
 * filters apply as you choose them, as in the design; the phone "Filter &
 * Refine" sheet applies on "Apply filters" (and works without scripts).
 * Left out: the prototype's Fit-First garment-dimension filter, which needs
 * per-garment measurements the catalogue does not hold.
 */
import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { SlidersHorizontal, ArrowUpDown, X, LayoutGrid, Grid3X3 } from 'lucide-react';
import type { StorefrontSearchResult } from '@/lib/api';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { TrackListView } from '@/components/consent/TrackListView';
import { hitToProduct } from '../bridge/adapters';
import { ShopProductCard } from '../bridge/ShopProductCard';
import { entrance } from '../bridge/entrance';
import { Breadcrumb, type BreadcrumbItem } from '../components/Breadcrumb';

// Staggered entrance animation variants for editorial product browsing
const gridContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.03,
    },
  },
};

const gridItemVariants = {
  hidden: { opacity: 0, y: 26, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.46,
      ease: [0.22, 1, 0.36, 1] as const, // bespoke luxury quintic easing
    },
  },
};

export type ListingSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'rating';

/** The listing's state, as held in the page URL. */
export interface ListingQuery {
  q?: string;
  gender?: 'men' | 'women';
  categories: string[];
  colours: string[];
  inStock: boolean;
  sort: ListingSort;
}

export interface Facet {
  value: string;
  label: string;
  count: number;
  /** Colour facets: the swatch colour, when the catalogue has one. */
  hex?: string;
}

interface PlpViewProps {
  title: string;
  eyebrow: string;
  description: string;
  /** Path of this listing; filters keep it unless the category set changes. */
  basePath: string;
  /** A real category route (/category/<slug>): its own category is pre-selected. */
  routeCategory?: string;
  query: ListingQuery;
  result: StorefrontSearchResult;
  categoryFacets: Facet[];
  colourFacets: Facet[];
  listName: string;
  searchTerm?: string;
  breadcrumbItems?: BreadcrumbItem[];
}

function hrefFor(path: string, query: ListingQuery, page?: number) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.gender) params.set('gender', query.gender);
  if (query.categories.length) params.set('category', query.categories.join(','));
  if (query.colours.length) params.set('color', query.colours.join(','));
  if (query.inStock) params.set('inStock', 'true');
  if (query.sort !== 'relevance') params.set('sort', query.sort);
  if (page && page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function PlpView({
  title,
  description,
  basePath,
  routeCategory,
  query,
  result,
  categoryFacets,
  colourFacets,
  listName,
  searchTerm,
  breadcrumbItems = [{ label: 'Home', href: '/' }, { label: title }],
}: PlpViewProps) {
  const router = useRouter();
  const gender = query.gender;

  // Mobile filter drawer state
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(true);

  // Grid column density (desktop)
  const [gridCols, setGridCols] = useState<3 | 4>(3);

  const selectedCategories = query.categories;
  const selectedColors = query.colours;
  const inStockOnly = query.inStock;
  const products = result.hits.map(hitToProduct);
  const total = result.totalHits;

  /** Where a filter change goes: one category on a department listing opens
   * that category's own page; anything else stays on this listing's path. */
  const go = (next: Partial<ListingQuery>) => {
    const merged: ListingQuery = { ...query, ...next };
    const departmentListing = Boolean(routeCategory) || (Boolean(gender) && basePath === `/category/${gender}`);
    let path = basePath;
    let categories = merged.categories;
    if (departmentListing && !merged.q) {
      if (categories.length === 1) {
        path = `/category/${categories[0]}`;
        categories = [];
      } else {
        path = gender ? `/category/${gender}` : '/search';
      }
    }
    router.push(hrefFor(path, { ...merged, categories }), { scroll: false });
  };

  const toggleCategory = (cat: string) => {
    go({ categories: selectedCategories.includes(cat) ? selectedCategories.filter((c) => c !== cat) : [...selectedCategories, cat] });
  };

  const toggleColor = (color: string) => {
    go({ colours: selectedColors.includes(color) ? selectedColors.filter((c) => c !== color) : [...selectedColors, color] });
  };

  const clearAllFilters = () => go({ categories: [], colours: [], inStock: false });

  const activeFiltersCount = selectedCategories.length + selectedColors.length + (inStockOnly ? 1 : 0);
  const categoryName = (slug: string) => categoryFacets.find((f) => f.value === slug)?.label ?? slug;

  return (
    <div className="max-w-7xl 2xl:max-w-[1760px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <TrackListView
        listName={listName}
        searchTerm={searchTerm}
        items={result.hits.map((hit) => ({ styleCode: hit.styleCode, name: hit.name, price: hit.sellingPrice }))}
      />
      {/* Breadcrumb + compact title/count/toolbar row */}
      <Breadcrumb items={breadcrumbItems} className="text-xs text-[#756A5E] mb-2" />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-[#EAE3D7]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="font-editorial text-xl sm:text-2xl text-[#1A1816] font-normal truncate">
            {title}
          </h1>
          <span className="text-xs text-[#756A5E] shrink-0" role="status">
            {total} {total === 1 ? 'style' : 'styles'}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Mobile Filter Button */}
          <button
            id="btn-open-mobile-filter"
            type="button"
            onClick={() => setMobileFilterOpen(true)}
            aria-haspopup="dialog"
            className="sm:hidden flex items-center gap-2 px-4 py-2.5 bg-white border border-[#DDD3C5] rounded-full font-semibold text-[#1A1816] shadow-xs"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--color-primary)]" />
            <span>Filter {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
          </button>

          {/* Desktop Filter Toggle */}
          <button
            id="btn-toggle-desktop-filter"
            type="button"
            aria-expanded={desktopFilterOpen}
            onClick={() => setDesktopFilterOpen(!desktopFilterOpen)}
            className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-[#DDD3C5] hover:border-[#1A1816] rounded-full font-semibold text-[#1A1816] transition-all shadow-xs cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--color-primary)]" />
            <span>{desktopFilterOpen ? 'Hide Filters' : 'Show Filters'}</span>
            {activeFiltersCount > 0 && (
              <span className="bg-[var(--color-primary)] text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 bg-white border border-[#DDD3C5] px-3.5 py-1.5 rounded-full shadow-xs min-w-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#756A5E] shrink-0" aria-hidden="true" />
            <label htmlFor="select-plp-sort" className="sr-only">Sort products</label>
            <select
              id="select-plp-sort"
              value={query.sort}
              onChange={(e) => go({ sort: e.target.value as ListingSort })}
              className="bg-transparent text-xs font-medium text-[#1A1816] focus:outline-none cursor-pointer min-w-0 py-1"
            >
              <option value="relevance">Sort: Featured</option>
              <option value="newest">Sort: Newest First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>

          {/* Desktop Grid Switcher */}
          <div className="hidden lg:flex items-center gap-1 border-l border-[#DFD6C8] pl-3">
            <button
              type="button"
              onClick={() => setGridCols(3)}
              aria-pressed={gridCols === 3}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer ${gridCols === 3 ? 'text-[#1A1816] bg-[#EAE3D7]' : 'text-[#756A5E] hover:text-[#1A1816]'}`}
              title="3 Columns"
              aria-label="3 columns"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setGridCols(4)}
              aria-pressed={gridCols === 4}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer ${gridCols === 4 ? 'text-[#1A1816] bg-[#EAE3D7]' : 'text-[#756A5E] hover:text-[#1A1816]'}`}
              title="4 Columns"
              aria-label="4 columns"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {description && (
        <details className="mb-4 text-xs text-[#7A6F64] max-w-xl">
          <summary className="cursor-pointer select-none text-[#756A5E] hover:text-[#1A1816] list-none inline-flex items-center gap-1">
            About this edit <span aria-hidden="true">▾</span>
          </summary>
          <p className="mt-1.5">{description}</p>
        </details>
      )}

      {/* Active Filter Chips */}
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6 text-xs">
          <span className="text-[#756A5E] font-medium text-[11px] uppercase tracking-wider">
            Active:
          </span>

          {selectedCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-label={`Remove filter ${categoryName(c)}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#DFD6C8] rounded-full text-[#1A1816]"
            >
              <span>{categoryName(c)}</span>
              <X className="w-3 h-3 text-[#756A5E]" />
            </button>
          ))}

          {selectedColors.map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => toggleColor(col)}
              aria-label={`Remove filter ${col}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#DFD6C8] rounded-full text-[#1A1816]"
            >
              <span>{col}</span>
              <X className="w-3 h-3 text-[#756A5E]" />
            </button>
          ))}

          {inStockOnly && (
            <button
              type="button"
              onClick={() => go({ inStock: false })}
              aria-label="Remove filter In Stock Only"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#DFD6C8] rounded-full text-[#1A1816]"
            >
              <span>In Stock Only</span>
              <X className="w-3 h-3 text-[#756A5E]" />
            </button>
          )}

          <button
            type="button"
            onClick={clearAllFilters}
            className="text-[11px] uppercase tracking-wider text-[var(--color-primary)] hover:underline font-semibold ml-2 cursor-pointer"
          >
            Clear All
          </button>
        </div>
      )}

      {/* Main Content Layout: Sidebar + Grid */}
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Desktop Filter Sidebar: fixed width (not a grid fraction) so the
            product grid gets all the remaining space, letting it reach 5
            columns at very wide viewports even with filters open. */}
        {desktopFilterOpen && (
          <aside aria-label="Filters" className="hidden sm:block lg:w-72 lg:shrink-0 space-y-6 bg-[var(--color-surface)]/30 p-5 rounded-2xl border border-[var(--color-border)] text-xs shadow-xs">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <span className="font-semibold uppercase tracking-[0.16em] text-[#1A1816] text-[11px]">
                Refine Selection
              </span>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-[11px] text-[var(--color-primary)] hover:underline cursor-pointer font-medium"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Category Filter */}
            {categoryFacets.length > 0 && (
              <fieldset>
                <legend className="font-semibold text-[#2D2722] block mb-2 uppercase tracking-wider text-[11px]">
                  Category
                </legend>
                <div className="space-y-1.5">
                  {categoryFacets.map((cat) => (
                    <label
                      key={cat.value}
                      className="flex items-center gap-2 cursor-pointer hover:text-[#1A1816] text-[#554A40] py-2 px-1 -mx-1 rounded hover:bg-[#FAF7F2]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(cat.value)}
                        onChange={() => toggleCategory(cat.value)}
                        className="rounded accent-[var(--color-primary)]"
                      />
                      <span>{cat.label}</span>
                      <span className="text-[#756A5E]">({cat.count})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Colour Swatches Filter */}
            {colourFacets.length > 0 && (
              <div className="border-t border-[#EAE3D7] pt-4">
                <span className="font-semibold text-[#2D2722] block mb-2 uppercase tracking-wider text-[11px]">
                  Colour Palette
                </span>
                <div className="space-y-1.5">
                  {colourFacets.map((col) => {
                    const isSelected = selectedColors.includes(col.value);
                    return (
                      <button
                        key={col.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleColor(col.value)}
                        className={`flex items-center gap-2 w-full text-left py-2 px-1 -mx-1 rounded cursor-pointer transition-colors ${
                          isSelected
                            ? 'text-[#1A1816] font-semibold bg-[#F5EFE6]'
                            : 'text-[#554A40] hover:text-[#1A1816] hover:bg-[#FAF7F2]'
                        }`}
                        title={col.value}
                      >
                        <span
                          className={`w-3 h-3 rounded-full border shrink-0 ${
                            isSelected ? 'border-[#1A1816] ring-2 ring-offset-1 ring-[#1A1816]/30' : 'border-black/10'
                          }`}
                          style={{ backgroundColor: col.hex }}
                        />
                        <span>{col.label}</span>
                        <span className="text-[#756A5E]">({col.count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* In Stock Only Toggle */}
            <div className="border-t border-[#EAE3D7] pt-4">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-[#2D2722]">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => go({ inStock: e.target.checked })}
                  className="rounded accent-[#1A1816]"
                />
                <span>In-Stock Only</span>
              </label>
            </div>
          </aside>
        )}

        {/* Product Grid Area */}
        <section aria-label="Products" className="flex-1 min-w-0">
          {result.unavailable ? (
            <EmptyState title="Search is temporarily unavailable" body="Please try again shortly." />
          ) : products.length === 0 ? (
            <EmptyState
              title="No garments match your selection"
              body="Try removing a filter to see more of the collection."
              action={activeFiltersCount > 0 ? clearAllFilters : undefined}
            />
          ) : (
            <motion.div
              key={`plp-grid-${result.page}-${gridCols}-${desktopFilterOpen}`}
              variants={gridContainerVariants}
              initial={entrance('hidden')}
              animate="visible"
              className={`grid grid-cols-2 gap-3 sm:gap-6 ${
                desktopFilterOpen
                  ? gridCols === 4
                    ? 'sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5'
                    : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4'
                  : gridCols === 4
                  ? 'sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5'
                  : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4'
              }`}
            >
              {products.map((product) => (
                <motion.div
                  key={product.id}
                  variants={gridItemVariants}
                >
                  <ShopProductCard product={product} />
                </motion.div>
              ))}
            </motion.div>
          )}

          {result.totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-4 border-t border-[#EAE3D7] pt-8 text-xs">
              {result.page > 1 && (
                <Link href={hrefFor(basePath, query, result.page - 1)} className="px-5 py-3 bg-white border border-[#DDD3C5] hover:border-[#1A1816] rounded-full text-[#1A1816] font-medium">
                  Previous
                </Link>
              )}
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#756A5E]">
                Page {result.page} of {result.totalPages}
              </span>
              {result.page < result.totalPages && (
                <Link href={hrefFor(basePath, query, result.page + 1)} className="px-5 py-3 bg-white border border-[#DDD3C5] hover:border-[#1A1816] rounded-full text-[#1A1816] font-medium">
                  Next
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>

      {/* Mobile Bottom-Sheet Filter Drawer */}
      {mobileFilterOpen && (
        <MobileFilterSheet
          basePath={routeCategory ? (gender ? `/category/${gender}` : '/search') : basePath}
          query={query}
          total={total}
          categoryFacets={categoryFacets}
          colourFacets={colourFacets}
          onApply={(next) => { setMobileFilterOpen(false); go(next); }}
          onClose={() => setMobileFilterOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return (
    <div className="py-24 text-center space-y-3 bg-[#FAF7F2] border border-[#EAE3D7] rounded-2xl p-8">
      <h2 className="font-editorial text-2xl text-[#5E5246]">{title}</h2>
      <p className="text-xs text-[#756A5E] max-w-sm mx-auto">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action}
          className="mt-3 px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs uppercase tracking-wider font-semibold rounded-full cursor-pointer shadow-sm transition-all"
        >
          Reset All Filters
        </button>
      )}
    </div>
  );
}

/**
 * The design's phone filter sheet. It is a real GET form, so "Apply filters"
 * also works before scripts load; with scripts it navigates in place.
 */
function MobileFilterSheet({
  basePath,
  query,
  total,
  categoryFacets,
  colourFacets,
  onApply,
  onClose,
}: {
  basePath: string;
  query: ListingQuery;
  total: number;
  categoryFacets: Facet[];
  colourFacets: Facet[];
  onApply: (next: Partial<ListingQuery>) => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, sheetRef, onClose);
  const [categories, setCategories] = useState(query.categories);
  const [colours, setColours] = useState(query.colours);
  const [inStock, setInStock] = useState(query.inStock);
  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div
      id="mobile-filter-backdrop"
      className="fixed inset-0 z-[70] flex items-end sm:hidden"
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-xs" />
      <div
        id="mobile-filter-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filter-title"
        tabIndex={-1}
        className="relative w-full bg-[#FAF8F5] rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <form
          action={basePath}
          method="get"
          className="flex flex-col min-h-0"
          onSubmit={(event) => { event.preventDefault(); onApply({ categories, colours, inStock }); }}
        >
          {query.gender && <input type="hidden" name="gender" value={query.gender} />}
          {query.q && <input type="hidden" name="q" value={query.q} />}
          {query.sort !== 'relevance' && <input type="hidden" name="sort" value={query.sort} />}

          {/* Sheet Header */}
          <div className="p-4 border-b border-[#EAE3D7] flex items-center justify-between">
            <div>
              <h3 id="mobile-filter-title" className="font-editorial text-xl font-normal text-[#1A1816]">
                Filter &amp; Refine
              </h3>
              <span className="text-[10px] text-[#7A6E63] uppercase tracking-wider">
                {total} {total === 1 ? 'style' : 'styles'} in this view
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="p-2 text-[#5C5146] hover:text-black cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Sheet Body */}
          <div className="p-4 overflow-y-auto space-y-5 text-xs flex-1">
            {/* Category */}
            {categoryFacets.length > 0 && (
              <fieldset>
                <legend className="font-semibold uppercase tracking-wider text-[11px] block mb-2 text-[#1A1816]">
                  Category
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {categoryFacets.map((cat) => {
                    const on = categories.includes(cat.value);
                    return (
                      <label
                        key={cat.value}
                        className={`px-3 py-2 rounded-full border text-xs transition-all cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#1A1816] ${
                          on
                            ? 'border-[#1A1816] bg-[#1A1816] text-[#FAF8F5] font-semibold'
                            : 'border-[#DDD4C6] bg-white text-[#52483E]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="category"
                          value={cat.value}
                          checked={on}
                          onChange={() => setCategories(toggle(categories, cat.value))}
                          className="sr-only"
                        />
                        {cat.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {/* Colours */}
            {colourFacets.length > 0 && (
              <fieldset className="border-t border-[#EAE3D7] pt-4">
                <legend className="font-semibold uppercase tracking-wider text-[11px] block mb-2 pt-4 text-[#1A1816]">
                  Colour
                </legend>
                <div className="flex flex-wrap gap-2">
                  {colourFacets.map((col) => {
                    const on = colours.includes(col.value);
                    return (
                      <label
                        key={col.value}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#1A1816] ${
                          on
                            ? 'border-[#1A1816] bg-white font-bold'
                            : 'border-[#DDD3C5] bg-white text-[#655A4F]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="color"
                          value={col.value}
                          checked={on}
                          onChange={() => setColours(toggle(colours, col.value))}
                          className="sr-only"
                        />
                        <span
                          className="w-3 h-3 rounded-full border border-black/10"
                          style={{ backgroundColor: col.hex }}
                        />
                        <span>{col.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <div className="border-t border-[#EAE3D7] pt-4">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-[#2D2722]">
                <input
                  type="checkbox"
                  name="inStock"
                  value="true"
                  checked={inStock}
                  onChange={(e) => setInStock(e.target.checked)}
                  className="rounded accent-[#1A1816] w-4 h-4"
                />
                <span>In-Stock Only</span>
              </label>
            </div>
          </div>

          {/* Sheet Footer */}
          <div className="p-4 border-t border-[#EAE3D7] bg-white flex gap-3">
            <button
              type="button"
              onClick={() => { setCategories([]); setColours([]); setInStock(false); }}
              className="flex-1 py-3 text-xs uppercase tracking-wider font-semibold border border-[#DDD3C5] hover:border-[#1A1816] text-[#1A1816] rounded-full transition-colors cursor-pointer"
            >
              Clear
            </button>
            <button
              type="submit"
              className="flex-2 py-3 bg-[#1F1C18] hover:bg-black text-white text-xs uppercase tracking-[0.16em] font-semibold rounded-full transition-colors cursor-pointer shadow-sm"
            >
              Apply filters
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
