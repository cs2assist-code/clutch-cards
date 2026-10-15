// Общий протокол онлайна: сообщения клиент ↔ сервер, «поворот» стола и скрытие чужих карт.
// Сервер хранит настоящий стол (места 0 и 1). Каждому игроку уходит его вид:
//  • повёрнутый — сам игрок всегда под индексом 0 (интерфейс так и рисует: «я» внизу);
//  • без чужой информации — карты в руке и колоде соперника, его засады и открытый выбор заменены «рубашками».
import type { Action } from '../hs/ai';
import type { Ev, HState, PI } from '../hs/engine';
import type { Side } from '../game/types';
import type { KnifeRound, KnifeState, Move } from '../hs/knife';

export const HIDDEN = 'hidden';
export type Agents = { T: string; CT: string };
export type StepAction = Action | { k: 'end' };

/** Уровни по рейтингу — как на FACEIT: 10 уровней, старт с 1000 (уровень 4). */
export const LEVELS: { level: number; min: number; max: number }[] = [
  { level: 1, min: 100, max: 500 }, { level: 2, min: 501, max: 750 }, { level: 3, min: 751, max: 900 },
  { level: 4, min: 901, max: 1050 }, { level: 5, min: 1051, max: 1200 }, { level: 6, min: 1201, max: 1350 },
  { level: 7, min: 1351, max: 1530 }, { level: 8, min: 1531, max: 1750 }, { level: 9, min: 1751, max: 2000 },
  { level: 10, min: 2001, max: Infinity },
];
export const MIN_RATING = 100;
export function levelOf(r: number) {
  const x = Math.round(r);
  return LEVELS.find((l) => x <= l.max) ?? LEVELS[LEVELS.length - 1];
}
/** Совместимость: «лига» — это уровень. */
export const leagueOf = (r: number) => { const l = levelOf(r); return { ...l, name: `Уровень ${l.level}`, icon: String(l.level) }; };

/** Строка истории рейтинговых матчей (для профиля). */
export interface HistRow { at: number; win: boolean; delta: number; after: number; opp: string; oppRating: number; map: string; reason: string }

export interface PlayerInfo { id: string; name: string; rating: number; games: number; wins: number; league: string; provisional: boolean; level: number; peak: number; rank?: number }

// ── Клиент → сервер ──
export type C2S =
  | { t: 'hello'; initData?: string; dev?: string; name?: string }
  | { t: 'queue'; agents: Agents }
  | { t: 'unqueue' }
  | { t: 'duel_create'; agents: Agents }
  | { t: 'duel_join'; code: string; agents: Agents }
  | { t: 'duel_cancel' }
  | { t: 'knife'; move: Move }
  | { t: 'side'; side: Side }
  | { t: 'ban'; map: string }
  | { t: 'mull'; uids: string[] }
  | { t: 'act'; a: Action }
  | { t: 'end' }
  | { t: 'radio'; key: string }
  | { t: 'resign' }
  | { t: 'top' }
  | { t: 'profile' }
  | { t: 'ping' };

// ── Сервер → клиент ──
export type S2C =
  | { t: 'me'; me: PlayerInfo; season: string }
  | { t: 'queued'; size: number; lo?: number; hi?: number; since?: number }
  | { t: 'duel_code'; code: string }
  | { t: 'found'; ranked: boolean; opp: { name: string; rating: number; league: string } }
  /** Ножевой раунд (уже повёрнут: вы — 0). pick: кто выбирает сторону, когда ножи закончились. */
  | { t: 'knife'; k: KnifeState; picked: boolean; oppPicked: boolean; reveal?: KnifeRound; deadline: number; pick?: 'me' | 'opp'; oppAgents: Agents }
  | { t: 'veto'; maps: string[]; banned: { map: string; mine: boolean }[]; myTurn: boolean; deadline: number; picked?: string }
  | { t: 'start'; map: string; side: Side; myAgent: string; oppAgent: string; view: HState; deadline: number }
  | { t: 'begin'; view: HState; events: Ev[]; deadline: number }
  | { t: 'step'; actor: PI; a: StepAction; card?: string; events: Ev[]; view: HState; deadline: number }
  | { t: 'deny'; reason: string }
  | { t: 'radio'; key: string }
  | { t: 'opp_status'; online: boolean; graceUntil?: number }
  | { t: 'over'; winner: PI; reason: string; ranked: boolean; rating?: { before: number; after: number; league: string } }
  | { t: 'profile'; history: HistRow[] }
  | { t: 'top'; rows: { name: string; rating: number; games: number; wins: number; league: string }[]; season: string }
  | { t: 'sync'; phase: 'veto' | 'mull' | 'play'; view?: HState; deadline: number; map?: string; side?: Side; myAgent?: string; oppAgent?: string; mullDone?: boolean }
  | { t: 'err'; msg: string }
  | { t: 'pong'; now: number };

const swapPI = (p: PI): PI => (p === 0 ? 1 : 0);
const swapId = (id: string) => (id === 'h0' ? 'h1' : id === 'h1' ? 'h0' : id);

/** Событие глазами игрока seat (для seat 1 меняем местами 0↔1 и h0↔h1). */
export function rotateEv(e: Ev, seat: PI): Ev {
  if (seat === 0) return e;
  const o = { ...e } as Record<string, unknown>;
  if (typeof o.p === 'number') o.p = swapPI(o.p as PI);
  for (const k of ['id', 'from', 'to', 'target']) if (typeof o[k] === 'string') o[k] = swapId(o[k] as string);
  return o as Ev;
}
export function rotateAction(a: StepAction, seat: PI): StepAction {
  if (seat === 0) return a;
  const o = { ...a } as Record<string, unknown>;
  for (const k of ['from', 'to', 'target', 'id']) if (typeof o[k] === 'string') o[k] = swapId(o[k] as string);
  return o as StepAction;
}
/** Действие игрока seat из его повёрнутого вида — в настоящие индексы сервера. */
export const unrotateAction = rotateAction;   // поворот симметричен

/** Вид стола для игрока seat: повёрнут и без чужих секретов. log не передаётся (события идут отдельно). */
export function viewFor(s: HState, seat: PI): HState {
  const v = structuredClone({ ...s, log: [] }) as HState;
  if (seat === 1) {
    v.p = [v.p[1], v.p[0]];
    v.turn = swapPI(v.turn); v.first = swapPI(v.first);
    if (v.winner !== null) v.winner = swapPI(v.winner);
  }
  const en = v.p[1];
  en.hand = en.hand.map((c) => ({ uid: c.uid, id: HIDDEN }));
  en.deck = en.deck.map(() => HIDDEN);
  en.traps = en.traps.map((t) => ({ uid: t.uid, id: HIDDEN }));
  en.pool = [];
  if (en.choice) en.choice = { kind: en.choice.kind, opts: [] };
  return v;
}

/** Проверка формы действия от клиента (сервер не доверяет присланному). */
export function validAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  const str = (v: unknown) => v === undefined || (typeof v === 'string' && v.length < 40);
  const int = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);
  switch (o.k) {
    case 'play': return typeof o.uid === 'string' && str(o.uid) && str(o.target) && int(o.at, 10) && int(o.mode, 5);
    case 'save': return typeof o.id === 'string' && str(o.id);
    case 'atk': return typeof o.from === 'string' && typeof o.to === 'string' && str(o.from) && str(o.to);
    case 'power': return str(o.target);
    case 'shop': return true;
    case 'choose': return int(o.i, 5) && o.i !== undefined;
    default: return false;
  }
}
