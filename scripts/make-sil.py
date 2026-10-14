# Силуэты оружия и предметов для килфида и значков классов (как иконки в CS2).
# Из public/img/<id>.webp (картинка с прозрачностью) делает белый силуэт public/img/sil_<id>.webp,
# обрезанный по краям, высотой 64 px. Запуск: python3 scripts/make-sil.py
import pathlib
from PIL import Image
D = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'img'
SKIP = ('agent_', 'board_', 'map_', 'u_', 'back_', 'sil_')
n = 0
for f in sorted(D.glob('*.webp')):
    if f.stem.startswith(SKIP): continue
    im = Image.open(f)
    if im.mode != 'RGBA': continue
    a = im.getchannel('A').point(lambda v: 255 if v > 90 else 0)
    box = a.getbbox()
    if not box: continue
    a = a.crop(box)
    h = 64; w = max(8, round(a.width * h / a.height))
    if w > 200: w = 200; h = max(8, round(a.height * w / a.width))
    a = a.resize((w, h), Image.LANCZOS)
    out = Image.new('RGBA', a.size, (255, 255, 255, 0)); out.putalpha(a)
    white = Image.new('RGBA', a.size, (255, 255, 255, 255)); white.putalpha(a)
    white.save(D / f'sil_{f.stem}.webp', lossless=True)
    n += 1
print('силуэтов:', n)
