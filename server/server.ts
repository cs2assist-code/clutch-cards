// Сервер онлайна «Клатча» (Bun, без зависимостей): bun server/server.ts
//
// Сервер — единственный судья: на нём лежит настоящий стол и работает тот же движок (src/hs/engine.ts),
// клиент только присылает действия. Каждому игроку уходит его вид стола без чужих карт.
// Рейтинговая очередь (Bo1, вето карт), дуэли с другом по коду/ссылке, таймер хода, переподключение,
// рейтинг Эло, лиги и сезоны в SQLite.
//
// Переменные окружения:
//   PORT=8790             порт (за nginx: location /clutch-ws { proxy_pass http://127.0.0.1:8790; proxy_http_version 1.1;
//                         proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; })
//   BOT_TOKEN=...         токен бота — для проверки подписи Telegram initData (обязательно в бою)
//   ALLOW_DEV=1           пускать без Telegram по имени (для локальной проверки; по умолчанию — только без BOT_TOKEN)
//   DB=clutch-online.sqlite
//   STATS_KEY=...         пароль страницы аналитики: https://<домен>/clutch-ws/stats?key=… (события шлёт игра на …/clutch-ws/e)
//   PRIZES=server/prizes.json   призы сезона (пример — server/prizes.example.json)
//   TURN_SEC=30 MULL_SEC=30 BAN_SEC=15 GRACE_SEC=60 KNIFE_SEC=12 SIDE_SEC=15
// Новый сезон: bun server/server.ts --new-season "Сезон 2"   (рейтинг сжимается к 1000 наполовину, счёт игр — с нуля)
import { Database } from 'bun:sqlite';
import type { ServerWebSocket } from 'bun';
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { corsPreflight, initAnalytics, statsCsv, statsPage } from './analytics';
import { AGENTS, MAPS } from '../src/game/cards';
import { validDeck } from '../src/hs/cards';
import type { Side } from '../src/game/types';
import { canEco, choose, eco, endTurn, mulligan, newGame, setRng, startGame, type HState, type PI } from '../src/hs/engine';
import { apply } from '../src/hs/ai';
import { isMove, knifeFor, MOVES, newKnife, resolveKnife, type KnifeRound, type KnifeState, type Move } from '../src/hs/knife';
import {
  type HistRow, type PeerRow, type Prize, type SeasonPrizes, prizePlaces, HIDDEN, leagueOf, levelOf, MIN_RATING, rotateAction, rotateEv, unrotateAction, validAction, viewFor,
  type Agents, type C2S, type PlayerInfo, type S2C, type StepAction,
} from '../src/online/protocol';

const env = process.env;
const PORT = Number(env.PORT ?? 8790);
const BOT_TOKEN = env.BOT_TOKEN ?? '';
const ALLOW_DEV = env.ALLOW_DEV ? env.ALLOW_DEV === '1' : !BOT_TOKEN;
const TURN_MS = Number(env.TURN_SEC ?? 30) * 1000;
const MULL_MS = Number(env.MULL_SEC ?? 30) * 1000;
const BAN_MS = Number(env.BAN_SEC ?? 15) * 1000;
const KNIFE_MS = Number(env.KNIFE_SEC ?? 12) * 1000;   // на приём в ножевом раунде
const SIDE_MS = Number(env.SIDE_SEC ?? 15) * 1000;     // победителю ножей — на выбор стороны
const GRACE_MS = Number(env.GRACE_SEC ?? 60) * 1000;
const START_RATING = 1000;
const LEAVE_PENALTY = Number(env.LEAVE_PENALTY ?? 35);

// Случайность сервера — криптографическая: клиент не может её предсказать
setRng(() => randomInt(0, 2 ** 31) / 2 ** 31);

// ─────────────────────────── База ───────────────────────────
const db = new Database(env.DB ?? 'clutch-online.sqlite', { create: true });
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT NOT NULL, started INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, rating REAL NOT NULL, games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0, season INTEGER NOT NULL, peak REAL NOT NULL DEFAULT 1000, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, ranked INTEGER NOT NULL, season INTEGER NOT NULL,
  a TEXT NOT NULL, b TEXT NOT NULL, winner TEXT, reason TEXT, map TEXT, turns INTEGER,
  ra_before REAL, rb_before REAL, ra_after REAL, rb_after REAL);
CREATE INDEX IF NOT EXISTS players_top ON players (season, rating DESC);
CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS season_results (season INTEGER NOT NULL, place INTEGER NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, rating REAL NOT NULL, games INTEGER NOT NULL, prize TEXT, PRIMARY KEY (season, place));
CREATE INDEX IF NOT EXISTS matches_a ON matches (a, id); CREATE INDEX IF NOT EXISTS matches_b ON matches (b, id);`);

function currentSeason(): { id: number; name: string } {
  let row = db.query('SELECT id, name FROM seasons ORDER BY id DESC LIMIT 1').get() as { id: number; name: string } | null;
  if (!row) { db.run('INSERT INTO seasons (name, started) VALUES (?, ?)', ['Сезон 1', Date.now()]); row = currentSeason(); }
  return row;
}
// ── Призы сезона: server/prizes.json (путь можно задать PRIZES=…). Файл перечитывается при изменении, перезапуск не нужен.
//   { "ends": "2026-12-31", "minGames": 20, "prizes": [ { "place": 1, "skin": "AK-47 | Redline", "wear": "Field-Tested", "rarity": "classified", "image": "https://…" }, … ] }
const PRIZES_FILE = env.PRIZES ?? `${import.meta.dir}/prizes.json`;
let prizesCache: { mtime: number; data: SeasonPrizes | undefined } = { mtime: -1, data: undefined };
function seasonPrizes(): SeasonPrizes | undefined {
  try {
    const st = statSync(PRIZES_FILE);
    if (st.mtimeMs !== prizesCache.mtime) {
      const j = JSON.parse(readFileSync(PRIZES_FILE, 'utf8'));
      const prizes = (Array.isArray(j.prizes) ? j.prizes : []).filter((x: Prize) => x && Number(x.place) >= 1 && Number(x.place) <= 10 && typeof x.skin === 'string')
        .map((x: Prize) => ({ place: Number(x.place), skin: String(x.skin).slice(0, 60), wear: x.wear ? String(x.wear).slice(0, 30) : undefined, rarity: x.rarity ? String(x.rarity) : undefined,
          image: typeof x.image === 'string' && /^https:\/\//.test(x.image) ? x.image : undefined, price: x.price ? String(x.price).slice(0, 16) : undefined }))
        .sort((a: Prize, b: Prize) => a.place - b.place);
      const ends = j.ends ? Date.parse(j.ends) : NaN;
      prizesCache = { mtime: st.mtimeMs, data: prizes.length ? { ends: Number.isFinite(ends) ? ends : undefined, minGames: Math.max(0, Number(j.minGames) || 0), prizes } : undefined };
    }
  } catch { prizesCache = { mtime: -2, data: undefined }; }
  return prizesCache.data;
}
function topRows(season: number, limit = 50) {
  return (db.query('SELECT id, name, rating, games, wins FROM players WHERE season = ? AND games > 0 ORDER BY rating DESC LIMIT ?').all(season, limit) as PlayerRow[]);
}
if (process.argv[2] === '--new-season') {
  // Итоги прошлого сезона: кто занял призовые места (для выдачи скинов)
  const old = currentSeason(), pz = seasonPrizes(), rows = topRows(old.id, 500);
  const places = prizePlaces(rows, pz?.minGames ?? 0);
  for (const [r, place] of places) {
    const prize = pz?.prizes.find((x) => x.place === place);
    db.run('INSERT OR REPLACE INTO season_results (season, place, player, name, rating, games, prize) VALUES (?,?,?,?,?,?,?)', [old.id, place, r.id, r.name, r.rating, r.games, prize ? `${prize.skin}${prize.wear ? ` (${prize.wear})` : ''}` : null]);
    console.log(`#${place} ${r.name} (${r.id}) ${Math.round(r.rating)} Elo — ${prize?.skin ?? 'без приза'}`);
  }
  const name = process.argv[3] ?? `Сезон ${currentSeason().id + 1}`;
  db.run('INSERT INTO seasons (name, started) VALUES (?, ?)', [name, Date.now()]);
  const id = currentSeason().id;
  // Мягкий сброс: рейтинг сжимается к 1000 вдвое, счёт игр сезона — с нуля
  db.run('UPDATE players SET rating = ? + (rating - ?) / 2, games = 0, wins = 0, season = ?', [START_RATING, START_RATING, id]);
  console.log(`новый сезон: ${name} (#${id})`);
  process.exit(0);
}

interface PlayerRow { id: string; name: string; rating: number; games: number; wins: number; season: number; peak: number }
function loadPlayer(id: string, name: string): PlayerRow {
  const season = currentSeason().id;
  let p = db.query('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | null;
  if (!p) {
    db.run('INSERT INTO players (id, name, rating, season, peak, updated) VALUES (?, ?, ?, ?, ?, ?)', [id, name, START_RATING, season, START_RATING, Date.now()]);
    p = db.query('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow;
  } else if (p.name !== name) db.run('UPDATE players SET name = ? WHERE id = ?', [name, id]);
  return { ...p, name };
}
const info = (p: PlayerRow): PlayerInfo => {
  const rank = p.games ? (db.query('SELECT COUNT(*) AS n FROM players WHERE season = ? AND games > 0 AND rating > ?').get(p.season, p.rating) as { n: number }).n + 1 : undefined;
  return { id: p.id, name: p.name, rating: Math.round(p.rating), games: p.games, wins: p.wins, league: leagueOf(p.rating).name, provisional: p.games < 5, level: levelOf(p.rating).level, peak: Math.round(p.peak), rank };
};
/** Последние рейтинговые матчи игрока. */
function history(id: string): HistRow[] {
  const rows = db.query(`SELECT m.at, m.winner, m.a, m.b, m.ra_before, m.rb_before, m.ra_after, m.rb_after, m.map, m.reason, pa.name AS an, pb.name AS bn
    FROM matches m LEFT JOIN players pa ON pa.id = m.a LEFT JOIN players pb ON pb.id = m.b
    WHERE m.ranked = 1 AND (m.a = ? OR m.b = ?) ORDER BY m.id DESC LIMIT 15`).all(id, id) as { at: number; winner: string; a: string; b: string; ra_before: number; rb_before: number; ra_after: number; rb_after: number; map: string; reason: string; an: string; bn: string }[];
  return rows.map((m) => {
    const me = m.a === id;
    const before = me ? m.ra_before : m.rb_before, after = me ? m.ra_after : m.rb_after;
    return { at: m.at, win: m.winner === id, delta: Math.round(after) - Math.round(before), after: Math.round(after), opp: (me ? m.bn : m.an) ?? '?', oppId: me ? m.b : m.a, oppRating: Math.round(me ? m.rb_before : m.ra_before), map: m.map, reason: m.reason };
  });
}

// ─────────────────────────── Telegram ───────────────────────────
/** Проверка подписи initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
function checkInitData(initData: string): { id: string; name: string } | null {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  if (createHmac('sha256', secret).update(check).digest('hex') !== hash) return null;
  const authDate = Number(params.get('auth_date') ?? 0);
  if (Date.now() / 1000 - authDate > 24 * 3600) return null;   // подпись старше суток — переоткройте приложение
  try {
    const u = JSON.parse(params.get('user') ?? '{}') as { id?: number; first_name?: string; username?: string };
    if (!u.id) return null;
    return { id: `tg:${u.id}`, name: (u.first_name || u.username || 'Игрок').slice(0, 24) };
  } catch { return null; }
}

// ─────────────────────────── Соединения и комнаты ───────────────────────────
interface Conn { user?: { id: string; name: string }; msgs: number[]; lastRadio: number }
type WS = ServerWebSocket<Conn>;
interface Seat { id: string; name: string; rating: number; games: number; agents: Agents; ws: WS | null; grace?: ReturnType<typeof setTimeout>; mullDone: boolean }
interface Room {
  id: number; ranked: boolean; seats: [Seat, Seat];
  phase: 'knife' | 'side' | 'veto' | 'mull' | 'play' | 'over';
  knife: KnifeState; picks: [Move | null, Move | null]; sidesSet: boolean;
  maps: string[]; banned: { map: string; by: PI }[]; vetoTurn: PI;
  map: string; sides: [Side, Side]; agents: [string, string];
  s: HState | null; deadline: number; timer?: ReturnType<typeof setTimeout>;
}
const online = new Map<string, WS>();              // игрок → его соединение
const roomOf = new Map<string, Room>();            // игрок → комната
const queue: { id: string; name: string; rating: number; games: number; agents: Agents; since: number }[] = [];
const duels = new Map<string, { host: Omit<Seat, 'mullDone'>; at: number }>();
let roomSeq = 0;

const send = (ws: WS | null | undefined, m: S2C) => { try { ws?.send(JSON.stringify(m)); } catch { /* закрыто */ } };
const seatOf = (r: Room, id: string): PI => (r.seats[0].id === id ? 0 : 1);
const other = (p: PI): PI => (p === 0 ? 1 : 0);
const sideOther = (x: Side): Side => (x === 'T' ? 'CT' : 'T');

function validAgents(a: unknown): Agents | null {
  const o = a as Agents | undefined;
  const ok = (id: unknown, side: Side) => AGENTS.some((x) => x.id === id && x.side === side);
  if (!o || !ok(o.T, 'T') || !ok(o.CT, 'CT')) return null;
  const r: Agents = { T: o.T, CT: o.CT };
  // Свои колоды: берём, только если собраны по правилам (иначе — колода агента по умолчанию)
  if (validDeck(o.T, o.dT)) r.dT = [...o.dT];
  if (validDeck(o.CT, o.dCT)) r.dCT = [...o.dCT];
  return r;
}

function createRoom(a: Omit<Seat, 'mullDone'>, b: Omit<Seat, 'mullDone'>, ranked: boolean) {
  const r: Room = {
    id: ++roomSeq, ranked, seats: [{ ...a, mullDone: false }, { ...b, mullDone: false }], phase: 'knife',
    knife: newKnife(), picks: [null, null], sidesSet: false,
    maps: MAPS.map((m) => m.id), banned: [], vetoTurn: randomInt(0, 2) as PI, map: '', sides: ['T', 'CT'], agents: ['', ''], s: null, deadline: 0,
  };
  for (const st of r.seats) roomOf.set(st.id, r);
  for (const p of [0, 1] as PI[]) {
    const o = r.seats[other(p)];
    send(r.seats[p].ws, { t: 'found', ranked, opp: { id: o.id, name: o.name, rating: Math.round(o.rating), league: leagueOf(o.rating).name } });
  }
  knifeRound(r);
}

// ── Друзья, недавние соперники, профиль игрока ──
const isFriend = (a: string, b: string) => !!db.query('SELECT 1 FROM friends WHERE a = ? AND b = ?').get(a, b);
function peer(id: string, me: string, extra: Partial<PeerRow> = {}): PeerRow | null {
  const p = db.query('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | null;
  if (!p) return null;
  return { id, name: p.name, rating: Math.round(p.rating), games: p.games, online: online.has(id), inGame: roomOf.has(id), friend: isFriend(me, id), ...extra };
}
function friendsMsg(id: string): S2C {
  const fr = (db.query('SELECT b FROM friends WHERE a = ? ORDER BY at DESC LIMIT 100').all(id) as { b: string }[]).map((x) => peer(x.b, id)).filter(Boolean) as PeerRow[];
  fr.sort((x, y) => Number(y.online) - Number(x.online) || y.rating - x.rating);
  const seen = new Set<string>(), recent: PeerRow[] = [];
  for (const m of db.query('SELECT a, b, winner, at FROM matches WHERE a = ? OR b = ? ORDER BY id DESC LIMIT 60').all(id, id) as { a: string; b: string; winner: string; at: number }[]) {
    const o = m.a === id ? m.b : m.a;
    if (seen.has(o)) continue; seen.add(o);
    const r = peer(o, id, { at: m.at, win: m.winner === id }); if (r) recent.push(r);
    if (recent.length >= 15) break;
  }
  return { t: 'friends', friends: fr, recent };
}
function playerMsg(id: string, me: string): S2C | null {
  const p = db.query('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | null;
  if (!p) return null;
  const h = db.query('SELECT SUM(winner = ?) AS w, SUM(winner != ?) AS l FROM matches WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').get(me, me, me, id, id, me) as { w: number | null; l: number | null };
  return { t: 'player', me: info(p), history: history(id).slice(0, 8), h2h: { wins: h.w ?? 0, losses: h.l ?? 0 }, online: online.has(id), friend: isFriend(me, id) };
}
/** Вызовы на дуэль: код → кто кого позвал. Живут 60 с. */
const invites = new Map<string, { from: string; to: string; at: number }>();
/** Реванш: после матча игрок → соперник и его согласие. */
const rematch = new Map<string, { opp: string; agents?: Agents; at: number }>();

// ── Ножевой раунд: «Нож · Щит · Zeus» (src/hs/knife.ts). Победитель выбирает сторону, проигравший первым банит карту ──
function knifeMsg(r: Room, p: PI, reveal?: KnifeRound): S2C {
  const k = knifeFor(r.knife, p);
  const w = r.knife.winner;
  return {
    t: 'knife', k, picked: !!r.picks[p], oppPicked: !!r.picks[other(p)], deadline: r.deadline,
    reveal: reveal ? knifeFor({ ...r.knife, rounds: [reveal] }, p).rounds[0] : undefined,
    pick: w === null ? undefined : w === p ? 'me' : 'opp', oppAgents: r.seats[other(p)].agents,
  };
}
function knifeRound(r: Room) {
  r.picks = [null, null];
  setDeadline(r, KNIFE_MS, () => { for (const p of [0, 1] as PI[]) if (!r.picks[p]) doKnife(r, p, MOVES[randomInt(0, 3)]); });
  for (const p of [0, 1] as PI[]) send(r.seats[p].ws, knifeMsg(r, p));
}
function doKnife(r: Room, p: PI, m: Move) {
  if (r.phase !== 'knife' || r.picks[p] || !isMove(m)) return;
  r.picks[p] = m;
  if (!r.picks[0] || !r.picks[1]) { send(r.seats[other(p)].ws, knifeMsg(r, other(p))); send(r.seats[p].ws, knifeMsg(r, p)); return; }
  const rv = resolveKnife(r.knife, r.picks[0], r.picks[1]);
  r.picks = [null, null];
  if (r.knife.winner !== null) {
    r.phase = 'side';
    const w = r.knife.winner;
    setDeadline(r, SIDE_MS + 2000, () => doSide(r, w, randomInt(0, 2) ? 'T' : 'CT'));
    for (const q of [0, 1] as PI[]) send(r.seats[q].ws, knifeMsg(r, q, rv));
    return;
  }
  // следующий раунд через паузу, чтобы оба увидели, кто что выбрал
  setDeadline(r, KNIFE_MS + 1800, () => { for (const q of [0, 1] as PI[]) if (!r.picks[q]) doKnife(r, q, MOVES[randomInt(0, 3)]); });
  for (const q of [0, 1] as PI[]) send(r.seats[q].ws, knifeMsg(r, q, rv));
}
function doSide(r: Room, p: PI, side: Side) {
  if (r.phase !== 'side' || r.knife.winner !== p || (side !== 'T' && side !== 'CT')) return;
  r.sides = p === 0 ? [side, sideOther(side)] : [sideOther(side), side];
  r.sidesSet = true;
  r.phase = 'veto';
  r.vetoTurn = other(p);   // проигравший ножи первым убирает карту
  nextVeto(r);
}

// ── Вето карт (как в Premier): игроки по очереди вычёркивают карты, последняя оставшаяся — карта матча ──
function vetoMsg(r: Room, p: PI): S2C {
  return { t: 'veto', maps: r.maps, banned: r.banned.map((b) => ({ map: b.map, mine: b.by === p })), myTurn: r.vetoTurn === p && r.phase === 'veto', deadline: r.deadline, picked: r.map || undefined };
}
function nextVeto(r: Room) {
  const left = r.maps.filter((m) => !r.banned.some((b) => b.map === m));
  if (left.length <= 1) { r.map = left[0]; for (const p of [0, 1] as PI[]) send(r.seats[p].ws, vetoMsg(r, p)); startGameIn(r); return; }
  setDeadline(r, BAN_MS, () => doBan(r, r.vetoTurn, left[randomInt(0, left.length)]));
  for (const p of [0, 1] as PI[]) send(r.seats[p].ws, vetoMsg(r, p));
}
function doBan(r: Room, p: PI, map: string) {
  if (r.phase !== 'veto' || r.vetoTurn !== p || !r.maps.includes(map) || r.banned.some((b) => b.map === map)) return;
  r.banned.push({ map, by: p });
  r.vetoTurn = other(p);
  nextVeto(r);
}

// ── Игра ──
function startGameIn(r: Room) {
  if (!r.sidesSet) { const tSeat = randomInt(0, 2) as PI; r.sides = tSeat === 0 ? ['T', 'CT'] : ['CT', 'T']; }
  r.agents = [r.seats[0].agents[r.sides[0]], r.seats[1].agents[r.sides[1]]];
  const deckOf = (p: PI) => (r.sides[p] === 'T' ? r.seats[p].agents.dT : r.seats[p].agents.dCT);
  r.s = newGame(r.agents, r.sides, r.map, [deckOf(0), deckOf(1)]);
  r.s.log = [];
  r.phase = 'mull';
  setDeadline(r, MULL_MS + 3000, () => { for (const p of [0, 1] as PI[]) if (!r.seats[p].mullDone) doMull(r, p, []); });
  for (const p of [0, 1] as PI[]) send(r.seats[p].ws, startMsg(r, p));
}
const startMsg = (r: Room, p: PI): S2C => ({ t: 'start', map: r.map, side: r.sides[p], myAgent: r.agents[p], oppAgent: r.agents[other(p)], view: viewFor(r.s!, p), deadline: r.deadline });

function doMull(r: Room, p: PI, uids: string[]) {
  if (r.phase !== 'mull' || r.seats[p].mullDone) return;
  const own = new Set(r.s!.p[p].hand.map((c) => c.uid));
  mulligan(r.s!, p, uids.filter((u) => typeof u === 'string' && own.has(u)).slice(0, 7));
  r.seats[p].mullDone = true;
  if (!r.seats[0].mullDone || !r.seats[1].mullDone) return;
  r.s!.log = [];
  startGame(r.s!);
  r.phase = 'play';
  const evs = r.s!.log; r.s!.log = [];
  setTurnTimer(r);
  for (const q of [0, 1] as PI[]) send(r.seats[q].ws, { t: 'begin', view: viewFor(r.s!, q), events: evs.map((e) => rotateEv(e, q)), deadline: r.deadline });
  if (r.s!.winner !== null) finish(r, r.s!.winner, r.s!.reason);
}

function setDeadline(r: Room, ms: number, cb: () => void) {
  clearTimeout(r.timer);
  r.deadline = Date.now() + ms;
  r.timer = setTimeout(cb, ms + 1500);   // +1,5 с на задержку сети: игрок видит ровно ms
}
/** Таймер хода: не успел — ход заканчивается сам (открытый выбор карты — первая карта). */
function setTurnTimer(r: Room) {
  const turn = r.s!.turn;
  setDeadline(r, TURN_MS, () => { if (r.phase === 'play' && r.s!.turn === turn) doEnd(r, turn); });
}

function broadcastStep(r: Room, actor: PI, a: StepAction, card?: string) {
  const s = r.s!;
  const evs = s.log; s.log = [];
  for (const q of [0, 1] as PI[]) {
    send(r.seats[q].ws, {
      t: 'step', actor: actor === q ? 0 : 1, a: rotateAction(a, q), card, events: evs.map((e) => rotateEv(e, q)), view: viewFor(s, q), deadline: r.deadline,
    });
  }
  if (s.winner !== null) finish(r, s.winner, s.reason);
}
function doAct(r: Room, p: PI, raw: unknown, ws: WS) {
  const s = r.s;
  if (r.phase !== 'play' || !s || s.turn !== p || !validAction(raw)) return send(ws, { t: 'deny', reason: 'Сейчас так нельзя' });
  const a = unrotateAction(raw, p) as typeof raw;
  // Какую карту разыграли — сопернику её покажут (засаду — нет: она лежит рубашкой вверх)
  let card: string | undefined;
  if (a.k === 'play') { const id = s.p[p].hand.find((c) => c.uid === a.uid)?.id; card = id && id !== HIDDEN ? id : undefined; }
  s.log = [];
  if (!apply(s, p, a)) return send(ws, { t: 'deny', reason: 'Действие не прошло' });
  if (card && s.log.some((e) => e.t === 'play' && e.card === 'trap')) card = 'trap';
  broadcastStep(r, p, a, card);
}
function doEnd(r: Room, p: PI, ecoPick?: unknown) {
  const s = r.s;
  if (r.phase !== 'play' || !s || s.turn !== p || s.winner !== null) return;
  s.log = [];
  if ((ecoPick === 'cards' || ecoPick === 'cash') && canEco(s, p)) eco(s, p, ecoPick);
  else { if (s.p[p].choice) choose(s, p, 0); endTurn(s); }
  if (s.winner === null) setTurnTimer(r);
  broadcastStep(r, p, { k: 'end' });
}

// ── Итог: рейтинг Эло как на FACEIT: равные соперники — ±25, против сильного побеждать выгоднее. Не ниже 100 ──
function finish(r: Room, winner: PI, reason: string) {
  if (r.phase === 'over') return;
  r.phase = 'over';
  clearTimeout(r.timer);
  for (const st of r.seats) clearTimeout(st.grace);
  const season = currentSeason().id;
  const [A, B] = r.seats;
  const ra = A.rating, rb = B.rating;
  let na = ra, nb = rb;
  if (r.ranked) {
    const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
    const K = 50;
    const sa = winner === 0 ? 1 : 0;
    const d = Math.max(5, Math.min(45, Math.round(K * Math.abs(sa - ea))));   // всегда от 5 до 45 очков
    na = Math.max(MIN_RATING, ra + (sa ? d : -d));
    nb = Math.max(MIN_RATING, rb + (sa ? -d : d));
    // Вышел из матча и не вернулся — фиксированный штраф ${LEAVE_PENALTY} Elo (без бана поиска)
    if (reason === 'leave') { if (sa) nb = Math.max(MIN_RATING, rb - LEAVE_PENALTY); else na = Math.max(MIN_RATING, ra - LEAVE_PENALTY); }
    const upd = db.prepare('UPDATE players SET rating = ?, games = games + 1, wins = wins + ?, peak = MAX(peak, ?), updated = ? WHERE id = ?');
    upd.run(na, winner === 0 ? 1 : 0, na, Date.now(), A.id);
    upd.run(nb, winner === 1 ? 1 : 0, nb, Date.now(), B.id);
  }
  db.run('INSERT INTO matches (at, ranked, season, a, b, winner, reason, map, turns, ra_before, rb_before, ra_after, rb_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [Date.now(), r.ranked ? 1 : 0, season, A.id, B.id, r.seats[winner].id, reason, r.map, r.s?.turnNo ?? 0, ra, rb, na, nb]);
  for (const p of [0, 1] as PI[]) {
    const before = p === 0 ? ra : rb, after = p === 0 ? na : nb;
    send(r.seats[p].ws, { t: 'over', winner: winner === p ? 0 : 1, reason, ranked: r.ranked, rating: r.ranked ? { before: Math.round(before), after: Math.round(after), league: leagueOf(after).name } : undefined });
    roomOf.delete(r.seats[p].id);
    rematch.set(r.seats[p].id, { opp: r.seats[other(p)].id, at: Date.now() });
    const ws = r.seats[p].ws;
    if (ws?.data.user) send(ws, { t: 'me', me: info(loadPlayer(ws.data.user.id, ws.data.user.name)), season: currentSeason().name });
  }
}

// ── Подбор как на FACEIT: сначала соперник в пределах ±100 рейтинга (обычно ваш уровень или соседний),
//    за каждые 5 с ожидания окно шире на 25, но не больше ±350 (примерно ±2 уровня). Пара — ближайшие по рейтингу ──
export const MM_BASE = Number(env.MM_BASE ?? 100), MM_STEP = Number(env.MM_STEP ?? 25), MM_MAX = Number(env.MM_MAX ?? 350);
const windowOf = (q: { since: number }, now: number) => Math.min(MM_MAX, MM_BASE + Math.floor((now - q.since) / 5000) * MM_STEP);
setInterval(() => {
  queue.sort((a, b) => a.rating - b.rating);
  const now = Date.now();
  for (let i = 0; i + 1 < queue.length; i++) {
    const a = queue[i], b = queue[i + 1];
    // подходит, только если каждый из двоих готов к такой разнице
    if (Math.abs(a.rating - b.rating) > Math.min(windowOf(a, now), windowOf(b, now))) continue;
    queue.splice(i, 2); i--;
    const seat = (q: typeof a) => ({ id: q.id, name: q.name, rating: q.rating, games: q.games, agents: q.agents, ws: online.get(q.id) ?? null });
    createRoom(seat(a), seat(b), true);
  }
  for (const q of queue) { const w = windowOf(q, now); send(online.get(q.id), { t: 'queued', size: queue.length, lo: Math.max(MIN_RATING, Math.round(q.rating - w)), hi: Math.round(q.rating + w), since: q.since }); }
  for (const [code, d] of duels) if (now - d.at > 15 * 60_000) duels.delete(code);
  for (const [code, v] of invites) if (now - v.at > 60_000) { invites.delete(code); duels.delete(code); send(online.get(v.from), { t: 'invite_status', state: 'expired', name: (db.query('SELECT name FROM players WHERE id = ?').get(v.to) as { name: string } | null)?.name ?? '' }); }
  for (const [id, v] of rematch) if (now - v.at > 120_000) rematch.delete(id);
}, 1000);

const leaveQueue = (id: string) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); };
const duelCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += A[randomInt(0, A.length)]; return duels.has(c) ? duelCode() : c; };

function onDisconnect(id: string) {
  leaveQueue(id);
  for (const [code, d] of duels) if (d.host.id === id) duels.delete(code);
  const r = roomOf.get(id);
  if (!r || r.phase === 'over') return;
  const p = seatOf(r, id);
  r.seats[p].ws = null;
  const until = Date.now() + GRACE_MS;
  send(r.seats[other(p)].ws, { t: 'opp_status', online: false, graceUntil: until });
  // Не вернулся за GRACE_SEC — техническое поражение
  r.seats[p].grace = setTimeout(() => { if (!r.seats[p].ws && r.phase !== 'over') finish(r, other(p), 'leave'); }, GRACE_MS);
}
function onReconnect(ws: WS, r: Room) {
  const p = seatOf(r, ws.data.user!.id);
  const st = r.seats[p];
  clearTimeout(st.grace);
  st.ws = ws;
  send(r.seats[other(p)].ws, { t: 'opp_status', online: true });
  const o = r.seats[other(p)];
  send(ws, { t: 'found', ranked: r.ranked, opp: { id: o.id, name: o.name, rating: Math.round(o.rating), league: leagueOf(o.rating).name } });
  if (r.phase === 'knife' || r.phase === 'side') send(ws, knifeMsg(r, p, r.knife.rounds[r.knife.rounds.length - 1]));
  else if (r.phase === 'veto') send(ws, vetoMsg(r, p));
  else send(ws, { t: 'sync', phase: r.phase === 'mull' ? 'mull' : 'play', view: viewFor(r.s!, p), deadline: r.deadline, map: r.map, side: r.sides[p], myAgent: r.agents[p], oppAgent: r.agents[other(p)], mullDone: st.mullDone });
}

// ─────────────────────────── Сообщения ───────────────────────────
function onMessage(ws: WS, m: C2S) {
  const c = ws.data;
  if (m.t === 'ping') return send(ws, { t: 'pong', now: Date.now() });
  if (m.t === 'hello') {
    const tg = checkInitData(m.initData ?? '');
    const dev = !tg && ALLOW_DEV && typeof m.dev === 'string' ? m.dev.replace(/[^\w-]/g, '').slice(0, 24) : '';
    if (!tg && !dev) return send(ws, { t: 'err', msg: 'Не удалось проверить вход через Telegram. Откройте игру из бота.' });
    c.user = tg ?? { id: `dev:${dev}`, name: (typeof m.name === 'string' && m.name.trim().slice(0, 24)) || dev };
    const old = online.get(c.user.id);
    if (old && old !== ws) { send(old, { t: 'err', msg: 'Игра открыта на другом устройстве' }); try { old.close(); } catch { /* уже */ } }
    online.set(c.user.id, ws);
    send(ws, { t: 'me', me: info(loadPlayer(c.user.id, c.user.name)), season: currentSeason().name });
    const r = roomOf.get(c.user.id);
    if (r && r.phase !== 'over') onReconnect(ws, r);
    return;
  }
  const u = c.user;
  if (!u) return send(ws, { t: 'err', msg: 'Сначала вход' });
  const r = roomOf.get(u.id);
  switch (m.t) {
    case 'top': {
      const season = currentSeason();
      const rows = topRows(season.id).map((x) => ({ id: x.id, name: x.name, rating: Math.round(x.rating), games: x.games, wins: x.wins, league: leagueOf(x.rating).name }));
      return send(ws, { t: 'top', rows, season: season.name, prizes: seasonPrizes() });
    }
    case 'profile': send(ws, { t: 'me', me: info(loadPlayer(u.id, u.name)), season: currentSeason().name }); return send(ws, { t: 'profile', history: history(u.id) });
    case 'queue': {
      const agents = validAgents(m.agents);
      if (!agents || r) return send(ws, { t: 'err', msg: r ? 'Вы уже в игре' : 'Неверные агенты' });
      leaveQueue(u.id);
      const p = loadPlayer(u.id, u.name);
      const since = Date.now();
      queue.push({ id: u.id, name: u.name, rating: p.rating, games: p.games, agents, since });
      return send(ws, { t: 'queued', size: queue.length, lo: Math.max(MIN_RATING, Math.round(p.rating - MM_BASE)), hi: Math.round(p.rating + MM_BASE), since });
    }
    case 'unqueue': leaveQueue(u.id); return;
    case 'friends': return send(ws, friendsMsg(u.id));
    case 'friend_add': {
      const id = String(m.id ?? '');
      if (id && id !== u.id && db.query('SELECT 1 FROM players WHERE id = ?').get(id)) db.run('INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, ?)', [u.id, id, Date.now()]);
      return send(ws, friendsMsg(u.id));
    }
    case 'friend_del': db.run('DELETE FROM friends WHERE a = ? AND b = ?', [u.id, String(m.id ?? '')]); return send(ws, friendsMsg(u.id));
    case 'player': { const msg = playerMsg(String(m.id ?? ''), u.id); return msg ? send(ws, msg) : send(ws, { t: 'err', msg: 'Игрок не найден' }); }
    case 'invite': {
      const agents = validAgents(m.agents), to = String(m.id ?? '');
      const target = db.query('SELECT name FROM players WHERE id = ?').get(to) as { name: string } | null;
      if (!agents || !target || to === u.id) return send(ws, { t: 'err', msg: 'Нельзя вызвать этого игрока' });
      if (r) return send(ws, { t: 'err', msg: 'Вы уже в игре' });
      const tws = online.get(to);
      if (!tws) return send(ws, { t: 'invite_status', state: 'offline', name: target.name });
      if (roomOf.has(to)) return send(ws, { t: 'invite_status', state: 'busy', name: target.name });
      for (const [code, d] of duels) if (d.host.id === u.id) duels.delete(code);
      const p = loadPlayer(u.id, u.name), code = duelCode();
      duels.set(code, { host: { id: u.id, name: u.name, rating: p.rating, games: p.games, agents, ws }, at: Date.now() });
      invites.set(code, { from: u.id, to, at: Date.now() });
      send(tws, { t: 'invited', code, from: { id: u.id, name: u.name, rating: Math.round(p.rating) } });
      send(ws, { t: 'duel_code', code });
      return send(ws, { t: 'invite_status', state: 'sent', name: target.name });
    }
    case 'invite_answer': {
      const code = String(m.code ?? '').toUpperCase(), inv = invites.get(code);
      if (!inv || inv.to !== u.id) return send(ws, { t: 'err', msg: 'Вызов устарел' });
      invites.delete(code);
      if (!m.accept) { duels.delete(code); return send(online.get(inv.from), { t: 'invite_status', state: 'declined', name: u.name }); }
      return onMessage(ws, { t: 'duel_join', code, agents: m.agents as Agents });
    }
    case 'rematch': {
      const agents = validAgents(m.agents), rm = rematch.get(u.id);
      if (!agents || !rm || Date.now() - rm.at > 120_000) return send(ws, { t: 'rematch', state: 'gone' });
      if (r || roomOf.has(rm.opp)) return send(ws, { t: 'rematch', state: 'gone' });
      rm.agents = agents;
      const other = rematch.get(rm.opp);
      if (other?.opp === u.id && other.agents) {
        rematch.delete(u.id); rematch.delete(rm.opp);
        const a = loadPlayer(u.id, u.name), bRow = db.query('SELECT * FROM players WHERE id = ?').get(rm.opp) as PlayerRow;
        leaveQueue(u.id); leaveQueue(rm.opp);
        createRoom({ id: u.id, name: u.name, rating: a.rating, games: a.games, agents, ws }, { id: rm.opp, name: bRow.name, rating: bRow.rating, games: bRow.games, agents: other.agents, ws: online.get(rm.opp) ?? null }, false);
        return;
      }
      send(online.get(rm.opp), { t: 'rematch', state: 'offer' });
      return send(ws, { t: 'rematch', state: 'wait' });
    }
    case 'duel_create': {
      const agents = validAgents(m.agents);
      if (!agents || r) return send(ws, { t: 'err', msg: 'Нельзя создать дуэль сейчас' });
      for (const [code, d] of duels) if (d.host.id === u.id) duels.delete(code);
      const p = loadPlayer(u.id, u.name);
      const code = duelCode();
      duels.set(code, { host: { id: u.id, name: u.name, rating: p.rating, games: p.games, agents, ws }, at: Date.now() });
      return send(ws, { t: 'duel_code', code });
    }
    case 'duel_cancel': for (const [code, d] of duels) if (d.host.id === u.id) duels.delete(code); return;
    case 'duel_join': {
      const agents = validAgents(m.agents);
      const code = String(m.code ?? '').toUpperCase();
      const d = duels.get(code);
      if (!agents || !d) return send(ws, { t: 'err', msg: 'Дуэль не найдена или уже началась' });
      if (d.host.id === u.id) return send(ws, { t: 'err', msg: 'Это ваша дуэль — отправьте ссылку другу' });
      if (r || roomOf.get(d.host.id)) return send(ws, { t: 'err', msg: 'Кто-то из игроков уже в игре' });
      duels.delete(code);
      leaveQueue(u.id); leaveQueue(d.host.id);
      const p = loadPlayer(u.id, u.name);
      createRoom({ ...d.host, ws: online.get(d.host.id) ?? d.host.ws }, { id: u.id, name: u.name, rating: p.rating, games: p.games, agents, ws }, false);
      return;
    }
  }
  if (!r) return send(ws, { t: 'err', msg: 'Вы не в игре' });
  const p = seatOf(r, u.id);
  switch (m.t) {
    case 'knife': return doKnife(r, p, m.move);
    case 'side': return doSide(r, p, m.side);
    case 'ban': return doBan(r, p, String(m.map));
    case 'mull': return doMull(r, p, Array.isArray(m.uids) ? m.uids : []);
    case 'act': return doAct(r, p, m.a, ws);
    case 'end': return doEnd(r, p, m.eco);
    case 'resign': if (r.phase !== 'over') finish(r, other(p), 'resign'); return;
    case 'radio': {
      // Радиокоманды вместо чата: только готовые фразы и не чаще раза в 2,5 с
      const now = Date.now();
      if (now - c.lastRadio < 2500 || !RADIO.has(m.key)) return;
      c.lastRadio = now;
      return send(r.seats[other(p)].ws, { t: 'radio', key: m.key });
    }
  }
}
const RADIO = new Set(['go', 'enemyspotted', 'needbackup', 'takingfire', 'niceshot', 'clutch', 'enemydown']);

// ─────────────────────────── HTTP + WebSocket ───────────────────────────
const STATS_KEY = env.STATS_KEY ?? '';
const analytics = initAnalytics(db);
const server = Bun.serve<Conn, undefined>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/ws')) {
      if (srv.upgrade(req, { data: { msgs: [], lastRadio: 0 } })) return undefined;
      return new Response('upgrade failed', { status: 400 });
    }
    if (req.method === 'OPTIONS') return corsPreflight();
    if (req.method === 'POST' && url.pathname.endsWith('/e')) {
      const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? srv.requestIP(req)?.address ?? '?';
      return analytics.collect(req, ip);
    }
    if (url.pathname.endsWith('/stats')) {
      const key = url.searchParams.get('key') ?? '';
      if (!STATS_KEY || key !== STATS_KEY) return new Response('Нужен ?key= (переменная STATS_KEY на сервере)', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (url.searchParams.get('csv')) return new Response(statsCsv(db), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="clutch-events.csv"' } });
      const days = Math.max(1, Math.min(120, Number(url.searchParams.get('days')) || 30));
      return new Response(statsPage(db, days).replace('__KEY__', encodeURIComponent(key)), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname.endsWith('/health')) return Response.json({ ok: true, online: online.size, queue: queue.length, rooms: new Set(roomOf.values()).size });
    return new Response('Клатч: сервер онлайна. WebSocket — /ws', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  websocket: {
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,
    message(ws, raw) {
      // Не больше 25 сообщений в секунду с одного соединения
      const now = Date.now();
      ws.data.msgs = ws.data.msgs.filter((t) => now - t < 1000); ws.data.msgs.push(now);
      if (ws.data.msgs.length > 25) return;
      let m: C2S;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      try { onMessage(ws, m); } catch (e) { console.error('message error', e); send(ws, { t: 'err', msg: 'Ошибка сервера' }); }
    },
    close(ws) {
      const id = ws.data.user?.id;
      if (id && online.get(id) === ws) { online.delete(id); onDisconnect(id); }
    },
  },
});
console.log(`Клатч онлайн: ws://localhost:${server.port}/ws · ${BOT_TOKEN ? 'проверка Telegram включена' : 'без BOT_TOKEN'}${ALLOW_DEV ? ' · вход по имени разрешён (ALLOW_DEV)' : ''} · сезон «${currentSeason().name}»`);
