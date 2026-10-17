// Опыт и свои карты игрока («Мастерская»). Опыт копится за игры и задания, не больше XP_WEEK_CAP за неделю;
// создание карты стоит FORGE_COST_XP (≈ неделя игры), уничтожение — FORGE_DESTROY_XP. Своих карт — не больше 5.
// Хранится там же, где статистика (CloudStorage Telegram / localStorage).
import { loadJSON, saveJSON } from '../storage';
import { FORGE_COST_XP, FORGE_DESTROY_XP, FORGE_MAX_CARDS, registerCustoms, toHCard, validSpec, XP_START, XP_WEEK_CAP, type CustomSpec } from './forge';

const KEY = 'clutch_forge';
interface Prog { xp: number; week: string; weekXp: number; cards: CustomSpec[]; created: number; destroyed: number; init: boolean }
let P: Prog = { xp: 0, week: '', weekXp: 0, cards: [], created: 0, destroyed: 0, init: false };
let loaded = false;   // до загрузки ничего не сохраняем — иначе пустое состояние затрёт сохранённое

/** Неделя по ISO (понедельник — начало): «2026-W42». */
export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Сколько дней до сброса недельного лимита (до понедельника). */
export const daysToWeekReset = () => { const d = new Date().getDay(); return d === 1 ? 7 : (8 - d) % 7 || 7; };

export async function loadProgress() {
  P = await loadJSON<Prog>(KEY, P);
  loaded = true;
  if (!P.init) { P.xp = XP_START; P.init = true; save(); }   // стартовый опыт: первую карту можно сделать сразу
  P.cards = (P.cards ?? []).filter(validSpec).slice(0, FORGE_MAX_CARDS);
  registerCustoms(P.cards);
  rollWeek();
}
const save = () => { if (loaded) saveJSON(KEY, P); };
function rollWeek() { const w = weekKey(); if (P.week !== w) { P.week = w; P.weekXp = 0; save(); } }

export const progress = () => { rollWeek(); return { xp: P.xp, weekXp: P.weekXp, cards: P.cards, created: P.created, destroyed: P.destroyed }; };
export const mySpecs = () => P.cards;
export const myCustomIds = () => P.cards.map((s) => toHCard(s).id);

/** Начислить опыт (с учётом недельного лимита). Возвращает, сколько реально добавилось. */
export function gainXp(n: number): number {
  rollWeek();
  const add = Math.max(0, Math.min(n, XP_WEEK_CAP - P.weekXp));
  if (!add) return 0;
  P.xp += add; P.weekXp += add; save();
  return add;
}
export const canCreate = () => P.cards.length < FORGE_MAX_CARDS && P.xp >= FORGE_COST_XP;
export function createCard(spec: CustomSpec): string | null {
  if (!canCreate() || !validSpec(spec)) return null;
  const id = toHCard(spec).id;
  if (myCustomIds().includes(id)) return null;   // такая карта уже есть
  P.xp -= FORGE_COST_XP; P.created++;
  P.cards.push(spec);
  registerCustoms([spec]); save();
  return id;
}
export const canDestroy = () => P.xp >= FORGE_DESTROY_XP;
/** Уничтожить свою карту (стоит опыта). Возвращает id уничтоженной карты. */
export function destroyCard(i: number): string | null {
  if (!canDestroy() || !P.cards[i]) return null;
  const id = toHCard(P.cards[i]).id;
  P.xp -= FORGE_DESTROY_XP; P.destroyed++;
  P.cards.splice(i, 1); save();
  return id;
}
