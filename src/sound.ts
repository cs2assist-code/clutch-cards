// Звуки синтезируются Web Audio на лету; выстрелы — настоящие файлы из CS2 (см. weaponShot ниже). Выключатель хранится в localStorage.
let ctx: AudioContext | null = null;
let on = (() => { try { return localStorage.getItem('clutch_sound') !== '0'; } catch { return true; } })();
export const soundOn = () => on;
export function toggleSound() {
  on = !on;
  try { localStorage.setItem('clutch_sound', on ? '1' : '0'); } catch { /* без хранилища */ }
  if (on) unlock();
  return on;
}
/** Браузеры разрешают звук только после касания — вызываем на первый pointerdown. */
export function unlock() {
  if (!on) return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}
const ready = () => (on && ctx && ctx.state === 'running' ? ctx : null);
/** Контекст Web Audio, если звук включён и разблокирован. */
export const ctxReady = ready;

/** Щелчок рации с коротким шипением (начало/конец передачи). */
export function radioClick(end = false) {
  const c = ready(); if (!c) return;
  const n = noise(c, end ? 0.07 : 0.11);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
  n.connect(f).connect(env(c, end ? 0.05 : 0.08, 0.003, end ? 0.06 : 0.1)); n.start();
  tone(c, end ? 1100 : 1500, 0.035, 'square', 0.04);
}

function noise(c: AudioContext, dur: number) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
function env(c: AudioContext, peak: number, attack: number, decay: number, t = c.currentTime) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(c.destination);
  return g;
}
function tone(c: AudioContext, freq: number, dur: number, type: OscillatorType, peak: number, at = 0) {
  const t = c.currentTime + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  o.connect(env(c, peak, 0.005, dur, t)); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  shot(kind: 'bullet' | 'sniper' | 'knife' = 'bullet') {
    const c = ready(); if (!c) return;
    if (kind === 'knife') { const n = noise(c, 0.12); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000; n.connect(f).connect(env(c, 0.25, 0.005, 0.1)); n.start(); return; }
    const n = noise(c, kind === 'sniper' ? 0.4 : 0.14);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'sniper' ? 1400 : 2600;
    n.connect(f).connect(env(c, kind === 'sniper' ? 0.6 : 0.35, 0.002, kind === 'sniper' ? 0.38 : 0.12)); n.start();
    tone(c, kind === 'sniper' ? 70 : 120, 0.12, 'sine', 0.3);
  },
  boom(big = false) {
    const c = ready(); if (!c) return;
    const n = noise(c, big ? 1.6 : 0.7);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = big ? 500 : 900;
    n.connect(f).connect(env(c, big ? 0.9 : 0.5, 0.01, big ? 1.5 : 0.6)); n.start();
    tone(c, 50, big ? 1 : 0.4, 'sine', 0.5);
  },
  beep() { const c = ready(); if (!c) return; tone(c, 1900, 0.08, 'square', 0.08); tone(c, 1900, 0.08, 'square', 0.08, 0.18); },
  buy() { const c = ready(); if (!c) return; tone(c, 880, 0.05, 'triangle', 0.12); tone(c, 1320, 0.07, 'triangle', 0.1, 0.05); },
  click() { const c = ready(); if (!c) return; tone(c, 600, 0.03, 'triangle', 0.05); },
  turn() { const c = ready(); if (!c) return; tone(c, 520, 0.12, 'sine', 0.12); tone(c, 780, 0.18, 'sine', 0.12, 0.1); },
  win() { const c = ready(); if (!c) return; [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.22, 'triangle', 0.16, i * 0.11)); },
  lose() { const c = ready(); if (!c) return; [392, 330, 262].forEach((f, i) => tone(c, f, 0.3, 'sawtooth', 0.07, i * 0.16)); },
  /** Писк таймера C4 (fast — ближе к взрыву). */
  tick(fast = false) { const c = ready(); if (!c) return; tone(c, fast ? 2200 : 1950, 0.06, 'square', 0.07); },
  /** Свист брошенной гранаты. */
  whoosh() {
    const c = ready(); if (!c) return;
    const n = noise(c, 0.35); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(600, c.currentTime); f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.3);
    n.connect(f).connect(env(c, 0.12, 0.05, 0.28)); n.start();
  },
  /** Флешка: хлопок и звон в ушах. */
  flashbang() {
    const c = ready(); if (!c) return;
    const n = noise(c, 0.2); n.connect(env(c, 0.45, 0.002, 0.18)); n.start();
    tone(c, 3800, 1.4, 'sine', 0.05, 0.05);
  },
  /** Дым: шипение. */
  hiss() {
    const c = ready(); if (!c) return;
    const n = noise(c, 1.2); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    n.connect(f).connect(env(c, 0.1, 0.15, 1)); n.start();
  },
  /** Молотов: звон стекла и вспыхнувшее пламя. */
  fire() {
    const c = ready(); if (!c) return;
    tone(c, 2600, 0.08, 'triangle', 0.08); tone(c, 3300, 0.1, 'triangle', 0.06, 0.03);
    const n = noise(c, 0.9); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    n.connect(f).connect(env(c, 0.3, 0.08, 0.8)); n.start();
  },
  deny() { const c = ready(); if (!c) return; tone(c, 160, 0.12, 'square', 0.06); },
};

// ─────────────────────────── Настоящие выстрелы и бомба из CS2 ───────────────────────────
// Файлы public/snd/shot/<ключ>.mp3 (варианты <ключ>_2.mp3 …), список — public/snd/shot/index.json
// (собирается scripts/vo-index.mjs). Нет файла — играет синтезированный sfx.shot().

/** Карта бойца → ключ звука. Оружие звучит само собой, фирменные бойцы и токены — оружием своего класса. */
const SHOT_ALIAS: Record<string, string> = {
  sw_shield: 'm4a4', se_spotter: 'p2000', fb_sapper: 'mp5sd', sa_oper: 'm4a1s', gi_gend: 'bizon',
  ph_bomber: 'tec9', el_storm: 'ak47', ba_gunner: 'negev', gu_ambush: 'mac10', pr_vet: 'galil',
  merc: 'glock', mate_ct: 'p2000', mate_t: 'glock',
};
declare global { interface Window { __SHOT?: Record<string, string> } }
let shotFiles: string[] | null = null;
let shotListing: Promise<void> | null = null;
function loadShots() {
  if (shotFiles || shotListing) return shotListing;
  if (window.__SHOT) { shotFiles = Object.keys(window.__SHOT); return null; }
  shotListing = fetch('snd/shot/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
    .then((l: string[]) => { shotFiles = Array.isArray(l) ? l : []; });
  return shotListing;
}
const shotBufs = new Map<string, Promise<AudioBuffer | null>>();
function shotBuffer(c: AudioContext, f: string) {
  let b = shotBufs.get(f);
  if (!b) {
    b = fetch(window.__SHOT?.[f] ?? `snd/shot/${f}`).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a)).catch(() => null);
    shotBufs.set(f, b);
  }
  return b;
}
const shotVariants = (key: string) => (shotFiles ?? []).filter((f) => new RegExp(`^${key}(_\\d+)?\\.(mp3|ogg|wav)$`).test(f));

/** Сыграть файл-сэмпл по ключу (случайный вариант); нет файла — fallback (синтез). */
function playSample(key: string, gain: number, fallback?: () => void, jitter = 0) {
  const c = ready(); if (!c) return;
  // список ещё грузится (первый звук в игре) — дождаться его, а не играть синтезированный
  if (!shotFiles) { void Promise.resolve(loadShots()).then(() => playSample(key, gain, fallback, jitter)); return; }
  const list = shotVariants(key);
  if (!list.length) { fallback?.(); return; }
  const f = list[Math.floor(Math.random() * list.length)];
  void shotBuffer(c, f).then((b) => {
    if (!b) { fallback?.(); return; }
    const s = c.createBufferSource(); s.buffer = b;
    if (jitter) s.playbackRate.value = 1 - jitter / 2 + Math.random() * jitter;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(g).connect(c.destination); s.start();
  });
}

/**
 * Выстрел конкретного оружия. card — id карты бойца ('ak47', 'sa_oper'…) или 'knife' / 'zeus';
 * unsilenced — USP-S / M4A1-S в режиме «без глушителя».
 */
export function weaponShot(card: string, fallback: 'bullet' | 'sniper' | 'knife' = 'bullet', unsilenced = false) {
  let key = SHOT_ALIAS[card] ?? card;
  if (unsilenced && (key === 'usp' || key === 'm4a1s')) key += '_us';
  playSample(key, 0.55, () => sfx.shot(fallback), 0.06);   // чуть разные выстрелы подряд
}

/** Произвольный сэмпл из public/snd/shot (диктор вето и т.п.). */
export function sample(key: string, gain = 0.7) { playSample(key, gain); }

/** Бомба C4 — звуки из CS2 (sounds/weapons/c4), без файлов — прежний синтез. */
export const c4 = {
  /** Набор кода на клавиатуре C4 во время закладки. */
  key() { playSample('c4_key', 0.5, () => sfx.tick(), 0.04); },
  /** Бомба заложена: щелчок установки и взвод. */
  plant() { playSample('c4_plant', 0.6, () => sfx.beep()); setTimeout(() => playSample('c4_arm', 0.45), 350); },
  /** Писк таймера (fast — ближе к взрыву). */
  beep(fast = false) { playSample(fast ? 'c4_beep_fast' : 'c4_beep', 0.4, () => sfx.tick(fast)); },
  /** Начало разминирования (щелчки кусачек). */
  defuseStart() { playSample('c4_defuse_start', 0.6); },
  /** Бомба обезврежена. */
  defused() { playSample('c4_defuse', 0.6, () => sfx.beep()); },
  /** Взрыв C4. */
  boom() { playSample('c4_boom', 0.8, () => sfx.boom(true)); },
};

/** Заранее декодировать выстрелы и звуки бомбы (после первого касания), чтобы первый звук не запаздывал. */
export function preloadShots() {
  void Promise.resolve(loadShots()).then(() => {
    const c = ready();
    if (c && shotFiles) shotFiles.forEach((f) => void shotBuffer(c, f));
  });
}
