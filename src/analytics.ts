// Анонимная аналитика: какие шаги проходят игроки, без имён и Telegram-ID.
// События копятся в очереди и раз в 15 секунд (и при сворачивании) уходят пачкой на ENDPOINT.
// Собирает сам сервер онлайна (POST /e, отчёт — GET /stats?key=…), поэтому адрес по умолчанию берётся из адреса онлайна:
// wss://host/clutch-ws → https://host/clutch-ws/e (та же location в nginx). Нет сервера онлайна и не задан window.CLUTCH_ANALYTICS — аналитика выключена.
import { serverUrl } from './online/client';

/** Адрес сборщика. Можно задать явно через window.CLUTCH_ANALYTICS. */
const ENDPOINT: string = (globalThis as { CLUTCH_ANALYTICS?: string }).CLUTCH_ANALYTICS
  ?? (() => { const ws = serverUrl(); return ws ? ws.replace(/^ws/, 'http').replace(/\/$/, '') + '/e' : ''; })();
const VERSION = '1';

interface Ev { t: number; e: string; p?: Record<string, string | number | boolean> }

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let optedOut = ls.get('clutch_noanalytics') === '1';
export const analyticsOn = () => !optedOut;
export function toggleAnalytics() {
  optedOut = !optedOut;
  ls.set('clutch_noanalytics', optedOut ? '1' : '0');
  if (optedOut) queue.length = 0;
  return !optedOut;
}

/** Случайный анонимный номер устройства — не связан с аккаунтом Telegram. */
const uid = (() => {
  let id = ls.get('clutch_uid');
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 20);
    ls.set('clutch_uid', id);
  }
  return id;
})();

const queue: Ev[] = [];

export function track(e: string, p?: Ev['p']) {
  if (!ENDPOINT || optedOut) return;
  queue.push({ t: Date.now(), e, p });
  if (queue.length >= 40) flush();
}

function flush() {
  if (!ENDPOINT || optedOut || !queue.length) return;
  const body = JSON.stringify({ uid, v: VERSION, events: queue.splice(0, 100) });
  try {
    const ok = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    if (!ok) void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* сеть недоступна — событие не критично */ }
}

setInterval(flush, 15000);
// Ошибки скриптов — чтобы видеть, что ломается у игроков (только текст ошибки, без данных игрока)
let errCount = 0;
addEventListener('error', (e) => { if (errCount++ < 5) track('js_error', { msg: String(e.message).slice(0, 140), at: `${String(e.filename).split('/').pop()}:${e.lineno}` }); });
addEventListener('unhandledrejection', (e) => { if (errCount++ < 5) track('js_error', { msg: String((e.reason as Error)?.message ?? e.reason).slice(0, 140), at: 'promise' }); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);
