// Ножевой раунд перед матчем: кто выиграет — выбирает сторону (T или CT), дальше одна партия.
// Дуэль «Нож · Щит · Zeus»: оба тайно выбирают приём, потом открывают.
//   Нож бьёт Zeus, Zeus бьёт Щит, Щит бьёт Нож; одинаковые — ничья, переигрываем.
// У каждого 3 жизни, любая победа в обмене снимает одну.
// Модуль общий для игры с ботом и для сервера онлайна.

export type Move = 'knife' | 'shield' | 'zeus';
export type KP = 0 | 1;
export const MOVES: Move[] = ['knife', 'shield', 'zeus'];
export const MOVE_RU: Record<Move, string> = { knife: 'Нож', shield: 'Щит', zeus: 'Zeus' };
/** Кого бьёт приём. */
export const BEATS: Record<Move, Move> = { knife: 'zeus', zeus: 'shield', shield: 'knife' };
export const KNIFE_HP = 3;

export interface KnifeRound { picks: [Move, Move]; winner: KP | null; dmg: number }
export interface KnifeState {
  hp: [number, number];
  round: number;
  rounds: KnifeRound[];
  winner: KP | null;
}

export function newKnife(): KnifeState {
  return { hp: [KNIFE_HP, KNIFE_HP], round: 1, rounds: [], winner: null };
}

export const isMove = (m: unknown): m is Move => m === 'knife' || m === 'shield' || m === 'zeus';

/** Открыть приёмы обоих. Меняет состояние и возвращает итог раунда. */
export function resolveKnife(k: KnifeState, a: Move, b: Move): KnifeRound {
  let winner: KP | null = null;
  if (BEATS[a] === b) winner = 0;
  else if (BEATS[b] === a) winner = 1;
  const dmg = winner === null ? 0 : 1;
  if (winner !== null) {
    const loser: KP = winner === 0 ? 1 : 0;
    k.hp[loser] = Math.max(0, k.hp[loser] - dmg);
    if (k.hp[loser] === 0) k.winner = winner;
  }
  const r: KnifeRound = { picks: [a, b], winner, dmg };
  k.rounds.push(r);
  k.round++;
  return r;
}

/** Приём бота: иногда отвечает на прошлый приём соперника или повторяет свой выигрышный, иначе наугад. */
export function botKnifeMove(k: KnifeState, me: KP, rnd: () => number = Math.random): Move {
  const opp: KP = me === 0 ? 1 : 0;
  const last = k.rounds[k.rounds.length - 1];
  const counter = (m: Move) => MOVES.find((x) => BEATS[x] === m)!;
  const x = rnd();
  if (last && x < 0.3) return counter(last.picks[opp]);          // люди часто повторяют прошлый приём
  if (last && last.winner === me && x < 0.45) return last.picks[me];
  return MOVES[Math.floor(rnd() * 3)];
}

/** Повернуть состояние «к себе» (для онлайна: у каждого игрока он сам — 0). */
export function knifeFor(k: KnifeState, seat: KP): KnifeState {
  if (seat === 0) return k;
  return {
    hp: [k.hp[1], k.hp[0]], round: k.round,
    rounds: k.rounds.map((r) => ({ picks: [r.picks[1], r.picks[0]], winner: r.winner === null ? null : r.winner === 0 ? 1 : 0, dmg: r.dmg })),
    winner: k.winner === null ? null : k.winner === 0 ? 1 : 0,
  };
}
