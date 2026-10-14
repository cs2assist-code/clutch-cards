// Боевые эффекты поверх стола: трассеры, всплески урона, гибель карт, баннеры.
// Слой живёт вне #app, поэтому перерисовка интерфейса его не стирает.

export interface Snap { rect: DOMRect; html: string; cls: string }
export type Snapshot = Map<string, Snap>;

const layer = (() => {
  const el = document.createElement('div');
  el.id = 'fx';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
})();

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let speed = 1;
export function setFxSpeed(s: number) { speed = s; }
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * speed));

function put(cls: string, x: number, y: number, html = '', life = 900): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = html;
  layer.appendChild(el);
  setTimeout(() => el.remove(), life * Math.max(speed, 0.2) + 50);
  return el;
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Положение и разметка всех персонажей стола до хода. */
export function snapshot(root: HTMLElement): Snapshot {
  const m: Snapshot = new Map();
  root.querySelectorAll<HTMLElement>('.unit[data-id], .hero[data-id]').forEach((el) => {
    m.set(el.dataset.id!, { rect: el.getBoundingClientRect(), html: el.innerHTML, cls: el.className });
  });
  return m;
}

export function rectOf(root: HTMLElement, id: string, snap?: Snapshot): DOMRect | null {
  const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (el) return el.getBoundingClientRect();
  return snap?.get(id)?.rect ?? null;
}

/** Выстрел: вспышка у стрелка, трассер, искры у цели. */
export function shot(from: DOMRect, to: DOMRect, kind: 'bullet' | 'sniper' | 'knife' = 'bullet') {
  if (reduced()) return;
  const a = center(from), b = center(to);
  if (kind === 'knife') {
    put('fx-slash', b.x, b.y, '', 500);
    return;
  }
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  put('fx-muzzle', a.x, a.y, '', 300);
  const tr = put(`fx-tracer ${kind}`, a.x, a.y, '', 420);
  tr.style.width = `${len}px`;
  tr.style.transform = `rotate(${ang}deg)`;
  setTimeout(() => put('fx-impact', b.x, b.y, '<i></i><i></i><i></i><i></i><i></i>', 500), 90 * speed);
}

/** Взрыв гранаты/огня по точке. */
export function burst(at: DOMRect, kind: 'he' | 'fire' | 'zap') {
  if (reduced()) return;
  const c = center(at);
  put(`fx-burst ${kind}`, c.x, c.y, '', 700);
}

/** Всплеск урона или лечения в стиле HS. */
export function splash(at: DOMRect, text: string, kind: 'damage' | 'heal' | 'block' | 'miss') {
  const c = center(at);
  put(`fx-splash ${kind}`, c.x, c.y, `<b>${text}</b>`, 1100);
}

/** Краткий красный «удар» по живой карте. */
export function hitFlash(el: Element | null) {
  if (!el) return;
  el.classList.remove('hit');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('hit');
}

/** Гибель: призрак карты трескается, сереет и осыпается. */
export function death(s: Snap) {
  const g = put(`fx-ghost ${s.cls.replace(/\b(enter|tgt|ready|picked|hit)\b/g, '')}`, s.rect.left, s.rect.top, s.html + '<span class="crack"></span>', 950);
  g.style.width = `${s.rect.width}px`;
  g.style.height = `${s.rect.height}px`;
}

/** Деньги: монетка взлетает от кошелька. */
export function cash(at: DOMRect, text: string) {
  put('fx-cash', Math.min(Math.max(at.left + at.width / 2, 90), window.innerWidth - 90), at.top, `<b>${text}</b>`, 1300);
}

/** Баннер посреди экрана: «Ваш ход», «Бомба заложена». */
export function banner(text: string, kind: 'turn' | 'bomb' | 'defuse' | 'info' = 'turn', ms = 1200) {
  layer.querySelectorAll('.fx-banner').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = `fx-banner ${kind}`;
  el.innerHTML = `<span><b>${text}</b></span>`;
  el.style.setProperty('--life', `${ms}ms`);
  layer.appendChild(el);
  setTimeout(() => el.remove(), ms + 100);
}

/** Встряска всего стола (взрыв бомбы). */
export function quake(el: Element | null) {
  if (!el || reduced()) return;
  el.classList.remove('quake');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('quake');
  put('fx-flash', 0, 0, '', 700);
}

/** Убрать все эффекты (при уходе со стола). */
export function clear() { layer.replaceChildren(); }

/** Убрать баннер (например, когда открыли бай-меню). */
export function clearBanner() { layer.querySelectorAll('.fx-banner').forEach((b) => b.remove()); }

/** Выпад атакующей карты к цели и обратно (как в Hearthstone). */
export function lunge(el: HTMLElement | null, to: DOMRect | null) {
  if (!el || !to || reduced()) return;
  const a = el.getBoundingClientRect();
  const dx = (to.left + to.width / 2 - (a.left + a.width / 2)) * 0.28;
  const dy = (to.top + to.height / 2 - (a.top + a.height / 2)) * 0.28;
  el.animate([
    { transform: 'translate(0,0) scale(1)', zIndex: 8 },
    { transform: `translate(${dx * -0.15}px, ${dy * -0.15}px) scale(1.06)`, offset: 0.25, zIndex: 8 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.1)`, offset: 0.55, zIndex: 8 },
    { transform: 'translate(0,0) scale(1)', zIndex: 8 },
  ], { duration: 360 * Math.max(speed, 0.2), easing: 'cubic-bezier(.3,.7,.3,1)' });
}

/** Купленная карта прилетает из точки from (кнопка «Купить» или герой бота). */
export function flyIn(el: HTMLElement | null, from: DOMRect | null) {
  if (!el || !from || reduced()) return;
  const a = el.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (a.left + a.width / 2);
  const dy = from.top + from.height / 2 - (a.top + a.height / 2);
  el.style.animation = 'none';
  el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(-8deg)`, opacity: 0.2 },
    { transform: 'translate(0,-10px) scale(1.12) rotate(2deg)', opacity: 1, offset: 0.7 },
    { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
  ], { duration: 520 * Math.max(speed, 0.2), easing: 'cubic-bezier(.2,.8,.3,1)' });
  put('fx-land', a.left + a.width / 2, a.bottom - 6, '', 600);
}

// ─────────────────────────── Гранаты ───────────────────────────
export type Nade = 'he' | 'flash' | 'smoke' | 'molotov';
const NADE_SVG: Record<Nade, string> = {
  he: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="6.5" ry="7.5" fill="#4d5a3a" stroke="#1d2414" stroke-width="1.2"/><path d="M8 11h8M8 15h8M12 7v14" stroke="#2b3420" stroke-width="1"/><rect x="9.5" y="3.5" width="5" height="4" rx="1" fill="#9aa0a6"/><circle cx="17" cy="5" r="2.2" fill="none" stroke="#c9ced3" stroke-width="1.2"/></svg>',
  flash: '<svg viewBox="0 0 24 24"><rect x="7.5" y="6" width="9" height="15" rx="2" fill="#d8dde2" stroke="#4b5560" stroke-width="1.2"/><rect x="7.5" y="10" width="9" height="2.5" fill="#6d7a87"/><rect x="9.5" y="3" width="5" height="3.5" rx="1" fill="#9aa0a6"/></svg>',
  smoke: '<svg viewBox="0 0 24 24"><rect x="7.5" y="6" width="9" height="15" rx="2" fill="#7c8a78" stroke="#2f382d" stroke-width="1.2"/><rect x="7.5" y="13" width="9" height="2.5" fill="#d9d9d9"/><rect x="9.5" y="3" width="5" height="3.5" rx="1" fill="#9aa0a6"/></svg>',
  molotov: '<svg viewBox="0 0 24 24"><path d="M10 8h4v3l2.5 3v7a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 21v-7L10 11z" fill="#7a4a1c" stroke="#2b1806" stroke-width="1.1"/><path d="M10 4h4v4h-4z" fill="#e7d9b5"/><path d="M12 1.2c1.8 1.6 1.4 3-.1 3.4-1.4-.5-1.6-2 .1-3.4z" fill="#ffb02e"/></svg>',
};

/** Бросок гранаты дугой от from к to. Промис завершается в момент падения. */
export function throwNade(from: DOMRect | null, to: DOMRect | null, kind: Nade): Promise<void> {
  if (!from || !to || reduced()) return wait(60);
  const a = center(from), b = center(to);
  const el = put('fx-nade', a.x, a.y, NADE_SVG[kind], 900);
  const h = Math.max(70, Math.abs(b.y - a.y) * 0.45);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = (b.x - a.x) * t, y = (b.y - a.y) * t - 4 * h * t * (1 - t);
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${t * 540}deg) scale(${1.15 - 0.35 * Math.abs(t - 0.5)})` });
  }
  const ms = 480 * Math.max(speed, 0.2);
  el.animate(frames, { duration: ms, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'forwards' });
  setTimeout(() => el.remove(), ms + 20);
  return new Promise((r) => setTimeout(r, ms));
}

/** Осколочная: вспышка, ударная волна и разлетающиеся осколки. */
export function heBlast(at: DOMRect) {
  if (reduced()) return;
  const c = center(at);
  put('fx-burst he', c.x, c.y, '', 700);
  put('fx-wave', c.x, c.y, '', 600);
  const shards = Array.from({ length: 9 }, (_, i) => {
    const ang = (i / 9) * Math.PI * 2 + Math.random() * 0.5, d = 38 + Math.random() * 30;
    return `<i style="--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d}px"></i>`;
  }).join('');
  put('fx-shards', c.x, c.y, shards, 650);
}

/** Дым: облако клубами расползается по области и держится. */
export function smokeCloud(area: DOMRect) {
  if (reduced()) return;
  const n = Math.max(5, Math.round(area.width / 46));
  for (let i = 0; i < n; i++) {
    const x = area.left + (i + 0.5) * (area.width / n) + (Math.random() - 0.5) * 20;
    const y = area.top + area.height * (0.3 + Math.random() * 0.4);
    const el = put('fx-smoke', x, y, '', 2600);
    el.style.setProperty('--d', `${i * 70}ms`);
    el.style.setProperty('--s', `${0.9 + Math.random() * 0.6}`);
  }
}

/** Молотов: языки пламени на цели и вокруг. */
export function fireArea(at: DOMRect) {
  if (reduced()) return;
  const c = center(at);
  put('fx-burst fire', c.x, c.y, '', 700);
  const el = put('fx-flames', c.x, at.bottom - 8, '<i></i><i></i><i></i><i></i><i></i><i></i>', 1700);
  el.style.width = `${Math.max(at.width * 1.3, 70)}px`;
}

/**
 * Флешка: белая вспышка только над той стороной стола, где взорвалась граната.
 * area — ряд бойцов этой стороны, at — точка взрыва (цель), mine — ослепили нас (дольше и ярче).
 */
export function flashArea(area: DOMRect, at: DOMRect | null, mine: boolean) {
  if (reduced()) return;
  const padX = 18, padY = Math.max(30, area.height * 0.35);
  const x = area.left - padX, y = area.top - padY;
  const w = area.width + padX * 2, h = area.height + padY * 2;
  const el = put(`fx-flasharea ${mine ? 'mine' : ''}`, x, y, '', mine ? 1500 : 900);
  el.style.width = `${w}px`; el.style.height = `${h}px`;
  const cx = at ? at.left + at.width / 2 - x : w / 2, cy = at ? at.top + at.height / 2 - y : h / 2;
  el.style.setProperty('--fx', `${cx.toFixed(0)}px`); el.style.setProperty('--fy', `${cy.toFixed(0)}px`);
}

// ─────────────────────────── Килфид и радио ───────────────────────────
const feed = (() => { const el = document.createElement('div'); el.className = 'fx-feed'; layer.appendChild(el); return el; })();
/** Строка килфида как в CS (справа сверху над столом соперника). */
export function killfeed(html: string, mine: boolean, anchor?: DOMRect | null) {
  if (!feed.isConnected) layer.appendChild(feed);
  if (anchor) feed.style.top = `${Math.max(anchor.top + 6, 50)}px`;
  const row = document.createElement('div');
  row.className = `kf ${mine ? 'mine' : ''}`;
  row.innerHTML = html;
  feed.prepend(row);
  while (feed.children.length > 4) feed.lastElementChild!.remove();
  setTimeout(() => row.classList.add('out'), 4800);
  setTimeout(() => row.remove(), 5300);
}

const radioBox = (() => { const el = document.createElement('div'); el.className = 'fx-radio'; layer.appendChild(el); return el; })();
/** Радио-чат как в CS: «(Радио) Phoenix: Граната!». */
export function radio(who: string, text: string, side: 'T' | 'CT', anchor?: DOMRect | null) {
  if (!radioBox.isConnected) layer.appendChild(radioBox);
  if (anchor) radioBox.style.top = `${anchor.bottom - 10}px`;
  const row = document.createElement('div');
  row.className = `rd f-${side}`;
  row.innerHTML = `<i class="rd-ic"></i><span class="rd-who">${who}</span> ${text}`;
  radioBox.appendChild(row);
  while (radioBox.children.length > 3) radioBox.firstElementChild!.remove();
  setTimeout(() => row.classList.add('out'), 3200);
  setTimeout(() => row.remove(), 3700);
}

// ─────────────────────────── Бомба и баннеры ───────────────────────────
/** Полоса закладки/разминирования C4. */
export function progress(text: string, ms: number, kind: 'plant' | 'defuse'): Promise<void> {
  const el = document.createElement('div');
  el.className = `fx-prog ${kind}`;
  el.innerHTML = `<b>${text}</b><span><i></i></span>`;
  const d = ms * Math.max(speed, 0.2);
  el.style.setProperty('--life', `${d}ms`);
  layer.appendChild(el);
  return new Promise((r) => setTimeout(() => { el.remove(); r(); }, d));
}

/** Большой баннер конца игры в стиле CS: «Террористы победили». */
export function roundBanner(title: string, sub: string, kind: 'T' | 'CT' | 'clutch' | 'ace', ms = 2200) {
  layer.querySelectorAll('.fx-round').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = `fx-round k-${kind}`;
  el.innerHTML = `<div class="fr-band"><i class="fr-emb">${kind === 'T' ? 'T' : kind === 'CT' ? 'CT' : '★'}</i><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></div>`;
  el.style.setProperty('--life', `${ms}ms`);
  layer.appendChild(el);
  setTimeout(() => el.remove(), ms + 100);
}

/** Карта-призрак летит из точки в руку (трофей) или из руки в цель (действие). */
export function flyCard(html: string, from: DOMRect | null, to: DOMRect | null, cls = '') {
  if (!from || !to || reduced()) return;
  const el = put(`fx-flycard ${cls}`, from.left + from.width / 2, from.top + from.height / 2, html, 900);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const ms = 640 * Math.max(speed, 0.2);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.6) rotate(-6deg)', opacity: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.35}px), calc(-50% + ${dy * 0.35 - 40}px)) scale(1.05) rotate(4deg)`, opacity: 1, offset: 0.4 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.5) rotate(0)`, opacity: 0.2 },
  ], { duration: ms, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' });
}

/** Взлёт карты из руки по дуге на её место на столе. */
export function arcIn(el: HTMLElement | null, from: DOMRect | null) {
  if (!el || !from || reduced()) return;
  const a = el.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (a.left + a.width / 2);
  const dy = from.top + from.height / 2 - (a.top + a.height / 2);
  el.style.animation = 'none';
  el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(1.25) rotate(${dx > 0 ? 8 : -8}deg)`, opacity: 0.6, filter: 'brightness(1.4)' },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 46}px) scale(1.35) rotate(0)`, opacity: 1, offset: 0.45, filter: 'brightness(1.3)' },
    { transform: 'translate(0,-14px) scale(1.12)', offset: 0.78, filter: 'brightness(1.1)' },
    { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
  ], { duration: 560 * Math.max(speed, 0.2), easing: 'cubic-bezier(.25,.7,.35,1)' });
  setTimeout(() => {
    put('fx-land', a.left + a.width / 2, a.bottom - 6, '', 600);
    put('fx-dustring', a.left + a.width / 2, a.top + a.height / 2, '', 600);
  }, 430 * Math.max(speed, 0.2));
}
