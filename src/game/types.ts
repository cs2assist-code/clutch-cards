export type Side = 'CT' | 'T';
export type Faction = Side | 'N'; // N — карта доступна обеим сторонам
export type PlayerIdx = 0 | 1;

/**
 * Поле — 7 рядов: 0 — спавн T, 1…5 — ряды между спавнами, 6 — спавн CT.
 * Ряд 5 (первый ряд CT) — точка B, сюда ставится бомба.
 */
export type RowIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type CardType = 'weapon' | 'knife' | 'wall' | 'grenade' | 'gear' | 'tactic';
export type WeaponClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy';

/** Особенности оружия. */
export type Trait =
  | 'twice'     // две атаки за ход (SMG)
  | 'reload'    // стреляет раз в два хода (AWP)
  | 'pierce'    // бьёт по герою напрямую, сквозь карты (AWP)
  | 'headshot'  // 30% шанс двойного урона (Deagle)
  | 'suppress'  // цель пропускает следующую атаку (Negev)
  | 'silenced'; // по нему не отвечают огнём (M4A1-S)

/** Куда направлена карта при покупке. */
export type TargetKind =
  | 'deploy'    // оружие и укрытия: ряд для выхода
  | 'row'       // гранаты: ряд в пределах броска
  | 'ownUnit'   // своя карта
  | 'ownWeapon' // своя карта оружия
  | 'ownAny'    // своя карта или свой герой
  | 'enemyUnit' // вражеская карта
  | 'none';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  faction: Faction;
  /** Только в арсенале определённого агента, в колоду не кладётся. */
  agentOnly?: boolean;
  price: number;           // цена в $
  /** Урон по расстоянию в рядах: dmg[0] — в одном ряду. 0 или отсутствие — не достаёт. */
  dmg?: number[];
  hp?: number;
  cls?: WeaponClass;
  traits?: Trait[];
  wall?: 'box' | 'door';
  target?: TargetKind;
  text?: string;
  image?: string;
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
  bombOnly?: boolean;      // не участвует в решающем раунде
}

export interface Unit {
  uid: string;
  cardId: string;
  row: RowIdx;
  hp: number;
  maxHp: number;
  bonusDmg: number;   // постоянный бонус (Буст)
  tempDmg: number;    // бонус до конца хода
  doubled: boolean;   // урон ×2 до конца хода (Клатч)
  armor: number;      // поглощает любой урон
  shield: number;     // поглощает только урон от оружия
  helmet: boolean;
  acted: boolean;     // выстрелила / заложила / начала дефьюз в этот ход
  moved: boolean;     // сделала шаг в этот ход (шаг, потом выстрел — можно)
  shots: number;      // выстрелов осталось в этот ход
  fresh: boolean;     // куплена в этот ход
  reloading: number;  // ходов владельца до следующего выстрела (AWP)
  blind: number;
  blindMode: 'skip' | 'random' | null;
  suppressed: number;
  wallbang: boolean;
  sapper: boolean;
  fakeOf: string | null;
  fakeLeft: number;
  lastHit: { by: PlayerIdx; reward: number } | null; // кто ранил последним — для награды
}

export interface Player {
  side: Side;
  agent: string;
  heroHp: number;
  heroMaxHp: number;
  money: number;
  shop: string[];     // что можно купить сейчас (бай-меню из колоды)
  cooldown: { id: string; left: number }[]; // использованные гранаты/снаряжение: вернутся в бай-меню через left своих ходов
  units: Unit[];
  kit: boolean;
  discount: number;   // скидка на следующее оружие (Дроп)
  kills: number;
  spent: number;
  /** Надбавка к доходу за ход (сложность бота). */
  incomeBonus?: number;
}

export type Mode = 'bomb' | 'duel';
export type EndReason = 'bomb' | 'defuse' | 'kill' | 'time' | 'ninja';

export interface RowFx { smoke: number; fire: number; fireDmg: number; fireBy: PlayerIdx | null }

export interface Bomb { timer: number; fake: boolean }
export interface Defuse { sapper: string; left: number; ninja?: { prev: number | null } } // ninja: быстрый дефьюз, prev — прогресс до него

export type GameEvent =
  | { t: 'damage'; id: string; amount: number; hs?: boolean }
  | { t: 'heal'; id: string; amount: number }
  | { t: 'block'; id: string }
  | { t: 'death'; id: string; owner: PlayerIdx }
  | { t: 'money'; player: PlayerIdx; amount: number; why: string }
  | { t: 'buy'; player: PlayerIdx; cardId: string }
  | { t: 'wild'; id: string }
  | { t: 'fakeout'; owner: PlayerIdx }
  | { t: 'fakeExpire'; owner: PlayerIdx }
  | { t: 'plant' }
  | { t: 'fake' }
  | { t: 'defuseStart' }
  | { t: 'defuseReset' }
  | { t: 'boom' }
  | { t: 'defused' };

export interface GameState {
  mode: Mode;
  map: string;
  players: [Player, Player];
  rows: RowFx[];          // эффекты на рядах 0…6
  current: PlayerIdx;
  half: number;           // общий ход (ход любого игрока)
  winner: PlayerIdx | null;
  reason: EndReason | null;
  bomb: Bomb | null;
  defuse: Defuse | null;
  defuseSaved: number | null;
  log: string[];
  events: GameEvent[];
  seq: number;
  rng: number;
}

/** 'h0'/'h1' — герои, иначе uid карты. */
export type CharId = string;

export type Action =
  | { type: 'buy'; cardId: string; row?: RowIdx; target?: CharId }
  | { type: 'move'; unit: string; to: RowIdx }
  | { type: 'attack'; unit: string; target: CharId }
  | { type: 'plant'; unit: string }
  | { type: 'defuse'; unit: string }
  | { type: 'end' };
