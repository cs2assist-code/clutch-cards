// Ежедневные задания: три в день (одинаковые у всех игроков — выбираются по дате), прогресс копится
// в играх против бота и онлайн. За выполненное задание — очки; серия дней, когда сделаны все три.
import { loadJSON, saveJSON } from './storage';

export type QuestKind = 'win' | 'win_online' | 'games' | 'kills' | 'plant' | 'defuse' | 'flash' | 'nade' | 'headshot' | 'clutch' | 'trophy' | 'power' | 'shop' | `agent:${string}`;
export interface QuestDef { id: string; kind: QuestKind; goal: number; text: string; pts: number }

const AGENT_Q: [string, string][] = [['t_phoenix', 'Phoenix'], ['t_balkan', 'Balkan'], ['t_elite', 'Elite Crew'], ['t_guerrilla', 'Партизана'], ['t_pro', 'Наёмника'],
  ['ct_swat', 'SWAT'], ['ct_seal', 'SEAL'], ['ct_fbi', 'FBI'], ['ct_sas', 'SAS'], ['ct_gign', 'GIGN']];
export const QUESTS: QuestDef[] = [
  { id: 'win2', kind: 'win', goal: 2, text: 'Выиграйте 2 игры', pts: 30 },
  { id: 'games3', kind: 'games', goal: 3, text: 'Сыграйте 3 игры', pts: 20 },
  { id: 'kills12', kind: 'kills', goal: 12, text: 'Убейте 12 бойцов соперника', pts: 25 },
  { id: 'plant2', kind: 'plant', goal: 2, text: 'Заложите бомбу 2 раза', pts: 25 },
  { id: 'defuse1', kind: 'defuse', goal: 1, text: 'Обезвредьте бомбу', pts: 30 },
  { id: 'flash3', kind: 'flash', goal: 3, text: 'Бросьте 3 флешки', pts: 20 },
  { id: 'nade4', kind: 'nade', goal: 4, text: 'Бросьте 4 боевые гранаты (HE, молотов, зажигательная)', pts: 20 },
  { id: 'hs3', kind: 'headshot', goal: 3, text: 'Сделайте 3 хедшота', pts: 25 },
  { id: 'clutch1', kind: 'clutch', goal: 1, text: 'Сыграйте клатч: последний боец против двух и больше', pts: 30 },
  { id: 'trophy2', kind: 'trophy', goal: 2, text: 'Подберите 2 трофея', pts: 25 },
  { id: 'power5', kind: 'power', goal: 5, text: 'Используйте силу героя 5 раз', pts: 20 },
  { id: 'shop3', kind: 'shop', goal: 3, text: 'Купите 3 карты в бай-меню', pts: 15 },
  { id: 'online1', kind: 'win_online', goal: 1, text: 'Выиграйте онлайн-игру', pts: 40 },
  ...AGENT_Q.map(([id, n]) => ({ id: `ag_${id}`, kind: `agent:${id}` as QuestKind, goal: 1, text: `Выиграйте игру за ${n}`, pts: 30 })),
];

interface QState { day: string; prog: Record<string, number>; done: string[]; points: number; streak: number; lastFull: string }
const KEY = 'clutch_quests';
let st: QState = { day: '', prog: {}, done: [], points: 0, streak: 0, lastFull: '' };
const today = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD по местному времени
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Задания дня: три разных, одно из них — «за агента» не чаще раза в день. */
export function todayQuests(day = today()): QuestDef[] {
  const out: QuestDef[] = [];
  let h = hash(day);
  const pool = [...QUESTS];
  while (out.length < 3 && pool.length) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const q = pool.splice(h % pool.length, 1)[0];
    if (q.kind.startsWith('agent:') && out.some((x) => x.kind.startsWith('agent:'))) continue;
    out.push(q);
  }
  return out;
}

export async function loadQuests() { st = await loadJSON<QState>(KEY, st); rollDay(); }
function rollDay() { const d = today(); if (st.day !== d) { st.day = d; st.prog = {}; st.done = []; } }
const save = () => saveJSON(KEY, st);

export function questView() {
  rollDay();
  return { list: todayQuests().map((q) => ({ ...q, prog: Math.min(q.goal, st.prog[q.id] ?? 0), done: st.done.includes(q.id) })), points: st.points, streak: st.streak };
}

/** Продвинуть задания. Возвращает только что выполненные (для всплывающей подсказки). */
export function questBump(kind: QuestKind, n = 1): QuestDef[] {
  rollDay();
  const fresh: QuestDef[] = [];
  for (const q of todayQuests()) {
    if (q.kind !== kind || st.done.includes(q.id)) continue;
    st.prog[q.id] = (st.prog[q.id] ?? 0) + n;
    if (st.prog[q.id] >= q.goal) { st.done.push(q.id); st.points += q.pts; fresh.push(q); }
  }
  if (fresh.length && st.done.length >= 3 && st.lastFull !== st.day) {
    // серия: все три задания подряд по дням
    const y = new Date(); y.setDate(y.getDate() - 1);
    st.streak = st.lastFull === y.toLocaleDateString('sv-SE') ? st.streak + 1 : 1;
    st.lastFull = st.day;
  }
  if (n) save();
  return fresh;
}
