// Проверка сервера: два бота играют друг с другом через WebSocket (рейтинговая очередь или дуэль).
//   bun server/server.ts &   затем   bun server/test-bots.ts [ws://localhost:8790/ws] [games=1] [duel]
// Боты видят только то, что сервер им прислал (свою руку и открытый стол), и ходят тем же ботом, что и офлайн.
import { botStep } from '../src/hs/ai';
import type { HState } from '../src/hs/engine';
import type { C2S, S2C } from '../src/online/protocol';

const URL = process.argv[2] ?? 'ws://localhost:8790/ws';
const GAMES = Number(process.argv[3] ?? 1);
const DUEL = process.argv[4] === 'duel';
const AG = [{ T: 't_phoenix', CT: 'ct_sas' }, { T: 't_balkan', CT: 'ct_swat' }];

function bot(name: string, idx: number, onCode?: (c: string) => void, joinCode?: Promise<string>) {
  return new Promise<{ name: string; result: S2C | null; steps: number; denies: number; leaks: number }>((resolve) => {
    const ws = new WebSocket(URL);
    const tx = (m: C2S) => ws.send(JSON.stringify(m));
    let started = false;
    let knifeMsgs = 0;
    let view: HState | null = null, steps = 0, denies = 0, leaks = 0, busy = false;
    const think = () => {
      if (!view || busy || view.turn !== 0 || view.winner !== null) return;
      // секреты соперника не должны приходить
      if (view.p[1].hand.some((c) => c.id !== 'hidden') || view.p[1].deck.some((d) => d !== 'hidden')) leaks++;
      const a = botStep(view, 0, 'normal');
      busy = true;
      if (a) tx({ t: 'act', a }); else tx({ t: 'end' });
    };
    ws.onopen = () => tx({ t: 'hello', dev: name, name });
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data)) as S2C;
      switch (m.t) {
        case 'me': if (!started) {
          started = true;
          if (DUEL && onCode) tx({ t: 'duel_create', agents: AG[idx] });
          else if (DUEL && joinCode) tx({ t: 'duel_join', code: await joinCode, agents: AG[idx] });
          else tx({ t: 'queue', agents: AG[idx] });
        } break;
        case 'duel_code': onCode?.(m.code); break;
        case 'knife':
          if (m.pick === 'me') tx({ t: 'side', side: Math.random() < 0.5 ? 'T' : 'CT' });
          else if (!m.picked && m.k.winner === null) setTimeout(() => tx({ t: 'knife', move: (['knife', 'shield', 'zeus'] as const)[Math.floor(Math.random() * 3)] }), 30);
          knifeMsgs++; break;
        case 'veto': if (m.myTurn) { const left = m.maps.filter((x) => !m.banned.some((b) => b.map === x)); tx({ t: 'ban', map: left[0] }); } break;
        case 'start': view = m.view; tx({ t: 'mull', uids: [] }); break;
        case 'begin': view = m.view; busy = false; think(); break;
        case 'step': view = m.view; steps++; busy = false; setTimeout(think, 5); break;
        case 'deny': denies++; busy = false; tx({ t: 'end' }); busy = true; break;
        case 'radio': break;
        case 'over': ws.close(); console.log(name, 'ножевых сообщений', knifeMsgs); resolve({ name, result: m, steps, denies, leaks }); break;
        case 'err': console.log(name, 'err', m.msg); break;
      }
    };
    ws.onclose = () => resolve({ name, result: null, steps, denies, leaks });
  });
}

let bad = false;   // для CI: игра без итога или утечка чужих карт — ошибка
for (let g = 0; g < GAMES; g++) {
  let setCode: (c: string) => void = () => {};
  const code = new Promise<string>((r) => { setCode = r; });
  const t0 = Date.now();
  const [a, b] = await Promise.all([bot('botA', 0, DUEL ? setCode : undefined), bot('botB', 1, undefined, DUEL ? code : undefined)]);
  const ov = (x: typeof a) => (x.result && x.result.t === 'over' ? `${x.result.winner === 0 ? 'победа' : 'поражение'} (${x.result.reason})${x.result.rating ? ` ${x.result.rating.before}→${x.result.rating.after} ${x.result.rating.league}` : ''}` : 'нет итога');
  if (!a.result || !b.result || a.leaks || b.leaks) bad = true;
  console.log(`игра ${g + 1}: ${((Date.now() - t0) / 1000).toFixed(1)}с · A: ${ov(a)}, шагов ${a.steps}, отказов ${a.denies}, утечек ${a.leaks} · B: ${ov(b)}, отказов ${b.denies}, утечек ${b.leaks}`);
}
process.exit(bad ? 1 : 0);
