// Подключение к серверу онлайна: вход через Telegram, переподключение, очередь сообщений.
// Адрес сервера: константа SERVER ниже, или window.CLUTCH_SERVER, или ?server=wss://… в адресе (для проверки).
import type { C2S, S2C } from './protocol';

/** Адрес WebSocket сервера онлайна. Пусто — онлайн выключен (кнопка покажет, что сервер не настроен). */
export const SERVER = '';

declare global { interface Window { CLUTCH_SERVER?: string } }
interface TgInit { initData?: string; initDataUnsafe?: { start_param?: string; user?: { first_name?: string } } }
const tg = (): TgInit | undefined => (window as unknown as { Telegram?: { WebApp?: TgInit } }).Telegram?.WebApp;

export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  return q || window.CLUTCH_SERVER || SERVER;
}
/** Параметр запуска Mini App (t.me/<бот>/<app>?startapp=duel_ABC123) или ?duel=ABC123 в адресе. */
export function startDuelCode(): string | null {
  const sp = tg()?.initDataUnsafe?.start_param ?? '';
  const m = sp.match(/^duel_([A-Z0-9]{6})$/i);
  if (m) return m[1].toUpperCase();
  const q = new URLSearchParams(location.search).get('duel');
  return q && /^[A-Z0-9]{6}$/i.test(q) ? q.toUpperCase() : null;
}
/** Ссылка-приглашение на дуэль. BOT_APP — «имя_бота/короткое_имя_приложения» из @BotFather (/newapp). */
export const BOT_APP = '';
export function duelLink(code: string): string {
  const app = (window as unknown as { CLUTCH_BOT_APP?: string }).CLUTCH_BOT_APP || BOT_APP;
  if (app) return `https://t.me/${app}?startapp=duel_${code}`;
  const u = new URL(location.href); u.hash = ''; u.searchParams.set('duel', code);
  return u.toString();
}

/** Имя для входа без Telegram (только на сервере с ALLOW_DEV=1). */
function devName(): string {
  try {
    let n = localStorage.getItem('clutch_dev_id');
    if (!n) { n = 'p' + Math.random().toString(36).slice(2, 8); localStorage.setItem('clutch_dev_id', n); }
    return n;
  } catch { return 'p' + Math.random().toString(36).slice(2, 8); }
}

type Listener = (m: S2C) => void;
let ws: WebSocket | null = null;
let listener: Listener | null = null;
let statusCb: ((s: 'connecting' | 'online' | 'offline') => void) | null = null;
let wanted = false, tries = 0, retry: ReturnType<typeof setTimeout> | undefined;
let clockSkew = 0;   // серверное время − наше: таймеры показываем по часам сервера

export const onlineStatus = { state: 'offline' as 'connecting' | 'online' | 'offline' };
export const serverNow = () => Date.now() + clockSkew;

export function onMessage(cb: Listener) { listener = cb; }
export function onStatus(cb: typeof statusCb) { statusCb = cb; }
const setStatus = (s: typeof onlineStatus.state) => { onlineStatus.state = s; statusCb?.(s); };

export function connect() {
  const url = serverUrl();
  if (!url) return false;
  wanted = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return true;
  setStatus('connecting');
  try { ws = new WebSocket(url); } catch { schedule(); return true; }
  ws.onopen = () => {
    tries = 0;
    setStatus('online');
    const t = tg();
    send({ t: 'hello', initData: t?.initData || undefined, dev: devName(), name: t?.initDataUnsafe?.user?.first_name });
    sent = Date.now();
    send({ t: 'ping' });
  };
  let sent = Date.now();
  ws.onmessage = (ev) => {
    let m: S2C;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.t === 'pong') { clockSkew = m.now - Math.round((sent + Date.now()) / 2); return; }
    listener?.(m);
  };
  ws.onclose = () => { ws = null; setStatus('offline'); if (wanted) schedule(); };
  ws.onerror = () => { try { ws?.close(); } catch { /* уже */ } };
  return true;
}
function schedule() {
  clearTimeout(retry);
  const ms = Math.min(10_000, 800 * 2 ** tries++);
  retry = setTimeout(() => { if (wanted) connect(); }, ms);
}
export function disconnect() { wanted = false; clearTimeout(retry); try { ws?.close(); } catch { /* уже */ } ws = null; setStatus('offline'); }
export function send(m: C2S) { if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; } return false; }

/** Поделиться ссылкой через Telegram (или системным меню / буфером обмена вне Telegram). */
export async function shareLink(url: string, text: string): Promise<'tg' | 'share' | 'copy' | 'fail'> {
  const w = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?(u: string): void; initData?: string } } }).Telegram?.WebApp;
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (w?.openTelegramLink && w.initData) { try { w.openTelegramLink(share); return 'tg'; } catch { /* дальше */ } }
  if (navigator.share) { try { await navigator.share({ url, text }); return 'share'; } catch { /* отмена */ } }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'copy'; } catch { return 'fail'; }
}
