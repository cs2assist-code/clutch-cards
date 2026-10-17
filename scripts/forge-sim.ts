// Калибровка цен своих карт: бот против бота, у одной стороны в колоде 2 копии случайной своей карты.
// Если цена по пунктам верная, своя карта не должна заметно менять шансы стороны (сравнение с партиями без неё).
//   bun scripts/forge-sim.ts <партий> [доля_своих=0.5] [PRICE_PER_PT]      (HS='{...}' — как в hs-sim)
import { AGENTS, MAPS } from '../src/game/cards';
import { agentDeck, DECK_SIZE } from '../src/hs/cards';
import { HS, mulligan, newGame, rand, startGame, type HState, type PI } from '../src/hs/engine';
import { botEnd, botMulligan, botTurn } from '../src/hs/ai';
import * as F from '../src/hs/forge';

if (process.env.HS) Object.assign(HS, JSON.parse(process.env.HS));
const N = Number(process.argv[2] ?? 2000), SHARE = Number(process.argv[3] ?? 0.5);
if (process.argv[4]) F.setPricePerPt(Number(process.argv[4]));
const T = AGENTS.filter((a) => a.side === 'T').map((a) => a.id), CT = AGENTS.filter((a) => a.side === 'CT').map((a) => a.id);
const pick = <X,>(a: readonly X[]) => a[Math.floor(rand() * a.length)];

function randomSpec(): F.CustomSpec {
  for (;;) {
    const base = pick(Object.keys(F.BASES) as F.BaseId[]);
    const kw: F.CustomSpec['kw'] = [];
    const nk = Math.floor(rand() * 3);
    for (let i = 0; i < nk; i++) { const k = pick(F.FORGE_KW); if (!kw.includes(k)) kw.push(k); }
    const s: F.CustomSpec = { name: 'Тест', base, atk: 1 + Math.floor(rand() * 8), hp: 2 + Math.floor(rand() * 15), armor: rand() < 0.25 ? 1 : 0, kw, art: F.BASES[base].arts[0] };
    while (F.pointsOf(s) > F.FORGE_BUDGET && (s.atk > 1 || s.hp > 2)) { if (s.atk > 1 && (rand() < 0.5 || s.hp <= 2)) s.atk--; else s.hp--; }
    if (F.validSpec(s)) return s;
  }
}

const band = (p: number) => (p < 2500 ? '$1–2K' : p < 4500 ? '$2.5–4K' : '$4.5–7K');
const stat: Record<string, [number, number]> = {};   // ключ → [игр, побед стороны со своей картой]
const add = (k: string, win: boolean) => { const v = stat[k] ?? (stat[k] = [0, 0]); v[0]++; if (win) v[1]++; };
let baseT = [0, 0];
for (let g = 0; g < N; g++) {
  const t = pick(T), ct = pick(CT), map = pick(MAPS).id;
  const custom = rand() < SHARE;
  const side: PI = rand() < 0.5 ? 0 : 1;   // 0 — T, 1 — CT
  const decks: [string[] | null, string[] | null] = [null, null];
  let spec: F.CustomSpec | null = null;
  if (custom) {
    spec = randomSpec();
    const c = F.toHCard(spec);
    F.registerCustoms([spec]);
    const d = agentDeck(side === 0 ? t : ct, rand).slice(0, DECK_SIZE);
    // заменить 2 случайные карты своей (кроме обязательных)
    for (let k = 0; k < 2; k++) { let i = Math.floor(rand() * d.length); while (d[i].startsWith('cc_')) i = (i + 1) % d.length; d[i] = c.id; }
    decks[side] = d;
  }
  const s: HState = newGame([t, ct], ['T', 'CT'], map, decks);
  for (const p of [0, 1] as PI[]) mulligan(s, p, botMulligan(s, p));
  startGame(s);
  let guard = 0;
  while (s.winner === null && guard++ < 200) { botTurn(s, s.turn, 'normal'); s.log = []; if (s.winner === null) botEnd(s, s.turn); s.log = []; }
  if (!custom) { baseT[0]++; if (s.winner === 0) baseT[1]++; continue; }
  const win = s.winner === side, price = F.priceOf(spec!);
  const sideName = side === 0 ? 'T' : 'CT';
  add(`all ${sideName}`, win); add(`цена ${band(price)} ${sideName}`, win); add(`основа ${spec!.base}`, win);
  for (const k of spec!.kw) add(`свойство ${k}`, win);
  add(`атака ${spec!.atk >= 6 ? '6+' : spec!.atk >= 4 ? '4-5' : '1-3'}`, win);
}
const pct = (v: [number, number]) => `${(100 * v[1] / v[0]).toFixed(1)}% (${v[0]})`;
console.log(`без своих карт: T ${pct(baseT as [number, number])}, PRICE_PER_PT=${F.PRICE_PER_PT}`);
for (const k of Object.keys(stat).sort()) console.log(k.padEnd(24), pct(stat[k]));
