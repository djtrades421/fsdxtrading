# Results data generator

Turns TradingView "List of trades" exports into `results-data.js`, which feeds
results.html (all tabs), playbook.html (eval data) and the figures marked
`<!--gen:...-->` on results.html and autotrader.html.

## Refresh the data

1. Export each profile from the TradingView Strategy Tester (Deep Backtesting,
   full range → List of trades → Export). One CSV per variant × risk setting.
2. Save them in `data/` (e.g. `knightfall-v1-400.csv`, `knightfall-v2-250.csv`). Files there are public downloads.
3. In `results-config.json`, point each setting at its CSV and set `end` to the
   last trade date to publish. Every profile is cut at that same date.
   A `null` path keeps that setting's published numbers unchanged.
4. Run from the site root:

       python3 tools/build_results.py --config tools/results-config.json --out results-data.js

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

Not covered yet (edit by hand on a refresh): the JSON-LD block and the
`<noscript>` tables in results.html, and "1,100+" rounded counts.
