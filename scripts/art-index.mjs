// Список готовых портретов бойцов (public/img/u_<t|ct>_<id>.webp) → src/hs/art-index.ts.
// Запускается перед dev/build и в standalone.sh; новая картинка подхватывается сама.
import { readdirSync, writeFileSync } from 'node:fs';
const keys = readdirSync(new URL('../public/img/', import.meta.url)).map((f) => f.match(/^u_((?:t|ct)_[a-z0-9]+)\.webp$/)?.[1]).filter(Boolean).sort();
writeFileSync(new URL('../src/hs/art-index.ts', import.meta.url),
  `// Создаётся scripts/art-index.mjs — не править руками.\nexport const UNIT_ART = new Set<string>(${JSON.stringify(keys)});\n`);
console.log(`art-index: ${keys.length} портретов`);
