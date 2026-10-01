/* tradovate-sync.js — auto-import from connected Tradovate logins.
 *
 * The server pulls fills from Tradovate every 30 minutes. This script, on any
 * page that loads it, turns those fills into journal trades without a click:
 *
 *   1. New Tradovate accounts (active ones) are added to My Accounts, with a
 *      "Needs setup" account card, so they show in Fleet right away.
 *   2. Fills become trades with the same position engine the importer uses.
 *   3. Fees per trade:
 *        - the account has its own commission rate  → rate × contract sides
 *          (the member's override always wins)
 *        - otherwise Tradovate reported real fees    → those fees
 *        - otherwise                                  → HOLD the trade. It stays
 *          on the server (120 days) and imports as soon as a rate is set, so a
 *          trade never lands at the wrong P&L.
 *   4. Trades already in the journal are skipped (same check as the importer).
 *
 * Runs on load and every 10 minutes while the page is open.
 * Public: FSDXTv.run(opts) → Promise<result>, FSDXTv.reprice(trades, accounts, name)
 */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var JOURNAL_URL = API + '/api/nexus-journal';
  var EVERY_MS = 10 * 60 * 1000;

  var TICK = {
    MNQ: { tick: 0.25, value: 0.50 }, NQ: { tick: 0.25, value: 5.00 },
    MES: { tick: 0.25, value: 1.25 }, ES: { tick: 0.25, value: 12.50 },
    MGC: { tick: 0.10, value: 1.00 }, GC: { tick: 0.10, value: 10.00 },
    MCL: { tick: 0.01, value: 1.00 }, CL: { tick: 0.01, value: 10.00 },
    MYM: { tick: 1.00, value: 0.50 }, YM: { tick: 1.00, value: 5.00 },
    M2K: { tick: 0.10, value: 0.50 }, RTY: { tick: 0.10, value: 5.00 },
    ZB: { tick: 0.03125, value: 31.25 }, ZN: { tick: 0.015625, value: 15.625 }
  };
  function pointValue(sym) { var s = TICK[sym] || { tick: 0.25, value: 0.50 }; return s.value / s.tick; }
  function stripExpiry(contract) {
    var s = String(contract || '').trim().toUpperCase();
    var m = s.match(/^([A-Z0-9]*?)([FGHJKMNQUVXZ])(\d{1,2})$/);
    if (m && m[1]) return m[1];
    var m2 = s.match(/^([A-Z]+?)(?=[FGHJKMNQUVXZ]?\d)/) || s.match(/^([A-Z]+)/);
    return (m2 && m2[1]) ? m2[1] : s;
  }
  function normAcct(s) { return String(s || '').replace(/[#\s]/g, '').toUpperCase(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // UTC ISO → this browser's local date/time, second precision (matches how a
  // Tradovate CSV export is read, so CSV- and sync-imported trades line up).
  function localTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { iso: '', time: '', ts: 0 };
    var ts = Math.floor(d.getTime() / 1000) * 1000;
    return { iso: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
             time: pad(d.getHours()) + ':' + pad(d.getMinutes()), ts: ts };
  }
  function money(n) { return Math.round(n * 100) / 100; }
  function resultOf(p) { return p > 0 ? 'WIN' : p < 0 ? 'LOSS' : 'BE'; }
  function tradeKey(t) {   // same identity the importer's duplicate check uses
    return [normAcct(t.accountNumber) || (t.accountName || ''), t.date || '', t.entryTime || '', t.exitTime || '', String(t.contracts || '')].join('|');
  }

  /* Fee decision for one trade. Returns null to hold it. */
  function feesFor(acct, sides, tvFees) {
    var rate = acct && acct.commissionRate;
    if (rate != null && rate !== '' && isFinite(+rate)) return { fees: money(sides * (+rate)), src: 'rate' };
    if (tvFees != null && tvFees > 0) return { fees: money(tvFees), src: 'tradovate' };
    return null;
  }

  function notesFor(t) {
    return 'Tradovate sync · ' + (t.rawContract || t.ticker) +
      (t.scaled ? ' · ' + t.inCount + ' in / ' + t.outCount + ' out' : '') +
      (t.fees > 0 ? ' · gross $' + t.grossPnl.toFixed(2) + ' − fees $' + t.fees.toFixed(2) + (t.feeSource === 'tradovate' ? ' (from Tradovate)' : ' (your rate)') : '');
  }

  /* Fills → round-trip trades. Position accounting per account + contract:
     a trade runs from flat back to flat; reversals are split. Mirrors the
     importer's Tradovate parser. */
  function buildTrades(rows, accounts) {
    var byNum = {};
    accounts.forEach(function (a) { var n = normAcct(a.accountNumber); if (n) byNum[n] = a; });
    var fills = rows.map(function (r, i) {
      var t = localTime(r['Fill Time']);
      var fee = r['Fee'] === '' || r['Fee'] == null ? null : +r['Fee'];
      return { i: i, side: /^b/i.test(r['B/S']) ? 'BUY' : 'SELL', qty: parseInt(r['filledQty'], 10) || 0,
               price: parseFloat(r['avgPrice']) || 0, raw: r['Contract'] || '', sym: stripExpiry(r['Contract']),
               account: r['Account'] || '', origin: String(r['Text'] || '').trim(), fee: isFinite(fee) ? fee : null,
               iso: t.iso, time: t.time, ts: t.ts };
    }).filter(function (f) { return f.qty > 0 && f.price > 0 && f.ts; })
      .sort(function (a, b) { return (a.ts - b.ts) || (a.i - b.i); });

    var state = {}, out = { trades: [], held: {}, unknown: {} };
    function wAvg(arr) { var q = 0, v = 0; arr.forEach(function (f) { q += f.qty; v += f.qty * f.price; }); return q ? v / q : 0; }
    function flush(sym, camp) {
      if (!camp.length) return;
      var acctId = camp[0].account, acct = byNum[normAcct(acctId)];
      if (!acct) { out.unknown[acctId] = (out.unknown[acctId] || 0) + 1; return; }
      var entrySide = camp[0].side;
      var buyVal = 0, sellVal = 0, sides = 0, tvFees = 0, feeKnown = true;
      camp.forEach(function (f) {
        if (f.side === 'BUY') buyVal += f.qty * f.price; else sellVal += f.qty * f.price;
        sides += f.qty;
        if (f.fee == null) feeKnown = false; else tvFees += f.fee * (f.portion || 1);
      });
      var gross = money((sellVal - buyVal) * pointValue(sym));
      var feeTv = feeKnown ? money(tvFees) : null;
      var fee = feesFor(acct, sides, feeTv);
      if (!fee) { out.held[acct.name] = (out.held[acct.name] || 0) + 1; return; }
      var entries = camp.filter(function (f) { return f.side === entrySide; });
      var exits = camp.filter(function (f) { return f.side !== entrySide; });
      var entryQty = entries.reduce(function (s, f) { return s + f.qty; }, 0);
      var first = camp[0], last = camp[camp.length - 1];
      var fmt = function (v) { return (Math.round(v * 1e6) / 1e6).toString(); };
      var ep = fmt(wAvg(entries)), xp = fmt(wAvg(exits));
      var pnl = money(gross - fee.fees);
      var origin = Array.from(new Set(camp.map(function (f) { return f.origin; }).filter(Boolean))).join(' + ');
      var t = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        date: first.iso, entryTime: first.time, exitTime: last.time,
        ticker: sym, direction: entrySide === 'BUY' ? 'LONG' : 'SHORT', grade: '',
        result: resultOf(pnl), netPnl: pnl, grossPnl: gross, fees: fee.fees, commissions: fee.fees,
        pnlMode: 'price', tp1Pnl: gross, tp1Contracts: entryQty, tp2Pnl: 0, tp2Contracts: 0,
        contracts: String(entryQty),
        dedupeKey: [acctId, first.ts, last.ts, ep, xp, entryQty].join('|'),
        entryPrice: ep, entry: ep, exitPrice: xp, tp1Price: xp, tp1Exit: xp,
        tp2Price: null, tp2Exit: null, slPrice: null, sl: null,
        strategy: 'Live Trade',
        accountName: acct.name, accountNumber: acctId, accountType: acct.accountType || '',
        accountSize: acct.accountSize || null, accountMatched: true,
        origin: origin, liquidated: camp.some(function (f) { return /autoliq/i.test(f.origin || ''); }),
        source: 'tradovate-sync',
        // Kept so a commission change can re-price this trade later.
        sides: sides, tvFees: feeTv, feeSource: fee.src,
        rawContract: first.raw, scaled: entries.length > 1 || exits.length > 1, inCount: entries.length, outCount: exits.length
      };
      t.notes = notesFor(t);
      delete t.scaled; delete t.inCount; delete t.outCount;
      out.trades.push(t);
    }
    fills.forEach(function (f) {
      var key = f.account + '|' + f.sym;
      var S = state[key] || (state[key] = { pos: 0, camp: [] });
      var signed = f.side === 'BUY' ? f.qty : -f.qty;
      if (S.pos !== 0 && (S.pos > 0) !== (signed > 0) && Math.abs(signed) > Math.abs(S.pos)) {
        var closeQty = Math.abs(S.pos), openQty = Math.abs(signed) - closeQty;
        // A split fill's fee is shared in proportion to the contracts on each side.
        S.camp.push(Object.assign({}, f, { qty: closeQty, portion: closeQty / f.qty }));
        flush(f.sym, S.camp);
        S.camp = [Object.assign({}, f, { qty: openQty, portion: openQty / f.qty })];
        S.pos = signed > 0 ? openQty : -openQty;
        return;
      }
      S.camp.push(f);
      var prev = S.pos; S.pos += signed;
      if (S.pos === 0 && prev !== 0) { flush(f.sym, S.camp); S.camp = []; }
    });
    return out;
  }

  /* Re-price synced trades for one account after its commission changes.
     Returns { trades, changed }. */
  function reprice(trades, accounts, accountName) {
    var acct = accounts.find(function (a) { return a.name === accountName; });
    var changed = 0;
    var next = trades.map(function (t) {
      if (t.source !== 'tradovate-sync' || t.accountName !== accountName || !t.sides) return t;
      var fee = feesFor(acct, t.sides, t.tvFees);
      if (!fee || (fee.fees === t.fees && fee.src === t.feeSource)) return t;
      changed++;
      var n = Object.assign({}, t, { fees: fee.fees, commissions: fee.fees, feeSource: fee.src });
      n.netPnl = money(n.grossPnl - fee.fees); n.result = resultOf(n.netPnl);
      n.notes = String(t.notes || '').replace(/ · gross \$.*$/, '') + (fee.fees > 0 ? ' · gross $' + n.grossPnl.toFixed(2) + ' − fees $' + fee.fees.toFixed(2) + (fee.src === 'tradovate' ? ' (from Tradovate)' : ' (your rate)') : '');
      return n;
    });
    return { trades: next, changed: changed };
  }

  function post(body) {
    return fetch(JOURNAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || (d && d.error)) throw new Error((d && d.error) || ('HTTP ' + r.status)); return d; }); });
  }
  function authed(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + (localStorage.getItem('fsdx_token') || '') }, opts.headers || {});
    return fetch(API + '/api/tradovate' + path, opts).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }

  var running = null;
  /* One pass. opts: { whopKey, quiet } → { added, held:{name:n}, newAccounts:[names], error } */
  function run(opts) {
    if (running) return running;
    opts = opts || {};
    var whopKey = opts.whopKey;
    running = (async function () {
      var res = { added: 0, held: {}, unknown: {}, newAccounts: [], connected: false };
      if (!whopKey || !localStorage.getItem('fsdx_token')) return res;
      var st = await authed('/status');
      if (!st.ok || !st.data || !st.data.connections || !st.data.connections.length) return res;
      res.connected = true;

      // ── 1. new Tradovate accounts → My Accounts + a "Needs setup" card ──
      var settings = await post({ action: 'get-settings', key: whopKey });
      var accounts = Array.isArray(settings.accounts) ? settings.accounts : [];
      var known = new Set(accounts.map(function (a) { return normAcct(a.accountNumber); }).filter(Boolean));
      var fresh = [];
      st.data.connections.forEach(function (c) {
        (c.accounts || []).forEach(function (a) {
          if (a.active === false || a.archived) return;
          var n = normAcct(a.name);
          if (!n || known.has(n)) return;
          known.add(n);
          var name = a.nickname || a.name, k = 2;
          while (accounts.some(function (x) { return x.name === name; })) name = (a.nickname || a.name) + ' (' + (k++) + ')';
          fresh.push({ id: Date.now().toString() + Math.random().toString(36).slice(2, 6), name: name,
                       accountNumber: n, accountSize: null, accountType: '', commissionRate: null,
                       tradovate: true, addedBy: 'tradovate-sync', addedAt: new Date().toISOString() });
        });
      });
      if (fresh.length) {
        // Cards first: if this read fails we must not write over the member's setups.
        var cardsRes = await post({ action: 'get-trades', key: 'tracker_settings:' + whopKey });
        if (!Array.isArray(cardsRes.trades)) throw new Error('could not read account setups');
        var cards = cardsRes.trades;
        fresh.forEach(function (a) {
          if (cards.some(function (c) { return c.filterName === a.name; })) return;
          cards.push({ id: Date.now().toString() + Math.random().toString(36).slice(2), label: a.name,
                       filterType: '', filterName: a.name, accountSize: null, needsSetup: true,
                       stage: '', createdAt: new Date().toISOString(), alerts: {} });
        });
        accounts = accounts.concat(fresh);
        await post({ action: 'save-settings', key: whopKey, payload: { accounts: accounts } });
        await post({ action: 'save-all', key: 'tracker_settings:' + whopKey, payload: { trades: cards } });
        res.newAccounts = fresh.map(function (a) { return a.name; });
      }

      // ── 2. fills → trades → journal (new ones only) ──
      var fl = await authed('/fills');
      if (!fl.ok) throw new Error((fl.data && fl.data.error) || 'could not load synced fills');
      var built = buildTrades(fl.data.rows || [], accounts);
      res.held = built.held; res.unknown = built.unknown;
      if (built.trades.length) {
        var jr = await post({ action: 'get-trades', key: whopKey });    // fresh copy right before saving
        var existing = Array.isArray(jr.trades) ? jr.trades : [];
        var keys = new Set(existing.map(tradeKey));
        var add = built.trades.filter(function (t) { return !keys.has(tradeKey(t)); });
        if (add.length) {
          var at = new Date().toISOString(), id = 'imp_tv_' + Date.now();
          add = add.map(function (t) { return Object.assign(t, { importBatch: id, importBatchLabel: 'Tradovate sync', importedAt: at }); });
          var merged = existing.concat(add).sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
          await post({ action: 'save-all', key: whopKey, payload: { trades: merged } });
          res.added = add.length;
        }
      }
      try { localStorage.setItem('fsdx_tv_last', JSON.stringify({ at: Date.now(), added: res.added, held: res.held })); } catch (e) {}
      return res;
    })().catch(function (e) {
      console.warn('[FSDXTv] auto-import skipped:', e.message);
      return { added: 0, held: {}, unknown: {}, newAccounts: [], error: e.message };
    }).finally(function () { running = null; });
    return running;
  }

  /* Start the loop on a page. onResult(res) runs after every pass that changed something. */
  function start(getWhopKey, onResult, canRun) {
    function tick() {
      var k = typeof getWhopKey === 'function' ? getWhopKey() : getWhopKey;
      if (!k) return;
      if (canRun && !canRun()) return;          // e.g. a setup form is open — try next time
      run({ whopKey: k }).then(function (res) {
        if (onResult && (res.added || (res.newAccounts && res.newAccounts.length))) onResult(res);
        window.dispatchEvent(new CustomEvent('fsdx:tradovate-sync', { detail: res }));
      });
    }
    tick();
    setInterval(function () { if (!document.hidden) tick(); }, EVERY_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      var last = 0; try { last = (JSON.parse(localStorage.getItem('fsdx_tv_last') || '{}').at) || 0; } catch (e) {}
      if (Date.now() - last > EVERY_MS) tick();
    });
  }

  window.FSDXTv = { run: run, start: start, reprice: reprice, buildTrades: buildTrades, feesFor: feesFor, tradeKey: tradeKey };
})();
