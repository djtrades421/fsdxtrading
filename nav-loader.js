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
    '#sidebar-panel:hover::-webkit-scrollbar-thumb:hover { background: rgba(74,222,128,0.35); }'
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);
})();

(function() {
  // Show skeleton immediately to prevent flash
  const navContent = document.getElementById('nav-content');
  if (navContent) {
    navContent.innerHTML = `<div class="animate-pulse space-y-3 pt-2 flex-1">
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
  }

  fetch('nav.html')
    .then(r => r.text())
    .then(html => {
      document.getElementById('nav-content').innerHTML = html;

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

      // Show VIP section if logged in
      const token = localStorage.getItem('fsdx_token');
      if (token) {
        // Show all vip-only elements
        document.querySelectorAll('#nav-content .vip-only').forEach(el => {
          el.classList.remove('hidden');
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
        const whopStatus = localStorage.getItem('fsdx_whop_status') || '';
        const plan = localStorage.getItem('fsdx_plan') || '';
        // Base name: "VIP Plus" / "VIP Pro" when known, else "VIP"
        const planName = plan === 'pro' ? 'VIP Pro' : plan === 'plus' ? 'VIP Plus' : 'VIP';
        let tierText;
        if (tier === 'trial') tierText = planName + ' Trial';
        else if (whopStatus === 'completed') tierText = planName + ' Lifetime';
        else tierText = plan ? planName : 'VIP Member';
        if (tierEl) tierEl.textContent = tierText;
      }
    })
    .catch(err => console.error('[nav] Failed to load nav.html:', err));
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
  window.location.href = 'index.html';
}
