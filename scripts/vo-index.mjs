// Составляет списки звуковых файлов (запускается перед dev и build):
//   public/snd/vo/index.json   — радиофразы (в т.ч. в подпапках агентов)
//   public/snd/shot/index.json — выстрелы оружия
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
function index(dir, label) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  const walk = (d, pre) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, `${pre}${f}/`);
      else if (/\.(mp3|ogg|wav)$/i.test(f)) out.push(pre + f);
    }
  };
  walk(dir, '');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(out, null, 1));
  console.log(`${label}: ${out.length} файлов`);
}
index('public/snd/vo', 'голос');
index('public/snd/shot', 'выстрелы');
