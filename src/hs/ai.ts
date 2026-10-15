// Бот «Схватки»: перебирает все доступные действия, проигрывает каждое на копии стола
// и делает лучшее по оценке позиции. Нет действия лучше текущей позиции — конец хода.
import { COUNTER, hcard } from './cards';
import {
  attack, attackTargets, canAttack, canSave, canShop, choose, clsOf, isCovered, save, shop, foe, heroId, HS, playCard, playTargets, powerTargets, rand, usePower,
  type Diff, type HState, type HUnit, type PI,
} from './engine';

export type Action =
  | { k: 'play'; uid: string; target?: string; at?: number; mode?: number }
  | { k: 'save'; id: string }
  | { k: 'atk'; from: string; to: string }
  | { k: 'power'; target?: string }
  | { k: 'shop' }
  | { k: 'choose'; i: number };

export function legalActions(s: HState, p: PI): Action[] {
  const out: Action[] = [];
  const P = s.p[p];
  const seen = new Set<string>();
  for (const c of P.hand) {
    const key = `${c.id}:${!!c.free}`;
    if (seen.has(key)) continue;           // одинаковые карты перебираем один раз
    seen.add(key);
    const t = playTargets(s, p, c.id, !!c.free);
    if (!t) continue;
    const def = hcard(c.id);
    // Куда поставить: в край, в начало и рядом с каждым укрытием
    const n = P.board.length;
    const spots = def.kind === 'unit' || def.kind === 'bomb'
      ? [...new Set([n, 0, ...P.board.flatMap((u, i) => (u.kw.includes('taunt') || u.card === 'c4' || def.kind === 'bomb' ? [i, i + 1] : []))])] : [undefined];
    const modes = def.modes ? def.modes.map((_, i) => i) : [undefined];
    const targets: (string | undefined)[] = !t.length ? [undefined] : [...t, ...(def.bcOptional ? [undefined] : [])];
    for (const at of spots) for (const mode of modes) for (const target of targets) out.push({ k: 'play', uid: c.uid, target, at, mode });
  }
  for (const u of P.board) if (canSave(s, p, u.uid)) out.push({ k: 'save', id: u.uid });
  const pt = powerTargets(s, p);
  if (pt) { if (!pt.length) out.push({ k: 'power' }); else for (const x of pt) out.push({ k: 'power', target: x }); }
  for (const id of [heroId(p), ...P.board.map((u) => u.uid)]) {
    if (!canAttack(s, p, id)) continue;
    for (const to of attackTargets(s, p, id)) out.push({ k: 'atk', from: id, to });
  }
  return out;
}

export function apply(s: HState, p: PI, a: Action): boolean {
  if (a.k === 'play') return playCard(s, p, a.uid, a.target, a.at, a.mode);
  if (a.k === 'save') return save(s, p, a.id);
  if (a.k === 'power') return usePower(s, p, a.target);
  if (a.k === 'shop') return shop(s, p);
  if (a.k === 'choose') return choose(s, p, a.i);
  return attack(s, p, a.from, a.to);
}

/** Сколько стоит боец с учётом того, против кого он стоит (контр-классы). */
function unitVal(u: HUnit, foes: HUnit[], board: HUnit[] = []): number {
  if (u.card === 'c4') return 0; // учитывается отдельно
  let v = u.atk * 1.1 + u.hp * 0.9 + 0.5 + u.armor * 1.2;
  const cls = clsOf(u);
  for (const f of foes) {
    if (f.card === 'c4') continue;
    v += (COUNTER[cls]?.[clsOf(f)] ?? 0) * 0.35;        // я сильнее этого врага
    v -= (COUNTER[clsOf(f)]?.[cls] ?? 0) * 0.35;        // этот враг сильнее меня
  }
  if (u.kw.includes('vet')) v += 0.5;
  // за укрытием ценные бойцы в безопасности от снайперов, помеченные «Трейдом» — под угрозой
  if (board.length && !u.kw.includes('taunt') && isCovered(board, u) && foes.some((f) => f.kw.includes('sniper'))) v += 0.8 + u.atk * 0.15;
  if (u.marked) v -= 1;
  const k = u.kw;
  if (k.includes('taunt')) v += 1 + u.hp * 0.2;
  if (k.includes('stealth')) v += 1;
  if (k.includes('twice')) v += u.atk * 0.8;
  if (k.includes('headshot')) v += 2;
  if (k.includes('sniper')) v += 1.5;
  if (k.includes('cleave')) v += 1;
  if (k.includes('suppress')) v += 1;
  if (k.includes('helmet')) v += 0.5;
  if (u.blind) v -= u.atk * 0.5;
  if (u.temp) v -= u.temp * 1.1;
  return v;
}
const heroVal = (hp: number, armor: number) => { const e = hp + armor; return e - (e <= 10 ? (10 - e) * 1.5 : 0); };

/** Оценка позиции с точки зрения игрока p. */
export function evaluate(s: HState, p: PI): number {
  if (s.winner !== null) return s.winner === p ? 1e6 : -1e6;
  const me = s.p[p], en = s.p[foe(p)];
  let v = heroVal(me.hero.hp, me.hero.armor) - heroVal(en.hero.hp, en.hero.armor);
  v += me.board.reduce((a, u) => a + unitVal(u, en.board, me.board), 0);
  v -= en.board.reduce((a, u) => a + unitVal(u, me.board, en.board), 0);
  v += (me.traps.length - en.traps.length) * 1.8;
  v += (me.hand.length - en.hand.length) * 0.6;
  v += Math.min(me.money, HS.carry) / 1000 * 0.15 + me.bonus / 1000 * 0.8;
  // Бомба: чем ближе взрыв, тем ценнее для T и страшнее для CT
  const bombOf = (P: typeof me) => P.board.find((u) => u.card === 'c4');
  const mb = bombOf(me), eb = bombOf(en);
  if (mb) v += 6 + (HS.bombTimer - mb.bomb) * 6 + mb.hp;
  if (eb) v -= 6 + (HS.bombTimer - eb.bomb) * 6 + eb.hp;
  return v;
}

const NOISE: Record<Diff, number> = { easy: 4, normal: 1.6, hard: 0 };

/** Следующее действие бота или null — заканчивать ход. */
export function botStep(s: HState, p: PI, diff: Diff): Action | null {
  const ch = s.p[p].choice;
  if (ch) {
    let bi = 0, bv = -Infinity;
    ch.opts.forEach((id, i) => { const v = cardScore(s, p, id) + (rand() - 0.5) * NOISE[diff]; if (v > bv) { bv = v; bi = i; } });
    return { k: 'choose', i: bi };
  }
  const base = evaluate(s, p);
  let best: Action | null = null, bestV = base + 0.05;
  for (const a of legalActions(s, p)) {
    const c = structuredClone(s);
    c.log = [];
    c.p[foe(p)].traps = c.p[foe(p)].traps.map((t) => ({ ...t, id: 'unknown' }));   // бот не подглядывает в засады
    if (!apply(c, p, a)) continue;
    let v = evaluate(c, p);
    // «Дроп» сам по себе ничего не даёт — смотрим, что он позволит купить
    if (a.k === 'play' && s.p[p].hand.find((x) => x.uid === a.uid)?.id === 'drop') {
      let nb = -Infinity;
      for (const b of legalActions(c, p)) {
        if (b.k === 'atk') continue;
        const c2 = structuredClone(c); c2.log = [];
        if (apply(c2, p, b) && !(b.k === 'play' && c.p[p].hand.find((x) => x.uid === b.uid)?.id === 'drop')) nb = Math.max(nb, evaluate(c2, p));
      }
      // играем, только если без него лучшая покупка недоступна
      v = nb - 0.3;
    }
    // «Сложный» смотрит на шаг дальше: чего стоит это действие вместе с лучшим следующим
    if (diff === 'hard' && v < 1e5 && c.winner === null && c.turn === p) {
      let nb = v;
      for (const b of legalActions(c, p)) {
        const c2 = structuredClone(c); c2.log = [];
        if (apply(c2, p, b)) nb = Math.max(nb, evaluate(c2, p));
      }
      v = v * 0.4 + nb * 0.6;
    }
    if (v < 1e5) v += (rand() - 0.5) * NOISE[diff];
    if (v > bestV) { bestV = v; best = a; }
  }
  // Новичок иногда просто заканчивает ход раньше времени
  if (best && diff === 'easy' && rand() < 0.2 && bestV < 1e5) return null;
  // Делать больше нечего — докупить карту в бай-меню, если рука почти пуста
  if (!best && canShop(s, p) && s.p[p].hand.length <= 3 && diff !== 'easy') return { k: 'shop' };
  return best;
}

/** Замена стартовых карт: дороже $4000 — в колоду. */
export function botMulligan(s: HState, p: PI): string[] {
  return s.p[p].hand.filter((c) => hcard(c.id).cost > 4000).map((c) => c.uid);
}

/** Целиком сыграть ход бота (для симуляций). */
export function botTurn(s: HState, p: PI, diff: Diff) {
  for (let i = 0; i < 40 && s.winner === null && s.turn === p; i++) {
    const a = botStep(s, p, diff);
    if (!a) break;
    apply(s, p, a);
  }
}

/** Насколько карта нужна прямо сейчас — для выбора при доборе и в бай-меню. */
export function cardScore(s: HState, p: PI, id: string): number {
  const c = hcard(id), me = s.p[p], en = s.p[foe(p)];
  const foes = en.board.filter((u) => u.card !== 'c4');
  const nextMoney = Math.min(HS.maxMoney, me.money + HS.income + 2000);
  let v = 0;
  if (c.kind === 'unit') {
    v = (c.atk ?? 0) * 1.1 + (c.hp ?? 0) * 0.9 + (c.armor ?? 0) * 1.2;
    const k = c.kw ?? [];
    if (k.includes('taunt')) v += 1; if (k.includes('stealth')) v += 1; if (k.includes('twice')) v += (c.atk ?? 0) * 0.8;
    if (k.includes('headshot')) v += 2; if (k.includes('sniper')) v += 1.5; if (k.includes('rush')) v += 1; if (k.includes('cleave')) v += 1;
    for (const f of foes) v += ((COUNTER[c.cls]?.[clsOf(f)] ?? 0) - (COUNTER[clsOf(f)]?.[c.cls] ?? 0)) * 0.6;
    v -= c.cost / 1000 * 1.2;
    if (me.board.length >= HS.board) v -= 3;
  } else {
    const bomb = en.board.some((u) => u.card === 'c4');
    const big = foes.filter((u) => u.kw.includes('sniper') || clsOf(u) === 'heavy').length;
    const table: Record<string, number> = {
      he: foes.length * 1.5 - 1, molotov: foes.length ? 2.5 : 0, incendiary: foes.length ? 2.5 : 0, flash: foes.length ? 1.8 : 0.3,
      smoke: big ? 2.5 : 0, zeus: foes.length ? 2 : 0.5, kevlar: me.board.length ? 1.5 : 0.5, helmet: me.board.length ? 1.8 : 0.5,
      medkit: me.hero.hp < 18 ? 2.5 : 0.6, boost: me.board.length ? 1.5 : 0.4, kit: bomb ? 6 : 1.5, c4: me.board.some((u) => u.card === 'c4') ? 0 : 4.5,
      drop: 0.8, angle: 2.2, wire: 1.8, fake: 1.6, ninja: 1.5, backup: 2, gu_mines: 2.2,
      sw_armor: me.board.length * 1.2, se_long: big ? 4 : foes.length ? 2.5 : 0.5, fb_intel: 2 + en.traps.length * 1.5, sa_breach: foes.length * 1.2,
      gi_shield: me.board.length ? 2.5 : 0.5, ph_fast: me.board.some((u) => u.card === 'c4') ? 4 : 1.5, el_rush: me.board.length * 0.9,
      ba_wall: foes.length * 1.4, pr_contract: 1.8,
    };
    v = table[id] ?? 1.5;
  }
  if (c.cost > nextMoney) v -= 2.5;
  return v;
}
