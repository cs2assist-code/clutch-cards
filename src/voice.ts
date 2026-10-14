// Радиокоманды как в CS. Голос берётся из файлов public/snd/vo (оригинальные фразы из CS2,
// которые владелец проекта извлекает сам). Если файла нет — щелчок рации и подпись на экране.
//
// Как добавить фразу: положите файл в public/snd/vo/<ключ>.mp3 (варианты: <ключ>2.mp3, <ключ>3.mp3)
// или под голос конкретного агента: public/snd/vo/<agentId>/<ключ>.mp3, затем выполните
// `node scripts/vo-index.mjs` (сборка делает это сама) — он перечислит файлы в index.json.
import { ctxReady, radioClick, soundOn } from './sound';

export type VoKey =
  | 'go' | 'fireinhole' | 'flash' | 'smoke' | 'molotov' | 'enemydown' | 'enemyspotted'
  | 'bombpl' | 'bombdef' | 'ctwin' | 'terwin' | 'needbackup' | 'takingfire' | 'niceshot' | 'clutch';

/** Подпись фразы (как радио-чат CS) и приоритет: важные фразы перебивают мелкие. */
export const VO: Record<VoKey, { ru: string; en: string; pri: number }> = {
  go:           { ru: 'Вперёд!',             en: "Let's go!",               pri: 2 },
  fireinhole:   { ru: 'Граната!',            en: 'Fire in the hole!',       pri: 2 },
  flash:        { ru: 'Флешка!',             en: 'Flashbang out!',          pri: 2 },
  smoke:        { ru: 'Дым пошёл!',          en: 'Smoke out!',              pri: 2 },
  molotov:      { ru: 'Молотов!',            en: 'Molotov out!',            pri: 2 },
  enemydown:    { ru: 'Противник убит',      en: 'Enemy down',              pri: 1 },
  enemyspotted: { ru: 'Противник замечен',   en: 'Enemy spotted',           pri: 0 },
  bombpl:       { ru: 'Бомба заложена',      en: 'Bomb has been planted',   pri: 4 },
  bombdef:      { ru: 'Бомба обезврежена',   en: 'Bomb has been defused',   pri: 4 },
  ctwin:        { ru: 'Спецназ победил',     en: 'Counter-Terrorists win',  pri: 5 },
  terwin:       { ru: 'Террористы победили', en: 'Terrorists win',          pri: 5 },
  needbackup:   { ru: 'Нужна помощь!',       en: 'Need backup!',            pri: 1 },
  takingfire:   { ru: 'Под огнём!',          en: 'Taking fire, need assistance!', pri: 1 },
  niceshot:     { ru: 'Отличный выстрел!',   en: 'Nice shot!',              pri: 1 },
  clutch:       { ru: 'Один остался — держусь', en: 'I got this',           pri: 3 },
};

declare global { interface Window { __VO?: Record<string, string> } }

let voiceOn = (() => { try { return localStorage.getItem('clutch_voice') !== '0'; } catch { return true; } })();
export const voiceEnabled = () => voiceOn;
export function toggleVoice() {
  voiceOn = !voiceOn;
  try { localStorage.setItem('clutch_voice', voiceOn ? '1' : '0'); } catch { /* без хранилища */ }
  return voiceOn;
}

// ── Список файлов ──
let files: string[] | null = null;          // пути относительно snd/vo, например "bombpl.mp3", "ct_swat/go.mp3"
let listing: Promise<void> | null = null;
function loadList() {
  if (files || listing) return listing;
  if (window.__VO) { files = Object.keys(window.__VO); return null; }
  listing = fetch('snd/vo/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []).then((l: string[]) => { files = Array.isArray(l) ? l : []; });
  return listing;
}
const stem = (f: string) => f.replace(/\.(mp3|wav|ogg)$/i, '');
function variants(key: VoKey, agent?: string): string[] {
  if (!files) return [];
  const re = (pre: string) => new RegExp(`^${pre}${key}\\d*$`);
  const own = agent ? files.filter((f) => re(`${agent}/`).test(stem(f))) : [];
  return own.length ? own : files.filter((f) => re('').test(stem(f)));
}

// ── Декодирование и проигрывание ──
const buffers = new Map<string, Promise<AudioBuffer | null>>();
function buffer(ctx: AudioContext, f: string) {
  let b = buffers.get(f);
  if (!b) {
    const src = window.__VO?.[f] ?? `snd/vo/${f}`;
    b = fetch(src).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a)).catch(() => null);
    buffers.set(f, b);
  }
  return b;
}

let busyUntil = 0, busyPri = -1, current: AudioBufferSourceNode | null = null;
let onSubtitle: ((who: string, text: string, side: 'T' | 'CT', mine: boolean) => void) | null = null;
/** Куда выводить подпись (радио-чат на столе). */
export function setSubtitle(f: typeof onSubtitle) { onSubtitle = f; }

/**
 * Сказать фразу по рации. who — имя говорящего (агент), side — его сторона, mine — свой ли это игрок.
 * Мелкие фразы не перебивают важные и пропускаются, если рация занята.
 */
export function say(key: VoKey, who: string, side: 'T' | 'CT', mine: boolean, agent?: string) {
  const v = VO[key];
  const now = performance.now();
  if (now < busyUntil && v.pri <= busyPri) return;
  onSubtitle?.(who, v.ru, side, mine);
  void loadList();
  if (!voiceOn || !soundOn()) { busyUntil = now + 900; busyPri = v.pri; return; }
  const ctx = ctxReady();
  if (!ctx) return;
  const list = variants(key, agent);
  if (!list.length) { radioClick(); busyUntil = now + 900; busyPri = v.pri; return; }
  const f = list[Math.floor(Math.random() * list.length)];
  busyUntil = now + 2500; busyPri = v.pri;
  radioClick();
  void buffer(ctx, f).then((b) => {
    if (!b) return;
    try { current?.stop(); } catch { /* уже закончилась */ }
    const s = ctx.createBufferSource(); s.buffer = b;
    const g = ctx.createGain(); g.gain.value = 0.9;
    s.connect(g).connect(ctx.destination);
    s.start(ctx.currentTime + 0.06);
    current = s;
    busyUntil = performance.now() + b.duration * 1000 + 150;
    s.onended = () => { if (current === s) current = null; radioClick(true); };
  });
}

/** Заранее подгрузить список и декодировать файлы (после первого касания). */
export function preloadVoice() {
  void Promise.resolve(loadList()).then(() => {
    const ctx = ctxReady();
    if (ctx && files) files.slice(0, 40).forEach((f) => void buffer(ctx, f));
  });
}
