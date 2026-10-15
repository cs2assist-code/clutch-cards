# Сводка баланса из файлов scripts/balance.ts (JSON по строке на игру): python3 scripts/balance-report.py out*.jsonl
import json, sys, collections, math
G = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
n = len(G)
def ci(w, n): return 196 * math.sqrt(max(w / n * (1 - w / n), 1e-9) / n)
tw = sum(g['w'] == 0 for g in G)
print(f'Игр: {n} · T побеждает {100*tw/n:.1f}% (±{ci(tw,n):.1f}) · по бомбе {100*sum(g["r"]=="bomb" for g in G)/n:.1f}% · разминирование {100*sum(g["r"]=="defuse" for g in G)/n:.1f}% · средняя длина {sum(g["turns"] for g in G)/n/2:.1f} хода каждого')
ag = collections.defaultdict(lambda: [0, 0])
for g in G: ag[g['t']][0] += 1; ag[g['t']][1] += g['w'] == 0; ag[g['ct']][0] += 1; ag[g['ct']][1] += g['w'] == 1
print('\nАгенты (процент побед):')
for a, (c, w) in sorted(ag.items(), key=lambda x: -x[1][1] / x[1][0]): print(f'  {a:12s} {100*w/c:5.1f}%  ±{ci(w,c):.1f}  ({c})')
T = sorted({g['t'] for g in G}); C = sorted({g['ct'] for g in G})
pair = collections.defaultdict(lambda: [0, 0])
for g in G: p = pair[(g['t'], g['ct'])]; p[0] += 1; p[1] += g['w'] == 0
print('\nПары: процент побед T (строки) против CT (столбцы):')
print(' ' * 13 + ''.join(f'{c[3:]:>8s}' for c in C))
for t in T: print(f'  {t:11s}' + ''.join(f'{100*pair[(t,c)][1]/max(pair[(t,c)][0],1):7.0f}%' for c in C))
mp = collections.defaultdict(lambda: [0, 0])
for g in G: mp[g['map']][0] += 1; mp[g['map']][1] += g['w'] == 0
print('\nКарты (локации), победы T: ' + ' · '.join(f'{m} {100*w/c:.0f}%' for m, (c, w) in sorted(mp.items())))
# карты колоды: процент побед стороны, сыгравшей карту, против побед стороны без неё (тот же агент)
cw = collections.defaultdict(lambda: [0, 0]); base = collections.defaultdict(lambda: [0, 0])
for g in G:
    for p, agent in ((0, g['t']), (1, g['ct'])):
        win = g['w'] == p
        base[agent][0] += 1; base[agent][1] += win
        for c in g['cards'][p]: cw[(c, agent)][0] += 1; cw[(c, agent)][1] += win
card = collections.defaultdict(lambda: [0, 0.0, 0])   # игр, сумма (wr_с_картой - wr_агента)*игр
for (c, a), (cn, cwn) in cw.items():
    bn, bw = base[a]
    card[c][0] += cn; card[c][1] += (cwn / cn - bw / bn) * cn; card[c][2] += cwn
rows = [(c, v[0], 100 * v[1] / v[0], 100 * v[2] / v[0]) for c, v in card.items() if v[0] >= max(60, n * 0.02)]
rows.sort(key=lambda r: -r[2])
print('\nКарты, которые сильнее всего влияют на победу (сыграна → насколько чаще побеждает этот же агент):')
for c, cnt, d, wr in rows[:12]: print(f'  +{d:4.1f}  {c:12s} побед {wr:4.1f}%  в {100*cnt/n/2:.0f}% партий стороны')
print('…и слабее всего:')
for c, cnt, d, wr in rows[-10:]: print(f'  {d:+5.1f}  {c:12s} побед {wr:4.1f}%  в {100*cnt/n/2:.0f}% партий стороны')
