// Медали игрока (онлайн): выдаёт сервер по итогам рейтинговых матчей и сезонов, видны всем в профиле.
// Каталог общий для сервера (кому что выдать) и игры (название, описание, значок, прогресс).

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export interface MedalDef { id: string; group: string; name: string; desc: string; icon: string; tier: Tier; stat?: StatKey; need?: number }
/** Пожизненная статистика игрока на сервере (не сбрасывается сезоном). */
export interface LifeStats { streak: number; best_streak: number; rwins: number; rgames: number; bomb_wins: number; defuse_wins: number; knife_wins: number; giants: number; peak: number }
type StatKey = keyof LifeStats;
export interface MedalRow { id: string; at: number; extra?: string }

const ladder = (group: string, base: string, name: string, descFn: (n: number) => string, icon: string, stat: StatKey, steps: [number, Tier][]): MedalDef[] =>
  steps.map(([n, tier]) => ({ id: `${base}_${n}`, group, name: `${name} ${n}`, desc: descFn(n), icon, tier, stat, need: n }));

export const MEDALS: MedalDef[] = [
  ...ladder('Серия побед', 'streak', 'Серия', (n) => `${n} рейтинговых побед подряд`, '🔥', 'best_streak', [[5, 'bronze'], [10, 'silver'], [20, 'gold'], [30, 'platinum']]),
  ...ladder('Победы', 'wins', 'Победы', (n) => `${n} побед в рейтинговых матчах`, '★', 'rwins', [[10, 'bronze'], [50, 'silver'], [100, 'gold'], [500, 'platinum']]),
  ...ladder('Матчи', 'games', 'Матчи', (n) => `Сыграно ${n} рейтинговых матчей`, '⚑', 'rgames', [[25, 'bronze'], [100, 'silver'], [300, 'gold'], [1000, 'platinum']]),
  ...ladder('Сапёр', 'defuse', 'Сапёр', (n) => `${n} побед разминированием за CT`, '✂', 'defuse_wins', [[10, 'bronze'], [50, 'silver'], [150, 'gold']]),
  ...ladder('Подрывник', 'bomb', 'Подрывник', (n) => `${n} побед взрывом бомбы за T`, '✸', 'bomb_wins', [[10, 'bronze'], [50, 'silver'], [150, 'gold']]),
  ...ladder('Ножи', 'knife', 'Мастер ножа', (n) => `${n} выигранных ножевых раундов`, '🗡', 'knife_wins', [[25, 'bronze'], [100, 'silver'], [300, 'gold']]),
  ...ladder('Гиганты', 'giant', 'Убийца гигантов', (n) => `${n} побед над соперником сильнее на 200+ Elo`, '⚔', 'giants', [[1, 'bronze'], [10, 'silver'], [50, 'gold']]),
  { id: 'level_5', group: 'Уровень', name: 'Уровень 5', desc: 'Достичь 5 уровня (1051+ Elo)', icon: '⬆', tier: 'bronze', stat: 'peak', need: 1051 },
  { id: 'level_8', group: 'Уровень', name: 'Уровень 8', desc: 'Достичь 8 уровня (1531+ Elo)', icon: '⬆', tier: 'gold', stat: 'peak', need: 1531 },
  { id: 'level_10', group: 'Уровень', name: 'Уровень 10', desc: 'Достичь 10 уровня (2001+ Elo)', icon: '⬆', tier: 'platinum', stat: 'peak', need: 2001 },
];
const BY_ID = new Map(MEDALS.map((m) => [m.id, m]));
/** Медаль по id; сезонные значки (season<номер>_top1/3/10) собираются на лету. */
export function medalDef(id: string, extra?: string): MedalDef | null {
  const s = /^season(\d+)_top(1|3|10)$/.exec(id);
  if (s) {
    const top = Number(s[2]), place = extra?.split('|')[1];
    return { id, group: 'Сезоны', name: top === 1 ? 'Чемпион сезона' : `Топ-${top} сезона`, desc: `${extra?.split('|')[0] ?? `Сезон ${s[1]}`}: ${place ? `${place} место` : `в десятке лучших`}`,
      icon: top === 1 ? '♛' : `${top}`, tier: top === 1 ? 'platinum' : top === 3 ? 'gold' : 'silver' };
  }
  return BY_ID.get(id) ?? null;
}
/** Какие медали из лесенок положены при такой статистике. */
export const earnedBy = (st: LifeStats) => MEDALS.filter((m) => m.stat && m.need !== undefined && st[m.stat] >= m.need).map((m) => m.id);
const TIER_RANK: Record<Tier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
/** Лучшие медали для витрины рядом с именем (сезонные — первыми). */
export function showcase(rows: MedalRow[], n = 3): MedalRow[] {
  return [...rows].sort((a, b) => {
    const da = medalDef(a.id, a.extra), db = medalDef(b.id, b.extra);
    const sa = a.id.startsWith('season') ? 10 : 0, sb = b.id.startsWith('season') ? 10 : 0;
    return sb + TIER_RANK[db?.tier ?? 'bronze'] - (sa + TIER_RANK[da?.tier ?? 'bronze']) || b.at - a.at;
  }).slice(0, n);
}
