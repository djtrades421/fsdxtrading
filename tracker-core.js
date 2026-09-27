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

  // Today's date in the USER'S timezone, as YYYY-MM-DD.
  //
  // Do NOT use new Date().toISOString().slice(0,10) for this. That returns the
  // UTC date, so for anyone west of Greenwich it rolls over early — at 7pm CT
  // it already says tomorrow. Trades are stored with the date from an
  // <input type="date">, which is always local, so a UTC "today" stops matching
  // them for the last five hours of every US trading day. Symptom: Today's P&L
  // and the firm daily-limit bar silently reset to zero in the evening.
  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

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

  // Who the journal's trades are actually filed under, most-used first.
  //
  // Used by the "no trades match this tracker" banner to tell the user which
  // owners DO exist, so a stale filter is a one-click fix instead of a guess.
  // Owner is accountName, falling back to accountType — the same definition
  // cardTrades() filters on.
  //
  // This function was missing for a while and accounts.html called it anyway.
  // It only runs when a card matches nothing, so it stayed invisible until
  // someone deleted an account a tracker pointed at — then renderRow threw
  // mid-map and the whole tracker list rendered blank, which read as "my
  // trackers are gone and new ones won't save".
  function ownersIn(trades) {
    var counts = {};
    (trades || []).forEach(function (t) {
      var name = String((t && (t.accountName || t.accountType)) || '').trim();
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (n) { return { name: n, count: counts[n] }; })
      .sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
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

    // Static drawdown: the floor never moves, so "drawdown" is simply how far
    // below the starting balance the account sits. HWM is still reported.
    if (card && card.ddType === 'static') {
      var eq = 0, low = 0;
      sorted.forEach(function (t) { eq += pnlOf(t); if (eq < low) low = eq; });
      return { totalPnl: equity, currentDD: Math.min(0, equity), maxDD: low, hwm: hwm };
    }

    return { totalPnl: equity, currentDD: currentDD, maxDD: maxDD, hwm: hwm };
  }

  // Drawdown floor (liquidation balance) for a card.
  //   trailing / eod : start + peak P&L − DD limit, never below start − DD
  //   static         : start − DD limit
  //   floorLock      : once the trailing floor reaches this balance it stops
  //                    moving (e.g. 50,100 on a 50K account)
  // Returns null when size or DD limit is missing.
  function floorOf(card, hwm) {
    var start = parseFloat(card.accountSize) || 0;
    var dd = parseFloat(card.maxDD) || 0;
    if (!start || !dd) return null;
    if (card.ddType === 'static') return start - dd;
    var f = start + Math.max(0, hwm || 0) - dd;
    var lock = parseFloat(card.floorLock) || 0;
    if (lock > 0 && f > lock) f = lock;
    return f;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FLEET WARNINGS
  //
  //  Everything the Fleet view and (later) the dashboard pop-up need for one
  //  account: current metrics plus the list of warnings it has tripped.
  //  Pure — no DOM, no fetch — so both surfaces always agree.
  //
  //  Warnings are the member's OWN early lines, not the firm's rules. Copy
  //  says "your limit" / "your line" everywhere; we never claim to know what
  //  a firm has actually done to an account.
  // ══════════════════════════════════════════════════════════════════════

  // Default warning settings. Cards saved before warnings existed have no
  // `alerts` object and get exactly these — the noisier date-based rules
  // start OFF so nobody's page lights up the day this ships.
  var ALERT_DEFAULTS = {
    cushion:     { on: true,  warn: 750, urgent: 400 },
    inactivity:  { on: false, warn: 10,  urgent: 13 },
    pullback:    { on: false, warn: 800, urgent: 1000 },
    dailyLoss:   { on: true,  warn: 60,  urgent: 85 },
    payout:      { on: true,  warn: null },
    consistency: { on: false, warn: 35,  urgent: 40 },
    target:      { on: true,  warn: 500 },
    renewal:     { on: false, warn: 5,   urgent: 1 }
  };

  // Severity order, worst first. 'over' = past the member's firm-side limit.
  var LEVEL_RANK = { over: 0, urgent: 1, payout: 2, heads: 3, info: 4 };

  var STAGES = {
    eval:     'Evaluation',
    queued:   'Passed · queued',
    funded:   'Funded',
    personal: 'Personal',
    archived: 'Archived',
    other:    '—'
  };

  function alertCfg(card, rule) {
    var d = ALERT_DEFAULTS[rule] || {};
    var c = (card.alerts && card.alerts[rule]) || {};
    var out = {};
    for (var k in d) out[k] = d[k];
    for (var j in c) if (c[j] !== undefined && c[j] !== '') out[j] = c[j];
    return out;
  }

  // Stage, with a sensible guess for cards saved before stages existed.
  function stageOf(card, accounts) {
    if (card.stage && STAGES[card.stage]) return card.stage;
    var type = card.filterType;
    if (!type && card.filterName && accounts) {
      for (var i = 0; i < accounts.length; i++) {
        if (accounts[i] && accounts[i].name === card.filterName) { type = accounts[i].accountType; break; }
      }
    }
    if (type === 'Evaluation') return 'eval';
    if (type === 'Funded') return 'funded';
    if (type === 'Personal') return 'personal';
    return 'other';
  }

  // Whole calendar days from a to b (YYYY-MM-DD strings). Timezone-proof:
  // both are parsed as UTC midnight, so DST never shifts the count.
  function daysBetween(a, b) {
    if (!a || !b) return null;
    var pa = a.split('-'), pb = b.split('-');
    var ua = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
    var ub = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    if (isNaN(ua) || isNaN(ub)) return null;
    return Math.round((ub - ua) / 86400000);
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function usd(v) { return '$' + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function sUsd(v) { return (v < 0 ? '−$' : '+$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function niceDate(d) {
    if (!d) return '';
    var p = d.split('-');
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1];
    return m + ' ' + (+p[2]);
  }

  // Main entry point.
  //   card      — tracker card
  //   allTrades — every journal trade
  //   opts      — { today, accounts, journalHasTrades }
  // Returns { m: metrics, alerts: [...] }.
  function fleet(card, allTrades, opts) {
    opts = opts || {};
    var today = opts.today || localDate();
    var trades = cardTrades(card, allTrades);
    var dd = drawdown(card, trades);
    var stage = stageOf(card, opts.accounts);

    var start = num(card.accountSize);
    var ddLimit = num(card.maxDD);
    var target = num(card.profitTarget);
    var payoutLine = num(card.payoutLine);
    var firmDaily = num(card.firmDaily);

    // Payouts come out of the balance but never appear in a trade CSV, so
    // they're logged on the card. Balance = start + trading P&L − withdrawn.
    var payouts = Array.isArray(card.payouts) ? card.payouts : [];
    var withdrawn = payouts.reduce(function (s, p) { return s + num(p.amount); }, 0);
    var lastPayoutDate = payouts.reduce(function (d, p) { return p.date && p.date > d ? p.date : d; }, '');

    var byDay = {};
    trades.forEach(function (t) { if (t.date) byDay[t.date] = (byDay[t.date] || 0) + pnlOf(t); });
    var days = Object.keys(byDay).sort();
    var lastTrade = days.length ? days[days.length - 1] : null;

    var profit = dd.totalPnl - withdrawn;             // relative to start, after payouts
    var balance = start ? start + profit : null;
    var floor = floorOf(card, dd.hwm);
    var cushion = floor !== null && balance !== null ? balance - floor : null;
    var pullback = Math.max(0, dd.hwm - dd.totalPnl);

    // Consistency: best single day as a share of total trading profit.
    var best = 0;
    days.forEach(function (d) { if (byDay[d] > best) best = byDay[d]; });
    var consistency = dd.totalPnl > 0 && best > 0 ? Math.round(best / dd.totalPnl * 100) : null;

    // Trading days counted toward the next payout (since the last one).
    var payoutDays = days.filter(function (d) { return !lastPayoutDate || d > lastPayoutDate; }).length;

    // Inactivity runs off TRADE dates, never upload dates. A day only counts
    // if it cleared the member's minimum (0 = any trade counts).
    var qMin = num(card.qualifyMin);
    var qualDays = days.filter(function (d) { return qMin > 0 ? byDay[d] >= qMin : true; });
    var lastQual = qualDays.length ? qualDays[qualDays.length - 1] : null;
    var anchor = lastQual || card.startDate || (card.createdAt ? String(card.createdAt).slice(0, 10) : null);
    var idleDays = anchor ? Math.max(0, daysBetween(anchor, today)) : null;
    var limitDays = parseInt(card.inactivityDays, 10) || 0;

    var m = {
      stage: stage, trades: trades, tradeCount: trades.length,
      pnl: dd.totalPnl, profit: profit, withdrawn: withdrawn, payoutCount: payouts.length,
      start: start, balance: balance, floor: floor, cushion: cushion, ddLimit: ddLimit,
      hwm: dd.hwm, pullback: pullback, lastTrade: lastTrade, lastQual: lastQual,
      idleDays: idleDays, limitDays: limitDays, consistency: consistency,
      target: target, payoutLine: payoutLine, payoutDays: payoutDays,
      minDays: parseInt(card.minDays, 10) || 0,
      lastSessionPnl: lastTrade ? byDay[lastTrade] : 0,
      unmatched: trades.length === 0 && opts.journalHasTrades && !!(card.filterType || card.filterName)
    };

    var alerts = [];
    function push(rule, id, level, title, detail, fp) {
      var cfg = (card.alerts && card.alerts[rule]) || {};
      alerts.push({ rule: rule, id: id || rule, level: level, title: title, detail: detail || '',
                    note: cfg.note || '', fp: String(fp) });
    }
    var lvl = function (v, warn, urgent, higherIsWorse) {
      warn = parseFloat(warn); urgent = parseFloat(urgent);
      if (higherIsWorse) {
        if (isFinite(urgent) && v >= urgent) return 'urgent';
        if (isFinite(warn) && v >= warn) return 'heads';
      } else {
        if (isFinite(urgent) && v <= urgent) return 'urgent';
        if (isFinite(warn) && v <= warn) return 'heads';
      }
      return null;
    };

    // Queued and archived accounts aren't being traded — no warnings.
    if (stage === 'queued' || stage === 'archived') return { m: m, alerts: alerts };

    if (m.unmatched) {
      push('system', 'unmatched', 'info', 'No trades match this tracker',
        'Edit it and pick the account your imports are filed under.', 'unmatched');
    }

    // Floor breach is always on — it isn't a preference.
    if (cushion !== null && trades.length && cushion <= 0) {
      push('system', 'floor', 'over', 'At or below the drawdown floor',
        'Balance ' + usd(balance) + ' · floor ' + usd(floor) + '. Check the account with your firm.', lastTrade);
    } else if (cushion !== null) {
      var c = alertCfg(card, 'cushion');
      var l = c.on ? lvl(cushion, c.warn, c.urgent, false) : null;
      if (l) push('cushion', 'cushion', l, usd(cushion) + ' left before the drawdown floor',
        'Floor ' + usd(floor) + ' · balance ' + usd(balance) + ' · your ' + (l === 'urgent' ? 'urgent' : 'heads-up') + ' line is ' + usd(l === 'urgent' ? c.urgent : c.warn) + '.',
        l + '|' + lastTrade);
    }

    var ci = alertCfg(card, 'inactivity');
    if (ci.on && idleDays !== null) {
      var il = null;
      if (limitDays && idleDays >= limitDays) il = 'over';
      else il = lvl(idleDays, ci.warn, ci.urgent, true);
      if (il) {
        var since = lastQual ? 'the last ' + (qMin > 0 ? 'qualifying ' : '') + 'trade day (' + niceDate(lastQual) + ')'
                             : 'the account start (' + niceDate(anchor) + ')';
        push('inactivity', 'inactivity', il,
          il === 'over' ? 'Inactive ' + idleDays + ' days — at or past your ' + limitDays + '-day limit'
                        : idleDays + ' days since ' + since.replace(/ \(.*/, ''),
          'Counted from ' + since + ' to today' + (limitDays ? ' · your limit: ' + limitDays + ' days' : '') +
          (qMin > 0 ? ' · a day counts if net ≥ ' + usd(qMin) : '') + '.',
          il + '|' + anchor);
      }
      // Gaps already inside the imported history that went past the limit.
      if (limitDays) {
        var seq = qualDays.slice();
        if (card.startDate && (!seq.length || card.startDate < seq[0])) seq.unshift(card.startDate);
        for (var i = 1; i < seq.length; i++) {
          var g = daysBetween(seq[i - 1], seq[i]);
          if (g >= limitDays) {
            push('inactivity', 'gap:' + seq[i - 1] + '>' + seq[i], 'over',
              'Gap of ' + g + ' days between trades — past your ' + limitDays + '-day limit',
              niceDate(seq[i - 1]) + ' → ' + niceDate(seq[i]) + '. Check the account with your firm.',
              'gap');
            alerts[alerts.length - 1].note = '';   // a past gap has no next step to note
          }
        }
      }
    }

    var cp = alertCfg(card, 'pullback');
    if (cp.on && trades.length) {
      var pl = lvl(pullback, cp.warn, cp.urgent, true);
      if (pl) push('pullback', 'pullback', pl, usd(pullback) + ' off the account high',
        'High ' + sUsd(dd.hwm) + ' · now ' + sUsd(dd.totalPnl) + ' · your ' + (pl === 'urgent' ? 'urgent' : 'heads-up') + ' line is ' + usd(pl === 'urgent' ? cp.urgent : cp.warn) + '.',
        pl + '|' + lastTrade);
    }

    var cd = alertCfg(card, 'dailyLoss');
    if (cd.on && firmDaily > 0 && lastTrade && m.lastSessionPnl < 0) {
      var usedPct = Math.round(Math.abs(m.lastSessionPnl) / firmDaily * 100);
      var dl = lvl(usedPct, cd.warn, cd.urgent, true);
      if (dl) push('dailyLoss', 'dailyLoss', dl, usedPct + '% of the firm daily limit used on ' + niceDate(lastTrade),
        'Lost ' + usd(m.lastSessionPnl) + ' of a ' + usd(firmDaily) + ' daily limit that session.',
        dl + '|' + lastTrade);
    }

    var cpo = alertCfg(card, 'payout');
    if (cpo.on && payoutLine > 0 && (stage === 'funded' || stage === 'other' || stage === 'personal')) {
      var daysOk = !m.minDays || payoutDays >= m.minDays;
      if (profit >= payoutLine) {
        push('payout', 'payout', daysOk ? 'payout' : 'heads',
          daysOk ? 'Past your ' + sUsd(payoutLine) + ' payout line (' + sUsd(profit) + ')'
                 : 'Past your payout line — ' + payoutDays + ' of ' + m.minDays + ' trading days',
          (m.minDays ? 'Trading days since last payout: ' + payoutDays + ' of ' + m.minDays + '. ' : '') +
          'Log the payout here once it is taken so the balance stays right.',
          'payout|' + payouts.length + '|' + (daysOk ? 1 : 0));
      } else if (cpo.warn && payoutLine - profit <= num(cpo.warn)) {
        push('payout', 'payout', 'info', usd(payoutLine - profit) + ' to your payout line', '', 'near|' + payouts.length);
      }
    }

    var cc = alertCfg(card, 'consistency');
    if (cc.on && consistency !== null) {
      var cl = lvl(consistency, cc.warn, cc.urgent, true);
      if (cl) push('consistency', 'consistency', cl,
        consistency > 100 ? 'Best day is bigger than your total profit' : 'Best day is ' + consistency + '% of total profit',
        'Your ' + (cl === 'urgent' ? 'cap' : 'heads-up line') + ': ' + (cl === 'urgent' ? cc.urgent : cc.warn) + '%. Payout requests can be held until it drops.',
        cl + '|' + lastTrade);
    }

    var ct = alertCfg(card, 'target');
    if (ct.on && target > 0 && stage === 'eval') {
      if (dd.totalPnl >= target) push('target', 'target', 'payout', 'Profit target reached (' + sUsd(dd.totalPnl) + ')',
        'Check min-day and consistency rules with your firm, then move this account to Passed or Funded.', 'hit');
      else if (ct.warn && target - dd.totalPnl <= num(ct.warn)) push('target', 'target', 'info', usd(target - dd.totalPnl) + ' to the profit target', '', 'near');
    }

    var cr = alertCfg(card, 'renewal');
    if (cr.on && card.renewDate) {
      var left = daysBetween(today, card.renewDate);
      if (left !== null && left >= 0) {
        var rl = lvl(left, cr.warn, cr.urgent, false);
        if (rl) push('renewal', 'renewal', rl,
          left === 0 ? 'Renews / expires today' : 'Renews / expires in ' + left + ' day' + (left === 1 ? '' : 's'),
          'Date set: ' + niceDate(card.renewDate) + '. Keep it or cancel it before then.', rl + '|' + card.renewDate);
      }
    }

    alerts.sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level]; });
    return { m: m, alerts: alerts };
  }

  // Is this alert currently hidden by the member (snoozed / handled / ignored)?
  //   snooze  — hidden until a date
  //   handled — hidden until the alert's fingerprint changes (new data, or it
  //             escalates)
  //   ignored — hidden unless it gets WORSE than when it was ignored
  function alertHiddenBy(card, alert, today) {
    var st = card.alertState && card.alertState[alert.id];
    if (!st) return null;
    today = today || localDate();
    if (st.s === 'snooze') return st.until && today < st.until ? 'snoozed' : null;
    if (st.s === 'handled') return st.fp === alert.fp ? 'handled' : null;
    if (st.s === 'ignored') return LEVEL_RANK[alert.level] >= (st.rank == null ? 9 : st.rank) ? 'ignored' : null;
    return null;
  }

  // Everything the dashboard strip needs for one tracker card.
  // Percentages are null when the card has no limit configured — a missing
  // limit is not the same as a limit at 0%, and the UI must be able to tell.
  function summary(card, allTrades) {
    var trades = cardTrades(card, allTrades);
    var today = localDate();
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
    localDate: localDate,
    pnlOf: pnlOf,
    cardTrades: cardTrades,
    ownersIn: ownersIn,
    drawdown: drawdown,
    summary: summary,
    floorOf: floorOf,
    fleet: fleet,
    alertCfg: alertCfg,
    alertHiddenBy: alertHiddenBy,
    stageOf: stageOf,
    daysBetween: daysBetween,
    niceDate: niceDate,
    ALERT_DEFAULTS: ALERT_DEFAULTS,
    LEVEL_RANK: LEVEL_RANK,
    STAGES: STAGES
  };
})(window);
