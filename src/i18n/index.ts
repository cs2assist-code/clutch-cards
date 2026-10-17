// Язык интерфейса: русский (исходный) или английский.
// Тексты в коде пишутся по-русски; в английском режиме всё, что появляется на странице (экраны, баннеры,
// всплывающие окна, сообщения сервера), переводится по словарю src/i18n/en.ts: каждая известная фраза
// заменяется целиком, числа, имена и суммы между ними остаются как есть.
import { EN } from './en';

export type Lang = 'ru' | 'en';
const KEY = 'clutch_lang';
const CYR = /[А-Яа-яЁё]/;

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'ru' || v === 'en') return v; } catch { /* без хранилища */ }
  const tgLang = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  const l = (tgLang || navigator.language || 'ru').toLowerCase();
  return /^(ru|uk|be|kk)/.test(l) ? 'ru' : 'en';
}
let lang: Lang = initial();
export const getLang = () => lang;
export const isEn = () => lang === 'en';
/** Числа и суммы в формате языка: 1,5 / 1.5 */
export const numLoc = (n: number, digits = 2) => n.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: digits });
export const dateLoc = (t: number, opt: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', opt);

// Одно регулярное выражение на весь словарь: длинные фразы раньше коротких, границы — по русским буквам
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Варианты со строчной буквы («Хедшот» → «хедшот»): так фразы иногда вставляются в середину предложения
for (const k of Object.keys(EN)) {
  const lo = k.charAt(0).toLowerCase() + k.slice(1);
  if (lo !== k && !(lo in EN)) EN[lo] = EN[k].charAt(0).toLowerCase() + EN[k].slice(1);
}
// Границы проверяем только там, где фраза начинается или кончается русской буквой — «: бонус…» стоит сразу после слова
const L = /[А-Яа-яЁё]/;
const pat = (k: string) => `${L.test(k[0]) ? '(?<![А-Яа-яЁё])' : ''}${esc(k)}${L.test(k[k.length - 1]) ? '(?![А-Яа-яЁё])' : ''}`;
const keys = Object.keys(EN).filter((k) => k.length > 1).sort((a, b) => b.length - a.length);
const RE = new RegExp(keys.map(pat).join('|'), 'g');

/** Перевести строку (в русском режиме — как есть). */
export function tr(text: string): string {
  if (lang !== 'en' || !CYR.test(text)) return text;
  return text.replace(/\s+/g, ' ').replace(RE, (m) => EN[m] ?? m);
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
/** Перевести текстовый узел; присваиваем, только если текст изменился — иначе наблюдатель зациклится. */
function setText(n: Node) {
  const t = n.nodeValue ?? '';
  if (!CYR.test(t)) return;
  const r = tr(t);
  if (r !== t) n.nodeValue = r;
}
function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { setText(root); return; }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return;
  if (root instanceof Element) translateAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) setText(n);
    else translateAttrs(n as Element);
  }
}
function translateAttrs(el: Element) {
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && CYR.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
}

let observer: MutationObserver | null = null;
function startObserver() {
  if (observer || lang !== 'en') return;
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') setText(m.target);
      else if (m.type === 'attributes' && m.target instanceof Element) translateAttrs(m.target);
      else m.addedNodes.forEach((n) => translateTree(n));
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  translateTree(document.body);
}
/** Включить перевод страницы (вызывается при запуске). */
export function initI18n() {
  document.documentElement.lang = lang;
  startObserver();
}
/** Сменить язык; onChange — перерисовать экран (в русском режиме исходные тексты вернутся при перерисовке). */
export function setLang(l: Lang, onChange?: () => void) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* без хранилища */ }
  document.documentElement.lang = l;
  if (l === 'en') startObserver(); else { observer?.disconnect(); observer = null; }
  onChange?.();
}
