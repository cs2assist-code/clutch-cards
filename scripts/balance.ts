// Полный прогон баланса: бот против бота, каждая пара агентов T × CT на всех картах.
//   bun scripts/balance.ts <игр на пару> <часть> <частей> [сложность T] [сложность CT] > out.jsonl
// Пишет по строке JSON на игру; сводку считает scripts/balance-report.py.
import { AGENTS, MAPS } from '../src/game/cards';
import { endTurn, HS, mulligan, newGame, startGame, type Diff, type HState, type PI } from '../src/hs/engine';
import { botEnd, botMulligan, botTurn } from '../src/hs/ai';

if (process.env.HS) Object.assign(HS, JSON.parse(process.env.HS));
const N = Number(process.argv[2] ?? 20), part = Number(process.argv[3] ?? 0), parts = Number(process.argv[4] ?? 1);
const dT = (process.argv[5] ?? 'normal') as Diff, dCT = (process.argv[6] ?? 'normal') as Diff;
const T = AGENTS.filter((a) => a.side === 'T').map((a) => a.id), CT = AGENTS.filter((a) => a.side === 'CT').map((a) => a.id);
const maps = MAPS.map((m) => m.id);
let k = 0;
for (const t of T) for (const ct of CT) for (let i = 0; i < N; i++, k++) {
  if (k % parts !== part) continue;
  const map = maps[k % maps.length];
  const s: HState = newGame([t, ct], ['T', 'CT'], map);
  for (const p of [0, 1] as PI[]) mulligan(s, p, botMulligan(s, p));
  startGame(s);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  const hp: number[] = [];
  let guard = 0;
  while (s.winner === null && guard++ < 200) {
    botTurn(s, s.turn, s.turn === 0 ? dT : dCT);
    for (const e of s.log) if (e.t === 'play') played[e.p].add(e.card);
    s.log = [];
    if (s.winner === null) botEnd(s, s.turn);
    for (const e of s.log) if (e.t === 'play') played[e.p].add(e.card);
    s.log = [];
  }
  hp.push(s.p[0].hero.hp, s.p[1].hero.hp);
  console.log(JSON.stringify({ t, ct, map, w: s.winner, r: s.reason, turns: s.turnNo, kills: [s.p[0].kills, s.p[1].kills], hp, cards: [[...played[0]], [...played[1]]] }));
}
