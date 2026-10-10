/* ==========================================================================
   admin-money.js — Admin → Money
   Replaces the Payments tab as the daily money view. Same data the Payments
   tab already uses (Whop sync → paymentsData + rosterData, both globals in
   admin.html), laid out around the questions you actually ask:
     How much came in?  What needs me?  What's coming?  Where's it from?
   The old Payments tab stays reachable as "Classic view" until it's retired.
   Needs admin-nt.js (shared .ntx styles + toast).
   ========================================================================== */
(function () {
  'use strict';
  var FEED = 'all', QUERY = '', SHOW = 15, HOVER = null;
  var CAL = null, SEL = null;   // CAL = 'YYYY-MM', SEL = 'YYYY-MM-DD'

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function pays() { try { return Array.isArray(paymentsData) ? paymentsData : []; } catch (e) { return []; } }
  function roster() { try { return Array.isArray(rosterData) ? rosterData : []; } catch (e) { return []; } }
  function net(p) { try { return netOf(p); } catch (e) { return p.netAmount != null ? p.netAmount : p.amount; } }
  function ratio() { try { return avgNetRatio() || 0.9; } catch (e) { return 0.9; } }
  function due(r) { try { return isRenewalDue(r); } catch (e) { return !!r.renewal; } }
  function usd(n, dp) { n = Number(n) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp == null ? 0 : dp, maximumFractionDigits: dp == null ? 0 : dp }); }
  function ctDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); }
  function dayOf(s) { if (!s) return ''; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ctDay(new Date(s)); }
  function fmtDay(ymd, opts) {
    var d = new Date(ymd + 'T12:00:00');
    return d.toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function addDays(ymd, n) { var d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return ctDay(d); }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2400);
  }

  /* ── What a member renews at ─────────────────────────────────────────
     Same order as the Payments tab: manual override → last real recurring
     charge → Whop's renewal price → first price. */
  function lastRecurring(email) {
    var em = (email || '').toLowerCase(); if (!em) return 0;
    var hit = pays().filter(function (p) {
      return p.status === 'paid' && (p.email || '').toLowerCase() === em
        && (p.billingReason === 'subscription_cycle' || p.billingReason === 'subscription_create') && p.subtotal > 0;
    }).sort(function (a, b) { return (b.paidAt || '') > (a.paidAt || '') ? 1 : -1; })[0];
    return hit ? Math.max(0, +(hit.subtotal - (hit.promoDiscount || 0)).toFixed(2)) : 0;
  }
  function priceOf(r) {
    return (r.billingAmountManual ? r.billingAmount : 0) || lastRecurring(r.email) || r.billingAmount || r.renewalPrice || r.initialPrice || 0;
  }
  function product(x) { return x.productName || x.planName || x.description || x.accessType || '—'; }
  function isNT(x) { var t = (product(x) || '').toLowerCase(); return /pro|plus|vip|lifetime/.test(t) && !/raven|nightwing|nexus/.test(t); }

  /* ── Numbers ─────────────────────────────────────────────────────────── */
  function compute() {
    var P = pays(), R = roster();
    var today = ctDay(new Date());
    var mStart = today.slice(0, 8) + '01';
    var dom = Number(today.slice(8, 10));
    var lm = new Date(mStart + 'T12:00:00'); lm.setMonth(lm.getMonth() - 1);
    var lmStart = ctDay(lm), lmSameDay = lmStart.slice(0, 8) + String(Math.min(dom, 28 + (dom > 28 ? 3 : 0))).padStart(2, '0');
    var paid = P.filter(function (p) { return p.status === 'paid'; });
    var inRange = function (p, a, b) { var d = dayOf(p.paidAt); return d >= a && d <= b; };

    var mNet = 0, mGross = 0, lmNet = 0;
    paid.forEach(function (p) {
      if (inRange(p, mStart, today)) { mNet += net(p); mGross += p.amount || 0; }
      if (inRange(p, lmStart, lmSameDay)) lmNet += net(p);
    });

    // Failed charges with no later successful payment from the same person.
    var since30 = addDays(today, -30);
    var failed = P.filter(function (p) { return p.status !== 'paid' && p.status !== 'open' && dayOf(p.paidAt) >= since30; })
      .filter(function (f) {
        var em = (f.email || '').toLowerCase();
        return !paid.some(function (p) { return (p.email || '').toLowerCase() === em && (p.paidAt || '') > (f.paidAt || ''); });
      });
    // One row per person (latest failure).
    var seen = {}; failed = failed.sort(function (a, b) { return (b.paidAt || '') > (a.paidAt || '') ? 1 : -1; })
      .filter(function (f) { var k = (f.email || f.id); if (seen[k]) return false; seen[k] = 1; return true; });

    var pastDue = R.filter(function (r) { return r.status === 'past_due'; });
    var cancelling = R.filter(function (r) { return r.status === 'canceling' || r.status === 'trial_cancelled'; });
    var refunds = P.filter(function (p) { return (p.refundedAmount || 0) > 0 && dayOf(p.paidAt) >= since30; });

    var atRiskEmails = {};
    failed.forEach(function (f) { atRiskEmails[(f.email || '').toLowerCase()] = f.amount || 0; });
    pastDue.forEach(function (r) { var k = (r.email || '').toLowerCase(); if (!(k in atRiskEmails)) atRiskEmails[k] = priceOf(r); });
    var atRisk = Object.keys(atRiskEmails).reduce(function (s, k) { return s + atRiskEmails[k]; }, 0);

    // Coming up: next 14 days of renewals, trial conversions and endings.
    var horizon = addDays(today, 14), next7 = addDays(today, 7);
    var upcoming = [];
    R.forEach(function (r) {
      var d = dayOf(r.renewal);
      if (due(r) && d >= today && d <= horizon) {
        upcoming.push({ day: d, r: r, kind: r.status === 'trialing' ? 'trial' : 'renew', amount: priceOf(r) });
      }
      var end = dayOf(r.cancelingDate || (r.status === 'canceling' || r.status === 'trial_cancelled' ? r.renewal : ''));
      if (end && end >= today && end <= horizon) upcoming.push({ day: end, r: r, kind: 'ends', amount: priceOf(r) });
    });
    upcoming.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : b.amount - a.amount; });
    var exp7 = upcoming.filter(function (u) { return u.kind !== 'ends' && u.day <= next7; });
    var exp7Net = exp7.reduce(function (s, u) { return s + u.amount; }, 0) * ratio();

    var activePaying = R.filter(function (r) { return r.status === 'active' || r.status === 'canceling' || r.status === 'past_due'; }).length;

    // Daily net, last 30 days.
    var days = [];
    for (var i = 29; i >= 0; i--) days.push({ day: addDays(today, -i), net: 0, n: 0 });
    var idx = {}; days.forEach(function (d, i) { idx[d.day] = i; });
    paid.forEach(function (p) { var d = dayOf(p.paidAt); if (d in idx) { days[idx[d]].net += net(p); days[idx[d]].n++; } });

    // This month by product.
    var byProd = {};
    paid.forEach(function (p) { if (inRange(p, mStart, today)) { var k = p.description || 'Other'; byProd[k] = (byProd[k] || 0) + net(p); } });
    var prods = Object.keys(byProd).map(function (k) { return { k: k, v: byProd[k] }; }).sort(function (a, b) { return b.v - a.v; });

    return { today: today, mNet: mNet, mGross: mGross, lmNet: lmNet, failed: failed, pastDue: pastDue,
      cancelling: cancelling, refunds: refunds, atRisk: atRisk, upcoming: upcoming, exp7: exp7, exp7Net: exp7Net,
      activePaying: activePaying, days: days, prods: prods };
  }

  /* ── Styles ──────────────────────────────────────────────────────────── */
  var CSS = ''
    + '#panel-money .mn-2{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1100px){#panel-money .mn-2{grid-template-columns:1fr 1fr}}'
    + '#panel-money .mn-3{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1100px){#panel-money .mn-3{grid-template-columns:1.6fr 1fr}}'
    + '#panel-money .mn-row{display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}'
    + '#panel-money .mn-row:first-child{border-top:0}'
    + '#panel-money .mn-amt{font-weight:900;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12.5px}'
    + '#panel-money .mn-sub{font-size:11px;color:#71717a}'
    + '#panel-money .mn-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:5px;border:1px solid;white-space:nowrap}'
    + '#panel-money .p-red{color:#E2534B;border-color:rgba(226,83,75,.45);background:rgba(226,83,75,.08)}'
    + '#panel-money .p-amb{color:#F5A524;border-color:rgba(245,165,36,.45);background:rgba(245,165,36,.08)}'
    + '#panel-money .p-grn{color:#2FBF7E;border-color:rgba(47,191,126,.4);background:rgba(47,191,126,.07)}'
    + '#panel-money .p-blu{color:#7FB2FF;border-color:rgba(127,178,255,.4);background:rgba(127,178,255,.07)}'
    + '#panel-money .p-mut{color:#8A97A8;border-color:#253244}'
    + '#panel-money .p-nt{color:#FF6B1F;border-color:rgba(255,107,31,.45);background:rgba(255,107,31,.08)}'
    + '#panel-money .mn-day{font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#71717a;margin:12px 0 2px;display:flex;justify-content:space-between}'
    + '#panel-money .mn-day:first-child{margin-top:0}'
    + '#panel-money .mn-chart{position:relative;height:170px;display:flex;align-items:flex-end;gap:2px;padding-top:8px;border-bottom:1px solid rgba(255,255,255,.12)}'
    + '#panel-money .mn-bar{flex:1;position:relative;height:100%;display:flex;align-items:flex-end;cursor:default}'
    + '#panel-money .mn-bar i{display:block;width:100%;background:#FF6B1F;border-radius:4px 4px 0 0;min-height:0}'
    + '#panel-money .mn-bar.zero i{background:rgba(255,255,255,.08);height:2px!important;border-radius:2px}'
    + '#panel-money .mn-bar:hover i{background:#FF9247}'
    + '#panel-money .mn-tip{position:absolute;pointer-events:none;background:#18181b;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:7px 9px;font-size:11px;color:#e4e4e7;white-space:nowrap;z-index:5;transform:translate(-50%,-100%);top:-4px}'
    + '#panel-money .mn-axis{display:flex;justify-content:space-between;font-size:10px;color:#52525b;margin-top:6px}'
    + '#panel-money .mn-hb{display:flex;align-items:center;gap:10px;padding:7px 0}'
    + '#panel-money .mn-hb .lb{width:42%;font-size:12px;color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#panel-money .mn-hb .tr{flex:1;height:10px;background:rgba(255,255,255,.04);border-radius:5px;overflow:hidden}'
    + '#panel-money .mn-hb .tr i{display:block;height:100%;background:#FF6B1F;border-radius:0 5px 5px 0}'
    + '#panel-money .mn-hb .v{width:70px;text-align:right;font-size:12px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}'
    + '#panel-money .mn-delta{font-size:10.5px;font-weight:800;margin-top:4px;letter-spacing:.02em}'
    + '#panel-money .mn-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}'
    + '#panel-money .mn-dow{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#52525b;text-align:center;padding:2px 0 6px}'
    + '#panel-money .mn-cell{min-height:74px;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:6px 7px;cursor:pointer;background:rgba(255,255,255,.01);transition:all .12s;overflow:hidden}'
    + '#panel-money .mn-cell:hover{border-color:rgba(255,255,255,.18)}'
    + '#panel-money .mn-cell.empty{border:0;background:transparent;cursor:default}'
    + '#panel-money .mn-cell.today{border-color:rgba(255,107,31,.55)}'
    + '#panel-money .mn-cell.sel{background:rgba(255,107,31,.10);border-color:#FF6B1F}'
    + '#panel-money .mn-cell .dn{font-size:11px;font-weight:900;color:#a1a1aa}'
    + '#panel-money .mn-cell.past .dn{color:#52525b}'
    + '#panel-money .mn-cell .l{font-size:10.5px;font-weight:800;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '@media(max-width:640px){#panel-money .mn-cell{min-height:56px;padding:4px}#panel-money .mn-cell .l{font-size:9px}#panel-money .mn-cell .c{display:none}}'
    + '#panel-money .mn-copy{cursor:pointer;border-bottom:1px dashed rgba(255,255,255,.2)}#panel-money .mn-copy:hover{color:#FF6B1F}';

  function skeleton() {
    var p = $('panel-money'); if (!p || p.getAttribute('data-ready')) return;
    p.setAttribute('data-ready', '1'); p.classList.add('ntx');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    p.innerHTML = ''
      + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
      +   '<div><h2 class="text-lg font-black text-white">Money</h2>'
      +   '<div id="mn-fresh" class="text-[11px] text-zinc-600 mt-0.5"></div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap">'
      +     '<button class="ntx-btn" onclick="moneySync()">&#10227; Sync Whop now</button>'
      +     '<button class="ntx-btn" onclick="exportPaymentsCSV()">&darr; Export</button>'
      +     '<button class="ntx-btn" onclick="switchTab(\'payments\')" title="The previous Payments tab">Classic view</button>'
      +   '</div>'
      + '</div>'
      + '<div id="mn-stats" class="ntx-grid mb-5"></div>'
      + '<div class="mn-2 mb-5">'
      +   '<div class="ntx-card"><div class="flex justify-between items-center"><div class="ntx-h">Needs attention</div><div class="text-[10px] text-zinc-600">last 30 days</div></div><div id="mn-attn" class="mt-2"></div></div>'
      +   '<div class="ntx-card"><div class="flex justify-between items-center"><div class="ntx-h">Coming up</div><div class="text-[10px] text-zinc-600">next 14 days</div></div><div id="mn-up" class="mt-2"></div></div>'
      + '</div>'
      + '<div class="mn-3 mb-5">'
      +   '<div class="ntx-card"><div class="flex justify-between items-center mb-3"><div class="ntx-h">Calendar</div>'
      +     '<div class="flex items-center gap-2"><button class="ntx-btn" data-cal="-1">&lsaquo;</button>'
      +     '<span id="mn-cal-title" class="text-sm font-black text-white" style="min-width:120px;text-align:center"></span>'
      +     '<button class="ntx-btn" data-cal="1">&rsaquo;</button><button class="ntx-btn" data-cal="0">Today</button></div></div>'
      +     '<div id="mn-cal"></div>'
      +     '<div class="flex gap-4 flex-wrap mt-3 text-[10.5px] text-zinc-500">'
      +       '<span><b style="color:#2FBF7E">$</b> collected (net)</span><span><b style="color:#F5A524">~$</b> expected renewals</span>'
      +       '<span><b style="color:#E2534B">&times;</b> failed</span><span><b style="color:#F5A524">&darr;</b> access ends</span></div></div>'
      +   '<div class="ntx-card"><div id="mn-dayhead" class="ntx-h mb-2">Day</div><div id="mn-daybody"></div></div>'
      + '</div>'
      + '<div class="mn-3 mb-5">'
      +   '<div class="ntx-card"><div class="flex justify-between items-center mb-1"><div class="ntx-h">Net per day · last 30 days</div><div id="mn-30tot" class="text-[11px] text-zinc-400 font-bold"></div></div><div id="mn-chart"></div></div>'
      +   '<div class="ntx-card"><div class="ntx-h mb-2">This month by product · net</div><div id="mn-prod"></div></div>'
      + '</div>'
      + '<div class="ntx-card"><div class="flex items-center justify-between flex-wrap gap-2 mb-2"><div class="ntx-h">Payments</div>'
      +   '<div class="flex gap-1 flex-wrap items-center" id="mn-chips"></div></div><div id="mn-list"></div></div>';
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  function card(n, l, cls, extra) { return '<div class="ntx-stat ' + (cls || '') + '"><div class="n">' + n + '</div><div class="l">' + l + '</div>' + (extra || '') + '</div>'; }

  function renderStats(c) {
    var delta = '';
    if (c.lmNet > 0) {
      var pct = Math.round((c.mNet - c.lmNet) / c.lmNet * 100);
      delta = '<div class="mn-delta" style="color:' + (pct >= 0 ? '#2FBF7E' : '#E2534B') + '">' + (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs same point last month</div>';
    }
    var attn = c.failed.length + c.pastDue.length;
    $('mn-stats').innerHTML =
        card(usd(c.mNet), 'Net this month', 'green', delta)
      + card(usd(c.mGross), 'Gross this month')
      + card(usd(c.exp7Net), 'Expected next 7 days', '', '<div class="mn-delta text-zinc-500">' + c.exp7.length + ' renewal' + (c.exp7.length === 1 ? '' : 's') + ' · est. net</div>')
      + card(usd(c.atRisk), 'At risk', attn ? 'red' : '', '<div class="mn-delta text-zinc-500">' + attn + ' failed / past due</div>')
      + card(c.activePaying, 'Paying members', '', '<div class="mn-delta text-zinc-500">' + c.cancelling.length + ' cancelling</div>');
  }

  function who(x) {
    var em = x.email || '';
    return '<span class="text-white font-bold text-[12.5px]">' + esc(x.name || x.customerName || em || '—') + '</span>'
      + (em ? ' <span class="mn-sub mn-copy" data-mcopy="' + esc(em) + '">' + esc(em) + '</span>' : '');
  }

  function renderAttention(c) {
    var rows = [];
    c.failed.forEach(function (f) {
      rows.push({ sort: 0, html: '<span class="mn-pill p-red">Failed</span>'
        + '<div style="flex:1;min-width:0">' + who(f) + (isNT(f) ? ' <span class="mn-pill p-nt">NT</span>' : '')
        + '<div class="mn-sub">' + esc(product(f)) + ' · ' + esc(f.failureReason || 'charge failed') + ' · ' + fmtDay(dayOf(f.paidAt), { month: 'short', day: 'numeric' }) + '</div></div>'
        + '<div class="mn-amt">' + usd(f.amount, 2) + '</div>' });
    });
    c.pastDue.forEach(function (r) {
      if (c.failed.some(function (f) { return (f.email || '').toLowerCase() === (r.email || '').toLowerCase(); })) return;
      rows.push({ sort: 1, html: '<span class="mn-pill p-red">Past due</span>'
        + '<div style="flex:1;min-width:0">' + who(r) + '<div class="mn-sub">' + esc(product(r)) + ' · Whop is retrying</div></div>'
        + '<div class="mn-amt">' + usd(priceOf(r), 2) + '</div>' });
    });
    c.cancelling.slice().sort(function (a, b) { return (a.cancelingDate || a.renewal || '') < (b.cancelingDate || b.renewal || '') ? -1 : 1; })
      .forEach(function (r) {
        var end = dayOf(r.cancelingDate || r.renewal);
        rows.push({ sort: 2, html: '<span class="mn-pill p-amb">' + (r.status === 'trial_cancelled' ? 'Trial cancel' : 'Cancelling') + '</span>'
          + '<div style="flex:1;min-width:0">' + who(r) + '<div class="mn-sub">' + esc(product(r)) + (end ? ' · access ends ' + fmtDay(end, { month: 'short', day: 'numeric' }) : '')
          + (r.cancelReason ? ' · "' + esc(r.cancelReason) + '"' : '') + '</div></div>'
          + '<div class="mn-amt text-zinc-400">−' + usd(priceOf(r), 2) + '</div>' });
      });
    c.refunds.forEach(function (p) {
      rows.push({ sort: 3, html: '<span class="mn-pill p-mut">Refund</span>'
        + '<div style="flex:1;min-width:0">' + who(p) + '<div class="mn-sub">' + esc(product(p)) + ' · ' + fmtDay(dayOf(p.paidAt), { month: 'short', day: 'numeric' }) + '</div></div>'
        + '<div class="mn-amt text-zinc-400">−' + usd(p.refundedAmount, 2) + '</div>' });
    });
    rows.sort(function (a, b) { return a.sort - b.sort; });
    $('mn-attn').innerHTML = rows.length
      ? rows.slice(0, 40).map(function (x) { return '<div class="mn-row">' + x.html + '</div>'; }).join('')
      : '<div class="text-[12px] text-zinc-500 py-2">All clear. No failed payments, past dues, cancels or refunds.</div>';
  }

  function renderUpcoming(c) {
    if (!c.upcoming.length) { $('mn-up').innerHTML = '<div class="text-[12px] text-zinc-500 py-2">No renewals in the next 14 days.</div>'; return; }
    var groups = {}, order = [];
    c.upcoming.forEach(function (u) { if (!groups[u.day]) { groups[u.day] = []; order.push(u.day); } groups[u.day].push(u); });
    var r8 = ratio();
    $('mn-up').innerHTML = order.map(function (d) {
      var g = groups[d];
      var sum = g.filter(function (u) { return u.kind !== 'ends'; }).reduce(function (s, u) { return s + u.amount; }, 0);
      var label = d === c.today ? 'Today' : d === addDays(c.today, 1) ? 'Tomorrow' : fmtDay(d);
      return '<div class="mn-day"><span>' + label + '</span><span>' + (sum ? '~' + usd(sum * r8) + ' net' : '') + '</span></div>'
        + g.map(function (u) {
          var pill = u.kind === 'trial' ? '<span class="mn-pill p-blu">Trial converts</span>'
            : u.kind === 'ends' ? '<span class="mn-pill p-amb">Access ends</span>'
            : '<span class="mn-pill p-grn">Renews</span>';
          return '<div class="mn-row">' + pill + '<div style="flex:1;min-width:0">' + who(u.r)
            + '<div class="mn-sub">' + esc(product(u.r)) + '</div></div>'
            + '<div class="mn-amt' + (u.kind === 'ends' ? ' text-zinc-500' : '') + '">' + (u.kind === 'ends' ? '—' : usd(u.amount, 2)) + '</div></div>';
        }).join('');
    }).join('');
  }

  function renderChart(c) {
    var max = Math.max.apply(null, c.days.map(function (d) { return d.net; }).concat([1]));
    var tot = c.days.reduce(function (s, d) { return s + d.net; }, 0);
    $('mn-30tot').textContent = usd(tot) + ' net';
    $('mn-chart').innerHTML = '<div class="mn-chart" id="mn-bars">'
      + c.days.map(function (d, i) {
        var h = d.net > 0 ? Math.max(3, Math.round(d.net / max * 100)) : 0;
        return '<div class="mn-bar' + (d.net > 0 ? '' : ' zero') + '" data-i="' + i + '"><i style="height:' + h + '%"></i></div>';
      }).join('') + '</div>'
      + '<div class="mn-axis"><span>' + fmtDay(c.days[0].day, { month: 'short', day: 'numeric' }) + '</span><span>'
      + fmtDay(c.days[15].day, { month: 'short', day: 'numeric' }) + '</span><span>Today</span></div>';
    var bars = $('mn-bars');
    bars.onmousemove = function (e) {
      var b = e.target.closest && e.target.closest('.mn-bar'); var old = bars.querySelector('.mn-tip');
      if (!b) { if (old) old.remove(); return; }
      var d = c.days[+b.getAttribute('data-i')];
      if (!old) { old = document.createElement('div'); old.className = 'mn-tip'; bars.appendChild(old); }
      old.innerHTML = '<b>' + fmtDay(d.day) + '</b><br>' + usd(d.net, 2) + ' net · ' + d.n + ' payment' + (d.n === 1 ? '' : 's');
      old.style.left = (b.offsetLeft + b.offsetWidth / 2) + 'px';
      old.style.top = (bars.offsetHeight - (b.querySelector('i').offsetHeight || 2) - 6) + 'px';
    };
    bars.onmouseleave = function () { var t = bars.querySelector('.mn-tip'); if (t) t.remove(); };

    var pmax = c.prods.length ? c.prods[0].v : 1;
    $('mn-prod').innerHTML = c.prods.length ? c.prods.slice(0, 8).map(function (p) {
      return '<div class="mn-hb"><div class="lb" title="' + esc(p.k) + '">' + esc(p.k) + '</div><div class="tr"><i style="width:' + Math.max(2, p.v / pmax * 100) + '%"></i></div><div class="v">' + usd(p.v) + '</div></div>';
    }).join('') : '<div class="text-[12px] text-zinc-500 py-2">No payments yet this month.</div>';
  }

  function statusPill(p) {
    if ((p.refundedAmount || 0) > 0) return '<span class="mn-pill p-mut">Refunded</span>';
    if (p.status === 'paid') return '<span class="mn-pill p-grn">Paid</span>';
    if (p.status === 'open') return '<span class="mn-pill p-mut">Open</span>';
    return '<span class="mn-pill p-red">Failed</span>';
  }
  function reasonLabel(p) {
    var r = (p.billingReason || '').toLowerCase();
    if (r === 'subscription_create') return 'New';
    if (r === 'subscription_cycle') return 'Renewal';
    if (r === 'one_time' || r === 'manual') return 'One-time';
    return r ? r.replace(/_/g, ' ') : '';
  }
  function renderList() {
    var chips = [['all', 'All'], ['paid', 'Paid'], ['new', 'New'], ['failed', 'Failed'], ['refund', 'Refunds']];
    $('mn-chips').innerHTML = chips.map(function (x) {
      return '<button class="ntx-chip' + (FEED === x[0] ? ' on' : '') + '" data-mfeed="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '<input id="mn-q" class="ntx-in" placeholder="Search name, email, product" style="width:200px" value="' + esc(QUERY) + '">';
    var q = $('mn-q'); q.oninput = function () { QUERY = q.value.toLowerCase(); SHOW = 15; drawList(); };
    drawList();
  }
  function drawList() {
    var list = pays().slice().sort(function (a, b) { return (b.paidAt || '') > (a.paidAt || '') ? 1 : -1; }).filter(function (p) {
      if (FEED === 'paid' && p.status !== 'paid') return false;
      if (FEED === 'new' && !(p.status === 'paid' && p.billingReason === 'subscription_create')) return false;
      if (FEED === 'failed' && (p.status === 'paid' || p.status === 'open')) return false;
      if (FEED === 'refund' && !((p.refundedAmount || 0) > 0)) return false;
      if (QUERY && ((p.customerName || '') + ' ' + (p.email || '') + ' ' + product(p)).toLowerCase().indexOf(QUERY) === -1) return false;
      return true;
    });
    if (!list.length) { $('mn-list').innerHTML = '<div class="text-[12px] text-zinc-500 py-3">' + (pays().length ? 'No payments match.' : 'No payment data yet. Press Sync Whop now.') + '</div>'; return; }
    var lastDay = '';
    $('mn-list').innerHTML = list.slice(0, SHOW).map(function (p) {
      var d = dayOf(p.paidAt), head = '';
      if (d !== lastDay) { lastDay = d; head = '<div class="mn-day"><span>' + (d === ctDay(new Date()) ? 'Today' : fmtDay(d)) + '</span><span></span></div>'; }
      var t = p.paidAt && p.paidAt.length > 10 ? new Date(p.paidAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '';
      var failed = p.status !== 'paid' && p.status !== 'open';
      return head + '<div class="mn-row">' + statusPill(p)
        + '<div style="flex:1;min-width:0">' + who({ name: p.customerName, email: p.email })
        + '<div class="mn-sub">' + esc(product(p)) + (reasonLabel(p) ? ' · ' + esc(reasonLabel(p)) : '')
        + (failed && p.failureReason ? ' · ' + esc(p.failureReason) : '') + (p.promoCode ? ' · code ' + esc(p.promoCode) : '') + (t ? ' · ' + t : '') + '</div></div>'
        + '<div style="text-align:right"><div class="mn-amt' + (failed ? ' text-zinc-500' : '') + '">' + usd(p.amount, 2) + '</div>'
        + (p.status === 'paid' && p.netAmount != null ? '<div class="mn-sub">' + usd(p.netAmount, 2) + ' net</div>' : '') + '</div></div>';
    }).join('')
      + (list.length > SHOW ? '<div class="pt-3 text-center"><button class="ntx-btn" data-mmore="1">Show more (' + (list.length - SHOW) + ')</button></div>' : '');
  }

  /* ── Calendar ──────────────────────────────────────────────────────────
     Past days: what actually came in (net) and what failed.
     Today/future: renewals expected (est. net) and access endings.
     Click a day → its list on the right. */
  function dayData(ymd) {
    var P = pays().filter(function (p) { return dayOf(p.paidAt) === ymd; });
    var paid = P.filter(function (p) { return p.status === 'paid'; });
    var failed = P.filter(function (p) { return p.status !== 'paid' && p.status !== 'open'; });
    var today = ctDay(new Date());
    var ren = [], ends = [];
    if (ymd >= today) {
      roster().forEach(function (r) {
        if (due(r) && dayOf(r.renewal) === ymd) ren.push(r);
        var end = dayOf(r.cancelingDate || (r.status === 'canceling' || r.status === 'trial_cancelled' ? r.renewal : ''));
        if (end === ymd) ends.push(r);
      });
    }
    return { paid: paid, failed: failed, ren: ren, ends: ends,
      net: paid.reduce(function (s, p) { return s + net(p); }, 0),
      exp: ren.reduce(function (s, r) { return s + priceOf(r); }, 0) * ratio() };
  }
  function renderCalendar() {
    var today = ctDay(new Date());
    if (!CAL) CAL = today.slice(0, 7);
    if (!SEL) SEL = today;
    var y = +CAL.slice(0, 4), m = +CAL.slice(5, 7) - 1;
    var first = new Date(y, m, 1, 12), days = new Date(y, m + 1, 0).getDate();
    $('mn-cal-title').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var lead = (first.getDay() + 6) % 7;   // Monday first
    var html = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function (d) { return '<div class="mn-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < lead; i++) html += '<div class="mn-cell empty"></div>';
    var monthNet = 0, monthExp = 0;
    for (var d = 1; d <= days; d++) {
      var ymd = CAL + '-' + String(d).padStart(2, '0');
      var x = dayData(ymd), lines = '';
      monthNet += x.net; monthExp += x.exp;
      if (x.net > 0) lines += '<div class="l" style="color:#2FBF7E">' + usd(x.net) + (x.paid.length > 1 ? '<span class="c"> · ' + x.paid.length + '</span>' : '') + '</div>';
      if (x.failed.length) lines += '<div class="l" style="color:#E2534B">&times; ' + x.failed.length + '<span class="c"> failed</span></div>';
      if (x.ren.length) lines += '<div class="l" style="color:#F5A524">~' + usd(x.exp) + '<span class="c"> · ' + x.ren.length + '</span></div>';
      if (x.ends.length) lines += '<div class="l" style="color:#F5A524">&darr; ' + x.ends.length + '<span class="c"> end' + (x.ends.length > 1 ? 's' : '') + '</span></div>';
      var cls = 'mn-cell' + (ymd === today ? ' today' : '') + (ymd === SEL ? ' sel' : '') + (ymd < today ? ' past' : '');
      html += '<div class="' + cls + '" data-day="' + ymd + '"><div class="dn">' + d + '</div>' + lines + '</div>';
    }
    $('mn-cal').innerHTML = '<div class="mn-cal">' + html + '</div>'
      + '<div class="flex gap-4 mt-3 text-[11px] text-zinc-400"><span>Month collected: <b style="color:#2FBF7E">' + usd(monthNet) + '</b> net</span>'
      + (monthExp ? '<span>Still expected: <b style="color:#F5A524">~' + usd(monthExp) + '</b></span>' : '') + '</div>';
    renderDay();
  }
  function renderDay() {
    var x = dayData(SEL), today = ctDay(new Date());
    $('mn-dayhead').textContent = (SEL === today ? 'Today · ' : '') + fmtDay(SEL, { weekday: 'long', month: 'short', day: 'numeric' });
    var rows = '';
    x.paid.concat(x.failed).sort(function (a, b) { return (b.paidAt || '') > (a.paidAt || '') ? 1 : -1; }).forEach(function (p) {
      rows += '<div class="mn-row">' + statusPill(p) + '<div style="flex:1;min-width:0">' + who({ name: p.customerName, email: p.email })
        + '<div class="mn-sub">' + esc(product(p)) + (reasonLabel(p) ? ' · ' + esc(reasonLabel(p)) : '') + (p.failureReason && p.status !== 'paid' ? ' · ' + esc(p.failureReason) : '') + '</div></div>'
        + '<div class="mn-amt">' + usd(p.amount, 2) + '</div></div>';
    });
    x.ren.forEach(function (r) {
      rows += '<div class="mn-row"><span class="mn-pill ' + (r.status === 'trialing' ? 'p-blu">Trial converts' : 'p-grn">Renews') + '</span><div style="flex:1;min-width:0">' + who(r)
        + '<div class="mn-sub">' + esc(product(r)) + '</div></div><div class="mn-amt">' + usd(priceOf(r), 2) + '</div></div>';
    });
    x.ends.forEach(function (r) {
      rows += '<div class="mn-row"><span class="mn-pill p-amb">Access ends</span><div style="flex:1;min-width:0">' + who(r)
        + '<div class="mn-sub">' + esc(product(r)) + (r.cancelReason ? ' · "' + esc(r.cancelReason) + '"' : '') + '</div></div><div class="mn-amt text-zinc-500">&mdash;</div></div>';
    });
    var sum = (x.net ? '<span style="color:#2FBF7E">' + usd(x.net, 2) + ' net collected</span>' : '')
      + (x.exp ? (x.net ? ' · ' : '') + '<span style="color:#F5A524">~' + usd(x.exp) + ' expected</span>' : '');
    $('mn-daybody').innerHTML = (sum ? '<div class="text-[12px] font-bold mb-2">' + sum + '</div>' : '')
      + (rows || '<div class="text-[12px] text-zinc-500 py-2">Nothing on this day.</div>');
  }

  window.moneyRender = function () {
    skeleton();
    var p = $('panel-money'); if (!p) return;
    var c = compute();
    renderStats(c); renderAttention(c); renderUpcoming(c); renderCalendar(); renderChart(c); renderList();
    var last = ''; try { last = localStorage.getItem('fsdx_whop_last_sync') || ''; } catch (e) {}
    $('mn-fresh').textContent = (pays().length ? pays().length + ' payments · ' : '')
      + (last ? 'Whop synced ' + new Date(last).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Not synced yet')
      + ' · amounts in USD · "net" = after Whop fees';
  };
  window.moneySync = function () {
    if (typeof syncFromWhop !== 'function') { toast('Sync is not available here', true); return; }
    toast('Syncing Whop…');
    Promise.resolve(syncFromWhop()).then(function () { moneyRender(); toast('Synced'); })
      .catch(function (e) { toast((e && e.message) || 'Sync failed', true); });
  };

  // Keep Money in step with everything that already refreshes payments.
  function hook() {
    if (typeof window.renderPayments === 'function' && !window.renderPayments._mn) {
      var orig = window.renderPayments;
      window.renderPayments = function () {
        var r = orig.apply(this, arguments);
        try { var p = $('panel-money'); if (p && p.classList.contains('active')) moneyRender(); } catch (e) {}
        return r;
      };
      window.renderPayments._mn = true;
    }
  }

  document.addEventListener('click', function (e) {
    var p = $('panel-money'); if (!p || !p.contains(e.target)) return;
    var t = e.target.closest ? e.target : null; if (!t) return;
    var f = t.closest('[data-mfeed]'); if (f) { FEED = f.getAttribute('data-mfeed'); SHOW = 15; renderList(); return; }
    if (t.closest('[data-mmore]')) { SHOW += 50; drawList(); return; }
    var cd = t.closest('[data-day]'); if (cd) { SEL = cd.getAttribute('data-day'); renderCalendar(); return; }
    var nav = t.closest('[data-cal]');
    if (nav) {
      var step = +nav.getAttribute('data-cal');
      if (!step) { CAL = ctDay(new Date()).slice(0, 7); SEL = ctDay(new Date()); }
      else { var d = new Date(CAL + '-15T12:00:00'); d.setMonth(d.getMonth() + step); CAL = ctDay(d).slice(0, 7); }
      renderCalendar(); return;
    }
    var cp = t.closest('[data-mcopy]');
    if (cp) {
      var v = cp.getAttribute('data-mcopy');
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Copied ' + v); }).catch(function () { window.prompt('Copy:', v); });
    }
  });
  document.addEventListener('DOMContentLoaded', function () { skeleton(); hook(); });
  hook();
})();
