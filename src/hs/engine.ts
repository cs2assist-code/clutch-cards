// Правила режима «Схватка»: одна линия до 4 бойцов, рука, колода 20 карт, деньги как мана.
// Классы оружия контрят друг друга, броня режет урон, бойцы становятся ветеранами,
// оружие погибших можно подобрать, засады лежат рубашкой вверх.
// Чистая логика без DOM: интерфейс и бот читают события из s.log.
import type { Side } from '../game/types';
import { agentDeck, COUNTER, shopPool, styleOf, hcard, PIERCE_CLS, POWERS, type HClass, type HTarget, type KW } from './cards';

export const HS = {
  heroHp: 40,
  holdHp: 48,            // герой «Обороны»
  ctArmor: 5,            // CT держат точку: герой начинает с бронёй
  board: 6,
  hand: 7,
  traps: 2,
  startHand: 4,          // первому игроку; второму — на 1 больше и «Дроп»
  drawChoice: 2,         // в начале хода: открыть столько карт и взять одну
  shopCost: 1000,        // бай-меню: первая покупка за ход, каждая следующая на столько же дороже
  shopChoice: 3,         // …выбрать 1 из стольких карт
  firstIncome: 2000,     // в первый ход
  income: 500,           // прибавка за каждый следующий ход
  maxMoney: 5000,
  lossStep: 500,         // бонус за отставание: +$500 за каждый ход подряд, когда вы позади (как loss bonus в CS)
  lossMax: 4,            // …но не больше 4 шагов ($2000)
  lossGap: 5,            // «позади» — если здоровье вашего героя меньше, чем у соперника, на столько или больше (броня не в счёт)
  carry: 3000,           // неистраченные деньги переходят в следующий ход, но не больше
  bombTimer: 3,          // ходов T до взрыва
  plantBonus: 600,       // T за закладку: +$600 в следующем ходу (как plant bonus в CS)
  guardShot: true,       // «Охрана»: соседние с бомбой T стреляют в того, кто её бьёт
  guardMul: 0.5,         // …с такой долей своей атаки (округление вверх)
  guardMax: 1,           // …стреляет сильнейший из соседей
  c4InHand: true,        // у T всегда есть бомба: она лежит в стартовой руке
  kitInHand: false,      // …а у CT — набор сапёра
  defuseBonus: 2000,     // CT за обезвреженную бомбу — в следующем ходу
  holdBombDelay: 0,      // против «Обороны» бомба тикает на столько ходов дольше
  holdNoGuard: true,     // «Оборона» разминирует под прикрытием: охрана бомбы в неё не стреляет
  c4Cost: 3000,
  kitDmg: 4,
  maxArmor: 2,
  winTo: 2,              // до двух побед (Bo3)
};
/** Награда за убийство бойца — по классу оружия убийцы, приходит в следующем ходу. */
export const KILL_REWARD: Partial<Record<HClass, number>> = { pistol: 400, smg: 600, shotgun: 500, rifle: 300, sniper: 300, heavy: 300, token: 300 };
const WEAPON_CLS: HClass[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'heavy'];

export type PI = 0 | 1;
export type Diff = 'easy' | 'normal' | 'hard';

export interface HUnit {
  uid: string;
  card: string;
  atk: number; hp: number; maxHp: number;
  armor: number;
  temp: number;         // атака до конца хода
  kw: KW[];
  attacks: number;      // атак осталось в этом ходу
  sick: boolean;        // вышел в этом ходу
  blind: boolean;       // пропустит следующую атаку
  reloading: boolean;   // перезарядка: пропускает ход
  burn: number;         // урон огнём в начале своего хода
  bomb: number;         // для C4: ходов T до взрыва
  dealt: number;        // сколько урона нанёс за жизнь (0 — «не сделал ни выстрела»)
  shot: boolean;        // стрелял в этом ходу (для «Сейва»)
  marked: boolean;      // «Трейд»: убил союзника — по нему +2 урона до конца следующего хода мстителя
  mode?: number;        // выбранный режим стрельбы (для звука: USP-S / M4A1-S без глушителя)
}
export interface HHero { hp: number; armor: number; atk: number; attacked: boolean; agent: string; side: Side }
/** Карта в руке. free — трофей: выбитое у соперника оружие, разыгрывается бесплатно. */
export interface HCardInst { uid: string; id: string; free?: boolean }
export interface HPlayer {
  hero: HHero;
  hand: HCardInst[];
  deck: string[];
  board: HUnit[];
  traps: HCardInst[];
  money: number;
  bonus: number;        // награды за убийства — к деньгам следующего хода
  turns: number;        // своих ходов сыграно
  powerUsed: boolean;
  shopUsed: number;      // сколько раз открывал бай-меню в этом ходу
  /** Открытый выбор карты: добор в начале хода или бай-меню. Пока он открыт, других действий нет. */
  choice: { kind: 'draw' | 'shop'; opts: string[] } | null;
  pool: string[];
  fatigue: number;
  kills: number;
  lossStreak: number;   // сколько своих ходов подряд начинали, отставая
  entry: boolean;       // «Энтри»: первое убийство в этом ходу уже было
  saved: boolean;       // «Сейв» уже был в этом ходу
}

export type Ev =
  | { t: 'turn'; p: PI }
  | { t: 'play'; p: PI; card: string; uid?: string; target?: string }
  | { t: 'power'; p: PI; target?: string }
  | { t: 'atk'; from: string; to: string }
  | { t: 'dmg'; id: string; n: number; hs?: boolean; bonus?: boolean; blocked?: number; wb?: boolean }
  | { t: 'heal'; id: string; n: number }
  | { t: 'armor'; id: string; n: number }
  | { t: 'buff'; id: string; text: string }
  | { t: 'vet'; id: string; text: string }
  | { t: 'die'; id: string }
  | { t: 'blind'; id: string }
  | { t: 'cash'; p: PI; n: number; loss?: number }
  | { t: 'draw'; p: PI; burned?: string }
  | { t: 'shop'; p: PI }
  | { t: 'fatigue'; p: PI; n: number }
  | { t: 'trap'; p: PI; card: string }
  | { t: 'trophy'; p: PI; card: string; burned?: boolean }
  | { t: 'fizzle'; card: string }
  | { t: 'bomb'; left: number }
  | { t: 'boom' }
  | { t: 'defused' }
  | { t: 'entry'; p: PI; id: string }
  | { t: 'mark'; id: string }
  | { t: 'clutch'; id: string }
  | { t: 'save'; p: PI; card: string; id: string };

export interface HState {
  p: [HPlayer, HPlayer];
  turn: PI;
  first: PI;
  winner: PI | null;
  reason: '' | 'hero' | 'bomb' | 'defuse';
  log: Ev[];
  seq: number;
  turnNo: number;
  map: string;
}

let rnd = Math.random;
export const setRng = (f: () => number) => { rnd = f; };
export const rand = () => rnd();
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const newId = (s: HState, pre = 'u') => `${pre}${++s.seq}`;
export const heroId = (p: PI) => `h${p}`;
/** Максимум здоровья героя: у «Обороны» больше. */
export const maxHp = (agentId: string) => (styleOf(agentId) === 'hold' ? HS.holdHp : HS.heroHp);
export const foe = (p: PI): PI => (p === 0 ? 1 : 0);

// ─────────────────────────── Начало игры ───────────────────────────
/** Новая игра: agents[i] — агент игрока i. T ходит первым. */
export function newGame(agents: [string, string], sides: [Side, Side], map = 'dust2'): HState {
  const mk = (i: PI): HPlayer => ({
    hero: { hp: maxHp(agents[i]), armor: sides[i] === 'CT' ? HS.ctArmor : 0, atk: 0, attacked: false, agent: agents[i], side: sides[i] },
    hand: [], deck: shuffle(agentDeck(agents[i], rnd)), board: [], traps: [], money: 0, bonus: 0, turns: 0, powerUsed: false, shopUsed: 0, choice: null, pool: shopPool(agents[i]), fatigue: 0, kills: 0, lossStreak: 0, entry: false, saved: false,
  });
  const first: PI = sides[0] === 'T' ? 0 : 1;
  const s: HState = { p: [mk(0), mk(1)], turn: first, first, winner: null, reason: '', log: [], seq: 0, turnNo: 0, map };
  for (const i of [0, 1] as PI[]) {
    const n = HS.startHand + (i === first ? 0 : 1);
    for (let k = 0; k < n; k++) draw(s, i, true);
  }
  return s;
}

/** Замена стартовых карт: выбранные уходят в колоду, взамен берутся новые. */
export function mulligan(s: HState, p: PI, uids: string[]) {
  const P = s.p[p];
  const out = P.hand.filter((c) => uids.includes(c.uid));
  P.hand = P.hand.filter((c) => !uids.includes(c.uid));
  for (let k = 0; k < out.length; k++) draw(s, p, true);
  P.deck.push(...out.map((c) => c.id));
  shuffle(P.deck);
}

/** После замены: второй игрок получает «Дроп», первый начинает ход. */
export function startGame(s: HState) {
  const second = foe(s.first);
  s.p[second].hand.push({ uid: newId(s, 'c'), id: 'drop' });
  // Как в CS: у стороны T всегда есть бомба
  for (const q of [0, 1] as PI[]) {
    const side = s.p[q].hero.side, H = s.p[q].hand;
    if (HS.c4InHand && side === 'T' && !H.some((c) => c.id === 'c4')) H.push({ uid: newId(s, 'c'), id: 'c4' });
    if (HS.kitInHand && side === 'CT' && !H.some((c) => c.id === 'kit')) H.push({ uid: newId(s, 'c'), id: 'kit' });
  }
  // Nuke: у каждого с начала стоит ящик
  if (s.map === 'nuke') for (const p of [0, 1] as PI[]) summon(s, p, 'box');
  s.log = [];
  beginTurn(s, s.first);
}

/** Добор на выбор: открыть 2 верхние карты, одну взять, другую — под низ колоды. */
function drawChoice(s: HState, p: PI) {
  const P = s.p[p];
  if (P.deck.length < 2) { draw(s, p); return; }
  P.choice = { kind: 'draw', opts: P.deck.splice(0, HS.drawChoice + (styleOf(P.hero.agent) === 'long' ? 1 : 0)) };
}

/** Цена бай-меню сейчас: $1000, $2000, $3000… за ход. */
export const shopPrice = (P: { shopUsed: number }) => HS.shopCost * (P.shopUsed + 1);

/** Бай-меню: раз в ход за $1000 — выбрать 1 из 3 карт своего агента и стороны. */
export function canShop(s: HState, p: PI): boolean {
  const P = s.p[p];
  return s.turn === p && s.winner === null && !P.choice && P.money >= shopPrice(P) && P.hand.length < HS.hand;
}
export function shop(s: HState, p: PI): boolean {
  if (!canShop(s, p)) return false;
  const P = s.p[p];
  P.money -= shopPrice(P);
  P.shopUsed++;
  const pool = P.pool.filter((id) => !P.hand.some((c) => c.id === id));
  const opts: string[] = [];
  while (opts.length < HS.shopChoice && pool.length) opts.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  P.choice = { kind: 'shop', opts };
  s.log.push({ t: 'shop', p });
  return true;
}

/** Взять карту i из открытого выбора. */
export function choose(s: HState, p: PI, i: number): boolean {
  const P = s.p[p];
  const ch = P.choice;
  if (!ch || i < 0 || i >= ch.opts.length) return false;
  P.choice = null;
  const id = ch.opts[i];
  if (ch.kind === 'draw') P.deck.push(...ch.opts.filter((_, k) => k !== i));
  if (P.hand.length >= HS.hand) s.log.push({ t: 'draw', p, burned: id });
  else { P.hand.push({ uid: newId(s, 'c'), id }); s.log.push({ t: 'draw', p }); }
  return true;
}

function draw(s: HState, p: PI, quiet = false) {
  const P = s.p[p];
  const id = P.deck.shift();
  if (!id) {
    P.fatigue++;
    if (!quiet) s.log.push({ t: 'fatigue', p, n: P.fatigue });
    damageHero(s, p, P.fatigue);
    return;
  }
  if (P.hand.length >= HS.hand) { if (!quiet) s.log.push({ t: 'draw', p, burned: id }); return; }
  P.hand.push({ uid: newId(s, 'c'), id });
  if (!quiet) s.log.push({ t: 'draw', p });
}

// ─────────────────────────── Ход ───────────────────────────
/** Отстаёт ли игрок p: здоровье его героя меньше, чем у соперника, на HS.lossGap и больше (броня не в счёт). */
export function isBehind(s: HState, p: PI): boolean {
  // сравниваем потерянное здоровье: у «Обороны» запас больше, это не отставание соперника
  const lost = (q: PI) => maxHp(s.p[q].hero.agent) - s.p[q].hero.hp;
  return lost(p) - lost(foe(p)) >= HS.lossGap;
}
export const lossBonus = (P: { lossStreak: number }) => Math.min(P.lossStreak, HS.lossMax) * HS.lossStep;
export function incomeOf(P: HPlayer) { return Math.min(HS.maxMoney, HS.firstIncome + P.turns * HS.income); }

function beginTurn(s: HState, p: PI) {
  s.turn = p; s.turnNo++;
  const P = s.p[p];
  const carry = Math.min(P.money, HS.carry);
  // Экономика как в CS: кто позади, получает бонус за отставание, растущий с каждым ходом серии
  P.lossStreak = isBehind(s, p) ? P.lossStreak + 1 : 0;
  const loss = lossBonus(P);
  // Сбережения (до $3000) идут сверх дохода: можно сыграть «эко» и накопить на дорогую карту
  P.money = incomeOf(P) + carry + P.bonus + loss;
  if (P.bonus) s.log.push({ t: 'cash', p, n: P.bonus });
  if (loss) s.log.push({ t: 'cash', p, n: loss, loss: P.lossStreak });
  P.bonus = 0;
  P.turns++;
  P.powerUsed = false;
  P.shopUsed = 0;
  P.entry = false; P.saved = false;
  P.hero.atk = 0; P.hero.attacked = false;
  s.log.push({ t: 'turn', p });
  // Огонь
  for (const u of [...P.board]) {
    if (u.burn) { const b = u.burn; u.burn = 0; for (const t of withNeighbors(P.board, u)) damageUnit(s, t, b, { src: 'fire' }); }
  }
  cleanup(s);
  if (s.winner !== null) return;
  for (const u of P.board) {
    u.sick = false; u.shot = false;
    u.attacks = u.kw.includes('twice') ? 2 : 1;
    if (u.reloading) { u.reloading = false; u.attacks = 0; }
  }
  // Засада «Ниндзя-дефьюз»
  const bombE = s.p[foe(p)].board.find(isBomb);
  const ninja = P.traps.find((t) => t.id === 'ninja');
  if (bombE && ninja && s.p[foe(p)].board.filter((x) => !isBomb(x)).length <= 1) {
    P.traps = P.traps.filter((t) => t !== ninja);
    s.log.push({ t: 'trap', p, card: 'ninja' });
    bombE.hp = 0;
    cleanup(s);
  }
  // Бомба
  const bomb = P.board.find(isBomb);
  if (bomb) {
    bomb.bomb--;
    s.log.push({ t: 'bomb', left: bomb.bomb });
    if (bomb.bomb <= 0) { s.log.push({ t: 'boom' }); s.winner = p; s.reason = 'bomb'; return; }
  }
  drawChoice(s, p);
  cleanup(s);
}

export function endTurn(s: HState) {
  if (s.winner !== null) return;
  const P = s.p[s.turn];
  if (P.choice) choose(s, s.turn, 0);
  for (const u of P.board) {
    if (u.blind && !u.sick) u.blind = false;   // ослепление снимается, когда боец пропустил ход
    if (u.temp) { u.atk -= u.temp; u.temp = 0; }
  }
  // «Трейд» держится до конца хода мстителя
  for (const u of s.p[foe(s.turn)].board) u.marked = false;
  beginTurn(s, foe(s.turn));
}

// ─────────────────────────── Поиск ───────────────────────────
export function findUnit(s: HState, id: string): { u: HUnit; p: PI } | null {
  for (const p of [0, 1] as PI[]) { const u = s.p[p].board.find((x) => x.uid === id); if (u) return { u, p }; }
  return null;
}
const withNeighbors = (board: HUnit[], u: HUnit) => { const i = board.indexOf(u); return [board[i - 1], u, board[i + 1]].filter(Boolean) as HUnit[]; };
export const isBomb = (u: HUnit) => u.card === 'c4';
export const clsOf = (u: HUnit): HClass => hcard(u.card).cls;

/** Кого можно выбрать целью карты/силы героя. */
export function targetsFor(s: HState, p: PI, kind: HTarget): string[] {
  const me = s.p[p], en = s.p[foe(p)];
  const visible = (u: HUnit) => !u.kw.includes('stealth');
  const enemyUnits = en.board.filter((u) => visible(u) && !isBomb(u)).map((u) => u.uid);
  const myUnits = me.board.filter((u) => !isBomb(u)).map((u) => u.uid);
  switch (kind) {
    case 'none': return [];
    case 'enemyUnit': return enemyUnits;
    case 'friendlyUnit': return myUnits;
    case 'friendlySniper': return me.board.filter((u) => u.kw.includes('sniper')).map((u) => u.uid);
    case 'friendlyAny': return [...myUnits, heroId(p)];
    case 'anyUnit': return [...enemyUnits, ...en.board.filter(isBomb).map((u) => u.uid), ...myUnits];
    case 'enemyAny': return [...enemyUnits, heroId(foe(p))];
    case 'any': return [...enemyUnits, heroId(foe(p)), ...myUnits, heroId(p)];
  }
}

/** Цена карты с учётом локации. */
export function costOf(s: HState, id: string): number {
  const c = hcard(id);
  let cost = c.id === 'c4' ? HS.c4Cost : c.cost;
  if (s.map === 'mirage' && (id === 'smoke' || id === 'flash')) cost -= 1000;
  if (s.map === 'anubis' && c.kind === 'trap') cost -= 1000;
  return Math.max(0, cost);
}

/** null — карту сыграть нельзя; [] — без цели; иначе список целей. */
export function playTargets(s: HState, p: PI, id: string, free = false): string[] | null {
  const c = hcard(id), P = s.p[p];
  if (s.turn !== p || s.winner !== null || P.choice || (!free && P.money < costOf(s, id))) return null;
  if ((c.kind === 'unit' || c.kind === 'bomb') && P.board.length >= HS.board) return null;
  if (c.kind === 'trap' && (P.traps.length >= HS.traps || P.traps.some((t) => t.id === c.id))) return null;
  if (c.kind === 'bomb' && (P.hero.side !== 'T' || P.board.some(isBomb))) return null;
  if ((c.id === 'he' || c.id === 'ba_wall' || c.id === 'sa_breach') && !s.p[foe(p)].board.some((u) => !isBomb(u))) return null;
  if (c.id === 'smoke' && !s.p[foe(p)].board.some((u) => u.kw.includes('sniper') || clsOf(u) === 'heavy')) return null;
  if (!c.target || c.target === 'none') return [];
  const t = targetsFor(s, p, c.target);
  if (!t.length) return c.kind === 'unit' && c.bcOptional ? [] : null;
  return t;
}

// ─────────────────────────── Урон ───────────────────────────
function damageHero(s: HState, p: PI, n: number) {
  const h = s.p[p].hero;
  const a = Math.min(h.armor, n);
  h.armor -= a; h.hp -= n - a;
  s.log.push({ t: 'dmg', id: heroId(p), n });
}
interface DmgOpt { src?: 'weapon' | 'nade' | 'fire' | 'spell'; cls?: HClass; pierce?: boolean; hs?: boolean; bonus?: boolean }
/** Урон бойцу с учётом брони. Возвращает нанесённый урон. */
function damageUnit(s: HState, u: HUnit, n: number, o: DmgOpt = {}): number {
  if (n <= 0) return 0;
  const pierce = o.pierce || (o.cls ? PIERCE_CLS.includes(o.cls) : false) || o.src === 'fire';
  const blocked = pierce || o.hs ? 0 : Math.min(u.armor, n - 1);   // броня режет каждое попадание, но 1 урон проходит всегда
  const d = n - blocked;
  u.hp -= d;
  // «прострел»: пуля прошла сквозь броню (винтовки, снайперки, Five-SeveN…) — значок в килфиде
  const wb = pierce && o.src !== 'fire' && u.armor > 0 && !o.hs;
  s.log.push({ t: 'dmg', id: u.uid, n: d, hs: o.hs, bonus: o.bonus, blocked: blocked || undefined, wb: wb || undefined });
  return d;
}
function damage(s: HState, id: string, n: number, o: DmgOpt = {}) {
  if (id === 'h0' || id === 'h1') return damageHero(s, id === 'h0' ? 0 : 1, n);
  const f = findUnit(s, id); if (f) damageUnit(s, f.u, n, o);
}
function heal(s: HState, id: string, n: number) {
  if (id === 'h0' || id === 'h1') {
    const h = s.p[id === 'h0' ? 0 : 1].hero; const k = Math.min(n, maxHp(h.agent) - h.hp); h.hp += k; if (k) s.log.push({ t: 'heal', id, n: k }); return;
  }
  const f = findUnit(s, id); if (!f) return;
  const k = Math.min(n, f.u.maxHp - f.u.hp); f.u.hp += k; if (k) s.log.push({ t: 'heal', id, n: k });
}
function addArmor(s: HState, u: HUnit, n: number) { const k = Math.min(n, HS.maxArmor - u.armor); u.armor += k; if (k) s.log.push({ t: 'armor', id: u.uid, n: k }); }
function blind(s: HState, u: HUnit) { if (isBomb(u)) return; u.blind = true; s.log.push({ t: 'blind', id: u.uid }); }
function addKw(u: HUnit, k: KW) { if (!u.kw.includes(k)) u.kw.push(k); }

/** Бонус ветерана — по классу оружия. */
const VET_RU: Partial<Record<HClass, string>> = { pistol: 'Хедшот', smg: 'Очередь', shotgun: '+2 здоровья', rifle: '+1 атаки, Шлем', sniper: '+2 атаки', heavy: 'Укрытие' };
function makeVet(s: HState, u: HUnit) {
  if (u.kw.includes('vet') || isBomb(u)) return;
  const cls = clsOf(u);
  if (!VET_RU[cls]) return;
  addKw(u, 'vet');
  u.hp += 1; u.maxHp += 1;
  switch (cls) {
    case 'pistol': addKw(u, 'headshot'); break;
    case 'smg': addKw(u, 'twice'); break;
    case 'shotgun': u.hp += 2; u.maxHp += 2; break;
    case 'rifle': u.atk += 1; addKw(u, 'helmet'); break;
    case 'sniper': u.atk += 2; break;
    case 'heavy': addKw(u, 'taunt'); break;
  }
  s.log.push({ t: 'vet', id: u.uid, text: `Ветеран: ${VET_RU[cls]}` });
}

/** Убрать погибших: награды, ветераны, оружие на пол, засады, взрывчатка. Проверка победы. */
function cleanup(s: HState, killer?: { p: PI; cls: HClass; unit?: HUnit }) {
  for (let guard = 0; guard < 5; guard++) {
    let any = false;
    for (const p of [0, 1] as PI[]) {
      const P = s.p[p];
      const dead = P.board.filter((x) => x.hp <= 0);
      if (!dead.length) continue;
      any = true;
      for (const u of dead) {
        s.log.push({ t: 'die', id: u.uid });
        const idx = P.board.indexOf(u);
        P.board.splice(idx, 1);
        if (isBomb(u)) {
          s.log.push({ t: 'defused' });
          if (HS.defuseBonus) { s.p[foe(p)].bonus += HS.defuseBonus; s.log.push({ t: 'cash', p: foe(p), n: HS.defuseBonus }); }
          continue;
        }
        const c = hcard(u.card);
        if (killer && killer.p !== p) {
          let r = KILL_REWARD[killer.cls] ?? 0;
          if (killer.unit?.card === 'pr_vet') r += 300;
          if (r) { s.p[killer.p].bonus += r; s.log.push({ t: 'cash', p: killer.p, n: r }); }
          s.p[killer.p].kills++;
          if (killer.unit && killer.unit.hp > 0) makeVet(s, killer.unit);
          // «Энтри»: первое убийство бойцом в свой ход — +$300 в следующем ходу (у «Раша» +$600 и +1 атаки бойцу)
          const K = s.p[killer.p];
          if (killer.unit && s.turn === killer.p && !K.entry) {
            K.entry = true;
            const rushy = styleOf(K.hero.agent) === 'rush';      // «Раш» живёт энтри-фрагами
            K.bonus += rushy ? 600 : 300;
            if (rushy && killer.unit.hp > 0) killer.unit.atk += 1;
            s.log.push({ t: 'entry', p: killer.p, id: killer.unit.uid });
          }
          // «Трейд»: убийца помечен — союзники погибшего бьют по нему на 2 сильнее
          if (killer.unit && killer.unit.hp > 0 && !killer.unit.marked) { killer.unit.marked = true; s.log.push({ t: 'mark', id: killer.unit.uid }); }
        }
        // Трофей: если боец погиб, так и не нанеся урона, его оружие (с полным магазином) достаётся убийце бесплатно
        if (killer && killer.p !== p && u.dealt === 0 && WEAPON_CLS.includes(c.cls) && !c.sig) {
          const K = s.p[killer.p];
          if (K.hand.length >= HS.hand) s.log.push({ t: 'trophy', p: killer.p, card: c.id, burned: true });
          else { K.hand.push({ uid: newId(s, 'c'), id: c.id, free: true }); s.log.push({ t: 'trophy', p: killer.p, card: c.id }); }
        }
        // Взрывчатка
        if (u.kw.includes('deathblast')) for (const x of [...s.p[foe(p)].board]) if (!isBomb(x)) damageUnit(s, x, 2, { src: 'nade' });
        // Засада «Тиммейт на подхвате»
        const bk = P.traps.find((t) => t.id === 'backup');
        if (bk && P.board.length < HS.board) {
          P.traps = P.traps.filter((t) => t !== bk);
          s.log.push({ t: 'trap', p, card: 'backup' });
          const m = summon(s, p, P.hero.side === 'CT' ? 'mate_ct' : 'mate_t', Math.min(idx, P.board.length));
          if (m) s.log.push({ t: 'play', p, card: m.card, uid: m.uid });
        }
      }
    }
    if (!any) break;
    killer = undefined;   // цепочки смертей (взрывчатка) — без наград
  }
  const dead = [0, 1].filter((p) => s.p[p].hero.hp <= 0) as PI[];
  if (dead.length && s.winner === null) {
    s.winner = dead.length === 2 ? s.turn : foe(dead[0]);
    s.reason = 'hero';
  }
}

// ─────────────────────────── Действия ───────────────────────────
function summon(s: HState, p: PI, id: string, at?: number, mode?: number): HUnit | null {
  const c = hcard(id), P = s.p[p];
  if (P.board.length >= HS.board) return null;
  const u: HUnit = {
    uid: newId(s), card: id, atk: c.atk ?? 0, hp: c.hp ?? 1, maxHp: c.hp ?? 1, armor: c.armor ?? 0, temp: 0, kw: [...(c.kw ?? [])],
    attacks: 0, sick: true, blind: false, reloading: false, burn: 0, dealt: 0, shot: false, marked: false, bomb: c.kind === 'bomb' ? HS.bombTimer : 0,
  };
  // Режим стрельбы (карты с выбором)
  const m = c.modes?.[mode ?? 0];
  if (m) {
    u.mode = mode ?? 0;
    u.atk = Math.max(0, u.atk + (m.atk ?? 0)); u.hp += m.hp ?? 0; u.maxHp += m.hp ?? 0;
    u.kw = u.kw.filter((k) => !(m.remove ?? []).includes(k));
    for (const k of m.add ?? []) if (!u.kw.includes(k)) u.kw.push(k);
  }
  // Локация
  if (s.map === 'dust2' && u.kw.includes('sniper')) u.atk += 1;
  if (s.map === 'ancient' && u.kw.includes('taunt')) { u.hp += 2; u.maxHp += 2; }
  if (u.kw.includes('rush') || u.kw.includes('sapper')) u.attacks = u.kw.includes('twice') ? 2 : 1;
  // Пассивные свойства стиля агента
  const st = styleOf(P.hero.agent);
  if (st === 'rush' && u.kw.includes('rush')) { u.atk += 1; u.hp += 1; u.maxHp += 1; }
  // против «Обороны» рывок не срабатывает: бойцы ждут своего хода, как все
  if (styleOf(s.p[foe(p)].hero.agent) === 'hold' && u.kw.includes('rush')) u.attacks = 0;
  if (st === 'hold' && u.kw.includes('taunt')) { u.hp += 2; u.maxHp += 2; u.armor = Math.min(HS.maxArmor, u.armor + 1); }
  // «Оборона» держит точки: бомбу у неё закладывают под огнём — тикает на ход дольше
  if (c.kind === 'bomb' && styleOf(s.p[foe(p)].hero.agent) === 'hold') u.bomb += HS.holdBombDelay;
  if (st === 'long' && u.kw.includes('sniper')) u.atk += 1;
  P.board.splice(at ?? P.board.length, 0, u);
  return u;
}

/** Засады противника на выход бойца. */
function onEnemySummon(s: HState, p: PI, u: HUnit) {
  const E = s.p[foe(p)];
  const t = E.traps.find((x) => x.id === 'gu_mines') ?? E.traps.find((x) => x.id === 'wire');
  if (!t || isBomb(u)) return;
  E.traps = E.traps.filter((x) => x !== t);
  s.log.push({ t: 'trap', p: foe(p), card: t.id });
  damageUnit(s, u, t.id === 'gu_mines' ? 3 : 2, { src: 'nade' });
}

export function playCard(s: HState, p: PI, uid: string, target?: string, at?: number, mode?: number): boolean {
  const P = s.p[p];
  const inst = P.hand.find((c) => c.uid === uid);
  if (!inst) return false;
  const c = hcard(inst.id);
  const t = playTargets(s, p, c.id, !!inst.free);
  if (!t) return false;
  if (t.length && (!target || !t.includes(target))) {
    if (!(c.kind === 'unit' && c.bcOptional && !target)) return false;
  }
  if (c.modes && (mode === undefined || mode < 0 || mode >= c.modes.length)) mode = 0;
  if (!inst.free) P.money -= costOf(s, c.id);
  P.hand = P.hand.filter((x) => x !== inst);
  const en = s.p[foe(p)];
  if (c.kind === 'trap') {
    P.traps.push({ uid: newId(s, 't'), id: c.id });
    s.log.push({ t: 'play', p, card: 'trap' });
    return true;
  }
  if (c.kind !== 'spell') {
    const u = summon(s, p, c.id, at, mode)!;
    s.log.push({ t: 'play', p, card: c.id, uid: u.uid, target });
    const tu = target ? findUnit(s, target)?.u : undefined;
    switch (c.id) {
      case 'p250': if (target) damage(s, target, 1, { cls: 'pistol' }); break;
      case 'se_spotter': if (tu) { tu.atk += 2; tu.reloading = false; if (tu.attacks === 0 && !tu.sick) tu.attacks = 1; s.log.push({ t: 'buff', id: tu.uid, text: '+2 атаки' }); } break;
      case 'sa_oper': if (tu) blind(s, tu); break;
      case 'gi_gend': for (const x of withNeighbors(P.board, u)) if (x !== u && !isBomb(x)) { x.atk++; x.hp++; x.maxHp++; s.log.push({ t: 'buff', id: x.uid, text: '+1/+1' }); } break;
    }
    if (c.kind === 'bomb') {
      s.log.push({ t: 'bomb', left: u.bomb });
      if (HS.plantBonus) { P.bonus += HS.plantBonus; s.log.push({ t: 'cash', p, n: HS.plantBonus }); }
    }
    onEnemySummon(s, p, u);
    cleanup(s, { p, cls: c.cls });
    return true;
  }
  s.log.push({ t: 'play', p, card: c.id, target });
  // Засада «Фейк»
  const fake = en.traps.find((x) => x.id === 'fake');
  if (fake && c.id !== 'drop' && c.id !== 'pr_contract') {
    en.traps = en.traps.filter((x) => x !== fake);
    s.log.push({ t: 'trap', p: foe(p), card: 'fake' }, { t: 'fizzle', card: c.id });
    return true;
  }
  const tu = target ? findUnit(s, target)?.u : undefined;
  // «Оборона»: гранаты и огонь бьют на 1 сильнее
  const hb = styleOf(P.hero.agent) === 'hold' ? 1 : 0;
  const fire = s.map === 'inferno' ? 2 : 1;          // Inferno: огонь жжёт сильнее
  const heB = s.map === 'cache' ? 1 : 0;              // Cache: осколочная сильнее
  const heavyBonus = (x: HUnit) => (clsOf(x) === 'heavy' ? 2 : 0) + hb;
  switch (c.id) {
    case 'he': for (const x of [...en.board]) if (!isBomb(x)) damageUnit(s, x, 3 + heB + heavyBonus(x), { src: 'nade', bonus: heavyBonus(x) > 0 }); break;
    case 'molotov': case 'incendiary': if (tu) {
      const cover = clsOf(tu) === 'cover';
      damageUnit(s, tu, (cover ? 8 : 4) + heavyBonus(tu), { src: 'nade', bonus: cover || heavyBonus(tu) > 0 }); tu.burn = fire;
    } break;
    case 'flash': if (tu) for (const x of withNeighbors(en.board, tu)) blind(s, x); break;
    case 'smoke': for (const x of en.board) if (x.kw.includes('sniper') || clsOf(x) === 'heavy') blind(s, x); break;
    case 'zeus': if (target) damage(s, target, 4, { pierce: true }); break;
    case 'kevlar': if (tu) { addArmor(s, tu, 1); tu.hp++; tu.maxHp++; } break;
    case 'helmet': if (tu) { addArmor(s, tu, 1); tu.hp++; tu.maxHp++; addKw(tu, 'helmet'); s.log.push({ t: 'buff', id: tu.uid, text: 'Шлем' }); } break;
    case 'medkit': if (target) heal(s, target, 4); break;
    case 'boost': if (tu) { tu.atk += 2; s.log.push({ t: 'buff', id: tu.uid, text: '+2 атаки' }); } break;
    case 'kit': { draw(s, p); const b = en.board.find(isBomb); if (b) damageUnit(s, b, HS.kitDmg); break; }
    case 'drop': P.money += 1000; s.log.push({ t: 'cash', p, n: 1000 }); break;
    // фирменные
    case 'sw_armor': for (const x of P.board) if (!isBomb(x)) { addArmor(s, x, 1); x.hp++; x.maxHp++; } break;
    case 'se_long': if (tu) { const big = tu.kw.includes('sniper') || clsOf(tu) === 'heavy'; damageUnit(s, tu, big ? 8 : 5, { pierce: true, bonus: big }); } break;
    case 'fb_intel': if (en.traps.length) { s.log.push({ t: 'buff', id: heroId(foe(p)), text: `−${en.traps.length} засад` }); en.traps = []; } draw(s, p); draw(s, p); break;
    case 'sa_breach': for (const x of en.board) blind(s, x); break;
    case 'gi_shield': if (tu) { tu.hp += 3; tu.maxHp += 3; addArmor(s, tu, 1); addKw(tu, 'taunt'); s.log.push({ t: 'buff', id: tu.uid, text: 'Щит' }); } break;
    case 'ph_fast': { const b = P.board.find(isBomb); if (b && b.bomb > 1) { b.bomb--; s.log.push({ t: 'bomb', left: b.bomb }); } else draw(s, p); break; }
    case 'el_rush': for (const x of P.board) if (!isBomb(x) && x.atk > 0) {
      x.atk++; x.temp++;
      if (x.sick && x.attacks === 0) { x.attacks = 1; addKw(x, 'rush'); }
      s.log.push({ t: 'buff', id: x.uid, text: '+1' });
    } break;
    case 'ba_wall': for (const x of [...en.board]) if (!isBomb(x)) { damageUnit(s, x, 1 + hb + (clsOf(x) === 'cover' ? 3 : 0), { src: 'fire' }); x.burn = fire; } break;
    case 'pr_contract': P.bonus += 2000; s.log.push({ t: 'buff', id: heroId(p), text: '+$2000 в след. ход' }); break;
  }
  cleanup(s, { p, cls: 'spell' });
  return true;
}

// Сила героя
export function powerTargets(s: HState, p: PI): string[] | null {
  const P = s.p[p], pw = POWERS[P.hero.agent];
  if (!pw || s.turn !== p || s.winner !== null || P.choice || P.powerUsed || P.money < pw.cost) return null;
  if (pw.target === 'none') return [];
  const t = targetsFor(s, p, pw.target);
  return t.length ? t : null;
}
export function usePower(s: HState, p: PI, target?: string): boolean {
  const t = powerTargets(s, p);
  if (!t || (t.length && (!target || !t.includes(target)))) return false;
  const P = s.p[p];
  P.money -= POWERS[P.hero.agent].cost;
  P.powerUsed = true;
  s.log.push({ t: 'power', p, target });
  const tu = target ? findUnit(s, target)?.u : undefined;
  switch (P.hero.agent) {
    case 'ct_swat': P.hero.armor += 4; s.log.push({ t: 'armor', id: heroId(p), n: 4 }); for (const x of P.board) if (!isBomb(x)) addArmor(s, x, 1); break;
    case 'ct_seal': if (target) damage(s, target, 2, { pierce: true }); break;
    case 'ct_fbi': if (tu) damageUnit(s, tu, isBomb(tu) ? 4 : 1, { pierce: true }); break;
    case 'ct_sas': if (tu) blind(s, tu); break;
    case 'ct_gign': if (tu) { tu.atk += 1; tu.hp += 2; tu.maxHp += 2; s.log.push({ t: 'buff', id: tu.uid, text: '+1/+2' }); } break;
    case 't_phoenix': P.hero.atk += 3; s.log.push({ t: 'buff', id: heroId(p), text: 'Нож' }); break;
    case 't_elite': if (tu) { tu.atk += 1; tu.hp += 1; tu.maxHp += 1; if (tu.sick && tu.attacks === 0) { tu.attacks = 1; addKw(tu, 'rush'); } s.log.push({ t: 'buff', id: tu.uid, text: '+1 атаки' }); } break;
    case 't_balkan': damageHero(s, foe(p), 2); break;
    case 't_guerrilla': if (tu) { addKw(tu, 'stealth'); s.log.push({ t: 'buff', id: tu.uid, text: 'Глушитель' }); } break;
    case 't_pro': if (tu) damageUnit(s, tu, 3, { pierce: true }); break;
  }
  cleanup(s, { p, cls: 'pistol' });
  return true;
}

// Атаки
export function canAttack(s: HState, p: PI, id: string): boolean {
  if (s.turn !== p || s.winner !== null || s.p[p].choice) return false;
  if (id === heroId(p)) { const h = s.p[p].hero; return h.atk > 0 && !h.attacked; }
  const u = s.p[p].board.find((x) => x.uid === id);
  return !!u && u.atk > 0 && u.attacks > 0 && !u.blind && !isBomb(u);
}
export function attackTargets(s: HState, p: PI, id: string): string[] {
  if (!canAttack(s, p, id)) return [];
  const en = s.p[foe(p)];
  const u = id === heroId(p) ? null : s.p[p].board.find((x) => x.uid === id)!;
  const sniper = !!u?.kw.includes('sniper');
  const smg = !!u && clsOf(u) === 'smg';
  const visible = en.board.filter((x) => !x.kw.includes('stealth'));
  const bombs = visible.filter(isBomb).map((x) => x.uid);
  if (u?.kw.includes('sapper') && u.sick) return bombs;
  const taunts = visible.filter((x) => x.kw.includes('taunt') && !isBomb(x));
  const rushOnly = !!u && u.sick;          // «Рывок»: в ход выхода — только бойцов
  // «За укрытием»: бойцы рядом с Укрытием не видны вражеским снайперам
  if (sniper) {
    const covered = new Set(visible.filter((x) => !x.kw.includes('taunt') && isCovered(en.board, x)).map((x) => x.uid));
    const units = visible.filter((x) => !covered.has(x.uid)).map((x) => x.uid);
    return rushOnly ? units : [...units, heroId(foe(p))];
  }
  if (taunts.length) {
    // ПП достают снайперов за укрытием
    const extra = smg ? visible.filter((x) => x.kw.includes('sniper') && !x.kw.includes('taunt')).map((x) => x.uid) : [];
    return [...taunts.map((x) => x.uid), ...extra, ...bombs];
  }
  const units = visible.map((x) => x.uid);
  return rushOnly ? units : [...units, heroId(foe(p))];
}

/** Стоит ли боец рядом с Укрытием (прикрыт от снайперов). */
export function isCovered(board: HUnit[], u: HUnit): boolean {
  const i = board.indexOf(u);
  return [board[i - 1], board[i + 1]].some((x) => x && x.kw.includes('taunt') && !isBomb(x));
}
/** «Клатч»: у игрока один боец против двух и больше. */
export function isClutch(s: HState, p: PI): boolean {
  const mine = s.p[p].board.filter((x) => !isBomb(x)).length, theirs = s.p[foe(p)].board.filter((x) => !isBomb(x)).length;
  return mine === 1 && theirs >= 2;
}
/** Доп. урон атакующего бойца по цели: класс, «Трейд», «Клатч». */
export function attackBonus(s: HState, p: PI, att: HUnit, tgt: HUnit): number {
  return counterBonus(clsOf(att), tgt) + (tgt.marked ? 2 : 0) + (isClutch(s, p) ? 2 : 0)
    + (styleOf(s.p[p].hero.agent) === 'long' && tgt.kw.includes('taunt') ? 2 : 0);
}

/** Доп. урон класса атакующего по цели (для подсказок и боя). */
export function counterBonus(att: HClass, tgt: HUnit): number {
  return COUNTER[att]?.[clsOf(tgt)] ?? 0;
}

export function attack(s: HState, p: PI, from: string, to: string): boolean {
  if (!attackTargets(s, p, from).includes(to)) return false;
  s.log.push({ t: 'atk', from, to });
  const isHero = from === heroId(p);
  const P = s.p[p], en = s.p[foe(p)];
  const au = isHero ? null : P.board.find((x) => x.uid === from)!;
  const cls: HClass = isHero ? 'pistol' : clsOf(au!);
  if (isHero) P.hero.attacked = true;
  else {
    au!.attacks--; au!.shot = true;
    au!.kw = au!.kw.filter((k) => k !== 'stealth');
    if (au!.kw.includes('reload')) { au!.reloading = true; au!.attacks = 0; }
  }
  // Засада «Держит угол»
  const angle = !isHero ? en.traps.find((x) => x.id === 'angle') : undefined;
  if (angle && au) {
    en.traps = en.traps.filter((x) => x !== angle);
    s.log.push({ t: 'trap', p: foe(p), card: 'angle' });
    damageUnit(s, au, 3, { pierce: true });
    if (au.hp <= 0) { cleanup(s, { p: foe(p), cls: 'rifle' }); return true; }
  }
  const atk = isHero ? P.hero.atk : au!.atk;
  if (to === heroId(foe(p))) {
    damageHero(s, foe(p), atk);
    if (au) au.dealt += atk;
  } else {
    const tu = en.board.find((x) => x.uid === to)!;
    const pierce = !!au?.kw.includes('pierce') || styleOf(P.hero.agent) === 'long';   // «Дальняя игра» бьёт сквозь броню
    if (isBomb(tu)) {
      damageUnit(s, tu, au?.kw.includes('sapper') ? atk * 2 : atk);
      if (au) au.dealt += atk;
      // «Охрана»: T рядом с бомбой стреляют в сапёра (как разминирование под огнём)
      const guards = HS.guardShot && !(HS.holdNoGuard && styleOf(P.hero.agent) === 'hold') ? withNeighbors(en.board, tu).filter((g) => g !== tu && !isBomb(g) && g.atk > 0 && !g.blind && g.hp > 0)
        .sort((a, b) => b.atk - a.atk).slice(0, HS.guardMax) : [];
      for (const g of guards) {
        const n = Math.ceil(g.atk * HS.guardMul);
        s.log.push({ t: 'atk', from: g.uid, to: from });
        if (au) { if (au.hp > 0) damageUnit(s, au, n, { cls: clsOf(g) }); }
        else damageHero(s, p, n);
      }
    } else {
      const hs = !!au?.kw.includes('headshot') && !tu.kw.includes('helmet');
      // «Дальняя игра» прицельно бьёт по укрытиям
      const bonus = au ? attackBonus(s, p, au, tu) : (tu.marked ? 2 : 0);
      if (au && isClutch(s, p)) s.log.push({ t: 'clutch', id: au.uid });
      const side = au?.kw.includes('cleave') ? withNeighbors(en.board, tu).filter((x) => x !== tu && !isBomb(x)) : [];
      // Ответный огонь: не отвечают ослеплённые и те, по кому стреляет снайпер
      const ret = au?.kw.includes('sniper') || tu.blind || tu.atk <= 0 ? 0 : tu.atk + (isHero ? 0 : counterBonus(clsOf(tu), au!));
      const retPierce = PIERCE_CLS.includes(clsOf(tu)) || tu.kw.includes('pierce');
      let dealt = damageUnit(s, tu, hs ? Math.max(atk + bonus, tu.hp + tu.armor) : atk + bonus, { cls, pierce, hs, bonus: bonus > 0 });
      for (const x of side) dealt += damageUnit(s, x, atk + counterBonus(cls, x), { cls, pierce, bonus: counterBonus(cls, x) > 0 });
      if (au) au.dealt += dealt;
      if (au?.kw.includes('suppress')) for (const x of [tu, ...side]) if (x.hp > 0) blind(s, x);
      if (ret > 0) {
        if (isHero) damageHero(s, p, ret);
        else damageUnit(s, au!, ret, { cls: clsOf(tu), pierce: retPierce, bonus: counterBonus(clsOf(tu), au!) > 0 });
        tu.dealt += ret;
      }
    }
  }
  cleanup(s, { p, cls, unit: au ?? undefined });
  return true;
}

// «Сейв»: увести бойца со стола и вернуть карту в руку (раз в ход, если он не стрелял и не вышел в этом ходу)
export function canSave(s: HState, p: PI, id: string): boolean {
  const P = s.p[p];
  if (s.turn !== p || s.winner !== null || P.choice || P.saved || P.hand.length >= HS.hand) return false;
  const u = P.board.find((x) => x.uid === id);
  if (!u || isBomb(u) || u.sick || u.shot) return false;
  const c = hcard(u.card);
  return c.kind === 'unit' && c.cost > 0 && c.cls !== 'cover' && c.cls !== 'token';
}
export function save(s: HState, p: PI, id: string): boolean {
  if (!canSave(s, p, id)) return false;
  const P = s.p[p];
  const u = P.board.find((x) => x.uid === id)!;
  P.board = P.board.filter((x) => x !== u);
  P.saved = true;
  P.hand.push({ uid: newId(s, 'c'), id: u.card });
  s.log.push({ t: 'save', p, card: u.card, id });
  return true;
}
