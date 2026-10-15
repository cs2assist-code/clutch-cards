// Проверка друзей, вызова на дуэль, «занят», реванша и недавних соперников через WebSocket.
//   bun tests/online-social.ts ws://localhost:8790/ws   (сервер с ALLOW_DEV=1)
const URL = process.argv[2] ?? 'ws://localhost:8790/ws';
const AG = { T: 't_phoenix', CT: 'ct_sas' };
type M = any;
function client(name: string) {
  const ws = new WebSocket(URL); const q: M[] = []; let waiters: ((m: M) => void)[] = [];
  ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); q.push(m); waiters.forEach((w) => w(m)); };
  const ready = new Promise((r) => (ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', dev: name, name })); r(0); }));
  const tx = (m: M) => ws.send(JSON.stringify(m));
  const wait = (t: string, f: (m: M) => boolean = () => true) => new Promise<M>((res, rej) => {
    const i = q.findIndex((m) => m.t === t && f(m)); if (i >= 0) { res(q.splice(i, 1)[0]); return; }
    const to = setTimeout(() => rej(new Error(`${name}: no ${t}`)), 8000);
    const w = (m: M) => { if (m.t === t && f(m)) { clearTimeout(to); q.splice(q.indexOf(m), 1); waiters = waiters.filter((x) => x !== w); res(m); } };
    waiters.push(w);
  });
  return { ready, tx, wait, ws };
}
const S = Date.now().toString(36);
const A = client('alice' + S), B = client('bob' + S);
await A.ready; await B.ready;
const ma = await A.wait('me'), mb = await B.wait('me');
A.tx({ t: 'friend_add', id: mb.me.id });
const fr = await A.wait('friends'); console.log('friends', fr.friends.map((f: M) => `${f.name} online=${f.online}`));
A.tx({ t: 'player', id: mb.me.id }); const pl = await A.wait('player'); console.log('player', pl.me.name, pl.online, pl.friend, pl.h2h);
// decline
A.tx({ t: 'invite', id: mb.me.id, agents: AG }); console.log('status', (await A.wait('invite_status')).state);
const inv1 = await B.wait('invited'); console.log('invited from', inv1.from.name);
B.tx({ t: 'invite_answer', code: inv1.code, accept: false }); console.log('after decline', (await A.wait('invite_status', (m) => m.state !== 'sent')).state);
// accept
A.tx({ t: 'invite', id: mb.me.id, agents: AG }); await A.wait('invite_status');
const inv2 = await B.wait('invited');
B.tx({ t: 'invite_answer', code: inv2.code, accept: true, agents: AG });
const fa = await A.wait('found'), fb = await B.wait('found'); console.log('found', fa.ranked, fa.opp.name, fa.opp.id === mb.me.id, fb.opp.name);
// busy check: third client invites bob
const C = client('carol' + S); await C.ready; await C.wait('me');
C.tx({ t: 'invite', id: mb.me.id, agents: AG }); console.log('carol→bob', (await C.wait('invite_status')).state);
A.tx({ t: 'resign' }); const oa = await A.wait('over'); await B.wait('over'); console.log('over winner(A view)', oa.winner, oa.reason, 'ranked', oa.ranked);
A.tx({ t: 'rematch', agents: AG }); console.log('A rematch', (await A.wait('rematch')).state, 'B gets', (await B.wait('rematch')).state);
B.tx({ t: 'rematch', agents: AG }); const r2 = await A.wait('found'); await B.wait('found'); console.log('rematch found', r2.opp.name);
A.tx({ t: 'resign' }); await A.wait('over');
A.tx({ t: 'friends' }); const fr2 = await A.wait('friends'); console.log('recent', fr2.recent.map((r: M) => r.name));
const ok = fr.friends.length === 1 && pl.friend && fa.ranked === false && fa.opp.id === mb.me.id && r2.opp.name.startsWith('bob') && fr2.recent.some((r: M) => r.name.startsWith('bob'));
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
