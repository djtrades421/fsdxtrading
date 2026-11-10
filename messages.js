/* FSD-X — member messages: unread badge + "show on login" pop-up (Nov 2026)
 *
 * Loaded by nav-loader.js for logged-in members only. It asks the worker how
 * many unread messages from Danny there are, puts a count on the sidebar's
 * Support link, and — when Danny flagged a message "show on login" — opens it
 * in a pop-up the first time a page loads. The thread itself lives on
 * messages.html. Fails quietly: if anything here breaks, the page still works.
 */
(function () {
  if (window.__fsdxMsg) return;
  window.__fsdxMsg = true;
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var onPage = /messages\.html$/.test(location.pathname);
  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function css() {
    if (document.getElementById('fx-msg-css')) return;
    var st = document.createElement('style');
    st.id = 'fx-msg-css';
    st.textContent =
      '#nav-content a.fx-has-msg{position:relative}' +
      '.fx-msg-badge{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#FF6B1F;color:#000;' +
        'font-size:10px;font-weight:900;line-height:18px;text-align:center;box-sizing:border-box;flex-shrink:0}' +
      '@media (min-width:768px){html.nav-collapsed .fx-msg-badge{position:absolute;top:3px;right:3px;min-width:0;width:9px;height:9px;padding:0;font-size:0;box-shadow:0 0 0 2px #070c14}}' +
      '.fx-msg-pop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.72);backdrop-filter:blur(3px)}' +
      '.fx-msg-card{width:100%;max-width:30rem;max-height:86vh;overflow:auto;background:#09090b;border:1px solid rgba(255,107,31,.4);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:Inter,system-ui,sans-serif}' +
      '.fx-msg-card .k{font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#FF8A4C}' +
      '.fx-msg-card h3{margin:4px 0 12px;font-size:17px;font-weight:900;color:#fff}' +
      '.fx-msg-card .b{font-size:14px;line-height:1.6;color:#e4e4e7;white-space:pre-wrap;word-break:break-word;border-left:3px solid #FF6B1F;padding:4px 0 4px 12px}' +
      '.fx-msg-card .row{display:flex;gap:10px;margin-top:18px}' +
      '.fx-msg-card a,.fx-msg-card button{flex:1;text-align:center;font-weight:800;font-size:13px;padding:11px 14px;border-radius:12px;cursor:pointer;text-decoration:none}' +
      '.fx-msg-card a{background:#FF6B1F;color:#000;border:0}' +
      '.fx-msg-card button{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.2)}';
    document.head.appendChild(st);
  }

  function badge(n) {
    var link = document.querySelector('#nav-content a[href="messages.html"]');
    if (!link) return;
    var old = link.querySelector('.fx-msg-badge');
    if (old) old.remove();
    link.classList.remove('fx-has-msg');
    if (!(n > 0) || onPage) return;
    css();
    var b = document.createElement('span');
    b.className = 'fx-msg-badge';
    b.textContent = n > 9 ? '9+' : String(n);
    b.setAttribute('aria-label', n + ' unread message' + (n === 1 ? '' : 's'));
    link.classList.add('fx-has-msg');
    link.appendChild(b);
  }

  function markRead() {
    return fetch(API + '/api/auth/messages/read', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok() } }).catch(function () {});
  }

  function popup(p) {
    if (onPage || !p || !p.id) return;
    try { if (sessionStorage.getItem('fx_msg_pop') === p.id) return; sessionStorage.setItem('fx_msg_pop', p.id); } catch (e) {}
    css();
    var wrap = document.createElement('div');
    wrap.className = 'fx-msg-pop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="fx-msg-card">' +
      '<div class="k">Message from Danny</div><h3>You have a new message</h3>' +
      '<div class="b">' + esc(p.text) + '</div>' +
      '<div class="row"><a href="messages.html">Reply</a><button type="button">Got it</button></div></div>';
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') { close(); } }
    wrap.querySelector('button').onclick = function () { markRead().then(function () { badge(0); }); close(); };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
  }

  function check() {
    if (!tok()) return;
    fetch(API + '/api/auth/messages/unread', { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        badge(d.unread || 0);
        if (d.popup) popup(d.popup);
      })
      .catch(function () {});
  }

  // Exposed so messages.html can clear the badge after it loads the thread.
  window.fsdxMsgBadge = badge;
  check();
  setInterval(function () { if (document.visibilityState === 'visible') check(); }, 120000);
})();
