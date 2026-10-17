// Свои колоды игрока: по одной на агента. Хранятся там же, где статистика (CloudStorage Telegram / localStorage).
// Пустая запись — играет колода агента по умолчанию (случайный добор из пула, партии не повторяются).
import { loadJSON, saveJSON } from '../storage';
import { validDeck } from './cards';
import type { Agents } from '../online/protocol';
import { mySpecs } from './progress';

const KEY = 'clutch_decks';
let decks: Record<string, string[]> = {};

export async function loadDecks() {
  const d = await loadJSON<Record<string, string[]>>(KEY, {});
  decks = {};
  for (const [agent, list] of Object.entries(d)) if (validDeck(agent, list)) decks[agent] = list;
}
/** Своя колода агента или null (тогда — стандартная). */
export const getDeck = (agentId: string): string[] | null => decks[agentId] ?? null;
export function setDeck(agentId: string, deck: string[] | null) {
  if (deck && validDeck(agentId, deck)) decks[agentId] = [...deck];
  else delete decks[agentId];
  saveJSON(KEY, decks);
}
/** Своя карта уничтожена — колоды с ней возвращаются к стандартным. */
export function purgeCustom(id: string) {
  let changed = false;
  for (const [agent, list] of Object.entries(decks)) if (list.includes(id)) { delete decks[agent]; changed = true; }
  if (changed) saveJSON(KEY, decks);
  return changed;
}
/** Агенты для сервера вместе со своими колодами (если собраны). */
export function agentsWithDecks(T: string, CT: string): Agents {
  const a: Agents = { T, CT };
  const dT = getDeck(T), dCT = getDeck(CT);
  if (dT) a.dT = dT;
  if (dCT) a.dCT = dCT;
  if ((dT ?? []).concat(dCT ?? []).some((id) => id.startsWith('cc_'))) a.cc = mySpecs();   // свои карты — серверу на проверку
  return a;
}
