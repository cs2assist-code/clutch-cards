// Статистика игрока: хранится там же, где колоды (CloudStorage Telegram или localStorage).
import { loadJSON, saveJSON } from './storage';

export interface DailyResult { win: boolean; turns: number; agent: string; side: string }
export interface Stats {
  games: number; wins: number;
  rounds: [number, number];          // выиграно, проиграно
  streak: number; best: number;
  kills: number;
  agents: Record<string, [number, number]>; // агент → [раундов, побед]
  byDiff: Record<string, [number, number]>; // сложность → [матчей, побед]
  daily: Record<string, DailyResult>;
  tutorialDone: boolean;
}
const KEY = 'clutch_stats';
const empty = (): Stats => ({ games: 0, wins: 0, rounds: [0, 0], streak: 0, best: 0, kills: 0, agents: {}, byDiff: {}, daily: {}, tutorialDone: false });

export let stats: Stats = empty();
export async function loadStats() { stats = await loadJSON<Stats>(KEY, empty()); return stats; }
const save = () => {
  // В CloudStorage не больше 4096 символов: храним только последние 30 вызовов дня
  const days = Object.keys(stats.daily).sort().slice(-30);
  stats.daily = Object.fromEntries(days.map((d) => [d, stats.daily[d]]));
  saveJSON(KEY, stats);
};

/** Итог раунда: агент игрока, победа, убийства. */
export function recordRound(agentId: string, win: boolean, kills: number) {
  stats.rounds[win ? 0 : 1]++;
  stats.kills += kills;
  const a = (stats.agents[agentId] ??= [0, 0]);
  a[0]++; if (win) a[1]++;
  save();
}

/** Итог матча. */
export function recordRoundsMatch(win: boolean, diff: string) {
  stats.games++;
  if (win) { stats.wins++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); } else stats.streak = 0;
  const d = (stats.byDiff[diff] ??= [0, 0]);
  d[0]++; if (win) d[1]++;
  save();
}

/** Обучение пройдено — больше не предлагаем его при запуске. */
export function markTutorialDone() { stats.tutorialDone = true; save(); }

export function resetStats() { const keepTut = stats.tutorialDone; stats = empty(); stats.tutorialDone = keepTut; save(); }
