// Фоновая музыка: в меню — тема меню, в партии — фон карты (public/snd/music/map_<карта>.mp3).
// Файлы достаёт из установленной CS2 scripts/cs2-music-extract.py. Нет файлов — тишина, без ошибок.
// Переход между треками — плавный, в бою музыка тише, чтобы не мешать выстрелам и рации.
import { soundOn } from './sound';

declare global { interface Window { __MUSIC?: Record<string, string> } }

const VOL_MENU = 0.32, VOL_GAME = 0.16;
let enabled = (() => { try { return localStorage.getItem('clutch_music') !== '0'; } catch { return true; } })();
export const musicEnabled = () => enabled;
export function toggleMusic() {
  enabled = !enabled;
  try { localStorage.setItem('clutch_music', enabled ? '1' : '0'); } catch { /* без хранилища */ }
  apply();
  return enabled;
}

let available: Set<string> | null = null;   // какие треки есть (index.json или встроенные в однофайловую сборку)
let loading = false;
function loadIndex() {
  if (available || loading) return;
  if (window.__MUSIC) { available = new Set(Object.keys(window.__MUSIC)); return; }
  loading = true;
  fetch('snd/music/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
    .then((list: { name: string }[]) => { available = new Set((Array.isArray(list) ? list : []).map((x) => x.name)); loading = false; apply(); });
}

let want: { track: string; game: boolean } = { track: 'menu', game: false };
let cur: { name: string; el: HTMLAudioElement } | null = null;
let unlocked = false;

const srcOf = (name: string) => window.__MUSIC?.[name] ?? `snd/music/${name}.mp3`;
function fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = el.volume, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

function apply() {
  loadIndex();
  const on = enabled && soundOn() && unlocked && !document.hidden;
  // нужного трека нет — играет тема меню, если есть и она
  let name = want.track;
  if (available && !available.has(name)) name = available.has('menu') ? 'menu' : '';
  if (!on || !available || !name) {
    if (cur) { const old = cur; cur = null; fade(old.el, 0, 600, () => old.el.pause()); }
    return;
  }
  const vol = want.game ? VOL_GAME : VOL_MENU;
  if (cur?.name === name) { fade(cur.el, vol, 500); if (cur.el.paused) void cur.el.play().catch(() => {}); return; }
  if (cur) { const old = cur; fade(old.el, 0, 900, () => old.el.pause()); }
  const el = new Audio(srcOf(name));
  el.loop = true; el.volume = 0; el.preload = 'auto';
  cur = { name, el };
  void el.play().then(() => fade(el, vol, 1400)).catch(() => {});
}

/** Какой трек сейчас нужен: 'menu' или 'map_<карта>'; game — идёт партия (тише). */
export function setMusic(track: string, game: boolean) {
  if (want.track === track && want.game === game && (cur || !unlocked)) return;
  want = { track, game };
  apply();
}
/** Браузеры запускают звук только после нажатия — вызывать на первом касании. */
export function unlockMusic() {
  if (unlocked) return;
  unlocked = true;
  apply();
}
document.addEventListener('visibilitychange', () => apply());
/** Перепроверить (например, после выключения звуков). */
export const refreshMusic = () => apply();
