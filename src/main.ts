// «Клатч» — карточная игра по CS2 для Telegram. Единственный режим — «Схватка» (src/hs).
// Здесь только оболочка: главное меню, настройки, статистика и подключение режима.
import './style.css';
import './skin.css';
import { AGENTS, mapDef } from './game/cards';
import { loadStats, resetStats, stats } from './stats';
import { sfx, soundOn, toggleSound, unlock as unlockSound } from './sound';
import { toggleVoice, voiceEnabled } from './voice';
import { analyticsOn, toggleAnalytics, track } from './analytics';
import { hsClick, hsFanHTML, hsHTML, hsInit, hsJoinDuel, hsOpen } from './hs/ui';
import { loadQuests, questView } from './quests';
import { startDuelCode } from './online/client';
import { agentArt, cssUrl, esc } from './art';
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
function menuHTML() {
  return `<main class="menu" style="--menu-bg:url('${esc(cssUrl(mapDef('dust2').image))}')">
    <button class="gearbtn ${ui.settingsOpen ? 'on' : ''}" data-act="settings" aria-label="Настройки">${ICON.gear}</button>
    ${ui.settingsOpen ? `<div class="settings">
      <button class="toggle ${soundOn() ? 'on' : ''}" data-act="sound" aria-pressed="${soundOn()}"><i></i>Звуки</button>
      <button class="toggle ${voiceEnabled() ? 'on' : ''}" data-act="voice" aria-pressed="${voiceEnabled()}"><i></i>Радиокоманды</button>
      <button class="toggle ${analyticsOn() ? 'on' : ''}" data-act="analytics" aria-pressed="${analyticsOn()}"><i></i>Анонимная статистика для разработчика</button>
      <small class="note">Без имени и Telegram-ID: только какие шаги проходят игроки.</small>
    </div>` : ''}
    ${hsFanHTML()}
    <header class="brand">
      <p class="eyebrow">Карточная тактика по CS2</p>
      <h1>КЛАТЧ</h1>
      <span class="split"></span>
      <p class="lede">Соберите стол из бойцов, контрите оружие соперника, закладывайте бомбу или обезвреживайте её. Колода, рука и герои — как в Hearthstone.</p>
    </header>
    <button class="primary big-btn playbtn" data-act="hs-enter">${ICON.play}Играть с ботом</button>
    <button class="ghost big-btn onlinebtn" data-act="online">${ICON.globe}Онлайн · рейтинг и дуэли</button>
    <div class="tiles">
      <button class="tile ${stats.tutorialDone ? '' : 'hot'}" data-act="tutorial">${ICON.grad}<b>Обучение</b><small>${stats.tutorialDone ? 'Пройдено' : 'Первый матч с подсказками'}</small></button>
      <button class="tile" data-act="quests">${ICON.target}<b>Задания</b><small>${(() => { const q = questView(); return `${q.list.filter((x) => x.done).length} из ${q.list.length} сегодня`; })()}</small></button>
      <button class="tile" data-act="hs-page" data-to="rules">${ICON.help}<b>Как играть</b><small>Правила и «кто кого»</small></button>
      <button class="tile" data-act="hs-page" data-to="cards">${ICON.cards}<b>Все карты</b><small>Оружие, гранаты, засады</small></button>
      <button class="tile wide" data-act="stats">${ICON.chart}<b>Статистика</b><small>${stats.games ? `${stats.wins} побед из ${stats.games}` : 'Пока пусто'}</small></button>
    </div>
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
