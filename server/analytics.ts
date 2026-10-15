// Анонимная аналитика «Клатча» прямо в сервере онлайна (та же база SQLite).
//   POST /e                 — пачка событий от игры: { uid, v, events: [{ t, e, p }] } (до 64 КБ, до 200 событий)
//   GET  /stats?key=…       — страница с воронкой, обучением, возвратами, онлайном и ошибками (ключ — STATS_KEY)
//   GET  /stats.csv?key=…   — выгрузка событий за 30 дней
// Хранятся только случайный номер устройства, имя события и параметры игры — без имён и Telegram-ID.
// События старше 120 дней удаляются раз в сутки.
import type { Database } from 'bun:sqlite';

const MAX_BODY = 64 * 1024;
const KEEP_DAYS = 120;
const TZ_MS = 3 * 3600_000;   // дни считаем по московскому времени
const dayOf = (ms: number) => new Date(ms + TZ_MS).toISOString().slice(0, 10);

const AGENT_RU: Record<string, string> = {
  ct_swat: 'Командир SWAT', ct_seal: 'Снайпер SEAL', ct_fbi: 'Сапёр FBI', ct_sas: 'Штурмовик SAS', ct_gign: 'Жандарм GIGN',
  t_phoenix: 'Подрывник Phoenix', t_elite: 'Штурмовик Elite Crew', t_balkan: 'Поджигатель Balkan', t_guerrilla: 'Партизан', t_pro: 'Наёмник',
};
const REASON_RU: Record<string, string> = { bomb: 'Взрыв бомбы', defuse: 'Разминирование', hero: 'Герой повержен', resign: 'Сдался', leave: 'Вышел из матча', fatigue: 'Пустая колода' };
const DIFF_RU: Record<string, string> = { easy: 'Новичок', normal: 'Обычный', hard: 'Сложный' };

export function initAnalytics(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS events (uid TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL, ev TEXT NOT NULL, props TEXT, v TEXT);
    CREATE INDEX IF NOT EXISTS events_day ON events (day); CREATE INDEX IF NOT EXISTS events_ev ON events (ev, day);`);
  const ins = db.prepare('INSERT INTO events (uid, ts, day, ev, props, v) VALUES (?, ?, ?, ?, ?, ?)');
  const insMany = db.transaction((rows: [string, number, string, string, string | null, string][]) => { for (const r of rows) ins.run(...r); });
  const cleanup = () => db.run('DELETE FROM events WHERE ts < ?', [Date.now() - KEEP_DAYS * 86_400_000]);
  cleanup(); setInterval(cleanup, 86_400_000);

  // Не больше 30 пачек в минуту с одного адреса
  const hits = new Map<string, number[]>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k); }, 60_000);

  async function collect(req: Request, ip: string): Promise<Response> {
    const now = Date.now();
    const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    h.push(now); hits.set(ip, h);
    if (h.length > 30) return cors(new Response('slow down', { status: 429 }));
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) return cors(new Response('too big', { status: 413 }));
    let body: { uid?: unknown; v?: unknown; events?: unknown };
    try { const txt = await req.text(); if (txt.length > MAX_BODY) throw 0; body = JSON.parse(txt); } catch { return cors(new Response('bad', { status: 400 })); }
    const uid = String(body.uid ?? '').replace(/[^\w-]/g, '').slice(0, 40), v = String(body.v ?? '').slice(0, 8);
    if (!uid || !Array.isArray(body.events)) return cors(new Response('bad', { status: 400 }));
    const rows: [string, number, string, string, string | null, string][] = [];
    for (const e of body.events.slice(0, 200) as { t?: unknown; e?: unknown; p?: unknown }[]) {
      if (!e || typeof e !== 'object') continue;
      let ts = Number(e.t) || now;
      if (Math.abs(ts - now) > 3 * 86_400_000) ts = now;   // часы устройства сильно врут — берём время сервера
      const name = String(e.e ?? '').replace(/[^\w]/g, '').slice(0, 40);
      if (!name) continue;
      const p = e.p && typeof e.p === 'object' && !Array.isArray(e.p) ? JSON.stringify(e.p).slice(0, 1000) : null;
      rows.push([uid, ts, dayOf(ts), name, p, v]);
    }
    if (rows.length) insMany(rows);
    return cors(new Response(String(rows.length)));
  }
  return { collect };
}

const cors = (r: Response) => { r.headers.set('Access-Control-Allow-Origin', '*'); r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); r.headers.set('Access-Control-Allow-Headers', 'Content-Type'); return r; };
export const corsPreflight = () => cors(new Response(null, { status: 204 }));

// ─────────────────────────── Отчёт ───────────────────────────
type Row = { uid: string; ts: number; day: string; ev: string; props: string | null };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');

export function statsCsv(db: Database): string {
  const rows = db.query('SELECT uid, ts, day, ev, props, v FROM events WHERE ts > ? ORDER BY ts').all(Date.now() - 30 * 86_400_000) as (Row & { v: string })[];
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return '﻿uid,ts,day,event,props,v\n' + rows.map((r) => [r.uid, r.ts, r.day, r.ev, r.props, r.v].map(q).join(',')).join('\n');
}

export function statsPage(db: Database, days = 30): string {
  const since = Date.now() - days * 86_400_000;
  const rows = db.query('SELECT uid, ts, day, ev, props FROM events WHERE ts > ?').all(since) as Row[];
  // первый день каждого устройства — по всей истории, иначе «новые» врут на границе окна
  const firstAll = new Map((db.query('SELECT uid, MIN(day) AS d FROM events GROUP BY uid').all() as { uid: string; d: string }[]).map((r) => [r.uid, r.d]));
  const active = new Map<string, Set<string>>();
  const byEv = new Map<string, { uid: string; p: Record<string, unknown>; day: string }[]>();
  for (const r of rows) {
    (active.get(r.uid) ?? active.set(r.uid, new Set()).get(r.uid)!).add(r.day);
    let p: Record<string, unknown> = {};
    if (r.props) try { p = JSON.parse(r.props); } catch { /* битая строка */ }
    (byEv.get(r.ev) ?? byEv.set(r.ev, []).get(r.ev)!).push({ uid: r.uid, p, day: r.day });
  }
  const evs = (e: string) => byEv.get(e) ?? [];
  const usersWith = (e: string, f: (p: Record<string, unknown>) => boolean = () => true) => new Set(evs(e).filter((x) => f(x.p)).map((x) => x.uid));
  const users = new Set(active.keys());
  const today = dayOf(Date.now());
  const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

  // Воронка
  const opened = usersWith('app_open');
  const funnel: [string, Set<string>, Set<string>][] = [];
  const tutS = usersWith('tut_start'), tutD = usersWith('tut_done'), tutG = usersWith('hs_game', (p) => !!p.tut);
  const botS = usersWith('hs_start', (p) => !p.tut), botG = usersWith('hs_game', (p) => !p.tut);
  const olO = usersWith('online_open'), olQ = usersWith('online_queue'), olF = usersWith('online_found'), olE = usersWith('online_end');
  funnel.push(['Открыли игру', opened, opened], ['Начали обучение', tutS, opened], ['Прошли все подсказки', tutD, tutS], ['Доиграли обучающий матч', tutG, tutS],
    ['Начали игру с ботом', botS, opened], ['Доиграли игру с ботом', botG, botS],
    ['Открыли онлайн', olO, opened], ['Встали в очередь', olQ, olO], ['Нашли соперника', olF, olQ], ['Доиграли онлайн-матч', olE, olF]);

  // Обучение по шагам
  const stepReach = new Map<number, { id: string; n: Set<string> }>();
  for (const x of evs('tut_step')) { const n = Number(x.p.n); const s = stepReach.get(n) ?? { id: String(x.p.id ?? ''), n: new Set() }; s.n.add(x.uid); stepReach.set(n, s); }
  const skips = new Map<string, number>();
  for (const x of evs('tut_skip')) skips.set(String(x.p.id || x.p.n), (skips.get(String(x.p.id || x.p.n)) ?? 0) + 1);

  // Возвраты по когортам
  const ret = [1, 3, 7, 14, 30].map((n) => {
    const base = [...users].filter((u) => { const f = firstAll.get(u)!; return f >= dayOf(since) && addDays(f, n) <= today; });
    const back = base.filter((u) => active.get(u)!.has(addDays(firstAll.get(u)!, n)));
    return { n, back: back.length, base: base.length };
  });

  // По дням
  const matchesByDay = new Map<string, { all: number; ranked: number }>();
  for (const m of db.query('SELECT at, ranked FROM matches WHERE at > ?').all(since) as { at: number; ranked: number }[]) {
    const d = dayOf(m.at), x = matchesByDay.get(d) ?? { all: 0, ranked: 0 }; x.all++; if (m.ranked) x.ranked++; matchesByDay.set(d, x);
  }
  const daily: { d: string; dau: number; nw: number; bot: number; ol: number; rk: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    const dau = [...active.values()].filter((s) => s.has(d)).length;
    const nw = [...users].filter((u) => firstAll.get(u) === d).length;
    const bot = evs('hs_game').filter((x) => x.day === d).length;
    const mm = matchesByDay.get(d);
    if (dau || nw || mm) daily.push({ d, dau, nw, bot, ol: mm?.all ?? 0, rk: mm?.ranked ?? 0 });
  }

  // Игры с ботом
  const wl = (list: { p: Record<string, unknown> }[], key: (p: Record<string, unknown>) => string) => {
    const m = new Map<string, [number, number]>();
    for (const { p } of list) { const k = key(p), v = m.get(k) ?? [0, 0]; v[0]++; if (p.win) v[1]++; m.set(k, v); }
    return [...m].sort((a, b) => b[1][0] - a[1][0]);
  };
  const botGames = evs('hs_game').filter((x) => !x.p.tut);
  const olGames = evs('online_end');
  const avg = (a: number[]) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '—');
  const waits = evs('online_found').filter((x) => x.p.ranked).map((x) => Number(x.p.wait) || 0).sort((a, b) => a - b);
  const median = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  const counter = (list: { p: Record<string, unknown> }[], key: (p: Record<string, unknown>) => string) => {
    const m = new Map<string, number>(); for (const { p } of list) m.set(key(p), (m.get(key(p)) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]);
  };
  const loadMs = evs('app_open').map((x) => Number(x.p.ms) || 0).filter((x) => x > 0).sort((a, b) => a - b);

  // ── HTML ──
  const tr = (cells: unknown[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const bar = (v: number, m: number) => `<span class="bar"><i style="width:${m ? Math.round((100 * v) / m) : 0}%"></i></span>`;
  const table = (title: string, body: string, note = '') => `<h2>${title}</h2><table>${body}</table>${note ? `<p class="m">${note}</p>` : ''}`;
  const wlTable = (title: string, data: [string, [number, number]][], names: Record<string, string> = {}) =>
    table(title, data.map(([k, [n, w]]) => tr([esc(names[k] ?? k), `${n} игр`, `побед ${pct(w, n)}`, bar(w, n)])).join(''));
  const tiles: [string, unknown][] = [
    ['устройств за 30 дней', users.size], ['сегодня', daily[0]?.d === today ? daily[0].dau : 0], ['новых сегодня', daily[0]?.d === today ? daily[0].nw : 0],
    ['игр с ботом', botGames.length], ['онлайн-матчей', olGames.length], ['медиана поиска, с', median(waits)],
    ['загрузка, медиана', loadMs.length ? `${(median(loadMs) / 1000).toFixed(1)} с` : '—'], ['ошибок JS', evs('js_error').length],
  ];
  const out: string[] = [`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Клатч · аналитика</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#111418;color:#e6ebf1}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;color:#f2c14e}
small,.m{color:#8b95a3}table{border-collapse:collapse;width:100%;max-width:820px}td{padding:5px 8px;border-bottom:1px solid #232933}td:not(:first-child){text-align:right;white-space:nowrap}
.bar{display:inline-block;width:120px;height:8px;background:#232933;border-radius:4px;overflow:hidden;vertical-align:middle}.bar i{display:block;height:100%;background:#8fcb44}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;max-width:820px}.grid div{background:#1a1f26;border-radius:8px;padding:10px}.grid b{display:block;font-size:22px}
</style><h1>Клатч · аналитика</h1><p class="m">За ${days} дней · событий: ${rows.length} · обновлено ${new Date(Date.now() + TZ_MS).toISOString().slice(0, 16).replace('T', ' ')} МСК · <a style="color:#8fcb44" href="?key=__KEY__&csv=1">CSV</a></p>`];
  out.push(`<div class="grid">${tiles.map(([k, v]) => `<div><b>${esc(v)}</b><small>${esc(k)}</small></div>`).join('')}</div>`);
  out.push(table('Воронка', funnel.map(([n, v, b]) => tr([esc(n), v.size, pct(v.size, b.size), bar(v.size, b.size)])).join(''), 'Процент — от предыдущего шага той же ветки (обучение, бот, онлайн).'));
  if (stepReach.size) {
    const mx = Math.max(...[...stepReach.values()].map((s) => s.n.size));
    out.push(table('Обучение по шагам', [...stepReach].sort((a, b) => a[0] - b[0]).map(([n, s]) => tr([`${n}. ${esc(s.id)}`, s.n.size, pct(s.n.size, tutS.size), bar(s.n.size, mx)])).join(''),
      skips.size ? `Пропустили обучение на шаге: ${[...skips].map(([k, v]) => `${esc(k)} — ${v}`).join(', ')}` : ''));
  }
  out.push(table('Возвраты', ret.map((r) => tr([`Вернулись на ${r.n}-й день`, `${r.back} из ${r.base}`, pct(r.back, r.base), bar(r.back, r.base)])).join(''), 'Ориентир для казуальной игры: 1-й день — от 25%, 7-й — от 10%.'));
  const mx = Math.max(0, ...daily.map((d) => d.dau));
  out.push(table('По дням', tr(['<small>день</small>', '<small>играли</small>', '<small>новые</small>', '<small>с ботом</small>', '<small>онлайн (рейт.)</small>', '']) +
    daily.map((d) => tr([d.d, d.dau, d.nw, d.bot, `${d.ol} (${d.rk})`, bar(d.dau, mx)])).join('')));
  out.push(wlTable('С ботом: сложность', wl(botGames, (p) => String(p.diff ?? '?')), DIFF_RU));
  out.push(wlTable('С ботом: сторона игрока', wl(botGames, (p) => String(p.side ?? '?'))));
  out.push(wlTable('С ботом: агент игрока', wl(botGames, (p) => String(p.agent ?? '?')), AGENT_RU));
  out.push(table('С ботом: чем заканчиваются', counter(botGames, (p) => String(p.reason ?? '?')).map(([k, v]) => tr([esc(REASON_RU[k] ?? k), v, pct(v, botGames.length)])).join(''),
    `Средняя длина: ${avg(botGames.map((x) => Number(x.p.turns) || 0))} ваших хода.`));
  if (olGames.length) {
    out.push(wlTable('Онлайн: агенты (победы игрока)', wl(olGames, (p) => String(p.agent ?? '?')), AGENT_RU));
    out.push(wlTable('Онлайн: сторона', wl(olGames, (p) => String(p.side ?? '?'))));
    out.push(table('Онлайн: чем заканчиваются', counter(olGames, (p) => String(p.reason ?? '?')).map(([k, v]) => tr([esc(REASON_RU[k] ?? k), v, pct(v, olGames.length)])).join(''),
      `Поиск соперника: медиана ${median(waits)} с, 90% — до ${waits.length ? waits[Math.floor(waits.length * 0.9)] : 0} с.`));
  }
  const social = [['Добавили в друзья', 'friend_add'], ['Вызвали на дуэль', 'invite_send'], ['Ответили на вызов', 'invite_answer'], ['Реванш', 'rematch'], ['Открыли «Подробнее» у карты', 'pv_more'], ['Открыли рейтинг', 'rating_open']];
  out.push(table('Кнопки и соцфункции', social.map(([n, e]) => tr([n, evs(e).length, `${usersWith(e).size} игроков`])).join('')));
  out.push(table('Платформы', counter(evs('app_open'), (p) => String(p.pf ?? '?')).map(([k, v]) => tr([esc(k), v])).join('')));
  const errs = counter(evs('js_error'), (p) => `${p.msg} · ${p.at}`).slice(0, 15);
  if (errs.length) out.push(table('Ошибки JS', errs.map(([k, v]) => tr([esc(k), v])).join('')));
  return out.join('');
}
