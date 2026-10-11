import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cityIssue,
  findIssue,
  issuePages,
  readPageNumber,
  spreadFor,
} from '../src/lib/lookbook-issue';
import { resolveIssueProducts } from '../src/lib/lookbook-issue-products';
import {
  getProductDetail,
  getPublicStyles,
  type ProductDetail,
  type PublicStyleSummary,
} from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ getProductDetail: vi.fn(), getPublicStyles: vi.fn() }));
const list = vi.mocked(getPublicStyles);
const detail = vi.mocked(getProductDetail);
const first = cityIssue.looks[0]!;
const issue = { ...cityIssue, looks: [first] };
const summary = (code: string, id: string) => ({ id, styleCode: code }) as PublicStyleSummary;
function product(code: string, id: string, colour: string): ProductDetail {
  return {
    id,
    styleCode: code,
    gender: 'women',
    variants: [{ colourName: colour, colourId: id + '-colour' }],
  } as ProductDetail;
}
beforeEach(() => {
  vi.resetAllMocks();
});
describe('complete edition', () => {
  it('has the approved 32-page book and every look has a photo and products page', () => {
    const pages = issuePages(cityIssue);
    expect(pages).toHaveLength(32);
    expect(pages.filter((p) => p.kind === 'chapter').map((p) => p.number)).toEqual([4, 13, 20]);
    for (const look of cityIssue.looks)
      expect(pages.filter((p) => p.lookId === look.id).map((p) => p.kind)).toEqual([
        'photo',
        'products',
      ]);
    expect(findIssue('men', cityIssue.slug)).toBeUndefined();
  });
  it('pairs every outfit with its own products and keeps chapters standalone', () => {
    const pages = issuePages(cityIssue);
    expect(spreadFor(1, pages)).toEqual([1]);
    expect(spreadFor(13, pages)).toEqual([13]);
    expect(spreadFor(32, pages)).toEqual([32]);
    for (const page of pages.filter((p) => p.kind === 'products')) {
      const spread = spreadFor(page.number, pages);
      expect(spread).toEqual([page.number - 1, page.number]);
      expect(spread.map((n) => pages[n - 1]!.lookId)).toEqual([page.lookId, page.lookId]);
    }
    expect(readPageNumber('#page=999', 32)).toBe(32);
    expect(readPageNumber('#page=0', 32)).toBe(1);
    expect(readPageNumber('#page=abc', 32)).toBeNull();
  });
  it('resolves exact codes and colours beyond the first catalogue page', async () => {
    list
      .mockResolvedValueOnce(Array.from({ length: 60 }, (_, i) => summary('other-' + i, '' + i)))
      .mockResolvedValueOnce(first.products.map((p, i) => summary(p.styleCode, 'id' + i)));
    detail.mockImplementation(async (id) => {
      const i = Number(id.slice(2));
      const p = first.products[i]!;
      return product(p.styleCode, id, p.colourName);
    });
    const result = await resolveIssueProducts(issue);
    expect(list).toHaveBeenNthCalledWith(2, 60, 60);
    expect(result.issue.looks[0]!.items).toEqual([
      { styleId: 'id0', colourId: 'id0-colour' },
      { styleId: 'id1', colourId: 'id1-colour' },
    ]);
  });
  it('never substitutes a similar product or a different colour', async () => {
    list.mockResolvedValue(first.products.map((p, i) => summary(p.styleCode, 'id' + i)));
    detail.mockImplementation(async (id) => {
      const i = Number(id.slice(2));
      return product(
        first.products[i]!.styleCode,
        id,
        i === 0 ? 'Similar Pink' : first.products[i]!.colourName,
      );
    });
    expect((await resolveIssueProducts(issue)).issue.looks[0]!.items).toEqual([]);
  });
  it('fails closed on duplicate codes, ambiguous colours and other departments', async () => {
    list.mockResolvedValue([
      summary(first.products[0]!.styleCode, 'id0'),
      summary(first.products[0]!.styleCode, 'duplicate'),
    ]);
    expect((await resolveIssueProducts(issue)).issue.looks[0]!.items).toEqual([]);
    list.mockResolvedValue(first.products.map((p, i) => summary(p.styleCode, 'id' + i)));
    detail.mockImplementation(async (id) => {
      const i = Number(id.slice(2));
      const p = product(first.products[i]!.styleCode, id, first.products[i]!.colourName);
      p.gender = 'men';
      return p;
    });
    expect((await resolveIssueProducts(issue)).issue.looks[0]!.items).toEqual([]);
    detail.mockImplementation(async (id) => {
      const i = Number(id.slice(2));
      const p = product(first.products[i]!.styleCode, id, first.products[i]!.colourName);
      p.variants.push({ ...p.variants[0]!, colourId: 'another' });
      return p;
    });
    expect((await resolveIssueProducts(issue)).issue.looks[0]!.items).toEqual([]);
  });
  it('keeps the book readable during a catalogue outage without stale buy buttons', async () => {
    list.mockRejectedValue(new Error('offline'));
    const result = await resolveIssueProducts(issue);
    expect(result.catalogueUnavailable).toBe(true);
    expect(result.issue.looks[0]!.items).toEqual([]);
  });
});
