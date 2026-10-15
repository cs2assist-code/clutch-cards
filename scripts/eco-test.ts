// Проверка эко-раунда: игрок 0 (сторона SIDE) намеренно пропускает ходы TURNS эко-раундом (PICK) — как меняется его винрейт.
//   SIDE=T TURNS=1 PICK=cash bun scripts/eco-test.ts 2000
import { AGENTS } from '../src/game/cards';
import { choose, eco, HS, mulligan, newGame, startGame, type EcoPick } from '../src/hs/engine';
import { botEnd, botMulligan, botTurn } from '../src/hs/ai';
if (process.env.HS) Object.assign(HS, JSON.parse(process.env.HS));
const N = Number(process.argv[2] ?? 1000), SIDE = (process.env.SIDE ?? 'T') as 'T' | 'CT';
const TURNS = new Set((process.env.TURNS ?? '').split(',').filter(Boolean).map(Number)), PICK = (process.env.PICK ?? 'cash') as EcoPick;
const T = AGENTS.filter((a) => a.side === 'T').map((a) => a.id), CT = AGENTS.filter((a) => a.side === 'CT').map((a) => a.id);
let wins = 0;
for (let g = 0; g < N; g++) {
  const mine = SIDE === 'T' ? T[g % 5] : CT[g % 5], theirs = SIDE === 'T' ? CT[(g / 5 | 0) % 5] : T[(g / 5 | 0) % 5];
  const s = newGame([mine, theirs], [SIDE, SIDE === 'T' ? 'CT' : 'T'], 'dust2');
  for (const p of [0, 1] as const) mulligan(s, p, botMulligan(s, p));
  startGame(s);
  let guard = 0;
  while (s.winner === null && guard++ < 200) {
    const p = s.turn;
    if (p === 0 && TURNS.has(s.p[0].turns)) { if (s.p[0].choice) choose(s, 0, 0); eco(s, 0, PICK); continue; }
    botTurn(s, p, 'normal'); if (s.winner === null) botEnd(s, p);
  }
  if (s.winner === 0) wins++;
}
console.log(`${SIDE} эко на ходах [${[...TURNS]}] (${PICK}): победы ${(100 * wins / N).toFixed(1)}%`);
