// Neutral placeholder imagery for the launch-assortment demo catalogue
// (image generation is paused; see CLAUDE.md "IMAGE GENERATION IS PAUSED").
// These are intentionally plain - a label and a simple outline, never a
// real or implied product photograph - so nobody mistakes one for actual
// merchandise. Product/colour media and CMS banners reference these by
// path; swapping in real photography later only needs the admin/CMS media
// and banner URLs updated, never a change to any page component.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(import.meta.dirname, '..', 'apps/storefront/public/placeholders');
mkdirSync(OUT_DIR, { recursive: true });

const PALETTE = { bg: '#EFEAE2', line: '#B8AC9A', text: '#6B6256' };

function productSvg({ file, label, icon, w = 1000, h = 1250 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PALETTE.bg}"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="${PALETTE.line}" stroke-width="2" stroke-dasharray="10 8"/>
  <g transform="translate(${w / 2}, ${h / 2 - 60})" fill="none" stroke="${PALETTE.line}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round">
    ${icon}
  </g>
  <text x="${w / 2}" y="${h / 2 + 170}" text-anchor="middle" font-family="Georgia, serif" font-size="34" letter-spacing="4" fill="${PALETTE.text}">${label.toUpperCase()}</text>
  <text x="${w / 2}" y="${h / 2 + 215}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" letter-spacing="3" fill="${PALETTE.text}" opacity="0.7">PLACEHOLDER IMAGE</text>
</svg>`;
  writeFileSync(path.join(OUT_DIR, file), svg);
}

function bannerSvg({ file, label, w = 1800, h = 900 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#201D19"/>
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="#5B5048" stroke-width="2" stroke-dasharray="14 10"/>
  <text x="${w / 2}" y="${h / 2 - 10}" text-anchor="middle" font-family="Georgia, serif" font-size="56" letter-spacing="8" fill="#EFEAE2">${label.toUpperCase()}</text>
  <text x="${w / 2}" y="${h / 2 + 46}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" letter-spacing="4" fill="#C8BEB1" opacity="0.8">PLACEHOLDER IMAGE - DEMO CONTENT</text>
</svg>`;
  writeFileSync(path.join(OUT_DIR, file), svg);
}

// Simple line-art icons, centred at the origin.
const ICONS = {
  shirt: '<path d="M-90,-110 L-40,-150 L0,-120 L40,-150 L90,-110 L60,-60 L30,-80 L30,140 L-30,140 L-30,-80 L-60,-60 Z"/>',
  tee: '<path d="M-100,-100 L-45,-140 Q0,-110 45,-140 L100,-100 L65,-45 L35,-70 L35,140 L-35,140 L-35,-70 L-65,-45 Z"/>',
  trouser: '<path d="M-55,-150 L55,-150 L65,150 L15,150 L0,-20 L-15,150 L-65,150 Z"/>',
  kurti: '<path d="M-70,-150 L70,-150 L85,40 L35,170 L-35,170 L-85,40 Z"/>',
  dress: '<path d="M-60,-150 L60,-150 L90,-20 L40,180 L-40,180 L-90,-20 Z"/>',
  top: '<path d="M-85,-110 L-30,-150 L0,-130 L30,-150 L85,-110 L55,-55 L25,-75 L35,150 L-35,150 L-25,-75 L-55,-55 Z"/>',
  skirt: '<path d="M-70,-140 L70,-140 L110,150 L-110,150 Z"/>',
  shorts: '<path d="M-70,-130 L70,-130 L80,90 L15,90 L0,-10 L-15,90 L-80,90 Z"/>',
  shoe: '<path d="M-110,60 Q-110,10 -60,-10 L-10,-60 Q30,-90 80,-70 Q110,-55 110,-20 L110,40 Q110,60 90,60 Z"/>',
  belt: '<rect x="-120" y="-30" width="240" height="60" rx="10"/><rect x="-35" y="-45" width="70" height="90" rx="10"/><circle cx="0" cy="0" r="12" fill="currentColor" stroke="none"/>',
  perfume: '<path d="M-25,-150 L25,-150 L25,-115 L45,-95 L45,140 L-45,140 L-45,-95 L-25,-115 Z"/><rect x="-15" y="-170" width="30" height="20"/>',
};

const PRODUCTS = [
  { file: 'shirt-neutral.svg', label: 'Shirt', icon: ICONS.shirt },
  { file: 'tee-neutral.svg', label: 'Tee / Polo', icon: ICONS.tee },
  { file: 'trouser-neutral.svg', label: 'Trousers', icon: ICONS.trouser },
  { file: 'denim-neutral.svg', label: 'Denim', icon: ICONS.trouser },
  { file: 'kurti-neutral.svg', label: 'Kurti', icon: ICONS.kurti },
  { file: 'dress-neutral.svg', label: 'Dress', icon: ICONS.dress },
  { file: 'top-neutral.svg', label: 'Top', icon: ICONS.top },
  { file: 'skirt-neutral.svg', label: 'Skirt', icon: ICONS.skirt },
  { file: 'shorts-neutral.svg', label: 'Shorts', icon: ICONS.shorts },
  { file: 'shoe-neutral.svg', label: 'Footwear', icon: ICONS.shoe },
  { file: 'belt-neutral.svg', label: 'Belt', icon: ICONS.belt },
  { file: 'perfume-neutral.svg', label: 'Fragrance', icon: ICONS.perfume },
];
for (const p of PRODUCTS) productSvg(p);

const BANNERS = [
  { file: 'hero-men.svg', label: 'VANYA Men' },
  { file: 'hero-women.svg', label: 'VANYA Women' },
  { file: 'gateway-men.svg', label: 'Shop Men' },
  { file: 'gateway-women.svg', label: 'Shop Women' },
  { file: 'category-tile.svg', label: 'Category' },
  { file: 'lifestyle.svg', label: 'Lifestyle' },
];
for (const b of BANNERS) bannerSvg(b);

console.log(`Wrote ${PRODUCTS.length + BANNERS.length} placeholder images to ${OUT_DIR}`);
