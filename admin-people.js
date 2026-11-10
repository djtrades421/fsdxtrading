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
  var CHIP = 'current', QUERY = '', SORT = 'status', REV = false, OPEN = null, SHOW = 60;
  var SRV = [];   // server events, newest first
  var RT = [];    // repeat-trial flags from the worker (/api/admin/repeat-trials)
  var ONB = {};   // onboarding emails sent / skipped (/api/admin/onboard), by email
  var ONB_T = []; // onboarding templates from the worker
  var ONB_F = []; // focus options from the worker (strategy / indicators / tools)
  var BULK = { tpl: 'checkin', mode: 'general', focus: [], days: 7, off: {}, running: false, stop: false, done: 0, total: 0 };
  var ONB_WINDOW = 21; // days after joining that someone sits in the onboarding queue
  // TradingView seats (TradingView terms from Feb 1, 2027). Settings + per-person
  // overrides live on the worker (/api/admin/tv-seats). Rules match tvSeatState()
  // in the worker, which sends the email alert — keep the two in step.
  var TVS = { threshold: 85, cap: 100, overrides: {} };
  var PROBE = {};  // membershipId -> last "Check Whop" result

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
    // Knightfall NT8 standalone. Before the pro test: its name has "knightfall" in it.
    if (/ninja/.test(p) && /standalone/.test(p)) return 'ntsolo';
    if (/nightwing/.test(p)) return 'nightwing';
    if (/nexus/.test(p)) return 'nexus';
    if (/pro|plus|vip|lifetime|knightfall|orb/.test(p)) return 'pro';
    return 'other';
  }
  /** Families whose membership includes a NinjaTrader 8 license. */
  function hasNt(fam) { return fam === 'pro' || fam === 'ntsolo'; }
  var TV_LIVE = ['active', 'trialing', 'canceling', 'trial_cancelled', 'yearly', 'legacy'];
  function tvFamily(product) {
    var x = low(product);
    if (/ninja/.test(x) && /standalone/.test(x)) return false;
    if (/nightwing|nexus/.test(x)) return false;
    return /raven|pro|plus|vip|lifetime|knightfall|orb/.test(x);
  }
  /** seat | unknown | lifetime | exempt | no | nt | '' — one seat per PERSON with live TradingView access.
      Past due is not a seat: a failed payment revokes TradingView right away. */
  function tvState(p) {
    var r = p.r || {}, ov = TVS.overrides[p.email] || '';
    if (ov === 'no') return 'no';
    if (ov === 'exempt') return 'exempt';
    var life = p.status === 'lifetime';
    if (!life && TV_LIVE.indexOf(p.status) === -1) return '';
    if (ov === 'yes') return 'seat';
    if (!tvFamily(p.product)) return '';
    if (life) return r.tvUsername ? 'lifetime' : '';
    if (r.tvUsername) return 'seat';
    // No TradingView username, but they gave a NinjaTrader email → NinjaTrader user.
    if (p.nt && p.nt.ntEmail && p.nt.status !== 'removed') return 'nt';
    return 'unknown';
  }
  /** Onboarding focus guess from the plan name. Only used when Danny clicks "Match plan". */
  function focusOf(p) {
    var s = low(p.product), f = [];
    if (/knightfall|\bpro\b|plus|orb|ninja|lifetime/.test(s)) f.push('strategy');
    if (/raven|nightwing/.test(s)) f.push('indicators');
    if (/nexus|site|vip/.test(s)) f.push('tools');
    return f;
  }
  function focusOpts() {
    return ONB_F.length ? ONB_F : [{ id: 'strategy', label: 'Knightfall (NinjaTrader / TradingView)' }, { id: 'indicators', label: 'TradingView indicators (Raven, Nightwing)' }, { id: 'tools', label: 'Nexus + member site' }];
  }
  function tplOpts(sel) {
    return (ONB_T.length ? ONB_T : [{ id: 'setup', label: 'New member · Setup call (30m)' }, { id: 'back', label: 'Returning member · Walkthrough (30m)' }, { id: 'checkin', label: 'Quick check-in (15m)' }])
      .map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('');
  }
  function tplLabel(id) { var t = ONB_T.filter(function (x) { return x.id === id; })[0]; return t ? t.label : id; }
  /** Last time any onboarding/check-in email went to them. */
  function lastMail(p) {
    var h = (p.onb && p.onb.history) || [], best = '';
    h.forEach(function (x) { if (x.action === 'sent' && x.at > best) best = x.at; });
    return best;
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
    // Server-side repeat-trial flags. get() so a brand-new trial shows up even
    // before the roster has been synced.
    RT.forEach(function (f) {
      if (f.dismissed) return;
      var p = get(f.email, f.id); if (!p) return;
      p.flags.push({
        rtId: f.id, severity: f.severity,
        type: f.severity === 'red' ? 'Repeat trial' : 'Trial while a member',
        reason: (f.product ? f.product + ' trial · ' : '') + 'before: '
          + (f.priors || []).map(function (x) { return (x.product || 'membership') + ' (' + (x.status || '?') + (x.email && x.email !== low(f.email) ? ', ' + x.email : '') + ')'; }).join(', '),
        priors: f.priors || [], at: f.at
      });
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
      p.ntState = !p.nt ? (hasNt(p.fam) && p.live ? 'none' : '')
        : p.nt.status === 'active' ? 'active'
        : p.nt.status === 'remove' ? 'remove'
        : p.nt.status === 'pending' ? (p.nt.ntEmail ? 'add' : 'waiting')
        : p.nt.status === 'declined' ? 'declined' : 'removed';
      p.next = p.status === 'canceling' || p.status === 'trial_cancelled' ? { k: 'Ends', d: r.cancelingDate || r.renewal }
        : p.status === 'cancelled' ? { k: 'Left', d: r.leftDate || r.churnedDate }
        : p.status === 'trialing' ? { k: 'Converts', d: r.renewal }
        : r.renewal && p.live && p.status !== 'lifetime' ? { k: 'Renews', d: r.renewal } : null;
      p.lastLogin = s.lastLogin || '';
      p.tv = tvState(p);
      p.onb = ONB[p.email] || null;
      var jd = dayOf(r.joined);
      p.daysIn = jd ? Math.round((Date.now() - new Date(jd + 'T12:00:00')) / 864e5) : null;
      // In the queue: live, joined recently, never sent or skipped.
      // Cancelled trials stay in: many cancel right away just to avoid the charge.
      p.toOnboard = p.live && !p.onb && !!p.email && p.daysIn != null && p.daysIn <= ONB_WINDOW;
      // Back after a past membership → the walkthrough fits better than first-time setup.
      p.returning = p.flags.some(function (f) { return f.rtId; });
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
      +     '<button class="ntx-btn" data-pbulk="open" title="Send a check-in to everyone in the list you have filtered" style="border-color:rgba(255,107,31,.6);color:#FF8A4C">Check in this list</button>'
      +     '<button class="ntx-btn" onclick="peopleSync()">&#10227; Sync Whop now</button>'
      +     '<span class="text-[10.5px] text-zinc-600">Classic:</span>'
      +     '<button class="ntx-btn" onclick="switchTab(\'members\')">Site accounts</button>'
      +     '<button class="ntx-btn" onclick="switchTab(\'roster\')">Roster</button>'
      +     '<button class="ntx-btn" onclick="switchTab(\'activity\')">Activity</button>'
      +   '</div>'
      + '</div>'
      + '<div id="pp-tv" class="mb-4"></div>'
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
    ['ntsolo', 'Knightfall NT8', function (p) { return p.live && p.fam === 'ntsolo'; }],
    ['tv', 'TV seats', function (p) { return p.tv === 'seat'; }],
    ['tvunknown', 'TV · unknown', function (p) { return p.tv === 'unknown'; }],
    ['raven', 'Raven', function (p) { return p.live && p.fam === 'raven'; }],
    ['nightwing', 'Nightwing', function (p) { return p.live && p.fam === 'nightwing'; }],
    ['nexus', 'Nexus', function (p) { return p.live && p.fam === 'nexus'; }],
    ['onboard', 'To onboard', function (p) { return p.toOnboard; }],
    ['trial', 'Trials', function (p) { return p.status === 'trialing'; }],
    ['repeat', 'Repeat trials', function (p) { return p.flags.some(function (f) { return f.rtId; }); }],
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
    renderTv();
  }

  function tvCounts() {
    var c = { seat: 0, unknown: 0, lifetime: 0, exempt: 0, nt: 0, pastdue: 0 };
    PEOPLE.forEach(function (p) {
      if (c[p.tv] !== undefined) c[p.tv]++;
      if (p.status === 'past_due' && p.r && p.r.tvUsername && !TVS.overrides[p.email]) c.pastdue++;
    });
    return c;
  }
  function renderTv() {
    var el = $('pp-tv'); if (!el) return;
    var c = tvCounts(), cap = TVS.cap || 100, warn = TVS.threshold || 85;
    var lvl = c.seat >= cap ? 'red' : c.seat >= warn ? 'amber' : (c.seat + c.unknown >= warn ? 'maybe' : '');
    var col = lvl === 'red' ? '#E2534B' : lvl === 'amber' ? '#F5A524' : '#7FB2FF';
    var pct = Math.min(100, Math.round(c.seat / cap * 100)), pctU = Math.min(100 - pct, Math.round(c.unknown / cap * 100));
    var msg = lvl === 'red' ? 'TradingView seats are full. New TradingView users can\'t be added or extended. Buy an extension, or point new checkouts to the product without the TradingView Pro app.'
      : lvl === 'amber' ? 'Past your ' + warn + '-seat warning. Decide now: buy an extension, or close TradingView to new members for a while.'
      : lvl === 'maybe' ? 'Under ' + warn + ' confirmed, but the unknowns could push it over. Open “TV · unknown” and sort them out.'
      : '';
    function bit(n, l, chip, tip) { return '<button class="ntx-chip" data-pchip="' + chip + '" title="' + esc(tip || '') + '">' + l + ' <span class="text-zinc-400">' + n + '</span></button>'; }
    el.innerHTML = '<div class="ntx-card" style="padding:14px 16px' + (lvl === 'red' ? ';border-color:rgba(226,83,75,.5)' : lvl === 'amber' ? ';border-color:rgba(245,165,36,.5)' : '') + '">'
      + '<div class="flex items-center justify-between gap-3 flex-wrap">'
      +   '<div><div class="pp-sub" style="letter-spacing:.14em;text-transform:uppercase;font-weight:900;font-size:10px">TradingView seats</div>'
      +   '<div class="text-white font-black" style="font-size:26px;font-variant-numeric:tabular-nums;color:' + (lvl === 'red' || lvl === 'amber' ? col : '#fff') + '">' + c.seat + ' <span class="text-zinc-500" style="font-size:15px">/ ' + cap + '</span></div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap text-[11.5px] text-zinc-400">Warn at <input id="pp-tv-warn" class="ntx-in" type="number" min="1" value="' + warn + '" style="width:64px">'
      +   ' Limit <input id="pp-tv-cap" class="ntx-in" type="number" min="1" value="' + cap + '" style="width:64px">'
      +   '<button class="ntx-btn" data-ptv="save">Save</button></div>'
      + '</div>'
      + '<div style="height:8px;border-radius:6px;background:rgba(255,255,255,.06);overflow:hidden;margin:10px 0 4px;display:flex">'
      +   '<div style="width:' + pct + '%;background:' + col + '"></div><div style="width:' + pctU + '%;background:repeating-linear-gradient(45deg,rgba(245,165,36,.5) 0 4px,transparent 4px 8px)"></div></div>'
      + '<div class="pp-sub" style="position:relative;height:12px"><span style="position:absolute;left:' + Math.min(100, warn / cap * 100) + '%;transform:translateX(-50%)">▲ ' + warn + '</span></div>'
      + (msg ? '<div class="text-[12.5px] font-bold mt-2" style="color:' + (lvl === 'maybe' ? '#F5A524' : col) + '">' + msg + '</div>' : '')
      + '<div class="flex gap-1 flex-wrap mt-2">'
      +   bit(c.seat, 'Counted', 'tv', 'Live, TradingView username on file (or marked as a seat)')
      +   bit(c.unknown, 'Unknown', 'tvunknown', 'Live Pro/Raven with no TradingView username and no NinjaTrader email — could be a seat')
      +   '<span class="ntx-chip" style="cursor:default" title="Lifetime before Feb 1, 2027 takes no seat unless extended or a script is added">Lifetime <span class="text-zinc-400">' + c.lifetime + '</span></span>'
      +   '<span class="ntx-chip" style="cursor:default" title="Marked exempt (comp, test account)">Exempt <span class="text-zinc-400">' + c.exempt + '</span></span>'
      +   '<span class="ntx-chip" style="cursor:default" title="Past due — TradingView access is revoked, no seat">Past due <span class="text-zinc-400">' + c.pastdue + '</span></span>'
      + '</div></div>';
  }
  function loadTvSeats() {
    if (!tok()) return Promise.resolve();
    return fetch(API + '/api/admin/tv-seats', { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.success) TVS = { threshold: d.threshold, cap: d.cap, overrides: d.overrides || {} }; }).catch(function () {});
  }
  function tvPost(body, okMsg) {
    return fetch(API + '/api/admin/tv-seats', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'Save failed'); return d; }); })
      .then(function (d) { TVS = { threshold: d.threshold, cap: d.cap, overrides: d.overrides || {} }; renderAll(); toast(okMsg); })
      .catch(function (e) { toast(e.message, true); });
  }
  function tvProbe(p) {
    var id = p.r && p.r.membershipId; if (!id) { toast('No Whop membership id on this record', true); return; }
    PROBE[id] = { loading: true }; renderSide();
    fetch(API + '/api/admin/whop-probe', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId: id }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'Check failed'); return d; }); })
      .then(function (d) {
        PROBE[id] = d;
        var f = d.found || {};
        if (p.r) {
          if (f.tv && !p.r.tvUsername) p.r.tvUsername = f.tv;
          if (f.discordName && !p.r.discordName) p.r.discordName = f.discordName;
          if (f.discordId && !p.r.discordId) p.r.discordId = f.discordId;
        }
        renderAll();
        toast(f.tv || f.discordName ? 'Found on Whop — saved' : 'Whop returned nothing for this member', !(f.tv || f.discordName));
      })
      .catch(function (e) { PROBE[id] = { error: e.message }; renderSide(); toast(e.message, true); });
  }
  function tvBlock(p) {
    if (!p.email || !(p.live || TVS.overrides[p.email])) return '';
    var ov = TVS.overrides[p.email] || 'auto';
    var lbl = { seat: 'Takes a TradingView seat', unknown: 'Unknown — no TradingView username or NT email', lifetime: 'Lifetime — no seat (before Feb 1, 2027)',
      exempt: 'Exempt — not counted', no: 'Not on TradingView', nt: 'NinjaTrader user — no seat', '': 'Not a TradingView plan' }[p.tv] || '—';
    var id = p.r && p.r.membershipId, pr = id && PROBE[id];
    var probe = '';
    if (pr && pr.loading) probe = '<div class="pp-sub mt-2">Asking Whop…</div>';
    else if (pr && pr.error) probe = '<div class="text-[12px] text-red-400 mt-2">' + esc(pr.error) + '</div>';
    else if (pr) {
      probe = '<div class="mt-2 text-[11.5px] text-zinc-400" style="border-top:1px solid rgba(255,255,255,.06);padding-top:8px">'
        + '<div><b class="text-white">Whop says:</b> TV ' + (pr.found && pr.found.tv ? '<span class="text-white">' + esc(pr.found.tv) + '</span>' : '—')
        + ' · Discord ' + (pr.found && pr.found.discordName ? '<span class="text-white">' + esc(pr.found.discordName) + '</span>' : '—') + '</div>'
        + Object.keys(pr.sources || {}).map(function (k) {
            var x = pr.sources[k] || {};
            return '<div class="pp-sub">' + esc(k) + ': ' + (x.error ? esc(x.error) : 'HTTP ' + esc(x.status) + (x.answers ? ' · ' + x.answers.length + ' answer(s)' : '') + (x.discord ? ' · discord ✓' : '')) + '</div>';
          }).join('')
        + (pr.lastWebhook ? '<div class="pp-sub">Last webhook (' + fmtD(pr.lastWebhook.at, true) + '): ' + ((pr.lastWebhook.questions || []).length ? 'carried ' + esc(pr.lastWebhook.questions.join(' / ')) : 'no checkout answers') + (pr.lastWebhook.hasDiscord ? ' · discord ✓' : '') + '</div>' : '')
        + '</div>';
    }
    return '<div class="pp-sec">TradingView seat</div><div class="ntx-card" style="padding:12px">'
      + '<div class="text-[12.5px] text-white font-bold">' + lbl + '</div>'
      + '<div class="flex gap-2 flex-wrap items-center mt-2">'
      +   '<select class="ntx-in" data-ptvmode="1" style="flex:1 1 180px">'
      +     [['auto', 'Auto (from Whop)'], ['yes', 'Counts as a seat'], ['no', 'Not on TradingView'], ['exempt', 'Exempt (comp / test)']].map(function (o) {
              return '<option value="' + o[0] + '"' + (ov === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
      +   '</select>'
      +   (id ? '<button class="ntx-btn" data-ptv="probe" title="Ask Whop for this member\'s TradingView username and Discord">Check Whop</button>' : '')
      + '</div>' + probe + '</div>';
  }

  function renderChips() {
    $('pp-chips').innerHTML = CHIPS.map(function (c) {
      var n = PEOPLE.filter(c[2]).length;
      return '<button class="ntx-chip' + (CHIP === c[0] ? ' on' : '') + '" data-pchip="' + c[0] + '">' + c[1] + ' <span class="text-zinc-600">' + n + '</span></button>';
    }).join('') + '<input id="pp-q" class="ntx-in" placeholder="Search name, email, Discord, TradingView, NT email" style="flex:1 1 220px;min-width:180px" value="' + esc(QUERY) + '">';
    var q = $('pp-q'); q.oninput = function () { QUERY = low(q.value); SHOW = 60; renderTable(); };
  }

  function ntCell(p) {
    var tvn = p.r && p.r.tvUsername ? 'TradingView: ' + p.r.tvUsername : 'No TradingView username on file';
    var tvm = { seat: ['p-blu', 'TV'], unknown: ['p-amb', 'TV ?'], lifetime: ['p-pur', 'TV · life'], exempt: ['p-mut', 'TV · exempt'] }[p.tv];
    var tv = tvm ? '<span class="mn-pill ' + tvm[0] + '" title="' + esc(tvn) + '">' + tvm[1] + '</span> ' : '';
    var m = { active: ['p-nt', 'NT ✓'], add: ['p-amb', 'NT · to add'], remove: ['p-red', 'NT · remove'],
      waiting: ['p-amb', 'NT · no email'], declined: ['p-mut', 'NT · not using'], removed: ['p-mut', 'NT · removed'], none: ['p-mut', 'NT · —'] }[p.ntState];
    return tv + (m ? '<span class="mn-pill ' + m[0] + '">' + m[1] + '</span>' : '') || '<span class="text-zinc-700">—</span>';
  }

  function joinedCell(p) {
    var j = p.r && p.r.joined;
    if (!j) return '<span class="text-zinc-700">—</span>';
    var d = p.daysIn;
    var age = d == null ? '' : d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + 'd ago' : Math.round(d / 30) + 'mo ago';
    return '<div class="text-zinc-300">' + fmtD(j, dayOf(j).slice(0, 4) !== String(new Date().getFullYear())) + '</div><div class="pp-sub">' + age + '</div>';
  }

  function onbPill(p) {
    if (p.onb && p.onb.state === 'sent') return '<span class="mn-pill p-grn" title="Onboarding sent ' + esc(fmtD(p.onb.at, true)) + '">Onboarded</span>';
    if (p.onb && p.onb.state === 'skipped') return '<span class="mn-pill p-mut" title="Marked already onboarded">Onboarded · skip</span>';
    if (p.onb && p.onb.state === 'booked') return '<span class="mn-pill p-grn" title="Booked a call ' + esc(fmtD(p.onb.at, true)) + '">Booked call</span>';
    if (p.onb && p.onb.state === 'not_needed') return '<span class="mn-pill p-mut" title="Marked not needed">No onboard</span>';
    if (p.toOnboard) return '<span class="mn-pill p-amb">Onboard</span>';
    return '';
  }

  function callsBlock(p) {
    if (!window.calFor || !p.email) return '';
    var list = window.calFor(p.email);
    if (!list.length) return '';
    return '<div class="pp-sec">Calls</div>' + list.slice(0, 5).map(function (b) {
      var past = Date.parse(b.end || b.start) < Date.now();
      var st = b.status === 'cancelled' ? 'Cancelled' : b.status === 'rescheduled' ? 'Rescheduled' : b.outcome === 'done' ? 'Done' : b.outcome === 'noshow' ? 'No-show' : past ? 'Past' : 'Upcoming';
      var when = new Date(b.start).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return '<div class="text-[12px] py-1"><b class="text-white">' + esc(b.title || b.event || 'Call') + '</b> · ' + esc(when) + ' CT'
        + ' <span class="pp-sub">· ' + st + '</span>' + (b.topic ? '<div class="pp-sub">“' + esc(b.topic.slice(0, 140)) + '”</div>' : '') + '</div>';
    }).join('') + '<button class="ntx-btn mt-1" onclick="switchTab(\'calls\')">Open Calls</button>';
  }

  function onbBlock(p) {
    if (!p.email) return '';
    var o = p.onb;
    var def = o ? 'checkin' : p.returning ? 'back' : 'setup';
    var opts = tplOpts(def);
    var lbl = tplLabel;
    var fBoxes = focusOpts().map(function (f) {
      return '<label class="flex items-center gap-2 text-[12px] text-zinc-300" style="cursor:pointer"><input type="checkbox" class="pp-onb-f" value="' + esc(f.id) + '"> ' + esc(f.label) + '</label>';
    }).join('');
    var focusUi = '<div class="flex items-center justify-between gap-2 mt-3"><div class="pp-sub">Help with <span class="text-zinc-600">(none ticked = general)</span></div>'
      + '<button class="ntx-btn" data-ponb="match" title="Tick boxes from their plan name">Match plan</button></div>'
      + '<div class="pp-sub" style="margin:2px 0 6px">They have: <span class="text-zinc-300">' + esc(p.product || '—') + '</span></div>'
      + '<div style="display:grid;gap:4px">' + fBoxes + '</div>';
    var status = !o ? '<div class="text-[12.5px] text-white font-bold">' + (p.toOnboard ? 'Not onboarded yet' : 'No onboarding sent') + '</div>'
      : o.state === 'sent' ? '<div class="text-[12.5px] text-white font-bold">Sent · ' + esc(lbl(o.template)) + '</div><div class="pp-sub">' + fmtD(o.at, true) + (o.lastCheckin ? ' · checked in ' + fmtD(o.lastCheckin, true) : '') + '</div>'
      : o.state === 'booked' ? '<div class="text-[12.5px] text-white font-bold">Booked a call · ' + esc(o.call || '') + '</div><div class="pp-sub">' + (o.callStart ? 'Call ' + fmtD(o.callStart, true) : fmtD(o.at, true)) + '</div>'
      : '<div class="text-[12.5px] text-white font-bold">' + (o.state === 'not_needed' ? 'Marked not needed' : 'Marked already onboarded') + '</div><div class="pp-sub">' + fmtD(o.at, true) + (o.lastCheckin ? ' · checked in ' + fmtD(o.lastCheckin, true) : '') + '</div>';
    if (o && o.state === 'booked' && o.lastCheckin) status += '<div class="pp-sub">Checked in ' + fmtD(o.lastCheckin, true) + '</div>';
    var hist = o && o.history && o.history.length > 1 ? '<div class="pp-sub mt-2">' + o.history.slice(1, 6).map(function (h) {
      return fmtD(h.at, true) + ' · ' + (h.action === 'sent' ? esc(lbl(h.template)) + (h.bulk ? ' (bulk)' : '') : h.action === 'booked' ? 'booked ' + esc(h.template || 'a call') : h.action === 'not_needed' ? 'not needed' : 'already onboarded');
    }).join('<br>') + '</div>' : '';
    return '<div class="pp-sec">Onboarding</div><div class="ntx-card" style="padding:12px">'
      + '<div class="flex items-start justify-between gap-2"><div>' + status + '</div>'
      + (o ? '<button class="ntx-btn" data-ponb="clear" title="Put them back in the queue">Reset</button>' : '') + '</div>'
      + hist
      + '<select id="pp-onb-t" class="ntx-in" style="width:100%;margin-top:10px">' + opts + '</select>'
      + focusUi
      + '<textarea id="pp-onb-note" class="ntx-in" rows="2" placeholder="Optional personal line (added above your sign-off)" style="width:100%;margin-top:6px;resize:vertical"></textarea>'
      + '<div class="flex gap-2 flex-wrap mt-2">'
      +   '<button class="ntx-btn" data-ponb="preview">Preview</button>'
      +   '<button class="ntx-btn" data-ponb="send" style="border-color:rgba(255,107,31,.6);color:#FF8A4C">' + (o && o.state === 'sent' ? 'Send again' : 'Send to ' + esc(p.email)) + '</button>'
      +   (!o ? '<button class="ntx-btn" data-ponb="skip" title="Already talked to them — take them off the queue">Already onboarded</button>'
            + '<button class="ntx-btn" data-ponb="none" title="Left / done — no onboarding needed">Not needed</button>' : '')
      + '</div></div>';
  }

  function sorted(list) {
    var by = {
      status: function (a, b) { return (b.needs - a.needs) || ((STATUS[a.status] || { rank: 9 }).rank - (STATUS[b.status] || { rank: 9 }).rank) || a.name.localeCompare(b.name); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
      next: function (a, b) { return (dayOf(a.next && a.next.d) || '9999') < (dayOf(b.next && b.next.d) || '9999') ? -1 : 1; },
      paid: function (a, b) { return b.paid - a.paid; },
      seen: function (a, b) { return (b.lastLogin || '') > (a.lastLogin || '') ? 1 : -1; },
      // Newest first; no join date sinks to the bottom.
      joined: function (a, b) { return (dayOf(b.r && b.r.joined) || '0000') > (dayOf(a.r && a.r.joined) || '0000') ? 1 : -1; },
    }[SORT];
    var out = list.slice().sort(by);
    return REV ? out.reverse() : out;
  }

  function visible() {
    var fn = chipFn();
    return sorted(PEOPLE.filter(fn).filter(function (p) {
      if (!QUERY) return true;
      var r = p.r || {};
      return [p.name, p.email, r.discordName, r.tvUsername, r.whopUsername, p.nt && p.nt.ntEmail, p.product].join(' ').toLowerCase().indexOf(QUERY) !== -1;
    }));
  }
  function renderTable() {
    var list = visible();
    if (OPEN === '__bulk' && !BULK.running) renderSide();
    var th = function (k, l) { return '<th data-psort="' + k + '" class="' + (SORT === k ? 'on' : '') + '" title="Click again to reverse">' + l + (SORT === k && REV ? ' ↑' : '') + '</th>'; };
    if (!list.length) { $('pp-table').innerHTML = '<div class="text-[12px] text-zinc-500 p-4">' + (PEOPLE.length ? 'No one matches.' : 'No data yet. Press Sync Whop now.') + '</div>'; return; }
    $('pp-table').innerHTML = '<table class="pp-t"><tr>' + th('status', 'Member') + '<th>Plan</th>' + th('joined', 'Joined') + th('next', 'Next') + '<th>Access</th>' + th('seen', 'Site') + th('paid', 'Paid') + '</tr>'
      + list.slice(0, SHOW).map(function (p) {
        var st = STATUS[p.status] || STATUS.inactive;
        var next = p.next && p.next.d ? '<div class="text-zinc-300">' + fmtD(p.next.d) + '</div><div class="pp-sub">' + p.next.k + '</div>' : '<span class="text-zinc-700">—</span>';
        var site = p.site ? (p.lastLogin ? '<span class="text-zinc-300">' + ago(p.lastLogin) + '</span>' : '<span class="pp-sub">account</span>') : '<span class="pp-sub">no account</span>';
        return '<tr class="pp-r' + (p.needs ? ' needs' : '') + (OPEN === p.key ? ' sel' : '') + '" data-pk="' + esc(p.key) + '">'
          + '<td><div class="text-white font-bold">' + esc(p.name) + (p.flags.length ? '<span class="pp-flag" title="Flagged"></span>' : '') + ' ' + onbPill(p) + '</div><div class="pp-sub">' + esc(p.email || '') + (p.r && p.r.discordName ? ' <span style="color:#818cf8">· @' + esc(p.r.discordName) + '</span>' : '') + '</div></td>'
          + '<td><span class="mn-pill ' + st.c + '">' + st.l + '</span><div class="pp-sub mt-1">' + esc(p.product || '—') + '</div></td>'
          + '<td>' + joinedCell(p) + '</td>'
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
    if (OPEN === '__bulk') { side.style.display = ''; wrap.classList.add('open'); side.innerHTML = bulkBlock(); return; }
    var p = OPEN && PEOPLE.filter(function (x) { return x.key === OPEN; })[0];
    if (!p) { side.style.display = 'none'; wrap.classList.remove('open'); return; }
    side.style.display = ''; wrap.classList.add('open');
    var r = p.r || {}, s = p.site || {}, st = STATUS[p.status] || STATUS.inactive;
    var rt = ''; try { var t = r.renewal ? renewalTime(r) : null; rt = t ? ' · ' + (t.exact ? '' : '≈') + t.time : ''; } catch (e) {}
    var tenure = r.joined ? Math.max(0, Math.round((Date.now() - new Date(dayOf(r.joined) + 'T12:00:00')) / 864e5)) : null;
    function kv(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + (v || '<span class="text-zinc-600">—</span>') + '</div></div>'; }
    function copy(v) { return v ? '<span class="pp-copy" data-pcopy="' + esc(v) + '">' + esc(v) + '</span>' : ''; }

    var ntBlock = '';
    if (p.nt || hasNt(p.fam)) {
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
      if (f.rtId) {
        return '<div class="ntx-card" style="padding:10px 12px;margin-bottom:6px">'
          + '<div class="flex items-center justify-between gap-2"><div class="text-[12px] font-bold ' + (f.severity === 'red' ? 'text-red-400' : 'text-yellow-400') + '">'
          + (f.severity === 'red' ? '🔴 ' : '🟡 ') + esc(f.type) + (f.at ? ' <span class="pp-sub">· ' + fmtD(f.at) + '</span>' : '') + '</div>'
          + '<button class="ntx-btn" data-prtdismiss="' + esc(f.rtId) + '" title="Hide this flag">Dismiss</button></div>'
          + (f.priors || []).map(function (x) {
              return '<div class="text-[11.5px] text-zinc-400 mt-1">• ' + esc(x.product || 'Membership') + ' · ' + esc(x.status || '?')
                + (x.trial ? ' · started as trial' : '') + (x.created ? ' · ' + fmtD(x.created, true) : '')
                + (x.email ? ' · ' + esc(x.email) : '') + ' <span class="pp-sub">(' + esc(x.via || '') + ')</span></div>';
            }).join('')
          + '</div>';
      }
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
      +   (hasNt(p.fam) && p.live ? '<span class="mn-pill p-nt">Includes NT</span>' : '')
      +   (p.failedOpen ? '<span class="mn-pill p-red">Failed payment</span>' : '') + '</div>'
      + '<div class="pp-kv">'
      +   kv('Plan', esc(p.product)) + kv(p.next ? p.next.k : 'Next', p.next && p.next.d ? fmtD(p.next.d, true) + (p.next.k === 'Renews' ? esc(rt) : '') : '')
      +   kv('Member since', r.joined ? fmtD(r.joined, true) + (tenure != null ? ' <span class="pp-sub">· ' + tenure + 'd</span>' : '') : '')
      +   kv('Paid total', p.paid ? usd(p.paid) : '')
      +   kv('Discord', r.discordName ? copy(r.discordName) + (/^\d{15,22}$/.test(r.discordId || '') ? ' <a class="pp-sub" style="color:#818cf8" target="_blank" rel="noopener" href="https://discord.com/users/' + esc(r.discordId) + '">Open DM ↗</a>' : '') : '')
      +   kv('TradingView', copy(r.tvUsername))
      +   kv('Site account', p.site ? (s.createdAt ? 'Since ' + fmtD(s.createdAt, true) : 'Yes') : 'None')
      +   kv('Last on site', p.lastLogin ? ago(p.lastLogin) : '')
      + '</div>'
      + callsBlock(p) + onbBlock(p) + tvBlock(p) + ntBlock + flags + notes
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
  function loadRepeatTrials() {
    if (!tok()) return Promise.resolve();
    return fetch(API + '/api/admin/repeat-trials', { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.flags) RT = d.flags; }).catch(function () {});
  }
  function dismissRepeat(id) {
    return fetch(API + '/api/admin/repeat-trials/dismiss', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    }).then(function (r) { if (!r.ok) throw new Error('Dismiss failed'); return loadRepeatTrials(); })
      .then(function () { renderAll(); toast('Flag dismissed'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function loadOnboard() {
    if (!tok()) return Promise.resolve();
    return fetch(API + '/api/admin/onboard', { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { ONB = d.records || {}; ONB_T = d.templates || []; ONB_F = d.focus || []; } }).catch(function () {});
  }
  function onbAction(kind) {
    var p = OPEN && PEOPLE.filter(function (x) { return x.key === OPEN; })[0]; if (!p || !p.email) return;
    var tSel = $('pp-onb-t'), nEl = $('pp-onb-note');
    var template = tSel ? tSel.value : 'setup', note = nEl ? nEl.value.trim() : '';
    var boxes = [].slice.call(document.querySelectorAll('#pp-side .pp-onb-f'));
    if (kind === 'match') {
      var want = focusOf(p);
      boxes.forEach(function (b) { b.checked = want.indexOf(b.value) !== -1; });
      toast(want.length ? 'Ticked from plan — check it before sending' : 'Plan name didn\'t match anything — pick by hand', !want.length);
      return;
    }
    var focus = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    var post = function (path, body) {
      return fetch(API + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'Failed'); return d; }); });
    };
    if (kind === 'preview') {
      var w = window.open('', '_blank');
      return post('/api/admin/onboard', { email: p.email, name: p.name, template: template, focus: focus, note: note, preview: true })
        .then(function (d) { if (w) { w.document.title = d.subject; w.document.body.style.margin = '0'; w.document.body.innerHTML = '<div style="font:13px Arial;padding:10px 28px;background:#111;color:#aaa">Subject: <b style="color:#fff">' + esc(d.subject) + '</b> · To: ' + esc(p.email) + '</div>' + d.html; } })
        .catch(function (e) { if (w) w.close(); toast(e.message, true); });
    }
    if (kind === 'send') {
      var tl = (ONB_T.filter(function (x) { return x.id === template; })[0] || {}).label || template;
      if (!window.confirm('Send "' + tl + '" to ' + p.email + '?')) return;
      toast('Sending…');
      return post('/api/admin/onboard', { email: p.email, name: p.name, template: template, focus: focus, note: note })
        .then(function (d) { ONB[p.email] = d.record; renderAll(); toast('Sent to ' + p.email); })
        .catch(function (e) { toast(e.message, true); });
    }
    if (kind === 'skip' || kind === 'none' || kind === 'clear') {
      return post('/api/admin/onboard/mark', { email: p.email, state: kind })
        .then(function (d) { if (d.record) ONB[p.email] = d.record; else delete ONB[p.email]; renderAll(); toast(kind === 'skip' ? 'Marked onboarded' : kind === 'none' ? 'Marked not needed' : 'Back in the queue'); })
        .catch(function (e) { toast(e.message, true); });
    }
  }
  /* ── Bulk check-in ─────────────────────────────────────────────────── */
  // Recipients = whatever list is showing (chip + search), minus anyone emailed
  // in the last N days, minus anyone Danny unticks. Sends one at a time.
  function bulkList() {
    var cut = BULK.days > 0 ? Date.now() - BULK.days * 864e5 : 0;
    return visible().filter(function (p) { return !!p.email; }).map(function (p) {
      var lm = lastMail(p), recent = cut && lm && new Date(lm).getTime() > cut;
      var noneFlag = p.onb && p.onb.state === 'not_needed';
      return { p: p, lm: lm, skip: recent ? 'emailed ' + ago(lm) : noneFlag ? 'marked not needed' : '' };
    });
  }
  function bulkFocus(p) { return BULK.mode === 'match' ? focusOf(p) : BULK.mode === 'pick' ? BULK.focus.slice() : []; }
  function bulkTargets() { return bulkList().filter(function (x) { return !x.skip && !BULK.off[x.p.email]; }); }
  function bulkBlock() {
    var chip = (CHIPS.filter(function (c) { return c[0] === CHIP; })[0] || CHIPS[0])[1];
    var rows = bulkList(), go = bulkTargets();
    var fl = focusOpts().map(function (f) {
      return '<label class="flex items-center gap-2 text-[12px] text-zinc-300" style="cursor:pointer"><input type="checkbox" data-pbf="' + esc(f.id) + '"' + (BULK.focus.indexOf(f.id) !== -1 ? ' checked' : '') + (BULK.mode !== 'pick' ? ' disabled' : '') + '> ' + esc(f.label) + '</label>';
    }).join('');
    var list = rows.map(function (x) {
      var p = x.p, f = bulkFocus(p);
      return '<label class="flex items-start gap-2" style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);cursor:' + (x.skip ? 'default' : 'pointer') + ';opacity:' + (x.skip ? '.45' : '1') + '">'
        + '<input type="checkbox" data-pbo="' + esc(p.email) + '"' + (!x.skip && !BULK.off[p.email] ? ' checked' : '') + (x.skip ? ' disabled' : '') + ' style="margin-top:3px">'
        + '<div style="min-width:0"><div class="text-[12px] text-white font-bold">' + esc(p.name) + ' <span class="pp-sub">' + esc(p.email) + '</span></div>'
        + '<div class="pp-sub">' + esc(p.product || '—') + (x.skip ? ' · <span class="text-yellow-400">skipped: ' + esc(x.skip) + '</span>' : BULK.mode === 'match' ? ' · <span class="text-zinc-400">' + (f.length ? f.join(' + ') : 'general') + '</span>' : '') + '</div></div></label>';
    }).join('') || '<div class="pp-sub">No one with an email in this list.</div>';
    var prog = BULK.running ? '<div class="text-[12px] text-white font-bold mt-2">Sending ' + BULK.done + ' / ' + BULK.total + '…</div>' : '';
    return '<div class="ntx-card" style="padding:16px">'
      + '<div class="flex items-center justify-between gap-2"><div><div class="text-white font-black">Check in this list</div><div class="pp-sub">List: <span class="text-zinc-300">' + esc(chip) + '</span>' + (QUERY ? ' · search “' + esc(QUERY) + '”' : '') + '</div></div>'
      + '<button class="ntx-btn" data-pclose="1">×</button></div>'
      + '<div class="pp-sub mt-2">Change the chip or search on the left to change who\'s in it.</div>'
      + '<div class="pp-sec">Email</div><select class="ntx-in" data-pbset="tpl" style="width:100%">' + tplOpts(BULK.tpl) + '</select>'
      + '<div class="pp-sec">Help with</div>'
      + '<select class="ntx-in" data-pbset="mode" style="width:100%">'
      +   '<option value="general"' + (BULK.mode === 'general' ? ' selected' : '') + '>General — no product list</option>'
      +   '<option value="match"' + (BULK.mode === 'match' ? ' selected' : '') + '>Match each person\'s plan</option>'
      +   '<option value="pick"' + (BULK.mode === 'pick' ? ' selected' : '') + '>Same for everyone (tick below)</option>'
      + '</select><div style="display:grid;gap:4px;margin-top:6px">' + fl + '</div>'
      + '<textarea id="pp-bulk-note" class="ntx-in" rows="2" placeholder="Optional line for everyone (added above your sign-off)" style="width:100%;margin-top:10px;resize:vertical">' + esc(BULK.note || '') + '</textarea>'
      + '<div class="flex items-center gap-2 mt-2 text-[12px] text-zinc-400">Skip anyone emailed in the last <input class="ntx-in" data-pbset="days" type="number" min="0" max="90" value="' + BULK.days + '" style="width:60px"> days</div>'
      + '<div class="flex gap-2 flex-wrap mt-3">'
      +   '<button class="ntx-btn" data-pbulk="preview"' + (go.length && !BULK.running ? '' : ' disabled') + '>Preview first</button>'
      +   (BULK.running ? '<button class="ntx-btn" data-pbulk="stop">Stop</button>'
          : '<button class="ntx-btn" data-pbulk="send"' + (go.length ? '' : ' disabled') + ' style="border-color:rgba(255,107,31,.6);color:#FF8A4C">Send to ' + go.length + '</button>')
      +   '<button class="ntx-btn" data-pbulk="none">Untick all</button><button class="ntx-btn" data-pbulk="all">Tick all</button>'
      + '</div>' + prog
      + '<div class="pp-sec">Recipients · ' + go.length + ' of ' + rows.length + '</div><div>' + list + '</div></div>';
  }
  function bulkPost(body) {
    return fetch(API + '/api/admin/onboard', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'Failed'); return d; }); });
  }
  function bulkAction(kind) {
    var n = $('pp-bulk-note'); if (n) BULK.note = n.value;
    if (kind === 'open') { BULK.off = {}; OPEN = '__bulk'; renderTable(); renderSide(); return; }
    if (kind === 'stop') { BULK.stop = true; return; }
    if (kind === 'none') { bulkList().forEach(function (x) { BULK.off[x.p.email] = true; }); renderSide(); return; }
    if (kind === 'all') { BULK.off = {}; renderSide(); return; }
    var go = bulkTargets(); if (!go.length) return;
    var note = (BULK.note || '').trim();
    if (kind === 'preview') {
      var p = go[0].p, w = window.open('', '_blank');
      return bulkPost({ email: p.email, name: p.name, template: BULK.tpl, focus: bulkFocus(p), note: note, preview: true })
        .then(function (d) { if (w) { w.document.title = d.subject; w.document.body.style.margin = '0'; w.document.body.innerHTML = '<div style="font:13px Arial;padding:10px 28px;background:#111;color:#aaa">Preview for ' + esc(p.name) + ' · Subject: <b style="color:#fff">' + esc(d.subject) + '</b></div>' + d.html; } })
        .catch(function (e) { if (w) w.close(); toast(e.message, true); });
    }
    if (kind === 'send') {
      if (!window.confirm('Send "' + tplLabel(BULK.tpl) + '" to ' + go.length + ' people?\n\nOne at a time, about a second apart. You can stop it.')) return;
      BULK.running = true; BULK.stop = false; BULK.done = 0; BULK.total = go.length;
      var fails = [];
      renderSide();
      var i = 0;
      (function next() {
        if (BULK.stop || i >= go.length) {
          BULK.running = false; renderAll();
          toast('Sent ' + (BULK.done - fails.length) + (fails.length ? ' · ' + fails.length + ' failed' : '') + (BULK.stop ? ' · stopped' : ''), !!fails.length);
          if (fails.length) console.warn('[people] bulk check-in failed for', fails);
          return;
        }
        var p = go[i++].p;
        bulkPost({ email: p.email, name: p.name, template: BULK.tpl, focus: bulkFocus(p), note: note, bulk: true })
          .then(function (d) { ONB[p.email] = d.record; })
          .catch(function (e) { fails.push(p.email + ': ' + e.message); })
          .then(function () { BULK.done++; renderSide(); setTimeout(next, 1100); });
      })();
    }
  }

  function renderAll() {
    PEOPLE = build();
    renderStats(); renderChips(); renderTable(); renderSide();
  }
  window.peopleRender = function () {
    skeleton(); if (!$('panel-people')) return;
    renderAll();
    var nt = window.ntLoad ? window.ntLoad().catch(function () {}) : Promise.resolve();
    Promise.all([loadServerEvents(), loadRepeatTrials(), loadOnboard(), loadTvSeats(), nt]).then(renderAll);
  };
  // Used by admin-bookings.js: match a Cal.com booking email to a person.
  window.peopleLookup = function (email) {
    var e = low(email); if (!e) return null;
    if (!PEOPLE.length) PEOPLE = build();
    var p = PEOPLE.filter(function (x) { return x.email === e; })[0];
    if (!p) return null;
    var st = STATUS[p.status] || STATUS.inactive;
    return { email: p.email, key: p.key, name: p.name, live: p.live, label: st.l, cls: st.c, product: p.product, daysIn: p.daysIn };
  };
  window.peopleOpen = function (email) {
    var hit = window.peopleLookup(email); if (!hit) return;
    OPEN = hit.key; CHIP = 'all'; QUERY = '';
    switchTab('people');
  };
  window.peopleRefresh = function () {
    try { var p = $('panel-people'); if (p && p.classList.contains('active')) loadOnboard().then(renderAll); } catch (e) {}
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
    var so = t.closest('[data-psort]'); if (so) { var k = so.getAttribute('data-psort'); REV = (SORT === k) ? !REV : false; SORT = k; renderTable(); return; }
    if (t.closest('[data-pmore]')) { SHOW += 100; renderTable(); return; }
    if (t.closest('[data-pclose]') || t.id === 'pp-side') { OPEN = null; renderTable(); renderSide(); return; }
    var ob = t.closest('[data-ponb]'); if (ob) { onbAction(ob.getAttribute('data-ponb')); return; }
    var bk = t.closest('[data-pbulk]'); if (bk) { if (!bk.disabled) bulkAction(bk.getAttribute('data-pbulk')); return; }
    if (t.closest('label') && t.closest('#pp-side') && OPEN === '__bulk') return;
    var tvb = t.closest('[data-ptv]');
    if (tvb) {
      var act = tvb.getAttribute('data-ptv');
      if (act === 'save') return tvPost({ threshold: parseInt(($('pp-tv-warn') || {}).value, 10), cap: parseInt(($('pp-tv-cap') || {}).value, 10) }, 'Seat settings saved');
      if (act === 'probe') { var pp = PEOPLE.filter(function (x) { return x.key === OPEN; })[0]; if (pp) tvProbe(pp); return; }
    }
    var rd = t.closest('[data-prtdismiss]'); if (rd) { dismissRepeat(rd.getAttribute('data-prtdismiss')); return; }
    var cp = t.closest('[data-pcopy]');
    if (cp) { var v = cp.getAttribute('data-pcopy'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Copied ' + v); }).catch(function () { window.prompt('Copy:', v); }); return; }
    var ed = t.closest('[data-pedit]'); if (ed) { try { openEditMemberModal(ed.getAttribute('data-pedit')); } catch (x) { toast('Edit opens in Roster', true); } return; }
    var row = t.closest('[data-pk]'); if (row) { OPEN = row.getAttribute('data-pk'); renderTable(); renderSide(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-ptvmode') && OPEN && OPEN !== '__bulk') {
      var who = PEOPLE.filter(function (x) { return x.key === OPEN; })[0];
      if (who && who.email) tvPost({ email: who.email, mode: t.value }, t.value === 'auto' ? 'Back to auto' : 'Saved');
      return;
    }
    if (OPEN !== '__bulk' || !t.closest || !t.closest('#pp-side')) return;
    var n = $('pp-bulk-note'); if (n) BULK.note = n.value;
    var k = t.getAttribute('data-pbset');
    if (k === 'tpl') BULK.tpl = t.value;
    else if (k === 'mode') BULK.mode = t.value;
    else if (k === 'days') BULK.days = Math.max(0, Math.min(90, parseInt(t.value, 10) || 0));
    else if (t.hasAttribute('data-pbf')) { var id = t.getAttribute('data-pbf'); BULK.focus = BULK.focus.filter(function (x) { return x !== id; }); if (t.checked) BULK.focus.push(id); }
    else if (t.hasAttribute('data-pbo')) { var em = t.getAttribute('data-pbo'); if (t.checked) delete BULK.off[em]; else BULK.off[em] = true; }
    else return;
    renderSide();
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
