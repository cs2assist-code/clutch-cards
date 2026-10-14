// Тематические игровые столы — как поля в Hearthstone, но по картам CS2.
// Всё нарисовано кодом (SVG-узоры и CSS), поэтому ничего не весит и не требует картинок:
// материал стола, узор поверхности, рамка «арен», центральная полоса, эмблема и частицы.

interface Theme {
  /** Узор поверхности (SVG-плитка). */
  tile: string; tileW: number; tileH: number;
  /** Насколько проступает фото локации поверх узора и как смешивается. */
  photo: number; blend: string;
  /** Затемнение и подкраска сцены. */
  shade: string;
  /** Арены (поля бойцов): заливка и кант. */
  lane: string; rim: string;
  /** Центральная полоса. */
  mid: string; midLine: string;
  /** Акцент рамки и частиц. */
  accent: string; particle: string; motes: 'rise' | 'fall' | 'drift';
  emblem: string;
}

const svg = (w: number, h: number, body: string) =>
  `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`).replace(/'/g, '%27')}')`;

// ─────────────────────────── Узоры поверхностей ───────────────────────────
const ANCIENT = `<rect width='96' height='64' fill='#3f3f30'/>
<g stroke='#23231a' stroke-width='2.2'>
<rect x='1' y='1' width='46' height='30' rx='2' fill='#5a5844'/><rect x='49' y='1' width='46' height='30' rx='2' fill='#52503d'/>
<rect x='-23' y='33' width='46' height='30' rx='2' fill='#56543f'/><rect x='25' y='33' width='46' height='30' rx='2' fill='#5d5b46'/><rect x='73' y='33' width='46' height='30' rx='2' fill='#52503d'/></g>
<g stroke='#7a7860' stroke-width='1' opacity='.45'><path d='M3 3h42M51 3h42M27 35h42M-21 35h42M75 35h42'/></g>
<g fill='#4f8a33' opacity='.55'><ellipse cx='12' cy='31' rx='10' ry='3.2'/><ellipse cx='62' cy='63' rx='13' ry='3'/><ellipse cx='90' cy='2' rx='7' ry='2.2'/><ellipse cx='40' cy='18' rx='4' ry='1.6'/></g>
<g fill='#000' opacity='.14'><circle cx='30' cy='12' r='3'/><circle cx='70' cy='48' r='2.4'/><circle cx='8' cy='50' r='2'/></g>`;

const DUST = `<rect width='64' height='32' fill='#8a6a3c'/>
<g stroke='#7a5c32' stroke-width='1.6'>
<rect x='1' y='1' width='30' height='14' fill='#c9a46b'/><rect x='33' y='1' width='30' height='14' fill='#bf9960'/>
<rect x='-15' y='17' width='30' height='14' fill='#c29d64'/><rect x='17' y='17' width='30' height='14' fill='#cba870'/><rect x='49' y='17' width='30' height='14' fill='#bb955c'/></g>
<g fill='#fff2d0' opacity='.18'><path d='M2 2h28v2H2zM34 2h28v2H34zM18 18h28v2H18z'/></g>
<g fill='#6b4b22' opacity='.35'><circle cx='9' cy='8' r='.9'/><circle cx='44' cy='11' r='.7'/><circle cx='26' cy='25' r='.8'/><circle cx='58' cy='22' r='.6'/></g>`;

const INFERNO = `<rect width='48' height='48' fill='#4a2414'/>
<g stroke='#3a1a0c' stroke-width='2'>
<rect x='1' y='1' width='22' height='22' rx='1.5' fill='#a3502f'/><rect x='25' y='1' width='22' height='22' rx='1.5' fill='#954528'/>
<rect x='1' y='25' width='22' height='22' rx='1.5' fill='#8f4226'/><rect x='25' y='25' width='22' height='22' rx='1.5' fill='#a85834'/></g>
<g fill='#e8c27a' opacity='.55'><path d='M24 20l4 4-4 4-4-4z'/></g>
<g fill='#fff' opacity='.08'><path d='M2 2h20v3H2zM26 26h20v3H26z'/></g>`;

const MIRAGE = `<rect width='60' height='60' fill='#cbbfa2'/>
<g transform='translate(30 30)'>
<rect x='-15' y='-15' width='30' height='30' fill='#1d5a84'/><rect x='-15' y='-15' width='30' height='30' fill='#1d5a84' transform='rotate(45)'/>
<rect x='-9' y='-9' width='18' height='18' fill='#2a9d8f'/><rect x='-9' y='-9' width='18' height='18' fill='#2a9d8f' transform='rotate(45)'/>
<circle r='4' fill='#e9d9a8'/></g>
<g fill='#b8862f'><path d='M0 0l6 0 0 6zM60 0l-6 0 0 6zM0 60l6 0 0-6zM60 60l-6 0 0-6z'/></g>
<g fill='none' stroke='#8a7a5a' stroke-width='1' opacity='.6'><rect x='.5' y='.5' width='59' height='59'/></g>`;

const NUKE = `<rect width='26' height='26' fill='#5d6369'/>
<g fill='#80878f'><ellipse cx='7' cy='7' rx='5.5' ry='1.6' transform='rotate(45 7 7)'/><ellipse cx='20' cy='20' rx='5.5' ry='1.6' transform='rotate(45 20 20)'/>
<ellipse cx='20' cy='7' rx='5.5' ry='1.6' transform='rotate(-45 20 7)'/><ellipse cx='7' cy='20' rx='5.5' ry='1.6' transform='rotate(-45 7 20)'/></g>
<g fill='#3a3f44' opacity='.8'><ellipse cx='7.6' cy='7.8' rx='5.5' ry='1.2' transform='rotate(45 7.6 7.8)'/><ellipse cx='20.6' cy='20.8' rx='5.5' ry='1.2' transform='rotate(45 20.6 20.8)'/></g>`;

const ANUBIS = `<rect width='120' height='60' fill='#8a6a3a'/>
<g stroke='#6e5028' stroke-width='2'>
<rect x='1' y='1' width='58' height='28' fill='#cfa96c'/><rect x='61' y='1' width='58' height='28' fill='#c6a063'/>
<rect x='-29' y='31' width='58' height='28' fill='#c9a467'/><rect x='31' y='31' width='58' height='28' fill='#d2ae72'/><rect x='91' y='31' width='58' height='28' fill='#c39d60'/></g>
<g fill='none' stroke='#7a5a2c' stroke-width='1.6' stroke-linecap='round' opacity='.55'>
<path d='M14 8v14M10 12h8M14 8a3 3 0 1 1 0.01 0'/><path d='M74 10c4-4 10-4 14 0-4 4-10 4-14 0zM81 10v8l-3 3'/>
<path d='M44 40l4-4 4 4M48 36v14M42 50h12'/><path d='M100 38h10l-3 8h-4zM103 46v6'/></g>`;

const CACHE = `<rect width='100' height='100' fill='#6e6e68'/>
<g stroke='#4c4c46' stroke-width='2.5'><rect x='1' y='1' width='98' height='98' fill='#83837c'/></g>
<g fill='#9a9a92' opacity='.5'><circle cx='14' cy='14' r='2.2'/><circle cx='86' cy='14' r='2.2'/><circle cx='14' cy='86' r='2.2'/><circle cx='86' cy='86' r='2.2'/></g>
<g fill='none' stroke='#55554f' stroke-width='1.1' opacity='.8'><path d='M30 1l6 18-8 14 10 20M70 99l-4-16 9-12'/></g>
<g fill='#8a4a1e' opacity='.22'><ellipse cx='70' cy='30' rx='18' ry='10'/><ellipse cx='22' cy='70' rx='12' ry='16'/></g>`;

// ─────────────────────────── Эмблемы ───────────────────────────
const E = {
  sun: `<circle cx='12' cy='12' r='4.5'/><path d='M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8L7 17M17 7l2.8-2.8' stroke='currentColor' stroke-width='2' fill='none'/>`,
  arch: `<path d='M4 22V11a8 8 0 0 1 16 0v11h-4v-11a4 4 0 0 0-8 0v11z'/>`,
  bell: `<path d='M12 2a2 2 0 0 1 2 2v1a6 6 0 0 1 4 6v5l2 3H4l2-3v-5a6 6 0 0 1 4-6V4a2 2 0 0 1 2-2zM10 21h4a2 2 0 0 1-4 0z'/>`,
  star: `<path d='M12 1l3 6 6-2-2 6 4 3-6 1-1 6-4-4-4 4-1-6-6-1 4-3-2-6 6 2z'/>`,
  rad: `<circle cx='12' cy='12' r='2.6'/><path d='M12 9.4L8.2 3a10 10 0 0 1 7.6 0zM14.3 13.3l7.4.2a10 10 0 0 1-3.8 6.6zM9.7 13.3L6.1 19.8a10 10 0 0 1-3.8-6.6z'/>`,
  eye: `<path d='M2 11c4-5 16-5 20 0-4 5-16 5-20 0zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 15l-2 6M12 15v5'/>`,
};

export const THEMES: Record<string, Theme> = {
  ancient: { tile: ANCIENT, tileW: 96, tileH: 64, photo: .38, blend: 'soft-light', shade: 'rgba(8,20,10,.35)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(40,60,36,.55), rgba(10,16,10,.65) 75%)', rim: '#4fc7a6',
    mid: 'linear-gradient(#5d5b46, #3a382b 50%, #26251c)', midLine: '#4fc7a6',
    accent: '#4fc7a6', particle: '#b8ff7a', motes: 'drift', emblem: E.sun },
  dust2: { tile: DUST, tileW: 64, tileH: 32, photo: .42, blend: 'soft-light', shade: 'rgba(40,22,6,.32)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(120,70,30,.45), rgba(40,22,8,.62) 75%)', rim: '#f2c75a',
    mid: 'repeating-linear-gradient(90deg, #7a5530 0 46px, #5c3c1e 46px 48px), linear-gradient(#7a5530, #3e2610)', midLine: '#f2c75a',
    accent: '#f2c75a', particle: '#f6dfa8', motes: 'drift', emblem: E.arch },
  inferno: { tile: INFERNO, tileW: 48, tileH: 48, photo: .35, blend: 'soft-light', shade: 'rgba(40,10,4,.35)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(110,40,16,.45), rgba(30,10,4,.65) 75%)', rim: '#ff9a4a',
    mid: 'radial-gradient(circle at 12px 0, #b85a34 9px, #7a3218 10px, transparent 11px) 0 0 / 24px 14px, linear-gradient(#8a3c1e, #4a1c0c)', midLine: '#ffb36b',
    accent: '#ff9a4a', particle: '#ffb35a', motes: 'rise', emblem: E.bell },
  mirage: { tile: MIRAGE, tileW: 60, tileH: 60, photo: .32, blend: 'overlay', shade: 'rgba(6,18,34,.42)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(20,60,90,.4), rgba(6,16,28,.66) 75%)', rim: '#7fd3e6',
    mid: 'repeating-linear-gradient(90deg, #1d5a84 0 10px, #e9d9a8 10px 12px, #2a9d8f 12px 22px, #e9d9a8 22px 24px)', midLine: '#e9d9a8',
    accent: '#7fd3e6', particle: '#fff1c8', motes: 'drift', emblem: E.star },
  nuke: { tile: NUKE, tileW: 26, tileH: 26, photo: .35, blend: 'overlay', shade: 'rgba(6,10,16,.42)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(40,48,56,.45), rgba(8,10,14,.7) 75%)', rim: '#f2c200',
    mid: 'repeating-linear-gradient(45deg, #f2c200 0 12px, #1a1a1a 12px 24px)', midLine: '#1a1a1a',
    accent: '#f2c200', particle: '#d8e2ea', motes: 'fall', emblem: E.rad },
  anubis: { tile: ANUBIS, tileW: 120, tileH: 60, photo: .38, blend: 'soft-light', shade: 'rgba(30,18,4,.3)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(110,80,30,.42), rgba(36,24,8,.62) 75%)', rim: '#36c2d8',
    mid: 'linear-gradient(#5ad0e0, #1b8aa2 45%, #0b4f63)', midLine: '#f2c75a',
    accent: '#36c2d8', particle: '#ffe08a', motes: 'drift', emblem: E.eye },
  cache: { tile: CACHE, tileW: 100, tileH: 100, photo: .36, blend: 'overlay', shade: 'rgba(14,18,8,.4)',
    lane: 'radial-gradient(ellipse at 50% 50%, rgba(60,66,40,.42), rgba(12,14,8,.7) 75%)', rim: '#c8e04a',
    mid: 'linear-gradient(#9aa0a6, #5e6369 45%, #3a3e42)', midLine: '#c8e04a',
    accent: '#c8e04a', particle: '#d6ff6a', motes: 'drift', emblem: E.rad },
};

/** Стиль-переменные стола для атрибута style. */
export function boardVars(map: string): string {
  const t = THEMES[map] ?? THEMES.dust2;
  return [
    `--sc-tile:${svg(t.tileW, t.tileH, t.tile)}`, `--sc-tile-size:${t.tileW}px ${t.tileH}px`,
    `--sc-photo:${t.photo}`, `--sc-blend:${t.blend}`, `--sc-shade:${t.shade}`,
    `--sc-lane:${t.lane}`, `--sc-rim:${t.rim}`, `--sc-mid:${t.mid}`, `--sc-midline:${t.midLine}`,
    `--sc-accent:${t.accent}`, `--sc-particle:${t.particle}`,
  ].join(';');
}

/** Декоративный слой стола: узор и частицы. */
export function boardScene(map: string): string {
  const t = THEMES[map] ?? THEMES.dust2;
  return `<div class="sc-tiles" aria-hidden="true"></div>
    <div class="sc-deco m-${map}" aria-hidden="true"><i class="sc-motes ${t.motes}"></i></div>`;
}

/** Эмблема карты в центре полосы. */
export function boardEmblem(map: string): string {
  const t = THEMES[map] ?? THEMES.dust2;
  return `<i class="sc-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor">${t.emblem}</svg></i>`;
}
