// Собирает все русские строки интерфейса из исходников (строки и куски шаблонов, без комментариев),
// режет их по HTML-тегам и подстановкам ${…} и сверяет со словарём src/i18n/en.ts.
//   node scripts/i18n-extract.mjs            — показать, каких фраз нет в словаре
//   node scripts/i18n-extract.mjs --json     — вывести все фразы JSON-ом (для пополнения словаря)
// Нужен пакет typescript (npm i -D typescript или глобально).
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require(join(process.env.HOME ?? '', '.npm-global/lib/node_modules/typescript')); }

const FILES = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'i18n') walk(p); } else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) FILES.push(p); } };
walk('src'); FILES.push('server/server.ts');
const CYR = /[А-Яа-яЁё]/;
// не переводим: старый режим src/game (кроме имён агентов и карт), аналитика сервера
const keys = new Set();
const from = new Map();   // фраза → файл (для отладки: --from)
for (const f of FILES) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const add = (text) => {
    // значения подсказок внутри тегов (title, placeholder…) — отдельными фразами
    const attrs = [...text.matchAll(/(?:title|placeholder|aria-label|alt)="([^"$]*)/g)].map((m) => m[1]);
    for (let piece of [...attrs, ...text.split(/<[^>]*>|[<>"]/)]) {
      piece = piece.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (f.startsWith('src/game/') && piece.length > 40) continue;   // описания старого режима не показываются
      if (/=>|\bconst |\bfunction\b|\/\/|\{ |\breturn\b/.test(piece)) continue;   // куски кода из шаблонов
      if (CYR.test(piece)) { keys.add(piece); if (!from.has(piece)) from.set(piece, f); }
    }
  };
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) { add(n.head.text); for (const sp of n.templateSpans) add(sp.literal.text); }
    else if (ts.isCallExpression(n) && /console\.(log|error|warn)/.test(n.expression.getText(sf))) return;   // журналы сервера не переводим
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const all = [...keys].sort((a, b) => a.localeCompare(b, 'ru'));
if (process.argv.includes('--from')) { for (const k of [...keys]) console.log(from.get(k) + '\t' + k); process.exit(0); }
if (process.argv.includes('--json')) { console.log(JSON.stringify(all, null, 1)); process.exit(0); }
const enSrc = readFileSync('src/i18n/en.ts', 'utf8');
const have = new Set([...enSrc.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm)].map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, '$1')));
const up = (k) => k.charAt(0).toUpperCase() + k.slice(1);
const miss = all.filter((k) => k.length > 1 && !have.has(k) && !have.has(up(k)));
console.log(`фраз: ${all.length}, в словаре: ${all.length - miss.length}, нет перевода: ${miss.length}`);
for (const k of miss.slice(0, 400)) console.log('  ' + k);
if (process.argv.includes('--strict') && miss.length) process.exit(1);
