import {
  getProductDetail,
  getPublicStyles,
  type ProductDetail,
  type PublicStyleSummary,
} from './api';
import type { LookbookIssue } from './lookbook-issue';

/** Explicit production references resolve by EXACT registered style code and
 * exact colour name. Never fuzzy-search or substitute a neighbouring product.
 * Missing/unpublished/ambiguous pieces leave that look unshoppable. */
export async function resolveIssueProducts(issue: LookbookIssue): Promise<{
  issue: LookbookIssue;
  catalogueUnavailable: boolean;
}> {
  const wanted = new Set(issue.looks.flatMap((l) => l.products.map((p) => p.styleCode)));
  const summaries: PublicStyleSummary[] = [];
  try {
    // No assortment row cap. Scan all pages so duplicate codes fail closed.
    for (let skip = 0; ; skip += 60) {
      const page = await getPublicStyles(60, skip);
      summaries.push(...page.filter((p) => wanted.has(p.styleCode)));
      if (page.length < 60) break;
    }
    const details = new Map<string, ProductDetail | null>();
    await Promise.all(
      [...wanted].map(async (code) => {
        const matches = summaries.filter((s) => s.styleCode === code);
        details.set(code, matches.length === 1 ? await getProductDetail(matches[0]!.id) : null);
      }),
    );
    const looks = issue.looks.map((look) => {
      const items = look.products.flatMap((reference) => {
        const product = details.get(reference.styleCode);
        if (
          !product ||
          product.styleCode !== reference.styleCode ||
          (product.gender ?? product.department ?? '').toLowerCase() !== issue.department
        )
          return [];
        const colours = new Set(
          product.variants
            .filter((v) => v.colourName === reference.colourName)
            .map((v) => v.colourId),
        );
        if (colours.size !== 1) return [];
        return [{ styleId: product.id, colourId: [...colours][0]! }];
      });
      return { ...look, items: items.length === look.products.length ? items : [] };
    });
    return { issue: { ...issue, looks }, catalogueUnavailable: false };
  } catch {
    return {
      issue: { ...issue, looks: issue.looks.map((l) => ({ ...l, items: [] })) },
      catalogueUnavailable: true,
    };
  }
}
