// Карты режима «Схватка» (по образцу Hearthstone): без рядов, деньги вместо маны.
// Главная идея: у каждого класса оружия есть сильные и слабые стороны (см. COUNTER),
// а у каждого агента — свой арсенал и две фирменные карты.
import { AGENTS, CARDS } from '../game/cards';
import type { Side } from '../game/types';

export type KW = 'taunt' | 'stealth' | 'headshot' | 'helmet' | 'twice' | 'rush' | 'sniper' | 'reload' | 'cleave' | 'suppress'
  | 'pierce' | 'sapper' | 'deathblast' | 'vet';
export type HTarget = 'none' | 'enemyUnit' | 'friendlyUnit' | 'friendlyAny' | 'anyUnit' | 'enemyAny' | 'any' | 'friendlySniper';
export type HClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy' | 'cover' | 'token' | 'spell' | 'bomb' | 'trap';

export interface HCard {
  id: string;
  name: string;
  kind: 'unit' | 'spell' | 'bomb' | 'trap';
  side: Side | 'N';
  cost: number;           // $
  atk?: number;
  hp?: number;
  armor?: number;         // Броня: снижает урон каждого попадания (кроме винтовок, снайперок и «Бронебойных»)
  kw?: KW[];
  cls: HClass;
  /** Цель при розыгрыше: заклинания и «При выходе». */
  target?: HTarget;
  /** Цель для «При выходе» необязательна (карта играется и без неё). */
  bcOptional?: boolean;
  text?: string;
  img: string;            // ключ картинки: id карты классического режима или agent_*
  /** Фирменная карта агента. */
  sig?: string;
  /** Режимы: при розыгрыше выбирается один (как «Выберите» в Hearthstone). */
  modes?: Mode[];
}
export interface Mode { name: string; text: string; atk?: number; hp?: number; add?: KW[]; remove?: KW[] }

export const KW_RU: Record<KW, [string, string]> = {
  taunt: ['Укрытие', 'Пока оно стоит, враги атакуют только укрытия.'],
  stealth: ['Глушитель', 'Невидим для врага, пока сам не атакует.'],
  headshot: ['Хедшот', 'Атакуя бойца без шлема, убивает его.'],
  helmet: ['Шлем', 'Защищает от «Хедшота».'],
  twice: ['Очередь', 'Атакует дважды за ход.'],
  rush: ['Рывок', 'Атакует бойцов сразу после выхода.'],
  sniper: ['Снайпер', 'Стреляет поверх укрытий и не получает ответного урона.'],
  reload: ['Перезарядка', 'После выстрела пропускает следующий ход.'],
  cleave: ['Дробь', 'Задевает и соседей цели.'],
  suppress: ['Подавление', 'Раненая цель ослеплена: пропустит атаку и не ответит на выстрел.'],
  pierce: ['Бронебойный', 'Игнорирует броню.'],
  sapper: ['Сапёр', 'Двойной урон по бомбе, атакует её сразу после выхода.'],
  deathblast: ['Взрывчатка', 'При гибели — 2 урона всем вражеским бойцам.'],
  vet: ['Ветеран', 'Уже получил бонус ветерана.'],
};

// ─────────────────────────── Противодействие классов ───────────────────────────
/** Доп. урон атакующего класса по классу цели. */
export const COUNTER: Partial<Record<HClass, Partial<Record<HClass, number>>>> = {
  smg: { sniper: 2 },
  shotgun: { smg: 2, pistol: 2, cover: 2 },
  sniper: { shotgun: 2, heavy: 2 },
  heavy: { pistol: 1, smg: 1 },
};
/** Эти классы пробивают броню. */
export const PIERCE_CLS: HClass[] = ['rifle', 'sniper'];
/** Описание силы и слабости класса — для карточки. */
export const CLASS_RU: Partial<Record<HClass, { name: string; good: string; bad: string }>> = {
  pistol: { name: 'Пистолет', good: 'дёшево, выходит в первые ходы; ветеран получает Хедшот', bad: 'дробовики (+2 по нему), броня' },
  smg: { name: 'Пистолет-пулемёт', good: 'снайперы: достаёт их за укрытием и бьёт +2; ветеран получает Очередь', bad: 'броня, дробовики' },
  shotgun: { name: 'Дробовик', good: 'ПП, пистолеты и укрытия (+2), задевает соседей; ветеран +2 здоровья', bad: 'снайперы (+2 по нему, без ответа)' },
  rifle: { name: 'Винтовка', good: 'пробивает броню, универсальна; ветеран +1 атаки и Шлем', bad: 'дорогая' },
  sniper: { name: 'Снайперская винтовка', good: 'дробовики и пулемёты (+2), стреляет поверх укрытий без ответа; ветеран +2 атаки', bad: 'ПП (+2 по нему), дым, флешки' },
  heavy: { name: 'Пулемёт', good: 'держит линию, подавляет, +1 по ПП и пистолетам; ветеран получает Укрытие', bad: 'гранаты (+2 по нему), снайперы' },
  cover: { name: 'Укрытие', good: 'прикрывает остальных', bad: 'дробовики (+2), молотов' },
};

// ─────────────────────────── Карты ───────────────────────────
const u = (id: string, side: Side | 'N', cost: number, atk: number, hp: number, cls: HClass, kw: KW[] = [], extra: Partial<HCard> = {}): HCard =>
  ({ id, name: nameOf(id), kind: 'unit', side, cost, atk, hp, cls, kw, img: id, ...extra });
const sp = (id: string, side: Side | 'N', cost: number, target: HTarget, text: string, extra: Partial<HCard> = {}): HCard =>
  ({ id, name: nameOf(id), kind: 'spell', side, cost, cls: 'spell', target, text, img: id, ...extra });
const trap = (id: string, name: string, side: Side | 'N', cost: number, text: string, img: string, extra: Partial<HCard> = {}): HCard =>
  ({ id, name, kind: 'trap', side, cost, cls: 'trap', text, img, ...extra });
function nameOf(id: string) { return CARDS.find((c) => c.id === id)?.name ?? id; }

export const HCARDS: HCard[] = [
  // Пистолеты: дёшево и рано
  u('glock', 'T', 1000, 2, 2, 'pistol', [], { modes: [{ name: 'Одиночный', text: '+1 здоровья', hp: 1 }, { name: 'Бёрст', text: 'Очередь, −1 атаки', atk: -1, add: ['twice'] }] }),
  u('usp', 'CT', 1000, 1, 3, 'pistol', ['stealth'], { modes: [{ name: 'С глушителем', text: 'Глушитель' }, { name: 'Без глушителя', text: '+1 атаки, без Глушителя', atk: 1, remove: ['stealth'] }] }),
  u('p2000', 'CT', 1000, 2, 2, 'pistol'),
  u('p250', 'N', 1500, 2, 2, 'pistol', [], { target: 'enemyAny', bcOptional: true, text: 'При выходе: 1 урон врагу.' }),
  u('deagle', 'N', 2500, 3, 3, 'pistol', ['headshot']),
  u('elites', 'N', 1500, 1, 3, 'pistol', ['twice']),
  u('fiveseven', 'CT', 1500, 2, 2, 'pistol', ['pierce']),
  u('tec9', 'T', 1500, 2, 2, 'pistol', ['rush']),
  u('cz75', 'CT', 1500, 1, 3, 'pistol', ['twice']),
  u('r8', 'T', 3000, 4, 3, 'pistol', ['headshot', 'reload']),
  // ПП: охотники на снайперов
  u('mac10', 'T', 2000, 2, 3, 'smg', ['rush']),
  u('mp9', 'CT', 2000, 2, 3, 'smg', ['rush']),
  u('ump45', 'N', 2500, 3, 3, 'smg'),
  u('mp5sd', 'CT', 2500, 3, 4, 'smg', ['stealth']),
  u('mp7', 'N', 2500, 3, 3, 'smg'),
  u('bizon', 'N', 2500, 2, 5, 'smg'),
  u('p90', 'T', 4000, 2, 5, 'smg', ['twice']),
  // Дробовики: бой в упор
  u('nova', 'N', 2500, 2, 4, 'shotgun', ['cleave']),
  u('mag7', 'CT', 2500, 3, 3, 'shotgun', ['cleave']),
  u('sawedoff', 'T', 2000, 3, 2, 'shotgun', ['cleave']),
  u('xm1014', 'N', 4000, 4, 5, 'shotgun', ['cleave']),
  // Винтовки: пробивают броню
  u('galil', 'T', 3500, 4, 4, 'rifle', ['rush'], { modes: [{ name: 'Раш', text: 'Рывок' }, { name: 'Прицельно', text: '+2 здоровья, без Рывка', hp: 2, remove: ['rush'] }] }),
  u('famas', 'CT', 3500, 3, 5, 'rifle', [], { modes: [{ name: 'Очередь', text: 'Очередь, −1 атаки', atk: -1, add: ['twice'] }, { name: 'Одиночный', text: '+1 атаки, +1 здоровья', atk: 1, hp: 1 }] }),
  u('ak47', 'T', 5000, 6, 5, 'rifle', ['headshot']),
  u('m4a4', 'CT', 5000, 5, 7, 'rifle', ['helmet'], { armor: 1 }),
  u('m4a1s', 'CT', 5000, 5, 6, 'rifle', ['stealth'], { modes: [{ name: 'С глушителем', text: 'Глушитель' }, { name: 'Без глушителя', text: '+1 атаки, без Глушителя', atk: 1, remove: ['stealth'] }] }),
  u('sg553', 'T', 6500, 7, 6, 'rifle', ['helmet'], { modes: [{ name: 'С прицелом', text: 'Снайпер, −1 атаки', atk: -1, add: ['sniper'] }, { name: 'Без прицела', text: '+3 здоровья', hp: 3 }] }),
  u('aug', 'CT', 5000, 6, 6, 'rifle', ['helmet'], { modes: [{ name: 'С прицелом', text: 'Снайпер, −1 атаки', atk: -1, add: ['sniper'] }, { name: 'Без прицела', text: '+3 здоровья', hp: 3 }] }),
  // Снайперки
  u('ssg', 'N', 2500, 3, 2, 'sniper', ['sniper']),
  u('awp', 'N', 7000, 8, 4, 'sniper', ['sniper', 'reload', 'headshot']),
  u('scar20', 'CT', 4500, 6, 6, 'sniper', ['sniper']),
  u('g3sg1', 'T', 5500, 6, 6, 'sniper', ['sniper']),
  // Пулемёты
  u('negev', 'T', 6000, 4, 10, 'heavy', ['suppress']),
  u('m249', 'CT', 7000, 5, 10, 'heavy', ['suppress', 'helmet']),
  // Укрытия
  u('box', 'N', 1000, 0, 4, 'cover', ['taunt']),
  u('door', 'N', 3000, 0, 8, 'cover', ['taunt'], { armor: 1 }),
  // Гранаты — точечные ответы
  sp('he', 'N', 3000, 'none', '3 урона всем бойцам врага. Пулемётам +2.'),
  sp('molotov', 'T', 3000, 'enemyUnit', '4 урона бойцу (укрытию — 8). В начале его хода ещё 1 урон ему и соседям.'),
  sp('incendiary', 'CT', 3000, 'enemyUnit', '4 урона бойцу (укрытию — 8). В начале его хода ещё 1 урон ему и соседям.'),
  sp('flash', 'N', 2000, 'enemyUnit', 'Ослепить бойца и его соседей: пропустят следующую атаку и не ответят на выстрел. Останавливает раш.'),
  sp('smoke', 'N', 1000, 'none', 'Снайперы и пулемёты врага пропустят следующую атаку.'),
  sp('zeus', 'N', 1000, 'anyUnit', '4 урона бойцу или бомбе, сквозь броню.'),
  // Снаряжение и тактики
  sp('kevlar', 'N', 1000, 'friendlyUnit', 'Бойцу +1 брони и +1 здоровья. Броня снижает урон пистолетов, ПП, дробовиков и гранат.'),
  sp('helmet', 'N', 2000, 'friendlyUnit', 'Бойцу +1 брони, +1 здоровья и Шлем.'),
  sp('medkit', 'N', 1000, 'friendlyAny', 'Восстановить 4 здоровья своему бойцу или герою.'),
  sp('boost', 'N', 1000, 'friendlyUnit', 'Бойцу +2 атаки.'),
  sp('kit', 'CT', 1000, 'none', 'Возьмите карту. Если заложена бомба — 4 урона по ней.'),
  sp('drop', 'N', 0, 'none', '+$1000 в этом ходу.'),
  { id: 'c4', name: 'Бомба C4', kind: 'bomb', side: 'T', cost: 3000, hp: 5, cls: 'bomb', img: 'fakeplant',
    text: 'Заложить бомбу (0/5): +$600 в следующем ходу. Не уничтожат за 3 хода — победа. Бомбу бьют в обход укрытий, но сильнейший ваш боец рядом с ней отвечает сапёру половиной атаки. Обезвредившим CT — +$2000.' },
  // Засады: лежат рубашкой вверх и срабатывают сами
  trap('angle', 'Держит угол', 'N', 2000, 'Засада. Когда вражеский боец атакует, он сначала получает 3 урона.', 'wallbang'),
  trap('wire', 'Растяжка', 'T', 1000, 'Засада. Когда враг выставляет бойца, тот получает 2 урона.', 'decoy'),
  trap('fake', 'Фейк', 'N', 1000, 'Засада. Следующая граната или тактика врага не срабатывает.', 'clutch'),
  trap('ninja', 'Ниндзя-дефьюз', 'CT', 2000, 'Засада. Если в начале вашего хода бомбу охраняет не больше одного T — она обезврежена.', 'ninja'),
  trap('backup', 'Тиммейт на подхвате', 'N', 2000, 'Засада. Когда ваш боец погибает, на его место выходит Тиммейт 2/5.', 'drop'),

  // ─── Фирменные карты агентов ───
  u('sw_shield', 'CT', 3000, 2, 8, 'rifle', ['taunt'], { name: 'Щитовик SWAT', armor: 1, img: 'agent_ct_swat', sig: 'ct_swat' }),
  sp('sw_armor', 'CT', 2000, 'none', 'Всем своим бойцам +1 брони и +1 здоровья.', { name: 'Склад брони', img: 'kevlar', sig: 'ct_swat' }),
  u('se_spotter', 'CT', 1500, 2, 4, 'pistol', [], { name: 'Корректировщик', img: 'agent_ct_seal', sig: 'ct_seal', target: 'friendlySniper', bcOptional: true,
    text: 'При выходе: своему снайперу +2 атаки и сразу закончить перезарядку.' }),
  sp('se_long', 'CT', 2500, 'enemyUnit', '5 урона бойцу. Снайперу или пулемёту — 8.', { name: 'Дальний выстрел', img: 'scar20', sig: 'ct_seal' }),
  sp('fb_intel', 'CT', 1000, 'none', 'Уничтожить все засады врага и взять 2 карты.', { name: 'Разведданные', img: 'kit', sig: 'ct_fbi' }),
  u('fb_sapper', 'CT', 2500, 3, 5, 'smg', ['sapper'], { name: 'Сапёр FBI', img: 'agent_ct_fbi', sig: 'ct_fbi' }),
  sp('sa_breach', 'CT', 5500, 'none', 'Ослепить всех вражеских бойцов.', { name: 'Штурм-группа', img: 'flash', sig: 'ct_sas' }),
  u('sa_oper', 'CT', 3500, 3, 4, 'rifle', ['rush'], { name: 'Оператор SAS', img: 'agent_ct_sas', sig: 'ct_sas', target: 'enemyUnit', bcOptional: true,
    text: 'При выходе: ослепить вражеского бойца.' }),
  sp('gi_shield', 'CT', 1500, 'friendlyUnit', 'Бойцу +3 здоровья, +1 брони и Укрытие.', { name: 'Баллистический щит', img: 'shield', sig: 'ct_gign' }),
  u('gi_gend', 'CT', 3000, 3, 5, 'smg', ['taunt'], { name: 'Жандарм GIGN', img: 'agent_ct_gign', sig: 'ct_gign', text: 'При выходе: соседям +1 атаки и +1 здоровья.' }),
  u('ph_bomber', 'T', 2500, 3, 2, 'pistol', ['rush', 'deathblast'], { name: 'Подрывник', img: 'agent_t_phoenix', sig: 't_phoenix' }),
  sp('ph_fast', 'T', 1000, 'none', 'Если бомба заложена — до взрыва на 1 ход меньше (не меньше 1). Иначе — возьмите карту.', { name: 'Быстрая закладка', img: 'fakeplant', sig: 't_phoenix' }),
  sp('el_rush', 'T', 1000, 'none', 'Своим бойцам +1 атаки в этом ходу; вышедшие в этом ходу получают Рывок.', { name: 'Раш', img: 'rushb', sig: 't_elite' }),
  u('el_storm', 'T', 4500, 6, 6, 'rifle', ['rush', 'vet', 'helmet'], { name: 'Штурмовик Elite', img: 'agent_t_elite', sig: 't_elite', text: 'Уже ветеран.' }),
  sp('ba_wall', 'T', 2500, 'none', 'Поджечь всех вражеских бойцов: 1 урон сейчас и 1 в начале их хода. Укрытиям — ещё 3.', { name: 'Огненная стена', img: 'molotov', sig: 't_balkan' }),
  u('ba_gunner', 'T', 5500, 4, 9, 'heavy', ['suppress', 'taunt'], { name: 'Пулемётчик Balkan', img: 'agent_t_balkan', sig: 't_balkan' }),
  u('gu_ambush', 'T', 3000, 3, 2, 'smg', ['stealth', 'rush'], { name: 'Засадник', img: 'agent_t_guerrilla', sig: 't_guerrilla' }),
  trap('gu_mines', 'Минное поле', 'T', 2500, 'Засада. Когда враг выставляет бойца, тот получает 3 урона.', 'he', { sig: 't_guerrilla' }),
  sp('pr_contract', 'T', 1000, 'none', '+$2000 к деньгам следующего хода.', { name: 'Контракт', img: 'clutch', sig: 't_pro' }),
  u('pr_vet', 'T', 3000, 4, 5, 'rifle', ['vet', 'helmet'], { name: 'Наёмник-ветеран', img: 'agent_t_pro', sig: 't_pro', text: 'Уже ветеран. За убийства им +$300.' }),

  // Жетоны
  u('merc', 'T', 0, 1, 1, 'token', [], { name: 'Наёмник', img: 'glock' }),
  u('mate_ct', 'CT', 0, 2, 3, 'pistol', [], { name: 'Тиммейт', img: 'p2000' }),
  u('mate_t', 'T', 0, 2, 3, 'pistol', [], { name: 'Тиммейт', img: 'glock' }),
];

/** Бойцы живучее: здоровье всех бойцов ×1.5 (округление вверх), чтобы карты не уходили за один выстрел. */
export const HP_MUL = 1.5;
for (const c of HCARDS) if (c.kind === 'unit' && c.hp) c.hp = Math.ceil(c.hp * HP_MUL);

const BY_ID = new Map(HCARDS.map((c) => [c.id, c]));
export const hcard = (id: string): HCard => BY_ID.get(id) ?? HCARDS[0];

/** Картинка карты: из классического режима или портрет агента. */
export function hImg(c: HCard): string {
  const pre = (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[c.img];
  return CARDS.find((x) => x.id === c.img)?.image ?? pre ?? `img/${c.img}.webp`;
}


// ─────────────────────────── Локации ───────────────────────────
export const MAP_RULES: Record<string, string> = {
  dust2: 'Длинные прострелы: снайперы +1 атаки.',
  inferno: 'Узкие улочки: поджог жжёт на 2 вместо 1.',
  mirage: 'Мид под дымами: Дым и Флешка дешевле на $1000.',
  nuke: 'Сложная точка: у каждого с начала стоит Ящик.',
  ancient: 'Джунгли: бойцы с Укрытием +2 здоровья.',
  anubis: 'Каналы: засады дешевле на $1000.',
  cache: 'Тесный мид: осколочная граната +1 урона.',
};

// ─────────────────────────── Силы героев ───────────────────────────
export interface Power { name: string; text: string; target: HTarget; cost: number }
export const POWER_COST = 2000;
export const POWERS: Record<string, Power> = {
  ct_swat: { name: 'Бронежилет', text: '+4 брони герою и +1 брони всем своим бойцам.', target: 'none', cost: 1500 },
  ct_seal: { name: 'Точный выстрел', text: '2 урона любому персонажу.', target: 'any', cost: POWER_COST },
  ct_fbi: { name: 'Сапёрный набор', text: '1 урон бойцу сквозь броню, бомбе — 4.', target: 'anyUnit', cost: 1000 },
  ct_sas: { name: 'Светошумовая', text: 'Ослепить вражеского бойца: пропустит атаку и не ответит на выстрел.', target: 'enemyUnit', cost: 3000 },
  ct_gign: { name: 'Щит', text: 'Своему бойцу +1 атаки и +2 здоровья.', target: 'friendlyUnit', cost: POWER_COST },
  t_phoenix: { name: 'Нож', text: 'Герой получает +3 атаки на этот ход.', target: 'none', cost: POWER_COST },
  t_elite: { name: 'Боевой клич', text: 'Своему бойцу +1 атаки и +1 здоровья; если он вышел в этом ходу — ещё и Рывок.', target: 'friendlyUnit', cost: POWER_COST },
  t_balkan: { name: 'Поджог', text: '2 урона вражескому герою.', target: 'none', cost: POWER_COST },
  t_guerrilla: { name: 'Засада', text: 'Своему бойцу Глушитель (невидим, пока не атакует).', target: 'friendlyUnit', cost: 2000 },
  t_pro: { name: 'Заказ', text: '3 урона вражескому бойцу сквозь броню.', target: 'enemyUnit', cost: POWER_COST },
};


// ─────────────────────────── Стили агентов (как классы в Hearthstone) ───────────────────────────
export type Style = 'rush' | 'hold' | 'long';
/** Раш бьёт дальнюю игру, оборона — раш, дальняя игра — оборону. */
export const STYLE: Record<string, Style> = {
  ct_sas: 'rush', t_elite: 'rush', t_phoenix: 'rush',
  ct_swat: 'hold', ct_gign: 'hold', t_balkan: 'hold',
  ct_seal: 'long', ct_fbi: 'long', t_pro: 'long', t_guerrilla: 'long',
};
export const STYLE_BEATS: Record<Style, Style> = { rush: 'long', hold: 'rush', long: 'hold' };
export const STYLE_RU: Record<Style, { name: string; icon: string; passive: string; plan: string }> = {
  rush: { name: 'Раш', icon: '»', passive: 'Бойцы с Рывком +1 атаки и +1 здоровья; энтри-фраг даёт $600 вместо $300 и +1 атаки бойцу.', plan: 'давит с первых ходов дешёвыми бойцами с рывком' },
  hold: { name: 'Оборона', icon: '▣', passive: 'Герой 48 HP; вражеский Рывок не срабатывает; бойцы с Укрытием +2 здоровья и +1 брони; гранаты и огонь +1 урона; охрана бомбы не стреляет в её сапёров.', plan: 'держит линию укрытиями, лечением и уроном по площади' },
  long: { name: 'Дальняя игра', icon: '⌖', passive: 'Добор 1 из 3 карт вместо 1 из 2; снайперы +1 атаки; все бойцы бьют сквозь броню и +2 урона по бойцам с Укрытием.', plan: 'берёт картами и снайперами в долгой партии' },
};
export const styleOf = (agentId: string): Style => STYLE[agentId] ?? 'hold';
/** Кого стиль бьёт и кому проигрывает. */
export function matchup(me: Style, foe: Style): 'good' | 'bad' | 'even' {
  if (STYLE_BEATS[me] === foe) return 'good';
  if (STYLE_BEATS[foe] === me) return 'bad';
  return 'even';
}
/** Добор колоды по стилю: сначала из этих карт, остальное — из общего пула стороны. */
const STYLE_POOL: Record<Style, string[]> = {
  rush: ['tec9', 'mac10', 'mp9', 'p250', 'deagle', 'sawedoff', 'boost', 'flash', 'kevlar', 'ump45'],
  hold: ['door', 'box', 'he', 'molotov', 'incendiary', 'helmet', 'medkit', 'nova', 'bizon', 'kevlar'],
  long: ['ssg', 'awp', 'smoke', 'angle', 'fake', 'backup', 'wire', 'ninja', 'zeus', 'mp7'],
};

// ─────────────────────────── Колоды ───────────────────────────
export const DECK_SIZE = 20;
/** Обязательная часть колоды стороны. */
const BASE: Record<Side, string[]> = {
  CT: ['usp', 'kit', 'box', 'flash'],
  T: ['glock', 'box', 'flash'],   // C4 лежит в стартовой руке (HS.c4InHand)
};
/** Из этого пула каждую игру случайно добирается остаток колоды — партии не похожи друг на друга. */
const POOL: Record<Side, string[]> = {
  CT: ['p2000', 'smoke', 'he', 'incendiary', 'kevlar', 'helmet', 'deagle', 'p250', 'ump45', 'mp7', 'nova', 'ssg', 'awp', 'door', 'zeus', 'medkit', 'boost',
    'angle', 'fake', 'ninja', 'backup', 'bizon', 'mp9'],
  T: ['glock', 'smoke', 'he', 'molotov', 'kevlar', 'helmet', 'deagle', 'p250', 'ump45', 'mp7', 'nova', 'ssg', 'awp', 'door', 'zeus', 'medkit', 'boost',
    'angle', 'fake', 'wire', 'backup', 'mac10', 'sawedoff'],
};
export const sigCards = (agentId: string) => HCARDS.filter((c) => c.sig === agentId).map((c) => c.id);

/** Колода агента: арсенал ×2, фирменные ×2, основа стороны и случайный добор из пула. Не больше 2 копий. */
export function agentDeck(agentId: string, rnd: () => number = Math.random): string[] {
  const a = AGENTS.find((x) => x.id === agentId) ?? AGENTS[0];
  const deck: string[] = [];
  const count = (id: string) => deck.filter((x) => x === id).length;
  for (const id of a.arsenal) if (BY_ID.has(id)) deck.push(id, id);
  for (const id of sigCards(a.id)) deck.push(id, id);
  for (const id of BASE[a.side]) if (count(id) < 2) deck.push(id);
  const okSide = (id: string) => { const c = BY_ID.get(id); return !!c && (c.side === 'N' || c.side === a.side); };
  const take = (pool: string[]) => {
    const list = pool.filter((id) => okSide(id) && count(id) < 2);
    while (deck.length < DECK_SIZE && list.length) {
      const id = list.splice(Math.floor(rnd() * list.length), 1)[0];
      if (count(id) < 2) deck.push(id);
    }
  };
  // 4 карты — под стиль агента, остальное — из общего пула стороны
  const style = STYLE_POOL[styleOf(a.id)].filter(okSide);
  const want = Math.min(DECK_SIZE - deck.length, 4);
  for (let k = 0; k < want && style.length; k++) {
    const id = style.splice(Math.floor(rnd() * style.length), 1)[0];
    if (count(id) < 2) deck.push(id);
  }
  take(POOL[a.side]);
  return deck.slice(0, DECK_SIZE);
}

/** Что агент может купить в бай-меню: арсенал, фирменные карты и все общие карты стороны. */
export function shopPool(agentId: string): string[] {
  const a = AGENTS.find((x) => x.id === agentId) ?? AGENTS[0];
  return [...new Set([...a.arsenal.filter((id) => BY_ID.has(id)), ...sigCards(a.id), ...BASE[a.side], ...POOL[a.side]])];
}
