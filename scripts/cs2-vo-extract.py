#!/usr/bin/env python3
"""Извлекает радиофразы, выстрелы и звуки бомбы из установленной CS2 в public/snd/vo и public/snd/shot (нужны Python 3.9+ и ffmpeg в PATH).

  python3 scripts/cs2-vo-extract.py "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo"

Читает pak01_dir.vpk и нужные куски pak01_NNN.vpk напрямую, звук vsnd_c (PCM16 / PCM8 / MP3)
перекодируется в mp3 22 кГц моно с обрезкой тишины. Раскладка ключей — CLASSIC / BOT / FM ниже.
"""
import json,os,re,struct,subprocess,sys
def parse(path):
    d=open(path,'rb').read()
    sig,ver,treesz=struct.unpack_from('<III',d,0)
    assert sig==0x55aa1234,hex(sig)
    off=28 if ver==2 else 12
    end=off+treesz
    def rs():
        nonlocal off
        e=d.index(b'\0',off); s=d[off:e].decode('utf-8','replace'); off=e+1; return s
    out=[]
    while True:
        ext=rs()
        if not ext: break
        while True:
            p=rs()
            if not p: break
            while True:
                n=rs()
                if not n: break
                crc,pre,arc,eo,el,term=struct.unpack_from('<IHHIIH',d,off); off+=18
                preload=d[off:off+pre]; off+=pre
                full=(p+'/' if p.strip()!='' else '')+n+'.'+ext
                out.append(dict(path=full,arc=arc,off=eo,len=el,pre=len(preload),crc=crc,dataoff=None if arc!=0x7fff else end+eo))
    return out,d

def decode_vsnd(d):
    """vsnd_c → (аргументы ffmpeg для сырого звука, байты звука). Старый формат — двоичный DATA, новый — KV3 в CTRL."""
    rsz=struct.unpack_from('<I',d,0)[0]
    bo=8+struct.unpack_from('<I',d,8)[0]; n=struct.unpack_from('<I',d,12)[0]
    blocks={}
    for i in range(n):
        p=bo+i*12
        blocks[d[p:p+4]]=(p+4+struct.unpack_from('<I',d,p+4)[0], struct.unpack_from('<I',d,p+8)[0])
    off,sz=blocks.get(b'DATA',(0,0))
    if sz>=32:
        pk,=struct.unpack_from('<I',d,off); rate=pk&0xFFFF; kind=(pk>>16)&0xFF; ch=(pk>>24) or 1
        size,=struct.unpack_from('<I',d,off+28); audio=d[rsz:rsz+size]
    else:
        # KV3 (сжатый двоичный): имя формата читается как строка, частота и каналы — по умолчанию 44100 Гц стерео
        c=d[blocks[b'CTRL'][0]:][:blocks[b'CTRL'][1]] if b'CTRL' in blocks else b''
        kind=0 if b'PCM16' in c else 1 if b'PCM8' in c else 2 if b'MP3' in c else -1
        rate,ch,audio=44100,2,d[rsz:]
    inp={0:['-f','s16le','-ar',str(rate),'-ac',str(ch)],1:['-f','u8','-ar',str(rate),'-ac',str(ch)],2:['-f','mp3']}.get(kind)
    return inp,audio

def convert(d,dst,af,rate='22050',br='48k'):
    inp,audio=decode_vsnd(d)
    if inp is None: print('неизвестный формат',dst); return
    os.makedirs(os.path.dirname(dst),exist_ok=True)
    subprocess.run(['ffmpeg','-v','error','-y',*inp,'-i','-','-af',af,'-ar',rate,'-ac','1','-b:a',br,dst],input=audio,check=True)

def peak(d):
    inp,audio=decode_vsnd(d)
    m=subprocess.run(['ffmpeg',*inp,'-i','-','-af','volumedetect','-f','null','-'],input=audio,capture_output=True).stderr.decode()
    return float(re.search(r'max_volume: ([-\d.]+)',m).group(1))

TRIM='silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse'

game=sys.argv[1] if len(sys.argv)>1 else '.'
root=sys.argv[2] if len(sys.argv)>2 else os.path.join(os.path.dirname(__file__),'..','public','snd')
out=os.path.join(root,'vo')
e,_=parse(os.path.join(game,'pak01_dir.vpk'))
idx={x['path']:x for x in e}
CLASSIC={'go':['radio_letsgo'],'fireinhole':['{s}_grenade'],'flash':['{s}_flashbang'],'smoke':['{s}_smoke'],
 'molotov':['{s}_molotov'],'enemydown':['enemydown'],'enemyspotted':['radio_enemyspotted'],'niceshot':['niceshot'],
 'takingfire':['radio_takingfire'],'needbackup':['radio_needbackup'],'clutch':['lastmanstanding']}
BOT={'go':['radiobotgo'],'fireinhole':['{s}_grenade'],'flash':['{s}_flashbang'],'smoke':['{s}_smoke'],
 'molotov':['{s}_molotov'],'enemydown':['radiobotkill'],'enemyspotted':['radiobottarget'],'niceshot':['radiobotniceshot'],
 'takingfire':['radiobotunderfire'],'needbackup':['coverme'],'clutch':[]}
def FM(p): return {'go':[p+'_round_start'],'fireinhole':[p+'_throwing_grenade'],'flash':[p+'_throwing_flashbang'],
 'smoke':[p+'_throwing_smoke'],'molotov':[p+'_throwing_molotov',p+'_throwing_fire'],'enemydown':[p+'_i_killed_enemy'],
 'enemyspotted':[p+'_sees_enemy'],'niceshot':[p+'_compliment'],'takingfire':[p+'_takingfire'],
 'needbackup':[p+'_request_backup'],'clutch':[p+'_last_unit_alive']}
AG={'ct_swat':('swat',BOT),'ct_seal':('seal',CLASSIC),'ct_fbi':('fbihrt',BOT),'ct_sas':('sas',CLASSIC),
    'ct_gign':('gendarmerie_male',FM('fm1')),'t_phoenix':('phoenix',CLASSIC),'t_elite':('leet',CLASSIC),
    't_balkan':('balkan',CLASSIC),'t_guerrilla':('jungle_male',FM('afm1')),'t_pro':('professional',BOT)}
N=3
def find(folder,stem):
    pre=f'sounds/vo/agents/{folder}/'
    r=re.compile('^'+re.escape(stem)+r'_?\d+[a-z]?$')
    out=[]
    for p in idx:
        if p.startswith(pre) and p.endswith('.vsnd_c'):
            n=p[len(pre):-7].replace('.','_')
            if r.match(n): out.append(p)
    return sorted(out)
sel=[]
for ag,(folder,M) in AG.items():
    s='ct' if ag.startswith('ct') else 't'
    for k,pats in M.items():
        fs=[]
        for p in pats: fs+=find(folder,p.format(s=s))
        if not fs: print('MISSING',ag,k,file=sys.stderr)
        for i,f in enumerate(fs[:N]): sel.append((f'{ag}/{k}{"" if i==0 else i+1}.mp3',f))
for k in CLASSIC:
    fs=[]
    for folder,s in (('sas','ct'),('phoenix','t'),('seal','ct')):
        f=find(folder,CLASSIC[k][0].format(s=s))
        if f: fs.append(f[0])
    for i,f in enumerate(fs): sel.append((f'{k}{"" if i==0 else i+1}.mp3',f))
for k in ['bombpl','bombdef','ctwin','terwin']:
    sel.append((f'{k}.mp3',f'sounds/vo/announcer/cs2_classic/{k}.vsnd_c'))

def read(f):
    x=idx[f]
    with open(os.path.join(game,'pak01_%03d.vpk'%x['arc']),'rb') as fh:
        fh.seek(x['off']); return fh.read(x['len'])

for o,f in sel: convert(read(f),os.path.join(out,o),TRIM)
print('голос:',len(sel),'файлов в',out)

# ── Выстрелы: public/snd/shot/<id карты>.mp3, варианты <id>_2.mp3 ──
W='sounds/weapons/'
M={'glock':['glock18/glock_01','glock18/glock_02'],'usp':['usp/usp_01','usp/usp_02'],'usp_us':['usp/usp_unsilenced_01','usp/usp_unsilenced_02'],
'p2000':['hkp2000/hkp2000_01','hkp2000/hkp2000_02'],'p250':['p250/p250_01'],'deagle':['deagle/deagle_01','deagle/deagle_02'],
'elites':['elite/elites_01','elite/elites_02'],'fiveseven':['fiveseven/fiveseven_01'],'tec9':['tec9/tec9_02'],'cz75':['cz75a/cz75_01','cz75a/cz75_02'],
'r8':['revolver/revolver-1_01'],'mac10':['mac10/mac10_01','mac10/mac10_02'],'mp9':['mp9/mp9_01','mp9/mp9_02'],'ump45':['ump45/ump45_02'],
'mp5sd':['mp5/mp5_01'],'mp7':['mp7/mp7_01','mp7/mp7_02'],'bizon':['bizon/bizon_01','bizon/bizon_02'],'p90':['p90/p90_01','p90/p90_02'],
'nova':['nova/nova-1'],'mag7':['mag7/mag7_01','mag7/mag7_02'],'sawedoff':['sawedoff/sawedoff-1'],'xm1014':['xm1014/xm1014-1'],
'galil':['galilar/galil_01','galilar/galil_02'],'famas':['famas/famas_01','famas/famas_03'],'ak47':['ak47/ak47_01','ak47/ak47_02'],
'm4a4':['m4a1/m4a1_01','m4a1/m4a1_02'],'m4a1s':['m4a1/m4a1_silencer_01'],'m4a1s_us':['m4a1/m4a1_us_01','m4a1/m4a1_us_02'],
'sg553':['sg556/sg556_01','sg556/sg556_02'],'aug':['aug/aug_01','aug/aug_02'],'ssg':['ssg08/ssg08_01'],'awp':['awp/awp_01','awp/awp_02'],
'scar20':['scar20/scar20_01','scar20/scar20_02'],'g3sg1':['g3sg1/g3sg1_01','g3sg1/g3sg1_02'],'negev':['negev/negev_01','negev/negev_02'],
'm249':['m249/m249_01','m249/m249_02'],'zeus':['taser/taser_shoot'],'knife':['knife/knife_slash1','knife/knife_slash2','knife/knife_stab']}
LONG={'awp','ssg','scar20','g3sg1','negev','deagle','r8'}
n=0
for k,l in M.items():
    for i,s_ in enumerate(l):
        f=W+s_+'.vsnd_c'
        if f not in idx: print('нет файла',f); continue
        d=read(f); dur=0.6 if k=='knife' else 2.4 if k in LONG else 1.7
        af=f'silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{dur},afade=t=out:st={dur-0.45}:d=0.45,volume={-1.5-peak(d)}dB'
        convert(d,os.path.join(root,'shot',f'{k}{"" if i==0 else "_"+str(i+1)}.mp3'),af,'44100','80k'); n+=1
print('выстрелы:',n,'файлов')

# ── Бомба C4: public/snd/shot/c4_*.mp3 ──
C4=[('c4_plant','c4_plant',None),('c4_arm','c4_initiate',None),('c4_beep','c4_beep2',None),('c4_beep_fast','c4_beep3',None),
    ('c4_defuse_start','c4_disarmstart',None),('c4_defuse','c4_disarmfinish',None),('c4_boom','c4_explode1',4.5)]
C4+=[('c4_key' if i==1 else f'c4_key_{i}',f'key_press{i}',None) for i in range(1,8)]
for k,src,dur in C4:
    f='sounds/weapons/c4/'+src+'.vsnd_c'
    if f not in idx: print('нет файла',f); continue
    d=read(f); af=f'volume={-1.5-peak(d)}dB'+(f',atrim=0:{dur},afade=t=out:st={dur-1.2}:d=1.2' if dur else '')
    convert(d,os.path.join(root,'shot',k+'.mp3'),af,'44100','96k' if k=='c4_boom' else '80k')
print('бомба:',len(C4),'файлов')

# ── Диктор вето (онлайн): public/snd/shot/ann_*.mp3 ──
ANN=['ban_1_map','pick_ancient','pick_dust2','pick_inferno','pick_mirage','pick_nuke','start_ct_side','start_t_side','waiting']
for k in ANN:
    f='sounds/vo/announcer/cs2_classic/felix_broken_fang_'+k+'.vsnd_c'
    if f not in idx: print('нет файла',f); continue
    convert(read(f),os.path.join(root,'shot','ann_'+k+'.mp3'),TRIM)
print('диктор:',len(ANN),'файлов')
