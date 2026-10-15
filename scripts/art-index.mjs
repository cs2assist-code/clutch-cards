// Список готовых портретов бойцов (public/img/u_<t|ct>_<id>.webp) → src/hs/art-index.ts.
// Запускается перед dev/build и в standalone.sh; новая картинка подхватывается сама.
import { readdirSync, writeFileSync } from 'node:fs';
const files = readdirSync(new URL('../public/img/', import.meta.url));
const keys = files.map((f) => f.match(/^u_((?:t|ct)_[a-z0-9]+)\.webp$/)?.[1]).filter(Boolean).sort();
const ui = files.map((f) => f.match(/^ui_([a-z0-9_]+)\.webp$/)?.[1]).filter(Boolean).sort();
const sil = files.map((f) => f.match(/^sil_([a-z0-9_]+)\.webp$/)?.[1]).filter(Boolean).sort();
writeFileSync(new URL('../src/hs/art-index.ts', import.meta.url),
  `// Создаётся scripts/art-index.mjs — не править руками.\nexport const UNIT_ART = new Set<string>(${JSON.stringify(keys)});\n/** Силуэты оружия и предметов (scripts/make-sil.py). */\nexport const SIL = new Set<string>(${JSON.stringify(sil)});\n/** Оформление (ui_*.webp): ключевой арт меню и т. п. — подхватывается, если файл есть. */\nexport const UI_IMG = new Set<string>(${JSON.stringify(ui)});\n`);
console.log(`art-index: ${keys.length} портретов`);
