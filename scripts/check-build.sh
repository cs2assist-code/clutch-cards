#!/usr/bin/env bash
# Сборка игры в папку .check (как в бою: картинки и звуки отдельными файлами) — для проверки в браузере и в CI.
#   bash scripts/check-build.sh && python3 -m http.server 5183 -d .check
set -e
cd "$(dirname "$0")/.."
node scripts/vo-index.mjs >/dev/null && node scripts/art-index.mjs >/dev/null
rm -rf .check && mkdir -p .check/assets
bun build src/main.ts --outdir .check/assets --minify --target browser >/dev/null
cp -r public/* .check/
python3 - <<'PY'
import pathlib
h = pathlib.Path('index.html').read_text()
h = h.replace('<script type="module" src="/src/main.ts"></script>', '<script type="module" src="./assets/main.js"></script>').replace('</head>', '<link rel="stylesheet" href="./assets/main.css">\n</head>')
pathlib.Path('.check/index.html').write_text(h)
PY
echo "сборка для проверки: .check/"
