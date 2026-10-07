// nav-loader.js — Universal nav loader
// Handles logged-in and logged-out states automatically

// ── Mobile menu toggle ──
// The hamburger in the mobile header calls toggleMobileMenu() inline, but the
// function itself was pasted into each page's own <script> block. Five pages
// (course, how-to, partners, playbook, refer) got the button and never got the
// function, so tapping it threw "toggleMobileMenu is not defined" and the nav
// could not be opened on a phone at all — including the close button inside
// the injected nav, which calls the same function.
//
// Defining it here fixes all of them at once and means a new page only has to
// load this file. Pages that still declare their own copy in <body> simply
// overwrite this one with an identical implementation, so nothing changes for
// them.
window.toggleMobileMenu = function () {
  var sidebar = document.getElementById('sidebar-panel');
  if (!sidebar) return;
  sidebar.classList.toggle('-translate-x-full');
};

// ── Site traffic beacon ──
// Non-members only, public marketing pages only. Fires once per session PER page.
// The first ping of the session also counts as the visit (top counters + source);
// every page a visitor opens is tallied for the "Pages Visited" breakdown.
(function() {
  try {
    // Only count non-members: skip if a logged-in session exists
    if (localStorage.getItem('fsdx_token')) return;
    // Count marketing pages only — an ALLOWLIST, deliberately.
    //
    // This was a denylist (/admin|login|reset|dashboard|profile|journal|
    // tracker|playbook/) and it failed open: accounts, backtest, converter and
    // alerts were never in it, so a logged-out visitor bouncing off the login
    // redirect on those pages was logged as public traffic. That inflates
    // Visits and drags down every conversion rate under it.
    //
    // The `tracker` entry also matched nothing — there is no tracker.html, the
    // tracker UI lives at accounts.html#trackers. The guard was written for a
    // page that later moved, and stopped covering it in silence.
    //
    // An allowlist fails the safe way instead: a NEW page is not counted until
    // it is added here. Undercounting a marketing page is easy to spot and fix;
    // a gated page quietly polluting the funnel is not.
    var PUBLIC_PAGES = [
      'index', 'suite', 'autotrader', 'results', 'track-record', 'memberships',
      'nightwing', 'raven', 'compare', 'free-indicators', 'platform', 'partners', 'giveaways',
      'knowledge', 'faq', 'contact', 'schedule', 'disclosures', 'affiliates',
      'setup', 'welcome', '404', 'tradingview-update', 'releases'
    ];

    var rawPath = location.pathname || '/';
    // Works for "/", "/suite", "/suite.html" and "/a/b/suite.html" alike.
    var page = (rawPath.toLowerCase().split('?')[0].split('#')[0].split('/').pop() || '').replace(/\.html$/, '');
    if (!page) page = 'index';
    if (PUBLIC_PAGES.indexOf(page) === -1) return;

    // One ping per page per session
    var pgKey = rawPath.toLowerCase().split('?')[0].split('#')[0];
    if (sessionStorage.getItem('fsdx_pv:' + pgKey)) return;
    sessionStorage.setItem('fsdx_pv:' + pgKey, '1');

    // Is this the first tracked page of the whole session? → count it as a visit.
    var firstOfSession = !sessionStorage.getItem('fsdx_v');
    // Every ping carries the source that STARTED the session. Before this,
    // only the landing page carried it and every later page (memberships,
    // checkout) was sent as 'direct', so the by-source funnel credited all
    // mid-funnel activity to Direct and showed 0 for YouTube/Google/social.
    var src = sessionStorage.getItem('fsdx_src') || 'direct';
    if (firstOfSession) {
      sessionStorage.setItem('fsdx_v', '1');
      var params = new URLSearchParams(location.search);
      src = (params.get('utm_source') || '').toLowerCase().trim().slice(0, 40);
      if (!src) {
        var ref = document.referrer || '';
        if (/youtube\.com|youtu\.be/.test(ref)) src = 'youtube';
        else if (/google\./.test(ref)) src = 'google';
        else if (/bing\.|duckduckgo|yahoo/.test(ref)) src = 'search';
        else if (/instagram|facebook|fb\.|tiktok|twitter|t\.co|x\.com/.test(ref)) src = 'social';
        else if (ref && ref.indexOf(location.host) === -1) src = 'referral';
        else src = 'direct';
      }
      sessionStorage.setItem('fsdx_src', src || 'direct');
    }

    fetch('https://nexus-validator.dfuentes4211.workers.dev/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: src, path: rawPath, visit: firstOfSession }),
      keepalive: true
    }).catch(function(){});
  } catch (e) { /* analytics never breaks the page */ }
})();

// ── Dark scrollbar styling ──
// Injected here so every page picks it up without editing each file.
(function() {
  if (document.getElementById('fsdx-scrollbar-style')) return;
  var css = document.createElement('style');
  css.id = 'fsdx-scrollbar-style';
  css.textContent = [
    /* Firefox */
    'html, #sidebar-panel, .fsdx-scroll {',
    '  scrollbar-width: thin;',
    '  scrollbar-color: rgba(255,255,255,0.14) transparent;',
    '}',
    /* WebKit / Chromium */
    '::-webkit-scrollbar { width: 8px; height: 8px; }',
    '::-webkit-scrollbar-track { background: transparent; }',
    '::-webkit-scrollbar-thumb {',
    '  background: rgba(255,255,255,0.12);',
    '  border-radius: 8px;',
    '}',
    '::-webkit-scrollbar-thumb:hover { background: rgba(74,222,128,0.35); }',
    '::-webkit-scrollbar-corner { background: transparent; }',
    /* Sidebar: hide until hovered so it stays clean */
    '#sidebar-panel::-webkit-scrollbar-thumb { background: transparent; transition: background .2s; }',
    '#sidebar-panel:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); }',
    '#sidebar-panel:hover::-webkit-scrollbar-thumb:hover { background: rgba(74,222,128,0.35); }',

    /* ── Collapsed sidebar (desktop only) ──
       Pages set their own md:pl-64 on <main>, so the override needs
       !important to win against the utility class. */
    '@media (min-width: 768px) {',
    '  #sidebar-panel, main { transition: width .18s ease, padding-left .18s ease; }',
    '  html.nav-collapsed #sidebar-panel { width: 4.5rem !important; padding-left: .625rem !important; padding-right: .625rem !important; }',
    '  html.nav-collapsed main { padding-left: 4.5rem !important; }',
    '  html.nav-collapsed #nav-content .nav-label,',
    '  html.nav-collapsed #nav-content .nav-sec,',
    '  html.nav-collapsed #nav-content .nav-sub,',
    '  html.nav-collapsed #nav-wordmark { display: none !important; }',
    '  html.nav-collapsed #nav-mark { display: block !important; }',
    '  html.nav-collapsed #nav-content .flex.flex-col.gap-2\\.5 { padding-left: 0 !important; }',
    '  html.nav-collapsed #nav-content a, html.nav-collapsed #nav-content button {',
    '    justify-content: center; gap: 0 !important; padding-left: .25rem; padding-right: .25rem;',
    '  }',
    '  html.nav-collapsed #nav-content svg { width: 1.15rem !important; height: 1.15rem !important; }',
    '  html.nav-collapsed #nav-avatar { margin: 0 auto; }',
    /* Collapsed: the expand button is the only way back, so make it a full-width
       target in the footer rather than a faint outline next to the logo. */
    '  html.nav-collapsed #nav-collapse-btn {',
    '    justify-content: center; padding-left: 0 !important; padding-right: 0 !important;',
    '    height: 2.25rem; background: rgba(74,222,128,.08); border-color: rgba(74,222,128,.25); color: #4ade80;',
    '  }',
    '  html.nav-collapsed #nav-collapse-btn:hover { background: rgba(74,222,128,.16); border-color: rgba(74,222,128,.45); }',
    '  html.nav-collapsed #nav-collapse-icon { transform: rotate(180deg); }',
    '  html.nav-collapsed #nav-user-btn > svg { display: none; }',
    /* Section headings are hidden, so mark the groups with a rule instead. */
    '  html.nav-collapsed #nav-content nav > div + div { border-top: 1px solid rgba(255,255,255,.07); padding-top: .55rem; }',
    '}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);
})();

// ── Collapsed-sidebar state ──
// Applied before the nav renders so a collapsed sidebar never flashes open.
(function () {
  try {
    if (localStorage.getItem('fsdx_nav_collapsed') === '1') {
      document.documentElement.classList.add('nav-collapsed');
    }
  } catch (e) {}
})();

// ── Command palette (⌘K) ──
// Loaded from here so no page has to add a script tag of its own.
(function () {
  if (document.getElementById('fsdx-search-js')) return;
  var sc = document.createElement('script');
  sc.id = 'fsdx-search-js';
  sc.src = 'fsdx-search.js?v=20261004a';
  sc.defer = true;
  (document.head || document.documentElement).appendChild(sc);
})();

// ── Pending-account helper (locked-tool panel) ──
/* fsdx-account.js is deferred, so it executes AFTER the page's own inline
   script has started. Every tool page calls fsdxIsPending() right after its
   profile fetch resolves — and a fast (or mocked, or cached) profile response
   can beat the deferred script. When that happened the gate silently did
   nothing and the page unlocked. So the DECISION lives here, in a blocking
   script that is always defined first; only the PANEL comes from the deferred
   file, and a lock raised before it lands is replayed when it does. */
window.fsdxIsPending = window.fsdxIsPending || function (whopKey) {
  return !whopKey;
};
window.fsdxRequireKey = window.fsdxRequireKey || function (o) {
  /* Real renderer not here yet — remember the request and let it replay. */
  window.__fsdxLockPending = o || {};
};

(function () {
  if (document.getElementById('fsdx-account-js')) return;
  var sc = document.createElement('script');
  sc.id = 'fsdx-account-js';
  sc.src = 'fsdx-account.js?v=20260913b';
  sc.defer = true;
  (document.head || document.documentElement).appendChild(sc);
})();

// ── Collapsible nav groups (Option B) ──
// "The Site" is shut for members and open for visitors; the choice is remembered.
function toggleNavGroup(id) {
  var g = document.getElementById(id);
  if (!g) return;
  var open = g.classList.toggle('open');
  var b = g.querySelector('.nav-ghead');
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  try { localStorage.setItem('fsdx_navgrp_' + id, open ? '1' : '0'); } catch (e) {}
}

function fsdxReleasesBadge() {
  var pill = document.getElementById('nav-rel-new');
  if (!pill) return;
  var show = function (newest) {
    if (!newest) return;
    var d = newest.length === 7 ? newest + '-01' : newest;
    var age = (Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000;
    if (age >= 0 && age <= 14) pill.style.display = '';
  };
  var cached = null;
  try { cached = sessionStorage.getItem('fsdx_rel_newest'); } catch (e) {}
  if (cached !== null) { show(cached); return; }
  fetch('releases.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    var newest = '';
    ((j && j.releases) || []).forEach(function (x) { if (x.status === 'shipped' && x.date > newest) newest = x.date; });
    try { sessionStorage.setItem('fsdx_rel_newest', newest); } catch (e) {}
    show(newest);
  }).catch(function () {});
}

function applyNavGroupState(id, defaultOpen) {
  var g = document.getElementById(id);
  if (!g) return;
  var saved = null;
  try { saved = localStorage.getItem('fsdx_navgrp_' + id); } catch (e) {}
  var open = saved === null ? defaultOpen : saved === '1';
  g.classList.toggle('open', open);
  var b = g.querySelector('.nav-ghead');
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ── Account warning pop-ups ──
// Same corner toast as Scout Alerts (alerts.js), fired when an account gets a
// NEW warning. Settings live on the Accounts page → Alerts tab and, like Scout,
// are saved on this device. Each warning pops once: once it has popped (or
// been seen on the Fleet tab) it stays quiet until it changes. Built so a live
// feed (Tradovate API, later Nexus) can call the same entry point.
window.FSDXFleetPop = (function () {
  var PREF = 'fsdx_fleet_pop', SEEN = 'fsdx_fleet_pop_seen';
  var DEF = { on: true, sound: true, sticky: true, levels: { urgent: true, payout: true, heads: false } };
  var LABEL = { over: 'Past limit', urgent: 'Urgent', payout: 'Ready', heads: 'Heads-up' };
  var TYPE  = { over: 'sl', urgent: 'sl', payout: 'tp', heads: 'level' };
  function prefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF) || 'null') || {};
      var out = JSON.parse(JSON.stringify(DEF));
      ['on','sound','sticky'].forEach(function (k) { if (typeof p[k] === 'boolean') out[k] = p[k]; });
      if (p.levels) ['urgent','payout','heads'].forEach(function (k) { if (typeof p.levels[k] === 'boolean') out.levels[k] = p.levels[k]; });
      return out;
    } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  }
  function setPrefs(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) {} }
  function seen() { try { var v = JSON.parse(localStorage.getItem(SEEN) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function addSeen(keys) {
    var s = seen();
    keys.forEach(function (k) { if (s.indexOf(k) === -1) s.push(k); });
    try { localStorage.setItem(SEEN, JSON.stringify(s.slice(-400))); } catch (e) {}
  }
  function wanted(p, level) { return level === 'over' || level === 'urgent' ? p.levels.urgent : !!p.levels[level]; }
  // items: [{ key, level, acct, title, note }]
  function maybePop(items, opts) {
    opts = opts || {};
    if (!Array.isArray(items) || !items.length) return;
    var p = prefs();
    var s = seen();
    var fresh = items.filter(function (it) { return it && it.key && s.indexOf(it.key) === -1 && wanted(p, it.level); });
    if (!fresh.length) return;
    // On the Fleet tab the list is already in front of you — count it as seen.
    if (opts.markOnly || !p.on || !window.FSDXAlerts) { addSeen(fresh.map(function (i) { return i.key; })); return; }
    addSeen(fresh.map(function (i) { return i.key; }));
    var rank = { over: 0, urgent: 1, payout: 2, heads: 3 };
    fresh.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    var sticky = p.sticky && fresh.some(function (i) { return i.level === 'over' || i.level === 'urgent'; });
    if (fresh.length > 2) {
      var top = fresh[0];
      window.FSDXAlerts.show({
        force: true, type: TYPE[top.level], sound: p.sound, ttl: sticky ? 0 : 15000, href: 'accounts.html#fleet',
        title: fresh.length + ' new account warnings',
        sub: 'Click to review in Fleet',
        lines: fresh.slice(0, 4).map(function (i) { return [i.acct, LABEL[i.level] + ' · ' + i.title]; })
      });
    } else {
      fresh.forEach(function (i, n) {
        window.FSDXAlerts.show({
          force: true, type: TYPE[i.level], sound: n === 0 ? p.sound : false,
          ttl: sticky && (i.level === 'over' || i.level === 'urgent') ? 0 : 15000, href: 'accounts.html#fleet',
          title: LABEL[i.level] + ' · ' + i.acct, sub: i.title,
          lines: i.note ? [['Your note', i.note]] : []
        });
      });
    }
  }
  function test() {
    if (!window.FSDXAlerts) return;
    var p = prefs();
    window.FSDXAlerts.show({ force: true, type: 'sl', sound: p.sound, ttl: p.sticky ? 0 : 15000, href: 'accounts.html#fleet',
      title: 'Urgent · TFY 50K 001', sub: '$200 left before the drawdown floor', lines: [['Your note', 'Stop for the day, lower size.']] });
  }
  function resetSeen() { try { localStorage.removeItem(SEEN); } catch (e) {} }
  return { prefs: prefs, setPrefs: setPrefs, maybePop: maybePop, test: test, resetSeen: resetSeen, seen: seen };
})();

// ── Fleet badge on the Accounts link ──
// A red count of URGENT account warnings (past a limit, or at the member's own
// urgent line). Heads-up and payout-ready never count, and anything the member
// snoozed / handled / ignored on the Fleet tab is already left out.
//
// Only accounts.html and dashboard.html have the data to work this out, so
// they call fsdxSetFleetBadge() after they render and the number is saved in
// localStorage. Every other page just shows the saved number — no extra
// fetches on pages that don't use it. The saved value is tied to the current
// login token, so a different login on the same browser never sees it.
(function () {
  var KEY = 'fsdx_fleet_badge';
  function tokenTag() {
    try { var t = localStorage.getItem('fsdx_token') || ''; return t ? t.slice(-12) : ''; } catch (e) { return ''; }
  }
  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!v || v.t !== tokenTag()) return null;
      return v;
    } catch (e) { return null; }
  }
  function css() {
    if (document.getElementById('fx-fleet-badge-css')) return;
    var st = document.createElement('style');
    st.id = 'fx-fleet-badge-css';
    st.textContent =
      '#nav-content a.fx-has-badge{position:relative}' +
      '.fx-fleet-badge{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#ef4444;color:#fff;' +
        'font-size:10px;font-weight:900;line-height:18px;text-align:center;box-sizing:border-box;flex-shrink:0}' +
      '@media (min-width:768px){html.nav-collapsed .fx-fleet-badge{position:absolute;top:3px;right:3px;min-width:0;width:9px;height:9px;padding:0;' +
        'font-size:0;box-shadow:0 0 0 2px #070c14}}' +
      '.fx-fleet-tip{position:fixed;z-index:9999;width:220px;padding:10px 12px;border-radius:10px;background:#0f1724;' +
        'border:1px solid rgba(239,68,68,.45);box-shadow:0 10px 30px rgba(0,0,0,.55);pointer-events:none;font-family:inherit}' +
      '.fx-fleet-tip b{display:block;font-size:12px;color:#fca5a5}' +
      '.fx-fleet-tip span{display:block;font-size:11px;color:#8098b7;margin-top:2px}' +
      '.fx-fleet-tip i{display:block;font-style:normal;font-size:11px;font-weight:800;color:#f26b21;margin-top:6px}';
    document.head.appendChild(st);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var tip = null;
  function hideTip() { if (tip) { tip.remove(); tip = null; } }
  function render() {
    var link = document.querySelector('#nav-content a[href="accounts.html"], #nav-content a[href="accounts.html#fleet"]');
    if (!link) return;
    var old = link.querySelector('.fx-fleet-badge');
    if (old) old.remove();
    link.classList.remove('fx-has-badge');
    link.onmouseenter = link.onmouseleave = null;
    hideTip();
    var v = read();
    if (!v || !(v.n > 0)) {
      link.setAttribute('href', 'accounts.html');
      if (link.dataset.fxTitle) link.title = link.dataset.fxTitle;
      return;
    }
    css();
    var b = document.createElement('span');
    b.className = 'fx-fleet-badge';
    b.textContent = v.n > 99 ? '99+' : String(v.n);
    b.setAttribute('aria-label', v.n + ' urgent account warning' + (v.n === 1 ? '' : 's'));
    link.appendChild(b);
    link.classList.add('fx-has-badge');
    link.setAttribute('href', 'accounts.html#fleet');
    if (!link.dataset.fxTitle) link.dataset.fxTitle = link.title || 'Accounts';
    link.removeAttribute('title');           // the custom tip replaces the browser one
    var names = (v.accts || []).slice(0, 4);
    var more = (v.accts || []).length - names.length;
    link.onmouseenter = function () {
      hideTip();
      tip = document.createElement('div');
      tip.className = 'fx-fleet-tip';
      tip.innerHTML = '<b>' + v.n + ' urgent warning' + (v.n === 1 ? '' : 's') + '</b>' +
        (names.length ? '<span>' + esc(names.join(' · ')) + (more > 0 ? ' +' + more + ' more' : '') + '</span>' : '') +
        '<i>Open Fleet →</i>';
      document.body.appendChild(tip);
      var r = link.getBoundingClientRect();
      var top = r.top + r.height / 2 - tip.offsetHeight / 2;
      tip.style.left = Math.min(window.innerWidth - 232, r.right + 12) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    };
    link.onmouseleave = hideTip;
  }
  // Called by accounts.html / dashboard.html with the urgent count and the
  // names of the accounts behind it.
  window.fsdxSetFleetBadge = function (n, accts, items, popOpts) {
    try {
      if (!tokenTag()) return;
      localStorage.setItem(KEY, JSON.stringify({ n: n || 0, accts: accts || [], items: (items || []).slice(0, 40), t: tokenTag(), at: Date.now() }));
    } catch (e) {}
    render();
    if (items) try { window.FSDXFleetPop.maybePop(items, popOpts); } catch (e) {}
  };
  // Other pages: pop anything new from the last saved list (e.g. a warning
  // worked out on the dashboard, then you moved to the Journal).
  window.fsdxPopFromCache = function () {
    var v = read();
    if (v && v.items && !/accounts\.html$/.test(location.pathname)) {
      try { window.FSDXFleetPop.maybePop(v.items); } catch (e) {}
    }
  };
  window.fsdxRenderFleetBadge = render;
})();

function toggleNavCollapse() {
  var on = document.documentElement.classList.toggle('nav-collapsed');
  try { localStorage.setItem('fsdx_nav_collapsed', on ? '1' : '0'); } catch (e) {}
  var btn = document.getElementById('nav-collapse-btn');
  if (btn) btn.title = on ? 'Expand menu' : 'Collapse menu';
}

// Wrap each nav item's text in a span so the label can be hidden while the
// icon stays. Done here rather than in nav.html so every link stays readable.
function prepareNavLabels(root) {
  root.querySelectorAll('a, button').forEach(function (el) {
    if (el.id === 'nav-collapse-btn') return;
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        var span = document.createElement('span');
        span.className = 'nav-label';
        span.textContent = node.textContent;
        node.parentNode.replaceChild(span, node);
      } else if (node.nodeType === 1 && !/^(svg|img)$/i.test(node.tagName) &&
                 !node.classList.contains('nav-label') && node.id !== 'nav-avatar') {
        node.classList.add('nav-label');
      }
    });
    // Hovering an icon-only row should still say what it is. The member card
    // is skipped — its name isn't loaded yet at this point.
    if (el.id === 'nav-user-btn') return;
    var text = (el.textContent || '')
      .replace(/[\u21b3\u2197]/g, ' ')   // strip the ↳ and ↗ markers
      .trim().replace(/\s+/g, ' ');
    if (text && !el.title) el.title = text;
  });
}

(function() {
  // ── The intermittent blank sidebar ──
  // Every page loads this file from <head> with NO defer, but #nav-content is
  // in the <body>. On a cold cache the fetch below is slow enough that the
  // parser reaches the mount first and everything works. On a warm cache the
  // response can arrive before the parser gets there — `mount` is null, the
  // old code hit `if (!mount) return;` and gave up silently. No error, no nav,
  // and a refresh reshuffles the timing enough to "fix" it. That is the bug.
  //
  // So: never mount before the DOM is ready, and tell a missing mount
  // (admin.html, which has its own sidebar) apart from one that simply hasn't
  // been parsed yet.
  function domReady() {
    return new Promise(function (resolve) {
      if (document.readyState !== 'loading') return resolve();
      document.addEventListener('DOMContentLoaded', function () { resolve(); }, { once: true });
    });
  }

  var SKELETON = `<div class="animate-pulse space-y-3 pt-2 flex-1">
      <div class="h-2 bg-white/5 rounded w-16 mb-5"></div>
      <div class="h-2.5 bg-white/5 rounded w-3/4"></div>
      <div class="h-2.5 bg-white/5 rounded w-2/3"></div>
      <div class="h-2.5 bg-white/5 rounded w-3/4"></div>
      <div class="h-2.5 bg-white/5 rounded w-1/2"></div>
      <div class="h-2 bg-white/5 rounded w-16 mt-5 mb-3"></div>
      <div class="h-2.5 bg-white/5 rounded w-2/3"></div>
      <div class="h-2.5 bg-white/5 rounded w-3/4"></div>
      <div class="h-2.5 bg-white/5 rounded w-1/2"></div>
    </div>`;

  // Show skeleton to prevent flash — as soon as there is something to show it in.
  var navContent = document.getElementById('nav-content');
  if (navContent) navContent.innerHTML = SKELETON;
  else domReady().then(function () {
    var el = document.getElementById('nav-content');
    if (el && !el.innerHTML.trim()) el.innerHTML = SKELETON;
  });

  // fetch() resolves on 404 and 500 — it only rejects on network failure. An
  // error page or a truncated response would sail straight through .then and
  // blank the nav just as thoroughly, so check the status and the body, and
  // give a flaky network one retry before giving up.
  function loadNavHtml(attempt) {
    return fetch('nav.html?v=20261007a')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        if (!html || html.trim().length < 50) throw new Error('nav.html came back empty');
        return html;
      })
      .catch(function (err) {
        if (attempt >= 2) throw err;
        console.warn('[nav] load attempt ' + (attempt + 1) + ' failed, retrying:', err.message);
        return new Promise(function (res) { setTimeout(res, 200 * (attempt + 1)); })
          .then(function () { return loadNavHtml(attempt + 1); });
      });
  }

  Promise.all([loadNavHtml(0), domReady()])
    .then(function (r) { return r[0]; })
    .then(html => {
      var mount = document.getElementById('nav-content');
      if (!mount) return;   // admin.html has its own sidebar — nothing to mount
      mount.innerHTML = html;
      prepareNavLabels(document.getElementById('nav-content'));
      var cbtn = document.getElementById('nav-collapse-btn');
      if (cbtn) cbtn.title = document.documentElement.classList.contains('nav-collapsed')
        ? 'Expand menu' : 'Collapse menu';

      // Highlight active page
      const fullPath = window.location.pathname === '/' ? '/index.html' : window.location.pathname;
      document.querySelectorAll('#nav-content .nav-link').forEach(link => {
        const href = link.getAttribute('href') || '';
        const hrefBase = '/' + href.replace('.html', '');
        if (fullPath === hrefBase || fullPath === '/' + href || 
            fullPath.endsWith('/' + href) || fullPath.endsWith(href.replace('.html',''))) {
          link.classList.remove('text-zinc-400');
          link.classList.add('text-green-400', 'font-bold');
        }
      });

      // "New" pill on Releases: shows when something shipped in the last 14 days.
      // Reads releases.json once per session; any failure just leaves it hidden.
      try { fsdxReleasesBadge(); } catch (e) {}

      // Red count of urgent account warnings on the Accounts link
      try { window.fsdxRenderFleetBadge && window.fsdxRenderFleetBadge(); } catch (e) {}
      // alerts.js loads after this file on most pages — give it a beat.
      setTimeout(function () { try { window.fsdxPopFromCache && window.fsdxPopFromCache(); } catch (e) {} }, 1200);

      // "The Site" starts shut for members, open for visitors
      const loggedIn = !!localStorage.getItem('fsdx_token');
      applyNavGroupState('nav-group-site', !loggedIn);

      /* Products (Free → Nightwing → Membership) starts OPEN for visitors —
         it is the ladder, and a visitor who cannot see it assumes $129 is the
         only way in.

         It starts open for MEMBERS TOO. It briefly did not, on the theory that
         someone who already bought does not need the price list — and the first
         person to look for it on a phone could not find it. That is the whole
         argument settled: a collapsed group is an invisible group.

         It also earns its place for a member. A Nightwing member's upgrade to
         the full membership lives here, so hiding it hides the upsell, and a
         member passing the free indicator to someone else should not have to
         expand anything to find the link. Three rows is a cheap price for that.

         A member who genuinely wants it shut can collapse it — that choice is
         saved and wins on every later visit. */
      applyNavGroupState('nav-group-products', true);

      // never hide the page you're on inside a shut group
      var activeInGroup = document.querySelector('#nav-content .nav-group .nav-link.fx-active, #nav-content .nav-group .nav-link.font-bold');
      if (activeInGroup) {
        var grp = activeInGroup.closest('.nav-group');
        if (grp && !grp.classList.contains('open')) grp.classList.add('open');
      }

      // Pending accounts (no Whop key yet) get an extra nav item pointing at setup.
      // Deliberately ADDITIVE — nothing is hidden, so this can never lock anyone out
      // of something that works today. Admin accounts are exempt.
      (function () {
        try {
          if (!localStorage.getItem('fsdx_token')) return;
          fetch('https://nexus-validator.dfuentes4211.workers.dev/api/auth/profile', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('fsdx_token') }
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.user || d.user.whopKey) return;   // fail open
              var host = document.querySelector('#nav-content .vip-only .flex.flex-col.gap-2\\.5');
              if (!host || document.getElementById('nav-finish-setup')) return;
              var a = document.createElement('a');
              a.id = 'nav-finish-setup';
              a.href = 'setup.html';
              a.className = 'nav-link text-green-400 hover:text-green-300 font-bold transition text-sm flex items-center gap-2';
              a.innerHTML = '<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">'
                + '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>'
                + '<span class="nav-label">Finish setup</span>';
              host.insertBefore(a, host.firstChild);
            })
            .catch(function () { /* fail open */ });
        } catch (e) {}
      })();

      // Show VIP section if logged in
      const token = localStorage.getItem('fsdx_token');
      if (token) {
        // Show all vip-only elements
        document.querySelectorAll('#nav-content .vip-only').forEach(el => {
          el.classList.remove('hidden');
          // Buttons in the footer are laid out as flex rows; `hidden` removed
          // their display, so restore it rather than leaving them inline.
          if (el.tagName === 'BUTTON') el.classList.add('flex');
        });
        // Hide member login button
        const loginBtn = document.getElementById('nav-login-btn');
        if (loginBtn) loginBtn.classList.add('hidden');
        // Populate user info
        const name = localStorage.getItem('fsdx_name') || 'Member';
        const tier = localStorage.getItem('fsdx_tier') || 'pro';
        const avatar = document.getElementById('nav-avatar');
        const username = document.getElementById('nav-username');
        const tierEl = document.getElementById('nav-tier');
        if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
        if (username) username.textContent = name;
        var userBtn = document.getElementById('nav-user-btn');
        if (userBtn) userBtn.title = name + ' — profile';
        const whopStatus = localStorage.getItem('fsdx_whop_status') || '';
        const plan = localStorage.getItem('fsdx_plan') || '';
        // Base name: "VIP Plus" / "VIP Pro" / "Nightwing" when known, else "VIP"
        const planName = plan === 'pro'   ? 'VIP Pro'
                       : plan === 'plus'  ? 'VIP Plus'
                       : plan === 'site'  ? 'Nightwing'
                       : plan === 'raven' ? 'Raven'
                       : plan === 'copier' ? 'Copy Trader'
                       : 'VIP';
        let tierText;
        if (tier === 'trial') tierText = planName + ' · Trial';
        else if (whopStatus === 'completed') tierText = planName + ' · Lifetime';
        else if (tier === 'pending' || whopStatus === 'pending') tierText = 'Setup incomplete';
        else tierText = plan ? planName : 'VIP Member';
        if (tierEl) tierEl.textContent = tierText;

        /* Neither tools tier includes Scout Alerts. Hide the link so the
           member is never sent to a page that turns them away. This is
           cosmetic only — the real gate is the 403 on /api/scout/feed. The
           test is deliberately an explicit list: an unknown plan keeps the
           link, so a mapping gap can never hide a VIP member's own tools.
           Refer & Earn is NOT hidden — a Nightwing or Raven subscriber can
           still promote the $129 membership; only the tier itself pays
           nothing. */
        if (plan === 'site' || plan === 'raven' || plan === 'copier') {
          document.querySelectorAll('#nav-content a[href="alerts.html"]')
            .forEach(el => el.classList.add('hidden'));
        }

        /* Copy Trader — standalone add-on. The link only appears when the
           server says this session has copier access (admin, COPIER_GRANTS,
           or a Whop copier membership). No access → the API 404s and nothing
           is added, so the copier stays invisible to everyone else. The
           answer is cached for the tab session (10 min) so this is one call,
           not one per page. */
        (function () {
          function addLink() {
            var anchor = document.querySelector('#nav-content a[href="accounts.html"]');
            if (!anchor || document.getElementById('nav-copier')) return;
            var a = document.createElement('a');
            a.id = 'nav-copier';
            a.href = 'copier.html';
            var here = /\/copier\.html$/.test(location.pathname);
            a.className = 'nav-link ' + (here ? 'text-green-400' : 'text-zinc-400') + ' hover:text-green-400 font-medium transition text-sm flex items-center gap-2';
            a.innerHTML = '<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">'
              + '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25"/></svg>'
              + '<span class="nav-label">Copy Trader</span>';
            anchor.parentNode.insertBefore(a, anchor.nextSibling);
          }
          try {
            var c = JSON.parse(sessionStorage.getItem('fsdx_copier') || 'null');
            if (c && c.t === token.slice(0, 8) && Date.now() - c.at < 600000) { if (c.ok) addLink(); return; }
          } catch (e) {}
          fetch('https://nexus-validator.dfuentes4211.workers.dev/api/copier/access', {
            headers: { 'Authorization': 'Bearer ' + token }
          }).then(function (r) {
            var ok = r.status === 200;
            try { sessionStorage.setItem('fsdx_copier', JSON.stringify({ ok: ok, at: Date.now(), t: token.slice(0, 8) })); } catch (e) {}
            if (ok) addLink();
          }).catch(function () { /* no link on error */ });
        })();
      }
    })
    .catch(function (err) {
      console.error('[nav] Failed to load nav.html:', err);
      // Both retries lost. A blank sidebar strands a member with no way out of
      // whatever page they are on, so render plain links rather than nothing.
      // VIP links are shown only when a session exists — same rule as the real
      // nav — so this never advertises member tools to a logged-out visitor.
      domReady().then(function () {
        var mount = document.getElementById('nav-content');
        if (!mount) return;
        var vip = [];
        try { if (localStorage.getItem('fsdx_token')) vip = [
          ['dashboard.html', 'Dashboard'], ['journal.html', 'Journal'],
          ['accounts.html', 'Accounts'], ['playbook.html', 'Playbook'],
          ['backtest.html', 'Backtest'], ['alerts.html', 'Scout Alerts'],
          ['converter.html', 'Trade Importer'], ['refer.html', 'Refer & Earn'],
          ['profile.html', 'Profile']
        ]; } catch (e) {}
        // Same tools-tier rule as the real nav above.
        try {
          var fbPlan = localStorage.getItem('fsdx_plan');
          if (fbPlan === 'site' || fbPlan === 'raven' || fbPlan === 'copier') {
            vip = vip.filter(function (l) { return l[0] !== 'alerts.html'; });
          }
        } catch (e) {}
        /* Labels here must match nav.html. They drifted once already: nav.html
           was renamed and this list was not, so a member who hit the fallback
           saw "The System" and "Results" while everyone else saw "What's in the
           Membership" and "Backtest Results". Compare Plans is included because
           the fallback fires exactly when someone is already having a bad time,
           and that page answers the question they are most likely stuck on. */
        var site = [
          ['index.html', 'Home'], ['compare.html', 'Compare Plans'],
          ['suite.html', "What's in the Membership"],
          ['platform.html', 'The Platform'],
          ['autotrader.html', 'ORB Auto-Trader'], ['ninjatrader.html', 'NinjaTrader 8'],
          ['releases.html', 'Releases'],
          ['results.html', 'Backtest Results'],
          ['nightwing.html', 'Nightwing'], ['raven.html', 'Raven'],
          ['memberships.html', 'Membership'], ['knowledge.html', 'Knowledge Base'],
          ['partners.html', 'Partner Program'], ['contact.html', 'Contact & Help']
        ];
        var link = function (l) {
          return '<a href="' + l[0] + '" class="block py-1.5 text-xs text-zinc-400 hover:text-white transition">' + l[1] + '</a>';
        };
        var head = function (t) {
          return '<div class="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-bold mt-4 mb-1.5">' + t + '</div>';
        };
        mount.innerHTML =
          '<div class="flex flex-col h-full">'
          + '<div class="text-xl font-black tracking-tight text-orange-500 mb-1">FSD-X</div>'
          + '<div class="text-[9px] uppercase tracking-[0.3em] text-zinc-600 mb-3">Trading</div>'
          + (vip.length ? head('Workspace') + vip.map(link).join('') : '')
          + head('The Site') + site.map(link).join('')
          + '<div class="mt-auto pt-4 border-t border-white/10">'
          + '<div class="text-[10px] text-zinc-500 mb-2">Menu didn\'t load.</div>'
          + '<button onclick="location.reload()" class="w-full text-[11px] border border-white/10 rounded px-2 py-1.5 text-zinc-300 hover:bg-white/5 transition">Retry</button>'
          + '</div></div>';
      });
    });
})();

function navLogout() {
  const token = localStorage.getItem('fsdx_token');
  if (token) {
    fetch('https://nexus-validator.dfuentes4211.workers.dev/api/auth/logout', {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  }
  localStorage.removeItem('fsdx_token');
  localStorage.removeItem('fsdx_name');
  localStorage.removeItem('fsdx_tier');
  localStorage.removeItem('fsdx_plan');
  // These two used to survive logout. fsdx_admin in particular leaked an admin
  // session into whatever account signed in next on the same browser.
  localStorage.removeItem('fsdx_whop_status');
  localStorage.removeItem('fsdx_admin');
  localStorage.removeItem('fsdx_fleet_badge');
  localStorage.removeItem('fsdx_fleet_pop_seen');
  window.location.href = 'index.html';
}
