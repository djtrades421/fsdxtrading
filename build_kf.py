#!/usr/bin/env python3
"""Knightfall results page data, from NinjaTrader exports.

  python3 build_kf.py --config results-nt.json

1. Loads one NT Trades-grid export per variant (v1.3.0 tagged entry names).
2. Verifies the rebuild against every NT check export, trade for trade. Stops on any difference.
3. Writes kf-data.js (window.FSDX_KF) for results.html, one trade-list CSV per setup, and
   patches the SEO / no-JS blocks in results.html between <!--gen-block:kf-...--> markers.

R = a trade's per-contract result in points / its own stop in points (sizing-independent).
"""
import argparse, csv, json, os, random, re, sys
from collections import OrderedDict
import build_results as b


def usd(v):
    return ('−$' if v < 0 else '$') + f'{abs(v):,.0f}'


def r_of(t):
    return t['pnl'] / t['qty'] / b.CONTRACT_VALUE / t['stop']


def summary(T, risk=None):
    gp = sum(t['pnl'] for t in T if t['pnl'] > 0)
    gl = -sum(t['pnl'] for t in T if t['pnl'] < 0)
    eq = pk = dd = 0.0
    for t in sorted(T, key=lambda t: t['xt']):
        eq += t['pnl']; pk = max(pk, eq); dd = min(dd, eq - pk)
    s = OrderedDict(trades=len(T), wins=sum(t['pnl'] > 0 for t in T), net=round(sum(t['pnl'] for t in T), 2),
                    pf=round(gp / gl, 2), win=round(sum(t['pnl'] > 0 for t in T) / len(T) * 100, 1), dd=round(dd, 2))
    if risk:
        s['netR'] = round(s['net'] / risk)
        s['ddR'] = round(s['dd'] / risk, 1)
    return s


def rgroup(T):
    R = [r_of(t) for t in T]
    w = [x for x in R if x > 0]; l = [x for x in R if x <= 0]
    return OrderedDict(n=len(T), win=round(len(w) / len(T) * 100, 1), pf=round(sum(w) / -sum(l), 2),
                       avgR=round(sum(R) / len(R), 2),
                       avgPts=round(sum(t['pnl'] / t['qty'] / b.CONTRACT_VALUE for t in T) / len(T), 1))


def check(cfg, bases, root):
    bad = 0
    for c in cfg.get('checks', []):
        nt = b.load_trades(os.path.join(root, c['file']))
        rb = b.rebuild_trades(bases[c['variant']], c['risk'], c['flags'], c['dll'])
        a = {t['et']: t for t in nt}; z = {t['et']: t for t in rb}
        diff = [k for k in set(a) | set(z) if k not in a or k not in z
                or a[k]['qty'] != z[k]['qty'] or abs(a[k]['pnl'] - z[k]['pnl']) > 0.01]
        print(f"check {c['file']}: NT {len(nt)} trades ${sum(t['pnl'] for t in nt):,.2f} · rebuilt "
              f"{len(rb)} ${sum(t['pnl'] for t in rb):,.2f} · {'MATCH' if not diff else f'{len(diff)} DIFFERENT'}")
        bad += len(diff)
    if bad:
        sys.exit('rebuild does not match NinjaTrader — nothing written')


def monte_carlo(R, runs, seed, window, last_sum):
    rnd = random.Random(seed)
    worst, hits = [], 0
    for _ in range(runs):
        x = R[:]; rnd.shuffle(x)
        eq = pk = dd = 0.0
        for v in x:
            eq += v; pk = max(pk, eq); dd = min(dd, eq - pk)
        worst.append(dd)
        s = sum(x[:window]); m = s
        for j in range(window, len(x)):
            s += x[j] - x[j - window]; m = min(m, s)
        hits += m <= last_sum
    worst.sort()
    return round(worst[runs // 2], 1), round(hits / runs * 100)


def _ntm(v):
    return f'(${abs(v):.2f})' if v < 0 else f'${v:.2f}'


def write_trades_csv(path, T, risk):
    """Same layout as a NinjaTrader Strategy Analyzer Trades-grid export, so the site's Trade Importer reads it
    as-is. Rows are the original NT rows with size, P&L, commission and MAE/MFE/ETD scaled to the rebuilt size.
    Entry names carry grade, flag count and stop (pts): L1-A+-F2-S45.25."""
    cols = list(T[0]['raw'].keys())
    cols = [c for c in cols if c]  # NT ends each line with a trailing comma
    cum = 0.0
    with open(path, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(cols)
        for i, t in enumerate(sorted(T, key=lambda t: t['et']), 1):
            r = dict(t['raw']); k = t['qty'] / b._nt_money(r['Qty'])
            cum += t['pnl']
            r['Trade number'] = i; r['Qty'] = t['qty']; r['Profit'] = _ntm(t['pnl']); r['Cum. net profit'] = _ntm(cum)
            for c in ('Commission', 'Clearing Fee', 'Exchange Fee', 'IP Fee', 'NFA Fee', 'MAE', 'MFE', 'ETD'):
                if c in r:
                    r[c] = _ntm(b._nt_money(r[c]) * k)
            w.writerow([r.get(c, '') for c in cols])


def curve_png(path, E, eng):
    """Homepage preview: cumulative R of the engine (sizing-independent). Skipped if matplotlib is missing."""
    try:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt, matplotlib.dates as md
    except ImportError:
        print('matplotlib not installed — equity-curve-r.png not updated'); return
    xs, ys, c = [], [], 0.0
    for t in E:
        c += r_of(t); xs.append(t['xt']); ys.append(c)
    fig, ax = plt.subplots(figsize=(12.1, 3.74), dpi=100)
    bg = '#0A1626'; fig.patch.set_facecolor(bg); ax.set_facecolor(bg)
    ax.plot(xs, ys, color='#F26B21', lw=1.6); ax.fill_between(xs, ys, 0, color='#F26B21', alpha=.10, lw=0)
    for sp in ax.spines.values(): sp.set_visible(False)
    ax.grid(axis='y', color='#1E3150', lw=.8); ax.tick_params(colors='#8098B7', labelsize=11, length=0)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f'{v:+.0f}R' if v else '0R'))
    ax.xaxis.set_major_locator(md.YearLocator()); ax.xaxis.set_major_formatter(md.DateFormatter('%Y'))
    ax.set_title(f"Knightfall engine — cumulative R  ·  {eng['n']:,} trades  ·  NinjaTrader, after costs  ·  hypothetical",
                 color='#C6D3E4', fontsize=13, loc='left', pad=12)
    fig.tight_layout(); fig.savefig(path, facecolor=bg); plt.close(fig)
    print('wrote', os.path.basename(path))


def patch(path, blocks):
    s = open(path, encoding='utf-8').read()
    for name, html in blocks.items():
        pat = re.compile(r'(<!--gen-block:%s-->)(.*?)(<!--/gen-block-->)' % re.escape(name), re.S)
        if not pat.search(s):
            sys.exit(f'{path}: marker gen-block:{name} not found')
        s = pat.sub(lambda m: m.group(1) + html + m.group(3), s, count=1)
    open(path, 'w', encoding='utf-8').write(s)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--config', default='results-nt.json')
    ap.add_argument('--page', default='results.html'); a = ap.parse_args()
    root = os.path.dirname(os.path.abspath(a.config)); cfg = json.load(open(a.config))
    bases = {k: b.load_trades(os.path.join(root, v['base'])) for k, v in cfg['variants'].items()}
    check(cfg, bases, root)

    E = sorted(bases[cfg['engine']], key=lambda t: t['et'])
    eng = rgroup(E)
    eng['wins'] = sum(r_of(t) > 0 for t in E)
    data = OrderedDict(updated=cfg['updated'], version=cfg.get('version', ''),
                       first=E[0]['et'].strftime('%b %-d, %Y'), last=E[-1]['et'].strftime('%b %-d, %Y'),
                       engine_variant=cfg['variants'][cfg['engine']]['label'])
    import datetime as _dt
    d0, d1 = E[0]['et'].date(), E[-1]['et'].date()
    wd = sum(1 for i in range((d1 - d0).days + 1) if (d0 + _dt.timedelta(i)).weekday() < 5)
    data['tpd'] = round(len(E) / wd, 2)
    data['engine'] = eng
    data['sides'] = {d: rgroup([t for t in E if t['dir'] == d]) for d in ('Long', 'Short')}
    years = sorted({t['et'].year for t in E})
    data['years'] = [dict(yr=y, **rgroup([t for t in E if t['et'].year == y])) for y in years]
    data['grades'] = [dict(g=g, **rgroup([t for t in E if t['grade'] == g])) for g in b.GRADES]
    data['flags'] = [dict(f=f, **rgroup([t for t in E if t['flags'] == f])) for f in range(4)]
    mid = 2022
    data['halves'] = [dict(label=f'{years[0]}–{str(mid)[2:]}', **rgroup([t for t in E if t['et'].year <= mid])),
                      dict(label=f'{mid + 1}–{str(years[-1])[2:]}', **rgroup([t for t in E if t['et'].year > mid]))]

    R = [r_of(t) for t in E]
    win = cfg['now']['window']
    last = R[-win:]; last_sum = sum(last)
    roll = [sum(R[j:j + win]) for j in range(len(R) - win + 1)]
    med_dd, pct = monte_carlo(R, cfg['monte_carlo']['runs'], cfg['monte_carlo']['seed'], win, last_sum)
    data['now'] = dict(show=cfg['now']['show'], window=win, R=round(last_sum, 1),
                       win=round(sum(x > 0 for x in last) / win * 100), since=E[-win]['et'].strftime('%b %-d'),
                       worse_before=sum(x < last_sum for x in roll[:-1]), stretches=len(roll),
                       pct=pct, runs=cfg['monte_carlo']['runs'])
    data['plan_R'] = round(abs(med_dd))

    setups = []
    for s in cfg['setups']:
        T = b.rebuild_trades(bases[s['variant']], s['risk'], s['flags'], s['dll'])
        sm = summary(T, s['risk'])
        fn = f"knightfall-{s['id']}.csv"
        write_trades_csv(os.path.join(root, fn), T, s['risk'])
        setups.append(OrderedDict(id=s['id'], name=s['name'], tag=s['tag'], recommended=s['recommended'],
                                  variant=cfg['variants'][s['variant']]['label'], risk=s['risk'], flags=s['flags'],
                                  dll=s['dll'], csv=fn, **sm))
        print(f"{s['name']:12} {sm['trades']} trades · {usd(sm['net'])} ({sm['netR']}R) · PF {sm['pf']} · "
              f"win {sm['win']}% · DD {usd(sm['dd'])} ({sm['ddR']}R)")
    data['setups'] = setups

    c = cfg['calculator']; byid = {s['id']: s for s in cfg['setups']}
    rows = []
    for risk in c['risks']:
        u = byid.get(c['use_setup'].get(str(risk)))
        fl = u['flags'] if u else risk >= c['flags_from']
        dll = u['dll'] if u else int(round(risk * c['dll_mult'] / c['dll_round']) * c['dll_round'])
        rec = summary(b.rebuild_trades(bases[c['variant']], risk, fl, dll))
        off = summary(b.rebuild_trades(bases[c['variant']], risk, False, 0))
        rows.append(OrderedDict(risk=risk, flags=fl, dll=dll, trades=rec['trades'], win=rec['win'], pf=rec['pf'],
                                net=round(rec['net']), dd=round(rec['dd']),
                                off=dict(net=round(off['net']), dd=round(off['dd']), pf=off['pf'])))
    data['calc'] = dict(variant=cfg['variants'][c['variant']]['label'], flags_from=c['flags_from'],
                        dll_mult=c['dll_mult'], rows=rows)
    data['downloads'] = [dict(file=s['csv'], label=f"{s['name']} · {s['tag']}") for s in setups] + \
                        [dict(file=v['base'], label=f"{v['label']} · raw NinjaTrader export") for v in cfg['variants'].values()]

    curve_png(os.path.join(root, 'equity-curve-r.png'), E, eng)

    with open(os.path.join(root, 'kf-data.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generated by build_kf.py from NinjaTrader exports — do not edit by hand. */\n')
        f.write('window.FSDX_KF=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote kf-data.js')

    st = {s['id']: s for s in setups}
    desc = (f"Knightfall backtest on MNQ, {data['first']} to {data['last']}, NinjaTrader with commission and slippage: "
            f"{eng['n']:,} trades, {eng['win']}% win rate, profit factor {eng['pf']} in R. Hypothetical results.")
    meta = (f'<meta name="description" content="{desc}" />\n  <meta property="og:description" content="{desc}" />\n'
            f'  <meta name="twitter:description" content="{desc}" />')
    ld = {"@context": "https://schema.org", "@type": "Dataset", "@id": "https://www.fsdxtrading.com/results.html#backtest",
          "name": "Knightfall (FSD-X ORB PRO) hypothetical backtest — MNQ",
          "description": desc + " Simulated results, not actual trading. Past performance is not indicative of future results.",
          "creator": {"@id": "https://www.fsdxtrading.com/#organization"},
          "temporalCoverage": f"{E[0]['et']:%Y-%m-%d}/{E[-1]['et']:%Y-%m-%d}",
          "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv",
                            "contentUrl": f"https://www.fsdxtrading.com/{d['file']}"} for d in data['downloads']],
          "variableMeasured": [
              {"@type": "PropertyValue", "name": "Trades", "value": eng['n']},
              {"@type": "PropertyValue", "name": "Win rate (simulated)", "value": eng['win'], "unitText": "percent"},
              {"@type": "PropertyValue", "name": "Profit factor in R (simulated)", "value": eng['pf']},
              {"@type": "PropertyValue", "name": "Average result per trade (simulated)", "value": eng['avgR'], "unitText": "R"}]}
    rowsh = ''.join(f"<tr><td>{s['name']} ({s['tag']})</td><td>{s['variant']}, ${s['risk']} risk, Flag Sizing "
                    f"{'on' if s['flags'] else 'off'}, {'DLL $' + str(s['dll']) if s['dll'] else 'no DLL'}</td>"
                    f"<td>{s['win']}%</td><td>{s['pf']}</td><td>{s['netR']}R</td><td>{usd(s['dd'])}</td></tr>" for s in setups)
    nos = (f'<noscript><section class="kf-noscript"><h2>Knightfall backtest — summary</h2><p>Hypothetical backtest, MNQ, '
           f'{data["first"]} to {data["last"]}, NinjaTrader with commission and 1-tick slippage. Engine ({data["engine_variant"]}): '
           f'{eng["n"]:,} trades, {eng["win"]}% win rate, profit factor {eng["pf"]} in R, average {eng["avgR"]:+}R per trade. '
           f'Not actual trading. Past performance is not indicative of future results.</p><table><thead><tr><th>Setup</th>'
           f'<th>Settings</th><th>Win</th><th>PF</th><th>Net</th><th>Max drawdown</th></tr></thead><tbody>{rowsh}</tbody></table>'
           f'</section></noscript>')
    patch(os.path.join(root, a.page), {'kf-meta': meta,
                                       'kf-jsonld': '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False, indent=1) + '</script>',
                                       'kf-noscript': nos})
    print('patched', a.page)


if __name__ == '__main__':
    main()
