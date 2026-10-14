// Баланс «Схватки»: бот против бота. bun scripts/hs-sim.ts 300 [diff]
import { AGENTS } from '../src/game/cards';
import { endTurn, HS, mulligan, newGame, startGame, type HState, type PI } from '../src/hs/engine';
import { botMulligan, botTurn } from '../src/hs/ai';
import { hcard, styleOf } from '../src/hs/cards';
import type { Diff } from '../src/hs/engine';

// HS='{"bombTimer":4}' — переопределить числа из HS для экспериментов
if (process.env.HS) Object.assign(HS, JSON.parse(process.env.HS));
const N = Number(process.argv[2] ?? 200);
const diff = (process.argv[3] ?? 'normal') as Diff;
const CT = AGENTS.filter((a) => a.side === 'CT').map((a) => a.id);
const T = AGENTS.filter((a) => a.side === 'T').map((a) => a.id);
let tWins = 0, turns = 0, bomb = 0, defuse = 0;
const ev: Record<string, number> = {};
const late = { n: 0, left: 0, wasted: 0, hand: 0, spent: 0, board: 0, full: 0, blocked: 0 };
let lossCash = 0, comeback = 0;
const byAgent: Record<string, [number, number]> = {};
const bySt: Record<string, [number, number]> = {};
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const ct = CT[g % CT.length], t = T[Math.floor(g / CT.length) % T.length];
  const MAPS = ['dust2', 'inferno', 'mirage', 'nuke', 'ancient', 'anubis', 'cache'];
  const s: HState = newGame([t, ct], ['T', 'CT'], MAPS[g % MAPS.length]);
  for (const p of [0, 1] as PI[]) mulligan(s, p, botMulligan(s, p));
  startGame(s);
  let guard = 0;
  while (s.winner === null && guard++ < 200) {
    const P = s.p[s.turn], m0 = P.money;
    botTurn(s, s.turn, diff);
    if (P.turns >= 8) { late.n++; late.left += P.money; late.wasted += Math.max(0, P.money - HS.carry); late.hand += P.hand.length; late.spent += m0 - P.money; late.board += P.board.length; if (P.board.length >= HS.board) late.full++; if (P.hand.some((c) => !c.free && hcard(c.id).cost > P.money && (hcard(c.id).kind !== 'unit' || P.board.length < HS.board))) late.blocked++; }
    if (s.winner === null) endTurn(s);
  }
  if (s.log.some((e) => e.t === 'defused')) defuse++;
  const tWin = s.winner === 0;
  if (tWin) tWins++;
  if (s.reason === 'bomb') bomb++;
  turns += s.turnNo;
  { const a = styleOf(t), b = styleOf(ct); const k1 = `${a}>${b}`, k2 = `${b}>${a}`; (bySt[k1] ??= [0, 0])[0]++; if (tWin) bySt[k1][1]++; (bySt[k2] ??= [0, 0])[0]++; if (!tWin) bySt[k2][1]++; }
  for (const [id, w] of [[t, tWin], [ct, !tWin]] as const) { const a = (byAgent[id] ??= [0, 0]); a[0]++; if (w) a[1]++; }
  { // камбэк: победил тот, кто в какой-то момент отставал на 10+
    const behind = [false, false];
    let h = [40, 40];
    for (const e of s.log) { if (e.t === 'dmg' && (e.id === 'h0' || e.id === 'h1')) { const i = e.id === 'h0' ? 0 : 1; h[i] -= e.n; if (h[1 - i] - h[i] >= 10) behind[i] = true; } if (e.t === 'cash' && e.loss) lossCash += e.n; }
    if (s.winner !== null && behind[s.winner]) comeback++;
  }
  for (const e of s.log) { const k = e.t === 'dmg' ? (e.bonus ? 'dmg_counter' : e.blocked ? 'dmg_armor' : 'dmg') : e.t === 'trap' ? 'trap_' + e.card : e.t; ev[k] = (ev[k] ?? 0) + 1; }
  s.log = [];
}
console.log(`games ${N} · T win ${(100 * tWins / N).toFixed(1)}% · bomb wins ${(100 * bomb / N).toFixed(1)}% · ходов (полу) ${(turns / N).toFixed(1)} · ${((Date.now() - t0) / N).toFixed(0)}ms/игра`);
for (const [id, [n, w]] of Object.entries(byAgent)) console.log(id.padEnd(12), `${(100 * w / n).toFixed(0)}%`, `(${n})`);
console.log('за игру:', Object.entries(ev).filter(([k]) => /trap|trophy|vet|counter|fizzle|defused|boom|shop|entry|mark|clutch|save/.test(k)).map(([k, n]) => `${k} ${(n / N).toFixed(2)}`).join(' · '));
if (late.n) console.log(`поздние ходы (8+): потрачено $${Math.round(late.spent / late.n)} · осталось $${Math.round(late.left / late.n)} · сгорело $${Math.round(late.wasted / late.n)} · карт в руке после хода ${(late.hand / late.n).toFixed(1)} · бойцов на столе ${(late.board / late.n).toFixed(1)} · полный стол ${(late.full / late.n * 100).toFixed(0)}% · не хватило денег ${(late.blocked / late.n * 100).toFixed(0)}% · доля таких ходов ${(late.n / turns * 100).toFixed(0)}%`);
console.log(`бонус за отставание: $${Math.round(lossCash / N)} за игру · камбэков (победил, отставая на 10+): ${(comeback / N * 100).toFixed(0)}%`);
console.log('стиль против стиля:', Object.entries(bySt).filter(([k]) => k.split('>')[0] !== k.split('>')[1]).sort().map(([k, [n, w]]) => `${k} ${(100 * w / n).toFixed(0)}% (${n})`).join(' · '));
