/* ==========================================================================
   admin-people.js — Admin → People
   One row per person. Merges what used to live in three tabs:
     Roster   (Whop: plan, status, renewal, Discord/TV, notes)  → rosterData
     Members  (site accounts: created, last login, key)          → allMembers
     Activity (what changed, per person)                         → activityData
   plus NinjaTrader license state (admin-nt.js), payments (paymentsData),
   flags (flagsData) and the server event log (/api/admin/events).
   Read-only merge: edits still go through the existing modals, so nothing
   about how records are stored changes. Classic tabs stay reachable.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var CHIP = 'current', QUERY = '', SORT = 'status', OPEN = null, SHOW = 60;
  var SRV = [];   // server events, newest first

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  // admin.html keeps these as top-level `let`s — readable by name, not via window.
  function G(name) {
    var v;
    try {
      if (name === 'rosterData') v = rosterData;
      else if (name === 'allMembers') v = allMembers;
      else if (name === 'paymentsData') v = paymentsData;
      else if (name === 'activityData') v = activityData;
      else if (name === 'flagsData') v = flagsData;
    } catch (e) { v = null; }
    return Array.isArray(v) ? v : [];
  }
  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function low(s) { return String(s || '').trim().toLowerCase(); }
  function ctDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); }
  function dayOf(s) { if (!s) return ''; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (isNaN(new Date(s)) ? String(s).slice(0, 10) : ctDay(new Date(s))); }
  function fmtD(s, withYear) {
    var d = dayOf(s); if (!d) return '—';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
  }
  function ago(s) {
    if (!s) return '';
    var t = new Date(s).getTime(); if (isNaN(t)) return '';
    var d = (Date.now() - t) / 864e5;
    if (d < 1) return 'today'; if (d < 2) return 'yesterday'; if (d < 45) return Math.floor(d) + 'd ago';
    return Math.round(d / 30) + 'mo ago';
  }
  function usd(n) { n = Number(n) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2400);
  }

  /* ── Merge ───────────────────────────────────────────────────────────── */
  var STATUS = {
    past_due:        { l: 'Past due',     c: 'p-red', rank: 0 },
    active:          { l: 'Active',       c: 'p-grn', rank: 2 },
    trialing:        { l: 'Trial',        c: 'p-blu', rank: 3 },
    canceling:       { l: 'Cancelling',   c: 'p-amb', rank: 4 },
    trial_cancelled: { l: 'Trial cancel', c: 'p-amb', rank: 4 },
    lifetime:        { l: 'Lifetime',     c: 'p-pur', rank: 5 },
    yearly:          { l: 'Yearly',       c: 'p-grn', rank: 2 },
    legacy:          { l: 'Legacy',       c: 'p-pur', rank: 5 },
    inactive:        { l: 'Inactive',     c: 'p-mut', rank: 7 },
    cancelled:       { l: 'Ended',        c: 'p-mut', rank: 8 },
    site_only:       { l: 'Site only',    c: 'p-mut', rank: 6 },
  };
  var LIVE = ['active', 'trialing', 'canceling', 'trial_cancelled', 'past_due', 'lifetime', 'yearly', 'legacy'];

  function productOf(r) { return r.productName || r.planName || r.accessType || ''; }
  function family(p) {
    p = low(p);
    if (/raven/.test(p)) return 'raven';
    if (/nightwing/.test(p)) return 'nightwing';
    if (/nexus/.test(p)) return 'nexus';
    if (/pro|plus|vip|lifetime|knightfall|orb/.test(p)) return 'pro';
    return 'other';
  }

  function build() {
    var map = {}, order = [];
    function get(email, fallbackKey) {
      var k = low(email) || fallbackKey; if (!k) return null;
      if (!map[k]) { map[k] = { key: k, email: low(email), r: null, site: null, nt: null, pays: [], acts: [], srv: [], flags: [] }; order.push(k); }
      return map[k];
    }
    G('rosterData').forEach(function (r) {
      var p = get(r.email, r.whopKey || r.id); if (!p) return;
      // Prefer the live record if a person somehow has two.
      if (!p.r || (STATUS[r.status] || { rank: 9 }).rank < (STATUS[p.r.status] || { rank: 9 }).rank) p.r = r;
    });
    G('allMembers').forEach(function (m) { var p = get(m.email); if (p) p.site = m; });
    var nt = window.ntData && window.ntData();
    (nt && nt.records || []).forEach(function (n) { var p = get(n.email); if (p) p.nt = n; });
    G('paymentsData').forEach(function (x) { var p = map[low(x.email)]; if (p) p.pays.push(x); });
    G('activityData').forEach(function (e) { var p = map[low(e.email)]; if (p) p.acts.push(e); });
    SRV.forEach(function (e) { var p = map[low(e.email)]; if (p) p.srv.push(e); });
    G('flagsData').forEach(function (f) {
      if (f.dismissed) return;
      var p = map[low(f.email)]; if (p) p.flags.push(f);
    });

    return order.map(function (k) {
      var p = map[k], r = p.r || {}, s = p.site || {};
      p.name = r.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || (p.nt && p.nt.name) || r.whopUsername || p.email || '—';
      p.status = p.r ? (r.status || 'inactive') : (p.site ? 'site_only' : 'inactive');
      p.live = LIVE.indexOf(p.status) !== -1;
      p.product = productOf(r) || (s.tier ? 'Site · ' + s.tier : '');
      p.fam = family(p.product);
      p.paid = p.pays.filter(function (x) { return x.status === 'paid'; })
        .reduce(function (t, x) { return t + (x.amount || 0) - (x.refundedAmount || 0); }, 0);
      if (!p.paid && r.spend) p.paid = parseFloat(r.spend) || 0;
      p.failedOpen = p.pays.some(function (x) {
        return x.status !== 'paid' && x.status !== 'open' && !p.pays.some(function (y) { return y.status === 'paid' && (y.paidAt || '') > (x.paidAt || ''); });
      });
      var ntTask = p.nt && (p.nt.status === 'remove' || (p.nt.status === 'pending' && p.nt.ntEmail));
      p.needs = p.status === 'past_due' || p.failedOpen || !!ntTask || p.flags.length > 0;
      p.ntState = !p.nt ? (p.fam === 'pro' && p.live ? 'none' : '')
        : p.nt.status === 'active' ? 'active'
        : p.nt.status === 'remove' ? 'remove'
        : p.nt.status === 'pending' ? (p.nt.ntEmail ? 'add' : 'waiting')
        : p.nt.status === 'declined' ? 'declined' : 'removed';
      p.next = p.status === 'canceling' || p.status === 'trial_cancelled' ? { k: 'Ends', d: r.cancelingDate || r.renewal }
        : p.status === 'cancelled' ? { k: 'Left', d: r.leftDate || r.churnedDate }
        : p.status === 'trialing' ? { k: 'Converts', d: r.renewal }
        : r.renewal && p.live && p.status !== 'lifetime' ? { k: 'Renews', d: r.renewal } : null;
      p.lastLogin = s.lastLogin || '';
      return p;
    });
  }

  /* ── Styles ──────────────────────────────────────────────────────────── */
  var CSS = ''
    + '#panel-people .pp-t{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '#panel-people .pp-t th{text-align:left;font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:900;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap;cursor:pointer;user-select:none}'
    + '#panel-people .pp-t th.on{color:#FF8A4C}'
    + '#panel-people .pp-t td{padding:10px;border-bottom:1px solid rgba(255,255,255,.05);color:#a1a1aa;vertical-align:middle}'
    + '#panel-people .pp-t tr.pp-r{cursor:pointer} #panel-people .pp-t tr.pp-r:hover td{background:rgba(255,255,255,.02)}'
    + '#panel-people .pp-t tr.needs td:first-child{box-shadow:inset 3px 0 0 #E2534B}'
    + '#panel-people .pp-t tr.sel td{background:rgba(255,107,31,.06)}'
    + '#panel-people .mn-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:5px;border:1px solid;white-space:nowrap}'
    + '#panel-people .p-red{color:#E2534B;border-color:rgba(226,83,75,.45);background:rgba(226,83,75,.08)}'
    + '#panel-people .p-amb{color:#F5A524;border-color:rgba(245,165,36,.45);background:rgba(245,165,36,.08)}'
    + '#panel-people .p-grn{color:#2FBF7E;border-color:rgba(47,191,126,.4);background:rgba(47,191,126,.07)}'
    + '#panel-people .p-blu{color:#7FB2FF;border-color:rgba(127,178,255,.4);background:rgba(127,178,255,.07)}'
    + '#panel-people .p-pur{color:#C4A5FF;border-color:rgba(196,165,255,.4);background:rgba(196,165,255,.07)}'
    + '#panel-people .p-mut{color:#8A97A8;border-color:#253244}'
    + '#panel-people .p-nt{color:#FF6B1F;border-color:rgba(255,107,31,.45);background:rgba(255,107,31,.08)}'
    + '#panel-people .pp-sub{font-size:11px;color:#71717a}'
    + '#panel-people .pp-wrap{display:grid;gap:16px;grid-template-columns:1fr}'
    + '@media(min-width:1180px){#panel-people .pp-wrap.open{grid-template-columns:minmax(0,1fr) 420px}}'
    + '#panel-people .pp-side{position:relative}'
    + '@media(min-width:1180px){#panel-people .pp-side{position:sticky;top:12px;align-self:start;max-height:calc(100vh - 24px);overflow:auto}}'
    + '@media(max-width:1179px){#panel-people .pp-side{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.6);padding:12px;overflow:auto}}'
    + '#panel-people .pp-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin-top:12px}'
    + '#panel-people .pp-kv .k{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#52525b}'
    + '#panel-people .pp-kv .v{font-size:12.5px;color:#e4e4e7;font-weight:600;word-break:break-word}'
    + '#panel-people .pp-sec{font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#71717a;margin:18px 0 6px}'
    + '#panel-people .pp-tl{border-left:1px solid rgba(255,255,255,.08);margin-left:5px;padding-left:14px}'
    + '#panel-people .pp-ev{position:relative;padding:6px 0;font-size:12px;color:#a1a1aa}'
    + '#panel-people .pp-ev:before{content:"";position:absolute;left:-18px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--c,#52525b)}'
    + '#panel-people .pp-ev b{color:#fff}'
    + '#panel-people .pp-copy{cursor:pointer;border-bottom:1px dashed rgba(255,255,255,.2)}#panel-people .pp-copy:hover{color:#FF6B1F}'
    + '#panel-people .pp-flag{display:inline-block;width:7px;height:7px;border-radius:50%;background:#E2534B;margin-left:6px;vertical-align:1px}';

  function skeleton() {
    var p = $('panel-people'); if (!p || p.getAttribute('data-ready')) return;
    p.setAttribute('data-ready', '1'); p.classList.add('ntx');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    p.innerHTML = ''
      + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
      +   '<div><h2 class="text-lg font-black text-white">People</h2>'
      +   '<div id="pp-sub" class="text-[11px] text-zinc-600 mt-0.5">Whop + site accounts + NinjaTrader, one row per person</div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap">'
      +     '<button class="ntx-btn" onclick="peopleSync()">&#10227; Sync Whop now</button>'
      +     '<span class="text-[10.5px] text-zinc-600">Classic:</span>'
      +     '<button class="ntx-btn" onclick="switchTab(\'members\')">Site accounts</button>'
      +     '<button class="ntx-btn" onclick="switchTab(\'roster\')">Roster</button>'
      +     '<button class="ntx-btn" onclick="switchTab(\'activity\')">Activity</button>'
      +   '</div>'
      + '</div>'
      + '<div id="pp-stats" class="ntx-grid mb-4"></div>'
      + '<div class="ntx-card mb-4"><div class="flex gap-1 flex-wrap items-center" id="pp-chips"></div></div>'
      + '<div class="pp-wrap" id="pp-wrap">'
      +   '<div class="ntx-card" style="padding:6px 8px;min-width:0"><div style="overflow-x:auto"><div id="pp-table"></div></div></div>'
      +   '<div class="pp-side" id="pp-side" style="display:none"></div>'
      + '</div>';
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  var PEOPLE = [];
  var CHIPS = [
    ['current', 'Current', function (p) { return p.live; }],
    ['needs', 'Needs action', function (p) { return p.needs; }],
    ['pro', 'Pro / NinjaTrader', function (p) { return p.live && p.fam === 'pro'; }],
    ['raven', 'Raven', function (p) { return p.live && p.fam === 'raven'; }],
    ['nightwing', 'Nightwing', function (p) { return p.live && p.fam === 'nightwing'; }],
    ['nexus', 'Nexus', function (p) { return p.live && p.fam === 'nexus'; }],
    ['trial', 'Trials', function (p) { return p.status === 'trialing'; }],
    ['cancel', 'Cancelling', function (p) { return p.status === 'canceling' || p.status === 'trial_cancelled'; }],
    ['pastdue', 'Past due', function (p) { return p.status === 'past_due' || p.failedOpen; }],
    ['lifetime', 'Lifetime', function (p) { return p.status === 'lifetime'; }],
    ['nosite', 'No site account', function (p) { return p.live && !p.site; }],
    ['ended', 'Ended', function (p) { return p.status === 'cancelled' || p.status === 'inactive'; }],
    ['all', 'Everyone', function () { return true; }],
  ];
  function chipFn() { for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i][0] === CHIP) return CHIPS[i][2]; return CHIPS[0][2]; }

  function renderStats() {
    var live = PEOPLE.filter(function (p) { return p.live; });
    var paying = live.filter(function (p) { return p.status !== 'trialing' && p.status !== 'trial_cancelled'; });
    function card(n, l, cls, chip) { return '<div class="ntx-stat ' + (cls || '') + '" data-pchip="' + chip + '" style="cursor:pointer"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    var needs = PEOPLE.filter(function (p) { return p.needs; }).length;
    $('pp-stats').innerHTML =
        card(paying.length, 'Paying members', 'green', 'current')
      + card(live.filter(function (p) { return p.status === 'trialing'; }).length, 'In trial', '', 'trial')
      + card(live.filter(function (p) { return p.fam === 'pro'; }).length, 'Pro / NinjaTrader', '', 'pro')
      + card(live.filter(function (p) { return p.status === 'canceling' || p.status === 'trial_cancelled'; }).length, 'Cancelling', 'amber', 'cancel')
      + card(needs, 'Need action', needs ? 'red' : '', 'needs');
  }

  function renderChips() {
    $('pp-chips').innerHTML = CHIPS.map(function (c) {
      var n = PEOPLE.filter(c[2]).length;
      return '<button class="ntx-chip' + (CHIP === c[0] ? ' on' : '') + '" data-pchip="' + c[0] + '">' + c[1] + ' <span class="text-zinc-600">' + n + '</span></button>';
    }).join('') + '<input id="pp-q" class="ntx-in" placeholder="Search name, email, Discord, TradingView, NT email" style="flex:1 1 220px;min-width:180px" value="' + esc(QUERY) + '">';
    var q = $('pp-q'); q.oninput = function () { QUERY = low(q.value); SHOW = 60; renderTable(); };
  }

  function ntCell(p) {
    var tv = p.r && p.r.tvUsername ? '<span class="mn-pill p-blu" title="TradingView: ' + esc(p.r.tvUsername) + '">TV</span> ' : '';
    var m = { active: ['p-nt', 'NT ✓'], add: ['p-amb', 'NT · to add'], remove: ['p-red', 'NT · remove'],
      waiting: ['p-amb', 'NT · no email'], declined: ['p-mut', 'NT · not using'], removed: ['p-mut', 'NT · removed'], none: ['p-mut', 'NT · —'] }[p.ntState];
    return tv + (m ? '<span class="mn-pill ' + m[0] + '">' + m[1] + '</span>' : '') || '<span class="text-zinc-700">—</span>';
  }

  function sorted(list) {
    var by = {
      status: function (a, b) { return (b.needs - a.needs) || ((STATUS[a.status] || { rank: 9 }).rank - (STATUS[b.status] || { rank: 9 }).rank) || a.name.localeCompare(b.name); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
      next: function (a, b) { return (dayOf(a.next && a.next.d) || '9999') < (dayOf(b.next && b.next.d) || '9999') ? -1 : 1; },
      paid: function (a, b) { return b.paid - a.paid; },
      seen: function (a, b) { return (b.lastLogin || '') > (a.lastLogin || '') ? 1 : -1; },
      joined: function (a, b) { return ((b.r && b.r.joined) || '') > ((a.r && a.r.joined) || '') ? 1 : -1; },
    }[SORT];
    return list.slice().sort(by);
  }

  function renderTable() {
    var fn = chipFn();
    var list = sorted(PEOPLE.filter(fn).filter(function (p) {
      if (!QUERY) return true;
      var r = p.r || {};
      return [p.name, p.email, r.discordName, r.tvUsername, r.whopUsername, p.nt && p.nt.ntEmail, p.product].join(' ').toLowerCase().indexOf(QUERY) !== -1;
    }));
    var th = function (k, l) { return '<th data-psort="' + k + '" class="' + (SORT === k ? 'on' : '') + '">' + l + '</th>'; };
    if (!list.length) { $('pp-table').innerHTML = '<div class="text-[12px] text-zinc-500 p-4">' + (PEOPLE.length ? 'No one matches.' : 'No data yet. Press Sync Whop now.') + '</div>'; return; }
    $('pp-table').innerHTML = '<table class="pp-t"><tr>' + th('status', 'Member') + '<th>Plan</th>' + th('next', 'Next') + '<th>Access</th>' + th('seen', 'Site') + th('paid', 'Paid') + '</tr>'
      + list.slice(0, SHOW).map(function (p) {
        var st = STATUS[p.status] || STATUS.inactive;
        var next = p.next && p.next.d ? '<div class="text-zinc-300">' + fmtD(p.next.d) + '</div><div class="pp-sub">' + p.next.k + '</div>' : '<span class="text-zinc-700">—</span>';
        var site = p.site ? (p.lastLogin ? '<span class="text-zinc-300">' + ago(p.lastLogin) + '</span>' : '<span class="pp-sub">account</span>') : '<span class="pp-sub">no account</span>';
        return '<tr class="pp-r' + (p.needs ? ' needs' : '') + (OPEN === p.key ? ' sel' : '') + '" data-pk="' + esc(p.key) + '">'
          + '<td><div class="text-white font-bold">' + esc(p.name) + (p.flags.length ? '<span class="pp-flag" title="Flagged"></span>' : '') + '</div><div class="pp-sub">' + esc(p.email || (p.r && p.r.discordName) || '') + '</div></td>'
          + '<td><span class="mn-pill ' + st.c + '">' + st.l + '</span><div class="pp-sub mt-1">' + esc(p.product || '—') + '</div></td>'
          + '<td>' + next + '</td>'
          + '<td>' + ntCell(p) + '</td>'
          + '<td>' + site + '</td>'
          + '<td class="text-white font-bold" style="font-variant-numeric:tabular-nums">' + (p.paid ? usd(p.paid) : '<span class="text-zinc-700">—</span>') + '</td>'
          + '</tr>';
      }).join('') + '</table>'
      + (list.length > SHOW ? '<div class="p-3 text-center"><button class="ntx-btn" data-pmore="1">Show more (' + (list.length - SHOW) + ')</button></div>' : '')
      + '<div class="pp-sub p-2">' + list.length + ' ' + (list.length === 1 ? 'person' : 'people') + '</div>';
  }

  /* ── Side panel ──────────────────────────────────────────────────────── */
  var EVLABEL = {
    member_joined: 'Joined', trial_started: 'Trial started', trial_ending: 'Trial ending soon', payment: 'Payment',
    payment_failed: 'Payment failed', past_due: 'Past due', cancel_scheduled: 'Cancel scheduled', cancel_reverted: 'Cancel reversed',
    access_lost: 'Membership ended', refund: 'Refund', dispute: 'Dispute', nt_task: 'NinjaTrader task', nt_download: 'Downloaded NT',
    task_overdue: 'Task overdue',
  };
  function timeline(p) {
    var items = [];
    p.pays.forEach(function (x) {
      var ok = x.status === 'paid';
      items.push({ at: x.paidAt, c: ok ? '#2FBF7E' : '#E2534B',
        h: '<b>' + (ok ? (x.billingReason === 'subscription_create' ? 'First payment' : 'Payment') : 'Payment failed') + '</b> · $' + (Number(x.amount) || 0).toFixed(2)
          + ' <span class="pp-sub">' + esc(x.description || '') + (!ok && x.failureReason ? ' · ' + esc(x.failureReason) : '') + ((x.refundedAmount || 0) > 0 ? ' · refunded' : '') + '</span>' });
    });
    p.srv.forEach(function (e) {
      if (e.type === 'payment' || e.type === 'payment_failed') return;   // payments already listed
      items.push({ at: e.at, c: /lost|fail|due|dispute|overdue/.test(e.type) ? '#E2534B' : /cancel/.test(e.type) ? '#F5A524' : /nt_/.test(e.type) ? '#FF6B1F' : '#7FB2FF',
        h: '<b>' + esc(EVLABEL[e.type] || e.type) + '</b>' + (e.detail ? ' <span class="pp-sub">' + esc(e.detail) + '</span>' : '') });
    });
    p.acts.forEach(function (e) {
      if (/pay/.test(e.type)) return;
      items.push({ at: e.at, c: e.lv === 'bad' || e.lv === 'risk' ? '#E2534B' : e.lv === 'warn' ? '#F5A524' : '#7FB2FF',
        h: '<b>' + esc(e.title || e.type) + '</b>' + (e.detail ? ' <span class="pp-sub">' + esc(e.detail) + '</span>' : '') });
    });
    var r = p.r || {};
    if (r.joined) items.push({ at: r.joined, c: '#7FB2FF', h: '<b>Joined Whop</b> <span class="pp-sub">' + esc(productOf(r)) + '</span>' });
    if (p.site && p.site.createdAt) items.push({ at: p.site.createdAt, c: '#7FB2FF', h: '<b>Site account created</b>' });
    if (p.nt && p.nt.activatedAt) items.push({ at: p.nt.activatedAt, c: '#FF6B1F', h: '<b>NT license added</b> <span class="pp-sub">' + esc(p.nt.ntEmail || '') + '</span>' });
    items.sort(function (a, b) { return (b.at || '') > (a.at || '') ? 1 : -1; });
    // Drop exact duplicates (same label, same day) from overlapping sources.
    var seen = {};
    items = items.filter(function (i) { var m = i.h.match(/<b>([^<]*)<\/b>/); var k = dayOf(i.at) + '|' + (m ? m[1] : i.h); if (seen[k]) return false; seen[k] = 1; return true; });
    if (!items.length) return '<div class="pp-sub py-2">No history yet.</div>';
    return '<div class="pp-tl">' + items.slice(0, 40).map(function (i) {
      return '<div class="pp-ev" style="--c:' + i.c + '">' + i.h + '<div class="pp-sub">' + fmtD(i.at, true) + '</div></div>';
    }).join('') + '</div>';
  }

  function renderSide() {
    var side = $('pp-side'), wrap = $('pp-wrap');
    var p = OPEN && PEOPLE.filter(function (x) { return x.key === OPEN; })[0];
    if (!p) { side.style.display = 'none'; wrap.classList.remove('open'); return; }
    side.style.display = ''; wrap.classList.add('open');
    var r = p.r || {}, s = p.site || {}, st = STATUS[p.status] || STATUS.inactive;
    var rt = ''; try { var t = r.renewal ? renewalTime(r) : null; rt = t ? ' · ' + (t.exact ? '' : '≈') + t.time : ''; } catch (e) {}
    var tenure = r.joined ? Math.max(0, Math.round((Date.now() - new Date(dayOf(r.joined) + 'T12:00:00')) / 864e5)) : null;
    function kv(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + (v || '<span class="text-zinc-600">—</span>') + '</div></div>'; }
    function copy(v) { return v ? '<span class="pp-copy" data-pcopy="' + esc(v) + '">' + esc(v) + '</span>' : ''; }

    var ntBlock = '';
    if (p.nt || p.fam === 'pro') {
      var n = p.nt || {};
      var ntLabel = { active: 'License active', add: 'License to add', remove: 'License to remove', waiting: 'Waiting for NT email',
        declined: 'Not using NinjaTrader', removed: 'License removed', none: 'Not in the NT list yet' }[p.ntState] || '—';
      ntBlock = '<div class="pp-sec">NinjaTrader</div><div class="ntx-card" style="padding:12px">'
        + '<div class="flex items-center justify-between gap-2"><div class="text-[12.5px] text-white font-bold">' + ntLabel + '</div>'
        + '<button class="ntx-btn" onclick="switchTab(\'nt\')">Open NT tab</button></div>'
        + '<div class="pp-kv">' + kv('NT email', copy(n.ntEmail)) + kv('Version', n.lastVersion ? 'v' + esc(n.lastVersion) : '')
        + kv('Added', n.activatedAt ? fmtD(n.activatedAt, true) : '') + kv('Downloads', n.downloads && n.downloads.length ? String(n.downloads.length) : '') + '</div></div>';
    }
    var flags = p.flags.length ? '<div class="pp-sec">Flags</div>' + p.flags.map(function (f) {
      return '<div class="text-[12px] text-red-400 py-1">' + (f.severity === 'red' ? '🔴 ' : '🟡 ') + esc(f.type) + ' <span class="pp-sub">' + esc(f.reason || '') + '</span></div>';
    }).join('') : '';
    var notes = (r.notes || r.cancelReason) ? '<div class="pp-sec">Notes</div><div class="text-[12px] text-zinc-300">'
      + (r.cancelReason ? '<div class="text-amber-400">Cancel reason: ' + esc(r.cancelReason) + '</div>' : '')
      + (r.notes && r.notes !== r.cancelReason ? esc(r.notes) : '') + '</div>' : '';

    side.innerHTML = '<div class="ntx-card" style="padding:18px">'
      + '<div class="flex items-start justify-between gap-2"><div style="min-width:0">'
      +   '<div class="text-lg font-black text-white">' + esc(p.name) + '</div>'
      +   '<div class="text-[12px] text-zinc-400">' + copy(p.email) + '</div></div>'
      +   '<button class="ntx-btn" data-pclose="1">&times;</button></div>'
      + '<div class="flex gap-2 flex-wrap mt-3"><span class="mn-pill ' + st.c + '">' + st.l + '</span>'
      +   (p.fam === 'pro' && p.live ? '<span class="mn-pill p-nt">Includes NT</span>' : '')
      +   (p.failedOpen ? '<span class="mn-pill p-red">Failed payment</span>' : '') + '</div>'
      + '<div class="pp-kv">'
      +   kv('Plan', esc(p.product)) + kv(p.next ? p.next.k : 'Next', p.next && p.next.d ? fmtD(p.next.d, true) + (p.next.k === 'Renews' ? esc(rt) : '') : '')
      +   kv('Member since', r.joined ? fmtD(r.joined, true) + (tenure != null ? ' <span class="pp-sub">· ' + tenure + 'd</span>' : '') : '')
      +   kv('Paid total', p.paid ? usd(p.paid) : '')
      +   kv('Discord', esc(r.discordName || '')) + kv('TradingView', copy(r.tvUsername))
      +   kv('Site account', p.site ? (s.createdAt ? 'Since ' + fmtD(s.createdAt, true) : 'Yes') : 'None')
      +   kv('Last on site', p.lastLogin ? ago(p.lastLogin) : '')
      + '</div>'
      + ntBlock + flags + notes
      + '<div class="pp-sec">History</div>' + timeline(p)
      + '<div class="flex gap-2 flex-wrap mt-4 pt-3" style="border-top:1px solid rgba(255,255,255,.06)">'
      +   (p.r && p.r.id ? '<button class="ntx-btn" data-pedit="' + esc(p.r.id) + '">Edit record</button>' : '')
      +   (p.email ? '<button class="ntx-btn" data-pcopy="' + esc(p.email) + '">Copy email</button>' : '')
      + '</div></div>';
  }

  /* ── Load / actions ──────────────────────────────────────────────────── */
  function loadServerEvents() {
    if (!tok()) return Promise.resolve();
    return fetch(API + '/api/admin/events?limit=300', { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.events) SRV = d.events; }).catch(function () {});
  }
  function renderAll() {
    PEOPLE = build();
    renderStats(); renderChips(); renderTable(); renderSide();
  }
  window.peopleRender = function () {
    skeleton(); if (!$('panel-people')) return;
    renderAll();
    var nt = window.ntLoad ? window.ntLoad().catch(function () {}) : Promise.resolve();
    Promise.all([loadServerEvents(), nt]).then(renderAll);
  };
  window.peopleSync = function () {
    if (typeof syncFromWhop !== 'function') return;
    toast('Syncing Whop…');
    Promise.resolve(syncFromWhop()).then(function () { renderAll(); toast('Synced'); }).catch(function (e) { toast((e && e.message) || 'Sync failed', true); });
  };

  document.addEventListener('click', function (e) {
    var p = $('panel-people'); if (!p || !p.contains(e.target)) return;
    var t = e.target;
    var ch = t.closest('[data-pchip]'); if (ch) { CHIP = ch.getAttribute('data-pchip'); SHOW = 60; renderChips(); renderTable(); return; }
    var so = t.closest('[data-psort]'); if (so) { SORT = so.getAttribute('data-psort'); renderTable(); return; }
    if (t.closest('[data-pmore]')) { SHOW += 100; renderTable(); return; }
    if (t.closest('[data-pclose]') || t.id === 'pp-side') { OPEN = null; renderTable(); renderSide(); return; }
    var cp = t.closest('[data-pcopy]');
    if (cp) { var v = cp.getAttribute('data-pcopy'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Copied ' + v); }).catch(function () { window.prompt('Copy:', v); }); return; }
    var ed = t.closest('[data-pedit]'); if (ed) { try { openEditMemberModal(ed.getAttribute('data-pedit')); } catch (x) { toast('Edit opens in Roster', true); } return; }
    var row = t.closest('[data-pk]'); if (row) { OPEN = row.getAttribute('data-pk'); renderTable(); renderSide(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && OPEN && $('panel-people') && $('panel-people').classList.contains('active')) { OPEN = null; renderTable(); renderSide(); } });

  // Re-render when the existing roster/members code refreshes its data.
  function wrap(name) {
    var f = window[name]; if (typeof f !== 'function' || f._pp) return;
    window[name] = function () {
      var r = f.apply(this, arguments);
      try { var p = $('panel-people'); if (p && p.classList.contains('active')) { if (r && r.then) r.then(renderAll); else renderAll(); } } catch (e) {}
      return r;
    };
    window[name]._pp = true;
  }
  function hook() { ['renderRoster', 'loadData'].forEach(wrap); }
  document.addEventListener('DOMContentLoaded', function () { skeleton(); hook(); });
  hook();
})();
