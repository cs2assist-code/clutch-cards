#!/usr/bin/env python3
"""Сборщик анонимной аналитики «Клатча». Только стандартная библиотека Python 3.9+.

Запуск:   CLUTCH_KEY=секрет python3 analytics_server.py --port 8787 --db clutch.sqlite
Приём:    POST /e        — пачка событий от игры (JSON, до 64 КБ)
Отчёт:    GET  /report?key=секрет  — страница с воронкой, возвратами и популярностью
Выгрузка: GET  /export.csv?key=секрет

Ставится за nginx на тот же домен, что и игра (пример — в README).
"""
import argparse, csv, html, io, json, os, sqlite3, threading, time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MAX_BODY = 64 * 1024
KEY = os.environ.get('CLUTCH_KEY', '')
TZ = timezone(timedelta(hours=3))  # Москва: дни считаются по московскому времени
lock = threading.Lock()
AGENT_RU = {'ct_swat': 'Командир SWAT', 'ct_seal': 'Снайпер SEAL', 'ct_fbi': 'Сапёр FBI', 'ct_sas': 'Штурмовик SAS', 'ct_gign': 'Жандарм GIGN',
            't_phoenix': 'Подрывник Phoenix', 't_elite': 'Штурмовик Elite Crew', 't_balkan': 'Поджигатель Balkan', 't_guerrilla': 'Партизан', 't_pro': 'Наёмник'}
REASON_RU = {'bomb': 'Взрыв бомбы', 'defuse': 'Разминирование', 'ninja': 'Ниндзя-дефьюз', 'kill': 'Герой повержен', 'time': 'Время вышло'}


def db_open(path):
    con = sqlite3.connect(path, check_same_thread=False)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('''CREATE TABLE IF NOT EXISTS events(
        uid TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL, ev TEXT NOT NULL, props TEXT, v TEXT)''')
    con.execute('CREATE INDEX IF NOT EXISTS ev_uid ON events(uid)')
    con.execute('CREATE INDEX IF NOT EXISTS ev_day ON events(day)')
    con.commit()
    return con


def day_of(ms):
    return datetime.fromtimestamp(ms / 1000, TZ).strftime('%Y-%m-%d')


def store(con, payload):
    uid = str(payload.get('uid', ''))[:40]
    v = str(payload.get('v', ''))[:8]
    evs = payload.get('events') or []
    if not uid or not isinstance(evs, list):
        return 0
    now = int(time.time() * 1000)
    rows = []
    for e in evs[:200]:
        if not isinstance(e, dict):
            continue
        ts = int(e.get('t') or now)
        if abs(ts - now) > 3 * 86400 * 1000:  # часы устройства сильно врут — берём время сервера
            ts = now
        name = str(e.get('e', ''))[:40]
        props = e.get('p') if isinstance(e.get('p'), dict) else None
        rows.append((uid, ts, day_of(ts), name, json.dumps(props, ensure_ascii=False)[:1000] if props else None, v))
    with lock:
        con.executemany('INSERT INTO events VALUES (?,?,?,?,?,?)', rows)
        con.commit()
    return len(rows)


# ───────────────────────────── Отчёт ─────────────────────────────
def pct(a, b):
    return f'{round(100 * a / b)}%' if b else '—'


def build_report(con, days=30):
    with lock:
        rows = con.execute('SELECT uid, day, ev, props FROM events').fetchall()
    first_day, active = {}, defaultdict(set)
    by_ev = defaultdict(list)
    for uid, day, ev, props in rows:
        if uid not in first_day or day < first_day[uid]:
            first_day[uid] = day
        active[uid].add(day)
        by_ev[ev].append((uid, json.loads(props) if props else {}))
    users = set(first_day)
    today = datetime.now(TZ).date()

    def users_with(ev, cond=lambda p: True):
        return {u for u, p in by_ev.get(ev, []) if cond(p)}

    # Воронка новичка
    opened = users_with('app_open')
    tut_start = users_with('tutorial_start')
    tut_end = users_with('tutorial_end')
    tut_win = users_with('round_end', lambda p: p.get('kind') == 'tutorial' and p.get('win'))
    m_start = users_with('match_start', lambda p: p.get('kind') == 'normal')
    m_end = users_with('match_end', lambda p: p.get('kind') == 'normal')
    r_end = users_with('round_end', lambda p: p.get('kind') == 'normal')
    funnel = [
        ('Открыли игру', len(opened), len(opened)),
        ('Начали обучение', len(tut_start), len(opened)),
        ('Прошли обучение до конца', len(tut_end), len(tut_start)),
        ('…и выиграли раунд обучения', len(tut_win), len(tut_start)),
        ('Начали обычный матч', len(m_start), len(opened)),
        ('Доиграли хотя бы раунд', len(r_end), len(m_start)),
        ('Доиграли матч до конца', len(m_end), len(m_start)),
    ]
    steps = Counter(p.get('n') for _, p in by_ev.get('tutorial_step', []))
    quits = Counter(p.get('step') for _, p in by_ev.get('tutorial_quit', []))

    # Возвраты по когортам: пришёл в день D, вернулся в день D+N
    def retention(n):
        base = [u for u in users if datetime.strptime(first_day[u], '%Y-%m-%d').date() + timedelta(days=n) <= today]
        back = [u for u in base if (datetime.strptime(first_day[u], '%Y-%m-%d').date() + timedelta(days=n)).isoformat() in active[u]]
        return len(back), len(base)
    ret = [(n, *retention(n)) for n in (1, 3, 7, 14, 30)]

    # По дням
    daily = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        dau = sum(1 for u in users if d in active[u])
        new = sum(1 for u in users if first_day[u] == d)
        daily.append((d, dau, new))

    # Матчи и раунды
    rounds = [p for _, p in by_ev.get('round_end', []) if p.get('kind') in ('normal', 'daily')]
    by_diff = defaultdict(lambda: [0, 0])
    by_side = defaultdict(lambda: [0, 0])
    by_agent = defaultdict(lambda: [0, 0])
    reasons = Counter()
    halves = []
    for p in rounds:
        w = 1 if p.get('win') else 0
        by_diff[p.get('diff', '?')][0] += 1; by_diff[p.get('diff', '?')][1] += w
        by_side[p.get('side', '?')][0] += 1; by_side[p.get('side', '?')][1] += w
        by_agent[p.get('ag', '?')][0] += 1; by_agent[p.get('ag', '?')][1] += w
        reasons[p.get('reason', '?')] += 1
        if isinstance(p.get('half'), int):
            halves.append(p['half'])
    daily_players = len(users_with('match_start', lambda p: p.get('kind') == 'daily'))
    daily_shares = len(users_with('daily_share'))
    ui = Counter(p.get('a') for _, p in by_ev.get('ui', []))
    idle = len(by_ev.get('idle_hint', []))
    platforms = Counter(p.get('pf', '?') for _, p in by_ev.get('app_open', []))

    return dict(users=len(users), events=len(rows), funnel=funnel, steps=steps, quits=quits, ret=ret, daily=daily,
                rounds=len(rounds), by_diff=by_diff, by_side=by_side, by_agent=by_agent, reasons=reasons,
                avg_half=(sum(halves) / len(halves)) if halves else 0, daily_players=daily_players,
                daily_shares=daily_shares, ui=ui, idle=idle, platforms=platforms)


def render_report(r):
    e = html.escape
    tr = lambda cells: '<tr>' + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>'
    bar = lambda v, m: f'<span class="bar"><i style="width:{0 if not m else round(100 * v / m)}%"></i></span>'
    out = [f'''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Клатч · аналитика</title><style>
body{{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#111418;color:#e6ebf1}}
h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:15px;margin:22px 0 8px;color:#f2c14e}} small,.m{{color:#8b95a3}}
table{{border-collapse:collapse;width:100%;max-width:760px}} td{{padding:5px 8px;border-bottom:1px solid #232933;vertical-align:middle}}
td:not(:first-child){{text-align:right;white-space:nowrap}} .bar{{display:inline-block;width:120px;height:8px;background:#232933;border-radius:4px;overflow:hidden;vertical-align:middle}}
.bar i{{display:block;height:100%;background:#8fcb44}} .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;max-width:760px}}
.grid div{{background:#1a1f26;border-radius:10px;padding:10px}} .grid b{{display:block;font-size:22px}}
</style><h1>Клатч · аналитика</h1><p class="m">Игроков: {r["users"]} · событий: {r["events"]} · обновлено {datetime.now(TZ):%d.%m %H:%M}</p>''']
    out.append('<div class="grid">' + ''.join(f'<div><b>{v}</b><small>{e(k)}</small></div>' for k, v in [
        ('раундов сыграно', r['rounds']), ('средний раунд, общих ходов', f'{r["avg_half"]:.1f}'),
        ('играли вызов дня', r['daily_players']), ('поделились вызовом', r['daily_shares']),
        ('подсказок при бездействии', r['idle'])]) + '</div>')
    out.append('<h2>Воронка новичка</h2><table>')
    for name, v, base in r['funnel']:
        out.append(tr([e(name), v, pct(v, base), bar(v, base)]))
    out.append('</table><p class="m">Процент — от предыдущего шага, для «Начали …» — от открывших игру.</p>')
    if r['steps']:
        mx = max(r['steps'].values())
        out.append('<h2>Обучение по шагам</h2><table>' + ''.join(
            tr([f'Дошли до шага {n}', c, '', bar(c, mx)]) for n, c in sorted(r['steps'].items(), key=lambda x: x[0] or 0)) + '</table>')
    if r['quits']:
        out.append('<p class="m">Вышли из обучения на шаге: ' + ', '.join(f'{k} — {v}' for k, v in sorted(r['quits'].items(), key=lambda x: x[0] or 0)) + '</p>')
    out.append('<h2>Возвраты</h2><table>' + ''.join(
        tr([f'Вернулись на {n}-й день', f'{b} из {base}', pct(b, base), bar(b, base)]) for n, b, base in r['ret']) + '</table>')
    out.append('<p class="m">Ориентир для казуальной игры: 1-й день — от 25%, 7-й — от 10%.</p>')
    mx = max((d[1] for d in r['daily']), default=0)
    out.append('<h2>По дням</h2><table><tr><td><small>день</small></td><td><small>играли</small></td><td><small>новые</small></td><td></td></tr>' +
               ''.join(tr([d, a, n, bar(a, mx)]) for d, a, n in reversed(r['daily']) if a or n) + '</table>')
    def wl(title, data, names=None):
        rows = sorted(data.items(), key=lambda x: -x[1][0])
        return f'<h2>{title}</h2><table>' + ''.join(tr([e((names or {}).get(k, k)), f'{v[0]} раундов', f'побед {pct(v[1], v[0])}']) for k, v in rows) + '</table>'
    out.append(wl('Сложность бота', r['by_diff'], {'easy': 'Новичок', 'normal': 'Обычный', 'hard': 'Сложный'}))
    out.append(wl('Сторона игрока', r['by_side']))
    out.append(wl('Агенты игроков', r['by_agent'], AGENT_RU))
    out.append('<h2>Чем заканчиваются раунды</h2><table>' + ''.join(tr([e(REASON_RU.get(k, k)), v, pct(v, r['rounds'])]) for k, v in r['reasons'].most_common()) + '</table>')
    out.append('<h2>Удобства</h2><table>' + ''.join(tr([e({'fireall': 'Огонь всеми', 'skipbot': 'Пропустить ход бота', 'quickbuy': 'Быстрая покупка'}.get(k, k)), v]) for k, v in r['ui'].most_common()) + '</table>')
    out.append('<h2>Платформы</h2><table>' + ''.join(tr([e(k), v]) for k, v in r['platforms'].most_common()) + '</table>')
    return ''.join(out)


class Handler(BaseHTTPRequestHandler):
    server_version = 'clutch-stats'

    def _send(self, code, body=b'', ctype='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_POST(self):
        if urlparse(self.path).path.rstrip('/').split('/')[-1] != 'e':
            return self._send(404)
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413)
        try:
            stored = store(self.server.db, json.loads(self.rfile.read(n)))
        except (ValueError, TypeError):
            return self._send(400)
        self._send(200, str(stored).encode())

    def _authed(self, q):
        return KEY and q.get('key', [''])[0] == KEY

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        last = u.path.rstrip('/').split('/')[-1]
        if last == 'health':
            return self._send(200, b'ok')
        if last == 'report':
            if not self._authed(q):
                return self._send(403, 'Нужен ?key= (переменная CLUTCH_KEY)'.encode())
            return self._send(200, render_report(build_report(self.server.db)).encode(), 'text/html; charset=utf-8')
        if last == 'export.csv':
            if not self._authed(q):
                return self._send(403)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(['uid', 'ts', 'day', 'event', 'props', 'v'])
            with lock:
                w.writerows(self.server.db.execute('SELECT * FROM events ORDER BY ts'))
            return self._send(200, buf.getvalue().encode('utf-8-sig'), 'text/csv; charset=utf-8')
        self._send(404)

    def log_message(self, *a):  # без логов каждого запроса
        pass


def main():
    ap = argparse.ArgumentParser(description='Сборщик аналитики Клатча')
    ap.add_argument('--port', type=int, default=8787)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--db', default='clutch.sqlite')
    a = ap.parse_args()
    if not KEY:
        print('Внимание: CLUTCH_KEY не задан — отчёт будет недоступен.')
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.db = db_open(a.db)
    print(f'Сборщик слушает http://{a.host}:{a.port}  (POST /e, GET /report?key=…)')
    srv.serve_forever()


if __name__ == '__main__':
    main()
