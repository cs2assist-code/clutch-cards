import type { CardDef } from './game/types';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Адрес картинки для url() в CSS-переменной: браузер разрешает его от файла стилей (dist/assets/), поэтому нужен абсолютный. */
export const cssUrl = (src?: string) => (!src ? '' : src.startsWith('data:') ? src : new URL(src, document.baseURI).href);

const svg = (side: string, body: string) => `<svg viewBox="0 0 100 80" class="fart ${side}" aria-hidden="true">${body}</svg>`;

const GLYPH: Record<string, string> = {
  shield: '⛉', kevlar: '◈', helmet: '◈', medkit: '+', kit: '✂', zeus: 'ϟ', knife: '⟋',
  wallbang: '⇶', boost: '⇧', rushb: 'B', clutch: '1v5', drop: '⇩', ninja: '✂', fakeplant: 'C4?',
};

/** SVG-заглушка, пока у карты нет картинки. */
export function fallbackArt(def: CardDef): string {
  const side = def.faction === 'CT' ? 'ct' : def.faction === 'T' ? 't' : 'n';
  if (def.wall === 'box') {
    return svg(side, '<rect x="24" y="14" width="52" height="52" rx="3" class="g1"/><path d="M24 14l52 52M76 14L24 66" stroke-width="5" class="g3s"/><rect x="24" y="14" width="52" height="52" rx="3" fill="none" stroke-width="5" class="g3s"/>');
  }
  if (def.wall === 'door') {
    return svg(side, '<rect x="30" y="6" width="40" height="68" rx="2" class="g1"/><rect x="36" y="12" width="28" height="24" class="g2"/><rect x="36" y="42" width="28" height="26" class="g2"/><circle cx="62" cy="40" r="3" class="g3"/>');
  }
  if (def.type === 'grenade') {
    return svg(side, '<rect x="36" y="22" width="28" height="44" rx="12" class="g1"/><rect x="42" y="14" width="16" height="10" rx="2" class="g2"/><circle cx="66" cy="16" r="6" fill="none" stroke-width="3" class="g3s"/>');
  }
  if (def.type === 'weapon') {
    return svg(side, `<rect x="6" y="18" width="88" height="44" rx="8" class="g1"/><text x="50" y="47" text-anchor="middle" class="gt gw">${esc(def.name)}</text>`);
  }
  const g = GLYPH[def.id] ?? '★';
  return svg(side, `<rect x="22" y="12" width="56" height="56" rx="10" class="g1"/><text x="50" y="50" text-anchor="middle" class="gt ${g.length > 2 ? 'gw' : ''}">${esc(g)}</text>`);
}

/** Силуэт агента (заглушка). */
function agentSilhouette(side: 'CT' | 'T'): string {
  const head = side === 'CT'
    ? '<path d="M34 34c0-10 7-17 16-17s16 7 16 17v3H34z" class="g1"/><circle cx="50" cy="40" r="12" class="g2"/><rect x="38" y="36" width="24" height="5" rx="2" class="g3"/>'
    : '<circle cx="50" cy="38" r="13" class="g2"/><path d="M37 40h26v6c-4 3-9 5-13 5s-9-2-13-5z" class="g1"/><rect x="42" y="33" width="16" height="4" rx="2" class="g3"/>';
  return svg(side.toLowerCase(), `<path d="M18 80c2-18 14-26 32-26s30 8 32 26z" class="g1"/>${head}`);
}

/** Портрет агента из CS2; без картинки — силуэт. */
export function agentArt(side: 'CT' | 'T', id?: string): string {
  const fb = agentSilhouette(side);
  if (!id) return fb;
  const key = `agent_${id}`;
  const src = (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[key] ?? `img/${key}.webp`;
  return `<span class="artwrap agentwrap">${fb}<img src="${esc(src)}" alt="" decoding="async"></span>`;
}

/** Арт карты: картинка с cs2assist.ru, при ошибке загрузки — заглушка. */
export function art(def: CardDef): string {
  const fb = fallbackArt(def);
  if (!def.image) return fb;
  return `<span class="artwrap">${fb}<img src="${esc(def.image)}" alt="" loading="lazy" decoding="async"></span>`;
}
