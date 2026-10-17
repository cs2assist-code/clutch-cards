// Свои карты игрока («Мастерская»): боец собирается из пунктов, цена в игре считается по формуле.
// Пункты ограничивают, насколько большой может быть карта; цена в деньгах — чтобы своя карта не была сильнее
// обычных за те же деньги. Модуль общий для игры и сервера (сервер проверяет и регистрирует чужие карты).
import { KW_RU, registerCard, hcard, type HCard, type HClass, type KW } from './cards';

export type BaseId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy';
export interface CustomSpec { name: string; base: BaseId; atk: number; hp: number; armor: number; kw: KW[]; art: string }

export const FORGE_BUDGET = 100;
export const FORGE_MAX_CARDS = 5;
export const FORGE_PER_DECK = 2;          // своих карт в колоде (всего копий)
export const FORGE_COST_XP = 1000;        // создание — неделя игры
export const FORGE_DESTROY_XP = 300;      // уничтожение тоже стоит опыта
export const XP_WEEK_CAP = 1000;          // больше за неделю не набрать
export const XP_START = 1000;             // стартовый опыт: первую карту можно сделать сразу

/** Основа: класс оружия (от него «кто кого»), встроенное свойство и стартовая стоимость в пунктах. */
export const BASES: Record<BaseId, { pts: number; cls: HClass; kw: KW[]; name: string; arts: string[] }> = {
  pistol: { pts: 8, cls: 'pistol', kw: [], name: 'Пистолет', arts: ['usp', 'glock', 'p2000', 'p250', 'deagle', 'fiveseven', 'tec9', 'cz75', 'elites', 'r8'] },
  smg: { pts: 12, cls: 'smg', kw: [], name: 'Пистолет-пулемёт', arts: ['mp9', 'mac10', 'mp7', 'ump45', 'mp5sd', 'bizon', 'p90'] },
  shotgun: { pts: 16, cls: 'shotgun', kw: ['cleave'], name: 'Дробовик', arts: ['nova', 'mag7', 'sawedoff', 'xm1014'] },
  rifle: { pts: 16, cls: 'rifle', kw: [], name: 'Винтовка', arts: ['ak47', 'm4a4', 'm4a1s', 'famas', 'galil', 'aug', 'sg553'] },
  sniper: { pts: 24, cls: 'sniper', kw: ['sniper'], name: 'Снайперская винтовка', arts: ['awp', 'ssg', 'scar20', 'g3sg1'] },
  heavy: { pts: 24, cls: 'heavy', kw: ['suppress'], name: 'Пулемёт', arts: ['negev', 'm249'] },
};
/** Стоимость в пунктах: каждая единица атаки и здоровья, броня, свойства. Перезарядка — минус, возвращает пункты. */
export const PTS = { atk: 7, hp: 3, armor: 6 };
export const KW_PTS: Partial<Record<KW, number>> = { rush: 6, headshot: 8, helmet: 4, twice: 12, pierce: 5, stealth: 4, taunt: 3, sapper: 8, deathblast: 6, reload: -10 };
export const FORGE_KW = Object.keys(KW_PTS) as KW[];
export const LIMITS = { atk: [1, 8], hp: [2, 16], armor: [0, 2], kw: 3 } as const;
/** Сочетания, которые ломают игру. */
const FORBIDDEN: [KW | BaseId, KW][] = [['sniper', 'rush'], ['sniper', 'twice'], ['heavy', 'twice'], ['twice', 'headshot'], ['taunt', 'stealth']];
/** Один пункт ≈ столько долларов в цене карты (калибровано симуляцией: scripts/forge-sim.ts). */
export let PRICE_PER_PT = 70;
export const setPricePerPt = (v: number) => { PRICE_PER_PT = v; };

export const pointsOf = (s: CustomSpec) => BASES[s.base].pts + s.atk * PTS.atk + s.hp * PTS.hp + s.armor * PTS.armor + s.kw.reduce((a, k) => a + (KW_PTS[k] ?? 0), 0);
/** Цена в игре: по пунктам, шаг $500, от $1K до $7K. */
export const priceOf = (s: CustomSpec) => Math.min(7000, Math.max(1000, Math.round((pointsOf(s) * PRICE_PER_PT) / 500) * 500));

const NAME_RE = /^[\p{L}\p{N} '\-.]{2,18}$/u;
const BAD = /(х[уy][йеёяю]|п[иi]зд|еб[аaуеи]|бля|муд[аио]|сук[аи]|fuck|shit|cunt|nigg|fag|bitch|whore|пид[оа]р|хохл|жид)/iu;
export const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 18);

const nm = (x: string) => (x in BASES ? BASES[x as BaseId].name : KW_RU[x as KW]?.[0] ?? x);
/** Почему карту нельзя создать (пустой список — можно). */
export function specProblems(s: CustomSpec): string[] {
  const p: string[] = [];
  const b = BASES[s.base];
  if (!b) return ['Выберите основу'];
  const name = cleanName(s.name ?? '');
  if (!NAME_RE.test(name)) p.push('Название: 2–18 букв или цифр');
  else if (BAD.test(name)) p.push('Такое название нельзя');
  const intIn = (v: number, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!intIn(s.atk, LIMITS.atk)) p.push(`Атака от ${LIMITS.atk[0]} до ${LIMITS.atk[1]}`);
  if (!intIn(s.hp, LIMITS.hp)) p.push(`Здоровье от ${LIMITS.hp[0]} до ${LIMITS.hp[1]}`);
  if (!intIn(s.armor, LIMITS.armor)) p.push(`Броня от ${LIMITS.armor[0]} до ${LIMITS.armor[1]}`);
  if (!Array.isArray(s.kw) || new Set(s.kw).size !== s.kw.length || s.kw.some((k) => !(k in KW_PTS))) p.push('Неверные свойства');
  else if (s.kw.length > LIMITS.kw) p.push(`Не больше ${LIMITS.kw} свойств`);
  else for (const [a, k] of FORBIDDEN) if ((a === s.base || b.kw.includes(a as KW) || s.kw.includes(a as KW)) && (s.kw.includes(k) || b.kw.includes(k))) p.push(`Нельзя совмещать: ${nm(a)} и ${nm(k)}`);
  if (!b.arts.includes(s.art)) p.push('Выберите портрет');
  if (p.length === 0 && pointsOf(s) > FORGE_BUDGET) p.push(`Пунктов ${pointsOf(s)} из ${FORGE_BUDGET} — уберите что-нибудь`);
  return p;
}
export const validSpec = (s: unknown): s is CustomSpec => !!s && typeof s === 'object' && specProblems(s as CustomSpec).length === 0;

/** Нормализованная запись: одинаковые карты — одинаковый id. */
function canon(s: CustomSpec): CustomSpec {
  return { name: cleanName(s.name), base: s.base, atk: s.atk, hp: s.hp, armor: s.armor, kw: [...s.kw].sort(), art: s.art };
}
function hash(str: string) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
/** id своей карты зависит только от её содержимого: подменить характеристики под тем же id нельзя. */
export const customId = (s: CustomSpec) => 'cc_' + hash(JSON.stringify(canon(s)));
export const isCustomId = (id: string) => id.startsWith('cc_');

export function toHCard(s: CustomSpec): HCard {
  const c = canon(s), b = BASES[c.base];
  return { id: customId(c), name: c.name, kind: 'unit', side: 'N', cost: priceOf(c), atk: c.atk, hp: c.hp, armor: c.armor || undefined,
    kw: [...b.kw, ...c.kw], cls: b.cls, img: c.art, art: c.art, custom: true };
}
/** Зарегистрировать свои карты (свои и соперника), чтобы движок и экран их знали. Возвращает их id. */
export function registerCustoms(specs: unknown): string[] {
  if (!Array.isArray(specs)) return [];
  const ids: string[] = [];
  for (const s of specs.slice(0, FORGE_MAX_CARDS)) {
    if (!validSpec(s)) continue;
    const c = toHCard(s);
    registerCard(c);
    ids.push(c.id);
  }
  return ids;
}
export const customName = (id: string) => hcard(id).name;
