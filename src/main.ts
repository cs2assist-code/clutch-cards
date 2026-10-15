// «Клатч» — карточная игра по CS2 для Telegram. Единственный режим — «Схватка» (src/hs).
// Здесь только оболочка: главное меню, настройки, статистика и подключение режима.
import './style.css';
import './skin.css';
import { AGENTS, mapDef } from './game/cards';
import { loadStats, resetStats, stats } from './stats';
import { sfx, soundOn, toggleSound, unlock as unlockSound } from './sound';
import { toggleVoice, voiceEnabled } from './voice';
import { analyticsOn, toggleAnalytics, track } from './analytics';
import { hsClick, hsHTML, hsInit, hsJoinDuel, hsOpen } from './hs/ui';
import { loadQuests, questView } from './quests';
import { startDuelCode } from './online/client';
import { agentArt, cssUrl, esc } from './art';
import { UI_IMG } from './hs/art-index';
import './menu.css';
import './theme.css';
import * as fx from './fx';
import { haptic, initTelegram, setBackButton } from './telegram';

type Screen = 'menu' | 'hs' | 'stats' | 'quests';
const ui = { screen: 'menu' as Screen, settingsOpen: false, confirmReset: false, toast: null as string | null };

const root = document.getElementById('app')!;
initTelegram('#101318');
if (location.hash.includes('fast')) fx.setFxSpeed(0.03);

const svgI = (body: string, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  gear: svgI('<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.6 4.6-1.9.4a6.9 6.9 0 0 1-.7 1.7l1.1 1.6-1.6 1.6-1.6-1.1a6.9 6.9 0 0 1-1.7.7l-.4 1.9h-2.3l-.4-1.9a6.9 6.9 0 0 1-1.7-.7l-1.6 1.1-1.6-1.6 1.1-1.6a6.9 6.9 0 0 1-.7-1.7l-1.9-.4v-2.3l1.9-.4c.2-.6.4-1.2.7-1.7L5.1 6.6l1.6-1.6 1.6 1.1c.5-.3 1.1-.5 1.7-.7l.4-1.9h2.3l.4 1.9c.6.2 1.2.4 1.7.7l1.6-1.1 1.6 1.6-1.1 1.6c.3.5.5 1.1.7 1.7l1.9.4z" fill="currentColor"/>'),
  play: svgI('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  cards: svgI('<rect x="3" y="4" width="8" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="8" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  help: svgI('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.6v.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>'),
  globe: svgI('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
  target: svgI('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  grad: svgI('<path d="M2 9l10-5 10 5-10 5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5" fill="none" stroke="currentColor" stroke-width="2"/>'),
  chart: svgI('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
};
const DIFF_RU: Record<string, string> = { easy: 'Новичок', normal: 'Обычный', hard: 'Сложный' };

// ─────────────────────────── Экраны ───────────────────────────
/** Картинка оформления: public/img/ui_<id>.webp, если её положили; иначе null. */
function uiImg(id: string): string | null {
  if (!UI_IMG.has(id)) return null;
  return (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[`ui_${id}`] ?? `img/ui_${id}.webp`;
}
const portrait = (side: 't' | 'ct', id: string) => (globalThis as { __CARD_IMG?: Record<string, string> }).__CARD_IMG?.[`u_${side}_${id}`] ?? `img/u_${side}_${id}.webp`;

function menuHTML() {
  const q = questView();
  const done = q.list.filter((x) => x.done).length;
  const key = uiImg('menu_key');
  // Ключевой арт: готовая картинка ui_menu_key.webp, а пока её нет — два бойца T и CT по краям
  const art = key
    ? `<div class="km-art one" style="--key:url('${esc(cssUrl(key))}')"></div>`
    : `<div class="km-art"><img class="t" src="${esc(portrait('t', 'ak47'))}" alt=""><img class="ct" src="${esc(portrait('ct', 'm4a4'))}" alt=""></div>`;
  return `<main class="km" style="--menu-bg:url('${esc(cssUrl(mapDef('dust2').image))}')">
    ${art}
    <header class="km-top">
      <div class="km-logo"><i></i><b>КЛАТЧ</b><small>CS2 · карточная тактика</small></div>
      <div class="km-me">${stats.games ? `<span><b>${stats.wins}</b> побед · <b>${stats.games}</b> игр</span>` : '<span>Новый игрок</span>'}
        <button class="km-icon ${ui.settingsOpen ? 'on' : ''}" data-act="settings" aria-label="Настройки">${ICON.gear}</button></div>
    </header>
    ${ui.settingsOpen ? `<div class="km-settings">
      <button class="toggle ${soundOn() ? 'on' : ''}" data-act="sound" aria-pressed="${soundOn()}"><i></i>Звуки</button>
      <button class="toggle ${voiceEnabled() ? 'on' : ''}" data-act="voice" aria-pressed="${voiceEnabled()}"><i></i>Радиокоманды</button>
      <button class="toggle ${analyticsOn() ? 'on' : ''}" data-act="analytics" aria-pressed="${analyticsOn()}"><i></i>Анонимная статистика для разработчика</button>
      <small class="note">Без имени и Telegram-ID: только какие шаги проходят игроки.</small>
    </div>` : ''}
    <section class="km-main">
      <div class="km-hero">
        <p class="km-eyebrow"><span class="t">T</span> против <span class="ct">CT</span></p>
        <h1>Собери стол.<br>Выиграй клатч.</h1>
        <p class="km-lede">Бойцы с оружием CS2, гранаты, бомба и экономика раундов — в карточной дуэли на 5 минут.</p>
      </div>
      <button class="km-play" data-act="hs-enter"><span>${ICON.play}</span><b>Играть</b><small>против бота</small></button>
      <div class="km-modes">
        <button class="km-mode ct" data-act="online"><img src="${esc(portrait('ct', 'awp'))}" alt=""><span><b>Онлайн</b><small>Рейтинг · дуэль по ссылке</small></span></button>
        <button class="km-mode t ${stats.tutorialDone ? '' : 'hot'}" data-act="tutorial"><img src="${esc(portrait('t', 'glock'))}" alt=""><span><b>Обучение</b><small>${stats.tutorialDone ? 'Пройдено · повторить' : 'Первый матч с подсказками'}</small></span></button>
      </div>
      <button class="km-quests" data-act="quests">
        <span class="km-qhead"><b>Задания дня</b><small>${done} из ${q.list.length}${q.streak ? ` · серия ${q.streak}` : ''}</small></span>
        ${q.list.map((x) => `<span class="km-q ${x.done ? 'done' : ''}"><em>${esc(x.text)}</em><i style="--p:${(x.prog / x.goal).toFixed(3)}"></i></span>`).join('')}
      </button>
      <nav class="km-nav">
        <button data-act="hs-page" data-to="rules">${ICON.help}<b>Как играть</b></button>
        <button data-act="hs-page" data-to="cards">${ICON.cards}<b>Все карты</b></button>
        <button data-act="stats">${ICON.chart}<b>Статистика</b></button>
      </nav>
    </section>
  </main>`;
}

function statsHTML() {
  const st = stats;
  const pct = (w: number, n: number) => (n ? Math.round((100 * w) / n) + '%' : '—');
  const agents = AGENTS.map((a) => ({ a, v: st.agents[a.id] ?? [0, 0] })).filter((x) => x.v[0] > 0).sort((x, y) => y.v[0] - x.v[0]);
  return `<main class="stats scroll">
    <header class="bar"><button class="ghost" data-act="menu">← Меню</button></header>
    <h2>Статистика</h2>
    <div class="statgrid">
      <div><b>${st.games}</b><small>матчей</small></div>
      <div><b>${pct(st.wins, st.games)}</b><small>побед</small></div>
      <div><b>${st.streak}</b><small>серия · лучшая ${st.best}</small></div>
      <div><b>${st.rounds[0]}:${st.rounds[1]}</b><small>игры в матчах</small></div>
      <div><b>${st.kills}</b><small>убийств</small></div>
    </div>
    <h4 class="sub">По сложности</h4>
    <div class="statrows">${['easy', 'normal', 'hard'].map((d) => { const v = st.byDiff[d] ?? [0, 0]; return `<p><span>${DIFF_RU[d]}</span><b>${v[1]} из ${v[0]}</b><i>${pct(v[1], v[0])}</i></p>`; }).join('')}</div>
    <h4 class="sub">Агенты</h4>
    <div class="statrows">${agents.map(({ a, v }) => `<p><span class="portrait xs">${agentArt(a.side, a.id)}</span><span>${esc(a.name)}</span><b>${v[1]} из ${v[0]} игр</b><i>${pct(v[1], v[0])}</i></p>`).join('') || '<p class="note">Сыграйте матч — здесь появятся ваши агенты.</p>'}</div>
    <div class="row left">${ui.confirmReset ? '<button class="danger sm" data-act="resetstats">Точно сбросить?</button>' : '<button class="ghost sm" data-act="askreset">Сбросить статистику</button>'}</div>
  </main>`;
}

function questsHTML() {
  const q = questView();
  return `<main class="stats scroll">
    <header class="bar"><button class="ghost" data-act="menu">← Меню</button></header>
    <h2>Задания дня</h2>
    <p class="note">Новые каждый день, одинаковые у всех. Засчитываются игры с ботом и онлайн.</p>
    <div class="quests">${q.list.map((x) => `<div class="quest ${x.done ? 'done' : ''}"><b>${esc(x.text)}</b><span class="qbar"><i style="width:${Math.round((100 * x.prog) / x.goal)}%"></i></span><small>${x.done ? 'Готово' : `${x.prog} / ${x.goal}`} · +${x.pts}</small></div>`).join('')}</div>
    <div class="statgrid"><div><b>${q.points}</b><small>очков за задания</small></div><div><b>${q.streak}</b><small>дней подряд все три</small></div></div>
  </main>`;
}

function go(screen: Screen) {
  ui.screen = screen;
  ui.confirmReset = false;
  setBackButton(screen === 'menu' ? null : () => go('menu'));
  render();
}

function showToast(text: string, ms = 1400) {
  ui.toast = text;
  render();
  setTimeout(() => { if (ui.toast === text) { ui.toast = null; render(); } }, ms);
}

// ─────────────────────────── Нажатия ───────────────────────────
root.addEventListener('pointerdown', () => unlockSound());
root.addEventListener('click', (ev) => {
  const actEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!actEl) return;
  const a = actEl.dataset.act!;
  haptic.tap();
  if (a === 'hs-enter') { ui.screen = 'hs'; setBackButton(() => go('menu')); hsOpen(); return; }
  if (a === 'hs-page') { ui.screen = 'hs'; setBackButton(() => go('menu')); hsOpen(actEl.dataset.to as 'cards' | 'rules'); return; }
  if (a.startsWith('hs-') && ui.screen === 'hs' && hsClick(a, actEl)) return;
  switch (a) {
    case 'menu': return go('menu');
    case 'stats': return go('stats');
    case 'quests': return go('quests');
    case 'online': ui.screen = 'hs'; setBackButton(() => go('menu')); hsOpen('lobby'); return;
    case 'tutorial': ui.screen = 'hs'; setBackButton(() => go('menu')); hsClick('hs-tutorial', actEl); return;
    case 'settings': ui.settingsOpen = !ui.settingsOpen; return render();
    case 'sound': toggleSound(); if (soundOn()) sfx.click(); return render();
    case 'voice': toggleVoice(); return render();
    case 'analytics': toggleAnalytics(); return render();
    case 'askreset': ui.confirmReset = true; return render();
    case 'resetstats': resetStats(); ui.confirmReset = false; showToast('Статистика сброшена'); return;
  }
}, true);

// ─────────────────────────── Рендер ───────────────────────────
function render() {
  const scroll = root.querySelector('.scroll')?.scrollTop ?? 0;
  if (ui.screen !== 'hs') fx.clear();
  let html = ui.screen === 'hs' ? hsHTML() : ui.screen === 'stats' ? statsHTML() : ui.screen === 'quests' ? questsHTML() : menuHTML();
  if (ui.toast) html += `<div class="toast">${esc(ui.toast)}</div>`;
  root.innerHTML = html;
  const sc = root.querySelector('.scroll');
  if (sc) sc.scrollTop = scroll;
}

hsInit({ render: () => render(), menu: () => go('menu'), root });
render();
// Приглашение на дуэль (ссылка t.me/<бот>/<app>?startapp=duel_КОД) — сразу в лобби и в дуэль
const duel = startDuelCode();
if (duel) { ui.screen = 'hs'; setBackButton(() => go('menu')); hsJoinDuel(duel); }
void Promise.all([loadStats(), loadQuests()]).then(() => {
  render();
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string; platform?: string } } }).Telegram?.WebApp;
  track('app_open', { tg: !!tg?.initData, pf: tg?.platform ?? 'web', w: innerWidth, h: innerHeight, games: stats.games });
});
