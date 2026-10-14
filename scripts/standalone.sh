#!/usr/bin/env bash
# Сборка одного HTML-файла без npm (через bun) — для быстрого демо.
set -e
cd "$(dirname "$0")/.."
(command -v node >/dev/null && node scripts/art-index.mjs || bun scripts/art-index.mjs) >/dev/null
rm -rf .standalone && bun build src/main.ts --outdir .standalone --minify --target browser >/dev/null
python3 - <<'PY'
import pathlib, re
d = pathlib.Path('.standalone')
js = (d/'main.js').read_text()
css = (d/'main.css').read_text() if (d/'main.css').exists() else ''
import base64, json
imgs = {f.stem: 'data:image/webp;base64,' + base64.b64encode(f.read_bytes()).decode() for f in sorted(pathlib.Path('public/img').glob('*.webp'))}
MIME = {'.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'}
vo_dir = pathlib.Path('public/snd/vo')
vo = {str(f.relative_to(vo_dir)).replace('\\', '/'): f'data:{MIME[f.suffix.lower()]};base64,' + base64.b64encode(f.read_bytes()).decode()
      for f in sorted(vo_dir.rglob('*')) if f.suffix.lower() in MIME} if vo_dir.exists() else {}
shot_dir = pathlib.Path('public/snd/shot')
shot = {f.name: f'data:{MIME[f.suffix.lower()]};base64,' + base64.b64encode(f.read_bytes()).decode()
        for f in sorted(shot_dir.glob('*')) if f.suffix.lower() in MIME} if shot_dir.exists() else {}
pre = '<script>window.__CARD_IMG=' + json.dumps(imgs) + ';window.__VO=' + json.dumps(vo) + ';window.__SHOT=' + json.dumps(shot) + '</script>'
html = pathlib.Path('index.html').read_text()
html = html.replace('<script type="module" src="/src/main.ts"></script>', pre + '<script type="module">' + js.replace('</script', '<\\/script') + '</script>')
html = html.replace('</head>', '<style>' + css + '</style>\n</head>')
pathlib.Path('dist-standalone.html').write_text(html)
print('ok', len(html))
# Вариант для публикации артефактом (без обёртки html/head и без SDK Telegram)
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;700&family=Russo+One&family=Yeseva+One&display=swap">'
art = '<title>Клатч</title>\n' + fonts + '\n<style>' + css + '</style>\n<div id="app"></div>\n' + pre + '\n<script type="module">' + js.replace('</script', '<\\/script') + '</script>\n'
pathlib.Path('.standalone/artifact.html').write_text(art)
PY
