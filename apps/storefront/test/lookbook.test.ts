import { describe, expect, it } from 'vitest';
import {
  findStory,
  isLookbookDepartment,
  parseStoryContent,
  storiesFor,
  storyHref,
} from '../src/lib/lookbook';

const base = storiesFor('women')[0]!;
const item = {
  styleId: '12345678-1234-1234-1234-123456789abc',
  colourId: '12345678-1234-1234-1234-123456789def',
};
const look = {
  title: 'One',
  image: '/photo.webp',
  alt: 'Riya wearing a yellow tee',
  items: [item],
};
describe('lookbook content boundaries', () => {
  it('separates departments and refuses unknown/cross-department stories', () => {
    expect(isLookbookDepartment('kids')).toBe(false);
    expect(findStory('men', 'city-days')).toBeUndefined();
    expect(storiesFor('men').every((story) => story.department === 'men')).toBe(true);
    expect(storyHref(base)).toBe('/women/lookbook/city-days');
  });
  it('never guesses product mappings for generated editorial garments', () => {
    expect(
      storiesFor('women')
        .flatMap((s) => s.looks)
        .every((l) => l.items.length === 0),
    ).toBe(true);
  });
  it('requires exact colour and style IDs', () => {
    expect(parseStoryContent(JSON.stringify({ looks: [look] }), base)?.looks[0]?.items).toEqual([
      item,
    ]);
    expect(
      parseStoryContent(
        JSON.stringify({ looks: [{ ...look, items: [{ styleId: item.styleId }] }] }),
        base,
      ),
    ).toBeNull();
  });
  it('rejects unsafe media, empty alt text, invalid JSON and duplicate items', () => {
    for (const changed of [
      { image: 'javascript:alert(1)' },
      { image: '//evil.test/p.png' },
      { alt: '' },
      { items: [item, item] },
    ]) {
      expect(
        parseStoryContent(JSON.stringify({ looks: [{ ...look, ...changed }] }), base),
      ).toBeNull();
    }
    expect(parseStoryContent('{', base)).toBeNull();
  });
  it('does not allow CMS content to change the story department or route', () => {
    const parsed = parseStoryContent(
      JSON.stringify({ department: 'men', slug: 'changed', looks: [look] }),
      base,
    );
    expect(parsed?.department).toBe('women');
    expect(parsed?.slug).toBe('city-days');
  });
});
