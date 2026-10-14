// Анонимная аналитика: какие шаги проходят игроки, без имён и Telegram-ID.
// События копятся в очереди и раз в 15 секунд (и при сворачивании) уходят пачкой на ENDPOINT.
// Пустой ENDPOINT — аналитика выключена. Сервер-сборщик: scripts/analytics_server.py.

/** Адрес сборщика. Например: 'https://cs2assist.ru/clutch-stats/e'. Можно задать и через window.CLUTCH_ANALYTICS. */
const ENDPOINT: string = (globalThis as { CLUTCH_ANALYTICS?: string }).CLUTCH_ANALYTICS ?? '';
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
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);
