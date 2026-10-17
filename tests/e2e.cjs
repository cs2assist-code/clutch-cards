// Проверка в браузере (Playwright + Chromium): обучение проходится до конца, игра с ботом доигрывается до экрана MVP,
// по ходу нет ошибок JavaScript.   BASE=http://127.0.0.1:5183/ node tests/e2e.cjs
// Сборку для проверки можно поднять так: bun build src/main.ts --outdir .check/assets … (см. .github/workflows/ci.yml)
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.env.BASE ?? 'http://127.0.0.1:5183/';
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

async function page(b) {
  const pg = await (await b.newContext({ viewport: { width: 420, height: 860 } })).newPage();
  pg.setDefaultTimeout(5000);
  await pg.route(/telegram\.org|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('clutch_lang', 'ru'); } catch {} });   // тексты проверяем по-русски
  return pg;
}

async function tutorial(b) {
  const pg = await page(b);
  await pg.goto(BASE + '?t=1');
  await pg.click('[data-act="tutorial"]');
  await pg.waitForSelector('.tut.on');
  let last = '', steps = 0, done = false;
  for (let i = 0; i < 120 && !done; i++) {
    const t = await pg.$eval('.tut.on p', (e) => e.textContent).catch(() => '');
    if (t && t !== last) { last = t; steps++; }
    if (/^Основы/.test(t)) { done = true; break; }
    const next = await pg.$('.tut.on [data-act="hs-tutnext"]');
    if (next) { await next.click(); await pg.waitForTimeout(250); continue; }
    const hl = await pg.$$('.tut-hl:not([data-act="hs-tutnext"])');
    if (hl.length && t) {
      const cls = (await hl[0].getAttribute('class')) || '';
      if (/hs-board/.test(cls)) { const slot = await pg.$('.hs-slot'); if (slot) await slot.click({ force: true }); }
      else await hl[0].click({ force: true });
      await pg.waitForTimeout(600); continue;
    }
    await pg.waitForTimeout(500);
  }
  console.log(`обучение: ${steps} подсказок, ${done ? 'дошли до конца' : 'НЕ дошли до конца'}; последняя: ${last.slice(0, 60)}`);
  if (!done) fail('обучение не пройдено');
  if (pg.errs.length) fail('ошибки в обучении: ' + pg.errs.join('; '));
}

async function botGame(b) {
  const pg = await page(b);
  await pg.goto(BASE + '?r=1#autoplay&fast');
  await pg.click('[data-act="hs-enter"]');
  await pg.click('[data-act="hs-go"]');
  for (let n = 0; n < 40; n++) {
    if (await pg.$('[data-act="hs-pickside"], [data-act="hs-knife-go"]')) break;
    const all = await pg.$$('.kn-move:not([disabled])');
    if (all.length === 3) await all[n % 3].click().catch(() => {});
    await pg.waitForTimeout(400);
  }
  if (await pg.$('[data-act="hs-pickside"]')) await pg.click('[data-act="hs-pickside"][data-v="CT"]'); else await pg.click('[data-act="hs-knife-go"]');
  await pg.click('[data-act="hs-keep"]');
  await pg.waitForSelector('.mvp', { timeout: 240000 });
  const res = await pg.$eval('.hs-ovbox', (e) => e.innerText.split('\n')[0]);
  console.log('игра с ботом: доиграна, итог —', res);
  if (pg.errs.length) fail('ошибки в игре с ботом: ' + pg.errs.join('; '));
}

(async () => {
  const b = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try { await tutorial(b); await botGame(b); } catch (e) { fail(e.message); }
  await b.close();
})();
