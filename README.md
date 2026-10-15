# Results data (NinjaTrader)

Knightfall backtest figures come from NinjaTrader 8. One export per variant drives everything.

## Refresh the data

1. In NinjaTrader, run the Strategy Analyzer on MNQ 5-minute with **KnightfallORB v1.3.0 or later**
   (entry names must carry the grade-flags-stop tag, e.g. `L1-A+-F2-S45.25`).
   Settings: the variant, any risk (V2 at $400 is the reference), **Flag Sizing Off, Daily Loss Limit 0**,
   NinjaTrader commission on, slippage 1.
2. Trades tab → right-click → Export. Save as `knightfall-nt-v2-base.csv` (and `knightfall-nt-v1-base.csv` for V1)
   in the site root.
3. Optional but recommended: export one or two check runs (e.g. V2 $400 Flag Sizing On, DLL $625) into
   `nt-checks/` and list them under `checks` in `results-nt.json`.
4. From the site root:

       python3 build_kf.py --config results-nt.json
       python3 build_results.py --config results-config.json --out results-data.js

   `build_kf.py` first rebuilds every check run from the base export and compares it with NinjaTrader trade for
   trade. If anything differs it stops and writes nothing. Then it writes `kf-data.js` (results page and the
   Auto-Trader stat cards), one NinjaTrader-format CSV per setup (`knightfall-<id>.csv`, loads straight into the
   Trade Importer), `equity-curve-r.png` (homepage), and the SEO / no-JS blocks in `results.html`.
   `build_results.py` writes `results-data.js` for the member Playbook's eval simulator.
5. Update `updated` in `results-nt.json`, then push.

Setups, calculator risk levels and the recommended rule live in `results-nt.json`. A new variant = a new base
export plus an entry under `variants` and `setups`.

## How the rebuild works

`rebuild_trades` in `build_results.py` mirrors the strategy: contracts = round(risk ÷ (stop × $2)), then the grade
cut (B 75%, C+/C 50%), then Flag Sizing (half at 2+ flags, never below 1), then the daily loss limit (no new
entries once the day's closed P&L ≤ −DLL). P&L per contract, commission and slippage included, is the same at any
size. Verified Oct 15, 2026 against five NinjaTrader runs. Don't go below about $250 risk: trades that size to 0
can free the strategy to take a trade the base run never saw.

# Legacy: TradingView generator notes

The sections below describe the original TradingView pipeline. `build_results.py` now also reads NinjaTrader exports (see above).

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
