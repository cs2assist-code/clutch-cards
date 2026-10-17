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
# Картинки нужны сразу. Голоса и выстрелы — JSON-блоки в конце файла: браузер их не выполняет как скрипт,
# а разбирает только при первом обращении (в начале партии), поэтому меню открывается быстрее.
lazy = '''Object.defineProperty(window,'__%s',{configurable:true,get(){var e=document.getElementById('__%s');var v=e?JSON.parse(e.textContent):undefined;Object.defineProperty(window,'__%s',{value:v});return v}});'''
mus_dir = pathlib.Path('public/snd/music')
music = {f.stem: 'data:audio/mpeg;base64,' + base64.b64encode(f.read_bytes()).decode() for f in sorted(mus_dir.glob('*.mp3'))} if mus_dir.exists() else {}
pre = '<script>window.__CARD_IMG=' + json.dumps(imgs) + ';' + lazy % ('VO', 'vo', 'VO') + lazy % ('SHOT', 'shot', 'SHOT') + (lazy % ('MUSIC', 'music', 'MUSIC') if music else '') + '</script>'
post = ('<script type="application/json" id="__music">' + json.dumps(music) + '</script>' if music else '') + '<script type="application/json" id="__vo">' + json.dumps(vo).replace('</', '<\\/') + '</script><script type="application/json" id="__shot">' + json.dumps(shot).replace('</', '<\\/') + '</script>'
html = pathlib.Path('index.html').read_text()
html = html.replace('<script type="module" src="/src/main.ts"></script>', pre + '<script type="module">' + js.replace('</script', '<\\/script') + '</script>' + post)
html = html.replace('</head>', '<style>' + css + '</style>\n</head>')
pathlib.Path('dist-standalone.html').write_text(html)
print('ok', len(html))
# Вариант для публикации артефактом (без обёртки html/head и без SDK Telegram)
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap">'
boot = re.search(r'<style>\s*html, body.*?</small></div></div>', html, re.S).group(0)
art = '<meta charset="utf-8">\n<title>Клатч</title>\n' + fonts + '\n<style>' + css + '</style>\n' + boot + '\n' + pre + '\n<script type="module">' + js.replace('</script', '<\\/script') + '</script>\n' + post + '\n'
pathlib.Path('.standalone/artifact.html').write_text(art)
PY
