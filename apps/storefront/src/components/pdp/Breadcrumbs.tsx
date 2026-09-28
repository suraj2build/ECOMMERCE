import Link from 'next/link';

export interface BreadcrumbItem {
  name: string;
  href: string;
}

/**
 * Visual breadcrumb trail (M27, specs/26-seo.md), matching the unified
 * category taxonomy the PDP itself already resolves from
 * (`categoryName`/`categorySlug`). No dedicated category browsing page
 * exists in this codebase yet, so the category crumb links to the
 * storefront home rather than a fabricated route - an honest scope
 * boundary, not a broken link.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="py-3 text-sm text-neutral-700">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden="true">/</span>}
            {index === items.length - 1 ? (
              <span aria-current="page" className="text-neutral-900">
                {item.name}
              </span>
            ) : (
              <Link href={item.href} className="text-neutral-700 hover:underline">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
