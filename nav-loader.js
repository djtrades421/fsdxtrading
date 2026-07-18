// nav-loader.js — Universal nav loader
// Handles logged-in and logged-out states automatically

// ── Site traffic beacons ──
// Non-members only, public marketing pages only.
//   • Visit ping — once per session — drives the top counters + source attribution.
//   • Page ping  — once per session PER page — drives the "Pages Visited" breakdown.
// The two use separate endpoints/keys so they never overwrite each other.
(function() {
  try {
    // Only count non-members: skip if a logged-in session exists
    if (localStorage.getItem('fsdx_token')) return;
    // Skip admin/login/member-tool pages — we want marketing traffic only
    var rawPath = location.pathname || '/';
    if (/admin|login|reset|dashboard|profile|journal|tracker|playbook/.test(rawPath.toLowerCase())) return;

    var BASE = 'https://nexus-validator.dfuentes4211.workers.dev';

    // ---- Visit ping: once per session (top counters + sources) ----
    if (!sessionStorage.getItem('fsdx_v')) {
      sessionStorage.setItem('fsdx_v', '1');
      var params = new URLSearchParams(location.search);
      var src = (params.get('utm_source') || '').toLowerCase().trim().slice(0, 40);
      if (!src) {
        var ref = document.referrer || '';
        if (/youtube\.com|youtu\.be/.test(ref)) src = 'youtube';
        else if (/google\./.test(ref)) src = 'google';
        else if (/bing\.|duckduckgo|yahoo/.test(ref)) src = 'search';
        else if (/instagram|facebook|fb\.|tiktok|twitter|t\.co|x\.com/.test(ref)) src = 'social';
        else if (ref && ref.indexOf(location.host) === -1) src = 'referral';
        else src = 'direct';
      }
      fetch(BASE + '/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src }),
        keepalive: true
      }).catch(function(){});
    }

    // ---- Page ping: once per session PER page (Pages Visited) ----
    var pgKey = rawPath.toLowerCase().split('?')[0].split('#')[0];
    if (!sessionStorage.getItem('fsdx_pv:' + pgKey)) {
      sessionStorage.setItem('fsdx_pv:' + pgKey, '1');
      fetch(BASE + '/api/track-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rawPath }),
        keepalive: true
      }).catch(function(){});
    }
  } catch (e) { /* analytics never breaks the page */ }
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
