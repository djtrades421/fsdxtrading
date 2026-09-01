// nav-loader.js — Universal nav loader
// Handles logged-in and logged-out states automatically

// ── Site traffic beacon ──
// Non-members only, public marketing pages only. Fires once per session PER page.
// The first ping of the session also counts as the visit (top counters + source);
// every page a visitor opens is tallied for the "Pages Visited" breakdown.
(function() {
  try {
    // Only count non-members: skip if a logged-in session exists
    if (localStorage.getItem('fsdx_token')) return;
    // Skip admin/login/member-tool pages — we want marketing traffic only
    var rawPath = location.pathname || '/';
    if (/admin|login|reset|dashboard|profile|journal|tracker|playbook/.test(rawPath.toLowerCase())) return;

    // One ping per page per session
    var pgKey = rawPath.toLowerCase().split('?')[0].split('#')[0];
    if (sessionStorage.getItem('fsdx_pv:' + pgKey)) return;
    sessionStorage.setItem('fsdx_pv:' + pgKey, '1');

    // Is this the first tracked page of the whole session? → count it as a visit.
    var firstOfSession = !sessionStorage.getItem('fsdx_v');
    var src = 'direct';
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
  sc.src = 'fsdx-search.js?v=20260830';
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
  sc.src = 'fsdx-account.js?v=20260830';
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
    return fetch('nav.html?v=20260830')
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

      // "The Site" starts shut for members, open for visitors
      const loggedIn = !!localStorage.getItem('fsdx_token');
      applyNavGroupState('nav-group-site', !loggedIn);

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
        // Base name: "VIP Plus" / "VIP Pro" when known, else "VIP"
        const planName = plan === 'pro' ? 'VIP Pro' : plan === 'plus' ? 'VIP Plus' : 'VIP';
        let tierText;
        if (tier === 'trial') tierText = planName + ' · Trial';
        else if (whopStatus === 'completed') tierText = planName + ' · Lifetime';
        else if (tier === 'pending' || whopStatus === 'pending') tierText = 'Setup incomplete';
        else tierText = plan ? planName : 'VIP Member';
        if (tierEl) tierEl.textContent = tierText;
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
          ['converter.html', 'Trade Importer'], ['profile.html', 'Profile']
        ]; } catch (e) {}
        var site = [
          ['index.html', 'Home'], ['suite.html', 'The System'],
          ['autotrader.html', 'ORB Auto-Trader'], ['results.html', 'Results'],
          ['memberships.html', 'Membership'], ['knowledge.html', 'Knowledge Base'],
          ['contact.html', 'Contact & Help']
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
  window.location.href = 'index.html';
}
