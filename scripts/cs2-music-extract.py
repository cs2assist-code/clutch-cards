#!/usr/bin/env python3
"""Фоновая музыка из установленной CS2 → public/snd/music (нужны Python 3.9+ и ffmpeg в PATH).

  python3 scripts/cs2-music-extract.py "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo"
  python3 scripts/cs2-music-extract.py "<…>/game/csgo" --list      # только показать, какие звуки нашлись

Что берётся:
  menu.mp3        — музыка главного меню из стандартных наборов музыки Valve (sounds/music/valve_*/mainmenu);
  map_<карта>.mp3 — фон карты: самый длинный звук окружения/музыки, в пути которого есть имя карты
                    (dust2, inferno, mirage, nuke, ancient, anubis, cache). Если для карты ничего не нашлось,
                    ей достаётся другой трек из наборов музыки Valve, чтобы у каждой карты был свой.
Треки обрезаются до 100 с, с плавным началом и концом, громкость выравнивается; mp3 64 кбит/с.
Источники записываются в public/snd/music/index.json (поле src) — для титров.
Музыку сторонних авторов (платные музыкальные наборы) скрипт не трогает: только наборы valve_*.
"""
import json, os, re, struct, subprocess, sys

def parse(path):
    d = open(path, 'rb').read()
    sig, ver, treesz = struct.unpack_from('<III', d, 0)
    assert sig == 0x55aa1234, hex(sig)
    off = 28 if ver == 2 else 12
    end = off + treesz
    def rs():
        nonlocal off
        e = d.index(b'\0', off); s = d[off:e].decode('utf-8', 'replace'); off = e + 1; return s
    out = []
    while True:
        ext = rs()
        if not ext: break
        while True:
            p = rs()
            if not p: break
            while True:
                n = rs()
                if not n: break
                crc, pre, arc, eo, el, term = struct.unpack_from('<IHHIIH', d, off); off += 18
                off += pre
                full = (p + '/' if p.strip() != '' else '') + n + '.' + ext
                out.append(dict(path=full, arc=arc, off=eo, len=el, pre=pre, dataoff=None if arc != 0x7fff else end + eo))
    return out, d

def decode_vsnd(d):
    rsz = struct.unpack_from('<I', d, 0)[0]
    bo = 8 + struct.unpack_from('<I', d, 8)[0]; n = struct.unpack_from('<I', d, 12)[0]
    blocks = {}
    for i in range(n):
        p = bo + i * 12
        blocks[d[p:p + 4]] = (p + 4 + struct.unpack_from('<I', d, p + 4)[0], struct.unpack_from('<I', d, p + 8)[0])
    off, sz = blocks.get(b'DATA', (0, 0))
    if sz >= 32:
        pk, = struct.unpack_from('<I', d, off); rate = pk & 0xFFFF; kind = (pk >> 16) & 0xFF; ch = (pk >> 24) or 1
        size, = struct.unpack_from('<I', d, off + 28); audio = d[rsz:rsz + size]
    else:
        c = d[blocks[b'CTRL'][0]:][:blocks[b'CTRL'][1]] if b'CTRL' in blocks else b''
        kind = 0 if b'PCM16' in c else 1 if b'PCM8' in c else 2 if b'MP3' in c else -1
        rate, ch, audio = 44100, 2, d[rsz:]
    inp = {0: ['-f', 's16le', '-ar', str(rate), '-ac', str(ch)], 1: ['-f', 'u8', '-ar', str(rate), '-ac', str(ch)], 2: ['-f', 'mp3']}.get(kind)
    return inp, audio

if len(sys.argv) < 2:
    print(__doc__); sys.exit(1)
game = sys.argv[1]
LIST = '--list' in sys.argv
entries, dirdata = parse(os.path.join(game, 'pak01_dir.vpk'))
snd = [e for e in entries if e['path'].endswith('.vsnd_c')]
by = {e['path']: e for e in snd}

def read(e):
    if e['arc'] == 0x7fff:
        return dirdata[e['dataoff']:e['dataoff'] + e['len']]
    with open(os.path.join(game, 'pak01_%03d.vpk' % e['arc']), 'rb') as fh:
        fh.seek(e['off']); return fh.read(e['len'])

MAPS = {'dust2': ['dust2', 'de_dust', 'dust'], 'inferno': ['inferno'], 'mirage': ['mirage'], 'nuke': ['nuke'],
        'ancient': ['ancient'], 'anubis': ['anubis'], 'cache': ['cache']}
SKIP = re.compile(r'/(vo|weapons|player|physics|items|ui|buttons|commander|bot)/', re.I)
PREFER = re.compile(r'(loop|amb|music|bg|tone|wind|room|theme)', re.I)
valve_kits = sorted({m.group(1) for e in snd for m in [re.match(r'sounds/music/(valve_[^/]+)/', e['path'])] if m})
kit_tracks = [e for e in snd if re.match(r'sounds/music/valve_[^/]+/(mainmenu|startround_0\d|startaction_0\d|chooseteam|wonround|deathcam)', e['path'])]
menu = [e for e in snd if re.match(r'sounds/music/valve_[^/]+/mainmenu', e['path'])]
menu.sort(key=lambda e: (0 if 'valve_csgo_01' in e['path'] else 1, -e['len']))

def map_candidates(keys):
    out = []
    for e in snd:
        p = e['path'].lower()
        if SKIP.search(p) or not p.startswith('sounds/'): continue
        if any(k in p for k in keys): out.append(e)
    out.sort(key=lambda e: (0 if PREFER.search(e['path']) else 1, -e['len']))
    return out

picks = {}
if menu: picks['menu'] = menu[0]
used = {picks['menu']['path']} if menu else set()
for mid, keys in MAPS.items():
    c = [e for e in map_candidates(keys) if e['path'] not in used and e['len'] > 60_000]
    if c: picks['map_' + mid] = c[0]; used.add(c[0]['path'])
# картам без своего фона — разные треки наборов Valve
spare = [e for e in sorted(kit_tracks, key=lambda e: -e['len']) if e['path'] not in used]
for mid in MAPS:
    if 'map_' + mid not in picks and spare:
        e = spare.pop(0); picks['map_' + mid] = e; used.add(e['path'])

if LIST:
    print('Наборы музыки Valve:', ', '.join(valve_kits) or 'не найдены')
    print('Меню:', *(e['path'] for e in menu[:5]), sep='\n  ')
    for mid, keys in MAPS.items():
        print(f'{mid}:', *(f"{e['path']}  ({e['len'] // 1024} КБ)" for e in map_candidates(keys)[:8]), sep='\n  ')
    print('\nВыбрано:', *(f'{k}: {e["path"]}' for k, e in picks.items()), sep='\n  ')
    sys.exit(0)

dst_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'snd', 'music')
os.makedirs(dst_dir, exist_ok=True)
index = []
for name, e in picks.items():
    inp, audio = decode_vsnd(read(e))
    if inp is None:
        print('неизвестный формат, пропуск:', e['path']); continue
    dst = os.path.join(dst_dir, name + '.mp3')
    af = 'atrim=0:100,afade=t=in:d=2,loudnorm=I=-20:TP=-2,areverse,afade=t=in:d=3,areverse'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inp, '-i', '-', '-af', af, '-ar', '44100', '-ac', '2', '-b:a', '64k', dst], input=audio, check=True)
    index.append({'name': name, 'src': e['path']})
    print(f'{name}.mp3  ←  {e["path"]}')
json.dump(index, open(os.path.join(dst_dir, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'Готово: {len(index)} треков в public/snd/music')
