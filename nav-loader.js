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
      'setup', 'welcome', '404', 'tradingview-update', 'releases', 'ninjatrader'
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
    // Session context. Set once on the landing page and sent with EVERY ping
    // (checkout-gate.js reads it too), so the Worker can credit memberships and
    // checkout clicks back to the source, campaign and landing page that started
    // the session. Before Oct 2026 only the source was carried.
    var ctx = null;
    try { ctx = JSON.parse(sessionStorage.getItem('fsdx_ctx') || 'null'); } catch (e) {}
    if (firstOfSession || !ctx) {
      sessionStorage.setItem('fsdx_v', '1');
      var params = new URLSearchParams(location.search);
      var ref = document.referrer || '';
      var refHost = '';
      try { refHost = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch (e) {}
      if (refHost === location.hostname.replace(/^www\./, '')) refHost = '';
      var ALIAS = { fb: 'facebook', meta: 'facebook', ig: 'instagram', yt: 'youtube', twitter: 'x', tt: 'tiktok', dc: 'discord' };
      var src = (params.get('utm_source') || '').toLowerCase().trim().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
      src = ALIAS[src] || src;
      if (!src) {
        var r = refHost;
        if (/youtube\.com|youtu\.be/.test(r)) src = 'youtube';
        else if (/(^|\.)google\./.test(r)) src = 'google';
        else if (/bing\.|duckduckgo|yahoo|brave\.com|ecosia/.test(r)) src = 'search';
        else if (/instagram/.test(r)) src = 'instagram';
        else if (/facebook|(^|\.)fb\.(com|me)/.test(r)) src = 'facebook';
        else if (/^t\.co$|twitter|(^|\.)x\.com/.test(r)) src = 'x';
        else if (/tiktok/.test(r)) src = 'tiktok';
        else if (/reddit/.test(r)) src = 'reddit';
        else if (/discord/.test(r)) src = 'discord';
        else if (/whop\.com/.test(r)) src = 'whop';
        else if (/tradingview/.test(r)) src = 'tradingview';
        else if (/chatgpt|openai|perplexity|claude\.ai|gemini/.test(r)) src = 'ai';
        else if (params.get('fbclid')) src = 'facebook';
        else if (params.get('gclid') || params.get('gbraid') || params.get('wbraid')) src = 'google';
        else if (r) src = 'referral';
        else src = 'direct';
      }
      // Paid traffic gets its own channel: "facebook-ads", "google-ads" …
      // Tag Meta ads with utm_medium=paid (or cpc). Google click IDs are always paid.
      var med = (params.get('utm_medium') || '').toLowerCase();
      var paid = /^(cpc|ppc|paid|paid_?social|paidsocial|ads?|cpm|display|cpv)$/.test(med)
        || !!(params.get('gclid') || params.get('gbraid') || params.get('wbraid'));
      if (paid && !/-ads$/.test(src)) src = src + '-ads';
      var seen = false;
      try { seen = !!localStorage.getItem('fsdx_seen'); localStorage.setItem('fsdx_seen', '1'); } catch (e) {}
      ctx = {
        src: src || 'direct',
        camp: (params.get('utm_campaign') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60),
        land: pgKey,
        ref: refHost.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60),
        ret: seen,
        sid: Math.random().toString(36).slice(2, 10)
      };
      sessionStorage.setItem('fsdx_ctx', JSON.stringify(ctx));
      sessionStorage.setItem('fsdx_src', ctx.src);   // older readers
    }
    // A second page in the same session = engaged (not a bounce). Sent once.
    var eng = false;
    if (!firstOfSession && !sessionStorage.getItem('fsdx_eng')) { sessionStorage.setItem('fsdx_eng', '1'); eng = true; }

    fetch('https://nexus-validator.dfuentes4211.workers.dev/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 2, source: ctx.src, path: rawPath, visit: firstOfSession, eng: eng,
        sid: ctx.sid, camp: ctx.camp, land: ctx.land, ref: ctx.ref, ret: ctx.ret }),
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

// ── Site top bar (Oct 2026) ──────────────────────────────────────────────
// The sidebar is now the member WORKSPACE only. Every site page (products,
// platform, results, learn, prop firms) lives in this top bar instead, so the
// sidebar stops growing every time a page is added.
//
//   Visitors  → no sidebar at all on desktop; the logo, Member Login and the
//               trial button sit in this bar. Full-width sales pages.
//   Members   → sidebar (workspace) + this bar.
//   Phones    → the bar is hidden; the same menu is appended to the slide-out
//               sidebar as #fxn-mob (built from FSDX_MENU below).
//
// ONE list drives the desktop dropdowns AND the phone menu. Add a page here.
// [href, title, one-line description, price or tag]
var FSDX_MENU = [
  { id: 'products', label: 'Products', w: 860, eyebrow: 'Or pick one tool', foot: ['compare.html', 'Compare all plans side by side →'],
    feature: { kind: 'plan', kicker: 'Most complete', title: 'Full Membership', href: 'memberships.html', price: '$129', per: '/mo',
      checks: ['Knightfall + 3 indicators', 'Auto Trader', 'Journal, accounts & backtests', 'Live room every weekday'],
      cta: 'Start 30-Day Free Trial', ctaMember: 'See the membership →' },
    items: [
      ['memberships.html', 'Full Membership', 'Knightfall, 3 indicators, Auto Trader, journal and the live room', '$129/mo', 'layers', 'orange'],
      ['ninjatrader.html', 'Knightfall NT8', 'Knightfall on NinjaTrader 8, on its own', '$59.99/mo', 'terminal', 'orange'],
      ['raven.html', 'Raven', 'Standalone TradingView indicator', '$29.99/mo', 'trend', 'blue'],
      ['nightwing.html', 'Nightwing', 'Standalone TradingView indicator', '$9.99/mo', 'moon', 'purple'],
      ['free-indicators.html', 'Free Indicators', 'Free tools anyone can add to a chart', 'Free', 'star', 'green']
  ]},
  { id: 'platform', label: 'Platform', w: 680, eyebrow: 'Explore',
    feature: { kind: 'link', kicker: 'Start here', title: "What's in the Membership", href: 'suite.html',
      text: 'Every tool in the full package, and how they fit together each morning.', cta: 'See the full package →' },
    items: [
      ['suite.html', "What's in the Membership", 'Every tool in the full package', '', 'layers', 'orange'],
      ['platform.html', 'The Platform', 'Dashboard, journal, accounts and backtests', '', 'monitor', 'blue'],
      ['autotrader.html', 'ORB Auto-Trader', 'How the automation works', '', 'bolt', 'orange'],
      ['releases.html', 'Releases', "What shipped and what's next", 'rel', 'clock', 'green'],
      ['tradingview-update.html', 'TradingView Nov 1 Change', 'What it means for your indicators', '', 'info', 'gray']
  ]},
  { id: 'results', label: 'Results', w: 680, eyebrow: 'The proof',
    note: 'Backtests are hypothetical. Past performance doesn’t guarantee future results.',
    feature: { kind: 'chart', kicker: 'See the data', title: "Don't take our word for it",
      text: 'Explore the backtest yourself, then check it against live trades.' },
    items: [
      ['results.html', 'Backtest Results', 'Explore the data by preset and setting', '', 'bars', 'blue'],
      ['track-record.html', 'Live Track Record', 'Live trades by variant, with stats', 'live', 'target', 'green']
  ]},
  { id: 'learn', label: 'Learn', w: 820, cols: 2,
    feature: { kind: 'link', kicker: 'New here?', title: 'Getting Started', href: 'setup.html',
      text: 'Set up your charts and tools in a few steps.', cta: 'Start the setup →' },
    items: [
      ['setup.html', 'Getting Started', 'Set up in a few steps', '', 'rocket', 'orange'],
      ['schedule.html', 'Live Sessions', 'Trade room schedule', '', 'radio', 'red'],
      ['knowledge.html', 'Knowledge Base', 'Guides and explainers', '', 'book', 'blue'],
      ['faq.html', 'FAQ', 'Common questions', '', 'help', 'purple'],
      ['contact.html', 'Contact & Help', 'Get in touch', '', 'mail', 'gray'],
      ['disclosures.html', 'Disclosures & Terms', 'Risk disclosure and terms of service', '', 'shield', 'gray']
  ]},
  { id: 'prop', label: 'Prop Firms', w: 680, eyebrow: 'Prop firms', tone: 'green',
    feature: { kind: 'code', kicker: 'One code, most firms', code: 'DJFSDX',
      text: 'Use it at checkout with most of our partner firms.', disclose: 'Affiliate code. We earn a commission.' },
    items: [
      ['affiliates.html', 'Prop Firm Discounts', 'Every partner code, compared', '', 'tag', 'orange'],
      ['giveaways.html', 'Giveaways', 'Current giveaways and how to enter', '', 'gift', 'purple'],
      ['partners.html', 'Partner Program', 'For creators with a trading audience', '', 'users', 'blue']
  ]}
];
// stroke icons for the menu tiles (24×24 viewBox)
var FSDX_ICONS = {
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  trend: '<path d="M3 17l5-6 4 4 8-9"/><path d="M14 6h6v6"/>',
  moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a8.5 8.5 0 1 0 11.5 11.5z"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  target: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3c1-4 4-8 12-9-1 8-5 11-9 12z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  radio: '<circle cx="12" cy="12" r="3"/><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9M12 8S10 3 7.5 4.5 9 8 12 8zm0 0s2-5 4.5-3.5S15 8 12 8z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>'
};
var FSDX_DISCORD = 'https://discord.gg/RePdHESvSx';

// Visitors get the full-width layout. Set here, in <head>, so the sidebar
// never flashes in and then disappears.
(function () {
  try { if (!localStorage.getItem('fsdx_token')) document.documentElement.classList.add('fx-guest'); } catch (e) {}
})();

(function () {
  if (document.getElementById('fxn-css')) return;
  var css = document.createElement('style');
  css.id = 'fxn-css';
  css.textContent = [
    /* visitors: no sidebar on desktop. Doubled class beats html.nav-collapsed main. */
    '@media (min-width:768px){',
    '  html.fx-guest.fx-guest #sidebar-panel{display:none !important}',
    '  html.fx-guest.fx-guest main{padding-left:0 !important}',
    '}',
    '#fx-topnav{position:sticky;top:0;z-index:45;background:rgba(8,13,21,.92);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid rgba(120,160,210,.13);font-family:Inter,ui-sans-serif,system-ui,sans-serif}',
    '@media (max-width:767px){#fx-topnav{display:none}}',
    '.fxn-in{display:flex;align-items:center;gap:4px;min-height:62px;padding:0 24px}',
    'html.fx-guest .fxn-in{padding:0 40px}',
    '.fxn-logo{display:flex;flex-direction:column;margin-right:22px;text-decoration:none;line-height:1}',
    '.fxn-logo b{font-size:25px;font-weight:900;letter-spacing:.06em;background:linear-gradient(100deg,#FFA061,#FF6B1F 55%,#FF8A2B);-webkit-background-clip:text;background-clip:text;color:transparent}',
    '.fxn-logo small{font-size:9px;font-weight:700;letter-spacing:.32em;color:#7D8B9E;margin-top:4px}',
    '.fxn-m{position:relative}',
    '.fxn-home{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:10px;color:#CBD3DE;font-size:14.5px;font-weight:700;text-decoration:none;white-space:nowrap}',
    '.fxn-home svg{width:15px;height:15px}',
    '.fxn-home:hover{color:#fff;background:rgba(255,255,255,.04)}',
    '.fxn-home.here{color:#FF9A5C}',
    '.fxn-mhome{display:flex;align-items:center;gap:9px;padding:13px 2px;border-top:1px solid rgba(255,255,255,.07);color:#E6EAF0;font-size:15px;font-weight:800;text-decoration:none}',
    '.fxn-mhome.cur{color:#FFC0A0}',
    '.fxn-mhome svg{width:15px;height:15px}',
    '.fxn-b{display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border-radius:10px;border:1px solid transparent;background:none;color:#CBD3DE;font:700 14.5px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;transition:color .15s,background .15s,border-color .15s;white-space:nowrap}',
    '.fxn-b:hover{color:#fff;background:rgba(255,255,255,.04)}',
    '.fxn-m.here .fxn-b{color:#FF9A5C}',
    '.fxn-m.open .fxn-b{color:#FFC0A0;background:rgba(255,107,31,.12);border-color:rgba(255,107,31,.5)}',
    '.fxn-b svg{width:12px;height:12px;transition:transform .15s}',
    '.fxn-m.open .fxn-b svg{transform:rotate(180deg)}',
    '.fxn-p{position:absolute;top:calc(100% + 8px);left:0;width:340px;padding:8px;box-sizing:border-box;border-radius:16px;border:1px solid rgba(120,160,210,.18);background:#0B111B;box-shadow:0 24px 60px -20px rgba(0,0,0,.9);display:none;z-index:50}',
    '.fxn-p:before{content:"";position:absolute;left:0;right:0;top:-12px;height:12px}',
    '.fxn-m.open .fxn-p{display:block}',
    '.fxn-p.wide{width:600px}',
    '.fxn-g{display:grid;gap:2px}',
    '.fxn-p.wide .fxn-g{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.fxn-i{display:flex;flex-direction:column;gap:3px;padding:11px 13px;border-radius:11px;text-decoration:none;border:1px solid transparent}',
    '.fxn-i:hover,.fxn-i:focus-visible{background:rgba(255,255,255,.045);border-color:rgba(120,160,210,.16);outline:none}',
    '.fxn-i.cur{background:rgba(255,107,31,.08);border-color:rgba(255,107,31,.3)}',
    '.fxn-t{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;color:#fff}',
    '.fxn-pr{margin-left:auto;font-size:12px;font-weight:700;color:#A2AEBF;white-space:nowrap}',
    '.fxn-d{font-size:12.5px;line-height:1.45;color:#A2AEBF}',
    '.fxn-tags{display:inline-flex;gap:5px;align-items:center}',
    '.fxn-tag{font-size:9px;font-weight:900;letter-spacing:.08em;border-radius:4px;padding:1px 5px;text-transform:uppercase}',
    '.fxn-mem{color:#A2AEBF;border:1px solid rgba(120,160,210,.3)}',
    '.fxn-rel-new{color:#4ade80;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3)}',
    '.fxn-foot{display:block;margin-top:6px;padding:11px 13px 6px;border-top:1px solid rgba(120,160,210,.13);font-size:13px;font-weight:700;color:#4ade80;text-decoration:none}',
    '.fxn-foot:hover{color:#86efac}',
    '.fxn-sp{flex:1}',
    '.fxn-search{width:40px;height:40px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid rgba(120,160,210,.16);background:none;color:#A2AEBF;cursor:pointer;margin-right:6px}',
    '.fxn-search:hover{color:#fff;border-color:rgba(255,107,31,.45)}',
    '.fxn-login{padding:9px 12px;font-size:14px;font-weight:700;color:#CBD3DE;text-decoration:none;white-space:nowrap}',
    '.fxn-login:hover{color:#fff}',
    '.fxn-dc{padding:9px 15px;border-radius:10px;border:1px solid rgba(74,222,128,.4);color:#4ade80;font-size:14px;font-weight:700;text-decoration:none;white-space:nowrap}',
    '.fxn-dc:hover{background:rgba(74,222,128,.08)}',
    '.fxn-cta{margin-left:8px;padding:10px 17px;border-radius:12px;background:linear-gradient(135deg,#FF9247 0%,#FF6B1F 52%,#EB550D 100%);color:#0A0A0A;font-size:14px;font-weight:800;text-decoration:none;white-space:nowrap;box-shadow:0 10px 26px -12px rgba(255,107,31,.6)}',
    '.fxn-cta:hover{filter:brightness(1.08)}',
    '@media (max-width:1279px){html:not(.fx-guest) .fxn-dc{display:none}}',
    '@media (max-width:1100px){.fxn-in{padding:0 14px}.fxn-b{padding:9px 9px;font-size:13.5px}.fxn-login,.fxn-dc{display:none}.fxn-logo{margin-right:10px}}',
    /* ── style A panels: featured column + icon rows ── */
    '.fxn-p.fx2{display:none;padding:0;overflow:hidden;border-radius:20px;box-shadow:0 30px 80px -24px rgba(0,0,0,.95)}',
    '.fxn-m.open .fxn-p.fx2{display:grid;grid-template-columns:260px minmax(0,1fr)}',
    '.fxn-f{display:flex;flex-direction:column;gap:12px;padding:22px;background:linear-gradient(160deg,rgba(255,107,31,.16) 0%,rgba(255,107,31,.03) 55%,transparent 100%);border-right:1px solid rgba(120,160,210,.13)}',
    '.fxn-f.green{background:linear-gradient(160deg,rgba(74,222,128,.13) 0%,rgba(74,222,128,.03) 55%,transparent 100%)}',
    '.fxn-fk{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#FF9A5C}',
    '.fxn-f.green .fxn-fk{color:#4ade80}',
    '.fxn-ft{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:21px;font-weight:900;letter-spacing:-.02em;line-height:1.2;color:#fff;text-decoration:none}',
    'a.fxn-ft:hover{color:#FFC0A0}',
    '.fxn-fx{font-size:13px;line-height:1.55;color:#A2AEBF;margin:0}',
    '.fxn-fc{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
    '.fxn-fc li{display:flex;gap:9px;align-items:center;font-size:13.5px;color:#CBD3DE}',
    '.fxn-fc svg{width:14px;height:14px;flex-shrink:0;color:#4ade80}',
    '.fxn-fp{display:flex;align-items:baseline;gap:4px;margin-top:2px}',
    '.fxn-fp b{font-size:30px;font-weight:900;color:#fff}.fxn-fp span{font-size:13px;color:#A2AEBF}',
    '.fxn-fb{margin-top:auto;display:block;padding:12px;border-radius:12px;text-align:center;font-size:13.5px;font-weight:800;text-decoration:none;border:1px solid rgba(255,107,31,.5);color:#FFC0A0;background:none;cursor:pointer;font-family:inherit}',
    '.fxn-fb:hover{background:rgba(255,107,31,.10);color:#fff}',
    '.fxn-fb.solid{border:0;color:#0A0A0A;background:linear-gradient(135deg,#FF9247 0%,#FF6B1F 52%,#EB550D 100%)}',
    '.fxn-fb.solid:hover{filter:brightness(1.08);color:#0A0A0A}',
    '.fxn-fb.code{border:1px dashed rgba(74,222,128,.55);color:#4ade80}',
    '.fxn-fb.code:hover{background:rgba(74,222,128,.08);color:#86efac}',
    '.fxn-fcode{font-size:30px;font-weight:900;letter-spacing:.06em;color:#fff}',
    '.fxn-fd{font-size:11px;color:#7D8B9E}',
    '.fxn-fchart{width:100%;height:56px;margin-top:auto}',
    '.fxn-r{display:flex;flex-direction:column;padding:12px;min-width:0}',
    '.fxn-ey{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7D8B9E;padding:8px 12px 6px}',
    '.fxn-rl{display:grid;gap:2px}',
    '.fxn-rl.c2{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.fxn-row{display:flex;align-items:center;gap:14px;padding:11px 12px;border-radius:14px;text-decoration:none;border:1px solid transparent}',
    '.fxn-rl.c2 .fxn-row{gap:12px;padding:10px}',
    '.fxn-row:hover,.fxn-row:focus-visible{background:rgba(255,255,255,.045);border-color:rgba(120,160,210,.14);outline:none}',
    '.fxn-row.cur{background:rgba(255,107,31,.08);border-color:rgba(255,107,31,.3)}',
    '.fxn-ic{width:40px;height:40px;flex-shrink:0;border-radius:12px;display:flex;align-items:center;justify-content:center;border:1px solid}',
    '.fxn-rl.c2 .fxn-ic{width:34px;height:34px;border-radius:10px}',
    '.fxn-ic svg{width:18px;height:18px}',
    '.fxn-ic.orange{background:rgba(255,107,31,.10);border-color:rgba(255,107,31,.28);color:#FF7A2E}',
    '.fxn-ic.blue{background:rgba(96,165,250,.10);border-color:rgba(96,165,250,.28);color:#93C5FD}',
    '.fxn-ic.purple{background:rgba(167,139,250,.10);border-color:rgba(167,139,250,.28);color:#C4B5FD}',
    '.fxn-ic.green{background:rgba(74,222,128,.10);border-color:rgba(74,222,128,.28);color:#4ade80}',
    '.fxn-ic.red{background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.3);color:#FCA5A5}',
    '.fxn-ic.gray{background:rgba(255,255,255,.05);border-color:rgba(120,160,210,.2);color:#CBD3DE}',
    '.fxn-rt{display:flex;flex-direction:column;gap:3px;flex-grow:1;min-width:0}',
    '.fxn-rn{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14.5px;font-weight:700;color:#fff}',
    '.fxn-rl.c2 .fxn-rn{font-size:14px}',
    '.fxn-rd{font-size:12.5px;line-height:1.4;color:#A2AEBF}',
    '.fxn-chip{padding:5px 9px;border-radius:8px;background:rgba(255,255,255,.05);font-size:12.5px;font-weight:700;color:#E6EAF0;white-space:nowrap}',
    '.fxn-chip.free{background:rgba(74,222,128,.10);color:#4ade80;font-weight:800}',
    '.fxn-live{width:7px;height:7px;border-radius:50%;background:#4ade80}',
    '.fxn-note{margin-top:auto;padding:12px;border-top:1px solid rgba(120,160,210,.13);font-size:11.5px;line-height:1.5;color:#7D8B9E}',
    '.fxn-r .fxn-foot{margin-top:6px}',
    /* phone: same menu inside the slide-out sidebar */
    '#fxn-mob{margin-top:18px}',
    '@media (min-width:768px){#fxn-mob{display:none}}',
    '.fxn-mh{display:flex;width:100%;justify-content:space-between;align-items:center;padding:13px 2px;border:0;border-top:1px solid rgba(255,255,255,.07);background:none;color:#E6EAF0;font:800 15px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-align:left}',
    '.fxn-mh svg{width:13px;height:13px;transition:transform .15s}',
    '.fxn-mg.open .fxn-mh{color:#FFC0A0}',
    '.fxn-mg.open .fxn-mh svg{transform:rotate(180deg)}',
    '.fxn-mb{display:none;padding:0 0 8px}',
    '.fxn-mg.open .fxn-mb{display:block}',
    '.fxn-ml{display:flex;align-items:center;gap:8px;padding:10px 6px;font-size:14.5px;font-weight:600;color:#CBD3DE;text-decoration:none;border-radius:8px}',
    '.fxn-ml.cur{color:#FFC0A0;background:rgba(255,107,31,.10)}',
    '.fxn-ml .fxn-pr{font-weight:600}',
    '.fxn-mfoot{display:block;padding:10px 6px;font-size:13.5px;font-weight:700;color:#4ade80;text-decoration:none}',
    '.fxn-mcta{display:block;margin-top:14px;padding:13px;border-radius:12px;text-align:center;background:linear-gradient(135deg,#FF9247 0%,#FF6B1F 52%,#EB550D 100%);color:#0A0A0A;font-size:15px;font-weight:800;text-decoration:none}',
    '.fxn-mdc{display:block;margin-top:8px;padding:12px;border-radius:12px;text-align:center;border:1px solid rgba(74,222,128,.4);color:#4ade80;font-size:14.5px;font-weight:700;text-decoration:none}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);
})();

function fsdxNavPage() {
  var p = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (!p) p = 'index.html';
  if (p.indexOf('.') === -1) p += '.html';
  return p;
}
function fsdxNavEsc(x) {
  return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function fsdxNavTag(t) {
  if (t === 'mem') return '<span class="fxn-tag fxn-mem">Members</span>';
  if (t === 'rel') return '<span class="fxn-tag fxn-rel-new" style="display:none">New</span>';
  return '';
}
var FSDX_CHEV = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function fsdxMountTopNav() {
  if (document.getElementById('fx-topnav')) return;
  var main = document.querySelector('main');
  if (!main || !document.getElementById('nav-content')) return;   // admin/login pages: no bar
  var guest = document.documentElement.classList.contains('fx-guest');
  var here = fsdxNavPage();

  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  function icon(name, color) {
    return '<span class="fxn-ic ' + (color || 'gray') + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (FSDX_ICONS[name] || '') + '</svg></span>';
  }
  function featureHtml(m) {
    var f = m.feature || {};
    var h = '<div class="fxn-f' + (m.tone === 'green' ? ' green' : '') + '">';
    if (f.kind === 'plan') {
      h += '<span class="fxn-fk">' + fsdxNavEsc(f.kicker) + '</span>'
        + '<a role="menuitem" href="' + f.href + '" class="fxn-ft">' + fsdxNavEsc(f.title) + '<span class="fxn-tags"></span></a>'
        + '<ul class="fxn-fc">' + f.checks.map(function (c) { return '<li>' + CHECK + fsdxNavEsc(c) + '</li>'; }).join('') + '</ul>'
        + '<div class="fxn-fp"><b>' + fsdxNavEsc(f.price) + '</b><span>' + fsdxNavEsc(f.per) + '</span></div>'
        + (guest ? '<a role="menuitem" href="' + f.href + '" class="fxn-fb solid">' + fsdxNavEsc(f.cta) + '</a>'
                 : '<a role="menuitem" href="' + f.href + '" class="fxn-fb">' + fsdxNavEsc(f.ctaMember) + '</a>');
    } else if (f.kind === 'code') {
      h += '<span class="fxn-fk">' + fsdxNavEsc(f.kicker) + '</span>'
        + '<span class="fxn-fcode">' + fsdxNavEsc(f.code) + '</span>'
        + '<p class="fxn-fx">' + fsdxNavEsc(f.text) + '</p>'
        + '<button type="button" class="fxn-fb code" data-copy="' + fsdxNavEsc(f.code) + '">Copy code</button>'
        + '<span class="fxn-fd">' + fsdxNavEsc(f.disclose) + '</span>';
    } else {
      h += '<span class="fxn-fk">' + fsdxNavEsc(f.kicker) + '</span>'
        + (f.href ? '<a role="menuitem" href="' + f.href + '" class="fxn-ft">' + fsdxNavEsc(f.title) + '</a>'
                  : '<span class="fxn-ft">' + fsdxNavEsc(f.title) + '</span>')
        + '<p class="fxn-fx">' + fsdxNavEsc(f.text) + '</p>'
        + (f.kind === 'chart'
            ? '<svg class="fxn-fchart" viewBox="0 0 220 60" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="#FF6B1F" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="0,52 25,46 50,48 75,36 100,40 125,28 150,31 175,18 200,22 220,10"/></svg>'
            : '<a role="menuitem" href="' + f.href + '" class="fxn-fb">' + fsdxNavEsc(f.cta) + '</a>');
    }
    return h + '</div>';
  }
  function rowHtml(it) {
    var t = it[3];
    var chip = '';
    if (t === 'Free') chip = '<span class="fxn-chip free">Free</span>';
    else if (t && t.charAt(0) === '$') chip = '<span class="fxn-chip">' + fsdxNavEsc(t) + '</span>';
    var extra = t === 'live' ? '<span class="fxn-live" aria-hidden="true"></span>' : fsdxNavTag(t);
    return '<a role="menuitem" href="' + it[0] + '" class="fxn-row' + (it[0] === here ? ' cur' : '') + '">'
      + icon(it[4], it[5])
      + '<span class="fxn-rt"><span class="fxn-rn">' + fsdxNavEsc(it[1]) + '<span class="fxn-tags">' + extra + '</span></span>'
      + '<span class="fxn-rd">' + fsdxNavEsc(it[2]) + '</span></span>' + chip + '</a>';
  }

  var menus = FSDX_MENU.map(function (m) {
    var isHere = m.items.some(function (it) { return it[0] === here; }) || (m.foot && m.foot[0] === here);
    var fHref = m.feature && m.feature.href;
    // the featured page already has its own panel on the left — don't list it twice
    var rows = m.items.filter(function (it) { return it[0] !== fHref; }).map(rowHtml).join('');
    var right = '<div class="fxn-r">'
      + (m.eyebrow ? '<span class="fxn-ey">' + fsdxNavEsc(m.eyebrow) + '</span>' : '')
      + '<div class="fxn-rl' + (m.cols === 2 ? ' c2' : '') + '">' + rows + '</div>'
      + (m.foot ? '<a role="menuitem" href="' + m.foot[0] + '" class="fxn-foot">' + fsdxNavEsc(m.foot[1]) + '</a>' : '')
      + (m.note ? '<span class="fxn-note">' + fsdxNavEsc(m.note) + '</span>' : '')
      + '</div>';
    return '<div class="fxn-m' + (isHere ? ' here' : '') + '" data-m="' + m.id + '">'
      + '<button type="button" class="fxn-b" aria-haspopup="true" aria-expanded="false" aria-controls="fxn-p-' + m.id + '">' + fsdxNavEsc(m.label) + FSDX_CHEV + '</button>'
      + '<div class="fxn-p fx2" id="fxn-p-' + m.id + '" role="menu" aria-label="' + fsdxNavEsc(m.label) + '" style="width:' + (m.w || 680) + 'px">'
      + featureHtml(m) + right + '</div>'
      + '</div>';
  }).join('');

  var bar = document.createElement('div');
  bar.id = 'fx-topnav';
  bar.innerHTML = '<div class="fxn-in">'
    + (guest ? '<a href="index.html" class="fxn-logo" aria-label="FSD-X Trading home"><b>FSD-X</b><small>TRADING</small></a>'
             : '<a href="index.html" class="fxn-home' + (here === 'index.html' ? ' here' : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' + FSDX_ICONS.home + '</svg>Home</a>')
    + '<nav aria-label="Site" style="display:flex;align-items:center;gap:2px">' + menus + '</nav>'
    + '<span class="fxn-sp"></span>'
    + '<button type="button" class="fxn-search" aria-label="Search" title="Search (⌘K)" onclick="window.fsdxOpenSearch && fsdxOpenSearch()">'
    +   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>'
    + (guest ? '<a href="login.html" class="fxn-login">Member Login</a>' : '')
    + '<a href="' + FSDX_DISCORD + '" target="_blank" rel="noopener noreferrer" class="fxn-dc">Join Discord</a>'
    + (guest ? '<a href="memberships.html" class="fxn-cta">Start Free Trial</a>' : '')
    + '</div>';
  main.insertBefore(bar, main.firstChild);

  // open / close: hover on mouse, click and keyboard everywhere
  var closeT = null;
  function shut(except) {
    bar.querySelectorAll('.fxn-m.open').forEach(function (m) {
      if (m === except) return;
      m.classList.remove('open');
      m.querySelector('.fxn-b').setAttribute('aria-expanded', 'false');
    });
  }
  function open(m) {
    clearTimeout(closeT);
    shut(m);
    m.classList.add('open');
    m.querySelector('.fxn-b').setAttribute('aria-expanded', 'true');
    // keep the panel on screen at narrower widths
    var p = m.querySelector('.fxn-p');
    p.style.left = '0px';
    var r = p.getBoundingClientRect();
    var over = r.right - (window.innerWidth - 12);
    if (over > 0) p.style.left = (-over) + 'px';
  }
  bar.querySelectorAll('.fxn-m').forEach(function (m) {
    var b = m.querySelector('.fxn-b');
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      // a hover just opened it: this click means "yes, this one", not "close"
      if (m.classList.contains('open') && Date.now() - (m._hoverAt || 0) > 450) shut(); else open(m);
    });
    m.addEventListener('mouseenter', function () {
      if (!window.matchMedia('(hover:hover)').matches) return;
      if (!m.classList.contains('open')) m._hoverAt = Date.now();
      open(m);
    });
    m.addEventListener('mouseleave', function () {
      clearTimeout(closeT);
      closeT = setTimeout(function () { m.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }, 160);
    });
    m.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { shut(); b.focus(); }
      if (e.key === 'ArrowDown' && document.activeElement === b) {
        e.preventDefault(); open(m);
        var first = m.querySelector('[role="menuitem"]'); if (first) first.focus();
      }
    });
    m.addEventListener('focusout', function (e) { if (!m.contains(e.relatedTarget)) { m.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); } });
  });
  document.addEventListener('click', function (e) { if (!bar.contains(e.target)) shut(); });
  bar.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var code = btn.getAttribute('data-copy');
      try { navigator.clipboard.writeText(code); } catch (x) {}
      var o = btn.textContent; btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = o; }, 1400);
    });
  });
}

// Phone: the same menu, as fold-out groups at the bottom of the slide-out sidebar.
function fsdxMountMobileMenu(mount) {
  if (!mount || document.getElementById('fxn-mob')) return;
  var guest = document.documentElement.classList.contains('fx-guest');
  var here = fsdxNavPage();
  var html = FSDX_MENU.map(function (m) {
    var isHere = m.items.some(function (it) { return it[0] === here; }) || (m.foot && m.foot[0] === here);
    var openIt = isHere || (guest && m.id === 'products' && !FSDX_MENU.some(function (x) { return x.items.some(function (it) { return it[0] === here; }); }));
    var links = m.items.map(function (it) {
      var price = it[3] && (it[3] === 'Free' || it[3].charAt(0) === '$') ? '<span class="fxn-pr" style="margin-left:auto">' + fsdxNavEsc(it[3]) + '</span>' : '';
      return '<a href="' + it[0] + '" class="fxn-ml' + (it[0] === here ? ' cur' : '') + '">' + fsdxNavEsc(it[1])
        + '<span class="fxn-tags">' + fsdxNavTag(it[3]) + '</span>' + price + '</a>';
    }).join('');
    var foot = m.foot ? '<a href="' + m.foot[0] + '" class="fxn-mfoot">' + fsdxNavEsc(m.foot[1]) + '</a>' : '';
    return '<div class="fxn-mg' + (openIt ? ' open' : '') + '">'
      + '<button type="button" class="fxn-mh" aria-expanded="' + (openIt ? 'true' : 'false') + '">' + fsdxNavEsc(m.label) + FSDX_CHEV + '</button>'
      + '<div class="fxn-mb">' + links + foot + '</div></div>';
  }).join('');
  var box = document.createElement('div');
  box.id = 'fxn-mob';
  box.innerHTML = '<a href="index.html" class="fxn-mhome' + (here === 'index.html' ? ' cur' : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' + FSDX_ICONS.home + '</svg>Home</a>'
    + html
    + (guest ? '<a href="memberships.html" class="fxn-mcta">Start Free Trial</a>' : '')
    + '<a href="' + FSDX_DISCORD + '" target="_blank" rel="noopener noreferrer" class="fxn-mdc">Join Discord</a>';
  var nav = mount.querySelector('nav');
  (nav || mount).appendChild(box);
  box.querySelectorAll('.fxn-mh').forEach(function (h) {
    h.addEventListener('click', function () {
      var g = h.parentNode;
      var on = g.classList.toggle('open');
      h.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  });
}

(function () {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fsdxMountTopNav, { once: true });
  else fsdxMountTopNav();
})();

// ── Command palette (⌘K) ──
// Loaded from here so no page has to add a script tag of its own.
(function () {
  if (document.getElementById('fsdx-search-js')) return;
  var sc = document.createElement('script');
  sc.id = 'fsdx-search-js';
  sc.src = 'fsdx-search.js?v=20261025a';
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
  // the pill now lives in the top bar and the phone menu (was #nav-rel-new in the sidebar)
  var pills = document.querySelectorAll('#nav-rel-new, .fxn-rel-new');
  if (!pills.length) return;
  var show = function (newest) {
    if (!newest) return;
    var d = newest.length === 7 ? newest + '-01' : newest;
    var age = (Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000;
    if (age >= 0 && age <= 14) pills.forEach(function (pill) { pill.style.display = ''; });
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

// ── Site-wide sale notice ────────────────────────────────────────────────
// Whatever sale is live in admin → Sales (/api/sale) shows on every public page:
// a "SALE" tag on the Membership nav link, plus a slim bar at the top of the page.
// The bar is skipped on index/memberships (they have their own sale block), on
// member-only pages, and for logged-in members (a coupon only matters at checkout).
// Dismiss hides it for the rest of the session, per code. Nothing shows if no sale.
// ── Site ticker ──────────────────────────────────────────────────────────
// One rotating bar at the top of every page (admin → Ticker): live sales,
// lifetime spots, the newest release note and hand-added partner / update
// items. Everyone sees the same thing, logged in or not, so a member can
// screenshot it and pass it on. Dots let a visitor jump back to any item.
// Also from the same feed: the SALE tag on each product's sidebar link, and —
// only when admin turns "inline sale line" on — the [data-sale-for] lines.
function fsdxSaleNotice() {
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var SKIP = ['admin.html', 'admin-login.html', 'login.html', 'reset.html', 'welcome.html', 'ad4.html'];
  if (SKIP.indexOf(page) !== -1) return;
  var API = 'https://nexus-validator.dfuentes4211.workers.dev/api/ticker';
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var PRODUCT_PAGE = { membership: 'memberships.html', ntsolo: 'ninjatrader.html', raven: 'raven.html', nightwing: 'nightwing.html' };
  var PRODUCT_NAME = { membership: 'the membership', ntsolo: 'Knightfall NT8', raven: 'Raven', nightwing: 'Nightwing' };
  function prods(s) { return (s.products && s.products.length) ? s.products : ['membership']; }
  function live(s) { var e = s && (s.expiresAt || s.endsAt); return !(e && new Date(e).getTime() < Date.now()); }

  function sidebarTags(sales) {
    Object.keys(PRODUCT_PAGE).forEach(function (p) {
      var sale = sales.filter(function (s) { return prods(s).indexOf(p) !== -1; })[0];
      if (!sale) return;
      document.querySelectorAll('#nav-content a[href="' + PRODUCT_PAGE[p] + '"]').forEach(function (link) {
        if (link.querySelector('.fx-sale-tag')) return;
        var price = link.querySelector('span.shrink-0');
        var tag = document.createElement('span');
        tag.className = 'fx-sale-tag';
        tag.textContent = 'SALE';
        tag.title = sale.label + ' · ' + sale.discount + ' with code ' + sale.code;
        tag.style.cssText = 'font-size:9px;font-weight:900;letter-spacing:.08em;color:#fff;background:#E5484D;border-radius:4px;padding:1px 5px;flex-shrink:0';
        if (price) price.replaceWith(tag); else link.appendChild(tag);
      });
      // top bar + phone menu: the tag sits next to the name, the price stays
      document.querySelectorAll('#fx-topnav a[href="' + PRODUCT_PAGE[p] + '"], #fxn-mob a[href="' + PRODUCT_PAGE[p] + '"]').forEach(function (link) {
        var slot = link.querySelector('.fxn-tags');
        if (!slot || slot.querySelector('.fx-sale-tag')) return;
        var tag = document.createElement('span');
        tag.className = 'fx-sale-tag fxn-tag';
        tag.textContent = 'SALE';
        tag.title = sale.label + ' · ' + sale.discount + ' with code ' + sale.code;
        tag.style.cssText = 'color:#fff;background:#E5484D';
        slot.appendChild(tag);
      });
    });
  }
  function fillSlots(sales) {
    document.querySelectorAll('[data-sale-for]').forEach(function (el) {
      var p = el.getAttribute('data-sale-for');
      var s = sales.filter(function (x) { return prods(x).indexOf(p) !== -1; })[0];
      if (!s) return;
      var exp = s.expiresAt, ends = '';
      if (exp) { try { ends = ' Ends ' + new Date(exp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) + '.'; } catch (e) {} }
      el.innerHTML = '<b style="color:#FF8A8D;text-transform:uppercase;letter-spacing:.06em;font-size:11px">⚡ ' + esc(s.label) + '</b> &middot; <b style="color:#fff">' + esc(s.discount) + '</b> on ' + esc(PRODUCT_NAME[p])
        + ' with code <span style="font-family:ui-monospace,monospace;font-weight:800;color:#4ade80">' + esc(s.code) + '</span> at checkout.'
        + (s.applies ? ' ' + esc(s.applies) : '') + esc(ends);
      el.hidden = false;
    });
  }

  var CSS = ''
    + '#fx-ticker{position:relative;z-index:20;display:flex;align-items:center;gap:12px;min-height:46px;padding:6px 8px 6px 16px;box-sizing:border-box;'
    + 'background:#0C121B;border-bottom:1px solid rgba(255,255,255,.08);font:600 13px/1.35 Inter,ui-sans-serif,system-ui,sans-serif;color:#E6EDF7}'
    + '#fx-ticker .fxt-body{flex:1;min-width:0;display:flex;align-items:center;gap:10px;animation:fxtIn .35s ease}'
    + '@keyframes fxtIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}'
    + '#fx-ticker .fxt-tag{font-size:10px;font-weight:900;letter-spacing:.12em;border-radius:6px;padding:3px 7px;flex-shrink:0;white-space:nowrap}'
    + '#fx-ticker .t-sale{color:#fff;background:#E5484D}#fx-ticker .t-lifetime{color:#0B1119;background:#FF8A4C}'
    + '#fx-ticker .t-update,#fx-ticker .t-release{color:#05230F;background:#4ade80}#fx-ticker .t-partner{color:#06152B;background:#7FB2FF}'
    + '#fx-ticker .t-announcement{color:#0B1119;background:#E6EDF7}#fx-ticker .t-giveaway{color:#1F1500;background:#FBBF24}'
    + '#fx-ticker .fxt-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#fx-ticker .fxt-aff{font-size:10px;color:#7D8B9E;font-weight:700;white-space:nowrap;flex-shrink:0}'
    + '#fx-ticker .fxt-code{font:800 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:rgba(8,13,20,.8);border:1.5px dashed rgba(255,138,141,.7);border-radius:6px;padding:2px 8px;cursor:pointer;flex-shrink:0}'
    + '#fx-ticker .fxt-go{color:#FFA057;font-weight:800;text-decoration:none;white-space:nowrap;flex-shrink:0}#fx-ticker .fxt-go:hover{color:#FFC08A}'
    + '#fx-ticker .fxt-dots{display:flex;gap:5px;flex-shrink:0;align-items:center}'
    + '#fx-ticker .fxt-dot{width:8px;height:8px;border-radius:999px;border:0;padding:0;cursor:pointer;background:rgba(255,255,255,.22);transition:width .2s}'
    + '#fx-ticker .fxt-dot.on{width:20px;background:#FF6B1F}'
    + '#fx-ticker .fxt-dotwrap{display:inline-flex;align-items:center;justify-content:center;width:22px;height:30px;border:0;background:none;padding:0;cursor:pointer}'
    + '#fx-ticker .fxt-x{width:32px;height:32px;border:0;background:none;color:#7D8B9E;font-size:18px;cursor:pointer;flex-shrink:0}'
    + '#fx-ticker .fxt-bar{position:absolute;left:0;bottom:-1px;height:2px;background:#FF6B1F;width:0}'
    + '@media (max-width:720px){#fx-ticker{flex-wrap:wrap;gap:6px 10px;padding:8px 6px 8px 12px}'
    + '#fx-ticker .fxt-body{flex-basis:100%;flex-wrap:wrap;row-gap:6px}#fx-ticker .fxt-text{white-space:normal}'
    + '#fx-ticker .fxt-dots{margin-left:auto}}'
    + '@media (prefers-reduced-motion:reduce){#fx-ticker .fxt-body{animation:none}}';

  function render(data) {
    var sales = ((data && data.sales) || []).filter(live);
    sidebarTags(sales);
    var settings = (data && data.settings) || {};
    if (settings.inlineSales) fillSlots(sales);
    var items = ((data && data.items) || []).filter(live);
    if (!items.length) return Promise.resolve();
    // The release slot is filled from releases.json: newest shipped note, last 7 days.
    var ri = -1; items.forEach(function (x, i) { if (x.kind === 'release') ri = i; });
    var relP = ri === -1 ? Promise.resolve(null) : fetch('releases.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return relP.then(function (rel) {
      if (ri !== -1) {
        var newest = rel && (rel.releases || []).filter(function (r) { return r.status === 'shipped' && r.date && r.date.length === 10; })
          .sort(function (a, b) { return b.date < a.date ? -1 : 1; })[0];
        if (newest && Date.now() - new Date(newest.date + 'T12:00:00').getTime() < 7 * 864e5) items[ri].text = newest.title;
        else items.splice(ri, 1);
      }
      if (!items.length) return;
      mount(items, Math.max(3, Number(settings.speed) || 5));
    });
  }

  function mount(items, secs) {
    var sig = items.map(function (x) { return x.id + '|' + x.text; }).join('~');
    var hash = 0; for (var i = 0; i < sig.length; i++) { hash = (hash * 31 + sig.charCodeAt(i)) | 0; }
    var key = 'fsdx_ticker_x_' + hash;
    try { if (sessionStorage.getItem(key)) return; } catch (e) {}
    var host = document.querySelector('main') || document.body;
    if (!host || document.getElementById('fx-ticker')) return;
    if (!document.getElementById('fx-ticker-css')) {
      var st = document.createElement('style'); st.id = 'fx-ticker-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var el = document.createElement('div');
    el.id = 'fx-ticker';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'News and offers');
    el.setAttribute('aria-roledescription', 'carousel');
    host.insertBefore(el, host.firstChild);
    var idx = 0, t = 0, paused = false;
    var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    function draw() {
      var x = items[idx];
      var go = x.link ? '<a class="fxt-go" href="' + esc(x.link) + '"' + (/^https:/.test(x.link) ? ' target="_blank" rel="noopener' + (x.affiliate ? ' sponsored' : '') + '"' : '') + '>' + esc(x.linkText || 'See more') + ' &rarr;</a>' : '';
      var dots = items.length > 1 ? items.map(function (_, i) {
        return '<button type="button" class="fxt-dotwrap" data-fxt-i="' + i + '" aria-label="Show item ' + (i + 1) + ' of ' + items.length + '"' + (i === idx ? ' aria-current="true"' : '') + '><span class="fxt-dot' + (i === idx ? ' on' : '') + '"></span></button>';
      }).join('') : '';
      el.innerHTML = '<div class="fxt-body" aria-live="' + (paused ? 'polite' : 'off') + '">'
        + '<span class="fxt-tag t-' + esc(x.kind) + '">' + (x.kind === 'sale' ? '⚡ ' : '') + esc(x.tag) + '</span>'
        + '<span class="fxt-text">' + esc(x.text) + '</span>'
        + (x.affiliate ? '<span class="fxt-aff">Affiliate link</span>' : '')
        + (x.code ? '<button type="button" class="fxt-code" data-fxt-copy title="Copy code">' + esc(x.code) + '</button>' : '')
        + go + '</div>'
        + '<div class="fxt-dots">' + dots + '</div>'
        + '<button type="button" class="fxt-x" data-fxt-x aria-label="Hide for this visit">×</button>'
        + '<div class="fxt-bar"></div>';
    }
    function step(n) { idx = (n + items.length) % items.length; t = 0; draw(); }
    draw();
    el.addEventListener('mouseenter', function () { paused = true; });
    el.addEventListener('mouseleave', function () { paused = false; });
    el.addEventListener('focusin', function () { paused = true; });
    el.addEventListener('focusout', function () { paused = false; });
    el.addEventListener('click', function (e) {
      var d = e.target.closest('[data-fxt-i]'); if (d) { step(+d.getAttribute('data-fxt-i')); return; }
      if (e.target.closest('[data-fxt-x]')) { try { sessionStorage.setItem(key, '1'); } catch (x) {} clearInterval(timer); el.remove(); return; }
      var cp = e.target.closest('[data-fxt-copy]');
      if (cp) { try { navigator.clipboard.writeText(items[idx].code); var o = cp.textContent; cp.textContent = 'Copied ✓'; setTimeout(function () { if (cp.isConnected) cp.textContent = o; }, 1400); } catch (x) {} }
    });
    // Swipe on phones.
    var sx = null;
    el.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; paused = true; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (sx != null) { var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) step(idx + (dx < 0 ? 1 : -1)); }
      sx = null; paused = false;
    });
    // Rotates even with "reduce motion" on (Windows turns that on when
    // animations are off) — only the slide-in animation is dropped.
    if (items.length < 2) return;
    var timer = setInterval(function () {
      if (paused || document.hidden) return;
      t += 0.1;
      var bar = el.querySelector('.fxt-bar'); if (bar) bar.style.width = Math.min(100, (t / secs) * 100) + '%';
      if (t >= secs) step(idx + 1);
    }, 100);
  }

  var cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('fsdx_ticker') || 'null'); } catch (e) {}
  if (cached && cached.t && Date.now() - cached.t < 5 * 60 * 1000) { render(cached.d); return; }
  fetch(API).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    try { sessionStorage.setItem('fsdx_ticker', JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
    render(d);
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
    return fetch('nav.html?v=20261026a')
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
      // phone menu: site pages, appended after the labels are wrapped
      try { fsdxMountTopNav(); fsdxMountMobileMenu(mount); } catch (e) { console.warn('[nav] site menu:', e); }
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

      // Sale notice: nav tag + top bar on public pages (admin → Sales drives it).
      try { fsdxSaleNotice(); } catch (e) {}

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
                       : plan === 'ntsolo' ? 'Knightfall NT8'
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
        if (plan === 'site' || plan === 'raven') {
          document.querySelectorAll('#nav-content a[href="alerts.html"], #nav-content a[href="ninjatrader-members.html"], #nav-content a[href="variant-settings.html"]')
            .forEach(el => el.classList.add('hidden'));
        }
        /* Knightfall NT8 standalone: same platform as Nightwing, plus the
           NinjaTrader hub and variant settings. Scout is the one thing
           hidden. Cosmetic only — /api/scout/feed is the real gate. */
        if (plan === 'ntsolo') {
          document.querySelectorAll('#nav-content a[href="alerts.html"]')
            .forEach(el => el.classList.add('hidden'));
        }
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
          ['converter.html', 'Trade Importer'], ['ninjatrader-members.html', 'NinjaTrader Hub'],
          ['variant-settings.html', 'Variant Settings'],
          ['refer.html', 'Refer & Earn'],
          ['profile.html', 'Profile']
        ]; } catch (e) {}
        // Same tools-tier rule as the real nav above.
        try {
          var fbPlan = localStorage.getItem('fsdx_plan');
          if (fbPlan === 'site' || fbPlan === 'raven') {
            vip = vip.filter(function (l) { return l[0] !== 'alerts.html' && l[0] !== 'ninjatrader-members.html' && l[0] !== 'variant-settings.html'; });
          }
          if (fbPlan === 'ntsolo') {
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
          ['autotrader.html', 'ORB Auto-Trader'], ['ninjatrader.html', 'Knightfall NT8'],
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

// ── Plan-aware buy buttons ───────────────────────────────────────────────
// A logged-in member should never be one click from buying something they
// already have (and starting a second trial on a different product). Every
// checkout link is classified by its data-gate / plan id:
//   member already HAS it → button becomes "Included in your plan → <where>"
//   member is buying UP   → membership buttons read "Upgrade to the membership"
// Unknown or missing plan → nothing changes (fail open, same as every gate).
function fsdxPlanCtas() {
  var plan = '', token = '';
  try { plan = localStorage.getItem('fsdx_plan') || ''; token = localStorage.getItem('fsdx_token') || ''; } catch (e) { return; }
  if (!token || !plan) return;

  var MEMBERSHIP_PLANS = ['plan_l0KkbipfcgnAp', 'plan_RYMEBnqYNmFEZ', 'plan_1CAj5BxdzpT1W', 'plan_SNuUJU8GaJk5N'];
  function family(a) {
    var g = a.getAttribute('data-gate') || '';
    var href = a.getAttribute('href') || '';
    if (g === 'ntsolo') return 'ntsolo';
    if (g === 'raven') return 'raven';
    if (g === 'nightwing') return 'nightwing';
    if (g === 'autotrader' || g === 'membership' || g === 'lifetime') return 'membership';
    for (var i = 0; i < MEMBERSHIP_PLANS.length; i++) if (href.indexOf(MEMBERSHIP_PLANS[i]) !== -1) return 'membership';
    return '';
  }
  // What each plan already includes, and where to send them instead.
  var VIP = plan === 'pro' || plan === 'plus';
  var HAS = {
    membership: VIP,
    ntsolo: VIP || plan === 'ntsolo',
    raven: VIP || plan === 'raven',
    nightwing: VIP || plan === 'site' || plan === 'raven' || plan === 'ntsolo',
  };
  var GO = {
    membership: ['dashboard.html', 'Dashboard'],
    ntsolo: ['ninjatrader-members.html', 'NinjaTrader Hub'],
    raven: ['setup.html#step-4', 'Claim on Whop'],
    nightwing: ['dashboard.html', 'Dashboard'],
  };

  document.querySelectorAll('a[href*="whop.com/checkout/"]').forEach(function (a) {
    if (a.getAttribute('data-plan-cta')) return;
    var fam = family(a); if (!fam) return;
    a.setAttribute('data-plan-cta', '1');
    if (HAS[fam]) {
      a.setAttribute('href', GO[fam][0]);
      a.removeAttribute('target'); a.removeAttribute('data-gate');
      a.textContent = 'Included · ' + GO[fam][1] + ' →';
      a.title = 'You already have this on your current plan.';
    } else if (fam === 'membership' && a.getAttribute('data-gate') !== 'lifetime') {
      a.textContent = 'Upgrade to the membership';
    }
  });
}
(function () {
  function run() { try { fsdxPlanCtas(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
