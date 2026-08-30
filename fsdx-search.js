/* ==========================================================================
   fsdx-search.js — ⌘K command palette

   The nav no longer lists every deep link (ORB PRO, Stack V1, Live Track
   Record, Live Sessions …). This is how those stay reachable: type two or
   three letters instead of hunting a tree.

   Load it after nav-loader.js:
       <script src="fsdx-search.js"></script>

   Open with ⌘K / Ctrl-K, or the Search button in the sidebar.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- index -----------------------------------------------------------
     `vip:true` entries only appear for a logged-in member.
     `kw` is extra search text that never renders.
  ---------------------------------------------------------------------- */
  var PAGES = [
    // member tools
    {t:'Dashboard',       u:'dashboard.html', g:'Workspace', vip:1, kw:'home overview pnl equity today'},
    {t:'Trade Journal',   u:'journal.html',   g:'Workspace', vip:1, kw:'log calendar trades notes grades'},
    {t:'Accounts',        u:'accounts.html',  g:'Workspace', vip:1, kw:'prop firm apex lucid drawdown tracker'},
    {t:'Playbook',        u:'playbook.html',  g:'Workspace', vip:1, kw:'rules entries stops targets risk profile'},
    {t:'Backtest Workspace', u:'backtest.html', g:'Workspace', vip:1, kw:'import csv stats equity curve'},
    {t:'Scout Alerts',    u:'alerts.html',    g:'Workspace', vip:1, kw:'signals discord webhook live'},
    {t:'Trade Importer',  u:'converter.html', g:'Workspace', vip:1, kw:'csv upload tradovate convert'},
    {t:'My Profile',      u:'profile.html',   g:'Workspace', vip:1, kw:'account password email settings'},
    {t:'Session Recaps',  u:'recaps.html',    g:'Workspace', vip:1, kw:'review morning notes'},

    // products — these used to be the ↳ sub-links
    {t:'The System',            u:'suite.html',                g:'Products', kw:'suite tools overview indicators'},
    {t:'ORB PRO — Knightfall MK1', u:'suite.html#tool-orbpro', g:'Products', kw:'signal engine indicator grading breakout main'},
    {t:'Stack V1',              u:'suite.html#tool-stack',     g:'Products', kw:'trend mtf timeframe confirmation'},
    {t:'Volume Indicator',      u:'suite.html#tool-volume',    g:'Products', kw:'volume engine breakout companion'},
    {t:'Nexus 2.0',             u:'suite.html#tool-nexus',     g:'Products', kw:'chrome extension journal optimizer sidepanel'},
    {t:'ORB Auto-Trader',       u:'autotrader.html',           g:'Products', kw:'automation pickmytrade tradovate hands off at'},

    // proof
    {t:'Results',           u:'results.html',      g:'Results', kw:'backtest data stats grades'},
    {t:'Backtest (7-year)', u:'results.html',      g:'Results', kw:'seven year history annual ledger'},
    {t:'Risk Profile Planner', u:'results.html#risk-profiles', g:'Results', kw:'account size eval pass rate 50k 100k 150k 250k'},
    {t:'Live Track Record', u:'track-record.html', g:'Results', kw:'live forward walked trades posted verified mk1'},

    // site
    {t:'Home',            u:'index.html',       g:'Site', kw:'start landing'},
    {t:'Membership',      u:'memberships.html', g:'Site', kw:'pricing plans monthly quarterly annual trial join'},
    {t:'Getting Started', u:'setup.html',       g:'Site', kw:'setup install tradingview access onboarding'},
    {t:'Live Sessions',   u:'schedule.html',    g:'Site', kw:'schedule 8:30 morning room gameplan monday'},
    {t:'Knowledge Base',  u:'knowledge.html',   g:'Site', kw:'guides docs walkthrough videos help'},
    {t:'Affiliates',      u:'affiliates.html',  g:'Site', kw:'apex prop firm partners discount'},
    {t:'Contact & Help',  u:'contact.html',     g:'Site', kw:'support ticket email'},
    {t:'FAQ',             u:'faq.html',         g:'Site', kw:'questions answers'},
    {t:'Disclosures',     u:'disclosures.html', g:'Site', kw:'legal risk cftc privacy terms'},
    {t:'Discord',         u:'https://discord.gg/RePdHESvSx', g:'Site', ext:1, kw:'community chat room'},
  ];

  var open = false, items = [], sel = 0, el = {};

  /* ---- styles ---------------------------------------------------------- */
  var CSS = `
  #fsdx-cmd{position:fixed;inset:0;z-index:9999;display:none;padding:12vh 16px 16px;
    background:rgba(2,5,10,.72);backdrop-filter:blur(4px)}
  #fsdx-cmd.on{display:block}
  #fsdx-cmd-box{max-width:560px;margin:0 auto;background:#0B1119;border:1px solid rgba(120,160,210,.16);
    border-radius:12px;box-shadow:0 40px 90px -30px rgba(0,0,0,1);overflow:hidden;
    font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
  #fsdx-cmd-in{width:100%;background:transparent;border:0;outline:0;color:#E6EAF0;
    font-size:15px;padding:16px 18px;border-bottom:1px solid rgba(120,160,210,.13)}
  #fsdx-cmd-in::placeholder{color:#485565}
  #fsdx-cmd-list{max-height:52vh;overflow-y:auto;padding:6px}
  .fsdx-cmd-g{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700;
    letter-spacing:.2em;text-transform:uppercase;color:#485565;padding:10px 12px 5px}
  .fsdx-cmd-i{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:7px;
    cursor:pointer;color:#A2AEBF;font-size:13.5px;text-decoration:none}
  .fsdx-cmd-i .n{color:#E6EAF0;font-weight:600}
  .fsdx-cmd-i.sel{background:rgba(255,107,31,.13);color:#FFC0A0}
  .fsdx-cmd-i.sel .n{color:#FFC0A0}
  .fsdx-cmd-i .go{margin-left:auto;font-size:10px;color:#485565}
  .fsdx-cmd-i.sel .go{color:#FF6B1F}
  #fsdx-cmd-none{padding:26px 18px;text-align:center;color:#485565;font-size:13px}
  #fsdx-cmd-foot{border-top:1px solid rgba(120,160,210,.13);padding:8px 14px;display:flex;gap:14px;
    font-size:10px;color:#485565;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  `;

  function mount() {
    if (el.root) return;
    var st = document.createElement('style'); st.textContent = CSS;
    document.head.appendChild(st);

    var d = document.createElement('div');
    d.id = 'fsdx-cmd';
    d.innerHTML =
      '<div id="fsdx-cmd-box">' +
        '<input id="fsdx-cmd-in" placeholder="Search pages, tools, data…" autocomplete="off" spellcheck="false">' +
        '<div id="fsdx-cmd-list"></div>' +
        '<div id="fsdx-cmd-foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>' +
      '</div>';
    document.body.appendChild(d);

    el.root = d;
    el.in   = d.querySelector('#fsdx-cmd-in');
    el.list = d.querySelector('#fsdx-cmd-list');

    d.addEventListener('mousedown', function (e) { if (e.target === d) close(); });
    el.in.addEventListener('input', function () { render(el.in.value); });
    el.in.addEventListener('keydown', key);
  }

  function pool() {
    var vip = false;
    try { vip = !!localStorage.getItem('fsdx_token'); } catch (e) {}
    return PAGES.filter(function (p) { return vip || !p.vip; });
  }

  function score(p, q) {
    var t = p.t.toLowerCase(), k = (p.kw || '').toLowerCase();
    if (t === q) return 100;
    if (t.indexOf(q) === 0) return 80;
    if (t.indexOf(q) > -1) return 60;
    if (k.indexOf(q) > -1) return 40;
    // loose: every character in order
    var i = 0;
    for (var c = 0; c < t.length && i < q.length; c++) if (t[c] === q[i]) i++;
    return i === q.length ? 20 : -1;
  }

  function render(q) {
    q = (q || '').trim().toLowerCase();
    items = q
      ? pool().map(function (p) { return { p: p, s: score(p, q) }; })
              .filter(function (r) { return r.s > 0; })
              .sort(function (a, b) { return b.s - a.s; })
              .map(function (r) { return r.p; })
      : pool();
    sel = 0;

    if (!items.length) {
      el.list.innerHTML = '<div id="fsdx-cmd-none">Nothing matches “' +
        q.replace(/[<>&]/g, '') + '”</div>';
      return;
    }

    var html = '', group = null;
    items.forEach(function (p, i) {
      if (p.g !== group) { group = p.g; html += '<div class="fsdx-cmd-g">' + group + '</div>'; }
      html += '<a class="fsdx-cmd-i' + (i === sel ? ' sel' : '') + '" data-i="' + i + '" href="' + p.u + '"' +
              (p.ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
              '<span class="n">' + p.t + '</span>' +
              '<span class="go">' + (p.ext ? '↗' : '↵') + '</span></a>';
    });
    el.list.innerHTML = html;

    el.list.querySelectorAll('.fsdx-cmd-i').forEach(function (a) {
      a.addEventListener('mouseenter', function () { sel = +a.dataset.i; mark(); });
    });
  }

  function mark() {
    el.list.querySelectorAll('.fsdx-cmd-i').forEach(function (a, i) {
      a.classList.toggle('sel', i === sel);
      if (i === sel) a.scrollIntoView({ block: 'nearest' });
    });
  }

  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); mark(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var p = items[sel];
      if (!p) return;
      close();
      if (p.ext) window.open(p.u, '_blank', 'noopener');
      else window.location.href = p.u;
    }
  }

  function show() {
    mount();
    open = true;
    el.root.classList.add('on');
    el.in.value = '';
    render('');
    el.in.focus();
  }
  function close() {
    if (!el.root) return;
    open = false;
    el.root.classList.remove('on');
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open ? close() : show(); }
    else if (e.key === 'Escape' && open) close();
  });

  window.fsdxOpenSearch = show;
  window.fsdxCloseSearch = close;
})();
