import type { CardDef, Side, WeaponClass } from './types';

/**
 * Откуда брать картинки. По умолчанию — с cs2assist.ru.
 * Если положите картинки рядом с игрой, поменяйте на '' или свой путь.
 */
export const IMG_BASE = 'https://cs2assist.ru/static';
// Стандартные (заводские) скины — официальные изображения из Steam и из репозитория ByMykel/counter-strike-image-tracker.
// Чтобы не зависеть от чужих серверов, скачайте их на cs2assist.ru и поменяйте адреса здесь.
// Стандартные скины лежат в public/img/<id>.webp (256×192).
// Однофайловая сборка подставляет их как data URI через window.__CARD_IMG.
const img = (id: string): string =>
  ((globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[id]) ?? `img/${id}.webp`;

// ─────────────────────────── Правила ───────────────────────────
export const RULES = {
  heroHp: 100,
  rowCap: 3,          // карт одной стороны в ряду
  tSpawn: 0,
  ctSpawn: 4,
  siteRow: 3,         // точка B — первый ряд CT
  startMoney: 800,
  income: 800,        // за каждый свой ход
  maxMoney: 16000,
  plantBonus: 800,    // T за закладку
  bombTimer: 16,      // общих ходов до взрыва
  defuseTime: 6,      // общих ходов на разминирование
  defuseKeepsProgress: true, // убитый сапёр не обнуляет дефьюз
  roundTime: 30,      // не заложили бомбу за столько общих ходов — победа CT
  tDeployDepth: 1,    // T могут выставлять карты на спавн и на N рядов вперёд (CT — только на спавн)
  plantMajority: true,  // true: закладка, если T на точке больше, чем CT
  spawnSight: 2,      // из спавна и по спавну стреляют не дальше чем на 2 ряда (кроме AWP по герою)
  spawnShield: 'fresh' as 'all' | 'fresh', // 'fresh' — защищены только что купленные карты
  nadeRange: 2,       // дальность броска гранаты от ближайшей своей карты или спавна
  coverCut: 0.4,      // укрытие снижает урон от выстрелов издалека на 40%
  blindSkip: 0.5,     // ослеплённая карта с этим шансом пропускает ход, иначе стреляет наугад
  decoyTurns: 3,
  /** Через сколько своих ходов граната снова в продаже (остальные — со следующего хода). Пока идёт перезарядка, нельзя купить и другую копию. */
  nadeCooldown: { he: 4, molotov: 5, incendiary: 5 } as Record<string, number>,
  headshotChance: 0.3,
  duelStartMoney: 3000,
  duelOvertime: 24,   // в решающем раунде после этого героев «жмёт» овертайм
  deckSize: 12,
  maxDecks: 5,
  minWeapons: 0,
  maxDeckWeapons: 3,  // общего оружия в колоде не больше
  /** Пистолет, который всегда есть в бай-меню своей стороны. */
  basePistol: { CT: 'usp', T: 'glock' } as Record<Side, string>,
  /** Копий каждого ствола из арсенала агента (дорогие — по одной). */
  arsenalCopies: 2,
  maxCopies: 2,
  draftPicks: 10,
  draftChoices: 3,
} as const;

/** Награда за убийство карты — по классу оружия убийцы (как в CS2). */
export const KILL_REWARD: Record<WeaponClass | 'grenade' | 'knife' | 'zeus', number> = {
  pistol: 300, smg: 600, shotgun: 900, rifle: 300, sniper: 300, heavy: 300, grenade: 300, knife: 1500, zeus: 100,
};
/** Особые награды по конкретному оружию. */
export const KILL_REWARD_BY_CARD: Record<string, number> = { awp: 100, knife: 1500, p90: 300, cz75: 100 };

export const CARDS: CardDef[] = [
  // ─────────── Пистолеты ───────────
  { id: 'usp', name: 'USP-S', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'CT', price: 200, hp: 6, dmg: [6, 6, 5, 3], rarity: 'common', image: img('usp') },
  { id: 'glock', name: 'Glock-18', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'T', price: 200, hp: 6, dmg: [7, 6, 5, 3], rarity: 'common', image: img('glock') },
  { id: 'deagle', name: 'Desert Eagle', type: 'weapon', cls: 'pistol', faction: 'N', price: 800, hp: 5, dmg: [9, 9, 9, 8, 7], traits: ['headshot'], rarity: 'rare', image: img('deagle') },
  { id: 'p2000', name: 'P2000', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'CT', price: 200, hp: 6, dmg: [7, 6, 5, 3], rarity: 'common', image: img('p2000') },
  { id: 'p250', name: 'P250', type: 'weapon', cls: 'pistol', faction: 'N', price: 300, hp: 6, dmg: [8, 7, 6, 4], rarity: 'common', image: img('p250') },
  { id: 'elites', name: 'Dual Berettas', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'N', price: 300, hp: 6, dmg: [5, 4, 3], traits: ['twice'], rarity: 'common', image: img('elites') },
  { id: 'fiveseven', name: 'Five-SeveN', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'CT', price: 500, hp: 6, dmg: [8, 8, 7, 4], rarity: 'rare', image: img('fiveseven') },
  { id: 'tec9', name: 'Tec-9', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'T', price: 500, hp: 6, dmg: [9, 8, 6, 4], rarity: 'rare', image: img('tec9') },
  { id: 'cz75', name: 'CZ75-Auto', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'CT', price: 500, hp: 6, dmg: [7, 6, 3], traits: ['twice'], rarity: 'rare', image: img('cz75') },
  { id: 'r8', name: 'R8 Revolver', type: 'weapon', agentOnly: true, cls: 'pistol', faction: 'T', price: 600, hp: 5, dmg: [10, 10, 10, 8, 7], traits: ['reload', 'headshot'], rarity: 'epic', image: img('r8') },

  // ─────────── SMG и дробовики ───────────
  { id: 'mp9', name: 'MP9', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'CT', price: 1400, hp: 7, dmg: [7, 6, 4], traits: ['twice'], rarity: 'common', image: img('mp9') },
  { id: 'mac10', name: 'MAC-10', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'T', price: 1300, hp: 6, dmg: [7, 5, 3], traits: ['twice'], rarity: 'common', image: img('mac10') },
  { id: 'nova', name: 'Nova', type: 'weapon', cls: 'shotgun', faction: 'N', price: 1300, hp: 10, dmg: [14, 10, 5], image: img('nova'), rarity: 'common' },
  { id: 'mp5sd', name: 'MP5-SD', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'CT', price: 1500, hp: 7, dmg: [7, 6, 5, 3], traits: ['silenced'], rarity: 'common', image: img('mp5sd') },
  { id: 'ump45', name: 'UMP-45', type: 'weapon', cls: 'smg', faction: 'N', price: 1200, hp: 8, dmg: [9, 7, 5], rarity: 'common', image: img('ump45') },
  { id: 'mp7', name: 'MP7', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'N', price: 1500, hp: 8, dmg: [8, 7, 5, 3], rarity: 'common', image: img('mp7') },
  { id: 'bizon', name: 'PP-Bizon', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'N', price: 1400, hp: 7, dmg: [6, 5, 3], traits: ['twice'], rarity: 'common', image: img('bizon') },
  { id: 'p90', name: 'P90', type: 'weapon', agentOnly: true, cls: 'smg', faction: 'T', price: 2350, hp: 9, dmg: [7, 7, 6, 4], traits: ['twice'], rarity: 'rare', image: img('p90') },
  { id: 'mag7', name: 'MAG-7', type: 'weapon', agentOnly: true, cls: 'shotgun', faction: 'CT', price: 1300, hp: 10, dmg: [15, 11, 4], rarity: 'common', image: img('mag7') },
  { id: 'sawedoff', name: 'Sawed-Off', type: 'weapon', agentOnly: true, cls: 'shotgun', faction: 'T', price: 1100, hp: 9, dmg: [16, 9], rarity: 'common', image: img('sawedoff') },
  { id: 'xm1014', name: 'XM1014', type: 'weapon', agentOnly: true, cls: 'shotgun', faction: 'N', price: 2000, hp: 11, dmg: [10, 8, 4], traits: ['twice'], rarity: 'rare', image: img('xm1014') },

  // ─────────── Винтовки ───────────
  { id: 'galil', name: 'Galil AR', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'T', price: 2200, hp: 9, dmg: [9, 9, 8, 6, 5], rarity: 'common', image: img('galil') },
  { id: 'famas', name: 'FAMAS', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'CT', price: 2300, hp: 10, dmg: [9, 9, 9, 7, 6], rarity: 'common', image: img('famas') },
  { id: 'ak47', name: 'AK-47', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'T', price: 3500, hp: 10, dmg: [14, 14, 13, 11, 9], rarity: 'rare', image: img('ak47') },
  { id: 'm4a4', name: 'M4A4', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'CT', price: 3700, hp: 13, dmg: [11, 11, 10, 9, 8], rarity: 'rare', image: img('m4a4') },
  { id: 'm4a1s', name: 'M4A1-S', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'CT', price: 3600, hp: 12, dmg: [10, 10, 10, 9, 8], traits: ['silenced'], rarity: 'epic', image: img('m4a1s') },
  { id: 'sg553', name: 'SG 553', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'T', price: 3000, hp: 10, dmg: [12, 12, 12, 11, 10], rarity: 'rare', image: img('sg553') },
  { id: 'aug', name: 'AUG', type: 'weapon', agentOnly: true, cls: 'rifle', faction: 'CT', price: 3300, hp: 11, dmg: [11, 11, 11, 10, 9], rarity: 'rare', image: img('aug') },

  // ─────────── Снайперки и пулемёты ───────────
  { id: 'ssg', name: 'SSG 08', type: 'weapon', cls: 'sniper', faction: 'N', price: 2000, hp: 6, dmg: [5, 9, 12, 13, 13], rarity: 'rare', image: img('ssg') },
  { id: 'awp', name: 'AWP', type: 'weapon', cls: 'sniper', faction: 'N', price: 6000, hp: 7, dmg: [10, 15, 25, 25, 25], traits: ['reload', 'pierce'], rarity: 'legendary', image: img('awp') },
  { id: 'negev', name: 'Negev', type: 'weapon', agentOnly: true, cls: 'heavy', faction: 'T', price: 2200, hp: 15, dmg: [6, 6, 5, 4], traits: ['suppress'], image: img('negev'), rarity: 'rare' },
  { id: 'g3sg1', name: 'G3SG1', type: 'weapon', agentOnly: true, cls: 'sniper', faction: 'T', price: 5000, hp: 8, dmg: [6, 11, 15, 15, 15], rarity: 'epic', image: img('g3sg1') },
  { id: 'scar20', name: 'SCAR-20', type: 'weapon', agentOnly: true, cls: 'sniper', faction: 'CT', price: 5000, hp: 8, dmg: [6, 11, 15, 15, 15], rarity: 'epic', image: img('scar20') },
  { id: 'm249', name: 'M249', type: 'weapon', agentOnly: true, cls: 'heavy', faction: 'CT', price: 5200, hp: 16, dmg: [7, 7, 6, 5, 4], traits: ['suppress'], rarity: 'epic', image: img('m249') },

  // ─────────── Нож ───────────
  { id: 'knife', name: 'Нож', type: 'knife', faction: 'N', price: 1000, hp: 5, target: 'deploy', rarity: 'epic', image: img('knife'),
    text: 'Ставится в любой ряд. В ход установки не атакует. Со следующего хода убивает вражескую карту оружия или нож в ряду позади себя (на 1 ряд ближе к вашему спавну) — броня и щит не спасают. Не стреляет, не закладывает бомбу. Награда за убийство ножом $1500.' },

  // ─────────── Укрытия ───────────
  { id: 'box', name: 'Ящик', type: 'wall', faction: 'N', price: 300, hp: 15, wall: 'box', target: 'deploy', image: img('box'), rarity: 'common',
    text: 'Укрытие: ваши карты в этом ряду получают на 40% меньше урона от выстрелов из других рядов.' },
  { id: 'door', name: 'Дверь', type: 'wall', faction: 'N', price: 600, hp: 25, wall: 'door', target: 'deploy', image: img('door'), rarity: 'rare',
    text: 'Укрытие, как ящик, но прочнее. Не горит.' },

  // ─────────── Гранаты (бросаются на ряд) ───────────
  { id: 'flash', name: 'Флешка', type: 'grenade', faction: 'N', price: 200, target: 'row', rarity: 'common', image: img('flash'),
    text: 'Ослепляет всех в ряду, и своих тоже. В свой следующий ход ослеплённая карта либо пропускает ход, либо стреляет в случайную цель (50/50).' },
  { id: 'smoke', name: 'Дым', type: 'grenade', faction: 'N', price: 300, target: 'row', rarity: 'common', image: img('smoke'),
    text: 'Ряд в дыму до конца хода противника: в нём никто не стреляет и никого нельзя выбрать целью, сквозь него нет линии огня. Тушит огонь.' },
  { id: 'he', name: 'Осколочная', type: 'grenade', faction: 'N', price: 300, target: 'row', rarity: 'common', image: img('he'),
    text: '6 урона всем в ряду, и своим тоже. Укрытиям — двойной урон. Разгоняет дым. Снова в продаже через 4 хода.' },
  { id: 'molotov', name: 'Молотов', type: 'grenade', faction: 'T', price: 400, target: 'row', rarity: 'rare', image: img('molotov'),
    text: 'Ряд горит 2 общих хода: 5 урона всем, кто в нём стоит, сразу и в конце каждого общего хода. Снова в продаже через 5 ходов.' },
  { id: 'incendiary', name: 'Зажигательная', type: 'grenade', faction: 'CT', price: 500, target: 'row', rarity: 'rare', image: img('incendiary'),
    text: 'Ряд горит 2 общих хода: 5 урона всем, кто в нём стоит, сразу и в конце каждого общего хода. Снова в продаже через 5 ходов.' },
  { id: 'decoy', name: 'Ложная граната', type: 'grenade', faction: 'N', price: 100, target: 'ownWeapon', image: img('decoy'), rarity: 'rare',
    text: 'На 3 ваших хода создаёт копию своей карты в том же ряду. Копия и оригинал перемешиваются, противник не знает, какая настоящая. Копия исчезает от любого попадания.' },

  // ─────────── Снаряжение ───────────
  { id: 'shield', name: 'Щит', type: 'gear', faction: 'CT', price: 1100, target: 'ownWeapon', image: img('shield'), rarity: 'rare',
    text: 'Своя карта получает щит: поглощает 15 урона от оружия.' },
  { id: 'kevlar', name: 'Бронежилет', type: 'gear', faction: 'N', price: 650, target: 'ownWeapon', image: img('kevlar'), rarity: 'common', text: '+6 брони своей карте.' },
  { id: 'helmet', name: 'Броня + шлем', type: 'gear', faction: 'N', price: 1000, target: 'ownWeapon', image: img('helmet'), rarity: 'rare', text: '+6 брони и защита от хедшотов.' },
  { id: 'medkit', name: 'Аптечка', type: 'gear', faction: 'N', price: 400, target: 'ownAny', image: img('medkit'), rarity: 'common', text: 'Восстановить 10 HP своей карте или герою.' },
  { id: 'kit', name: 'Набор сапёра', type: 'gear', faction: 'CT', price: 400, target: 'none', image: img('kit'), rarity: 'rare', bombOnly: true, text: 'Дефьюз на 2 общих хода быстрее.' },
  { id: 'zeus', name: 'Zeus x27', type: 'gear', faction: 'N', price: 200, target: 'enemyUnit', image: img('zeus'), rarity: 'epic',
    text: 'Уничтожить вражескую карту с HP 12 или меньше, если она в одном ряду с вашей картой. Награда $100.' },

  // ─────────── Тактика ───────────
  { id: 'wallbang', name: 'Прострел', type: 'tactic', faction: 'N', price: 300, target: 'ownWeapon', image: img('wallbang'), rarity: 'rare',
    text: 'В этот ход карта стреляет сквозь карты на линии огня (кроме дыма). Урон сквозь препятствие — половина.' },
  { id: 'boost', name: 'Буст', type: 'tactic', faction: 'N', price: 300, target: 'ownWeapon', image: img('boost'), rarity: 'common',
    text: 'Нужен свой ящик или дверь в том же ряду. Карта навсегда получает +3 урона (один раз на карту).' },
  { id: 'rushb', name: 'Раш Б', type: 'tactic', faction: 'T', price: 800, target: 'none', image: img('rushb'), rarity: 'epic',
    text: 'Все ваши карты оружия получают +4 урона до конца хода.' },
  { id: 'clutch', name: 'Клатч', type: 'tactic', faction: 'N', price: 500, target: 'none', image: img('clutch'), rarity: 'epic',
    text: 'Если у вас одна карта оружия, её урон удваивается до конца хода.' },
  { id: 'drop', name: 'Дроп от тиммейта', type: 'tactic', faction: 'N', price: 0, target: 'none', image: img('drop'), rarity: 'common',
    text: 'Следующая покупка оружия на $1500 дешевле.' },
  { id: 'ninja', name: 'Ниндзя-дефьюз', type: 'tactic', faction: 'CT', price: 500, target: 'none', image: img('ninja'), rarity: 'legendary', bombOnly: true,
    text: 'Бомба заложена, ваша карта на точке, а у точки (в ряду перед ней, на ней и на спавне CT) нет ни одной карты T. Карта на точке начинает тихий дефьюз: бомба будет обезврежена в конце следующего хода T, если сапёр выживет.' },
  { id: 'fakeplant', name: 'Фейк-плент', type: 'tactic', faction: 'T', price: 500, target: 'none', image: img('fakeplant'), rarity: 'epic', bombOnly: true,
    text: 'Нужна ваша карта на точке. Ставит ложную бомбу: для CT она выглядит как настоящая и не взрывается.' },
];

export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const card = (id: string): CardDef => {
  const c = CARD_MAP[id];
  if (!c) throw new Error('Unknown card ' + id);
  return c;
};

/** Стартовые колоды (по 20 карт). Игрок может их изменить или собрать свои. */
export const STARTER_DECKS: Record<Side, Record<string, number>> = {
  CT: {
    deagle: 1, nova: 1, ssg: 1,
    box: 1, shield: 1,
    flash: 1, smoke: 2, he: 1, incendiary: 1,
    kevlar: 1, kit: 1,
  },
  T: {
    deagle: 1, ump45: 1, ssg: 1,
    box: 1,
    flash: 1, smoke: 2, he: 1, molotov: 1,
    kevlar: 1, medkit: 1, rushb: 1,
  },
};

/** Пул для драфта решающего раунда. */
export const DRAFT_POOL = CARDS.filter((c) => !c.bombOnly && !c.agentOnly).map((c) => c.id);

// ─────────────────────────── Агенты (герои) ───────────────────────────
/** Плюсы и минусы агента. Всё, что не задано, — как у всех. */
export interface AgentMods {
  heroHp?: number;       // к HP героя
  income?: number;       // к доходу за свой ход
  killBonus?: number;    // к награде за каждое убийство
  plantBonus?: number;   // награда за закладку вместо обычной
  defuseFaster?: number; // дефьюз быстрее на N общих ходов
  wallHp?: number;       // к HP укрытий
  shieldHp?: number;     // к щиту
  unitHp?: (def: CardDef) => number; // к HP купленной карты
  fireTick?: number;     // к урону огня за тик
  dmg?: (def: CardDef) => number;   // к урону оружия
  price?: (def: CardDef) => number; // к цене карты
  banned?: string[];     // эти карты агенту недоступны
}
export interface AgentDef {
  id: string; side: Side; name: string; model: string;
  perk: string; minus: string;
  /** Оружие агента: всегда лежит в бай-меню поверх колоды (в колоду его не положить). */
  arsenal: string[];
  mods: AgentMods;
}
const isSniper = (d: CardDef) => d.cls === 'sniper';
export const AGENTS: AgentDef[] = [
  { id: 'ct_swat', side: 'CT', name: 'Командир SWAT', model: "Cmdr. Mae 'Dead Cold' Jamison",
    perk: 'Укрытия и щиты +5 HP.', minus: 'Снайперки −2 урона.', arsenal: ['m249', 'mag7', 'm4a4', 'fiveseven'],
    mods: { wallHp: 5, shieldHp: 5, dmg: (d) => (isSniper(d) ? -2 : 0) } },
  { id: 'ct_seal', side: 'CT', name: 'Снайпер SEAL', model: 'Lt. Commander Ricksaw',
    perk: 'Снайперки +3 урона и +2 HP.', minus: 'ПП −1 урон.', arsenal: ['scar20', 'aug', 'mp9', 'p2000'],
    mods: { dmg: (d) => (isSniper(d) ? 3 : d.cls === 'smg' ? -1 : 0), unitHp: (d) => (isSniper(d) ? 2 : 0) } },
  { id: 'ct_fbi', side: 'CT', name: 'Сапёр FBI', model: 'Special Agent Ava',
    perk: 'Дефьюз на 2 общих хода быстрее.', minus: 'Укрытия на $100 дороже.', arsenal: ['mp5sd', 'm4a1s', 'xm1014', 'elites'],
    mods: { defuseFaster: 2, price: (d) => (d.type === 'wall' ? 100 : 0) } },
  { id: 'ct_sas', side: 'CT', name: 'Штурмовик SAS', model: 'B Squadron Officer',
    perk: 'Флешки и дымы на $100 дешевле, винтовки +1 урон.', minus: 'Укрытия на $200 дороже.', arsenal: ['famas', 'mp7', 'm4a1s', 'cz75'],
    mods: { price: (d) => (d.id === 'flash' || d.id === 'smoke' ? -100 : d.type === 'wall' ? 200 : 0), dmg: (d) => (d.cls === 'rifle' ? 1 : 0) } },
  { id: 'ct_gign', side: 'CT', name: 'Жандарм GIGN', model: "Chef d'Escadron Rouchard",
    perk: 'Доход +$100 за каждый свой ход.', minus: 'AWP недоступна.', arsenal: ['famas', 'bizon', 'm4a4', 'p2000'],
    mods: { income: 100, banned: ['awp'] } },
  { id: 't_phoenix', side: 'T', name: 'Подрывник Phoenix', model: 'Soldier',
    perk: 'За закладку $1300 вместо $800.', minus: 'Герой 85 HP.', arsenal: ['ak47', 'mac10', 'tec9', 'r8'],
    mods: { plantBonus: 1300, heroHp: -15 } },
  { id: 't_elite', side: 'T', name: 'Штурмовик Elite Crew', model: 'Ground Rebel',
    perk: 'AK-47, Galil AR и SG 553 +2 урона.', minus: 'Снайперки −3 урона.', arsenal: ['ak47', 'galil', 'sg553', 'tec9'],
    mods: { dmg: (d) => (d.id === 'ak47' || d.id === 'galil' || d.id === 'sg553' ? 2 : isSniper(d) ? -3 : 0) } },
  { id: 't_balkan', side: 'T', name: 'Поджигатель Balkan', model: "'The Doctor' Romanov",
    perk: 'Молотов +1 урон за каждый тик.', minus: 'Герой 85 HP.', arsenal: ['negev', 'galil', 'mac10', 'elites'],
    mods: { fireTick: 1, heroHp: -15 } },
  { id: 't_guerrilla', side: 'T', name: 'Партизан', model: 'Elite Trapper Solman',
    perk: 'Нож и ящик на $300 дешевле.', minus: 'Снайперки на $500 дороже.', arsenal: ['p90', 'sawedoff', 'tec9', 'xm1014'],
    mods: { price: (d) => (d.id === 'knife' || d.id === 'box' ? -300 : isSniper(d) ? 500 : 0) } },
  { id: 't_pro', side: 'T', name: 'Наёмник', model: 'Sir Bloody Miami Darryl',
    perk: '+$100 за каждое убийство.', minus: 'Укрытия на $200 дороже.', arsenal: ['g3sg1', 'galil', 'mp7', 'r8'],
    mods: { killBonus: 100, price: (d) => (d.type === 'wall' ? 200 : 0) } },
];
export const agent = (id: string) => AGENTS.find((a) => a.id === id)!;

// ─────────────────────────── Карты-локации ───────────────────────────
export interface MapDef { id: string; name: string; perk: string; image: string }
const mapImg = (id: string) => img(`map_${id}`);
/** Нарисованный фон игрового стола (вид сверху, public/img/board_<id>.webp). */
export const boardImg = (id: string) => img(`board_${id}`);
export const MAPS: MapDef[] = [
  { id: 'dust2', name: 'Dust II', perk: 'Длинные прострелы: снайперские винтовки +3 урона.', image: mapImg('dust2') },
  { id: 'inferno', name: 'Inferno', perk: 'Молотов и зажигательная горят на 1 общий ход дольше.', image: mapImg('inferno') },
  { id: 'mirage', name: 'Mirage', perk: 'Дым держится на 1 общий ход дольше.', image: mapImg('mirage') },
  { id: 'nuke', name: 'Nuke', perk: 'У каждой стороны с начала стоит Дверь в первом ряду.', image: mapImg('nuke') },
  { id: 'ancient', name: 'Ancient', perk: 'Ящики и двери +5 HP.', image: mapImg('ancient') },
  { id: 'anubis', name: 'Anubis', perk: 'Яркое солнце: ослеплённые карты всегда пропускают ход.', image: mapImg('anubis') },
  { id: 'cache', name: 'Cache', perk: 'Тесные проходы: осколочная +2 урона.', image: mapImg('cache') },
];
export const mapDef = (id: string) => MAPS.find((m) => m.id === id)!;

/** Название ряда с точки зрения стороны. */
export function rowName(row: number, viewer: Side): string {
  if (row === RULES.tSpawn) return 'Спавн T';
  if (row === RULES.ctSpawn) return 'Спавн CT';
  if (row === RULES.siteRow) return 'Точка B';
  return viewer === 'T' ? `Ряд ${row}` : `Ряд ${RULES.ctSpawn - row}`;
}
