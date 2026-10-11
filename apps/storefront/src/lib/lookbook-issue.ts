import content from '@/content/lookbook-issue-01.json';
import type { Look, LookbookDepartment } from './lookbook';

export interface IssueProduct {
  styleCode: string;
  colourName: string;
  title: string;
  catalogueId: string;
  front: string;
  detail: string;
  garmentDescription: string;
}
export interface IssueLook extends Look {
  id: string;
  model: string;
  scene: string;
  products: IssueProduct[];
}
export interface IssueChapter {
  title: string;
  model: string;
  intro: string;
  start: number;
  lookIds: string[];
}
export interface LookbookIssue {
  slug: string;
  department: LookbookDepartment;
  title: string;
  number: string;
  intro: string;
  cover: string;
  pdf: string;
  chapters: IssueChapter[];
  looks: IssueLook[];
}
export interface BookPage {
  number: number;
  kind: 'cover' | 'editor' | 'contents' | 'chapter' | 'photo' | 'products' | 'index' | 'back';
  title: string;
  lookId?: string;
  chapter?: IssueChapter;
}
export const cityIssue: LookbookIssue = { ...content, department: 'women' };
/** city-days is Riya's half of this issue; the other built-in story gets
 * every other look. The one place this split is decided - every caller
 * that needs to partition the issue by built-in story slug reuses this,
 * rather than each re-implementing the same rule (by model name or by a
 * hardcoded id range) and risking the copies silently disagreeing. */
export function looksForBuiltinStory<L extends { model: string }>(looks: L[], slug: string): L[] {
  return looks.filter((look) => (slug === 'city-days' ? look.model === 'Riya' : look.model !== 'Riya'));
}
export function issueHref(issue: Pick<LookbookIssue, 'department' | 'slug'>) {
  return `/${issue.department}/lookbook/issues/${issue.slug}`;
}
export function findIssue(department: string, slug: string) {
  return department === cityIssue.department && slug === cityIssue.slug ? cityIssue : undefined;
}
export function issuePages(issue: LookbookIssue): BookPage[] {
  const pages: Omit<BookPage, 'number'>[] = [
    { kind: 'cover', title: issue.title },
    { kind: 'editor', title: 'Dress for the moment' },
    { kind: 'contents', title: 'Inside this edition' },
  ];
  for (const chapter of issue.chapters) {
    pages.push({ kind: 'chapter', title: chapter.title, chapter });
    for (const id of chapter.lookIds) {
      const look = issue.looks.find((l) => l.id === id)!;
      pages.push({ kind: 'photo', title: look.title, lookId: id });
      pages.push({ kind: 'products', title: `The pieces / ${look.title}`, lookId: id });
    }
  }
  pages.push(
    { kind: 'index', title: 'Find your moment' },
    { kind: 'back', title: 'Keep your own rhythm' },
  );
  return pages.map((page, i) => ({ ...page, number: i + 1 }));
}
export function readPageNumber(hash: string, count: number) {
  const match = /^#page=(\d+)$/.exec(hash);
  return match ? Math.min(count, Math.max(1, Number(match[1]))) : null;
}
/** Pair semantic photo/product pages, not odd/even neighbours. A physical
 * parity rule would put one outfit beside another outfit's buy buttons. */
export function spreadFor(page: number, pages: BookPage[]): number[] {
  const active = pages[page - 1];
  if (
    active?.kind === 'photo' &&
    pages[page]?.kind === 'products' &&
    pages[page]?.lookId === active.lookId
  )
    return [page, page + 1];
  if (
    active?.kind === 'products' &&
    pages[page - 2]?.kind === 'photo' &&
    pages[page - 2]?.lookId === active.lookId
  )
    return [page - 1, page];
  if (active?.kind === 'editor' && pages[page]?.kind === 'contents') return [page, page + 1];
  if (active?.kind === 'contents' && pages[page - 2]?.kind === 'editor') return [page - 1, page];
  return [page];
}
