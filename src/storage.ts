// Хранилище данных игрока. В Telegram — CloudStorage (синхронизируется между устройствами),
// вне Telegram — localStorage, если он недоступен — память страницы.

interface CloudStorage {
  setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
  getItem(key: string, cb: (err: unknown, value?: string) => void): void;
}
const cloud = (): CloudStorage | undefined => {
  const w = (window as unknown as { Telegram?: { WebApp?: { CloudStorage?: CloudStorage; isVersionAtLeast?(v: string): boolean } } }).Telegram?.WebApp;
  if (!w?.CloudStorage || !(w.isVersionAtLeast?.('6.9') ?? false)) return undefined;
  return w.CloudStorage;
};

const memory: Record<string, string> = {};

function readRaw(key: string): Promise<string | null> {
  const c = cloud();
  if (c) return new Promise((res) => { try { c.getItem(key, (err, v) => res(err ? null : v || null)); } catch { res(null); } });
  try { const v = localStorage.getItem(key); if (v !== null) return Promise.resolve(v); } catch { /* нет доступа */ }
  return Promise.resolve(memory[key] ?? null);
}
function writeRaw(key: string, value: string) {
  memory[key] = value;
  const c = cloud();
  if (c) { try { c.setItem(key, value); } catch { /* старый клиент */ } return; }
  try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
}

/** Произвольные данные в том же хранилище (статистика, настройки). */
export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await readRaw(key);
  if (!raw) return fallback;
  try { return { ...fallback, ...(JSON.parse(raw) as T) }; } catch { return fallback; }
}
export function saveJSON(key: string, value: unknown) { writeRaw(key, JSON.stringify(value)); }
