// Ножевой раунд перед матчем: кто выиграет — выбирает сторону (T или CT), дальше одна партия.
// Простая дуэль «Удар · Блок · Финт»: оба тайно выбирают приём, потом открывают.
//   Удар бьёт Финт, Финт обходит Блок, Блок отражает Удар; одинаковые — ничья, переигрываем.
// У каждого 3 жизни. Победа приёмом — 1 урон, а своим «коньком» (он виден обоим) — 2.
// Конёк даёт глубину: его выгодно играть, но соперник это знает и может поймать.
// Модуль общий для игры с ботом и для сервера онлайна.

export type Move = 'strike' | 'block' | 'feint';
export type KP = 0 | 1;
export const MOVES: Move[] = ['strike', 'block', 'feint'];
export const MOVE_RU: Record<Move, string> = { strike: 'Удар', block: 'Блок', feint: 'Финт' };
/** Кого бьёт приём. */
export const BEATS: Record<Move, Move> = { strike: 'feint', feint: 'block', block: 'strike' };
export const KNIFE_HP = 3;

export interface KnifeRound { picks: [Move, Move]; winner: KP | null; dmg: number }
export interface KnifeState {
  hp: [number, number];
  /** «Конёк» каждого игрока: победа этим приёмом бьёт на 2. */
  fav: [Move, Move];
  round: number;
  rounds: KnifeRound[];
  winner: KP | null;
}

export function newKnife(rnd: () => number = Math.random): KnifeState {
  const pick = () => MOVES[Math.floor(rnd() * 3)];
  return { hp: [KNIFE_HP, KNIFE_HP], fav: [pick(), pick()], round: 1, rounds: [], winner: null };
}

export const isMove = (m: unknown): m is Move => m === 'strike' || m === 'block' || m === 'feint';

/** Открыть приёмы обоих. Меняет состояние и возвращает итог раунда. */
export function resolveKnife(k: KnifeState, a: Move, b: Move): KnifeRound {
  let winner: KP | null = null;
  if (BEATS[a] === b) winner = 0;
  else if (BEATS[b] === a) winner = 1;
  const dmg = winner === null ? 0 : ([a, b][winner] === k.fav[winner] ? 2 : 1);
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

/** Приём бота: чаще свой конёк, иногда — ответ на конёк соперника, иногда наугад. */
export function botKnifeMove(k: KnifeState, me: KP, rnd: () => number = Math.random): Move {
  const opp: KP = me === 0 ? 1 : 0;
  const counter = (m: Move) => MOVES.find((x) => BEATS[x] === m)!;
  const x = rnd();
  if (x < 0.34) return k.fav[me];
  if (x < 0.62) return counter(k.fav[opp]);
  // соперник может ждать нашего конька и ответить на него — тогда ловим его ответ
  if (x < 0.8) return counter(counter(k.fav[me]));
  return MOVES[Math.floor(rnd() * 3)];
}

/** Повернуть состояние «к себе» (для онлайна: у каждого игрока он сам — 0). */
export function knifeFor(k: KnifeState, seat: KP): KnifeState {
  if (seat === 0) return k;
  return {
    hp: [k.hp[1], k.hp[0]], fav: [k.fav[1], k.fav[0]], round: k.round,
    rounds: k.rounds.map((r) => ({ picks: [r.picks[1], r.picks[0]], winner: r.winner === null ? null : r.winner === 0 ? 1 : 0, dmg: r.dmg })),
    winner: k.winner === null ? null : k.winner === 0 ? 1 : 0,
  };
}
