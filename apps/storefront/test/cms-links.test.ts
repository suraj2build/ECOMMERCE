import { describe, expect, it } from 'vitest';
import { cleanMenu, safeHref, socialNetwork } from '@/lib/cms-links';

describe('safeHref', () => {
  it('keeps site paths and https URLs', () => {
    expect(safeHref('/pages/our-story')).toBe('/pages/our-story');
    expect(safeHref(' https://instagram.com/vanya ')).toBe('https://instagram.com/vanya');
  });

  it('drops script, data, plain-http and protocol-relative links', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'http://example.com', '//evil.example', 'vbscript:x', '', 42, null]) {
      expect(safeHref(url)).toBeNull();
    }
  });
});

describe('cleanMenu', () => {
  it('keeps valid items in sortOrder, then entry order, and drops unsafe or unlabelled ones', () => {
    const menu = cleanMenu([
      { label: 'Journal', url: '/pages/journal', sortOrder: 3 },
      { label: 'Our Story', url: '/pages/our-story', sortOrder: 1 },
      { label: 'Bad', url: 'javascript:alert(1)', sortOrder: 0 },
      { label: '   ', url: '/pages/blank' },
      { label: 'Craft', url: '/pages/craft', sortOrder: 1 },
    ]);
    expect(menu.map((item) => item.label)).toEqual(['Our Story', 'Craft', 'Journal']);
  });

  it('treats a missing or malformed menu as empty', () => {
    expect(cleanMenu(undefined)).toEqual([]);
    expect(cleanMenu({ label: 'x' })).toEqual([]);
  });
});

describe('socialNetwork', () => {
  it('recognises the four networks the design shows, by host', () => {
    expect(socialNetwork('https://www.instagram.com/vanya')).toBe('instagram');
    expect(socialNetwork('https://youtube.com/@vanya')).toBe('youtube');
    expect(socialNetwork('https://in.pinterest.com/vanya')).toBe('pinterest');
    expect(socialNetwork('https://facebook.com/vanya')).toBe('facebook');
  });

  it('does not match look-alike hosts', () => {
    expect(socialNetwork('https://instagram.com.evil.example/x')).toBeNull();
    expect(socialNetwork('https://notinstagram.com/x')).toBeNull();
  });
});
