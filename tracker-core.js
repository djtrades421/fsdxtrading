// tracker-core.js — shared drawdown / rule math for account trackers.
//
// The DD calculation is subtle (trailing vs end-of-day behave very differently)
// and it now runs in two places: the full tracker cards on accounts.html and the
// compact status strip on dashboard.html. Keeping one implementation here means
// the dashboard can never quietly disagree with the tracker page.
//
// Depends on nothing. Load before the page script:
//   <script src="tracker-core.js"></script>

(function (root) {
  'use strict';

  // P&L for a trade, honouring the copy-trading multiplier
  function pnlOf(t) {
    return (parseFloat(t.netPnl) || 0) * (t.numAccounts || 1);
  }

  // Which journal trades belong to a tracker card
  function cardTrades(card, trades) {
    return (trades || []).filter(function (t) {
      var typeMatch = !card.filterType || t.accountType === card.filterType;
      var nameMatch = !card.filterName || t.accountName === card.filterName;
      return typeMatch && nameMatch;
    });
  }

  // Stable, transitive sort key — exitTime included so same-minute entries
  // don't sort unpredictably and shift the drawdown result between renders.
  function ddKey(t) {
    return (t.date || '') + ' ' + (t.entryTime || '') + ' ' + (t.exitTime || '');
  }

  // Core drawdown walk.
  //
  //  ddType 'eod'  — drops measured against the high-water-mark of DAILY CLOSING
  //                  balances. Intraday swings inside a day do not count. This is
  //                  what Lucid / Tradovate EOD-trailing accounts actually track.
  //  otherwise     — trailing: intraday peak-to-trough on the per-trade curve.
  //
  // Returns { totalPnl, currentDD, maxDD, hwm }. currentDD and maxDD are <= 0.
  function drawdown(card, trades) {
    var sorted = trades.slice().sort(function (a, b) {
      var ka = ddKey(a), kb = ddKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    var equity = 0, peak = 0, maxDD = 0, currentDD = 0, hwm = 0;

    if (card && card.ddType === 'eod') {
      var byDay = {};
      sorted.forEach(function (t) {
        if (t.date) byDay[t.date] = (byDay[t.date] || 0) + pnlOf(t);
      });
      Object.keys(byDay).sort().forEach(function (d) {
        equity += byDay[d];
        if (equity > peak) { peak = equity; hwm = equity; }
        currentDD = equity - peak;
        if (currentDD < maxDD) maxDD = currentDD;
      });
    } else {
      sorted.forEach(function (t) {
        equity += pnlOf(t);
        if (equity > peak) { peak = equity; hwm = equity; }
        currentDD = equity - peak;
        if (currentDD < maxDD) maxDD = currentDD;
      });
    }

    return { totalPnl: equity, currentDD: currentDD, maxDD: maxDD, hwm: hwm };
  }

  // Everything the dashboard strip needs for one tracker card.
  // Percentages are null when the card has no limit configured — a missing
  // limit is not the same as a limit at 0%, and the UI must be able to tell.
  function summary(card, allTrades) {
    var trades = cardTrades(card, allTrades);
    var today = new Date().toISOString().slice(0, 10);
    var dd = drawdown(card, trades);

    var todayPnl = trades.filter(function (t) { return t.date === today; })
                         .reduce(function (s, t) { return s + pnlOf(t); }, 0);
    var todayLoss = Math.abs(Math.min(0, todayPnl));

    var ddLimit  = parseFloat(card.maxDD) || 0;
    var target   = parseFloat(card.profitTarget) || 0;
    var firmDaily = parseFloat(card.firmDaily) || 0;

    var ddPct        = ddLimit > 0 ? Math.min(100, Math.round(Math.abs(dd.currentDD) / ddLimit * 100)) : null;
    var ddRemaining  = ddLimit > 0 ? Math.max(0, ddLimit - Math.abs(dd.currentDD)) : null;
    var targetPct    = target  > 0 ? Math.min(100, Math.round(dd.totalPnl / target * 100)) : null;
    var firmDailyPct = firmDaily > 0 ? Math.min(100, Math.round(todayLoss / firmDaily * 100)) : null;
    var firmDailyRemaining = firmDaily > 0 ? Math.max(0, firmDaily - todayLoss) : null;

    // Same thresholds the tracker page uses, so the colours agree.
    var status = 'green';
    if (targetPct !== null && targetPct >= 100) status = 'complete';
    else if ((ddPct || 0) >= 80 || (firmDailyPct || 0) >= 100) status = 'red';
    else if ((ddPct || 0) >= 50 || (firmDailyPct || 0) >= 80) status = 'yellow';

    return {
      card: card,
      label: card.label || card.name || card.filterName || card.filterType || 'Account',
      tradeCount: trades.length,
      totalPnl: dd.totalPnl,
      todayPnl: todayPnl,
      currentDD: dd.currentDD,
      maxDD: dd.maxDD,
      hwm: dd.hwm,
      ddLimit: ddLimit, ddPct: ddPct, ddRemaining: ddRemaining,
      target: target, targetPct: targetPct,
      firmDaily: firmDaily, firmDailyPct: firmDailyPct, firmDailyRemaining: firmDailyRemaining,
      status: status
    };
  }

  root.FSDXTracker = {
    pnlOf: pnlOf,
    cardTrades: cardTrades,
    drawdown: drawdown,
    summary: summary
  };
})(window);
