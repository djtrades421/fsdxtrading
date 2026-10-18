/* ==========================================================================
   admin-traffic.js — Admin → Traffic (Oct 2026 rework)

   One screen that answers: how many people came, from where, did they stick,
   did they reach Memberships, did they click checkout — and did signups move.

   Data: GET /api/admin/visits (nexus-traffic.js). The Worker returns 120 days
   of daily records (today first) + the last 50 sessions. Every range, compare
   and breakdown below is computed here, so switching ranges costs no requests.

   v2 fields (engaged, campaigns, landing pages, device, country, referrer,
   new/returning, session paths) only exist from the day the new beacon went
   live. Older days still feed visits, sources, pages and hours.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var DATA = null, RANGE = '30', RECENT_F = 'all', TIMER = null, BUSY = false;
  var TABLE = { ch: 'visits', camp: 'visits', land: 'visits' };
  var SNAP_KEY = 'fsdx_pages_snapshot';

  function $(id) { return document.getElementById(id); }
  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(x) { return (x || 0).toLocaleString(); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function pctTxt(a, b) { if (!b) return '—'; var p = Math.min(a / b * 100, 100); return (p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)) + '%'; }
  function ctDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d || new Date()); }
  function ctHour() { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date()), 10) % 24; }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2600);
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + tok() }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status)); return d;
      });
    });
  }
  function ago(ms) {
    var m = (Date.now() - ms) / 6e4;
    if (m < 1) return 'now'; if (m < 60) return Math.round(m) + 'm';
    if (m < 1440) return Math.round(m / 60) + 'h'; return Math.round(m / 1440) + 'd';
  }
  function shortDay(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); }

  // ── Names + colors ─────────────────────────────────────────────────────
  var SRC = {
    youtube: ['YouTube', '#FF4D4D'], google: ['Google', '#F5A524'], 'google-ads': ['Google Ads', '#F5A524'],
    facebook: ['Facebook', '#4C8DFF'], 'facebook-ads': ['Meta Ads', '#4C8DFF'], instagram: ['Instagram', '#E1306C'],
    'instagram-ads': ['Instagram Ads', '#E1306C'], x: ['X', '#D4D4D8'], tiktok: ['TikTok', '#25F4EE'],
    reddit: ['Reddit', '#FF5700'], discord: ['Discord', '#8B93FF'], whop: ['Whop', '#FF6B1F'],
    tradingview: ['TradingView', '#2FBF7E'], ai: ['AI assistants', '#C084FC'], search: ['Other search', '#06B6D4'],
    social: ['Social (old)', '#A78BFA'], referral: ['Referral', '#F472B6'], direct: ['Direct', '#7FB2FF'], email: ['Email', '#FACC15']
  };
  var PAL = ['#2FBF7E', '#7FB2FF', '#F5A524', '#C084FC', '#F472B6', '#06B6D4', '#FB923C'];
  function srcName(k) { if (SRC[k]) return SRC[k][0]; var s = String(k || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function srcColor(k, i) { return (SRC[k] && SRC[k][1]) || PAL[(i || 0) % PAL.length]; }
  function isPaid(k) { return /-ads$/.test(k || ''); }

  // Page keys: "/memberships.html", "/memberships", "/index.html" → one key.
  function normPage(p) {
    var s = String(p || '/').toLowerCase().split('?')[0].split('#')[0];
    s = s.replace(/index\.html$/, '').replace(/\.html$/, '');
    if (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
    return s || '/';
  }
  var PAGE_NAMES = {
    '/': 'Home', '/memberships': 'Memberships', '/results': 'Results', '/backtest': 'Backtest', '/faq': 'FAQ',
    '/contact': 'Contact', '/disclosures': 'Disclosures', '/autotrader': 'Auto Trader', '/suite': 'Suite',
    '/knowledge': 'Knowledge', '/affiliates': 'Affiliates', '/schedule': 'Schedule', '/setup': 'Setup',
    '/raven': 'Raven', '/nightwing': 'Nightwing', '/compare': 'Compare', '/free-indicators': 'Free Indicators',
    '/track-record': 'Track Record', '/platform': 'Platform', '/partners': 'Partners', '/giveaways': 'Giveaways',
    '/releases': 'Releases', '/ninjatrader': 'NinjaTrader', '/tradingview-update': 'TradingView Update',
    '/welcome': 'Welcome', '/404': '404', '/checkout-started': 'Checkout'
  };
  function pageName(p) {
    var k = normPage(p);
    if (PAGE_NAMES[k]) return PAGE_NAMES[k];
    if (k.indexOf('/checkout/') === 0) return 'Checkout · ' + k.slice(10);
    var seg = k.replace(/^\//, '').replace(/[-_/]/g, ' ').trim();
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }
  var CC = { US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia', DE: 'Germany', IN: 'India',
    MX: 'Mexico', BR: 'Brazil', NL: 'Netherlands', FR: 'France', ES: 'Spain', IT: 'Italy', PH: 'Philippines',
    NG: 'Nigeria', ZA: 'South Africa', AE: 'UAE', SG: 'Singapore', PR: 'Puerto Rico', XX: 'Unknown' };
  function flag(cc) {
    if (!cc || cc.length !== 2 || cc === 'XX') return '🌐';
    return String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1));
  }

  // ── Range + aggregation ────────────────────────────────────────────────
  var RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month']];
  function rangeDays(r) {
    var all = (DATA && DATA.days) || [];
    if (r === 'today') return { cur: all.slice(0, 1), prev: all.slice(1, 2) };
    if (r === 'month') {
      var m = all[0] ? all[0].day.slice(0, 7) : '';
      var cur = all.filter(function (d) { return d.day.slice(0, 7) === m; });
      return { cur: cur, prev: all.slice(cur.length, cur.length * 2) };
    }
    var k = Number(r);
    return { cur: all.slice(0, k), prev: all.slice(k, k * 2) };
  }
  function addMap(out, m, norm) {
    for (var k in (m || {})) { var kk = norm ? norm(k) : k; out[kk] = (out[kk] || 0) + m[k]; }
  }
  function agg(days) {
    var a = { visits: 0, eng: 0, dimV: 0, joins: 0, trials: 0, sources: {}, pages: {}, hours: {}, sp: {}, dims: {}, n: days.length, dimDays: 0 };
    days.forEach(function (d) {
      a.visits += d.total || 0; a.joins += d.joins || 0; a.trials += d.trials || 0;
      addMap(a.sources, d.sources); addMap(a.pages, d.pages, normPage); addMap(a.hours, d.hours);
      for (var s in (d.sourcePages || {})) { a.sp[s] = a.sp[s] || {}; addMap(a.sp[s], d.sourcePages[s], normPage); }
      if (d.dims) {
        a.dimDays++; a.eng += d.eng || 0;
        for (var dim in d.dims) {
          var out = a.dims[dim] || (a.dims[dim] = {});
          for (var v in d.dims[dim]) {
            var key = dim === 'land' ? normPage(v) : v;
            var r = out[key] || (out[key] = { v: 0, e: 0, m: 0, k: 0 }), x = d.dims[dim][v];
            r.v += x.v || 0; r.e += x.e || 0; r.m += x.m || 0; r.k += x.k || 0;
          }
        }
        var sv = 0; for (var q in (d.dims.src || {})) sv += d.dims.src[q].v || 0; a.dimV += sv;
      }
    });
    a.memb = a.pages['/memberships'] || 0;
    a.chk = a.pages['/checkout-started'] || 0;
    a.signups = a.joins + a.trials;
    return a;
  }
  function firstDimDay() {
    var all = (DATA && DATA.days) || [], f = null;
    all.forEach(function (d) { if (d.dims) f = d.day; });
    return f;
  }
  function sinceDay() { return DATA && DATA.since ? ctDay(new Date(DATA.since)) : null; }
  function prevUsable(prev, expectLen) {
    // Only compare when the prior window is fully inside the recorded data.
    var s = sinceDay();
    if (!prev.length || prev.length < expectLen) return false;
    if (s && prev[prev.length - 1].day < s) return false;
    return true;
  }

  // ── CSS ─────────────────────────────────────────────────────────────────
  var CSS = ''
    + '#panel-traffic .tf-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}'
    + '#panel-traffic .tf-title{font-size:18px;font-weight:900;color:#fff}'
    + '#panel-traffic .tf-sub{font-size:11.5px;color:#71717a;margin-top:2px}'
    + '#panel-traffic .tf-meta{font-size:11px;color:#52525b;margin-top:4px}'
    + '#panel-traffic .tf-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '#panel-traffic .tf-ranges{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px}'
    + '#panel-traffic .tf-kpis{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:12px}'
    + '@media(min-width:900px){#panel-traffic .tf-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}'
    + '@media(min-width:1300px){#panel-traffic .tf-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}}'
    + '#panel-traffic .tf-k{border:1px solid rgba(255,255,255,.10);background:rgba(9,9,11,.4);border-radius:14px;padding:13px 14px;min-width:0}'
    + '#panel-traffic .tf-k .l{font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:800}'
    + '#panel-traffic .tf-k .v{font-size:26px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;margin-top:3px;line-height:1.1}'
    + '#panel-traffic .tf-k .v small{font-size:12px;color:#71717a;font-weight:700;margin-left:4px}'
    + '#panel-traffic .tf-k .s{font-size:10.5px;color:#52525b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#panel-traffic .tf-d{font-size:10.5px;font-weight:800;margin-left:2px}'
    + '#panel-traffic .tf-d.up{color:#2FBF7E}#panel-traffic .tf-d.dn{color:#E2534B}#panel-traffic .tf-d.fl{color:#52525b}'
    + '#panel-traffic .tf-row{display:grid;gap:12px;grid-template-columns:1fr;margin-bottom:12px}'
    + '@media(min-width:1100px){#panel-traffic .tf-row.r21{grid-template-columns:2fr 1fr}#panel-traffic .tf-row.r11{grid-template-columns:1fr 1fr}#panel-traffic .tf-row.r111{grid-template-columns:1fr 1fr 1fr}}'
    + '#panel-traffic .tf-hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:12px}'
    + '#panel-traffic .tf-note{font-size:10.5px;color:#52525b;line-height:1.5}'
    + '#panel-traffic .tf-note code{color:#a1a1aa;background:rgba(255,255,255,.05);padding:1px 5px;border-radius:4px;font-size:10px}'
    + '#panel-traffic .tf-leg{display:flex;gap:10px;flex-wrap:wrap}'
    + '#panel-traffic .tf-leg span{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:#a1a1aa}'
    + '#panel-traffic .tf-leg i{width:8px;height:8px;border-radius:2px;display:inline-block}'
    + '#panel-traffic .tf-t{width:100%;border-collapse:collapse;font-size:12px}'
    + '#panel-traffic .tf-t th{text-align:right;font-size:9.5px;color:#71717a;text-transform:uppercase;letter-spacing:.1em;font-weight:900;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap;cursor:pointer;user-select:none}'
    + '#panel-traffic .tf-t th:first-child,#panel-traffic .tf-t td:first-child{text-align:left}'
    + '#panel-traffic .tf-t th.on{color:#FF6B1F}'
    + '#panel-traffic .tf-t td{padding:8px;border-bottom:1px solid rgba(255,255,255,.05);color:#a1a1aa;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '#panel-traffic .tf-t td b{color:#fff}'
    + '#panel-traffic .tf-t tr:hover td{background:rgba(255,255,255,.015)}'
    + '#panel-traffic .tf-nm{display:flex;align-items:center;gap:8px;color:#e4e4e7;font-weight:700;min-width:0}'
    + '#panel-traffic .tf-nm i{width:9px;height:9px;border-radius:3px;flex-shrink:0;display:inline-block}'
    + '#panel-traffic .tf-paid{font-size:8.5px;font-weight:900;letter-spacing:.1em;padding:2px 5px;border-radius:5px;border:1px solid rgba(245,165,36,.45);color:#F5A524;background:rgba(245,165,36,.08)}'
    + '#panel-traffic .tf-bar{height:4px;background:rgba(255,255,255,.05);border-radius:9px;overflow:hidden;margin-top:5px}'
    + '#panel-traffic .tf-bar>div{height:100%;border-radius:9px}'
    + '#panel-traffic .tf-good{color:#2FBF7E!important;font-weight:800}'
    + '#panel-traffic .tf-mute{color:#3f3f46!important}'
    + '#panel-traffic .tf-mini{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;padding:7px 0;border-top:1px solid rgba(255,255,255,.05)}'
    + '#panel-traffic .tf-mini:first-child{border-top:0}'
    + '#panel-traffic .tf-mini .a{color:#e4e4e7;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#panel-traffic .tf-mini .b{color:#71717a;font-size:11px;white-space:nowrap;margin-left:10px}'
    + '#panel-traffic .tf-mini .b b{color:#fff;font-size:12.5px}'
    + '#panel-traffic .tf-sess{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}'
    + '#panel-traffic .tf-sess:first-child{border-top:0}'
    + '#panel-traffic .tf-sess .w{font-size:10.5px;color:#52525b;width:30px;flex-shrink:0;padding-top:2px;text-align:right}'
    + '#panel-traffic .tf-sess .m{flex:1;min-width:0}'
    + '#panel-traffic .tf-sess .h{font-size:11px;color:#a1a1aa;display:flex;gap:6px;align-items:center;flex-wrap:wrap}'
    + '#panel-traffic .tf-chip{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.12);color:#d4d4d8}'
    + '#panel-traffic .tf-path{font-size:12px;color:#71717a;margin-top:4px;line-height:1.6}'
    + '#panel-traffic .tf-path b{color:#e4e4e7;font-weight:600}'
    + '#panel-traffic .tf-path .mb{color:#7FB2FF}#panel-traffic .tf-path .ck{color:#F5A524;font-weight:800}'
    + '#panel-traffic .tf-scroll{overflow-x:auto;max-width:100%}#panel-traffic .tf-row>*{min-width:0}'
    + '#panel-traffic .tf-feed{max-height:520px;overflow-y:auto;padding-right:4px}'
    + '#panel-traffic .tf-empty{font-size:12px;color:#52525b;padding:18px 0;text-align:center}'
    + '#panel-traffic .tf-fun{display:flex;flex-direction:column;gap:10px}'
    + '#panel-traffic .tf-fs .t{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;color:#d4d4d8}'
    + '#panel-traffic .tf-fs .t span:last-child{color:#71717a}'
    + '#panel-traffic .tf-fs .t b{color:#fff}'
    + '#panel-traffic .tf-fs .bar{height:10px;background:rgba(255,255,255,.05);border-radius:99px;overflow:hidden}'
    + '#panel-traffic .tf-fs .bar>div{height:100%;border-radius:99px}'
    + '#panel-traffic .tf-drop{font-size:10px;color:#52525b;padding-left:2px}'
    + '#panel-traffic .tf-heat{display:grid;grid-template-columns:30px repeat(24,minmax(0,1fr));gap:2px;font-size:9.5px;color:#52525b}'
    + '#panel-traffic .tf-heat div{height:16px;border-radius:3px}'
    + '#panel-traffic .tf-heat .lb{height:auto;background:none;display:flex;align-items:center}'
    + '#panel-traffic .tf-heat .hx{height:auto;background:none;text-align:left}'
    + '#panel-traffic .tf-banner{border:1px solid rgba(245,165,36,.35);background:rgba(245,165,36,.06);color:#F5A524;font-size:11.5px;border-radius:12px;padding:9px 12px;margin-bottom:12px}';

  // ── Shell ───────────────────────────────────────────────────────────────
  function shell() {
    var p = $('panel-traffic'); if (!p || p._built) return;
    p._built = true; p.classList.add('ntx');
    if (!$('tf-css')) { var st = document.createElement('style'); st.id = 'tf-css'; st.textContent = CSS; document.head.appendChild(st); }
    var auto = '1'; try { auto = localStorage.getItem('fsdx_traffic_auto') || '1'; } catch (e) {}
    p.innerHTML = ''
      + '<div class="tf-top"><div>'
      +   '<div class="tf-title">Traffic</div>'
      +   '<div class="tf-sub">Non-member visits to public pages · one visit per browser session · times in CT</div>'
      +   '<div class="tf-meta" id="tf-meta">Loading…</div>'
      + '</div><div class="tf-ctl">'
      +   '<span style="display:flex;align-items:center;gap:7px;font-size:11px;color:#71717a">Auto 60s <span id="tf-auto" class="ntx-sw' + (auto !== '0' ? ' on' : '') + '" onclick="tfAuto()"></span></span>'
      +   '<button class="ntx-btn" onclick="trafficLoad()">↻ Refresh</button>'
      +   '<button class="ntx-btn bad" onclick="tfClear()" title="Reset all traffic counters">Clear</button>'
      + '</div></div>'
      + '<div class="tf-ranges" id="tf-ranges"></div>'
      + '<div id="tf-banner"></div>'
      + '<div class="tf-kpis" id="tf-kpis"></div>'
      + '<div class="tf-row r21">'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h" id="tf-trend-h">Visits</div><div class="tf-leg" id="tf-trend-leg"></div></div><div id="tf-trend"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Funnel</div><div class="tf-note">non-members</div></div><div id="tf-funnel"></div></div>'
      + '</div>'
      + '<div class="ntx-card" style="margin-bottom:12px"><div class="tf-hd"><div class="ntx-h">Channels</div><div class="tf-note">rates are of each channel\'s own visits · click a column to sort</div></div><div class="tf-scroll" id="tf-ch"></div></div>'
      + '<div class="tf-row r11">'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Campaigns <span style="color:#52525b">· utm_campaign</span></div></div><div class="tf-scroll" id="tf-camp"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Landing pages</div><div class="tf-note">where sessions started</div></div><div class="tf-scroll" id="tf-land"></div></div>'
      + '</div>'
      + '<div class="tf-row r21">'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Live sessions</div><div style="display:flex;gap:4px" id="tf-rf"></div></div><div class="tf-feed" id="tf-recent"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Top pages</div><div style="display:flex;gap:6px;align-items:center"><span class="tf-note" id="tf-pg-base"></span><button class="ntx-btn" style="padding:4px 9px;font-size:10.5px" onclick="tfMarkPages()">Mark checked</button></div></div><div id="tf-pages"></div></div>'
      + '</div>'
      + '<div class="tf-row r111">'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Device</div></div><div id="tf-dev"></div><div class="tf-hd" style="margin:14px 0 6px"><div class="ntx-h">New vs returning</div></div><div id="tf-ret"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Countries</div></div><div id="tf-geo"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Referring sites</div></div><div id="tf-ref"></div></div>'
      + '</div>'
      + '<div class="tf-row r21">'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h" id="tf-heat-h">When they visit</div><div class="tf-note">CT</div></div><div id="tf-heat"></div></div>'
      +   '<div class="ntx-card"><div class="tf-hd"><div class="ntx-h">Checkout clicks by product</div><div class="tf-note">members included</div></div><div id="tf-prod"></div></div>'
      + '</div>';
    if (!$('ntx-toast')) { var t = document.createElement('div'); t.id = 'ntx-toast'; t.className = 'ntx-toast'; document.body.appendChild(t); }
    renderRangeChips(); renderRecentChips();
  }

  function chip(label, on, js) { return '<button class="ntx-chip' + (on ? ' on' : '') + '" onclick="' + js + '">' + label + '</button>'; }
  function renderRangeChips() {
    var el = $('tf-ranges'); if (!el) return;
    el.innerHTML = RANGES.map(function (r) { return chip(r[1], RANGE === r[0], "tfRange('" + r[0] + "')"); }).join('');
  }
  function renderRecentChips() {
    var el = $('tf-rf'); if (!el) return;
    el.innerHTML = [['all', 'All'], ['eng', '2+ pages'], ['memb', 'Memberships'], ['chk', 'Checkout']]
      .map(function (r) { return chip(r[1], RECENT_F === r[0], "tfRecent('" + r[0] + "')"); }).join('');
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function delta(cur, prev, ok) {
    if (!ok || !prev) return '';
    var d = Math.round((cur - prev) / prev * 100);
    if (!isFinite(d)) return '';
    var c = d > 0 ? 'up' : d < 0 ? 'dn' : 'fl';
    return ' <span class="tf-d ' + c + '">' + (d > 0 ? '▲' : d < 0 ? '▼' : '•') + Math.abs(d) + '%</span>';
  }
  function deltaPts(cur, prev, ok) { // percentage-point change for rates
    if (!ok || prev == null || cur == null) return '';
    var d = Math.round((cur - prev) * 10) / 10; if (!isFinite(d)) return '';
    var c = d > 0 ? 'up' : d < 0 ? 'dn' : 'fl';
    return ' <span class="tf-d ' + c + '">' + (d > 0 ? '+' : '') + d + 'pt</span>';
  }

  function render() {
    if (!DATA) return;
    renderRangeChips();
    var rd = rangeDays(RANGE), A = agg(rd.cur), P = agg(rd.prev);
    var cmpOk = RANGE !== 'today' && prevUsable(rd.prev, rd.cur.length);
    var cmpLbl = RANGE === 'today' ? 'vs yesterday by this hour' : RANGE === 'month' ? 'vs prior ' + rd.cur.length + ' days' : 'vs prior ' + RANGE + ' days';

    // banner: v2 coverage
    var fd = firstDimDay(), ban = $('tf-banner');
    if (ban) {
      if (!DATA.v) ban.innerHTML = '<div class="tf-banner">The Worker is still on the old traffic route. Deploy <b>nexus-traffic.js</b> to get engagement, campaigns, landing pages, devices and live sessions.</div>';
      else if (!fd) ban.innerHTML = '<div class="tf-banner">New tracking is live in the Worker but no v2 pings yet. Deploy the site (nav-loader.js) and it fills in from the next visit. Visits, sources and pages below are complete.</div>';
      else if (rd.cur.length && rd.cur[rd.cur.length - 1].day < fd) ban.innerHTML = '<div class="tf-banner" style="border-color:rgba(255,255,255,.1);background:rgba(255,255,255,.02);color:#71717a">Engagement, campaigns, landing, device and country start ' + esc(shortDay(fd)) + '. Rates in those sections cover only days since then.</div>';
      else ban.innerHTML = '';
    }

    // KPIs
    var engRate = A.dimV ? A.eng / A.dimV * 100 : null, pEngRate = P.dimV ? P.eng / P.dimV * 100 : null;
    var todayCmp = '';
    if (RANGE === 'today' && rd.prev[0]) {
      var h = ctHour(), py = 0, hy = rd.prev[0].hours || {};
      for (var i = 0; i <= h; i++) py += hy[('0' + i).slice(-2)] || 0;
      todayCmp = delta(A.visits, py, py > 0);
    }
    var k = function (l, v, sub, extra) { return '<div class="tf-k"><div class="l">' + l + '</div><div class="v">' + v + (extra || '') + '</div><div class="s">' + (sub || '&nbsp;') + '</div></div>'; };
    $('tf-kpis').innerHTML = ''
      + k('Visits', n(A.visits), RANGE === 'today' ? cmpLbl : (cmpOk ? cmpLbl : (A.n + ' days')), RANGE === 'today' ? todayCmp : delta(A.visits, P.visits, cmpOk))
      + k('Engaged', engRate == null ? '—' : Math.round(engRate) + '<small>%</small>', engRate == null ? 'opened a 2nd page' : n(A.eng) + ' opened a 2nd page', deltaPts(engRate, pEngRate, cmpOk && P.dimDays === P.n))
      + k('Memberships', n(A.memb) + '<small>' + pctTxt(A.memb, A.visits) + '</small>', 'reached the pricing page', delta(A.memb, P.memb, cmpOk))
      + k('Checkout', n(A.chk) + '<small>' + pctTxt(A.chk, A.visits) + '</small>', 'clicked Proceed to Checkout', delta(A.chk, P.chk, cmpOk))
      + k('Signups', n(A.signups), n(A.trials) + ' trials · ' + n(A.joins) + ' joins · Whop', delta(A.signups, P.signups, cmpOk))
      + k('Visit → signup', A.visits ? pctTxt(A.signups, A.visits) : '—', 'all Whop signups ÷ site visits');

    renderTrend(rd.cur);
    renderFunnel(A);
    renderChannels(A, P, cmpOk);
    renderDimTable('tf-camp', 'camp', A, function (k) { return k; }, 'No tagged campaigns in this range.<div class="tf-note" style="margin-top:8px">Tag ad and bio links like<br><code>?utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign=nt-launch</code></div>', true);
    renderDimTable('tf-land', 'land', A, pageName, 'No landing data in this range yet.', false, true);
    renderSplit('tf-dev', A.dims.dev, { mobile: '📱 Mobile', desktop: '🖥 Desktop', tablet: '📟 Tablet' });
    renderSplit('tf-ret', A.dims.ret, { 'new': 'New visitors', returning: 'Returning' });
    renderList('tf-geo', A.dims.geo, function (k) { return flag(k) + ' ' + esc(CC[k] || k); }, 8);
    renderList('tf-ref', A.dims.ref, function (k) { return esc(k); }, 8, '(none)');
    renderRecent();
    renderPages(A);
    renderHeat(RANGE === 'today' ? rangeDays('30').cur : rd.cur);
    renderProducts(A);
  }

  function renderTrend(days) {
    var el = $('tf-trend'), leg = $('tf-trend-leg'), hd = $('tf-trend-h');
    if (RANGE === 'today') {
      hd.textContent = 'Visits by hour · today';
      var hrs = (days[0] && days[0].hours) || {}, arr = [];
      for (var i = 0; i < 24; i++) arr.push(hrs[('0' + i).slice(-2)] || 0);
      var mx = Math.max(1, Math.max.apply(null, arr)), nowH = ctHour();
      leg.innerHTML = '';
      el.innerHTML = '<div style="display:flex;align-items:flex-end;gap:3px;height:190px">' + arr.map(function (v, i) {
        var lb = i % 3 === 0 ? (i === 0 ? '12a' : i === 12 ? '12p' : i < 12 ? i + 'a' : (i - 12) + 'p') : '';
        var col = i > nowH ? 'rgba(255,255,255,.03)' : v ? '#2FBF7E' : 'rgba(255,255,255,.06)';
        return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" title="' + i + ':00 CT · ' + v + ' visit' + (v === 1 ? '' : 's') + '">'
          + '<div style="font-size:10px;color:#a1a1aa;text-align:center;height:13px">' + (v || '') + '</div>'
          + '<div style="height:' + Math.max(v / mx * 150, 2) + 'px;background:' + col + ';border-radius:3px 3px 0 0;opacity:' + (v ? .85 : 1) + '"></div>'
          + '<div style="font-size:9.5px;color:#52525b;text-align:center;height:14px;margin-top:4px">' + lb + '</div></div>';
      }).join('') + '</div>';
      return;
    }
    hd.textContent = 'Visits by channel · signups';
    var d = days.slice().reverse(); // oldest → newest
    if (!d.length) { el.innerHTML = '<div class="tf-empty">No data.</div>'; return; }
    var tot = {}; d.forEach(function (x) { for (var s in (x.sources || {})) tot[s] = (tot[s] || 0) + x.sources[s]; });
    var top = Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a]; }).slice(0, 5);
    var W = 900, H = 220, pl = 30, pr = 30, pt = 10, pb = 22, nn = d.length;
    var mx = Math.max(1, Math.max.apply(null, d.map(function (x) { return x.total || 0; })));
    var ms = Math.max(1, Math.max.apply(null, d.map(function (x) { return (x.joins || 0) + (x.trials || 0); })));
    var bw = (W - pl - pr) / nn, gap = Math.min(3, bw * 0.25);
    var y = function (v) { return pt + (1 - v / mx) * (H - pt - pb); };
    var ys = function (v) { return pt + (1 - v / ms) * (H - pt - pb); };
    var out = '';
    [0, 0.5, 1].forEach(function (f) {
      var yy = y(mx * f).toFixed(1);
      out += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="rgba(255,255,255,.05)"/>'
        + '<text x="' + (pl - 6) + '" y="' + (+yy + 3) + '" fill="#52525b" font-size="10" text-anchor="end">' + Math.round(mx * f) + '</text>';
    });
    var hasSign = d.some(function (x) { return (x.joins || 0) + (x.trials || 0) > 0; });
    if (hasSign) out += '<text x="' + (W - pr + 6) + '" y="' + (pt + 3) + '" fill="#FF6B1F" font-size="10">' + ms + '</text>';
    var pts = [];
    d.forEach(function (x, i) {
      var x0 = pl + i * bw + gap / 2, w = Math.max(bw - gap, 1), acc = 0, segs = '';
      var parts = top.map(function (s, j) { return [s, (x.sources || {})[s] || 0, srcColor(s, j)]; });
      var other = (x.total || 0) - parts.reduce(function (a, p) { return a + p[1]; }, 0);
      if (other > 0) parts.push(['other', other, '#3f3f46']);
      parts.forEach(function (p) {
        if (!p[1]) return;
        var y1 = y(acc + p[1]), y0 = y(acc);
        segs += '<rect x="' + x0.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(y0 - y1, 0.5).toFixed(1) + '" fill="' + p[2] + '" opacity=".82"/>';
        acc += p[1];
      });
      var su = (x.joins || 0) + (x.trials || 0);
      var tip = shortDay(x.day) + ' · ' + (x.total || 0) + ' visits' + (top.length ? ' — ' + parts.filter(function (p) { return p[1]; }).map(function (p) { return (p[0] === 'other' ? 'Other' : srcName(p[0])) + ' ' + p[1]; }).join(', ') : '') + (su ? ' · ' + su + ' signup' + (su > 1 ? 's' : '') : '');
      out += '<g><title>' + esc(tip) + '</title><rect x="' + (pl + i * bw).toFixed(1) + '" y="' + pt + '" width="' + bw.toFixed(1) + '" height="' + (H - pt - pb) + '" fill="transparent"/>' + segs + '</g>';
      pts.push([x0 + w / 2, ys(su), su]);
    });
    if (hasSign) {
      out += '<path d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#FF6B1F" stroke-width="1.5" stroke-opacity=".55"/>';
      pts.forEach(function (p) { if (p[2]) out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="#FF6B1F" stroke="#09090b" stroke-width="1.5" pointer-events="none"/>'; });
    }
    var ticks = nn <= 8 ? d.map(function (_, i) { return i; }) : [0, Math.floor(nn / 4), Math.floor(nn / 2), Math.floor(nn * 3 / 4), nn - 1];
    ticks.forEach(function (i) { out += '<text x="' + (pl + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" fill="#52525b" font-size="10" text-anchor="middle">' + esc(shortDay(d[i].day)) + '</text>'; });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + out + '</svg>';
    leg.innerHTML = top.map(function (s, j) { return '<span><i style="background:' + srcColor(s, j) + '"></i>' + esc(srcName(s)) + '</span>'; }).join('')
      + (hasSign ? '<span><i style="background:#FF6B1F;border-radius:50%"></i>Signups</span>' : '');
  }

  function renderFunnel(A) {
    var steps = [
      ['Visits', A.visits, '#2FBF7E'],
      ['Reached Memberships', A.memb, '#7FB2FF'],
      ['Clicked checkout', A.chk, '#F5A524'],
      ['Signed up (Whop)', A.signups, '#FF6B1F', 'any source — not only site visitors']
    ];
    var base = Math.max(1, A.visits), prev = null;
    $('tf-funnel').innerHTML = '<div class="tf-fun">' + steps.map(function (s) {
      if (s[1] == null) return '';
      var w = Math.max(s[1] / base * 100, 1.5), drop = '';
      if (prev != null && prev > 0) drop = '<div class="tf-drop">↳ ' + pctTxt(s[1], prev) + ' of previous step</div>';
      prev = s[1];
      return '<div class="tf-fs">' + drop + '<div class="t"><span>' + esc(s[0]) + '</span><span><b>' + n(s[1]) + '</b> · ' + pctTxt(s[1], base) + '</span></div>'
        + '<div class="bar"><div style="width:' + Math.min(w, 100) + '%;background:' + s[2] + '"></div></div>'
        + (s[3] ? '<div class="tf-note" style="margin-top:3px">' + esc(s[3]) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // Sortable table helper
  function th(tbl, key, label) { return '<th class="' + (TABLE[tbl] === key ? 'on' : '') + '" onclick="tfSort(\'' + tbl + '\',\'' + key + '\')">' + label + '</th>'; }
  function rate(a, b, good) {
    if (!b) return '<td class="tf-mute">—</td>';
    var p = a / b * 100;
    return '<td class="' + (good && p >= good && b >= 5 ? 'tf-good' : '') + '">' + pctTxt(a, b) + '</td>';
  }

  function renderChannels(A, P, cmpOk) {
    var el = $('tf-ch');
    var rows = Object.keys(A.sources).map(function (s) {
      var sp = A.sp[s] || {}, dm = (A.dims.src || {})[s] || null;
      return { s: s, visits: A.sources[s], memb: sp['/memberships'] || 0, chk: sp['/checkout-started'] || 0,
        eng: dm && dm.v ? dm.e / dm.v : null, ev: dm ? dm.v : 0, prev: P.sources[s] || 0 };
    }).filter(function (r) { return r.visits > 0; });
    if (!rows.length) { el.innerHTML = '<div class="tf-empty">No visits in this range.</div>'; return; }
    var sk = TABLE.ch;
    rows.sort(function (a, b) {
      var f = function (r) { return sk === 'visits' ? r.visits : sk === 'eng' ? (r.eng == null ? -1 : r.eng) : sk === 'memb' ? r.memb / r.visits : sk === 'chk' ? r.chk / r.visits : sk === 'delta' ? (r.prev ? (r.visits - r.prev) / r.prev : 9e9) : r.visits; };
      return f(b) - f(a) || b.visits - a.visits;
    });
    var mx = Math.max.apply(null, rows.map(function (r) { return r.visits; }));
    el.innerHTML = '<table class="tf-t"><thead><tr>' + th('ch', 'visits', 'Channel') + th('ch', 'visits', 'Visits') + '<th>Share</th>'
      + th('ch', 'eng', 'Engaged') + th('ch', 'memb', '→ Memberships') + th('ch', 'chk', '→ Checkout') + (cmpOk ? th('ch', 'delta', 'Δ Visits') : '') + '</tr></thead><tbody>'
      + rows.map(function (r, i) {
        var d = cmpOk ? (r.prev ? delta(r.visits, r.prev, true) : '<span class="tf-d up">new</span>') : '';
        return '<tr><td style="min-width:170px"><div class="tf-nm"><i style="background:' + srcColor(r.s, i) + '"></i>' + esc(srcName(r.s)) + (isPaid(r.s) ? ' <span class="tf-paid">PAID</span>' : '') + '</div>'
          + '<div class="tf-bar"><div style="width:' + Math.max(r.visits / mx * 100, 2) + '%;background:' + srcColor(r.s, i) + ';opacity:.7"></div></div></td>'
          + '<td><b>' + n(r.visits) + '</b></td><td>' + pctTxt(r.visits, A.visits) + '</td>'
          + (r.eng == null ? '<td class="tf-mute">—</td>' : '<td class="' + (r.eng >= .5 && r.ev >= 5 ? 'tf-good' : '') + '">' + Math.round(r.eng * 100) + '%</td>')
          + rate(r.memb, r.visits, 25) + rate(r.chk, r.visits, 5) + (cmpOk ? '<td>' + d + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function renderDimTable(id, dim, A, label, empty, skipNone, bounce) {
    var el = $(id), m = A.dims[dim] || {}, tbl = id === 'tf-camp' ? 'camp' : 'land';
    var rows = Object.keys(m).filter(function (k) { return m[k].v > 0 && !(skipNone && k === '(none)'); })
      .map(function (k) { return { k: k, r: m[k] }; });
    if (!rows.length) { el.innerHTML = '<div class="tf-empty">' + empty + '</div>'; return; }
    var sk = TABLE[tbl];
    rows.sort(function (a, b) {
      var f = function (x) { var r = x.r; return sk === 'eng' ? r.e / r.v : sk === 'memb' ? r.m / r.v : sk === 'chk' ? r.k / r.v : r.v; };
      return f(b) - f(a) || b.r.v - a.r.v;
    });
    el.innerHTML = '<table class="tf-t"><thead><tr><th>' + (dim === 'camp' ? 'Campaign' : 'Page') + '</th>' + th(tbl, 'visits', 'Visits')
      + th(tbl, 'eng', bounce ? 'Bounce' : 'Engaged') + th(tbl, 'memb', '→ Memb.') + th(tbl, 'chk', '→ Checkout') + '</tr></thead><tbody>'
      + rows.slice(0, 12).map(function (x) {
        var r = x.r, engCell;
        if (bounce) { var b = r.v ? (1 - r.e / r.v) * 100 : 0; engCell = '<td class="' + (b <= 50 && r.v >= 5 ? 'tf-good' : '') + '">' + Math.round(b) + '%</td>'; }
        else engCell = rate(r.e, r.v, 50);
        return '<tr><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis"><span class="tf-nm" style="display:inline">' + esc(label(x.k)) + '</span></td><td><b>' + n(r.v) + '</b></td>'
          + engCell + rate(r.m, r.v, 25) + rate(r.k, r.v, 5) + '</tr>';
      }).join('') + '</tbody></table>' + (rows.length > 12 ? '<div class="tf-note" style="margin-top:6px">+' + (rows.length - 12) + ' more</div>' : '');
  }

  function renderSplit(id, m, names) {
    var el = $(id); m = m || {};
    var keys = Object.keys(m).filter(function (k) { return m[k].v; }).sort(function (a, b) { return m[b].v - m[a].v; });
    var tot = keys.reduce(function (a, k) { return a + m[k].v; }, 0);
    if (!tot) { el.innerHTML = '<div class="tf-empty" style="padding:8px 0;text-align:left">No data in this range yet.</div>'; return; }
    el.innerHTML = keys.map(function (k) {
      var r = m[k];
      return '<div class="tf-mini"><span class="a">' + esc(names[k] || k) + '</span><span class="b"><b>' + pctTxt(r.v, tot) + '</b> · ' + n(r.v)
        + ' · chk ' + pctTxt(r.k, r.v) + '</span></div>'
        + '<div class="tf-bar" style="margin:0 0 4px"><div style="width:' + (r.v / tot * 100) + '%;background:#7FB2FF;opacity:.6"></div></div>';
    }).join('');
  }

  function renderList(id, m, label, cap, skip) {
    var el = $(id); m = m || {};
    var keys = Object.keys(m).filter(function (k) { return m[k].v && k !== skip; }).sort(function (a, b) { return m[b].v - m[a].v; });
    var tot = 0; for (var k in m) tot += m[k].v || 0;
    if (!keys.length) { el.innerHTML = '<div class="tf-empty" style="padding:8px 0;text-align:left">' + (skip ? 'No referring sites in this range.' : 'No data in this range yet.') + '</div>'; return; }
    el.innerHTML = keys.slice(0, cap).map(function (k) {
      var r = m[k];
      return '<div class="tf-mini"><span class="a">' + label(k) + '</span><span class="b"><b>' + n(r.v) + '</b> · ' + pctTxt(r.v, tot)
        + (r.k ? ' · <span style="color:#F5A524">' + r.k + ' chk</span>' : '') + '</span></div>';
    }).join('') + (keys.length > cap ? '<div class="tf-note" style="margin-top:6px">+' + (keys.length - cap) + ' more</div>' : '');
  }

  function renderRecent() {
    var el = $('tf-recent'), rows = (DATA && DATA.recent) || [];
    var f = rows.filter(function (r) {
      var p = (r.p || []).map(normPage);
      if (RECENT_F === 'eng') return p.filter(function (x) { return x.indexOf('/checkout') !== 0; }).length >= 2;
      if (RECENT_F === 'memb') return p.indexOf('/memberships') !== -1;
      if (RECENT_F === 'chk') return p.indexOf('/checkout-started') !== -1 || p.some(function (x) { return x.indexOf('/checkout/') === 0; });
      return true;
    });
    if (!rows.length) { el.innerHTML = '<div class="tf-empty">Sessions show here as they happen once the new site beacon is live.</div>'; return; }
    if (!f.length) { el.innerHTML = '<div class="tf-empty">No recent sessions match.</div>'; return; }
    el.innerHTML = f.map(function (r) {
      var seen = {}, path = (r.p || []).map(normPage).filter(function (x) { if (x.indexOf('/checkout/') === 0) return false; if (seen[x]) return false; seen[x] = 1; return true; });
      var prods = (r.p || []).map(normPage).filter(function (x) { return x.indexOf('/checkout/') === 0; }).map(function (x) { return x.slice(10); });
      var steps = path.map(function (x) {
        var c = x === '/memberships' ? 'mb' : x === '/checkout-started' ? 'ck' : '';
        return '<b class="' + c + '">' + esc(pageName(x)) + '</b>';
      }).join(' <span style="color:#3f3f46">→</span> ');
      if (prods.length) steps += ' <span class="ck">(' + esc(prods.join(', ')) + ')</span>';
      var dev = r.dev === 'mobile' ? '📱' : r.dev === 'tablet' ? '📟' : '🖥';
      var live = r.l && Date.now() - r.l < 5 * 6e4;
      return '<div class="tf-sess"><div class="w">' + ago(r.t) + '</div><div class="m"><div class="h">'
        + '<span class="tf-chip" style="border-color:' + srcColor(r.src) + '66;color:' + srcColor(r.src) + '">' + esc(srcName(r.src)) + '</span>'
        + (r.camp ? '<span class="tf-chip">' + esc(r.camp) + '</span>' : '')
        + '<span>' + dev + ' ' + flag(r.cc) + ' ' + esc(r.cc || '') + '</span>'
        + (r.ret ? '<span style="color:#7FB2FF">returning</span>' : '<span style="color:#52525b">new</span>')
        + (live ? '<span style="color:#2FBF7E;font-weight:800">● on site</span>' : '')
        + '</div><div class="tf-path">' + steps + '</div></div></div>';
    }).join('');
  }

  function getSnap() {
    try { var s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); return s && s.day === ctDay() ? s : null; } catch (e) { return null; }
  }
  function renderPages(A) {
    var el = $('tf-pages'), bEl = $('tf-pg-base');
    var ent = Object.keys(A.pages).filter(function (k) { return k.indexOf('/checkout') !== 0; })
      .map(function (k) { return [k, A.pages[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var snap = RANGE === 'today' ? getSnap() : null, base = null;
    if (snap) { base = {}; addMap(base, snap.pages, normPage); }
    if (bEl) bEl.textContent = RANGE !== 'today' ? '+deltas on Today' : snap ? 'since ' + new Date(snap.at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : '';
    var tot = ent.reduce(function (a, e) { return a + e[1]; }, 0);
    if (!ent.length) { el.innerHTML = '<div class="tf-empty">No page views in this range.</div>'; return; }
    var mx = ent[0][1];
    el.innerHTML = ent.slice(0, 12).map(function (e) {
      var d = base ? e[1] - (base[e[0]] || 0) : 0;
      return '<div class="tf-mini" style="display:block"><div style="display:flex;justify-content:space-between"><span class="a">' + esc(pageName(e[0])) + '</span><span class="b"><b>' + n(e[1]) + '</b> · ' + pctTxt(e[1], tot)
        + (d > 0 ? ' <span style="color:#2FBF7E;font-weight:800">+' + d + '</span>' : '') + '</span></div>'
        + '<div class="tf-bar"><div style="width:' + Math.max(e[1] / mx * 100, 2) + '%;background:' + (e[0] === '/memberships' ? '#7FB2FF' : '#2FBF7E') + ';opacity:.65"></div></div></div>';
    }).join('') + (ent.length > 12 ? '<div class="tf-note" style="margin-top:6px">+' + (ent.length - 12) + ' more</div>' : '');
  }

  function renderHeat(days) {
    var el = $('tf-heat'), hd = $('tf-heat-h');
    hd.textContent = 'When they visit · ' + (RANGE === 'today' ? 'last 30 days' : days.length + ' days');
    var grid = [], mx = 0, tot = 0, byDow = [0, 0, 0, 0, 0, 0, 0];
    for (var r = 0; r < 7; r++) { grid.push([]); for (var c = 0; c < 24; c++) grid[r].push(0); }
    days.forEach(function (d) {
      var dow = (new Date(d.day + 'T12:00:00Z').getUTCDay() + 6) % 7; // Mon=0
      for (var h in (d.hours || {})) { var v = d.hours[h]; grid[dow][+h] += v; byDow[dow] += v; tot += v; }
    });
    grid.forEach(function (row) { row.forEach(function (v) { if (v > mx) mx = v; }); });
    if (!tot) { el.innerHTML = '<div class="tf-empty">No hourly data in this range.</div>'; return; }
    var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], out = '<div class="tf-heat"><div class="lb"></div>';
    for (var c2 = 0; c2 < 24; c2++) out += '<div class="hx">' + (c2 % 6 === 0 ? (c2 === 0 ? '12a' : c2 === 12 ? '12p' : c2 < 12 ? c2 + 'a' : (c2 - 12) + 'p') : '') + '</div>';
    grid.forEach(function (row, ri) {
      out += '<div class="lb">' + names[ri] + '</div>';
      row.forEach(function (v, ci) {
        var a = v ? (0.15 + 0.85 * v / mx) : 0;
        out += '<div title="' + names[ri] + ' ' + ci + ':00 CT · ' + v + ' visit' + (v === 1 ? '' : 's') + '" style="background:' + (v ? 'rgba(47,191,126,' + a.toFixed(2) + ')' : 'rgba(255,255,255,.035)') + '"></div>';
      });
    });
    out += '</div>';
    // best slots
    var cells = [];
    grid.forEach(function (row, ri) { row.forEach(function (v, ci) { if (v) cells.push([v, ri, ci]); }); });
    cells.sort(function (a, b) { return b[0] - a[0]; });
    var fmtH = function (h) { return h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p'; };
    var bestDow = byDow.indexOf(Math.max.apply(null, byDow));
    out += '<div class="tf-note" style="margin-top:10px">Busiest day: <b style="color:#e4e4e7">' + names[bestDow] + '</b> (' + pctTxt(byDow[bestDow], tot) + ')'
      + (cells.length ? ' · Peak hours: ' + cells.slice(0, 3).map(function (c) { return '<b style="color:#e4e4e7">' + names[c[1]] + ' ' + fmtH(c[2]) + '</b>'; }).join(', ') : '') + '</div>';
    el.innerHTML = out;
  }

  function renderProducts(A) {
    var el = $('tf-prod');
    var nm = { raven: 'Raven', nightwing: 'Nightwing', autotrader: 'Auto Trader', tools: 'Suite / Tools', membership: 'Membership (Knightfall)' };
    var ent = Object.keys(A.pages).filter(function (k) { return k.indexOf('/checkout/') === 0; })
      .map(function (k) { return [k.slice(10), A.pages[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!ent.length) { el.innerHTML = '<div class="tf-empty">No checkout clicks in this range.</div>'; return; }
    var mx = ent[0][1];
    el.innerHTML = ent.map(function (e) {
      return '<div class="tf-mini" style="display:block"><div style="display:flex;justify-content:space-between"><span class="a">' + esc(nm[e[0]] || e[0]) + '</span><span class="b"><b style="color:#F5A524">' + n(e[1]) + '</b></span></div>'
        + '<div class="tf-bar"><div style="width:' + Math.max(e[1] / mx * 100, 2) + '%;background:#F5A524;opacity:.7"></div></div></div>';
    }).join('') + '<div class="tf-note" style="margin-top:8px">Clicks on Proceed to Checkout, not purchases. Purchases live in Money.</div>';
  }

  // ── Load + controls ─────────────────────────────────────────────────────
  function meta() {
    var el = $('tf-meta'); if (!el) return;
    var t = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    var s = DATA && DATA.since ? new Date(DATA.since).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }) : null;
    el.textContent = (s ? 'Counting since ' + s + ' · ' : '') + 'Updated ' + t + ' CT';
  }
  // Older Worker: no days[] — rebuild a minimal one from the legacy fields.
  function adaptLegacy(d) {
    if (d.days) return d;
    var days = (d.daily || []).slice().reverse().map(function (x) { return { day: x.day, total: x.total, sources: x.sources || {}, pages: {}, hours: {}, sourcePages: {}, dims: null }; });
    if (days[0]) { days[0].pages = d.todayPages || {}; }
    d.days = days; d.recent = []; return d;
  }
  window.trafficLoad = function () {
    shell();
    if (BUSY) return; BUSY = true;
    return api('/api/admin/visits').then(function (d) { DATA = adaptLegacy(d); meta(); render(); })
      .catch(function (e) { var m = $('tf-meta'); if (m) m.textContent = 'Couldn\'t load traffic — ' + e.message; })
      .then(function () { BUSY = false; });
  };
  window.tfRange = function (r) { RANGE = r; try { localStorage.setItem('fsdx_traffic_range', r); } catch (e) {} render(); };
  window.tfRecent = function (f) { RECENT_F = f; renderRecentChips(); renderRecent(); };
  window.tfSort = function (t, k) { TABLE[t] = k; render(); };
  window.tfMarkPages = function () {
    if (!DATA || !DATA.days[0]) return;
    try { localStorage.setItem(SNAP_KEY, JSON.stringify({ day: ctDay(), at: new Date().toISOString(), pages: DATA.days[0].pages || {} })); } catch (e) {}
    if (RANGE !== 'today') tfRange('today'); else render();
    toast('Baseline set — new views show as +N');
  };
  window.tfClear = function () {
    if (!confirm('Reset all site-traffic counts to zero? This deletes the recorded visit data and can\'t be undone.')) return;
    api('/api/admin/visits', { method: 'DELETE' }).then(function () { toast('Traffic data cleared'); trafficLoad(); })
      .catch(function (e) { toast('Clear failed — ' + e.message, true); });
  };
  function startTimer(on) {
    if (TIMER) { clearInterval(TIMER); TIMER = null; }
    if (on) TIMER = setInterval(function () {
      var p = $('panel-traffic');
      if (p && p.classList.contains('active') && !document.hidden) trafficLoad();
    }, 60000);
  }
  window.tfAuto = function () {
    var sw = $('tf-auto'); if (!sw) return;
    var on = !sw.classList.contains('on'); sw.classList.toggle('on', on);
    try { localStorage.setItem('fsdx_traffic_auto', on ? '1' : '0'); } catch (e) {}
    startTimer(on);
  };
  try { RANGE = localStorage.getItem('fsdx_traffic_range') || '30'; } catch (e) {}
  var a0 = '1'; try { a0 = localStorage.getItem('fsdx_traffic_auto') || '1'; } catch (e) {}
  startTimer(a0 !== '0');
  document.addEventListener('visibilitychange', function () {
    var p = $('panel-traffic');
    if (!document.hidden && p && p.classList.contains('active') && TIMER) trafficLoad();
  });
})();
