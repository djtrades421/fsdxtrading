#!/usr/bin/env python3
"""FSD-X results data generator.

TradingView Strategy Tester export (CSV, "List of trades") -> the data blocks
results.html renders (D, P, X, XP, RPD, RPY) for one risk profile.

Usage:
  python3 build_results.py --config results-config.json --out results-data.json

The config lists one export per variant x risk profile. See README in this folder.
"""
import csv, json, math, sys, argparse, statistics
from datetime import datetime, date, timedelta
from collections import defaultdict, OrderedDict

MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C']


def r2(x, n=2):
    return float(f"{x:.{n}f}")


def fmt_d(d):
    return d.strftime('%b %d, %Y')


# ───────────────────────── load ─────────────────────────
def load_trades(path, end=None):
    rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    by = defaultdict(dict)
    for r in rows:
        k = 'exit' if r['Type'].startswith('Exit') else 'entry'
        by[int(r['Trade number'])][k] = r
    out = []
    for n in sorted(by):
        e, x = by[n]['entry'], by[n]['exit']
        sig = e['Signal']
        grade = None
        for g in GRADES:  # longest first matters: 'A+' before 'A'
            if f' {g} ' in sig + ' ' or sig.endswith(' ' + g):
                grade = g
                break
        t = dict(
            n=n,
            dir='Long' if 'long' in e['Type'].lower() else 'Short',
            et=datetime.strptime(e['Date and time'], '%Y-%m-%d %H:%M'),
            xt=datetime.strptime(x['Date and time'], '%Y-%m-%d %H:%M'),
            grade=grade,
            qty=float(e['Size (qty)']),
            pnl=float(x['Net PnL USD']),
            mae=float(x['Adverse excursion USD'] or 0),
            mfe=float(x['Favorable excursion USD'] or 0),
            exit_sig=x['Signal'],
        )
        t['d'] = t['xt'].date()
        out.append(t)
    if end:
        out = [t for t in out if t['d'] <= end]
    return out


# ───────────────────────── core stats (D) ─────────────────────────
def closed_dd(T):
    eq = pk = dd = 0.0
    for t in T:
        eq += t['pnl']; pk = max(pk, eq); dd = min(dd, eq - pk)
    return dd


def tv_dd(T):
    """TradingView-style: deepest point inside a trade (adverse excursion) vs the closed-trade peak."""
    eq = pk = dd = 0.0
    for t in T:
        dd = min(dd, eq + min(t['mae'], 0) - pk)
        eq += t['pnl']; pk = max(pk, eq); dd = min(dd, eq - pk)
    return dd


def basic(T):
    w = [t['pnl'] for t in T if t['pnl'] > 0]
    l = [t['pnl'] for t in T if t['pnl'] < 0]
    gp, gl = sum(w), -sum(l)
    n = len(T)
    return dict(n=n, w=len(w), l=len(l), be=n - len(w) - len(l), net=sum(w) + sum(l),
                gp=gp, gl=gl, pf=(gp / gl if gl else 0), ev=(sum(w) + sum(l)) / n if n else 0,
                avgwin=(gp / len(w) if w else 0), avgloss=(-gl / len(l) if l else 0))


def streaks(T):
    """Win/loss runs (breakevens break both)."""
    runs = []  # (sign, length)
    cur, ln = 0, 0
    for t in T:
        s = 1 if t['pnl'] > 0 else -1 if t['pnl'] < 0 else 0
        if s == cur and s != 0:
            ln += 1
        else:
            if cur: runs.append((cur, ln))
            cur, ln = s, (1 if s else 0)
    if cur: runs.append((cur, ln))
    return runs


def monthly(T):
    m = OrderedDict()
    for t in T:
        k = t['d'].strftime('%Y-%m')
        m[k] = m.get(k, 0) + t['pnl']
    return m


def window(T, tf):
    if tf == '7yr':
        return list(T)
    last = T[-1]['d']
    cut = date(last.year - 2, last.month, min(last.day, 28) if (last.month, last.day) == (2, 29) else last.day)
    return [t for t in T if t['d'] > cut]


def build_D(T):
    b = basic(T)
    rs = streaks(T)
    mv = list(monthly(T).values())
    dd = closed_dd(T)
    grades = []
    for g in GRADES:
        G = [t for t in T if t['grade'] == g]
        if not G: continue
        x = basic(G)
        grades.append(dict(g=g, n=x['n'], win=round(100 * x['w'] / x['n'], 1), pf=round(x['pf'], 2), net=round(x['net'])))
    annual = []
    for y in sorted({t['d'].year for t in T}):
        Y = [t for t in T if t['d'].year == y]
        x = basic(Y)
        annual.append(dict(yr=str(y), trades=x['n'], wins=x['w'], losses=x['l'], win=round(100 * x['w'] / x['n'], 1),
                           pf=round(x['pf'], 2), net=round(x['net']), dd=round(closed_dd(Y))))
    direction = []
    for name, S in (('Long', [t for t in T if t['dir'] == 'Long']), ('Short', [t for t in T if t['dir'] == 'Short']), ('All', T)):
        x = basic(S)
        direction.append(dict(d=name, n=x['n'], w=x['w'], l=x['l'], win=round(100 * x['w'] / x['n'], 1),
                              pf=round(x['pf'], 2), ev=round(x['ev'], 2), net=round(x['net'])))
    return dict(trades=b['n'], wins=b['w'], losses=b['l'], be=b['be'], net=round(b['net']),
                win=round(100 * b['w'] / b['n'], 2), pf=round(b['pf'], 2), ev=round(b['ev'], 2),
                avgwin=round(b['avgwin']), avgloss=round(b['avgloss']), maxdd=round(dd), tvdd=round(tv_dd(T)),
                tvpf=round(b['pf'], 3), mcw=max([l for s, l in rs if s > 0], default=0),
                mcl=max([l for s, l in rs if s < 0], default=0), profmon=sum(1 for v in mv if v > 0),
                totmon=len(mv), avgmon=round(statistics.mean(mv)),
                sharpe=round(statistics.mean(mv) / statistics.stdev(mv), 3) if len(mv) > 1 else 0,
                recov=round(b['net'] / -dd, 1) if dd else 0, grades=grades, annual=annual, direction=direction,
                first=fmt_d(T[0]['d']), last=fmt_d(T[-1]['d']))


# ───────────────────────── seasonal + runs (X) ─────────────────────────
def _bucket(T):
    x = basic(T)
    return dict(n=x['n'], net=round(x['net']), avg=round(x['ev'], 2), win=round(100 * x['w'] / x['n'], 1))


def build_seasonal(T):
    def grp(keyf, order):
        g = defaultdict(list)
        for t in T: g[keyf(t)].append(t)
        return {k: _bucket(g[k]) for k in order if g.get(k)}
    return dict(
        few=None,
        month=grp(lambda t: MON[t['d'].month - 1], MON),
        quarter=grp(lambda t: 'Q%d' % ((t['d'].month - 1) // 3 + 1), ['Q1', 'Q2', 'Q3', 'Q4']),
        dow=grp(lambda t: DOW[t['d'].weekday()] if t['d'].weekday() < 5 else 'Sat', DOW),
        week=grp(lambda t: 'W%d' % ((t['d'].day - 1) // 7 + 1), ['W1', 'W2', 'W3', 'W4', 'W5']),
        heat={k: round(v) for k, v in monthly(T).items()},
    )


def episodes(T):
    """Closed-trade drawdown episodes: peak -> trough -> recovery (new high)."""
    eps, pk, pkd, pki, cur = [], 0.0, T[0]['d'], -1, None
    eq = 0.0
    for i, t in enumerate(T):
        eq += t['pnl']
        if eq > pk:
            if cur:
                cur['recd'], cur['reci'] = t['d'], i
                eps.append(cur); cur = None
            pk, pkd, pki = eq, t['d'], i
        elif eq < pk:
            if cur is None:
                cur = dict(pk=pk, pkd=pkd, pki=pki, tr=eq, trd=t['d'], tri=i)
            if eq < cur['tr']:
                cur['tr'], cur['trd'], cur['tri'] = eq, t['d'], i
    if cur: eps.append(cur)
    n = len(T)
    for x in eps:
        x['depth'] = x['pk'] - x['tr']
        x['rec'] = (x['recd'] - x['trd']).days if 'recd' in x else 0
        x['ntr'] = (x.get('reci', n - 1)) - x['pki']
    return eps


def build_runs(T, D):
    eps = episodes(T)
    dds = sorted(eps, key=lambda x: -x['depth'])[:10]
    climbs = []
    for a, b in zip(eps, eps[1:]):
        climbs.append(dict(gain=b['pk'] - a['tr'], s=a['trd'], e=b['pkd'], tr=b['pki'] - a['tri']))
    rs = streaks(T)
    def runhist(sign):
        L = [l for s, l in rs if s == sign]
        bk = [('1', 1, 1), ('2', 2, 2), ('3', 3, 3), ('4', 4, 4), ('5', 5, 5), ('6-7', 6, 7), ('8+', 8, 10**9)]
        out = []
        for lab, lo, hi in bk:
            c = sum(1 for l in L if lo <= l <= hi)
            if c: out.append([lab, c])
        return out
    wl = [l for s, l in rs if s > 0]; ll = [l for s, l in rs if s < 0]
    mv = monthly(T)
    ml = [(datetime.strptime(k, '%Y-%m').strftime('%b %Y'), round(v)) for k, v in mv.items()]
    return dict(
        climbs=[dict(gain=round(c['gain']), start=fmt_d(c['s']), end=fmt_d(c['e']), days=(c['e'] - c['s']).days,
                     trades=c['tr']) for c in sorted(climbs, key=lambda c: -c['gain'])[:10]],
        dds=[dict(depth=round(x['depth']), pk=fmt_d(x['pkd']), tr=fmt_d(x['trd']), down=(x['trd'] - x['pkd']).days,
                  rec=x['rec'], trades=x['ntr']) for x in dds],
        ndd=len(eps), nclimb=len(climbs),
        medrec=round(statistics.median([x['rec'] for x in eps if 'recd' in x and x['rec'] > 0] or [0])),
        meddd=round(statistics.median([x['depth'] for x in eps])),
        medclimb=round(statistics.median([c['gain'] for c in climbs])),
        winruns=runhist(1), lossruns=runhist(-1),
        maxws=max(wl), maxwsn=wl.count(max(wl)), maxls=max(ll), maxlsn=ll.count(max(ll)),
        posmon=sum(1 for v in mv.values() if v > 0), totmon=len(mv),
        bestmon=[list(m) for m in sorted(ml, key=lambda m: -m[1])[:5]],
        worstmon=[list(m) for m in sorted(ml, key=lambda m: m[1])[:5]],
        yeardd=[[a['yr'], a['dd'], a['net']] for a in D['annual']],
    )


def build_X(T):
    return dict(seasonal=build_seasonal(T), runs=build_runs(T, build_D(T)))


# ───────────────────────── what to expect (XP) ─────────────────────────
def build_XP(T):
    day = OrderedDict()
    for t in T: day[t['d']] = day.get(t['d'], 0) + t['pnl']
    ds, pv = list(day), list(day.values())
    first, last = ds[0], ds[-1]
    # rolling calendar windows [s, s+w) with s+w < last day
    def roll(w):
        vals, starts, s = [], [], first
        while s + timedelta(days=w) < last:
            e = s + timedelta(days=w)
            vals.append(sum(v for d, v in day.items() if s <= d < e)); starts.append(s)
            s += timedelta(days=1)
        return vals, starts
    windows, yr30 = [], []
    for w in (30, 60, 90):
        vals, starts = roll(w)
        windows.append(dict(w=w, n=len(vals), negpct=round(100 * sum(1 for v in vals if v < 0) / len(vals), 1),
                            med=round(statistics.median(vals)), worst=round(min(vals)), best=round(max(vals))))
        if w == 30:
            by = OrderedDict()
            for s, v in zip(starts, vals): by.setdefault(s.year, []).append(v)
            yr30 = [[str(y), round(min(v)), sum(1 for a in v if a < 0)] for y, v in by.items()]
    eq, pk, uw = [], 0.0, 0
    run = 0.0
    for v in pv:
        run += v; eq.append(run)
        pk = max(pk, run)
        if run < pk: uw += 1
    def maxrun(b):
        m = c = 0
        for x in b:
            c = c + 1 if x else 0; m = max(m, c)
        return m
    wk = OrderedDict()
    for d, v in day.items():
        k = d.isocalendar()[:2]; wk[k] = wk.get(k, 0) + v
    wv = list(wk.values())
    green, red = sum(1 for v in pv if v > 0), sum(1 for v in pv if v < 0)
    # trading days between new equity highs
    his, best = [], 0.0
    for i, e in enumerate(eq):
        if e > best and e > 0:
            his.append(i); best = e
    gaps = [b - a for a, b in zip(his, his[1:])] or [0]
    gaps_sorted = sorted(gaps)
    def pct(a, q):  # numpy 'linear' percentile
        k = (len(a) - 1) * q; f = math.floor(k); c = min(f + 1, len(a) - 1)
        return a[f] + (a[c] - a[f]) * (k - f)
    # worst month to start: trading days until back above the starting balance
    ws, wsd, seen = 0, ds[0], set()
    for i, d in enumerate(ds):
        m = (d.year, d.month)
        if m in seen: continue
        seen.add(m)
        base = eq[i - 1] if i else 0.0
        j = i
        while j < len(eq) and eq[j] <= base: j += 1
        if j - i + 1 > ws: ws, wsd = j - i + 1, d
    nd, nw = len(ds), len(wv)
    return dict(windows=windows, days=nd, uwpct=round(100 * uw / nd, 1), uw=uw, green=green, red=red,
                greenpct=round(100 * green / nd), redpct=round(100 * red / nd), maxred=maxrun([v < 0 for v in pv]),
                weeks=nw, redwk=sum(1 for v in wv if v < 0), redwkpct=round(100 * sum(1 for v in wv if v < 0) / nw),
                maxredwk=maxrun([v < 0 for v in wv]), worstwk=round(min(wv)), worststart=ws,
                worststartfrom=wsd.strftime('%b %Y'), medgap=round(statistics.median(gaps)),
                p90gap=round(pct(gaps_sorted, 0.9)), yr30=yr30)


# ───────────────────────── equity curve SVG (P) ─────────────────────────
def build_P(T):
    W, H = 1000, 240
    t0, tn = T[0]['xt'], T[-1]['xt']
    span = (tn - t0).total_seconds() or 1
    eq, e = [], 0.0
    for t in T:
        e += t['pnl']; eq.append(e)
    mn, mx = min(eq), max(eq)
    rng = (mx - mn) or 1
    pts = ['%.1f,%.1f' % ((t['xt'] - t0).total_seconds() / span * W, 235 - (v - mn) / rng * 230) for t, v in zip(T, eq)]
    line = 'M' + pts[0] + ''.join(' L' + p for p in pts[1:])
    area = line + ' L%d,%d L0,%d Z' % (W, H, H)
    ticks = ''
    for y in range(t0.year + 1, tn.year + 1):
        x = round((datetime(y, 1, 1) - t0).total_seconds() / span * W)
        ticks += ('<line x1="%d" y1="0" x2="%d" y2="%d" stroke="rgba(255,255,255,.06)"/>'
                  '<text x="%d" y="234" fill="#52525b" font-size="10">%d</text>') % (x, x, H, x + 5, y)
    return dict(line=line, area=area, ticks=ticks)


# ───────────────────────── prop eval simulation (RPD / RPY) ─────────────────────────
# EOD trailing drawdown: threshold = highest end-of-day balance - DD, never moves down, fixed during
# the session. Touching it intraday (trade's adverse excursion) fails. Pass = closed balance >= target.
# Next eval starts on the next trade. DLL (optional): when the day's loss incl. the open trade's
# adverse excursion reaches the cap, the trade is liquidated at the cap and the rest of the day is skipped.
ACCOUNTS = OrderedDict([('50k', (3000, 2000, 1200)), ('100k', (6000, 3000, 1800)), ('150k', (9000, 4500, 2700))])


def _sim_from(T, i, yr_end, tgt, dd, dll):
    evals, n = [], len(T)
    while i < n and T[i]['d'] <= yr_end:
        s_d, bal, eodhi, thr, res = T[i]['d'], 0.0, 0.0, -dd, None
        day, daypnl, dllhit = None, 0.0, False
        while i < n:
            t = T[i]
            if t['d'] != day:
                if day is not None:
                    eodhi = max(eodhi, bal); thr = max(thr, eodhi - dd)
                day, daypnl, dllhit = t['d'], 0.0, False
            if dllhit:
                i += 1; continue
            pnl, mae = t['pnl'], min(t['mae'], 0)
            low = mae
            if dll and daypnl + mae <= -dll:
                pnl = max(pnl, -dll - daypnl); low = max(mae, -dll - daypnl); dllhit = True
            i += 1
            if bal + low <= thr:
                res = ('fail', t['d']); break
            bal += pnl; daypnl += pnl
            if bal <= thr:
                res = ('fail', t['d']); break
            if bal >= tgt:
                res = ('pass', t['d']); break
        evals.append(dict(s=s_d, res=res))
    return evals


def build_evals(T, D_annual, acct, dll_on):
    tgt, dd, dl = ACCOUNTS[acct]
    dll = dl if dll_on else 0
    years, done_all = [], []
    netby = {int(a['yr']): a['net'] for a in D_annual}
    for y in sorted({t['d'].year for t in T}):
        si = next(k for k, t in enumerate(T) if t['d'].year == y)
        ev = _sim_from(T, si, date(y, 12, 31), tgt, dd, dll)
        done = [e for e in ev if e['res']]
        p = sum(1 for e in done if e['res'][0] == 'pass')
        row = dict(yr=y, n=len(done), **{'pass': p}, fail=len(done) - p, net=netby.get(y, 0), s0=ev[-1]['s'].strftime('%b %Y'))
        if ev[-1]['res']: row['star'] = ev[-1]['res'][1].strftime('%b %Y')
        else: row['prog'] = True
        years.append(row); done_all += done
    days = [(e['res'][1] - e['s']).days for e in done_all if e['res'][0] == 'pass']
    c = len(done_all)
    agg = dict(completed=c, passes=len(days), fails=c - len(days), passrate=round(100 * len(days) / c) if c else 0,
               median=round(statistics.median(days)) if days else 0, avg=round(statistics.mean(days)) if days else 0,
               fast=min(days) if days else 0, slow=max(days) if days else 0)
    return agg, years


# ───────────────────────── one profile ─────────────────────────
def build_profile(T):
    """All blocks for one variant x risk profile. Returns dict(D,P,X,XP,RPD,RPY) keyed per block."""
    out = dict(D={}, P={}, X={}, XP={}, RPD={a: {} for a in ACCOUNTS}, RPY={a: {} for a in ACCOUNTS})
    for tf in ('7yr', '2yr'):
        W = window(T, tf)
        D = build_D(W)
        out['D'][tf] = D
        out['P'][tf] = build_P(W)
        out['X'][tf] = dict(seasonal=build_seasonal(W), runs=build_runs(W, D))
        out['XP'][tf] = build_XP(W)
        for a in ACCOUNTS:
            ev = {}
            for k in ('off', 'on'):
                agg, years = build_evals(W, D['annual'], a, k == 'on')
                ev[k] = agg
                if tf == '7yr': out['RPY'][a][k] = years
            out['RPD'][a][tf] = dict(strat=dict(trades=D['trades'], net=D['net'], maxdd=D['maxdd'], maxdd_intra=D['tvdd'],
                                                win=D['win'], pf=D['pf'], ev=D['ev']), eval=ev)
    return out


# ───────────────────────── CLI ─────────────────────────
BLOCKS = ('D', 'P', 'X', 'XP', 'RPD', 'RPY')
RISKS = ('250', '400', '500', '650', '850', '1000')


def read_js(path):
    s = open(path, encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def write_js(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('/* Generated by tools/build_results.py — do not edit by hand. */\n')
        f.write('window.FSDX_RESULTS=' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + ';\n')


def put(vdata, risk, prof):
    for b in BLOCKS:
        if b in ('RPD', 'RPY'):
            for a in ACCOUNTS:
                vdata[b].setdefault(a, {})[risk] = prof[b][a]
        else:
            vdata[b][risk] = prof[b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--check', action='store_true', help='regenerate and diff against the existing data instead of writing')
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    base_dir = __import__('os').path.dirname(__import__('os').path.abspath(a.config))
    end = datetime.strptime(cfg['end'], '%Y-%m-%d').date()
    old = read_js(a.out) if __import__('os').path.exists(a.out) else {'variants': {}}
    data = dict(end=cfg['end'], updated=cfg.get('updated', ''), variants=OrderedDict())
    bad = 0
    for vk, vc in cfg['variants'].items():
        prev = old['variants'].get(vk, {})
        vd = OrderedDict(label=vc['label'], short=vc.get('short', vk.upper()), note=vc.get('note', ''),
                         risks=[r for r in RISKS if r in vc['exports']])
        for b in BLOCKS: vd[b] = {}
        for r in vd['risks']:
            src = vc['exports'][r]
            if src:
                T = load_trades(__import__('os').path.join(base_dir, src), end=end)
                prof = build_profile(T)
                print(f"{vk} ${r}: {prof['D']['7yr']['trades']} trades · net ${prof['D']['7yr']['net']:,} · "
                      f"PF {prof['D']['7yr']['pf']} · DD ${-prof['D']['7yr']['maxdd']:,} · {prof['D']['7yr']['first']} – {prof['D']['7yr']['last']}")
                if a.check and prev:
                    old_prof = {b: (prev[b][r] if b not in ('RPD', 'RPY') else {ac: prev[b][ac][r] for ac in ACCOUNTS}) for b in BLOCKS}
                    n = sum(_diff(prof[b], old_prof[b], f'{vk}.{r}.{b}') for b in BLOCKS)
                    print('   check:', 'identical' if n == 0 else f'{n} differences'); bad += n
                put(vd, r, prof)
            else:  # no export given: carry the published numbers forward unchanged
                if not prev or r not in prev.get('risks', []):
                    sys.exit(f'{vk} ${r}: no export and nothing published to carry forward')
                put(vd, r, {b: (prev[b][r] if b not in ('RPD', 'RPY') else {ac: prev[b][ac][r] for ac in ACCOUNTS}) for b in BLOCKS})
                print(f'{vk} ${r}: carried forward (net ${prev["D"][r]["7yr"]["net"]:,})')
        data['variants'][vk] = vd
    if a.check:
        sys.exit(1 if bad else 0)
    write_js(a.out, data)
    print('wrote', a.out)
    root = __import__('os').path.dirname(__import__('os').path.abspath(a.out))
    patch_pages(data, [__import__('os').path.join(root, f) for f in cfg.get('pages', [])])


# ───────────────────────── static page figures ─────────────────────────
# Any page can carry generated figures between markers:  <!--gen:v1.400.net-->$100,991<!--/gen-->
# key = variant.risk[.2yr].field   or   meta.end | meta.end_short | meta.updated
import re as _re
_GEN = _re.compile(r'(<!--gen:([\w.]+)-->)(.*?)(<!--/gen-->)', _re.S)


def _fmt(field, v):
    if field in ('trades', 'wins', 'losses', 'be', 'mcw', 'mcl', 'profmon', 'totmon'):
        return f'{v:,}'
    if field in ('net', 'avgwin', 'avgmon'):
        return ('-$' if v < 0 else '$') + f'{abs(v):,}'
    if field in ('maxdd', 'tvdd', 'avgloss'):
        return '-$' + f'{abs(v):,}'
    if field == 'win':
        return f'{v:.2f}%'
    if field in ('pf', 'ev'):
        return (f'${v:.2f}' if field == 'ev' else f'{v:.2f}')
    if field == 'tvpf':
        return f'{v:.3f}'
    if field in ('sharpe',):
        return f'{v:.3f}'
    if field == 'recov':
        return f'{v:.1f}x'
    return str(v)


def gen_value(data, key):
    parts = key.split('.')
    if parts[0] == 'meta':
        end = datetime.strptime(data['end'], '%Y-%m-%d').date()
        return {'end': end.strftime('%B ') + str(end.day) + end.strftime(', %Y'),
                'end_short': end.strftime('%b ') + str(end.day) + end.strftime(', %Y'),
                'updated': data.get('updated', '')}[parts[1]]
    v, r = parts[0], parts[1]
    tf = parts[2] if len(parts) == 4 else '7yr'
    field = parts[-1]
    return _fmt(field, data['variants'][v]['D'][r][tf][field])


def patch_pages(data, paths):
    for path in paths:
        s = open(path, encoding='utf-8').read()
        n = [0]
        def rep(m):
            n[0] += 1
            return m.group(1) + gen_value(data, m.group(2)) + m.group(4)
        s2 = _GEN.sub(rep, s)
        if s2 != s:
            open(path, 'w', encoding='utf-8').write(s2)
        print(f'patched {path}: {n[0]} figures' + ('' if s2 != s else ' (no change)'))


def _diff(a, b, p=''):
    if isinstance(a, dict) and isinstance(b, dict):
        return sum(_diff(a.get(k), b.get(k), p + '.' + k) for k in set(a) | set(b))
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return sum(_diff(x, y, f'{p}[{i}]') for i, (x, y) in enumerate(zip(a, b)))
    if a != b:
        print('   diff', p, str(a)[:80], '|', str(b)[:80]); return 1
    return 0


if __name__ == '__main__':
    main()
