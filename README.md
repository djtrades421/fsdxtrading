# Results data generator

Turns TradingView "List of trades" exports into `results-data.js`, which feeds
results.html (all tabs), playbook.html (eval data) and the figures marked
`<!--gen:...-->` on results.html and autotrader.html.

## Refresh the data

1. Export each profile from the TradingView Strategy Tester. Settings for every run:
   Deep Backtesting, full range, Initial capital $1M, **High detalization**.
   Then List of trades → Export. One CSV per variant × risk setting.
2. Save them in the site root as `knightfall-v1-400.csv`, `knightfall-v2-250.csv`, etc. They are public downloads.
3. In `results-config.json`, point each setting at its CSV and set `end` to the
   last trade date to publish. Every profile is cut at that same date.
   A `null` path keeps that setting's published numbers unchanged.
4. Run from the site root:

       python3 build_results.py --config results-config.json --out results-data.js

5. Link any new files on the CSV Data tab, then push.

`--check` regenerates and compares against the current `results-data.js`
without writing (used to prove the generator matches the published numbers —
it reproduces the Sept 2026 $400 profile exactly).

## Static figures on pages

Wrap a number in markers and the generator keeps it current:

    <!--gen:v1.400.net-->$100,991<!--/gen-->
    <!--gen:v2.250.2yr.pf-->1.75<!--/gen-->
    <!--gen:meta.end_short-->Sep 4, 2026<!--/gen-->

Fields: trades, wins, losses, net, win, pf, ev, maxdd, tvdd, avgwin, avgloss,
mcw, mcl, profmon, totmon, sharpe, recov, first, last. Pages to patch are listed
under `pages` in the config.

Whole blocks are rebuilt too, between `<!--gen-block:NAME-->` markers:
the two JSON-LD blocks, the three description meta tags and the `<noscript>`
summary in results.html.

Mixed dates are fine: if only some settings are refreshed, every date line on the
page lists which settings run to which date. Refresh them all to one date when you can.

Not covered (edit by hand): rounded counts like "1,100+".
