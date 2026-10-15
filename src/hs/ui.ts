// Интерфейс режима «Схватка»: настройка → замена карт → бой картами (Bo3, смена сторон).
import { AGENTS, agent, backImg, boardImg, MAPS, mapDef } from '../game/cards';
import type { Side } from '../game/types';
import { agentArt, cssUrl, esc } from '../art';
import * as fx from '../fx';
import { c4, preloadShots, sample, sfx, weaponShot } from '../sound';
import { preloadVoice, say, setSubtitle, type VoKey } from '../voice';
import { track } from '../analytics';
import { recordRound, recordRoundsMatch, markTutorialDone } from '../stats';
import { SIL } from './art-index';
import { BEATS, botKnifeMove, KNIFE_HP, MOVE_RU, MOVES, newKnife, resolveKnife, type KnifeRound, type KnifeState, type Move } from './knife';
import { CLASS_RU, HCARDS, hcard, hImg, unitArt, KW_RU, MAP_RULES, matchup, POWERS, sigCards, STYLE_BEATS, STYLE_RU, styleOf, type HCard, type KW, type Style } from './cards';
import {
  attackTargets, attackBonus, canAttack, canSave, canShop, costOf, isClutch, isCovered, shopPrice, isBehind, lossBonus, maxHp, endTurn, canEco, eco, type EcoPick, findUnit, heroId, HS, incomeOf, KILL_REWARD, bombGuarded, mulligan, newGame, playTargets, powerTargets, startGame,
  type Diff, type Ev, type HState, type HUnit, type PI,
} from './engine';
import { apply, botEnd, botMulligan, botStep, legalActions, type Action } from './ai';
import { boardEmblem, boardScene, boardVars } from './boards';
import * as net from '../online/client';
import { LEVELS, levelOf, prizePlaces, type HistRow, type PeerRow, type PlayerInfo, type S2C, type SeasonPrizes } from '../online/protocol';
import { haptic } from '../telegram';
import { questBump, type QuestDef, type QuestKind } from '../quests';
import { shareResult } from '../share';

type Phase = 'rating' | 'setup' | 'knife' | 'sidepick' | 'mull' | 'play' | 'gameover' | 'over' | 'cards' | 'rules' | 'lobby' | 'veto' | 'top' | 'player';
type Sel = null | { k: 'hand'; uid: string } | { k: 'atk'; id: string } | { k: 'power' };
interface GameRes { win: boolean; reason: HState['reason']; side: Side; turns: number }
const S = {
  phase: 'setup' as Phase,
  setup: { side: 'T' as Side, CT: 'ct_swat', T: 't_phoenix', diff: 'normal' as Diff },
  /** Сторона в этой партии против бота — её решает ножевой раунд. */
  side: 'T' as Side,
  /** Ножевой раунд: дуэль, выбранный приём, открытый итог, агенты бота на обе стороны. */
  knife: null as null | { k: KnifeState; pick: Move | null; reveal: KnifeRound | null; bot: { T: string; CT: string }; botSide?: Side; online?: { oppPicked: boolean; pick?: 'me' | 'opp'; deadline: number; sideSent?: boolean } },
  s: null as HState | null,
  score: [0, 0] as [number, number],
  game: 1,
  map: 'dust2',
  botAgent: '',
  mull: new Set<string>(),
  sel: null as Sel,
  info: null as string | null,
  help: false,
  busy: false,
  results: [] as GameRes[],
  /** Розыгрыш карты по шагам: режим → место → цель. */
  pend: { go: false, mode: undefined as number | undefined, at: undefined as number | undefined },
  journal: [] as { sep?: boolean; text: string }[],
  showLog: false,
  last: '',
  /** Онлайн-матч (null — игра с ботом). */
  on: null as null | OnlineMatch,
  lobby: { me: null as PlayerInfo | null, season: '', queued: false, qsize: 0, range: null as null | { lo: number; hi: number; since: number }, history: null as HistRow[] | null, duel: null as string | null, err: '', top: [] as { id?: string; name: string; rating: number; games: number; wins: number; league: string }[], prizes: undefined as SeasonPrizes | undefined, pendingJoin: null as string | null, copied: false,
    friends: null as PeerRow[] | null, recent: [] as PeerRow[], player: null as Extract<S2C, { t: 'player' }> | null, playerFrom: 'rating' as Phase,
    invite: null as null | { code: string; from: { id: string; name: string; rating: number } }, invNote: '', rematch: '' as '' | 'wait' | 'offer' | 'gone', agentsOpen: false },
  radioOpen: false,
  pvMore: false,   // в превью карты показаны подробности (классы, броня, расшифровка свойств)
  /** Обучающий матч: какие подсказки уже показаны. */
  tut: null as null | TutState,
};
interface OnlineMatch {
  ranked: boolean; opp: { id?: string; name: string; rating: number; league: string };
  side: Side; myAgent: string; oppAgent: string; deadline: number;
  oppOnline: boolean; graceUntil?: number;
  veto?: Extract<S2C, { t: 'veto' }>; picked?: string;
  mullSent: boolean; confirmResign: boolean;
  result?: Extract<S2C, { t: 'over' }>;
}

let hooks = { render: () => {}, menu: () => {}, root: document.body as HTMLElement, onMenu: () => false, enter: () => {} };
export function hsInit(h: typeof hooks) { hooks = h; setupDrag(); }
const FAST = location.hash.includes('fast');
const wait = (ms: number) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
/** Деньги в тысячах, через запятую: 5300 → «$5,3», 600 → «$0,6». */
const kilo = (n: number) => (n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const money = (n: number) => '$' + kilo(n);
const DIFF_RU: Record<Diff, string> = { easy: 'Новичок', normal: 'Обычный', hard: 'Сложный' };
const other = (x: Side): Side => (x === 'T' ? 'CT' : 'T');
const mySide = () => (S.on ? S.on.side : S.side);

// ─────────────────────────── Ход матча ───────────────────────────
export function hsOpen(page: 'setup' | 'cards' | 'rules' | 'lobby' | 'rating' = 'setup') {
  if (page === 'lobby') { openLobby(); return; }
  if (page === 'rating') { openLobby('rating'); return; }
  S.phase = page; S.s = null; S.on = null; S.info = null; hooks.render();
}

/** Веер из трёх карт для главного меню. */
export function hsFanHTML(): string {
  return `<div class="fan hsfan">${['ak47', 'awp', 'm4a1s'].map((id) => `<div class="hc big f-${hcard(id).side}">${cardFace(hcard(id))}</div>`).join('')}</div>`;
}

function startMatch() {
  S.on = null;
  S.score = [0, 0]; S.game = 1; S.results = [];
  S.journal = [];
  track('hs_start', { diff: S.setup.diff, side: S.side, ct: S.setup.CT, t: S.setup.T, tut: !!S.tut });
  newRound();
}
function newRound() {
  const side = mySide();
  const pool = AGENTS.filter((a) => a.side === other(side));
  S.botAgent = S.tut ? 'ct_swat' : S.knife?.bot[other(side)] ?? pool[Math.floor(Math.random() * pool.length)].id;
  // #map=ancient в адресе — принудительно выбрать карту (для проверки оформления)
  const forced = location.hash.match(/map=(\w+)/)?.[1];
  S.map = S.tut ? 'dust2' : forced && MAPS.some((m) => m.id === forced) ? forced : MAPS[Math.floor(Math.random() * MAPS.length)].id;
  S.s = newGame([S.setup[side], S.botAgent], [side, other(side)], S.map);
  if (S.tut) tutorialDeal(S.s);
  S.journal.push({ sep: true, text: `Матч · ${mapDef(S.map).name}: ${MAP_RULES[S.map] ?? ''}` });
  mulligan(S.s, 1, botMulligan(S.s, 1));
  S.mull = new Set(); S.sel = null; S.info = null; S.busy = false;
  S.phase = 'mull';
  hooks.render();
}
async function confirmMulligan() {
  const s = S.s!;
  if (S.on) { if (!S.on.mullSent) { S.on.mullSent = true; net.send({ t: 'mull', uids: [...S.mull] }); } hooks.render(); return; }
  mulligan(s, 0, [...S.mull]);
  startGame(s);
  S.phase = 'play';
  turnKills = [0, 0]; clutchShown = [false, false]; hsHit = new Set(); kctx = null;
  preloadVoice(); preloadShots();
  setTimeout(() => speak('go', 0), 500);
  const evs = drain();
  logEvents(evs, s.turn);
  hooks.render();
  await playEvents(evs, new Map(), 0);
  if (s.turn === 1) await botTurn();
}

const drain = () => { const e = S.s!.log; S.s!.log = []; return e; };

// ─────────────────────────── Рация, килфид, бомба ───────────────────────────
/** Короткое имя агента для радио и килфида: «Phoenix», «SWAT», «Партизан». */
const shortName = (id: string) => { const n = agent(id).name; return n.match(/[A-Za-z][\w-]*(?: Crew)?$/)?.[0] ?? n; };
setSubtitle((who, text, side) => fx.radio(esc(who), esc(text), side, hooks.root.querySelector('.hs-board.b0')?.getBoundingClientRect()));
function speak(key: VoKey, p: PI | 'hq') {
  const s = S.s; if (!s) return;
  if (p === 'hq') { say(key, 'Радио', mySide(), true); return; }
  const h = s.p[p].hero;
  say(key, shortName(h.agent), h.side, p === 0, h.agent);
}
// Значки килфида как в CS2: голова с прицелом — хедшот, пуля сквозь стену — прострел
const HS_ICON = '<svg class="kf-hs" viewBox="0 0 24 24" aria-label="хедшот"><path d="M12 3.2a6.3 6.3 0 0 0-6.3 6.3c0 2.2 1.1 3.6 2.3 4.6V17h8v-2.9c1.2-1 2.3-2.4 2.3-4.6A6.3 6.3 0 0 0 12 3.2zM9.6 9.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm4.8 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM9 18h6v2.6H9z"/><path d="M12 .6v2.4M12 21v2.4M.6 12H3M21 12h2.4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
const WB_ICON = '<svg class="kf-wb" viewBox="0 0 24 24" aria-label="прострел"><path d="M9 3h5v18H9z" opacity=".55"/><path d="M1 11h5l2 1-2 1H1zM15.5 11.2h4.5l3 .8-3 .8h-4.5z"/><path d="M10 7l2.5 1.5M10 15l2.5 1.5M11 10.5h2" stroke="#0b0d10" stroke-width="1.2"/></svg>';
/** Силуэт оружия/предмета из CS2 (public/img/sil_<id>.webp) — для килфида и значков классов. */
function silHTML(id: string, cls = 'sil'): string {
  if (!SIL.has(id)) return '';
  const u = (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[`sil_${id}`] ?? `img/sil_${id}.webp`;
  return `<i class="${cls}" style="--m:url('${esc(cssUrl(u))}')" aria-hidden="true"></i>`;
}
const CLASS_SIL: Partial<Record<HCard['cls'], string>> = { pistol: 'glock', smg: 'mp7', shotgun: 'nova', rifle: 'ak47', sniper: 'awp', heavy: 'negev', spell: 'he', bomb: 'fakeplant' };
/** Чем убили: силуэт конкретного оружия, иначе — класса. */
function weaponSil(cardId: string | null, agentId?: string): string {
  if (!cardId) {
    const by: Record<string, string> = { ct_seal: 'scar20', ct_sas: 'flash', ct_fbi: 'kit', t_balkan: 'molotov', t_pro: 'deagle' };
    return silHTML((agentId && by[agentId]) || 'knife', 'sil kf-w');
  }
  const c = hcard(cardId);
  return silHTML(SIL.has(c.img) ? c.img : SIL.has(c.id) ? c.id : CLASS_SIL[c.cls] ?? 'he', 'sil kf-w');
}
let wbHit = new Set<string>();
/** Кто сейчас стреляет/кидает — чтобы подписать убийство в килфиде. */
let kctx: { p: PI; by: string; from?: string; to?: string; hero?: boolean } | null = null;
let hsHit = new Set<string>();
let turnKills: [number, number] = [0, 0];
let clutchShown: [boolean, boolean] = [false, false];
let spotted = false;
const sideOfCls = (cls: string): Side => (/\bf-CT\b/.test(cls) ? 'CT' : 'T');
function ownerOf(id: string, sn: fx.Snapshot): PI {
  const s = S.s!;
  if (id === 'h0' || s.p[0].board.some((x) => x.uid === id)) return 0;
  if (id === 'h1' || s.p[1].board.some((x) => x.uid === id)) return 1;
  return sideOfCls(sn.get(id)?.cls ?? '') === s.p[0].hero.side ? 0 : 1;
}
function feedName(side: Side, text: string) { return `<span class="${side === 'T' ? 'kt' : 'kct'}">${esc(text)}</span>`; }

// Писк C4, пока бомба на столе: чем меньше ходов осталось, тем чаще
let tickAcc = 0;
setInterval(() => {
  const s = S.s;
  if (!s || S.phase !== 'play' || document.hidden) return;
  const b = [...s.p[0].board, ...s.p[1].board].find((u) => hcard(u.card).kind === 'bomb');
  if (!b) { tickAcc = 0; return; }
  const every = [250, 250, 500, 900][Math.min(b.bomb, 3)];
  tickAcc += 250;
  if (tickAcc >= every) { tickAcc = 0; c4.beep(b.bomb <= 1); }
}, 250);

// ─────────────────────────── MVP: лучший боец партии ───────────────────────────
interface MvpRow { uid: string; card: string; p: PI; kills: number; dmg: number }
/** Ключ партии: офлайн — сам стол (меняется на месте), онлайн — матч (стол приходит заново каждым шагом). */
const gameKey = (): object | null => S.on ?? S.s;
let mvpOf: object | null = null, mvpRows = new Map<string, MvpRow>();
function mvpRow(uid: string, card: string | null, p: PI): MvpRow | null {
  if (mvpOf !== gameKey()) { mvpOf = gameKey(); mvpRows = new Map(); }
  if (!card || hcard(card).kind !== 'unit') return null;
  let r = mvpRows.get(uid);
  if (!r) { r = { uid, card, p, kills: 0, dmg: 0 }; mvpRows.set(uid, r); }
  return r;
}
function mvpKill(uid: string, card: string | null, p: PI) { const r = mvpRow(uid, card, p); if (r) r.kills++; }
function mvpDmg(uid: string, card: string | null, p: PI, n: number) { const r = mvpRow(uid, card, p); if (r) r.dmg += n; }
/** Экран MVP в стиле CS2: агент победителя крупно, лучший боец партии и его фраги. */
function mvpHTML(): string {
  const s = S.s; if (!s || s.winner === null) return '';
  const w = s.winner, h = s.p[w].hero, a = agent(h.agent);
  const rows = mvpOf === gameKey() ? [...mvpRows.values()] : [];
  const best = rows.filter((r) => r.p === w).sort((x, y) => y.kills - x.kills || y.dmg - x.dmg)[0]
    ?? rows.sort((x, y) => y.kills - x.kills || y.dmg - x.dmg)[0];
  const who = w === 0 ? 'Вы' : S.on ? esc(S.on.opp.name) : 'Бот';
  const bc = best ? hcard(best.card) : null;
  const art = bc ? unitArt(bc, s.p[best!.p].hero.side) : null;
  const kn = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'убийство' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'убийства' : 'убийств'}`;
  return `<div class="mvp f-${h.side}">
    <div class="mvp-agent"><span class="portrait">${agentArt(h.side, h.agent)}</span><i class="mvp-star">★</i></div>
    <div class="mvp-txt"><small>MVP партии</small><b>${who} · ${esc(a.name)}</b><span>${h.side === 'T' ? 'Террористы победили' : 'Спецназ победил'} · убийств за партию: ${s.p[w].kills}</span></div>
    ${best && bc ? `<div class="mvp-best"><span class="mvp-card">${art ? `<img src="${esc(art)}" alt="">` : `<img class="w" src="${esc(hImg(bc))}" alt="">`}</span>
      <div><small>Лучший боец</small><b>${esc(bc.name)}${best.p === 0 ? '' : ' (соперник)'}</b><span>${kn(best.kills)} · ${best.dmg} урона</span></div></div>` : ''}
  </div>`;
}

// ─────────────────────────── Деньги: прибавка «бегущими» цифрами, как в бай-меню CS2 ───────────────────────────
const shownCash: [number | null, number | null] = [null, null];
let cashOf: object | null = null;
function cashTick() {
  for (const el of document.querySelectorAll<HTMLElement>('.hs-cash b[data-cash]')) {
    const p = Number(el.dataset.cash) as PI, to = Number(el.dataset.to);
    const cur = shownCash[p] ?? to;
    if (cur === to) { if (el.dataset.at !== String(to)) { el.dataset.at = String(to); el.innerHTML = moneyHTML(to); } continue; }
    const step = Math.max(50, Math.round(Math.abs(to - cur) / 6 / 50) * 50);
    const nx = cur < to ? Math.min(to, cur + step) : Math.max(to, cur - step);
    shownCash[p] = nx; el.dataset.at = String(nx); el.innerHTML = moneyHTML(nx);
    el.classList.toggle('up', to > cur); el.classList.toggle('down', to < cur);
    if (nx === to) setTimeout(() => el.classList.remove('up', 'down'), 350);
  }
  requestAnimationFrame(cashTick);
}
requestAnimationFrame(cashTick);
const moneyHTML = (n: number) => `<em>$</em>${kilo(n)}`;

// ─────────────────────────── Действия ───────────────────────────
const elOf = (id: string) => hooks.root.querySelector<HTMLElement>(`[data-hid="${CSS.escape(id)}"]`);
function snap(): fx.Snapshot {
  const m: fx.Snapshot = new Map();
  hooks.root.querySelectorAll<HTMLElement>('[data-hid]').forEach((el) => m.set(el.dataset.hid!, { rect: el.getBoundingClientRect(), html: el.innerHTML, cls: el.className }));
  return m;
}
let handFrom: DOMRect | null = null;
let lastDie: DOMRect | null = null;
const rectOf = (id: string, sn: fx.Snapshot) => elOf(id)?.getBoundingClientRect() ?? sn.get(id)?.rect ?? null;

async function act(a: Action, p: PI) {
  const s = S.s!;
  // Онлайн: действие проверяет и применяет сервер, ответ (step) проиграется в onlineStep
  if (S.on) { if (p !== 0 || S.busy) return; S.busy = true; S.sel = null; resetPend(); net.send({ t: 'act', a }); hooks.render(); return; }
  S.busy = true;
  const sn = snap();
  if (a.k === 'atk') {
    fx.lunge(elOf(a.from), rectOf(a.to, sn));
    await wait(200);
  }
  const playedCard = a.k === 'play' ? s.p[p].hand.find((c) => c.uid === a.uid)?.id : undefined;
  handFrom = a.k === 'play' && p === 0 ? hooks.root.querySelector<HTMLElement>(`.hs-hand [data-uid="${CSS.escape(a.uid)}"]`)?.getBoundingClientRect() ?? null : null;
  if (playedCard && hcard(playedCard).kind === 'bomb') {
    c4.key(); const t = setInterval(() => c4.key(), 260);
    await fx.progress(p === 0 ? 'Закладка бомбы' : 'Соперник закладывает бомбу', 1100, 'plant');
    clearInterval(t);
  }
  rememberNames(s);
  s.log = [];
  if (!apply(s, p, a)) { S.busy = false; sfx.deny(); hooks.render(); return; }
  const evs = drain();
  rememberNames(s);
  logEvents(evs, p, a);
  S.sel = null; resetPend();
  if (p === 1 && playedCard) {
    if (hcard(playedCard).kind === 'trap') { fx.banner('Соперник поставил засаду', 'info', 900); await wait(600); } else await showCast(playedCard);
  }
  hooks.render();
  await playEvents(evs, sn, p);
  S.busy = false;
  if (s.winner !== null) return finishGame();
  hooks.render();
}

/** Карта, которую разыграл бот, на секунду показывается крупно. */
async function showCast(id: string) {
  const el = document.createElement('div');
  el.className = 'hs-cast';
  el.innerHTML = bigCardHTML(hcard(id), undefined, S.s ? S.s.p[1].hero.side : other(mySide()), true).replace(/<button class="hcb-more"[^>]*>[^<]*<\/button>/, '');
  document.body.appendChild(el);
  await wait(750);
  el.remove();
}

async function playEvents(evs: Ev[], sn: fx.Snapshot, p: PI) {
  const s = S.s!;
  for (const e of evs) {
    switch (e.t) {
      case 'turn':
        turnKills = [0, 0]; spotted = false; kctx = null;
        sfx.turn();
        fx.banner(e.p === 0 ? 'Ваш ход' : 'Ход соперника', 'turn', 900);
        if (e.p === 0) { haptic.hit('medium'); const f = document.createElement('div'); f.className = 'turnflash'; document.body.appendChild(f); setTimeout(() => f.remove(), 1100); }
        await wait(e.p === 0 ? 650 : 400);
        break;
      case 'play': {
        if (e.card === 'trap') { sfx.click(); await wait(150); break; }
        const c = hcard(e.card);
        if (e.uid) {
          const el = elOf(e.uid);
          const from = e.p === 0 ? handFrom ?? new DOMRect(innerWidth / 2 - 30, innerHeight - 90, 60, 80) : elOf('h1')?.getBoundingClientRect() ?? null;
          handFrom = null;
          if (e.p === 0) fx.arcIn(el, from); else fx.flyIn(el, from);
          sfx.buy();
          if (c.kind === 'bomb') { c4.plant(); speak('bombpl', 'hq'); fx.banner('Бомба заложена', 'bomb', 1400); await wait(1000); }
          else if (e.p === 1 && !spotted && c.kind === 'unit') { spotted = true; if (Math.random() < 0.5) speak('enemyspotted', 0); }
          await wait(260);
        } else {
          const enemy = foeBoardRects(e.p);
          const tr = e.target ? rectOf(e.target, sn) : null;
          const heroR = rectOf(heroId(e.p), sn);
          kctx = { p: e.p, by: e.card, hero: true };
          if (e.p === 0) { const to = tr ?? hooks.root.querySelector(`.hs-board.b${e.p === 0 ? 1 : 0}`)?.getBoundingClientRect() ?? null; fx.flyCard(`<span class="hc f-${c.side}">${cardFace(c)}</span>`, handFrom ?? new DOMRect(innerWidth / 2 - 30, innerHeight - 90, 60, 80), to); handFrom = null; await wait(300); }
          const boardR = (q: PI) => hooks.root.querySelector(`.hs-board.b${q}`)?.getBoundingClientRect() ?? null;
          const foeP: PI = e.p === 0 ? 1 : 0;
          if (e.card === 'he') {
            speak('fireinhole', e.p); sfx.whoosh();
            await fx.throwNade(heroR, enemy[Math.floor(enemy.length / 2)] ?? boardR(foeP), 'he');
            sfx.boom(); enemy.forEach((r) => fx.heBlast(r)); fx.quake(hooks.root.querySelector('.hs-board.b' + foeP));
          } else if (e.card === 'molotov' || e.card === 'incendiary') {
            speak('molotov', e.p); sfx.whoosh();
            await fx.throwNade(heroR, tr ?? boardR(foeP), 'molotov');
            sfx.fire(); fx.fireArea(tr ?? boardR(foeP)!);
          } else if (e.card === 'flash') {
            speak('flash', e.p); sfx.whoosh();
            await fx.throwNade(heroR, tr ?? boardR(foeP), 'flash');
            sfx.flashbang();
            // вспышка над стороной взрыва: ряд, где стоит цель (обычно бойцы соперника)
            const tEl = e.target ? elOf(e.target) : null;
            const sideP: PI = e.target === 'h0' || tEl?.closest('.hs-board.b0') ? 0 : e.target === 'h1' || tEl?.closest('.hs-board.b1') ? 1 : foeP;
            const area = boardR(sideP);
            if (area) fx.flashArea(area, tr, sideP === 0); if (tr) fx.burst(tr, 'zap');
          } else if (e.card === 'smoke') {
            speak('smoke', e.p); sfx.whoosh();
            const own = boardR(e.p);
            await fx.throwNade(heroR, own, 'smoke');
            sfx.hiss(); if (own) fx.smokeCloud(own);
          } else if (e.card === 'zeus') { if (tr) { fx.burst(tr, 'zap'); weaponShot('zeus', 'knife'); } }
          else sfx.buy();
          await wait(250);
        }
        break;
      }
      case 'power': {
        sfx.click();
        const tr = e.target ? rectOf(e.target, sn) : null;
        const ag = s.p[e.p].hero.agent;
        kctx = { p: e.p, by: 'power', hero: true };
        if (tr && (ag === 'ct_seal' || ag === 'ct_sas')) { const hr = rectOf(heroId(e.p), sn); if (hr) fx.shot(hr, tr, 'bullet'); weaponShot(ag === 'ct_seal' ? 'scar20' : 'm4a1s', ag === 'ct_seal' ? 'sniper' : 'bullet'); }
        if (ag === 't_balkan') { const r = rectOf(heroId(e.p === 0 ? 1 : 0), sn); if (r) fx.burst(r, 'fire'); }
        await wait(200);
        break;
      }
      case 'atk': {
        const a = rectOf(e.from, sn), b = rectOf(e.to, sn);
        const u = findUnitAny(e.from, sn);
        kctx = { p: ownerOf(e.from, sn), by: u ?? 'knife', from: e.from, to: e.to, hero: !u };
        const kind = !u ? 'knife' : hcard(u).cls === 'sniper' ? 'sniper' : 'bullet';
        if (a && b) fx.shot(a, b, kind);
        const mode = findUnit(S.s!, e.from)?.u.mode;
        weaponShot(u ?? 'knife', kind, mode === 1);
        haptic.hit(kind === 'sniper' ? 'rigid' : 'light');
        await wait(120);
        break;
      }
      case 'dmg': {
        const r = rectOf(e.id, sn);
        if (r) fx.splash(r, `−${e.n}${e.bonus ? '!' : ''}`, 'damage');
        if (r && e.hs) { fx.headshot(r); sfx.dink(); haptic.hit('heavy'); }
        else if (e.id === 'h0') haptic.hit('medium');
        if (r && e.wb) setTimeout(() => fx.splash(new DOMRect(r.x - 16, r.y - 22, r.width, r.height), 'прострел', 'block'), 140);
        if (e.wb) wbHit.add(e.id);
        if (kctx?.from) {
          const ret = e.id === kctx.from, by = ret ? kctx.to : kctx.from;
          if (by && by !== 'h0' && by !== 'h1') mvpDmg(by, findUnitAny(by, sn), ret ? (kctx.p === 0 ? 1 : 0) : kctx.p, e.n);
        }
        if (r && e.blocked) setTimeout(() => fx.splash(new DOMRect(r.x + 16, r.y - 20, r.width, r.height), `броня ${e.blocked}`, 'block'), 120);
        fx.hitFlash(elOf(e.id));
        if (e.hs) hsHit.add(e.id);
        if (e.id === 'h0' && e.n >= 5) speak('takingfire', 0);
        await wait(110);
        break;
      }
      case 'heal': { const r = rectOf(e.id, sn); if (r) fx.splash(r, `+${e.n}`, 'heal'); await wait(120); break; }
      case 'armor': { const r = rectOf(e.id, sn); if (r) fx.splash(r, `+${e.n}`, 'block'); await wait(120); break; }
      case 'buff': { const r = rectOf(e.id, sn); if (r) fx.splash(r, e.text, 'heal'); await wait(160); break; }
      case 'blind': { const r = rectOf(e.id, sn); if (r) fx.burst(r, 'zap'); await wait(80); break; }
      case 'die': {
        const g = sn.get(e.id); if (g) fx.death(g);
        haptic.hit('medium');
        lastDie = g?.rect ?? null;
        const vCard = findUnitAny(e.id, sn);
        if (vCard && hcard(vCard).kind !== 'bomb') {
          const vSide = sideOfCls(g?.cls ?? '');
          const vOwner: PI = s.p[0].hero.side === vSide ? 0 : 1;
          let kP: PI = vOwner === 0 ? 1 : 0, killer = '', icon = '';
          if (kctx) {
            const retaliated = kctx.from === e.id;
            kP = retaliated ? (kctx.p === 0 ? 1 : 0) : kctx.p;
            const kc = retaliated ? (kctx.to ? findUnitAny(kctx.to, sn) : null) : kctx.hero ? null : kctx.by;
            const icCard = retaliated ? kc : kctx.by !== 'power' && kctx.by !== 'knife' ? kctx.by : null;
            killer = kc ? hcard(kc).name : shortName(s.p[kP].hero.agent);
            icon = weaponSil(icCard, kctx.by === 'power' ? s.p[kP].hero.agent : undefined);
            if (kc && kctx.from && !retaliated) mvpKill(kctx.from, kc, kP);
            else if (kc && retaliated && kctx.to) mvpKill(kctx.to, kc, kP);
          } else { killer = shortName(s.p[kP].hero.agent); icon = weaponSil(null, s.p[kP].hero.agent); }
          const kSide = s.p[kP].hero.side;
          fx.killfeed(`${feedName(kSide, killer)}<span class="kic">${icon}${wbHit.has(e.id) ? WB_ICON : ''}${hsHit.has(e.id) ? HS_ICON : ''}</span>${feedName(vSide, hcard(vCard).name)}`, kP === 0,
            hooks.root.querySelector('.hs-board.b1')?.getBoundingClientRect());
          if (kP !== vOwner) {
            turnKills[kP]++;
            if (kP === 0 && Math.random() < 0.55) speak(turnKills[0] >= 2 && Math.random() < 0.5 ? 'niceshot' : 'enemydown', 0);
            const foeBoard = s.p[vOwner].board.filter((x) => hcard(x.card).kind !== 'bomb');
            if (turnKills[kP] >= 3 && !foeBoard.length && kP === 0) fx.roundBanner('Эйс', `${turnKills[0]} убийства за ход — стол соперника чист`, 'ace', 1800);
          }
        }
        hsHit.delete(e.id); wbHit.delete(e.id);
        await wait(160); break;
      }
      case 'cash': {
        const r = elOf(`cash${e.p}`)?.getBoundingClientRect();
        if (r) fx.cash(r, e.loss ? `+${money(e.n)} за отставание` : `+${money(e.n)}`);
        if (e.loss && e.p === 0) { speak('needbackup', 0); fx.banner(`Бонус за отставание +${money(e.n)}`, 'info', 900); await wait(500); }
        await wait(100); break;
      }
      case 'fatigue': { const r = rectOf(heroId(e.p), sn); if (r) fx.splash(r, 'Пусто', 'miss'); await wait(300); break; }
      case 'draw': if (e.burned) { fx.banner('Рука полна — карта сгорела', 'info', 900); await wait(500); } break;
      case 'trap': {
        sfx.beep();
        fx.banner(`Засада: ${hcard(e.card).name}`, e.p === 0 ? 'defuse' : 'bomb', 1100);
        await wait(800);
        break;
      }
      case 'vet': { const r = rectOf(e.id, sn); if (r) fx.splash(r, '★', 'heal'); fx.banner(e.text, 'info', 800); await wait(450); break; }
      case 'shop': if (e.p === 1) { fx.banner('Соперник купил карту в бай-меню', 'info', 900); await wait(500); } else sfx.buy(); break;
      case 'fizzle': fx.banner(`«${hcard(e.card).name}» не сработала`, 'info', 1000); await wait(600); break;
      case 'trophy': {
        sfx.buy();
        if (!e.burned) fx.flyCard(`<span class="hc f-${hcard(e.card).side}">${cardFace(hcard(e.card))}</span>`, lastDie,
          e.p === 0 ? new DOMRect(innerWidth / 2 - 30, innerHeight - 80, 60, 80) : elOf('h1')?.getBoundingClientRect() ?? null);
        fx.banner(e.burned ? `Трофей ${hcard(e.card).name} сгорел — рука полна` : `${e.p === 0 ? 'Ваш трофей' : 'Трофей соперника'}: ${hcard(e.card).name}`, e.p === 0 ? 'defuse' : 'info', 1100);
        await wait(700); break;
      }
      case 'bomb': if (e.left < HS.bombTimer) { c4.beep(e.left <= 1); fx.banner(`До взрыва: ${e.left}`, 'bomb', 900); await wait(700); } break;
      case 'boom': c4.boom(); haptic.hit('heavy'); setTimeout(() => haptic.hit('heavy'), 160); fx.quake(hooks.root.querySelector('.hs')); fx.banner('Бомба взорвалась', 'bomb', 1400); await wait(1100); break;
      case 'defused': c4.defuseStart(); await fx.progress('Разминирование', 700, 'defuse'); c4.defused(); speak('bombdef', 'hq'); fx.banner('Бомба обезврежена', 'defuse', 1300); await wait(900); break;
      case 'entry': { const r = rectOf(e.id, sn); if (r) fx.splash(r, 'энтри', 'heal'); if (e.p === 0) fx.cash(elOf('cash0')?.getBoundingClientRect() ?? r ?? new DOMRect(), 'Энтри-фраг'); await wait(250); break; }
      case 'mark': { const r = rectOf(e.id, sn); if (r) fx.splash(r, 'трейд', 'miss'); await wait(150); break; }
      case 'clutch': {
        const cp: PI = s.p[0].board.some((x) => x.uid === e.id) ? 0 : 1;
        if (!clutchShown[cp]) {
          clutchShown[cp] = true;
          const n = s.p[cp === 0 ? 1 : 0].board.filter((x) => hcard(x.card).kind !== 'bomb').length;
          fx.roundBanner(`Клатч 1 vs ${n}`, cp === 0 ? 'Ваш последний боец бьёт на 2 сильнее' : 'Последний боец соперника бьёт на 2 сильнее', 'clutch', 1500);
          speak(cp === 0 ? 'clutch' : 'needbackup', cp); await wait(700);
        } else { await wait(150); }
        break;
      }
      case 'save': sfx.click(); await wait(200); break;
      case 'eco': sfx.buy(); fx.banner(`${e.p === 0 ? 'Эко раунд' : 'Соперник играет эко'}: ${e.pick === 'cards' ? `+${HS.ecoCards} карты` : `+${money(HS.ecoCash)} в след. ход`}`, e.p === 0 ? 'defuse' : 'info', 1300); await wait(700); break;
    }
  }
}
function findUnitAny(id: string, sn: fx.Snapshot): string | null {
  const f = findUnit(S.s!, id);
  if (f) return f.u.card;
  const cls = sn.get(id)?.cls.match(/\bc-([\w]+)/);
  return cls ? cls[1] : null;
}
const boardRects = (p: PI) => [...hooks.root.querySelectorAll<HTMLElement>(`.hs-board.b${p} [data-hid]`)].map((el) => el.getBoundingClientRect());
const foeBoardRects = (p: PI) => boardRects(p === 0 ? 1 : 0);

/** Эко-раунд доступен: ничего не сыграно за ход (в пошаговом обучении — нет). */
const ecoReady = () => !!S.s && myTurn() && canEco(S.s, 0) && !(S.tut && !S.tut.free);
async function playerEndTurn(pick?: EcoPick) {
  const s = S.s!;
  if (S.busy || s.turn !== 0 || s.winner !== null) return;
  if (pick && !canEco(s, 0)) pick = undefined;
  if (pick) track('eco', { pick, turn: s.p[0].turns, online: !!S.on });
  if (S.on) { S.sel = null; S.info = null; resetPend(); S.busy = true; net.send(pick ? { t: 'end', eco: pick } : { t: 'end' }); hooks.render(); return; }
  S.sel = null; S.info = null; S.busy = true; resetPend();
  rememberNames(s);
  s.log = [];
  if (pick) eco(s, 0, pick); else endTurn(s);
  const evs = drain();
  logEvents(evs, 1);
  hooks.render();
  await playEvents(evs, snap(), 0);
  S.busy = false;
  if (s.winner !== null) return finishGame();
  if ((s.turn as PI) === 1) await botTurn();
}

async function botTurn() {
  const s = S.s!;
  S.busy = true; hooks.render();
  await wait(450);
  for (let i = 0; i < 40 && s.winner === null && s.turn === 1 && S.s === s; i++) {
    const a = botStep(s, 1, S.setup.diff);
    if (!a) break;
    await act(a, 1);
    S.busy = true;
    await wait(380);
  }
  if (S.s !== s) return;
  if (s.winner !== null) return finishGame();
  rememberNames(s);
  s.log = [];
  botEnd(s, 1);
  const evs = drain();
  logEvents(evs, 0);
  hooks.render();
  await playEvents(evs, snap(), 1);
  S.busy = false;
  if (s.winner !== null) return finishGame();
  hooks.render();
}

let finishing = false;
async function finishGame() {
  const s = S.s!;
  if (S.phase !== 'play' || finishing) return;
  finishing = true;
  S.busy = true;
  await wait(900);
  fx.clearBanner();
  finishing = false;
  if (S.s !== s) return;
  const win = s.winner === 0;
  S.score[s.winner!]++;
  S.results.push({ win, reason: s.reason, side: mySide(), turns: s.p[0].turns });
  (win ? sfx.win : sfx.lose)();
  const wSide = s.p[s.winner!].hero.side;
  speak(wSide === 'T' ? 'terwin' : 'ctwin', 'hq');
  fx.roundBanner(wSide === 'T' ? 'Террористы победили' : 'Спецназ победил',
    s.reason === 'bomb' ? 'Бомба взорвалась' : s.reason === 'defuse' ? 'Бомба обезврежена' : win ? 'Вы выиграли игру' : 'Соперник выиграл игру', wSide, 2400);
  recordRound(S.setup[mySide()], win, s.p[0].kills);
  questsAtEnd(win, S.setup[mySide()], s.p[0].kills, false);
  track('hs_game', { game: S.game, win, reason: s.reason, side: mySide(), turns: s.p[0].turns, agent: S.setup[mySide()], bot: S.botAgent, diff: S.setup.diff, map: S.map, tut: !!S.tut });
  const done = true;   // против бота — одна партия: сторону заранее решил ножевой раунд
  if (S.tut) { markTutorialDone(); S.tut.over = true; }
  S.phase = done ? 'over' : 'gameover';
  S.busy = false; S.sel = null;
  if (done) {
    recordRoundsMatch(S.score[0] > S.score[1], S.setup.diff);
    track('hs_end', { win: S.score[0] > S.score[1], score: S.score.join(':'), diff: S.setup.diff });
  }
  hooks.render();
}

// ─────────────────────────── Ножевой раунд ───────────────────────────
function startKnife() {
  const pick = (side: Side) => { const pool = AGENTS.filter((a) => a.side === side); return pool[Math.floor(Math.random() * pool.length)].id; };
  S.on = null; S.s = null;
  S.knife = { k: newKnife(), pick: null, reveal: null, bot: { T: pick('T'), CT: pick('CT') } };
  S.phase = 'knife';
  preloadShots();
  hooks.render();
}
async function knifePick(m: Move) {
  const kn = S.knife;
  if (!kn || kn.pick || kn.k.winner !== null || !MOVES.includes(m)) return;
  kn.pick = m;
  if (kn.online) { net.send({ t: 'knife', move: m }); sfx.click(); hooks.render(); return; }
  const r = resolveKnife(kn.k, m, botKnifeMove(kn.k, 1));
  kn.reveal = r;
  knifeSound(r);
  if (r.winner === 0) haptic.win(); else if (r.winner === 1) haptic.deny();
  hooks.render();
  await wait(1500);
  if (S.knife !== kn) return;
  kn.pick = null; kn.reveal = null;
  if (kn.k.winner !== null) {
    if (kn.k.winner === 1) kn.botSide = Math.random() < 0.5 ? 'T' : 'CT';
    S.phase = 'sidepick';
    (kn.k.winner === 0 ? sfx.win : sfx.lose)();
  }
  hooks.render();
}
const MOVE_ICON: Record<Move, () => string> = {
  knife: () => silHTML('knife', 'sil kn-ic') || '🔪',
  shield: () => silHTML('shield', 'sil kn-ic tall') || '<svg class="kn-ic" viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5z" fill="currentColor"/></svg>',
  zeus: () => silHTML('zeus', 'sil kn-ic') || '⚡',
};
/** Звук приёма победителя (ничья — звук ножа). */
function knifeSound(r: KnifeRound) {
  const m = r.winner === null ? 'knife' : r.picks[r.winner];
  if (m === 'zeus') weaponShot('zeus', 'knife'); else if (m === 'shield') { sfx.click(); weaponShot('knife', 'knife'); } else weaponShot('knife', 'knife');
}
function knifeHTML(): string {
  if (!S.knife) return `<main class="kn rm"><header class="rm-head"><span></span><span class="rm-title">Ножевой раунд</span><span></span></header><p class="note">Соединяемся…</p></main>`;
  const kn = S.knife, k = kn.k, rv = kn.reveal, ol = kn.online;
  const opp = ol && S.on ? esc(S.on.opp.name) : 'Бот';
  const timer = ol ? ` <b class="hs-timer" data-dl="${ol.deadline}"></b>` : '';
  const hearts = (n: number) => Array.from({ length: KNIFE_HP }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  const team = (T: string, CT: string, who: string, p: 0 | 1) => `<div class="kn-p p${p} ${rv && rv.winner !== null ? (rv.winner === p ? 'hit' : 'hurt') : ''}">
      <div class="kn-team"><span class="portrait">${agentArt('T', T)}</span><span class="portrait">${agentArt('CT', CT)}</span></div>
      <b>${who}</b><span class="kn-hp">${hearts(k.hp[p])}</span></div>`;
  let center = '<span class="kn-vs">VS</span>';
  if (rv) {
    const res = rv.winner === null ? 'Ничья — ещё раз' : `${MOVE_RU[rv.picks[rv.winner]]} бьёт ${MOVE_RU[rv.picks[rv.winner === 0 ? 1 : 0]]} · −1 жизнь`;
    center = `<div class="kn-reveal"><span class="kn-card ${rv.winner === 0 ? 'win' : rv.winner === 1 ? 'lose' : ''}">${MOVE_ICON[rv.picks[0]]()}<b>${MOVE_RU[rv.picks[0]]}</b></span>
      <span class="kn-card ${rv.winner === 1 ? 'win' : rv.winner === 0 ? 'lose' : ''}">${MOVE_ICON[rv.picks[1]]()}<b>${MOVE_RU[rv.picks[1]]}</b></span></div><p class="kn-res">${res}</p>`;
  }
  let bottom: string;
  if (S.phase === 'sidepick' && ol?.pick === 'opp') {
    bottom = `<h2 class="kn-title lose">Ножи у соперника</h2><p class="note">${opp} выбирает сторону…${timer}</p><p class="note">Зато вы первым уберёте карту в вето.</p>`;
  } else if (S.phase === 'sidepick' && ol?.sideSent) {
    bottom = `<h2 class="kn-title win">Ножи ваши!</h2><p class="note">Сторона выбрана, переходим к вето карт…</p>`;
  } else if (S.phase === 'sidepick' && k.winner === 0) {
    bottom = `<h2 class="kn-title win">Ножи ваши!</h2><p class="note">Выберите сторону — дальше одна партия.${timer}</p>
      <div class="kn-sides"><button class="kn-side t" data-act="hs-pickside" data-v="T"><span class="portrait">${agentArt('T', S.setup.T)}</span><b>T · атака</b><small>Ходите первым, бомба в руке: заложите и удержите 3 хода или снимите героя.</small></button>
      <button class="kn-side ct" data-act="hs-pickside" data-v="CT"><span class="portrait">${agentArt('CT', S.setup.CT)}</span><b>CT · защита</b><small>Ходите вторым, +1 карта и «Дроп». Обезвредьте бомбу или снимите героя.</small></button></div>`;
  } else if (S.phase === 'sidepick') {
    const mine = other(kn.botSide!);
    bottom = `<h2 class="kn-title lose">Ножи у бота</h2><p class="note">Бот выбрал ${kn.botSide === 'T' ? 'T (атаку)' : 'CT (защиту)'} — вы играете за <b>${mine}</b>.</p>
      <button class="primary big-btn" data-act="hs-knife-go">В бой за ${mine}</button>`;
  } else {
    bottom = `<div class="kn-moves">${MOVES.map((m) => `<button class="kn-move ${kn.pick === m ? 'on' : ''}" data-act="hs-knife" data-v="${m}" ${kn.pick ? 'disabled' : ''}>
        ${MOVE_ICON[m]()}<b>${MOVE_RU[m]}</b><small>бьёт ${MOVE_RU[BEATS[m]]}</small></button>`).join('')}</div>
      ${ol ? `<p class="note kn-rules">${kn.pick ? (ol.oppPicked ? 'Открываем…' : `Ждём ${opp}…`) : ol.oppPicked ? `${opp} уже выбрал — ваш ход` : 'Выбирайте приём'}${timer}</p>` : ''}
      <p class="note kn-rules">Тайно выберите приём, ${ol ? 'соперник' : 'бот'} выбирает одновременно. Каждая победа в обмене снимает сопернику одну жизнь. У кого кончатся все три — проиграл ножи.</p>`;
  }
  return `<main class="kn rm">
    <header class="rm-head">${ol ? '<span></span>' : '<button class="ghost sm" data-act="hs-menu">← Меню</button>'}<span class="rm-title">Ножевой раунд${S.phase === 'knife' ? ` · ${k.round}` : ''}</span><span></span></header>
    <div class="kn-arena">${team(S.setup.T, S.setup.CT, 'Вы', 0)}<div class="kn-mid">${center}</div>${team(kn.bot.T, kn.bot.CT, opp, 1)}</div>
    ${bottom}
  </main>`;
}

// ─────────────────────────── Нажатия ───────────────────────────
function currentTargets(): string[] {
  const s = S.s, sel = S.sel;
  if (!s || !sel) return [];
  if (sel.k === 'atk') return attackTargets(s, 0, sel.id);
  if (sel.k === 'power') return powerTargets(s, 0) ?? [];
  return playStage() === 'target' ? playTargetsNow() : [];
}
function resetPend() { S.pend = { go: false, mode: undefined, at: undefined }; }
function handInst() { const s = S.s!, sel = S.sel; return sel?.k === 'hand' ? s.p[0].hand.find((x) => x.uid === sel.uid) : undefined; }
function playTargetsNow(): string[] { const s = S.s!, inst = handInst(); return inst ? playTargets(s, 0, inst.id, !!inst.free) ?? [] : []; }
/** На каком шаге розыгрыш карты из руки. */
function playStage(): 'none' | 'preview' | 'place' | 'target' | 'exec' {
  const s = S.s!, inst = handInst();
  if (!inst || !myTurn()) return 'none';
  const c = hcard(inst.id);
  const t = playTargets(s, 0, inst.id, !!inst.free);
  if (!t) return 'preview';
  if (!S.pend.go && !(c.kind === 'spell' && t.length)) return 'preview';
  if ((c.kind === 'unit' || c.kind === 'bomb') && s.p[0].board.length > 0 && S.pend.at === undefined) return 'place';
  if (t.length) return 'target';
  return 'exec';
}
/** Продвинуть розыгрыш: если всё выбрано — сыграть. */
function advancePlay(target?: string) {
  const inst = handInst();
  if (!inst) return;
  const st = playStage();
  if (st === 'exec' || (st === 'target' && target !== undefined) || (st === 'target' && target === undefined && hcard(inst.id).bcOptional)) {
    void act({ k: 'play', uid: inst.uid, target, at: S.pend.at, mode: S.pend.mode }, 0);
    return;
  }
  hooks.render();
}
/** Какие ряды подсвечивать как «куда можно»: только в свой ход и только допустимые. */
function zones(): { b0: boolean; b1: boolean } {
  const s = S.s, z = { b0: false, b1: false };
  if (!s || !myTurn() || s.p[0].choice) return z;
  const inst = handInst();
  if (inst) {
    const c = hcard(inst.id), st = playStage();
    if ((c.kind === 'unit' || c.kind === 'bomb') && (st === 'preview' || st === 'place') && S.pend.at === undefined && playTargets(s, 0, inst.id, !!inst.free)) z.b0 = true;
  }
  const t = currentTargets();
  if (t.length) { z.b0 ||= s.p[0].board.some((u) => t.includes(u.uid)); z.b1 = s.p[1].board.some((u) => t.includes(u.uid)); }
  return z;
}
const zoneCls = (b: 'b0' | 'b1') => (zones()[b] ? 'zone' : '');
const myTurn = () => !!S.s && S.s.turn === 0 && !S.busy && S.s.winner === null && S.phase === 'play';

function onEntity(id: string) {
  const s = S.s!;
  if (!myTurn()) { S.info = S.info === id ? null : id; hooks.render(); return; }
  const t = currentTargets();
  if (S.sel && t.includes(id)) {
    const sel = S.sel;
    if (sel.k === 'atk') void act({ k: 'atk', from: sel.id, to: id }, 0);
    else if (sel.k === 'power') void act({ k: 'power', target: id }, 0);
    else advancePlay(id);
    return;
  }
  if (canAttack(s, 0, id) && attackTargets(s, 0, id).length) { S.sel = S.sel?.k === 'atk' && S.sel.id === id ? null : { k: 'atk', id }; S.info = null; sfx.click(); }
  else { S.sel = null; S.info = S.info === id ? null : id; }
  hooks.render();
}

// ─────────────────────────── Перетаскивание карт из руки ───────────────────────────
// Можно, как раньше, нажать карту → «На стол» → место, а можно сразу перетащить её:
// бойца — в нужное место своего ряда, действие с целью — на цель, действие без цели — на поле.
type Drop = { k: 'board'; at: number } | { k: 'target'; id: string } | { k: 'cast' } | null;
let drag: { uid: string; id: string; free: boolean; x0: number; y0: number; pid: number; src: HTMLElement; on: boolean; ghost?: HTMLElement; mark?: HTMLElement; drop: Drop; hl?: Element | null } | null = null;
let swallowClick = false;
const DRAG_START = 10;   // px — меньше считается обычным нажатием

function setupDrag() {
  const root = hooks.root;
  root.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const el = (ev.target as HTMLElement).closest<HTMLElement>('.hs-hand .hc[data-uid]');
    const s = S.s;
    if (!el || !s || !myTurn() || s.p[0].choice) return;
    const inst = s.p[0].hand.find((c) => c.uid === el.dataset.uid);
    if (!inst || !playTargets(s, 0, inst.id, !!inst.free)) return;   // сыграть нельзя — тащить нечего
    drag = { uid: inst.uid, id: inst.id, free: !!inst.free, x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, src: el, on: false, drop: null };
  });
  window.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    if (!drag.on) {
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < DRAG_START) return;
      if (!myTurn()) { drag = null; return; }
      startDrag();
    }
    ev.preventDefault();
    moveDrag(ev.clientX, ev.clientY);
  }, { passive: false });
  window.addEventListener('pointerup', (ev) => { if (drag && ev.pointerId === drag.pid) endDrag(true); });
  window.addEventListener('pointercancel', (ev) => { if (drag && ev.pointerId === drag.pid) endDrag(false); });
  // картинка внутри карты иначе начинает «родное» перетаскивание браузера и обрывает наше (pointercancel)
  root.addEventListener('dragstart', (ev) => { if ((ev.target as HTMLElement).closest?.('.hs-hand')) ev.preventDefault(); });
  // после перетаскивания браузер всё равно шлёт click — гасим его, чтобы карта не «выбралась»
  window.addEventListener('click', (ev) => { if (swallowClick) { ev.stopPropagation(); ev.preventDefault(); } }, true);
}

function startDrag() {
  const d = drag!;
  d.on = true;
  S.sel = null; S.info = null; resetPend();
  const g = document.createElement('div');
  g.className = `${d.src.className.replace(/\b(sel|can)\b/g, '')} hs-ghost`;
  g.innerHTML = d.src.innerHTML;
  document.body.appendChild(g);
  d.ghost = g;
  d.src.classList.add('dragging');
  // показать, куда можно бросить: свой ряд для бойца/бомбы, цели — для действия
  const s = S.s!, c = hcard(d.id), t = playTargets(s, 0, d.id, d.free) ?? [];
  const r = hooks.root;
  if (c.kind === 'unit' || c.kind === 'bomb') r.querySelector('.hs-board.b0')?.classList.add('zone');
  else {
    for (const id of t) r.querySelector(`[data-hid="${CSS.escape(id)}"]`)?.classList.add('tgt');
    if (s.p[1].board.some((u) => t.includes(u.uid))) r.querySelector('.hs-board.b1')?.classList.add('zone');
    if (s.p[0].board.some((u) => t.includes(u.uid))) r.querySelector('.hs-board.b0')?.classList.add('zone');
  }
  sfx.click();
}

/** Куда упадёт карта, если отпустить в точке (x, y). */
function dropAt(x: number, y: number): Drop {
  const s = S.s!, d = drag!;
  const c = hcard(d.id);
  const t = playTargets(s, 0, d.id, d.free) ?? [];
  const under = document.elementFromPoint(x, y) as HTMLElement | null;
  if (under?.closest('.hs-hand')) return null;   // вернули в руку — отмена
  if (c.kind === 'unit' || c.kind === 'bomb') {
    const b = hooks.root.querySelector<HTMLElement>('.hs-board.b0');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    // свой ряд с запасом по высоте: на телефоне в него трудно попасть пальцем точно
    if (y < r.top - r.height * 0.6 || y > r.bottom + r.height * 0.9) return null;
    const units = [...b.querySelectorAll<HTMLElement>(':scope > [data-hid]')].map((e) => e.getBoundingClientRect());
    return { k: 'board', at: units.filter((u) => u.left + u.width / 2 < x).length };
  }
  if (t.length) {
    const hid = under?.closest<HTMLElement>('[data-hid]')?.dataset.hid;
    if (hid && t.includes(hid)) return { k: 'target', id: hid };
    return c.bcOptional && under?.closest('.hs') ? { k: 'cast' } : null;
  }
  return under?.closest('.hs') ? { k: 'cast' } : null;
}

function moveDrag(x: number, y: number) {
  const d = drag!;
  d.ghost!.style.transform = `translate(${x - 31}px, ${y - 70}px) rotate(-4deg) scale(1.08)`;
  d.drop = dropAt(x, y);
  // подсветка цели
  const want = d.drop?.k === 'target' ? hooks.root.querySelector(`[data-hid="${CSS.escape(d.drop.id)}"]`) : d.drop?.k === 'board' ? hooks.root.querySelector('.hs-board.b0') : null;
  if (want !== d.hl) { d.hl?.classList.remove('drop-on'); want?.classList.add('drop-on'); d.hl = want; }
  d.ghost!.classList.toggle('ok', !!d.drop);
  // метка места в ряду
  if (d.drop?.k === 'board') {
    const b = hooks.root.querySelector<HTMLElement>('.hs-board.b0')!;
    const br = b.getBoundingClientRect();
    const units = [...b.querySelectorAll<HTMLElement>(':scope > [data-hid]')].map((e) => e.getBoundingClientRect());
    const at = d.drop.at;
    const mx = !units.length ? br.left + br.width / 2
      : at === 0 ? units[0].left - 5
      : at >= units.length ? units[units.length - 1].right + 5
      : (units[at - 1].right + units[at].left) / 2;
    if (!d.mark) { d.mark = document.createElement('div'); d.mark.className = 'hs-dropmark'; document.body.appendChild(d.mark); }
    const top = units.length ? Math.min(...units.map((u) => u.top)) : br.top + 6;
    const h = units.length ? Math.max(...units.map((u) => u.bottom)) - top : br.height - 12;
    Object.assign(d.mark.style, { left: `${mx - 2}px`, top: `${top}px`, height: `${h}px` });
  } else if (d.mark) { d.mark.remove(); d.mark = undefined; }
}

function endDrag(apply: boolean) {
  const d = drag; drag = null;
  if (!d || !d.on) return;   // это было обычное нажатие — его обработает click
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
  hooks.root.querySelectorAll('.hs-board.zone').forEach((e) => e.classList.remove('zone'));
  d.ghost?.remove(); d.mark?.remove(); d.hl?.classList.remove('drop-on'); d.src.classList.remove('dragging');
  const drop = apply && myTurn() ? d.drop : null;
  const inst = S.s?.p[0].hand.find((c) => c.uid === d.uid);
  if (!drop || !inst) { hooks.render(); return; }
  const c = hcard(inst.id);
  S.sel = { k: 'hand', uid: inst.uid }; S.info = null; resetPend();
  if (drop.k === 'board') {
    S.pend.at = drop.at;
    // у карт с режимами (USP-S, FAMAS…) режим выбирается кнопкой, место уже запомнено
    if (c.modes) { hooks.render(); return; }
    S.pend.go = true; advancePlay();   // если нужна цель «При выходе» — дальше как обычно
    return;
  }
  S.pend.go = true;
  advancePlay(drop.k === 'target' ? drop.id : undefined);
}

export function hsClick(a: string, el: HTMLElement): boolean {
  const s = S.s;
  switch (a) {
    case 'hs-menu': S.s = null; S.tut = null; if (S.on && S.phase !== 'over') net.send({ t: 'resign' }); S.on = null; hooks.menu(); return true;
    case 'hs-cardinfo': S.info = S.info === el.dataset.v ? null : el.dataset.v!; break;
    case 'hs-closeinfo': S.info = null; break;
    case 'hs-pvmore': S.pvMore = !S.pvMore; if (S.pvMore) track('pv_more'); break;
    case 'hs-help': S.help = true; break;
    case 'hs-closehelp': S.help = false; break;
    case 'hs-fullrules': S.help = false; S.phase = 'rules'; break;
    case 'hs-open': hsOpen(); return true;
    case 'hs-side': S.setup.side = el.dataset.v as Side; break;
    case 'hs-knife': void knifePick(el.dataset.v as Move); return true;
    case 'hs-pickside':
      if (S.knife?.online) { if (!S.knife.online.sideSent) { S.knife.online.sideSent = true; net.send({ t: 'side', side: el.dataset.v as Side }); sfx.click(); } break; }
      S.side = el.dataset.v as Side; sfx.click(); startMatch(); return true;
    case 'hs-knife-go': S.side = other(S.knife!.botSide!); startMatch(); return true;
    case 'hs-diff': S.setup.diff = el.dataset.v as Diff; break;
    case 'hs-agent': S.setup[el.dataset.side as Side] = el.dataset.v!; break;
    case 'hs-go': S.tut = null; startKnife(); return true;
    case 'hs-tutorial': startTutorial(); return true;
    case 'hs-share': void shareNow(); return true;
    case 'hs-mull': { const u = el.dataset.uid!; if (S.mull.has(u)) S.mull.delete(u); else S.mull.add(u); sfx.click(); break; }
    case 'hs-keep': void confirmMulligan(); return true;
    case 'hs-ent': if (s) onEntity(el.dataset.hid!); return true;
    case 'hs-card': {
      if (!s) return true;
      const uid = el.dataset.uid!;
      S.info = null;
      S.sel = S.sel?.k === 'hand' && S.sel.uid === uid ? null : { k: 'hand', uid };
      resetPend();
      sfx.click();
      break;
    }
    case 'hs-play': if (S.sel?.k === 'hand' && myTurn()) {
      if (el.dataset.mode !== undefined) S.pend.mode = Number(el.dataset.mode);
      const was = S.pend.go; S.pend.go = true;
      if (was && playStage() === 'target') { advancePlay(undefined); return true; }   // «Без цели»
      advancePlay(); return true;
    } break;
    case 'hs-slot': if (S.sel?.k === 'hand' && myTurn()) { S.pend.at = Number(el.dataset.i); advancePlay(); return true; } break;
    case 'hs-save': if (s && myTurn() && canSave(s, 0, el.dataset.id!)) { void act({ k: 'save', id: el.dataset.id! }, 0); return true; } sfx.deny(); break;
    case 'hs-log': S.showLog = !S.showLog; break;
    case 'hs-mapinfo': S.info = S.info === 'map' ? null : 'map'; break;
    case 'hs-power': {
      if (!s || !myTurn()) { S.info = 'power0'; break; }
      const t = powerTargets(s, 0);
      if (!t) { sfx.deny(); S.info = 'power0'; break; }
      if (!t.length) { void act({ k: 'power' }, 0); return true; }
      S.sel = S.sel?.k === 'power' ? null : { k: 'power' }; S.info = null;
      break;
    }
    case 'hs-foepower': S.info = S.info === 'power1' ? null : 'power1'; break;
    case 'hs-cancel': S.sel = null; S.info = null; resetPend(); break;
    case 'hs-shop': if (s && myTurn() && canShop(s, 0)) { void act({ k: 'shop' }, 0); return true; } sfx.deny(); S.info = 'shopinfo'; break;
    case 'hs-choose': if (s && s.turn === 0 && !S.busy && s.p[0].choice) { void act({ k: 'choose', i: Number(el.dataset.i) }, 0); return true; } break;
    case 'hs-trap': S.info = S.info === el.dataset.v ? null : el.dataset.v!; break;
    case 'hs-end': if (ecoReady() && !S.busy) { S.sel = null; resetPend(); S.info = 'eco'; sfx.click(); break; } void playerEndTurn(); return true;
    case 'hs-eco': S.info = null; void playerEndTurn(el.dataset.v as EcoPick); return true;
    case 'hs-again': if (S.on) { S.on = null; S.s = null; openLobby(); return true; } hsOpen(); return true;
    case 'hs-lobby': S.on = null; S.s = null; openLobby(); return true;
    case 'hs-queue': S.lobby.err = ''; if (net.send({ t: 'queue', agents: { T: S.setup.T, CT: S.setup.CT } })) { S.lobby.queued = true; queuedAt = Date.now(); track('online_queue', { elo: S.lobby.me?.rating ?? 0 }); sfx.click(); } else S.lobby.err = 'Нет связи с сервером'; break;
    case 'hs-agents': S.lobby.agentsOpen = !S.lobby.agentsOpen; break;
    case 'hs-unqueue': net.send({ t: 'unqueue' }); S.lobby.queued = false; S.lobby.range = null; break;
    case 'hs-duel-create': S.lobby.err = ''; S.lobby.copied = false; if (!net.send({ t: 'duel_create', agents: { T: S.setup.T, CT: S.setup.CT } })) S.lobby.err = 'Нет связи с сервером'; break;
    case 'hs-duel-cancel': net.send({ t: 'duel_cancel' }); S.lobby.duel = null; break;
    case 'hs-duel-share': if (S.lobby.duel) { const code = S.lobby.duel; void net.shareLink(net.duelLink(code), `Дуэль в «Клатче»! Код ${code}`).then((r) => { S.lobby.copied = r === 'copy'; hooks.render(); }); } return true;
    case 'hs-duel-join': {
      const code = (hooks.root.querySelector<HTMLInputElement>('#duelcode')?.value ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) { S.lobby.err = 'Код — 6 букв и цифр'; break; }
      S.lobby.err = ''; net.send({ t: 'duel_join', code, agents: { T: S.setup.T, CT: S.setup.CT } }); break;
    }
    case 'hs-top': S.phase = 'top'; net.send({ t: 'top' }); break;
    case 'hs-player': if (el.dataset.id) { if (S.phase !== 'player') S.lobby.playerFrom = S.phase; S.lobby.player = null; S.phase = 'player'; net.send({ t: 'player', id: el.dataset.id }); } break;
    case 'hs-player-back': S.phase = S.lobby.playerFrom === 'player' ? 'rating' : S.lobby.playerFrom; S.lobby.player = null; if (S.phase === 'rating') net.send({ t: 'friends' }); break;
    case 'hs-friend-add': track('friend_add'); net.send({ t: 'friend_add', id: el.dataset.id! }); { const pl = S.lobby.player; if (pl && pl.me.id === el.dataset.id) pl.friend = true; } sfx.click(); break;
    case 'hs-friend-del': net.send({ t: 'friend_del', id: el.dataset.id! }); { const pl = S.lobby.player; if (pl && pl.me.id === el.dataset.id) pl.friend = false; } break;
    case 'hs-invite': track('invite_send'); S.lobby.err = ''; if (!net.send({ t: 'invite', id: el.dataset.id!, agents: { T: S.setup.T, CT: S.setup.CT } })) S.lobby.err = 'Нет связи с сервером'; sfx.click(); break;
    case 'hs-rematch': if (S.lobby.rematch !== 'gone') { track('rematch', { st: S.lobby.rematch || 'ask' }); net.send({ t: 'rematch', agents: { T: S.setup.T, CT: S.setup.CT } }); sfx.click(); } break;
    case 'hs-rating': openLobby('rating'); return true;
    case 'hs-findmatch': openLobby('lobby'); return true;
    case 'hs-ban': if (S.on?.veto?.myTurn) { net.send({ t: 'ban', map: el.dataset.v! }); sfx.click(); } break;
    case 'hs-resign': if (!S.on) break; if (S.on.confirmResign) { net.send({ t: 'resign' }); S.on.confirmResign = false; } else { S.on.confirmResign = true; setTimeout(() => { if (S.on) { S.on.confirmResign = false; hooks.render(); } }, 3000); } break;
    case 'hs-radio': S.radioOpen = !S.radioOpen; break;
    case 'hs-radiosay': {
      const k = el.dataset.v as VoKey; S.radioOpen = false;
      if (S.on && net.send({ t: 'radio', key: k })) { const s0 = S.s; if (s0) say(k, shortName(s0.p[0].hero.agent), mySide(), true, s0.p[0].hero.agent); }
      break;
    }
    default: return false;
  }
  hooks.render();
  return true;
}

// ─────────────────────────── Разметка ───────────────────────────
export function hsHTML(): string {
  if (S.phase === 'lobby') return lobbyHTML();
  if (S.phase === 'veto') return vetoHTML();
  if (S.phase === 'top') return topHTML();
  if (S.phase === 'player') return playerHTML();
  if (S.phase === 'rating') return ratingHTML();
  if (S.phase === 'cards') return catalogHTML();
  if (S.phase === 'rules') return rulesHTML();
  if (S.phase === 'knife' || S.phase === 'sidepick') return knifeHTML();
  if (S.phase === 'setup' || !S.s) return setupHTML();
  return boardHTML();
}

function setupHTML() {
  const st = S.setup;
  const list = (side: Side) => AGENTS.filter((a) => a.side === side).map((a) =>
    `<button class="rm-agent f-${side} ${st[side] === a.id ? 'on' : ''}" data-act="hs-agent" data-side="${side}" data-v="${a.id}">
      <span class="portrait xs">${agentArt(side, a.id)}</span><b>${esc(a.name)}</b>${styleTag(styleOf(a.id))}</button>`).join('');
  const detail = (side: Side) => {
    const id = st[side], pw = POWERS[id];
    return `<div class="rm-detail f-${side}"><span>Сила героя <em class="hs-pw">${esc(pw.name)}</em>: ${esc(pw.text)}</span>
      <small>Герой ${maxHp(id)} HP. ${esc(STYLE_RU[styleOf(id)].passive.replace(/^Герой \d+ HP; /, ''))}</small>
      <small class="hs-sig">Классовые: ${sigCards(id).map((c) => esc(hcard(c).name)).join(', ')}</small></div>`;
  };
  const help = S.help ? `<div class="hs-ov help" data-act="hs-closehelp"><div class="hs-ovbox rm-help" data-act="">
      <h3>Коротко о правилах</h3>
      <p class="note">Снимите герою соперника ${HS.heroHp} HP. Деньги — это мана: ${money(HS.firstIncome)} в первый ход, дальше на ${money(HS.income)} больше. T побеждают и бомбой (она всегда в стартовой руке T), если CT не уничтожат её за ${HS.bombTimer} хода; боец T рядом с бомбой стреляет в сапёров. Перед партией — ножевой раунд: победитель выбирает сторону.</p>
      ${counterTableHTML()}${stylesHTML()}
      <div class="rm-helpbtns"><button class="ghost" data-act="hs-fullrules">Все правила</button><button class="primary" data-act="hs-closehelp">Понятно</button></div>
    </div></div>` : '';
  return `<main class="rm scroll rm-setup">
    <header class="rm-head"><button class="ghost sm" data-act="hs-menu">← Меню</button><span class="rm-title">Новая игра</span><button class="ghost sm rm-q" data-act="hs-help" title="Справка">?</button></header>
    <p class="rm-knifenote">Сторону решит ножевой раунд: победитель выбирает T или CT, дальше — одна партия. Выберите героя для каждой стороны.</p>
    <h4 class="sub">Сложность</h4>
    <div class="seg wide">${(['easy', 'normal', 'hard'] as Diff[]).map((x) => `<button class="${x === st.diff ? 'on' : ''}" data-act="hs-diff" data-v="${x}">${DIFF_RU[x]}</button>`).join('')}</div>
    <h4 class="sub">Герой CT</h4><div class="rm-agents">${list('CT')}</div>${detail('CT')}
    <h4 class="sub">Герой T</h4><div class="rm-agents">${list('T')}</div>${detail('T')}
    <button class="primary big-btn" data-act="hs-go">В бой</button>
  </main>${help}`;
}

function kwChips(u: HUnit) {
  const k = u.kw, out: string[] = [];
  if (k.includes('headshot')) out.push('<i title="Хедшот">HS</i>');
  if (k.includes('twice')) out.push('<i title="Очередь">×2</i>');
  if (k.includes('sniper')) out.push('<i title="Снайпер">⌖</i>');
  if (k.includes('cleave')) out.push('<i title="Дробь">⋔</i>');
  if (k.includes('suppress')) out.push('<i title="Подавление">≡</i>');
  if (k.includes('helmet')) out.push('<i title="Шлем" class="hm"></i>');
  if (u.reloading) out.push('<i title="Перезарядка">⟳</i>');
  return out.length ? `<span class="hu-kw">${out.join('')}</span>` : '';
}

function unitHTML(u: HUnit, p: PI, tg: Set<string>) {
  const s = S.s!;
  const c = hcard(u.card);
  const side = c.side === 'N' ? s.p[p].hero.side : c.side;
  const ready = p === 0 && myTurn() && canAttack(s, 0, u.uid) && attackTargets(s, 0, u.uid).length > 0;
  const art = unitArt(c, s.p[p].hero.side);
  const cls = ['hu', `f-${side}`, `c-${u.card}`, art ? 'art' : '',
    u.kw.includes('taunt') ? 'taunt' : '', u.kw.includes('stealth') ? 'stealth' : '', u.blind ? 'blind' : '', u.kw.includes('vet') ? 'vet' : '',
    u.burn ? 'burn' : '', ready ? 'ready' : '', u.marked ? 'marked' : '', tg.has(u.uid) ? 'tgt' : '', S.sel?.k === 'atk' && S.sel.id === u.uid ? 'picked' : '',
    S.info === u.uid ? 'inspect' : '', c.kind === 'bomb' ? 'bomb' : ''].filter(Boolean).join(' ');
  const base = c.hp ?? 1;
  // Подсказка контр-класса: на цели видно, сколько добавит выбранный атакующий
  let bonus = 0;
  if (tg.has(u.uid) && S.sel?.k === 'atk' && S.sel.id !== 'h0') { const a = findUnit(s, S.sel.id); if (a) bonus = attackBonus(s, 0, a.u, u); }
  const covered = !u.kw.includes('taunt') && c.kind !== 'bomb' && isCovered(s.p[p].board, u);
  const clutch = c.kind !== 'bomb' && isClutch(s, p);
  const blink = c.kind === 'bomb' ? ` style="--blink:${[0.25, 0.25, 0.45, 0.8][Math.min(u.bomb ?? 3, 3)]}s"` : '';
  return `<button class="${cls}" data-act="hs-ent" data-hid="${u.uid}"${blink}>
    <span class="hu-art${art ? ' full' : ''}"><img src="${esc(art ?? hImg(c))}" alt="">${u.blind ? '<i class="st-blind"><b></b><b></b><b></b></i>' : ''}${u.burn ? '<i class="st-fire"><b></b><b></b><b></b><b></b></i>' : ''}</span>
    ${c.kind === 'unit' && CLASS_SIL[c.cls] ? `<span class="hu-cls" title="${esc(clsRu(c.cls))}">${typeIcon(c)}</span>` : ''}
    ${kwChips(u)}${u.armor ? `<b class="hu-arm" title="Броня ${u.armor}"><i>${u.armor}</i></b>` : ''}${u.kw.includes('vet') ? '<b class="hu-vet" title="Ветеран"><i>★</i></b>' : ''}${bonus ? `<em class="hu-bonus">+${bonus}</em>` : ''}${c.kind === 'bomb' && bombGuarded(s.p[p].board, u) ? '<em class="hu-tag guard">под охраной</em>' : ''}${u.marked ? '<em class="hu-tag trade">трейд +2</em>' : clutch ? '<em class="hu-tag clutch">клатч</em>' : ''}${covered ? '<i class="hu-cov" title="За укрытием: снайперы не достанут"></i>' : ''}
    ${c.kind === 'bomb' ? `<b class="hu-timer">${u.bomb}</b>` : `<b class="hu-atk ${u.atk > (c.atk ?? 0) ? 'up' : ''}"><i>${u.atk}</i></b>`}
    <b class="hu-hp ${u.hp < u.maxHp ? 'dmg' : u.maxHp > base ? 'up' : ''}"><i>${u.hp}</i></b>
  </button>`;
}

function pips(m: number) {
  const n = Math.min(8, Math.floor(m / 1000));
  return `<span class="hs-pips">${Array.from({ length: 8 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function heroHTML(p: PI, tg: Set<string>) {
  const s = S.s!;
  const P = s.p[p], h = P.hero, a = agent(h.agent);
  const id = heroId(p);
  const ready = p === 0 && myTurn() && canAttack(s, 0, id) && attackTargets(s, 0, id).length > 0;
  const pw = POWERS[h.agent];
  const canPw = p === 0 && myTurn() && !!powerTargets(s, 0);
  const nextLoss = isBehind(s, p) ? lossBonus({ lossStreak: P.lossStreak + 1 }) : 0;
  const next = Math.min(HS.maxMoney, incomeOf(P) + Math.min(P.money, HS.carry)) + P.bonus + nextLoss;
  if (cashOf !== gameKey()) { cashOf = gameKey(); shownCash[0] = s.p[0].money; shownCash[1] = s.p[1].money; }
  const cash = `<div class="hs-cash" id="cash${p}"><b data-cash="${p}" data-to="${P.money}" data-at="${shownCash[p]}">${moneyHTML(shownCash[p]!)}</b>${pips(P.money)}
      ${P.lossStreak ? `<small class="hs-loss">отставание ×${Math.min(P.lossStreak, HS.lossMax)}: +${money(lossBonus(P))}</small>` : ''}
      ${p === 0 ? `<small class="hs-next">+${money(Math.max(0, next - Math.min(P.money, HS.carry)))} в след. ход</small>` : `<small>${P.hand.length} в руке · ${P.deck.length} в колоде</small>`}
      ${p === 0 ? `<button class="hs-shopbtn ${canShop(s, 0) && myTurn() ? 'can' : ''}" data-act="hs-shop">Бай-меню · ${money(shopPrice(P))}</button>` : ''}</div>`;
  const power = `<button class="hs-pwbtn f-${h.side} ${P.powerUsed ? 'used' : ''} ${canPw ? 'can' : ''} ${S.sel?.k === 'power' && p === 0 ? 'picked' : ''}" data-act="${p === 0 ? 'hs-power' : 'hs-foepower'}">
      <span class="pw-gem"><svg viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICON.spell}</svg></span><b>${esc(pw.name)}</b><small>${money(pw.cost)}</small></button>`;
  const hero = `<div class="hs-herowrap"><button class="hh f-${h.side} ${tg.has(id) ? 'tgt' : ''} ${ready ? 'ready' : ''} ${S.sel?.k === 'atk' && S.sel.id === id ? 'picked' : ''}" data-act="hs-ent" data-hid="${id}">
      <span class="portrait">${agentArt(h.side, h.agent)}</span>
      ${h.atk ? `<b class="hh-atk"><i>${h.atk}</i></b>` : ''}${h.armor ? `<b class="hh-arm"><i>${h.armor}</i></b>` : ''}
      <b class="hh-hp ${h.hp < maxHp(h.agent) ? 'dmg' : ''}"><i>${h.hp}</i></b></button>
      <small class="hh-name">${styleTag(styleOf(h.agent))} ${p === 0 ? 'Вы' : S.on ? esc(S.on.opp.name) : 'Бот'} · ${esc(a.name)}</small></div>`;
  const traps = P.traps.length ? `<span class="hs-traps">${P.traps.map((t) => p === 0
    ? `<button class="hs-trap" data-act="hs-trap" data-v="trap:${t.id}" title="${esc(hcard(t.id).name)}">${esc(hcard(t.id).name)}</button>`
    : '<i class="hs-trap back">?</i>').join('')}</span>` : '';
  return `<div class="hs-hero p${p}">${cash.replace('</div>', traps + '</div>')}${hero}${power}</div>`;
}

function handCardHTML(c: HCard, uid: string, i: number, n: number, can: boolean, free = false, cost = c.cost) {
  const sel = S.sel?.k === 'hand' && S.sel.uid === uid;
  const rot = (i - (n - 1) / 2) * Math.min(5, 30 / Math.max(n, 1));
  return `<button class="hc f-${c.side} ${can ? 'can' : ''} ${sel ? 'sel' : ''}" data-act="hs-card" data-uid="${uid}" style="--r:${rot.toFixed(1)}deg;--i:${i}">
    ${cardFace(c, free, cost)}</button>`;
}
/** Значок типа карты внизу рамки. */
const TYPE_ICON: Partial<Record<HCard['cls'], string>> = {
  pistol: '<path d="M3 9h13l1 2h3v3h-6l-1 2h-3l-1 5H6l1-5H3z"/>',
  smg: '<path d="M2 8h16l2 2h2v3h-5v6h-3l-1-6H9l-1 3H5l1-3H2z"/>',
  shotgun: '<path d="M1 9h21v3H11l-1 2H6l-1 4H2l1-4H1z"/>',
  rifle: '<path d="M1 10h15l2-2h5v3h-4l-2 2h-3l-1 6h-3l1-6H7l-1 3H3l1-3H1z"/>',
  sniper: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  heavy: '<path d="M1 9h18l3-2v8l-3-2H14v6h-4v-6H1z"/>',
  cover: '<path d="M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5z"/>',
  token: '<circle cx="12" cy="12" r="6"/>',
  spell: '<path d="M12 1l2.6 7.4L22 9l-6 4.6L18 21l-6-4.4L6 21l2-7.4L2 9l7.4-.6z"/>',
  trap: '<path d="M12 5c5 0 9 4 10 7-1 3-5 7-10 7S3 15 2 12c1-3 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  bomb: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M8 7V4h8v3"/>',
};
const typeIcon = (c: HCard) => (CLASS_SIL[c.cls] && SIL.has(CLASS_SIL[c.cls]!) ? silHTML(CLASS_SIL[c.cls]!, `sil cls-${c.cls}`) : `<svg viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICON[c.cls] ?? TYPE_ICON.spell}</svg>`);
function cardFace(c: HCard, free = false, cost = c.cost, side: Side = mySide()) {
  const art = unitArt(c, side);
  return `<span class="hc-plate"></span>
    ${art ? `<span class="hc-full"><img src="${esc(art)}" alt=""></span>` : `<span class="hc-art"><img src="${esc(hImg(c))}" alt="" decoding="async"></span>`}
    <span class="hc-ribbon"><span class="hc-name">${esc(c.name)}</span></span>
    <span class="hc-type">${typeIcon(c)}</span>
    <span class="hc-cost ${free ? 'free' : ''} ${cost < c.cost ? 'cheap' : ''}"><i>${free ? '0' : cost ? (cost / 1000).toLocaleString('ru-RU') : '0'}</i></span>${free ? '<span class="hc-trophy">трофей</span>' : ''}${c.modes ? '<span class="hc-modes">⇄</span>' : ''}
    ${c.kind === 'unit' ? `<b class="hc-atk"><i>${c.atk}</i></b><b class="hc-hp"><i>${c.hp}</i></b>` : c.kind === 'bomb' ? `<b class="hc-hp"><i>${c.hp}</i></b>` : ''}`;
}
function kwShort(kw: KW[]) { const k = kw.filter((x) => x !== 'vet'); return k.length ? `<p class="hcb-kw">${k.map((x) => `<i>${KW_RU[x][0]}</i>`).join('')}</p>` : ''; }
function kwLines(kw: KW[]) { return kw.filter((k) => k !== 'vet').map((k) => `<li><b>${KW_RU[k][0]}.</b> ${KW_RU[k][1]}</li>`).join(''); }
function bigCardHTML(c: HCard, u?: HUnit, side: Side = mySide(), compact = false) {
  const kw = u ? u.kw : c.kw ?? [];
  const extra: string[] = [], state: string[] = [];
  if (u?.blind) state.push('<li><b>Ослеплён.</b> Пропустит следующую атаку и не ответит на выстрел.</li>');
  const armor = u ? u.armor : c.armor ?? 0;
  if (armor) extra.push(`<li><b>Броня ${armor}.</b> Каждое попадание пистолетов, ПП, дробовиков и гранат слабее на ${armor} (но 1 урон проходит).</li>`);
  const ci = CLASS_RU[c.cls];
  if (ci && c.kind === 'unit') extra.push(`<li class="good"><b>Силён:</b> ${esc(ci.good)}.</li><li class="bad"><b>Слаб:</b> ${esc(ci.bad)}.</li>`);
  if (c.sig) extra.push(`<li><b>Фирменная карта:</b> ${esc(agent(c.sig).name)}.</li>`);
  if (u?.burn) state.push('<li><b>Горит.</b> В начале хода 1 урон ему и соседям.</li>');
  if (u?.reloading) state.push('<li><b>Перезарядка.</b> Пропустит следующий ход.</li>');
  if (u?.bomb) state.push(`<li><b>Таймер.</b> Взрыв через ${u.bomb} ход(а) T.</li>`);
  if (u?.marked) state.push('<li><b>Трейд.</b> Убил бойца соперника — по нему +2 урона до конца хода мстителя.</li>');
  if (c.modes && !u) extra.push(`<li><b>Режим на выбор:</b> ${c.modes.map((m) => `${esc(m.name)} (${esc(m.text)})`).join(' или ')}.</li>`);
  return `<div class="hcb f-${c.side}">
    <div class="hc big">${cardFace(c, false, c.cost, side)}</div>
    <div class="hcb-txt"><b>${esc(c.name)}</b><small>${money(c.cost)} · <span class="hcb-cls">${typeIcon(c)}</span>${c.kind === 'spell' ? 'действие' : c.kind === 'bomb' ? 'бомба' : c.kind === 'trap' ? 'засада' : clsRu(c.cls)}${u?.kw.includes('vet') ? ' · ★ ветеран' : ''}</small>
      ${c.text ? `<p>${esc(c.text)}</p>` : ''}${compact && !S.pvMore ? `<ul>${state.join('')}</ul>${kwShort(kw)}${extra.length || kw.some((k) => k !== 'vet') ? '<button class="hcb-more" data-act="hs-pvmore">Подробнее ▾</button>' : ''}`
        : `<ul>${state.join('')}${kwLines(kw)}${extra.join('')}</ul>${compact ? '<button class="hcb-more" data-act="hs-pvmore">Короче ▴</button>' : ''}`}</div></div>`;
}
const clsRu = (c: HCard['cls']) => ({ pistol: 'пистолет', smg: 'пистолет-пулемёт', shotgun: 'дробовик', rifle: 'винтовка', sniper: 'снайперская винтовка', heavy: 'пулемёт', cover: 'укрытие', token: 'жетон', spell: 'действие', bomb: 'бомба', trap: 'засада' })[c];

function infoHTML(): string {
  const s = S.s!;
  if (S.sel?.k === 'hand') {
    const inst = s.p[0].hand.find((x) => x.uid === (S.sel as { uid: string }).uid);
    if (!inst) return '';
    const c = hcard(inst.id);
    const t = myTurn() ? playTargets(s, 0, c.id, !!inst.free) : null;
    let btn = '';
    if (!myTurn()) btn = '<span class="hs-hint">Сейчас ход соперника</span>';
    else if (!inst.free && s.p[0].money < costOf(s, c.id)) btn = `<span class="hs-hint">Не хватает ${money(costOf(s, c.id) - s.p[0].money)}</span>`;
    else if (!t) btn = `<span class="hs-hint">${(c.kind === 'unit' || c.kind === 'bomb') && s.p[0].board.length >= HS.board ? 'Стол заполнен' : c.kind === 'trap' ? 'Засад уже максимум или такая уже стоит' : 'Сейчас не сыграть — нет цели'}</span>`;
    else if (playStage() === 'place') {
      return `<div class="hs-pv slim"><span class="hs-hint"><b>${esc(c.name)}</b>: выберите место на столе — соседи важны (дробь, флешка, укрытие от снайперов)</span>
        <span class="hs-pvbtns"><button class="ghost sm" data-act="hs-cancel">Отмена</button></span></div>`;
    } else if (playStage() === 'preview' && c.modes) btn = c.modes.map((m, i) => `<button class="primary sm mode" data-act="hs-play" data-mode="${i}"><b>${esc(m.name)}</b><small>${esc(m.text)}</small></button>`).join('');
    else if (playStage() === 'preview') btn = `<button class="primary sm" data-act="hs-play">${c.kind === 'spell' ? 'Применить' : c.kind === 'bomb' ? 'Заложить' : c.kind === 'trap' ? 'Поставить' : 'На стол'}</button>`;
    else {
      // Нужна цель: карточку сворачиваем в узкую полосу, чтобы не закрывать стол и своего героя
      return `<div class="hs-pv slim"><span class="hs-hint"><b>${esc(c.name)}</b>: выберите цель${c.text ? ` — ${esc(c.text)}` : ''}</span>
        <span class="hs-pvbtns">${c.bcOptional ? '<button class="ghost sm" data-act="hs-play">Без цели</button>' : ''}<button class="ghost sm" data-act="hs-cancel">Отмена</button></span></div>`;
    }
    return `<div class="hs-pv">${bigCardHTML(c, undefined, mySide(), true)}${inst.free ? '<p class="hs-hint trophy">Трофей: выбитое у соперника оружие, ставится бесплатно.</p>' : ''}<div class="hs-pvbtns">${btn}<button class="ghost sm" data-act="hs-cancel">Отмена</button></div></div>`;
  }
  if (S.sel?.k === 'power') return `<div class="hs-pv slim"><span class="hs-hint">Сила героя: выберите цель</span><button class="ghost sm" data-act="hs-cancel">Отмена</button></div>`;
  if (S.sel?.k === 'atk') {
    const id = S.sel.id;
    const sv = id !== 'h0' && canSave(s, 0, id) ? `<button class="ghost sm" data-act="hs-save" data-id="${id}" title="Увести бойца и вернуть карту в руку">Сейв</button>` : '';
    return `<div class="hs-pv slim"><span class="hs-hint">Выберите, кого атаковать${sv ? ' — или сейв: увести бойца в руку' : ''}</span><span class="hs-pvbtns">${sv}<button class="ghost sm" data-act="hs-cancel">Отмена</button></span></div>`;
  }
  const id = S.info;
  if (!id) return '';
  if (id === 'power0' || id === 'power1') {
    const P = s.p[id === 'power0' ? 0 : 1], pw = POWERS[P.hero.agent];
    return `<div class="hs-pv slim" data-act="hs-cancel"><span class="hs-hint"><b>${esc(pw.name)}</b> · ${money(pw.cost)} · раз в ход. ${esc(pw.text)}${P.powerUsed ? ' Уже использована.' : ''}</span></div>`;
  }
  if (id === 'shopinfo') return `<div class="hs-pv slim" data-act="hs-cancel"><span class="hs-hint"><b>Бай-меню</b> · сейчас ${money(shopPrice(s.p[0]))}: выберите 1 из ${HS.shopChoice} карт своего агента и стороны. Каждая следующая покупка за ход дороже на ${money(HS.shopCost)}. ${s.p[0].hand.length >= HS.hand ? 'Рука полна.' : ''}</span></div>`;
  if (id === 'map') return `<div class="hs-pv slim" data-act="hs-cancel"><span class="hs-hint"><b>${esc(mapDef(S.map).name)}</b>: ${esc(MAP_RULES[S.map] ?? '')}</span></div>`;
  if (id.startsWith('trap:')) { const c = hcard(id.slice(5)); return `<div class="hs-pv" data-act="hs-cancel">${bigCardHTML(c, undefined, mySide(), true)}</div>`; }
  if (id === 'h0' || id === 'h1') {
    const P = s.p[id === 'h0' ? 0 : 1], a = agent(P.hero.agent), pw = POWERS[P.hero.agent];
    return `<div class="hs-pv slim" data-act="hs-cancel"><span class="hs-hint"><b>${esc(a.name)}</b> (${P.hero.side}) · ${P.hero.hp} HP${P.hero.armor ? ` + ${P.hero.armor} брони` : ''}. Сила: ${esc(pw.name)} — ${esc(pw.text)}</span></div>`;
  }
  const f = findUnit(s, id);
  if (!f) return '';
  const sv = f.p === 0 && myTurn() && canSave(s, 0, id) ? `<div class="hs-pvbtns"><button class="ghost sm" data-act="hs-save" data-id="${id}">Сейв: вернуть в руку</button></div>` : '';
  return `<div class="hs-pv"><div data-act="hs-cancel">${bigCardHTML(hcard(f.u.card), f.u, s.p[f.p].hero.side, true)}</div>${sv}</div>`;
}

function boardHTML() {
  const s = S.s!;
  const tg = new Set(currentTargets());
  const me = s.p[0], en = s.p[1];
  const bomb = [...me.board, ...en.board].find((u) => u.card === 'c4');
  const acts = myTurn() ? legalActions(s, 0) : [];
  const idle = myTurn() && !acts.length;
  const n = me.hand.length;
  const ov = n > 1 ? Math.max(0, (n * 62 - Math.min(innerWidth - 24, 420)) / (n - 1)) : 0;
  const hand = me.hand.map((c, i) => handCardHTML(hcard(c.id), c.uid, i, n, myTurn() && !!playTargets(s, 0, c.id, !!c.free), !!c.free, costOf(s, c.id))).join('');
  const nb = en.hand.length;
  const backs = Array.from({ length: nb }, (_, i) => { const k = i - (nb - 1) / 2; return `<i style="--r:${(k * 5).toFixed(1)}deg;--y:${(Math.abs(k) * 1.6).toFixed(1)}px"></i>`; }).join('');
  const mp = mapDef(S.map);
  return `<main class="hs has-art map-${S.map}" style="--map:url('${esc(cssUrl(mp.image))}');--art:url('${esc(cssUrl(boardImg(S.map)))}');${boardVars(S.map)}">
    ${boardScene(S.map)}
    <header class="hs-top">
      ${S.on ? `<button class="ghost sm ${S.on.confirmResign ? 'danger' : ''}" data-act="hs-resign">${S.on.confirmResign ? 'Точно сдаться?' : 'Сдаться'}</button>` : '<button class="ghost sm" data-act="hs-menu">← Меню</button>'}
      <button class="hs-title" data-act="hs-mapinfo" title="Особенность карты">${esc(mp.name)}</button>
      ${S.on ? `<span class="score on"><b>${esc(S.on.opp.name)}</b>${S.on.oppOnline ? '' : ` <i class="hs-off">не в сети <span class="hs-timer" data-dl="${S.on.graceUntil ?? 0}"></span></i>`}</span>`
        : `<span class="score"><b>Вы ${S.score[0]}</b><i>:</i><b>${S.score[1]} Бот</b></span>`}
    </header>
    ${heroHTML(1, tg)}
    <div class="hs-backs" style="--back:url('${esc(cssUrl(backImg(other(mySide()))))}')">${backs}</div>
    <div class="hs-board b1 ${zoneCls('b1')}" style="--n:${HS.board}">${en.board.map((u) => unitHTML(u, 1, tg)).join('') || '<span class="hs-empty"></span>'}</div>
    <div class="hs-mid ${S.on ? 'has-tb' : ''}">${S.on ? turnBombHTML() : ''}${boardEmblem(S.map)}
      <span class="hs-midl">${bomb ? `<span class="hs-bomb">C4 · ${bomb.bomb}</span>` : ''}<button class="hs-logbtn" data-act="hs-log">Журнал · ход ${Math.ceil(s.turnNo / 2)}</button>${S.on ? radioHTML() : ''}</span>
      <span class="hs-status">${s.turn === 0 && !S.busy ? 'Ваш ход' : esc(S.last || (s.turn === 0 ? '…' : 'Ход соперника'))}</span>
      ${ecoReady() ? '<button class="hs-end eco" data-act="hs-end" title="Вы ничего не сыграли: возьмите 2 карты или деньги на следующий ход">Эко раунд</button>'
        : `<button class="hs-end ${idle ? 'idle' : ''}" data-act="hs-end" ${myTurn() ? '' : 'disabled'}>${s.turn === 0 ? 'Конец хода' : 'Ждите'}</button>`}
    </div>
    <div class="hs-board b0 ${playStage() === 'place' ? 'placing' : ''} ${zoneCls('b0')}" style="--n:${HS.board}">${playStage() === 'place'
      ? [...me.board.map((u, i) => `<button class="hs-slot" data-act="hs-slot" data-i="${i}" aria-label="Поставить сюда">+</button>${unitHTML(u, 0, tg)}`), `<button class="hs-slot" data-act="hs-slot" data-i="${me.board.length}" aria-label="Поставить сюда">+</button>`].join('')
      : me.board.map((u) => unitHTML(u, 0, tg)).join('') || (zones().b0 ? '<span class="hs-empty">Поставьте карту сюда</span>' : '<span class="hs-empty"></span>')}</div>
    <div class="hs-hand" style="--ov:${ov.toFixed(1)}px">${hand}</div>
    ${heroHTML(0, tg)}
    ${infoHTML()}
    ${S.showLog ? journalHTML() : ''}
    ${S.phase === 'play' && s.turn === 0 && me.choice && !S.busy ? choiceHTML() : ''}
    ${S.phase === 'mull' ? mullHTML() : ''}
    ${S.info === 'eco' && ecoReady() ? ecoHTML() : ''}
    ${S.phase === 'gameover' || S.phase === 'over' ? overHTML() : ''}
  </main>`;
}

function ecoHTML() {
  const P = S.s!.p[0];
  return `<div class="hs-ov eco-ov"><div class="hs-ovbox eco-box">
    <h3>Эко раунд</h3>
    <p class="note">В этом ходу вы ничего не купили и не выставили. Сэкономьте — выберите награду, ход перейдёт сопернику.</p>
    <div class="eco-opts">
      <button class="eco-opt" data-act="hs-eco" data-v="cards" ${P.hand.length >= HS.hand ? 'disabled' : ''}><b>+${HS.ecoCards}</b><span>карты в руку сейчас, деньги переносятся как обычно</span>${P.hand.length + HS.ecoCards > HS.hand ? '<small>лишние сгорят — рука до 7</small>' : ''}</button>
      <button class="eco-opt cash" data-act="hs-eco" data-v="cash"><b>+${money(HS.ecoCash)}</b><span>к деньгам следующего хода</span>${P.money ? `<small>вместо переноса ${money(Math.min(P.money, HS.carry))}</small>` : ''}</button>
    </div>
    <button class="ghost" data-act="hs-cancel">Ещё подумаю</button>
  </div></div>`;
}

function mullHTML() {
  const s = S.s!;
  const side = mySide();
  return `<div class="hs-ov"><div class="hs-ovbox">
    <h3>Вы за ${side === 'T' ? 'T — атака' : 'CT — защита'}</h3>
    <p class="note">${side === 'T' ? 'Вы ходите первым. ' : 'Вы ходите вторым: на 1 карту больше и «Дроп» (+$1 на один ход). '}Отметьте карты, которые хотите заменить.</p>
    <div class="hs-mull">${s.p[0].hand.map((c) => `<button class="hc f-${hcard(c.id).side} ${S.mull.has(c.uid) ? 'out' : ''}" data-act="hs-mull" data-uid="${c.uid}">${cardFace(hcard(c.id))}${S.mull.has(c.uid) ? '<em>Заменить</em>' : ''}</button>`).join('')}</div>
    <p class="hs-mapline"><b>${esc(mapDef(S.map).name)}</b> · ${esc(MAP_RULES[S.map] ?? '')}</p>
    ${matchupHTML(styleOf(S.setup[side]), styleOf(S.botAgent))}
    <p class="note">Соперник: ${esc(agent(S.botAgent).name)} · фирменные карты: ${sigCards(S.botAgent).map((id) => esc(hcard(id).name)).join(', ')}</p>
    ${S.on?.mullSent ? '<p class="hs-wait">Ждём соперника…</p>'
      : `<button class="primary big-btn" data-act="hs-keep">${S.mull.size ? `Заменить ${S.mull.size} и начать` : 'Оставить и начать'}</button>`}
    ${S.on ? `<p class="note">Осталось <b class="hs-timer" data-dl="${S.on.deadline}"></b></p>` : ''}
  </div></div>`;
}

function overHTML() {
  if (S.on?.result) return onlineOverHTML();
  const last = S.results[S.results.length - 1];
  const done = S.phase === 'over';
  const won = done ? S.score[0] > S.score[1] : last.win;
  const why = last.reason === 'bomb' ? 'Бомба взорвалась' : 'Герой повержен';
  return `<div class="hs-ov"><div class="hs-ovbox ${won ? 'win' : 'lose'}">
    <h2>${done ? (won ? 'Матч ваш!' : 'Матч проигран') : (last.win ? 'Победа' : 'Поражение')}</h2>
    <p class="note">${last.reason === 'bomb' ? 'Бомба взорвалась' : last.reason === 'defuse' ? 'Бомба обезврежена' : why}</p>
    ${mvpHTML()}
    <p class="note">Вы играли за ${last.side} · ${last.turns} ход.</p>
    ${S.tut ? '<p class="note">Обучение пройдено! Дальше — обычные матчи с ботом или онлайн.</p>' : ''}
    ${S.tut ? '' : '<button class="primary big-btn" data-act="hs-again">Ещё матч</button>'}<button class="${S.tut ? 'primary big-btn' : 'ghost'}" data-act="hs-share">Поделиться</button><button class="ghost" data-act="hs-menu">В меню</button>
  </div></div>`;
}

/** Короткая шпаргалка: кто кого контрит. */
function counterTableHTML() {
  const rows: [string, string, string][] = [
    ['ПП', 'снайперов: достают за укрытием, +2', 'брони и дробовиков'],
    ['Дробовик', 'ПП, пистолеты, укрытия: +2, бьёт соседей', 'снайперов'],
    ['Снайперка', 'дробовики и пулемёты: +2, без ответа', 'ПП, дыма и флешек'],
    ['Винтовка', 'пробивает броню', 'дорогая'],
    ['Пулемёт', 'держит линию, подавляет', 'гранат (+2) и снайперов'],
  ];
  return `<div class="hs-counter"><b>Кто кого</b><table>${rows.map(([a, g, b]) => `<tr><th>${a}</th><td class="g">сильнее против: ${g}</td><td class="b">боится: ${b}</td></tr>`).join('')}</table>
    <small>Броня режет урон пистолетов, ПП, дробовиков и гранат. Убийство делает бойца ветераном ★. Убил бойца, который ещё не нанёс урона, — его оружие с полным магазином уходит тебе в руку трофеем, бесплатно. Ослеплённые не стреляют в ответ. Засады лежат рубашкой вверх и срабатывают сами.</small></div>`;
}

/** Выбор карты: добор в начале хода или бай-меню. */
function choiceHTML() {
  const ch = S.s!.p[0].choice!;
  const title = ch.kind === 'draw' ? 'Добор: возьмите одну карту' : 'Бай-меню: выберите карту';
  const note = ch.kind === 'draw' ? 'Вторая уйдёт под низ колоды.' : 'Карта ляжет в руку, разыграть её можно сразу, если хватит денег.';
  return `<div class="hs-ov choice"><div class="hs-ovbox">
    <h3>${title}</h3><p class="note">${note}</p>
    <div class="hs-choice">${ch.opts.map((id, i) => `<button class="hs-opt" data-act="hs-choose" data-i="${i}">${bigCardHTML(hcard(id))}</button>`).join('')}</div>
  </div></div>`;
}

// ─────────────────────────── Все карты и правила ───────────────────────────
function catalogHTML() {
  const shown = HCARDS.filter((c) => c.cls !== 'token' && !(c.kind === 'unit' && c.cost === 0));
  const groups: [string, HCard[]][] = [
    ['Оружие обеих сторон', shown.filter((c) => c.kind === 'unit' && c.side === 'N' && !c.sig)],
    ['Оружие CT', shown.filter((c) => c.kind === 'unit' && c.side === 'CT' && !c.sig)],
    ['Оружие T', shown.filter((c) => c.kind === 'unit' && c.side === 'T' && !c.sig)],
    ['Гранаты, снаряжение, тактики', shown.filter((c) => (c.kind === 'spell' || c.kind === 'bomb') && !c.sig)],
    ['Засады', shown.filter((c) => c.kind === 'trap' && !c.sig)],
    ...AGENTS.map((a) => [`Фирменные: ${a.name}`, shown.filter((c) => c.sig === a.id)] as [string, HCard[]]),
  ];
  const info = S.info && HCARDS.some((c) => c.id === S.info) ? `<div class="hs-ov" data-act="hs-closeinfo"><div class="hs-ovbox">${bigCardHTML(hcard(S.info))}<button class="ghost" data-act="hs-closeinfo">Закрыть</button></div></div>` : '';
  return `<main class="rm scroll hscat">
    <header class="rm-head"><button class="ghost sm" data-act="hs-menu">← Меню</button><span class="rm-title">Все карты · ${shown.length}</span><span></span></header>
    <p class="note">Нажмите на карту, чтобы прочитать её свойства.</p>
    ${groups.map(([t, cs]) => `<h4 class="sub">${esc(t)}</h4><div class="hs-grid">${cs.map((c) => `<button class="hc f-${c.side}" data-act="hs-cardinfo" data-v="${c.id}">${cardFace(c)}</button>`).join('')}</div>`).join('')}
  </main>${info}`;
}

function rulesHTML() {
  const kws = (Object.keys(KW_RU) as KW[]).filter((k) => k !== 'vet');
  return `<main class="rm scroll hsrules">
    <header class="rm-head"><button class="ghost sm" data-act="hs-menu">← Меню</button><span class="rm-title">Как играть</span><span></span></header>
    <h4 class="sub">Цель</h4>
    <p>Снять герою соперника ${HS.heroHp} HP — или выиграть бомбой. T закладывают C4 (с ${HS.plantTurn}-го своего хода): не обезвредят за ${HS.bombTimer} хода — победа T, обезвредят — победа CT. Перед партией — ножевой раунд за выбор стороны.</p>
    <p><b>Бомба как в CS.</b> C4 у T всегда в стартовой руке. Закладка — ${money(HS.plantBonus)} в следующем ходу. У бомбы ${HS.bombHp} здоровья. Пока с обеих сторон от неё стоят бойцы T (не ослеплённые), её нельзя бить — сначала зачистите точку. Бомбу бьют в обход укрытий, сильнейший боец T рядом отвечает сапёру половиной атаки («Оборона» разминирует под прикрытием). Обезвредили — CT сразу побеждают.</p>
    <h4 class="sub">Ход</h4>
    <ul class="hs-ul">
      <li>Деньги — это мана: ${money(HS.firstIncome)} в первый ход и на ${money(HS.income)} больше каждый следующий (до ${money(HS.maxMoney)}). До ${money(HS.carry)} неистраченных переходят дальше.</li>
      <li>Как в CS: если в начале хода у вашего героя на ${HS.lossGap}+ здоровья меньше, чем у соперника, вы получаете бонус за отставание — +${money(HS.lossStep)} за каждый такой ход подряд, до +${money(HS.lossStep * HS.lossMax)}. Сравнялись — серия сбрасывается.</li>
      <li>В начале хода откройте 2 верхние карты колоды и возьмите одну. Бай-меню: выбрать 1 из ${HS.shopChoice} карт за ${money(HS.shopCost)}, вторая покупка за ход — ${money(HS.shopCost * 2)}, третья — ${money(HS.shopCost * 3)} и так далее.</li>
      <li>Ставьте бойцов (до ${HS.board} на столе), применяйте гранаты и снаряжение, ставьте засады (до ${HS.traps}).</li>
      <li>Каждый боец атакует раз в ход, начиная со следующего после выхода. Цель стреляет в ответ — кроме ослеплённых и тех, по кому бьёт снайпер.</li>
      <li>Сила героя — раз в ход, у каждого агента своя.</li>
    </ul>
    <h4 class="sub">Награды</h4>
    <ul class="hs-ul">
      <li>За убийство — деньги в следующем ходу ($0,3–0,6 по классу оружия).</li>
      <li>Убийство делает бойца ветераном ★ с бонусом своего класса.</li>
      <li>Если убитый не нанёс ни единицы урона, его оружие уходит вам в руку трофеем — бесплатно.</li>
    </ul>
    ${counterTableHTML()}
    ${stylesHTML()}
    <h4 class="sub">Механики из CS</h4>
    <ul class="hs-ul">
      <li><b>Позиция.</b> Ставя бойца, выбирайте место: дробь и флешка задевают соседей, бойцы рядом с Укрытием не видны вражеским снайперам (значок щита).</li>
      <li><b>Энтри.</b> Первое убийство бойцом в ваш ход — +$0,3 в следующем ходу (у «Раша» +$0,6 и +1 атаки бойцу).</li>
      <li><b>Эко раунд.</b> Ничего не сыграли за ход (ни карты, ни бай-меню, ни силы героя) — со второго хода вместо «Конец хода» горит «Эко раунд»: на выбор +2 карты сразу (деньги переносятся как обычно) или +$3 к деньгам следующего хода вместо переноса.</li>
      <li><b>Трейд.</b> Кто убил вашего бойца, помечен: ваши бойцы бьют его на 2 сильнее до конца вашего следующего хода.</li>
      <li><b>Клатч.</b> Ваш последний боец против двух и больше бьёт на 2 сильнее.</li>
      <li><b>Сейв.</b> Раз в ход можно увести бойца, который не стрелял и не вышел в этом ходу, — карта вернётся в руку.</li>
      <li><b>Режимы.</b> У части оружия (Glock, USP-S, FAMAS, Galil, M4A1-S, SG 553, AUG) при розыгрыше выбирается режим, значок ⇄.</li>
    </ul>
    <h4 class="sub">Локации</h4>
    <ul class="hs-ul">${Object.entries(MAP_RULES).map(([id, t]) => `<li><b>${esc(mapDef(id).name)}.</b> ${esc(t)}</li>`).join('')}</ul>
    <h4 class="sub">Свойства</h4>
    <ul class="hs-ul">${kws.map((k) => `<li><b>${KW_RU[k][0]}.</b> ${KW_RU[k][1]}</li>`).join('')}
      <li><b>Броня.</b> Каждое попадание пистолетов, ПП, дробовиков и гранат слабее на её величину (1 урон проходит всегда).</li></ul>
    <button class="primary big-btn" data-act="hs-open">Играть</button>
  </main>`;
}

// ─────────────────────────── Стили ───────────────────────────
const styleTag = (st: Style) => `<i class="hs-style st-${st}" title="${STYLE_RU[st].name}">${STYLE_RU[st].icon} ${STYLE_RU[st].name}</i>`;
function stylesHTML() {
  const order: Style[] = ['rush', 'hold', 'long'];
  return `<div class="hs-styles"><b>Стили агентов</b>
    <p class="note">Как классы в Hearthstone: раш бьёт дальнюю игру, оборона держит раш, дальняя игра ломает оборону.</p>
    ${order.map((st) => {
      const loses = order.find((o) => STYLE_BEATS[o] === st)!;
      const agents = AGENTS.filter((a) => styleOf(a.id) === st).map((a) => esc(a.name)).join(', ');
      return `<div class="hs-strow">${styleTag(st)}<span><small>${agents}</small><br>${esc(STYLE_RU[st].passive)}<br>
        <em class="g">сильнее: ${STYLE_RU[STYLE_BEATS[st]].name}</em> · <em class="b">слабее: ${STYLE_RU[loses].name}</em></span></div>`;
    }).join('')}</div>`;
}
function matchupHTML(me: Style, foe: Style) {
  const m = matchup(me, foe);
  const txt = m === 'good' ? `Выгодный матчап: ${STYLE_RU[me].name} против ${STYLE_RU[foe].name}` : m === 'bad' ? `Невыгодный матчап: ${STYLE_RU[me].name} против ${STYLE_RU[foe].name}` : `Равный матчап: ${STYLE_RU[me].name} против ${STYLE_RU[foe].name}`;
  const tip = m === 'bad' ? (me === 'rush' ? 'Не лезьте в укрытия — копите на гранаты и бейте героя.' : me === 'hold' ? 'Снайперы бьют поверх укрытий: давите ПП и не затягивайте.' : 'Ставьте укрытия и размен — раш выдохнется к 6–7 ходу.')
    : m === 'good' ? 'Играйте в свою игру — стиль на вашей стороне.' : 'Всё решат размены.';
  return `<p class="hs-match m-${m}"><b>${txt}</b><small>${tip}</small></p>`;
}

// ─────────────────────────── Журнал боя ───────────────────────────
const names = new Map<string, { name: string; mine: boolean }>();
function rememberNames(s: HState) {
  for (const p of [0, 1] as PI[]) for (const u of s.p[p].board) names.set(u.uid, { name: hcard(u.card).name, mine: p === 0 });
}
const nm = (id: string) => (id === 'h0' ? 'ваш герой' : id === 'h1' ? 'герой соперника' : (() => { const n = names.get(id); return n ? `${n.name}${n.mine ? '' : ' (враг)'}` : 'боец'; })());
const who = (p: PI) => (p === 0 ? 'Вы' : 'Соперник');
/** Подлежащее с глаголом: «Вы ставите» / «Соперник ставит». */
const sv = (p: PI, you: string, he: string) => `${who(p)} ${p === 0 ? you : he}`;
/** Перевести события в строки журнала. */
function logEvents(evs: Ev[], p: PI, a?: Action) {
  questTrack(evs, p);
  const out: { sep?: boolean; text: string }[] = [];
  let cur: string[] | null = null;
  const flush = () => { if (cur && cur.length) out.push({ text: cur.join(' · ') }); cur = null; };
  const add = (t: string) => { if (!cur) cur = []; cur.push(t); };
  if (a?.k === 'save') { /* опишет событие save */ }
  for (const e of evs) {
    switch (e.t) {
      case 'turn': flush(); out.push({ sep: true, text: `Ход ${Math.ceil(S.s!.turnNo / 2)} · ${e.p === 0 ? 'ваш' : 'соперника'}` }); break;
      case 'play': flush();
        if (e.card === 'trap') { out.push({ text: sv(e.p, 'ставите засаду', 'ставит засаду') }); break; }
        if (e.uid) cur = [`${sv(e.p, 'ставите', 'ставит')} ${hcard(e.card).name}${a?.k === 'play' && a.mode !== undefined && hcard(e.card).modes ? ` (${hcard(e.card).modes![a.mode].name.toLowerCase()})` : ''}`];
        else cur = [`${sv(e.p, 'применяете', 'применяет')} ${hcard(e.card).name}${e.target ? ` → ${nm(e.target)}` : ''}`];
        break;
      case 'power': flush(); cur = [`${who(e.p)}: сила героя «${POWERS[S.s!.p[e.p].hero.agent].name}»${e.target ? ` → ${nm(e.target)}` : ''}`]; break;
      case 'atk': flush(); cur = [`${nm(e.from)} → ${nm(e.to)}`]; break;
      case 'dmg': add(`${nm(e.id)} −${e.n}${e.hs ? ' (хедшот)' : ''}${e.blocked ? ` (броня −${e.blocked})` : ''}`); break;
      case 'die': add(`${nm(e.id)} убит`); break;
      case 'heal': add(`${nm(e.id)} +${e.n} HP`); break;
      case 'armor': add(`${nm(e.id)} +${e.n} брони`); break;
      case 'buff': add(`${nm(e.id)}: ${e.text}`); break;
      case 'blind': add(`${nm(e.id)} ослеплён`); break;
      case 'vet': add(`${nm(e.id)} — ${e.text.toLowerCase()}`); break;
      case 'entry': add(`энтри-фраг (${e.p === 0 ? 'вам' : 'сопернику'} деньги в след. ход)`); break;
      case 'mark': add(`${nm(e.id)} под трейдом`); break;
      case 'clutch': add('клатч +2'); break;
      case 'trap': flush(); out.push({ text: `Засада «${hcard(e.card).name}» (${e.p === 0 ? 'ваша' : 'соперника'})` }); break;
      case 'trophy': add(e.burned ? `трофей ${hcard(e.card).name} сгорел` : `${sv(e.p, 'получаете', 'получает')} трофей ${hcard(e.card).name}`); break;
      case 'save': flush(); out.push({ text: `${who(e.p)}: сейв — ${hcard(e.card).name} возвращается в руку` }); break;
      case 'eco': flush(); out.push({ text: `${who(e.p)}: эко раунд — ${e.pick === 'cards' ? `+${HS.ecoCards} карты` : `+${money(HS.ecoCash)} в след. ход`}` }); break;
      case 'cash': if (e.loss) { flush(); out.push({ text: `${who(e.p)}: бонус за отставание +${money(e.n)}` }); } break;
      case 'shop': flush(); out.push({ text: `${sv(e.p, 'покупаете', 'покупает')} карту в бай-меню` }); break;
      case 'fizzle': add(`«${hcard(e.card).name}» не сработала`); break;
      case 'draw': if (e.burned) { flush(); out.push({ text: `${who(e.p)}: рука полна, карта сгорела` }); } break;
      case 'fatigue': flush(); out.push({ text: `${who(e.p)}: колода пуста, −${e.n} герою` }); break;
      case 'bomb': if (e.left < HS.bombTimer) { flush(); out.push({ text: `Бомба: до взрыва ${e.left}` }); } break;
      case 'boom': flush(); out.push({ text: 'Бомба взорвалась' }); break;
      case 'defused': add('бомба уничтожена'); break;
    }
  }
  flush();
  S.journal.push(...out);
  if (S.journal.length > 200) S.journal.splice(0, S.journal.length - 200);
  const last = [...out].reverse().find((x) => !x.sep);
  if (last) S.last = last.text;
  void p;
}
function journalHTML() {
  const rows = [...S.journal].reverse().slice(0, 80);
  return `<div class="hs-ov log" data-act="hs-log"><div class="hs-ovbox hs-logbox">
    <h3>Журнал боя</h3>
    <ol class="hs-log">${rows.map((r) => r.sep ? `<li class="sep">${esc(r.text)}</li>` : `<li>${esc(r.text)}</li>`).join('') || '<li class="sep">Пока пусто</li>'}</ol>
    <button class="ghost" data-act="hs-log">Закрыть</button>
  </div></div>`;
}

// Для проверки эффектов: #fxtest в адресе открывает доступ к слою эффектов из консоли
// #autoplay — за игрока ходит тот же бот (для проверки оформления и долгих прогонов)
if (location.hash.includes('autoplay')) setInterval(() => {
  const s = S.s;
  if (!s || S.on || S.busy || S.phase !== 'play' || s.turn !== 0 || s.winner !== null) return;
  if (s.p[0].choice) { void act({ k: 'choose', i: 0 }, 0); return; }
  const a = botStep(s, 0, 'hard');
  if (a) void act(a, 0); else void playerEndTurn();
}, 300);
if (location.hash.includes('fxtest')) Object.assign(window, { __hs: S, __hsRender: () => hooks.render(), __kf: (h: string) => fx.killfeed(h, true) });
if (location.hash.includes('fxtest')) (window as unknown as { __fx: typeof fx; __say: typeof say }).__fx = fx, (window as unknown as { __say: typeof say }).__say = say;

// ─────────────────────────── Онлайн ───────────────────────────
// Сервер — судья: мы шлём действия, он отвечает шагами (step) с событиями и новым видом стола,
// где мы всегда игрок 0. Шаги проигрываются строго по очереди теми же анимациями, что и игра с ботом.
const ANN_PICK = new Set(['ancient', 'dust2', 'inferno', 'mirage', 'nuke']);   // для этих карт у диктора есть фраза
let netQueue: Promise<void> = Promise.resolve();
let queuedAt = 0;
let netReady = false;

function netInit() {
  if (netReady) return;
  netReady = true;
  net.onMessage((m) => { netQueue = netQueue.then(() => onNet(m)).catch((e) => console.error(e)); });
  net.onStatus(() => { if (S.phase === 'lobby' || S.phase === 'rating' || hooks.onMenu()) hooks.render(); });
}
/** Для главного меню: тихо подключиться к серверу, чтобы показать рейтинг. null — сервер не настроен или ещё нет ответа. */
export function hsProfile(): PlayerInfo | null {
  if (!S.lobby.me && net.serverUrl() && net.onlineStatus.state === 'offline' && !menuTried) { menuTried = true; netInit(); net.connect(); }
  return S.lobby.me;
}
let menuTried = false;
export { levelBadge as hsLevelBadge, levelProgress as hsLevelProgress };
function openLobby(page: 'lobby' | 'rating' = 'lobby') {
  S.phase = page; S.s = null; S.on = null; S.info = null; S.lobby.err = '';
  track(page === 'rating' ? 'rating_open' : 'online_open', { srv: !!net.serverUrl() });
  netInit();
  if (!net.connect()) S.lobby.err = 'Сервер онлайна не настроен (константа SERVER в src/online/client.ts).';
  else if (page === 'rating') { net.send({ t: 'profile' }); net.send({ t: 'top' }); net.send({ t: 'friends' }); }
  hooks.render();
}
/** Открыть лобби и сразу войти в дуэль по коду из ссылки-приглашения. */
export function hsJoinDuel(code: string) { S.lobby.pendingJoin = code; openLobby(); }

async function onNet(m: S2C) {
  const L = S.lobby;
  switch (m.t) {
    case 'me':
      L.me = m.me; L.season = m.season;
      if (S.phase === 'rating' && !L.history) { net.send({ t: 'profile' }); net.send({ t: 'top' }); net.send({ t: 'friends' }); }
      if (L.pendingJoin) { net.send({ t: 'duel_join', code: L.pendingJoin, agents: { T: S.setup.T, CT: S.setup.CT } }); L.pendingJoin = null; }
      break;
    case 'queued': L.queued = true; L.qsize = m.size; if (m.lo !== undefined) L.range = { lo: m.lo, hi: m.hi!, since: m.since! }; break;
    case 'profile': L.history = m.history; break;
    case 'duel_code': L.duel = m.code; break;
    case 'friends': L.friends = m.friends; L.recent = m.recent; break;
    case 'player': L.player = m; break;
    case 'invited':
      if (S.on && S.phase !== 'over') return;   // в матче вызовы не показываем (сервер и так отвечает «занят»)
      L.invite = { code: m.code, from: m.from }; haptic.win(); sfx.turn();
      setTimeout(() => { if (L.invite?.code === m.code) { L.invite = null; hooks.render(); } }, 60_000);
      break;
    case 'invite_status': {
      const txt = { sent: `Вызов отправлен: ${m.name}. Ждём ответа…`, declined: `${m.name} отклонил вызов`, offline: `${m.name} сейчас не в сети`, busy: `${m.name} сейчас в матче`, expired: `${m.name} не ответил на вызов` }[m.state];
      L.invNote = txt;
      if (m.state === 'sent') { if (S.phase !== 'lobby') { S.phase = 'lobby'; S.s = null; S.on = null; } }
      else { if (m.state !== 'busy' && m.state !== 'offline') L.duel = null; fx.banner(txt, 'info', 1800); }
      break;
    }
    case 'rematch':
      L.rematch = m.state;
      if (m.state === 'offer') { haptic.win(); sfx.turn(); }
      break;
    case 'err': L.err = m.msg; L.queued = false; if (S.phase !== 'lobby') fx.banner(m.msg, 'info', 1400); break;
    case 'top': L.top = m.rows; L.season = m.season; L.prizes = m.prizes; break;
    case 'found':
      track('online_found', { ranked: m.ranked, wait: m.ranked && queuedAt ? Math.round((Date.now() - queuedAt) / 1000) : 0, diff: L.me ? m.opp.rating - L.me.rating : 0 }); queuedAt = 0;
      L.queued = false; L.duel = null; L.err = ''; L.invite = null; L.invNote = ''; L.rematch = '';
      S.on = { ranked: m.ranked, opp: m.opp, side: 'T', myAgent: '', oppAgent: '', deadline: 0, oppOnline: true, mullSent: false, confirmResign: false };
      S.score = [0, 0]; S.game = 1; S.results = []; S.journal = []; S.s = null;
      S.knife = null; S.phase = 'knife';
      haptic.win(); sfx.turn();
      break;
    case 'knife': {
      if (!S.on) return;
      const prev = S.knife;
      const kn = S.knife = { k: m.k, pick: m.picked ? prev?.pick ?? null : null, reveal: prev?.reveal ?? null, bot: m.oppAgents,
        online: { oppPicked: m.oppPicked, pick: m.pick, deadline: m.deadline, sideSent: prev?.online?.sideSent } };
      S.on.deadline = m.deadline;
      if (m.reveal) {
        kn.reveal = m.reveal; kn.pick = null;
        knifeSound(m.reveal);
        if (m.reveal.winner === 0) haptic.win(); else if (m.reveal.winner === 1) haptic.deny();
        S.phase = 'knife';
        hooks.render();
        await wait(1500);
        if (S.knife !== kn) return;
        kn.reveal = null;
      }
      S.phase = m.pick ? 'sidepick' : 'knife';
      if (m.pick && m.reveal) (m.pick === 'me' ? sfx.win : sfx.lose)();
      break;
    }
    case 'veto': {
      if (!S.on) return;
      S.knife = null;
      if (S.phase === 'knife' || S.phase === 'sidepick') S.phase = 'veto';
      const was = S.on.veto?.myTurn;
      S.on.veto = m; S.on.deadline = m.deadline;
      if (m.myTurn && !was) { sample('ann_ban_1_map'); haptic.tap(); }
      if (m.picked && !S.on.picked) { S.on.picked = m.picked; if (ANN_PICK.has(m.picked)) setTimeout(() => sample(`ann_pick_${m.picked}`), 300); }
      break;
    }
    case 'start':
    case 'sync': {
      if (!S.on) return;
      if (m.t === 'sync' && m.phase === 'veto') break;
      S.map = m.map!; S.on.side = m.side!; S.on.myAgent = m.myAgent!; S.on.oppAgent = m.oppAgent!;
      S.setup[m.side!] = m.myAgent!; S.botAgent = m.oppAgent!;
      S.s = m.view!; S.on.deadline = m.deadline;
      S.sel = null; S.info = null; S.busy = false; resetPend();
      if (m.t === 'start') {
        S.journal = [{ sep: true, text: `${S.on.ranked ? 'Рейтинг' : 'Дуэль'} · ${mapDef(S.map).name}: ${MAP_RULES[S.map] ?? ''}` }];
        S.mull = new Set(); S.on.mullSent = false; S.phase = 'mull';
        await wait(m.t === 'start' && S.on.picked ? 1400 : 0);
        sample(m.side === 'T' ? 'ann_start_t_side' : 'ann_start_ct_side');
      } else {
        S.phase = m.phase === 'mull' ? 'mull' : 'play'; S.on.mullSent = !!m.mullDone;
      }
      break;
    }
    case 'begin': {
      if (!S.on) return;
      S.s = m.view; S.on.deadline = m.deadline; S.phase = 'play'; S.busy = true;
      turnKills = [0, 0]; clutchShown = [false, false]; hsHit = new Set(); kctx = null;
      preloadVoice(); preloadShots();
      setTimeout(() => speak('go', 0), 500);
      logEvents(m.events, S.s.turn);
      hooks.render();
      await playEvents(m.events, new Map(), 0);
      S.busy = false;
      break;
    }
    case 'step': await onlineStep(m); break;
    case 'deny': S.busy = false; sfx.deny(); fx.banner(m.reason, 'info', 900); break;
    case 'radio': if (S.on && S.s) say(m.key as VoKey, shortName(S.on.oppAgent), other(S.on.side), false, S.on.oppAgent); return;
    case 'opp_status':
      if (!S.on) return;
      S.on.oppOnline = m.online; S.on.graceUntil = m.graceUntil;
      fx.banner(m.online ? 'Соперник вернулся' : 'Соперник отключился — ждём', 'info', 1200);
      break;
    case 'over': L.rematch = ''; await finishOnline(m); break;
  }
  hooks.render();
}

async function onlineStep(m: Extract<S2C, { t: 'step' }>) {
  if (!S.on || !S.s) return;
  const p = m.actor, a = m.a;
  S.on.deadline = m.deadline;
  const old = S.s;
  const sn = snap();
  S.busy = true;
  if (a.k === 'end') {
    S.sel = null; S.info = null; resetPend();
    rememberNames(old);
    S.s = m.view;
    logEvents(m.events, p === 0 ? 1 : 0);
    hooks.render();
    await playEvents(m.events, sn, p);
    S.busy = false;
    return;
  }
  if (a.k === 'atk') { fx.lunge(elOf(a.from), rectOf(a.to, sn)); await wait(200); }
  const playedCard = a.k === 'play' ? (p === 0 ? old.p[0].hand.find((c) => c.uid === a.uid)?.id : m.card) : undefined;
  handFrom = a.k === 'play' && p === 0 ? hooks.root.querySelector<HTMLElement>(`.hs-hand [data-uid="${CSS.escape(a.uid)}"]`)?.getBoundingClientRect() ?? null : null;
  if (playedCard && playedCard !== 'trap' && hcard(playedCard).kind === 'bomb') {
    c4.key(); const t = setInterval(() => c4.key(), 260);
    await fx.progress(p === 0 ? 'Закладка бомбы' : 'Соперник закладывает бомбу', 1100, 'plant');
    clearInterval(t);
  }
  rememberNames(old);
  S.s = m.view;
  rememberNames(S.s);
  logEvents(m.events, p, a);
  if (p === 0) { S.sel = null; resetPend(); }
  if (p === 1 && playedCard) {
    if (playedCard === 'trap' || hcard(playedCard).kind === 'trap') { fx.banner('Соперник поставил засаду', 'info', 900); await wait(600); } else await showCast(playedCard);
  }
  hooks.render();
  await playEvents(m.events, sn, p);
  S.busy = false;
}

async function finishOnline(m: Extract<S2C, { t: 'over' }>) {
  if (!S.on) return;
  S.busy = true;
  await wait(S.phase === 'play' ? 900 : 0);
  fx.clearBanner();
  const win = m.winner === 0;
  S.on.result = m;
  S.score[m.winner]++;
  S.results.push({ win, reason: (m.reason as HState['reason']) || 'hero', side: mySide(), turns: S.s?.p[0].turns ?? 0 });
  (win ? sfx.win : sfx.lose)();
  (win ? haptic.win : haptic.lose)();
  const wSide = win ? mySide() : other(mySide());
  if (S.s) {
    speak(wSide === 'T' ? 'terwin' : 'ctwin', 'hq');
    fx.roundBanner(wSide === 'T' ? 'Террористы победили' : 'Спецназ победил', REASON_RU[m.reason]?.(win) ?? (win ? 'Вы победили' : 'Соперник победил'), wSide, 2400);
    recordRound(S.on.myAgent, win, S.s.p[0].kills);
    questsAtEnd(win, S.on.myAgent, S.s.p[0].kills, true);
  }
  track('online_end', { ranked: m.ranked, win, reason: m.reason, side: mySide(), agent: S.on.myAgent, opp: S.on.oppAgent, map: S.map, turns: S.s?.p[0].turns ?? 0, delta: m.rating ? m.rating.after - m.rating.before : 0 });
  S.phase = 'over'; S.busy = false; S.sel = null;
}
const REASON_RU: Record<string, (win: boolean) => string> = {
  bomb: () => 'Бомба взорвалась', defuse: () => 'Бомба обезврежена', hero: (w) => (w ? 'Герой соперника повержен' : 'Ваш герой повержен'),
  resign: (w) => (w ? 'Соперник сдался' : 'Вы сдались'), leave: (w) => (w ? 'Соперник вышел из матча' : 'Вы вышли из матча — штраф 35 Elo'),
};

// Таймеры (ход, вето, замена карт, ожидание соперника) — только меняем текст, без перерисовки экрана
setInterval(() => {
  for (const el of document.querySelectorAll<HTMLElement>('.hs-timer[data-dl]')) {
    const dl = Number(el.dataset.dl);
    const left = Math.max(0, Math.ceil((dl - net.serverNow()) / 1000));
    el.textContent = dl ? `${left} с` : '';
    el.classList.toggle('low', left <= 10);
  }
  for (const el of document.querySelectorAll<HTMLElement>('.ol-wait[data-since]')) {
    const s = Math.max(0, Math.floor((net.serverNow() - Number(el.dataset.since)) / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}, 250);

// ─────────────────────────── Таймер хода: бомба слева на границе ───────────────────────────
// 30 секунд на ход — только онлайн, срок задаёт сервер. Против бота таймера нет.
// Последние 10 секунд бомба пищит чаще и растёт, по истечении ход переходит сопернику.
export const TURN_SEC = 30;
function turnBombHTML() {
  return `<div class="hs-turnbomb off" data-turnbomb role="timer" aria-label="Время на ход">
    <i class="tb-ring"></i><img src="${esc(hImg(hcard('c4')))}" alt="" draggable="false"><b class="tb-led"></b></div>`;
}
let tbBeep = 0;
function turnTimerTick() {
  const now = Date.now();
  const el = document.querySelector<HTMLElement>('[data-turnbomb]');
  const s = S.s;
  let left: number | null = null, mine = false;
  if (s && el && S.phase === 'play' && s.winner === null) {
    if (S.on) {
      if (S.on.deadline) { left = (S.on.deadline - net.serverNow()) / 1000; mine = s.turn === 0; }
    }   // против бота таймера нет — он только онлайн, срок задаёт сервер
  }
  if (!el) return;
  if (left === null) { el.className = 'hs-turnbomb off'; return; }
  const sec = Math.max(0, Math.ceil(left));
  el.className = `hs-turnbomb ${mine ? 'mine' : 'theirs'} ${sec <= 5 ? 'crit' : sec <= 10 ? 'warn' : ''}`;
  el.style.setProperty('--p', String(Math.max(0, Math.min(1, left / TURN_SEC))));
  el.querySelector('.tb-led')!.textContent = String(sec);
  if (!mine) return;
  // писк: раз в 2 с, на последних 10 с — каждую секунду, на последних 5 — дважды в секунду
  const every = sec > 10 ? 2000 : sec > 5 ? 1000 : 500;
  if (left > 0 && now - tbBeep >= every && !S.busy) { tbBeep = now; c4.timer(sec <= 10, sec <= 5); el.classList.add('beep'); setTimeout(() => el.classList.remove('beep'), 140); }
}
setInterval(turnTimerTick, 125);

const RADIO_KEYS: VoKey[] = ['go', 'enemyspotted', 'needbackup', 'takingfire', 'niceshot', 'clutch', 'enemydown'];
function radioHTML() {
  return `<div class="hs-radio ${S.radioOpen ? 'open' : ''}">
    <button class="hs-radiobtn" data-act="hs-radio" aria-label="Рация">📻</button>
    ${S.radioOpen ? `<div class="hs-radiolist">${RADIO_KEYS.map((k) => `<button data-act="hs-radiosay" data-v="${k}">${esc(VO_LABEL[k] ?? k)}</button>`).join('')}</div>` : ''}
  </div>`;
}
const VO_LABEL: Partial<Record<VoKey, string>> = { go: 'Вперёд!', enemyspotted: 'Противник замечен', needbackup: 'Нужна помощь!', takingfire: 'Под огнём!', niceshot: 'Отличный выстрел!', clutch: 'Держусь один', enemydown: 'Противник убит' };

function agentPickHTML() {
  const st = S.setup;
  const list = (side: Side) => AGENTS.filter((a) => a.side === side).map((a) =>
    `<button class="rm-agent f-${side} ${st[side] === a.id ? 'on' : ''}" data-act="hs-agent" data-side="${side}" data-v="${a.id}">
      <span class="portrait xs">${agentArt(side, a.id)}</span><b>${esc(a.name)}</b>${styleTag(styleOf(a.id))}</button>`).join('');
  return `<h4 class="sub">Герой за CT</h4><div class="rm-agents">${list('CT')}</div><h4 class="sub">Герой за T</h4><div class="rm-agents">${list('T')}</div>
    <p class="note">Сначала ножевой раунд: победитель выбирает сторону, проигравший первым вычёркивает карту в вето. Дальше — одна партия.</p>`;
}

/** Выбранные герои одной строкой; список агентов раскрывается по нажатию. */
function agentsLine() {
  const st = S.setup, L = S.lobby;
  const one = (side: Side) => { const a = agent(st[side]); return `<span class="ol-ag f-${side}"><span class="portrait xs">${agentArt(side, a.id)}</span><span><small>${side}</small><b>${esc(a.name)}</b></span></span>`; };
  return `<button class="ol-agents ${L.agentsOpen ? 'open' : ''}" data-act="hs-agents">${one('CT')}${one('T')}<em>${L.agentsOpen ? 'Скрыть ▴' : 'Сменить ▾'}</em></button>`;
}
function lobbyHTML() {
  const L = S.lobby, me = L.me, st = net.onlineStatus.state;
  const head = `<header class="rm-head"><button class="ghost sm" data-act="hs-menu">← Меню</button><span class="rm-title">Онлайн</span><button class="ghost sm" data-act="hs-rating">Рейтинг</button></header>`;
  const card = me ? `<button class="ol-me" data-act="hs-rating">${levelBadge(me.rating)}<div><b>${esc(me.name)}</b>
      <small>Уровень ${levelOf(me.rating).level} · <b class="elo">${me.rating}</b> Elo</small>
      <small>${esc(L.season)} · ${me.wins} побед из ${me.games}</small></div></button>`
    : `<div class="ol-me"><small>${st === 'connecting' ? 'Подключение…' : st === 'online' ? 'Вход…' : 'Нет связи с сервером'}</small></div>`;
  const busy = L.queued ? `<div class="ol-box"><p class="hs-wait">Ищем соперника… в очереди ${L.qsize}</p>
      ${L.range ? `<p class="ol-range">Подбор по рейтингу: <b>${L.range.lo}–${L.range.hi}</b> Elo · уровни ${levelOf(L.range.lo).level}–${levelOf(L.range.hi).level}<br><small>Окно расширяется, пока идёт поиск · <b class="ol-wait" data-since="${L.range.since}"></b></small></p>` : ''}
      <button class="ghost" data-act="hs-unqueue">Отмена</button></div>`
    : L.duel ? `<div class="ol-box"><p>Дуэль создана. Код: <b class="ol-code">${L.duel}</b></p>
        <button class="primary" data-act="hs-duel-share">Отправить другу</button>${L.copied ? '<small class="note">Ссылка скопирована</small>' : ''}
        <p class="hs-wait">Ждём друга…</p><button class="ghost" data-act="hs-duel-cancel">Отмена</button></div>`
    : `<button class="primary big-btn ol-find" data-act="hs-queue" ${me ? '' : 'disabled'}>Найти матч<small>рейтинговая игра · ход 30 с</small></button>
       ${agentsLine()}
       <div class="ol-duel"><h4 class="sub">Дуэль с другом · без рейтинга</h4>
       <button class="ghost wide" data-act="hs-duel-create" ${me ? '' : 'disabled'}>Создать ссылку-приглашение</button>
       <div class="ol-join"><input id="duelcode" maxlength="6" placeholder="Код друга" autocomplete="off" autocapitalize="characters"><button class="ghost" data-act="hs-duel-join" ${me ? '' : 'disabled'}>Войти</button></div></div>`;
  return `<main class="rm scroll rm-setup ol">${head}${card}
    ${L.err ? `<p class="ol-err">${esc(L.err)}</p>` : ''}
    ${busy}
    ${L.invNote && L.duel ? `<p class="note">${esc(L.invNote)}</p>` : ''}
    ${L.agentsOpen && !L.queued && !L.duel ? agentPickHTML() : ''}
    <p class="note">Одна игра: ножевой раунд → вето карт → матч. Связь пропала — у вас минута, чтобы вернуться; вышли из матча — −35 Elo.</p>
  </main>`;
}

// ─────────────────────────── Рейтинг (уровни как на FACEIT) ───────────────────────────
const LEVEL_COLOR = (lv: number) => (lv === 1 ? '#eeeeee' : lv <= 3 ? '#1ce400' : lv <= 7 ? '#ffc800' : lv <= 9 ? '#ff6309' : '#fe1f00');
/** Значок уровня: кольцо, заполненное на N/10, и цифра. */
function levelBadge(rating: number, size: '' | 'xs' | 'xl' = ''): string {
  const lv = levelOf(rating).level, c = LEVEL_COLOR(lv), r = 15, len = 2 * Math.PI * r;
  return `<span class="lvl ${size}" style="--lc:${c}" title="Уровень ${lv}"><svg viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="18" cy="18" r="${r}" fill="#121519" stroke="rgba(255,255,255,.12)" stroke-width="3"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(len * lv / 10).toFixed(1)} ${len.toFixed(1)}" transform="rotate(126 18 18)"/>
  </svg><b>${lv}</b></span>`;
}
function levelProgress(rating: number): string {
  const l = levelOf(rating);
  if (l.level === 10) return 'Максимальный уровень';
  return `до уровня ${l.level + 1}: ${l.max + 1 - Math.round(rating)} Elo`;
}
function ratingHTML(): string {
  const L = S.lobby, me = L.me, st = net.onlineStatus.state;
  const head = `<header class="rm-head"><button class="ghost sm" data-act="hs-menu">← Меню</button><span class="rm-title">Рейтинг${L.season ? ` · ${esc(L.season)}` : ''}</span><span></span></header>`;
  let card: string;
  if (me) {
    const l = levelOf(me.rating);
    const pct = l.level === 10 ? 100 : Math.max(0, Math.min(100, ((me.rating - l.min) / (l.max + 1 - l.min)) * 100));
    const wr = me.games ? Math.round((me.wins / me.games) * 100) : 0;
    card = `<section class="rt-me" style="--lc:${LEVEL_COLOR(l.level)}">
      ${levelBadge(me.rating, 'xl')}
      <div class="rt-main"><small>Уровень ${l.level}${me.rank ? ` · место #${me.rank}` : ''}</small><b>${me.rating} <i>Elo</i></b><span>${esc(me.name)}</span></div>
      <div class="rt-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="rt-barl"><span>${l.min}</span><span>${levelProgress(me.rating)}</span><span>${l.level === 10 ? '' : l.max + 1}</span></div>
      <div class="rt-stats"><span><b>${me.games}</b>матчей</span><span><b>${wr}%</b>побед</span><span><b>${me.peak}</b>лучший</span></div>
    </section>
    <button class="primary big-btn" data-act="hs-findmatch">Найти рейтинговый матч</button>`;
  } else {
    card = `<div class="ol-me"><small>${L.err ? esc(L.err) : st === 'connecting' ? 'Подключение…' : st === 'online' ? 'Вход…' : 'Нет связи с сервером'}</small></div>`;
  }
  const hist = L.history;
  const hHTML = !me ? '' : !hist ? '<p class="note">Загружаем матчи…</p>' : !hist.length ? '<p class="note">Сыграйте первый рейтинговый матч — здесь появится история.</p>'
    : histList(hist, true);
  const myLv = me ? levelOf(me.rating).level : 0;
  const levels = `<div class="rt-levels">${LEVELS.map((x) => `<div class="${x.level === myLv ? 'on' : ''}">${levelBadge(x.min, 'xs')}<span>${x.max === Infinity ? `${x.min}+` : `${x.min}–${x.max}`}</span></div>`).join('')}</div>`;
  const top = L.top.length ? topList(L.top.slice(0, 15)) : '';
  return `<main class="rm scroll ol rt">${head}${card}
    ${me ? friendsHTML() : ''}
    ${me ? `<h4 class="sub">Последние матчи</h4>${hHTML}` : ''}
    <h4 class="sub">Уровни</h4>${levels}
    <p class="note">Все начинают с 1000 Elo — это 4 уровень. Победа над равным соперником даёт около +25, поражение — около −25; победить сильного выгоднее, проиграть слабому — дороже. Подбор ищет соперника в пределах ±100 Elo и, пока вы ждёте, расширяет окно до ±350.</p>
    ${prizesHTML()}
    ${top ? `<h4 class="sub">Топ сезона</h4>${top}` : ''}
  </main>`;
}

// ── Призы сезона: скины CS2 за 1–10 места ──
const RARITY: Record<string, [string, string]> = {
  consumer: ['#b0c3d9', 'Ширпотреб'], industrial: ['#5e98d9', 'Промышленное'], milspec: ['#4b69ff', 'Армейское'], restricted: ['#8847ff', 'Запрещённое'],
  classified: ['#d32ce6', 'Засекреченное'], covert: ['#eb4b4b', 'Тайное'], contraband: ['#e4ae39', 'Контрабанда'], knife: ['#e4ae39', '★ Нож'],
};
const plural = (n: number, one: string, few: string, many: string) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const rarityColor = (r?: string) => (r && RARITY[r]?.[0]) || '#b0c3d9';
function topList(rows: typeof S.lobby.top) {
  const pz = S.lobby.prizes, places = pz ? prizePlaces(rows, pz.minGames) : new Map<(typeof rows)[number], number>();
  const meId = S.lobby.me?.id;
  return `<ol class="ol-top">${rows.map((r) => {
    const place = places.get(r), prize = place ? pz!.prizes.find((x) => x.place === place) : undefined;
    return `<li class="${prize ? 'prz' : ''} ${r.id && r.id === meId ? 'me' : ''}" ${r.id ? `data-act="hs-player" data-id="${esc(r.id)}"` : ''} style="--rc:${rarityColor(prize?.rarity)}">
      ${levelBadge(r.rating, 'xs')}<b>${esc(r.name)}</b><span>${r.rating}</span>
      <small>${r.wins} побед из ${r.games}${pz && !place && r.games < pz.minGames ? ` · нужно ${pz.minGames} матчей` : ''}</small>
      ${prize ? `<i class="tp-prize" title="${esc(prize.skin)}">🎁 ${esc(prize.skin)}</i>` : ''}</li>`;
  }).join('')}</ol>`;
}
function prizesHTML() {
  const pz = S.lobby.prizes, me = S.lobby.me;
  if (!pz?.prizes.length) return '';
  const days = pz.ends ? Math.ceil((pz.ends - Date.now()) / 86_400_000) : null;
  const myPlace = me ? [...prizePlaces(S.lobby.top, pz.minGames)].find(([r]) => r.id === me.id)?.[1] : undefined;
  let status = '';
  if (me) {
    if (myPlace) status = `Вы на <b>${myPlace}</b> месте — в призовой зоне!`;
    else if (me.games < pz.minGames) status = `Чтобы бороться за призы, сыграйте ещё <b>${pz.minGames - me.games}</b> рейтинговых матчей`;
    else {
      const elig = S.lobby.top.filter((r) => r.games >= pz.minGames);
      const tenth = elig[9];
      status = tenth ? `До призовой зоны: <b>${Math.max(1, tenth.rating - me.rating + 1)}</b> Elo` : 'Призовая зона ещё не заполнена — успейте попасть в десятку';
    }
  }
  return `<h4 class="sub">Призы сезона</h4>
    <section class="pz">
      <p class="pz-head">Топ-10 сезона получают скины CS2${days !== null ? ` · ${days > 0 ? `до конца ${days} ${plural(days, 'день', 'дня', 'дней')}` : 'сезон завершается'}` : ''}</p>
      <div class="pz-row">${pz.prizes.map((p) => `<div class="pz-i" style="--rc:${rarityColor(p.rarity)}"><em>${p.place}</em>
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<i class="pz-ic">🎁</i>'}
        <b>${esc(p.skin)}</b><small>${esc([p.wear, RARITY[p.rarity ?? '']?.[1]].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>
      ${status ? `<p class="pz-me">${status}</p>` : ''}
      <p class="note">В зачёт идут игроки, сыгравшие не меньше ${pz.minGames} рейтинговых матчей за сезон. Места фиксируются в момент окончания сезона.</p>
    </section>`;
}

function histList(hist: HistRow[], link: boolean) {
  return `<ol class="rt-hist">${hist.map((h) => `<li class="${h.win ? 'w' : 'l'}"${link && h.oppId ? ` data-act="hs-player" data-id="${esc(h.oppId)}"` : ''}><b>${h.win ? 'W' : 'L'}</b>
        <span><em>${esc(h.opp)}</em><small>${esc(mapDef(h.map)?.name ?? h.map)} · ${new Date(h.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></span>
        ${levelBadge(h.oppRating, 'xs')}<i>${h.delta >= 0 ? '+' : ''}${h.delta}</i></li>`).join('')}</ol>`;
}
// ── Друзья и недавние соперники ──
function peerHTML(p: PeerRow) {
  const st = p.inGame ? '<small class="pr-st game">в матче</small>' : p.online ? '<small class="pr-st on">в сети</small>' : '<small class="pr-st">не в сети</small>';
  const act = p.friend
    ? `<button class="ghost sm" data-act="hs-invite" data-id="${esc(p.id)}" ${p.online && !p.inGame ? '' : 'disabled'}>Вызвать</button>`
    : `<button class="ghost sm" data-act="hs-friend-add" data-id="${esc(p.id)}" title="В друзья">+ друг</button>`;
  return `<li class="pr ${p.online ? 'on' : ''}"><button class="pr-who" data-act="hs-player" data-id="${esc(p.id)}">${levelBadge(p.rating, 'xs')}<i class="pr-dot"></i>
    <span><b>${esc(p.name)}</b>${st}</span>${p.win !== undefined ? `<em class="${p.win ? 'w' : 'l'}">${p.win ? 'W' : 'L'}</em>` : ''}</button>${act}</li>`;
}
function friendsHTML() {
  const L = S.lobby;
  if (!L.friends) return '<h4 class="sub">Друзья</h4><p class="note">Загружаем…</p>';
  const fr = L.friends.length ? `<ul class="pr-list">${L.friends.map(peerHTML).join('')}</ul>`
    : '<p class="note">Пока пусто. Добавляйте соперников из списка ниже или из истории матчей — потом сможете вызвать их на дуэль в один тап.</p>';
  const rec = L.recent.filter((r) => !r.friend);
  return `<h4 class="sub">Друзья</h4>${L.invNote ? `<p class="note">${esc(L.invNote)}</p>` : ''}${fr}
    ${rec.length ? `<h4 class="sub">Недавние соперники</h4><ul class="pr-list">${rec.map(peerHTML).join('')}</ul>` : ''}`;
}
function playerHTML() {
  const L = S.lobby, p = L.player;
  const head = `<header class="rm-head"><button class="ghost sm" data-act="hs-player-back">← Назад</button><span class="rm-title">Профиль</span><span></span></header>`;
  if (!p) return `<main class="rm scroll ol rt">${head}<p class="note">Загружаем…</p></main>`;
  const me = p.me, l = levelOf(me.rating), wr = me.games ? Math.round((me.wins / me.games) * 100) : 0;
  const self = L.me?.id === me.id;
  return `<main class="rm scroll ol rt">${head}
    <section class="rt-me" style="--lc:${LEVEL_COLOR(l.level)}">${levelBadge(me.rating, 'xl')}
      <div class="rt-main"><small>Уровень ${l.level}${me.rank ? ` · место #${me.rank}` : ''} · ${p.online ? '<span class="pr-st on">в сети</span>' : 'не в сети'}</small><b>${me.rating} <i>Elo</i></b><span>${esc(me.name)}</span></div>
      <div class="rt-stats"><span><b>${me.games}</b>матчей</span><span><b>${wr}%</b>побед</span><span><b>${me.peak}</b>лучший</span></div>
    </section>
    ${self ? '' : `<p class="pr-h2h">Ваши встречи: <b class="w">${p.h2h.wins}</b> : <b class="l">${p.h2h.losses}</b></p>
    <div class="pr-acts">
      <button class="primary" data-act="hs-invite" data-id="${esc(me.id)}" ${p.online ? '' : 'disabled'}>Вызвать на дуэль</button>
      ${p.friend ? `<button class="ghost" data-act="hs-friend-del" data-id="${esc(me.id)}">Убрать из друзей</button>` : `<button class="ghost" data-act="hs-friend-add" data-id="${esc(me.id)}">Добавить в друзья</button>`}
    </div>${L.invNote ? `<p class="note">${esc(L.invNote)}</p>` : ''}`}
    <h4 class="sub">Последние матчи</h4>${p.history.length ? histList(p.history, false) : '<p class="note">Пока нет рейтинговых матчей.</p>'}
  </main>`;
}
/** Окно «вас вызывают на дуэль» — поверх любого экрана, включая главное меню. */
export function hsInviteHTML(): string {
  const v = S.lobby.invite;
  if (!v) return '';
  return `<div class="inv-pop" role="alertdialog"><div>${levelBadge(v.from.rating, 'xs')}<p><span><b>${esc(v.from.name)}</b> вызывает вас на дуэль</span><small>${v.from.rating} Elo · без рейтинга</small></p></div>
    <button class="primary" data-act="inv-yes">Принять</button><button class="ghost" data-act="inv-no">Отклонить</button></div>`;
}
export function hsInvite(accept: boolean) {
  const v = S.lobby.invite;
  if (!v) return;
  S.lobby.invite = null;
  track('invite_answer', { accept });
  if (accept) { hooks.enter(); openLobby(); }
  net.send({ t: 'invite_answer', code: v.code, accept, agents: { T: S.setup.T, CT: S.setup.CT } });
  hooks.render();
}

function vetoHTML() {
  const v = S.on?.veto;
  const o = S.on!;
  const maps = (v?.maps ?? MAPS.map((m) => m.id)).map((id) => {
    const b = v?.banned.find((x) => x.map === id);
    const picked = v?.picked === id;
    return `<button class="ol-map ${b ? 'banned' : ''} ${picked ? 'picked' : ''}" data-act="hs-ban" data-v="${id}" ${!v?.myTurn || b ? 'disabled' : ''}
      style="--img:url('${esc(cssUrl(mapDef(id).image))}')"><b>${esc(mapDef(id).name)}</b>${b ? `<small>${b.mine ? 'вы убрали' : 'соперник убрал'}</small>` : picked ? '<small>карта матча</small>' : ''}</button>`;
  }).join('');
  return `<main class="rm scroll ol">
    <header class="rm-head"><span></span><span class="rm-title">${o.ranked ? 'Рейтинговая игра' : 'Дуэль'}</span><span></span></header>
    <p class="ol-vs">Вы <i>против</i> <b>${esc(o.opp.name)}</b> ${levelBadge(o.opp.rating, 'xs')}<small>${o.opp.rating} Elo</small></p>
    <p class="ol-vetohint">${v?.picked ? `Играем на <b>${esc(mapDef(v.picked).name)}</b>` : v?.myTurn ? 'Ваш ход: уберите карту' : 'Соперник убирает карту…'} ${v?.picked ? '' : `<b class="hs-timer" data-dl="${o.deadline}"></b>`}</p>
    <div class="ol-maps">${maps}</div>
  </main>`;
}

function topHTML() {
  const L = S.lobby;
  return `<main class="rm scroll ol">
    <header class="rm-head"><button class="ghost sm" data-act="hs-lobby">← Онлайн</button><span class="rm-title">Топ · ${esc(L.season)}</span><span></span></header>
    ${prizesHTML()}${L.top.length ? topList(L.top) : '<p class="note">Пока никто не сыграл в этом сезоне.</p>'}
  </main>`;
}

function rematchBtn() {
  const st = S.lobby.rematch;
  if (st === 'gone') return '<button class="primary big-btn" disabled>Реванш недоступен</button>';
  if (st === 'wait') return '<button class="primary big-btn" disabled>Ждём ответа соперника…</button>';
  return `<button class="primary big-btn ${st === 'offer' ? 'pulse' : ''}" data-act="hs-rematch">${st === 'offer' ? 'Соперник хочет реванш — принять' : 'Реванш'}</button>`;
}
function onlineOverHTML() {
  const o = S.on!, r = o.result!;
  const win = r.winner === 0;
  const rt = r.rating;
  const delta = rt ? rt.after - rt.before : 0;
  return `<div class="hs-ov"><div class="hs-ovbox ${win ? 'win' : 'lose'}">
    <h2>${win ? 'Победа' : 'Поражение'}</h2>
    <p class="note">${esc(REASON_RU[r.reason]?.(win) ?? '')} · против ${esc(o.opp.name)}</p>
    ${mvpHTML()}
    ${rt ? (() => { const lb = levelOf(rt.before).level, la = levelOf(rt.after).level;
      return `<div class="ol-delta ${delta >= 0 ? 'up' : 'down'}">${levelBadge(rt.after)}<div><b>${delta >= 0 ? '+' : ''}${delta} Elo</b><small>${rt.before} → ${rt.after}</small>
        ${la !== lb ? `<em class="${la > lb ? 'lvup' : 'lvdown'}">${la > lb ? 'Новый уровень' : 'Уровень понижен'}: ${la}</em>` : `<small>${levelProgress(rt.after)}</small>`}</div></div>`; })() : '<p class="note">Дуэль без рейтинга</p>'}
    ${rematchBtn()}
    <button class="ghost" data-act="hs-share">Поделиться</button>
    <button class="ghost" data-act="hs-again">${o.ranked ? 'Ещё рейтинговая' : 'В лобби'}</button>
    ${o.opp.id ? `<button class="ghost sm" data-act="hs-friend-add" data-id="${esc(o.opp.id)}">+ ${esc(o.opp.name)} в друзья</button>` : ''}
    <button class="ghost" data-act="hs-menu">В меню</button>
  </div></div>`;
}

// ─────────────────────────── Задания дня ───────────────────────────
function questTrack(evs: Ev[], actor: PI) {
  const fresh: QuestDef[] = [];
  const bump = (k: QuestKind, n = 1) => { fresh.push(...questBump(k, n)); };
  for (const e of evs) {
    if (e.t === 'play' && e.p === 0) {
      if (e.card === 'flash') bump('flash');
      else if (e.card === 'he' || e.card === 'molotov' || e.card === 'incendiary') bump('nade');
      else if (e.card === 'c4') bump('plant');
    } else if (e.t === 'dmg' && e.hs && actor === 0 && e.id !== 'h0' && !names.get(e.id)?.mine) bump('headshot');
    else if (e.t === 'defused' && mySide() === 'CT') bump('defuse');
    else if (e.t === 'clutch' && names.get(e.id)?.mine) bump('clutch');
    else if (e.t === 'trophy' && e.p === 0 && !e.burned) bump('trophy');
    else if (e.t === 'power' && e.p === 0) bump('power');
    else if (e.t === 'shop' && e.p === 0) bump('shop');
  }
  questToast(fresh);
}
function questsAtEnd(win: boolean, agentId: string, kills: number, online: boolean) {
  const fresh = [...questBump('games'), ...questBump('kills', kills)];
  if (win) fresh.push(...questBump('win'), ...questBump(`agent:${agentId}`), ...(online ? questBump('win_online') : []));
  questToast(fresh);
}
function questToast(qs: QuestDef[]) {
  qs.forEach((q, i) => setTimeout(() => { fx.banner(`Задание выполнено: ${q.text} · +${q.pts}`, 'defuse', 1800); haptic.win(); }, 2600 + i * 1900));
}

// ─────────────────────────── Карточка результата ───────────────────────────
async function shareNow() {
  const last = S.results[S.results.length - 1];
  if (!last) return;
  const side = last.side;
  const agentId = S.on?.myAgent || S.setup[side];
  const o = S.on?.result;
  const win = o ? o.winner === 0 : S.phase === 'over' ? S.score[0] > S.score[1] : last.win;
  const why = o ? (REASON_RU[o.reason]?.(win) ?? '') : last.reason === 'bomb' ? 'Бомба взорвалась' : 'Герой повержен';
  const mode = S.on ? (S.on.ranked ? 'Рейтинговая игра' : `Дуэль · ${S.on.opp.name}`) : S.tut ? 'Обучение' : `Против бота · ${DIFF_RU[S.setup.diff]} · ${S.score[0]}:${S.score[1]}`;
  const img = (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[`agent_${agentId}`] ?? `img/agent_${agentId}.webp`;
  const text = win ? `Победа в «Клатче» на ${mapDef(S.map).name}! ${why}.` : `Сыграл в «Клатч» на ${mapDef(S.map).name}. ${why}.`;
  await shareResult({ win, title: win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ', subtitle: why, map: mapDef(S.map).name, mapImg: mapDef(S.map).image, agentName: agent(agentId).name, agentImg: img, side, rating: o?.rating, mode }, text);
}

// ─────────────────────────── Обучение ───────────────────────────
// Пошаговый матч: вы — Phoenix (T) против SWAT-новичка на Dust II, рука и начало колоды заданы заранее.
// На каждом шаге экран затемнён и заблокирован, открыто только нужное действие — оно подсвечено и «дышит».
// Подсказка сверху или снизу (подальше от цели). Шаг засчитывается, когда действие сделано.
interface TutStep {
  id: string;
  text: string | (() => string);
  /** Что подсветить (CSS-селектор). null — только текст с кнопкой «Далее». */
  target: () => string | null;
  /** Куда ещё можно нажимать на этом шаге (кроме цели). */
  allow?: () => string[];
  /** Шаг выполнен. */
  done: () => boolean;
  /** Шаг возможен (иначе пропускается, когда настал ваш ход). */
  need?: () => boolean;
  /** Шаг не ждёт вашего хода (приветствие, замена карт). */
  anyTurn?: boolean;
  /** Шаг-пояснение: подсветка без действия, дальше — кнопкой «Далее». */
  info?: boolean;
}
type TutState = { step: number; over: boolean; next: boolean; free: boolean };

function startTutorial() {
  S.tut = { step: 0, over: false, next: false, free: false };
  track('tut_start');
  S.setup = { ...S.setup, side: 'T', T: 't_phoenix', CT: 'ct_swat', diff: 'easy' };
  S.side = 'T'; S.knife = null;
  startMatch();
  tutLoop();
}
/** Заданная рука и начало колоды: шаги обучения всегда выполнимы. */
function tutorialDeal(s: HState) {
  const P = s.p[0];
  const hand = ['tec9', 'mac10', 'flash', 'glock'];
  const top = ['p250', 'ak47', 'he', 'galil'];
  const rest = [...P.hand.map((c) => c.id), ...P.deck];
  for (const id of [...hand, ...top]) { const i = rest.indexOf(id); if (i >= 0) rest.splice(i, 1); }
  P.hand = hand.map((id) => ({ uid: `c${++s.seq}`, id }));
  P.deck = [...top, ...rest];
}

const me0 = () => S.s!.p[0];
const handUid = (id: string) => me0().hand.find((c) => c.id === id)?.uid;
const handSel = (uid?: string) => (uid ? `.hs-hand .hc[data-uid="${uid}"]` : null);
/** Цель для розыгрыша карты из руки: карта → «На стол» → место → цель. */
function playFlow(cardId: string): string | null {
  const uid = handUid(cardId);
  if (S.sel?.k === 'hand' && S.sel.uid === uid) {
    const st = playStage();
    if (st === 'preview') return hcard(cardId).modes ? '[data-act="hs-play"][data-mode="0"]' : '.hs-pv [data-act="hs-play"]';
    if (st === 'place') return '.hs-board.b0';
    if (st === 'target') return '.tgt';
  }
  return handSel(uid);
}
const playAllow = (cardId: string) => [handSel(handUid(cardId)) ?? '', '.hs-pv [data-act="hs-play"]', '.hs-slot', '.tgt'];

const TUT_STEPS: TutStep[] = [
  { id: 'hello', anyTurn: true, info: true, text: 'Добро пожаловать в «Клатч»! Это карточный бой по CS2: вы — Phoenix за T, против вас SWAT. Снимите герою соперника всё здоровье или взорвите бомбу.',
    target: () => null, done: () => false },
  { id: 'mull', anyTurn: true, text: 'Это ваша стартовая рука. Неудобные карты можно заменить, но сейчас рука хорошая. Нажмите «Оставить и начать».',
    target: () => '[data-act="hs-keep"]', done: () => S.phase !== 'mull' },
  // ── Деньги ──
  { id: 'money', info: true, text: () => `Деньги — это мана, ими платят за карты. В первый ход ${money(HS.firstIncome)}, дальше доход растёт на ${money(HS.income)} каждый ход, но не больше ${money(HS.maxMoney)}. Сейчас у вас ${money(me0().money)}.`,
    target: () => '#cash0', done: () => false },
  { id: 'money2', info: true, text: () => `Не потратили — до ${money(HS.carry)} перейдёт на следующий ход, остальное сгорит. Под суммой написано, сколько добавится в следующий ход: доход плюс награды.`,
    target: () => '#cash0 .hs-next', done: () => false },
  // ── Карта ──
  { id: 'anatomy', info: true, text: 'Как читать карту: зелёная плашка — цена; все деньги в игре — в тысячах долларов (1,5 = $1 500), жёлтый овал — атака, сердце — здоровье, значок по центру — класс оружия. Любую карту можно нажать и прочитать её свойства.',
    target: () => handSel(handUid('tec9')) ?? '.hs-hand .hc', done: () => false },
  { id: 'unit', text: 'Выставьте бойца: перетащите Tec-9 из руки на свой ряд — или нажмите его, затем «На стол».',
    target: () => playFlow('tec9'), allow: () => playAllow('tec9'), done: () => me0().board.some((u) => u.card === 'tec9'), need: () => !!handUid('tec9') },
  { id: 'rush', info: true, text: 'У Tec-9 «Рывок» — обычно он бьёт сразу. Но SWAT играет от обороны: против неё рывок не срабатывает. Боец атакует со следующего хода.',
    target: () => '.hs-board.b0 > [data-hid]', done: () => false, need: () => me0().board.length > 0 },
  { id: 'classes', info: true, text: 'Кто кого: ПП бьют снайперов (+2), дробовики — ПП, пистолеты и укрытия (+2), снайперы — дробовики и пулемёты (+2) и стреляют без ответа, винтовки пробивают броню. Цифра «+2» появится на цели, когда выберете атакующего.',
    target: () => null, done: () => false },
  { id: 'keywords', info: true, text: 'Свойства бойцов: Рывок — бьёт сразу; Хедшот — убивает бойца без шлема; Укрытие — враги сначала бьют его; Глушитель — невидим, пока не выстрелит; Очередь — две атаки; Перезарядка — после выстрела пропускает ход.',
    target: () => null, done: () => false },
  { id: 'end1', text: () => `Больше в этом ходу делать нечего. Нажмите «Конец хода» — неистраченные деньги (до ${money(HS.carry)}) перейдут на следующий.`,
    target: () => '.hs-end', done: () => S.s!.turn !== 0 },
  // ── Ход 2: атака, награды, бомба ──
  { id: 'attack', text: () => (S.sel?.k === 'atk' ? 'Теперь выберите цель — подсвечены те, кого можно атаковать. Цифра на цели — бонус «кто кого».' : 'Ваш ход! Нажмите своего бойца, чтобы атаковать.'),
    target: () => (S.sel?.k === 'atk' ? '.tgt' : (() => { const u = me0().board.find((x) => canAttack(S.s!, 0, x.uid)); return u ? `[data-hid="${u.uid}"]` : null; })()),
    allow: () => ['.tgt', ...me0().board.filter((x) => canAttack(S.s!, 0, x.uid)).map((x) => `[data-hid="${x.uid}"]`)],
    done: () => me0().board.some((u) => u.shot), need: () => me0().board.some((u) => canAttack(S.s!, 0, u.uid) && attackTargets(S.s!, 0, u.uid).length > 0) },
  { id: 'rewards', info: true, text: () => `Награды приходят в следующий ход. За убийство — по классу оружия убийцы: пистолет ${money(KILL_REWARD.pistol!)}, ПП ${money(KILL_REWARD.smg!)}, дробовик ${money(KILL_REWARD.shotgun!)}, винтовка, снайперка и пулемёт ${money(KILL_REWARD.rifle!)}. Первое убийство за ход (энтри) — ещё $0,3, у «Раша» $0,6.`,
    target: () => '#cash0', done: () => false },
  { id: 'lossbonus', info: true, text: () => `Бонус за отставание, как в CS: если у вашего героя на ${HS.lossGap}+ здоровья меньше, чем у соперника, каждый такой ход подряд даёт +${money(HS.lossStep)} (до +${money(HS.lossStep * HS.lossMax)}). Закладка бомбы — T +${money(HS.plantBonus)} (Phoenix ${money(1300)}), обезвреживание — CT +${money(HS.defuseBonus)}.`,
    target: () => '#cash0', done: () => false },
  { id: 'end2', text: 'Бомбу можно заложить только с вашего третьего хода — её ещё надо донести до точки. Заканчивайте ход.', target: () => '.hs-end', done: () => S.s!.turn !== 0 },
  // ── Ход 3: гранаты, снаряжение, бай-меню, сила героя ──
  { id: 'nades', info: true, text: 'Гранаты: HE — 3 урона всем бойцам врага; молотов и зажигательная — 4 урона и горение; флешка — боец и соседи пропустят атаку и не ответят; дым — снайперы и пулемёты врага пропустят атаку; Zeus — 4 урона сквозь броню, бьёт и бомбу.',
    target: () => handSel(handUid('flash') ?? handUid('he')), done: () => false },
  { id: 'gear', info: true, text: 'Снаряжение: бронежилет — +1 брони и здоровья, шлем — то же и защита от хедшота, аптечка — +4 здоровья, буст — +2 атаки, «Дроп» — сразу +$1. Броня режет урон пистолетов, ПП, дробовиков и гранат, но не винтовок и снайперок.',
    target: () => null, done: () => false },
  { id: 'shop', info: true, text: () => `Бай-меню под деньгами: за ${money(HS.shopCost)} выбрать 1 из ${HS.shopChoice} карт, каждая следующая покупка за ход дороже на ${money(HS.shopCost)}. А в начале хода вы открываете 2 верхние карты колоды и берёте одну.`,
    target: () => '.hs-shopbtn', done: () => false },
  { id: 'power', text: 'Кнопка справа от портрета — сила героя, раз в ход. У Phoenix это нож: герой бьёт сильнее. Нажмите её.',
    target: () => '[data-act="hs-power"]', done: () => me0().powerUsed, need: () => !!powerTargets(S.s!, 0) },
  { id: 'hero', text: () => (S.sel?.k === 'atk' ? 'Выберите цель для удара героем.' : 'Теперь ударьте ножом: нажмите своего героя, затем цель.'),
    target: () => (S.sel?.k === 'atk' ? '.tgt' : '[data-hid="h0"]'), allow: () => ['.tgt', '[data-hid="h0"]'],
    done: () => me0().hero.attacked, need: () => canAttack(S.s!, 0, 'h0') && attackTargets(S.s!, 0, 'h0').length > 0 },
  { id: 'bomb', text: () => (playStage() === 'place' ? 'Выберите место: поставьте бомбу между двумя своими бойцами — пока они рядом, CT не могут её обезвредить.' : `Третий ход — можно закладывать! Заложите C4: если CT не обезвредят её за ${HS.bombTimer} хода — победа T, обезвредят — победа CT.`),
    target: () => playFlow('c4'), allow: () => playAllow('c4'), done: () => me0().board.some((u) => u.card === 'c4'), need: () => !!handUid('c4') && !!playTargets(S.s!, 0, 'c4') },
  { id: 'bombinfo', info: true, text: () => `Число на бомбе — сколько ходов до взрыва, у бомбы ${HS.bombHp} здоровья. Пока с обеих сторон от неё стоят ваши бойцы (не ослеплённые), CT не могут её бить: им сначала надо зачистить точку. Обезвредили — CT сразу выигрывают партию.`,
    target: () => { const b = me0().board.find((u) => u.card === 'c4'); return b ? `[data-hid="${b.uid}"]` : null; }, done: () => false },
  // ── Особые карты и правила боя ──
  { id: 'traps', info: true, text: () => `Засады лежат рубашкой вверх (до ${HS.traps}) и срабатывают сами: «Держит угол» — 3 урона атакующему, «Растяжка» — 2 урона выставленному бойцу, «Фейк» — гасит гранату врага, «Тиммейт на подхвате» — замена погибшему, «Ниндзя-дефьюз» у CT — тихо снимает бомбу.`,
    target: () => null, done: () => false },
  { id: 'vet', info: true, text: 'Боец, который убил, становится ветераном ★ и получает бонус своего класса. Убили бойца, который ещё не стрелял, — его оружие уходит вам в руку трофеем, бесплатно. Последний боец против двух и больше — клатч: бьёт на 2 сильнее.',
    target: () => null, done: () => false },
  { id: 'sig', info: true, text: 'У каждого агента своя сила героя и две фирменные карты — они лежат только в его колоде. Phoenix: «Подрывник» взрывается при гибели, «Быстрая закладка» ускоряет бомбу. Все карты с описанием — в меню, «Все карты».',
    target: () => null, done: () => false },
  { id: 'free', info: true, text: 'Основы вы знаете! Дальше играйте сами. Нажмите любую карту или бойца, чтобы прочитать подробности. Удачи!',
    target: () => null, done: () => false },
];

const tutStep = () => (S.tut && !S.tut.free ? TUT_STEPS[S.tut.step] : undefined);
function tutAdvance() {
  const t = S.tut!;
  t.step++; t.next = false; S.sel = null; resetPend();
  track('tut_step', { n: t.step, id: TUT_STEPS[t.step - 1]?.id ?? '' });
  if (t.step >= TUT_STEPS.length) { t.free = true; track('tut_done'); }
}
/** Выполненные шаги засчитываются, невозможные в ваш ход — пропускаются. */
function tutCheck() {
  const t = S.tut;
  if (!t || t.free || t.over || !S.s) return;
  for (let guard = 0; guard < TUT_STEPS.length; guard++) {
    const st = TUT_STEPS[t.step];
    if (!st) { t.free = true; return; }
    if (t.next || st.done()) { tutAdvance(); hooks.render(); continue; }
    const mine = S.phase === 'play' && myTurn() && !me0().choice;
    if (!st.anyTurn && mine && st.need && !st.need()) { tutAdvance(); hooks.render(); continue; }
    return;
  }
}
const TUT_ALWAYS = ['.tut', '[data-act="hs-menu"]'];
/** Что сейчас можно нажимать (null — обучение ничего не блокирует). */
function tutAllowed(): string[] | null {
  const t = S.tut;
  if (!t || t.free || t.over || !S.s || S.phase === 'over' || S.phase === 'gameover') return null;
  if (S.phase === 'play' && me0().choice) return [...TUT_ALWAYS, '[data-act="hs-choose"]'];
  const st = tutStep();
  if (!st) return null;
  if (!st.anyTurn && !(S.phase === 'play' && myTurn())) return TUT_ALWAYS;
  if (st.info) return TUT_ALWAYS;
  const tg = st.target();
  return [...TUT_ALWAYS, ...(tg ? [tg] : []), ...(st.allow?.() ?? [])].filter(Boolean);
}
function tutInfo(): { text: string; target: string | null; next: boolean } | null {
  const t = S.tut;
  if (!t || t.over || !S.s || S.phase === 'gameover' || S.phase === 'over') return null;
  if (S.phase === 'play' && me0().choice) return { text: me0().choice!.kind === 'draw' ? 'Начало хода — добор на выбор: возьмите одну из карт, вторая уйдёт под низ колоды.' : 'Бай-меню: выберите карту.', target: '.hs-ov.choice .hs-opt', next: false };
  const st = tutStep();
  if (!st) return null;
  if (!st.anyTurn && !(S.phase === 'play' && myTurn())) return { text: S.busy ? '' : 'Ход соперника — смотрите, что он делает.', target: null, next: false };
  return { text: typeof st.text === 'function' ? st.text() : st.text, target: st.target(), next: !!st.info };
}

// Блокировка всего, кроме нужного действия (перехват раньше остальных обработчиков)
for (const type of ['pointerdown', 'click'] as const) {
  window.addEventListener(type, (ev) => {
    const ok = tutAllowed();
    if (!ok) return;
    const el = ev.target as HTMLElement | null;
    if (ok.some((q) => { try { return !!el?.closest(q); } catch { return false; } })) return;
    ev.preventDefault(); ev.stopPropagation();
    if (type === 'click') { sfx.deny(); haptic.deny(); }
  }, true);
}

// Затемнение с «окном» над целью, кольцо с дыханием, подсказка в другой половине экрана
let tutRaf = 0;
function tutLoop() {
  cancelAnimationFrame(tutRaf);
  document.querySelectorAll('.tut-shade, .tut-ring, .tut').forEach((e) => e.remove());
  const shade = document.createElement('div'); shade.className = 'tut-shade';
  const ring = document.createElement('div'); ring.className = 'tut-ring';
  const bub = document.createElement('div'); bub.className = 'tut';
  let lastKey = '', lastHl: Element[] = [];
  const clearHl = () => { lastHl.forEach((e) => e.classList.remove('tut-hl')); lastHl = []; };
  bub.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement).dataset.act;
    if (a === 'hs-tutnext' && S.tut) { S.tut.next = true; tutCheck(); }
    if (a === 'hs-tutskip' && S.tut) { track('tut_skip', { n: S.tut.step, id: TUT_STEPS[S.tut.step]?.id ?? '' }); S.tut.free = true; clearHl(); hooks.render(); }
  });
  const frame = () => {
    if (!S.tut) { shade.remove(); ring.remove(); bub.remove(); clearHl(); return; }
    tutCheck();
    const info = tutInfo();
    const blocking = !!tutAllowed();
    for (const e of [shade, ring, bub]) if (!e.isConnected) document.body.appendChild(e);
    const els = info?.target ? [...document.querySelectorAll(info.target)].filter((e) => e.getClientRects().length > 0) : [];
    lastHl.forEach((e) => { if (!els.includes(e)) e.classList.remove('tut-hl'); });
    els.forEach((e) => e.classList.add('tut-hl'));
    lastHl = els;
    let r: { l: number; t: number; r: number; b: number } | null = null;
    for (const e of els) {
      const b = e.getBoundingClientRect();
      r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }
    const show = !!info?.text && blocking && !S.busy;
    shade.classList.toggle('on', show);
    ring.classList.toggle('on', show && !!r);
    const pad = 6;
    if (r && show) {
      Object.assign(ring.style, { left: `${r.l - pad}px`, top: `${r.t - pad}px`, width: `${r.r - r.l + pad * 2}px`, height: `${r.b - r.t + pad * 2}px` });
      const W = innerWidth, H = innerHeight, x0 = r.l - pad, y0 = r.t - pad, x1 = r.r + pad, y1 = r.b + pad;
      // «дырка» в затемнении над целью (правило evenodd)
      shade.style.clipPath = `path(evenodd, 'M0 0H${W}V${H}H0Z M${x0} ${y0}H${x1}V${y1}H${x0}Z')`;
    } else shade.style.clipPath = '';
    const text = show || (info?.text && !blocking) ? info!.text : '';
    bub.classList.toggle('on', !!text);
    const key = `${text}|${info?.next}`;
    if (key !== lastKey) {
      lastKey = key;
      bub.innerHTML = text ? `<p>${esc(text)}</p><div class="tut-btns"><button class="ghost sm" data-act="hs-tutskip">Пропустить обучение</button>${info?.next ? '<button class="primary sm tut-hl" data-act="hs-tutnext">Далее</button>' : ''}</div>` : '';
    }
    const low = r ? (r.t + r.b) / 2 > innerHeight * 0.45 : true;
    bub.classList.toggle('top', low); bub.classList.toggle('bottom', !low);
    tutRaf = requestAnimationFrame(frame);
  };
  tutRaf = requestAnimationFrame(frame);
}
