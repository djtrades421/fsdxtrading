/* ==========================================================================
   admin-messages.js — Admin → Messages (Nov 2026)
   One thread per member between Danny and that member. Members write from
   Support (messages.html); Danny answers here or starts a thread from a
   template. A message can pop up on the member's next page load and/or send
   an email heads-up. Worker: /api/admin/messages.
   The nav count polls every minute — the admin is usually left open.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var LAST_TPL = '';
  var INDEX = {}, TOPICS = {}, OPEN = null, THREAD = null, FILTER = 'open', QUERY = '', DRAFT = {}, BUSY = false;
  var PREFS = { popup: true, emailCopy: true };
  try { var sp = JSON.parse(localStorage.getItem('fsdx_msg_prefs') || 'null'); if (sp) PREFS = sp; } catch (e) {}

  /* Templates. {first} becomes the member's first name. Edit freely before sending. */
  var TEMPLATES = [
    { id: 'welcome', label: 'Welcome / onboarding', text: 'Hey {first}, welcome to FSD-X. I\'m Danny.\n\nWhich platform are you trading on, TradingView or NinjaTrader 8? Tell me here and I\'ll make sure the right access is set up.\n\nIf you want help getting set up, reply here or book a free setup call: https://www.fsdxtrading.com/book-a-call.html' },
    { id: 'platform', label: 'Which platform?', text: 'Hey {first}, quick one: are you trading on TradingView or NinjaTrader 8? Reply here and I\'ll get the right access set up for you.' },
    { id: 'ntemail', label: 'Need NinjaTrader email', text: 'Hey {first}, to add your NinjaTrader license I need the email you log into NinjaTrader with. You can add it in the NinjaTrader Hub (https://www.fsdxtrading.com/ninjatrader-members.html) or just reply here with it.' },
    { id: 'tvclaim', label: 'Claim TradingView indicators', text: 'Hey {first}, it looks like your TradingView indicators haven\'t been claimed yet. Open your Whop membership, click Claim next to TradingView, and enter your TradingView username (not your email). The guide is here: https://www.fsdxtrading.com/setup.html#step-4' },
    { id: 'duplicate', label: 'Two sign-ups', text: 'Hey {first}, I noticed two sign-ups that look like they\'re both yours. Can you let me know which one you want to keep? Reply here and I\'ll sort it out.' },
    { id: 'checkin', label: 'Check-in', text: 'Hey {first}, checking in. How\'s the setup going? Anything I can help with?' },
    { id: 'trial', label: 'Trial ending soon', text: 'Hey {first}, your free trial ends soon. Any questions about the setup or how to use it before then? Reply here and I\'ll help.' }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function low(s) { return String(s || '').trim().toLowerCase(); }
  function when(iso, short) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var sameDay = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) === now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    if (short && sameDay) return d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }) + (short ? '' : ' · ' + d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT');
  }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2400);
  }
  function api(path, body) {
    return fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Authorization': 'Bearer ' + tok() }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok || d.success === false) throw new Error(d.error || 'Request failed'); return d; }); });
  }
  /** Roster + site accounts, for names and the "new message" picker. */
  function people() {
    var out = {};
    try { (rosterData || []).forEach(function (r) { var e = low(r.email); if (e) out[e] = { email: e, name: r.name || r.whopUsername || '', product: r.productName || r.planName || '', status: r.status || '' }; }); } catch (e) {}
    try { (allMembers || []).forEach(function (m) { var e = low(m.email); if (!e) return; var n = [m.firstName, m.lastName].filter(Boolean).join(' '); if (!out[e]) out[e] = { email: e, name: n, product: m.tier ? 'Site · ' + m.tier : '', status: '' }; else if (!out[e].name) out[e].name = n; }); } catch (e) {}
    return out;
  }
  function firstName(email) {
    var p = people()[email] || {}, n = (THREAD && THREAD.name) || p.name || '';
    n = String(n).trim().split(/\s+/)[0] || '';
    if (!n || /@/.test(n)) return 'there';
    if (n === n.toUpperCase()) n = n.toLowerCase();   // "JAWAD" → "Jawad"
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  /* ── Styles ── */
  var CSS = ''
    + '#panel-messages .mg-wrap{display:grid;gap:16px;grid-template-columns:1fr}'
    + '@media(min-width:1000px){#panel-messages .mg-wrap{grid-template-columns:340px minmax(0,1fr)}}'
    + '#panel-messages .mg-list{max-height:70vh;overflow:auto}'
    + '#panel-messages .mg-item{display:block;width:100%;text-align:left;padding:11px 12px;border-radius:10px;border:1px solid transparent;background:transparent;cursor:pointer;color:#a1a1aa}'
    + '#panel-messages .mg-item:hover{background:rgba(255,255,255,.03)}'
    + '#panel-messages .mg-item.on{background:rgba(255,107,31,.07);border-color:rgba(255,107,31,.35)}'
    + '#panel-messages .mg-item .n{color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px}'
    + '#panel-messages .mg-item .p{font-size:12px;color:#8A97A8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#panel-messages .mg-item .t{font-size:10.5px;color:#52525b;margin-left:auto;font-weight:600}'
    + '#panel-messages .mg-dot{width:8px;height:8px;border-radius:50%;background:#FF6B1F;flex:none}'
    + '#panel-messages .mg-thread{display:flex;flex-direction:column;gap:10px;max-height:52vh;min-height:180px;overflow:auto;padding:4px 2px}'
    + '#panel-messages .mg-row{display:flex;flex-direction:column;max-width:82%}'
    + '#panel-messages .mg-row.me{align-self:flex-end;align-items:flex-end}'
    + '#panel-messages .mg-row.them{align-self:flex-start;align-items:flex-start}'
    + '#panel-messages .mg-bub{padding:9px 13px;border-radius:13px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}'
    + '#panel-messages .mg-row.me .mg-bub{background:rgba(255,107,31,.13);border:1px solid rgba(255,107,31,.35);color:#fff;border-bottom-right-radius:4px}'
    + '#panel-messages .mg-row.them .mg-bub{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;border-bottom-left-radius:4px}'
    + '#panel-messages .mg-meta{font-size:10.5px;color:#71717a;margin-top:3px}'
    + '#panel-messages textarea.ntx-in{width:100%;min-height:110px;resize:vertical;font-size:13px;line-height:1.5}'
    + '#panel-messages .mg-chk{display:flex;align-items:center;gap:7px;font-size:12px;color:#d4d4d8;cursor:pointer}';

  function skeleton() {
    var p = $('panel-messages'); if (!p || p.getAttribute('data-ready')) return;
    p.setAttribute('data-ready', '1');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    p.innerHTML = ''
      + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
      +   '<div><h2 class="text-lg font-black text-white">Messages</h2>'
      +   '<div class="text-[11px] text-zinc-600 mt-0.5">Direct messages with members. They reply from Support on the site.</div></div>'
      +   '<div class="flex gap-2 flex-wrap"><button class="ntx-btn pri" data-mg="new">New message</button><button class="ntx-btn" data-mg="refresh">&#10227; Refresh</button></div>'
      + '</div>'
      + '<div class="mg-wrap">'
      +   '<div class="ntx-card" style="padding:12px;min-width:0">'
      +     '<div class="flex gap-1 flex-wrap mb-2" id="mg-filters"></div>'
      +     '<input id="mg-q" class="ntx-in" placeholder="Search name or email" style="width:100%;margin-bottom:8px">'
      +     '<div class="mg-list" id="mg-list"></div>'
      +   '</div>'
      +   '<div class="ntx-card" id="mg-main" style="min-width:0"></div>'
      + '</div>';
    $('mg-q').oninput = function () { QUERY = low(this.value); renderList(); };
  }

  function rows() {
    var ppl = people();
    return Object.keys(INDEX).map(function (e) {
      var x = INDEX[e]; return Object.assign({ email: e, display: x.name || (ppl[e] && ppl[e].name) || e }, x);
    }).sort(function (a, b) { return (b.unreadAdmin > 0) - (a.unreadAdmin > 0) || (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  }
  function unreadTotal() { var n = 0; Object.keys(INDEX).forEach(function (e) { if (INDEX[e].unreadAdmin > 0) n++; }); return n; }
  function navBadge() {
    var el = $('msgs-nav-n'); if (!el) return;
    var n = unreadTotal();
    el.textContent = n; el.style.display = n ? '' : 'none';
  }

  function renderList() {
    var all = rows();
    var F = [['open', 'Open', function (r) { return r.status !== 'closed'; }], ['unread', 'Unread', function (r) { return r.unreadAdmin > 0; }], ['closed', 'Closed', function (r) { return r.status === 'closed'; }], ['all', 'All', function () { return true; }]];
    $('mg-filters').innerHTML = F.map(function (f) {
      return '<button class="ntx-chip' + (FILTER === f[0] ? ' on' : '') + '" data-mgf="' + f[0] + '">' + f[1] + ' <span class="text-zinc-600">' + all.filter(f[2]).length + '</span></button>';
    }).join('');
    var fn = (F.filter(function (f) { return f[0] === FILTER; })[0] || F[0])[2];
    var list = all.filter(fn).filter(function (r) { return !QUERY || (r.display + ' ' + r.email).toLowerCase().indexOf(QUERY) !== -1; });
    $('mg-list').innerHTML = list.length ? list.map(function (r) {
      return '<button class="mg-item' + (OPEN === r.email ? ' on' : '') + '" data-mgo="' + esc(r.email) + '">'
        + '<div class="n">' + (r.unreadAdmin > 0 ? '<span class="mg-dot"></span>' : '') + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.display) + '</span><span class="t">' + esc(when(r.updatedAt, true)) + '</span></div>'
        + '<div class="p">' + (r.lastFrom === 'admin' ? 'You: ' : '') + esc(r.preview || '') + '</div>'
        + (r.topic && TOPICS[r.topic] && r.lastFrom === 'member' ? '<div class="pp-sub" style="font-size:10.5px;color:#FF8A4C;margin-top:2px">' + esc(TOPICS[r.topic]) + '</div>' : '')
        + '</button>';
    }).join('') : '<div class="text-[12px] text-zinc-500 p-3">' + (Object.keys(INDEX).length ? 'Nothing here.' : 'No messages yet. Press New message, or use Message on someone in People.') + '</div>';
    navBadge();
  }

  function composer(email) {
    var d = DRAFT[email] || '';
    return '<div class="pp-sec" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#71717a;margin:14px 0 6px">Reply</div>'
      + '<div class="flex gap-2 flex-wrap items-center mb-2"><select class="ntx-in" id="mg-tpl" style="flex:1 1 200px"><option value="">Template…</option>'
      + TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join('') + '</select></div>'
      + '<textarea class="ntx-in" id="mg-text" maxlength="4000" placeholder="Write a message…">' + esc(d) + '</textarea>'
      + '<div class="flex items-center gap-4 flex-wrap mt-2">'
      +   '<label class="mg-chk"><input type="checkbox" id="mg-pop"' + (PREFS.popup ? ' checked' : '') + '> Pop up on their next login</label>'
      +   '<label class="mg-chk"><input type="checkbox" id="mg-mail"' + (PREFS.emailCopy ? ' checked' : '') + '> Email them a heads-up</label>'
      +   '<button class="ntx-btn pri" data-mg="send" style="margin-left:auto">' + (BUSY ? 'Sending…' : 'Send') + '</button>'
      + '</div><div class="text-[11px] text-zinc-600 mt-1">Ctrl + Enter to send.</div>';
  }

  function renderMain() {
    var m = $('mg-main'); if (!m) return;
    if (OPEN === '__new') {
      var ppl = people();
      var opts = Object.keys(ppl).sort().map(function (e) { var p = ppl[e]; return '<option value="' + esc(e) + '">' + esc((p.name ? p.name + ' · ' : '') + (p.product || '')) + '</option>'; }).join('');
      m.innerHTML = '<div class="text-white font-black mb-1">New message</div><div class="text-[12px] text-zinc-500 mb-3">Pick a member by email. Start typing a name or email.</div>'
        + '<input id="mg-to" class="ntx-in" list="mg-people" placeholder="member@email.com" style="width:100%"><datalist id="mg-people">' + opts + '</datalist>'
        + composer('__new');
      return;
    }
    if (!OPEN) { m.innerHTML = '<div class="text-[13px] text-zinc-500 py-10 text-center">Pick a conversation, or start a new one.</div>'; return; }
    if (!THREAD) { m.innerHTML = '<div class="text-[13px] text-zinc-500 py-10 text-center">Loading…</div>'; return; }
    var p = people()[OPEN] || {}, t = THREAD;
    var head = '<div class="flex items-start justify-between gap-2 flex-wrap">'
      + '<div style="min-width:0"><div class="text-white font-black">' + esc(t.name || p.name || OPEN) + '</div>'
      + '<div class="text-[12px] text-zinc-500">' + esc(OPEN) + (p.product ? ' · ' + esc(p.product) : '') + '</div></div>'
      + '<div class="flex gap-2 flex-wrap">'
      +   (window.peopleOpen ? '<button class="ntx-btn" data-mg="person">Open in People</button>' : '')
      +   '<button class="ntx-btn" data-mg="' + (t.status === 'closed' ? 'reopen' : 'close') + '">' + (t.status === 'closed' ? 'Reopen' : 'Mark done') + '</button>'
      + '</div></div>';
    var msgs = (t.messages || []);
    var seen = t.memberReadAt || '';
    var body = msgs.length ? msgs.map(function (x, i) {
      var me = x.from === 'admin';
      var last = me && !msgs.slice(i + 1).some(function (y) { return y.from === 'admin'; });
      var status = me ? (seen && seen >= x.at ? 'Seen' : 'Sent') + (x.emailed ? ' · emailed' : '') + (x.id === t.popupId ? ' · pop-up waiting' : '') : '';
      return '<div class="mg-row ' + (me ? 'me' : 'them') + '"><div class="mg-bub">' + esc(x.text) + '</div>'
        + '<div class="mg-meta">' + (!me && x.topic && TOPICS[x.topic] ? '<b style="color:#FF8A4C">' + esc(TOPICS[x.topic]) + '</b> · ' : '') + esc(when(x.at)) + (last ? ' · ' + status : '') + '</div></div>';
    }).join('') : '<div class="text-[12px] text-zinc-500 py-6 text-center">No messages yet. Write the first one below.</div>';
    m.innerHTML = head + '<div class="mg-thread mt-3" id="mg-thread">' + body + '</div>' + composer(OPEN);
    var th = $('mg-thread'); if (th) th.scrollTop = th.scrollHeight;
  }

  function loadIndex() {
    if (!tok()) return Promise.resolve();
    return api('/api/admin/messages').then(function (d) { INDEX = d.index || {}; TOPICS = d.topics || TOPICS; renderListIfReady(); navBadge(); }).catch(function () {});
  }
  function renderListIfReady() { if ($('mg-list')) renderList(); }
  function openThread(email) {
    OPEN = email; THREAD = null; renderList(); renderMain();
    return api('/api/admin/messages?email=' + encodeURIComponent(email)).then(function (d) {
      THREAD = d.thread; TOPICS = d.topics || TOPICS;
      if (INDEX[email]) INDEX[email].unreadAdmin = 0;
      renderList(); renderMain();
    }).catch(function (e) { toast(e.message, true); });
  }
  function send() {
    if (BUSY) return;
    var ta = $('mg-text'); if (!ta) return;
    var text = ta.value.trim();
    var to = OPEN === '__new' ? low(($('mg-to') || {}).value) : OPEN;
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Pick a member email first', true); return; }
    if (!text) { toast('Write a message first', true); return; }
    PREFS = { popup: !!($('mg-pop') || {}).checked, emailCopy: !!($('mg-mail') || {}).checked };
    try { localStorage.setItem('fsdx_msg_prefs', JSON.stringify(PREFS)); } catch (e) {}
    var p = people()[to] || {};
    var tplId = ($('mg-tpl') || {}).value || LAST_TPL || '';
    BUSY = true; renderMainKeep();
    api('/api/admin/messages', { email: to, name: p.name || '', text: text, popup: PREFS.popup, emailCopy: PREFS.emailCopy, template: tplId })
      .then(function (d) {
        BUSY = false; LAST_TPL = ''; delete DRAFT[to]; delete DRAFT.__new;
        THREAD = d.thread; OPEN = to;
        return loadIndex().then(function () { renderList(); renderMain(); toast(d.emailed === false ? 'Sent — but the email heads-up failed' : 'Sent' + (PREFS.emailCopy ? ' + emailed' : ''), d.emailed === false); });
      })
      .catch(function (e) { BUSY = false; renderMainKeep(); toast(e.message, true); });
  }
  /** Re-render the main pane without losing what's typed. */
  function renderMainKeep() {
    var ta = $('mg-text'); if (ta) DRAFT[OPEN] = ta.value;
    var to = $('mg-to') ? $('mg-to').value : null;
    renderMain();
    if (to !== null && $('mg-to')) $('mg-to').value = to;
  }
  function setStatus(status) {
    api('/api/admin/messages/status', { email: OPEN, status: status }).then(function (d) {
      THREAD = d.thread; if (INDEX[OPEN]) INDEX[OPEN].status = status; renderList(); renderMain();
      toast(status === 'closed' ? 'Marked done' : 'Reopened');
    }).catch(function (e) { toast(e.message, true); });
  }

  window.messagesRender = function () {
    skeleton(); renderList(); renderMain();
    loadIndex().then(function () { if (OPEN && OPEN !== '__new') openThread(OPEN); });
  };
  /** From People: open (or start) a thread with this member. */
  window.messagesOpen = function (email) {
    email = low(email); if (!email) return;
    if (typeof switchTab === 'function') switchTab('messages');
    skeleton();
    openThread(email);
  };

  document.addEventListener('click', function (e) {
    var p = $('panel-messages'); if (!p || !p.contains(e.target)) return;
    var t = e.target;
    var f = t.closest('[data-mgf]'); if (f) { FILTER = f.getAttribute('data-mgf'); renderList(); return; }
    var o = t.closest('[data-mgo]'); if (o) { renderMainKeep(); openThread(o.getAttribute('data-mgo')); return; }
    var b = t.closest('[data-mg]'); if (!b) return;
    var a = b.getAttribute('data-mg');
    if (a === 'new') { renderMainKeep(); OPEN = '__new'; THREAD = null; renderList(); renderMain(); return; }
    if (a === 'refresh') { loadIndex().then(function () { if (OPEN && OPEN !== '__new') openThread(OPEN); }); return; }
    if (a === 'send') return send();
    if (a === 'close') return setStatus('closed');
    if (a === 'reopen') return setStatus('open');
    if (a === 'person' && window.peopleOpen) return window.peopleOpen(OPEN);
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || t.id !== 'mg-tpl' || !t.value) return;
    var tpl = TEMPLATES.filter(function (x) { return x.id === t.value; })[0]; if (!tpl) return;
    var ta = $('mg-text'); if (!ta) return;
    var to = OPEN === '__new' ? low(($('mg-to') || {}).value) : OPEN;
    var text = tpl.text.replace(/\{first\}/g, firstName(to));
    if (ta.value.trim() && !window.confirm('Replace what you\'ve typed with the "' + tpl.label + '" template?')) { t.value = ''; return; }
    ta.value = text; ta.focus(); LAST_TPL = tpl.id;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target && e.target.id === 'mg-text') { e.preventDefault(); send(); }
  });

  // Nav count + open from the email link (admin.html#messages).
  function boot() {
    if (!tok()) return;
    loadIndex();
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      loadIndex().then(function () {
        // Pull new replies into the open thread, but never while you're typing.
        var p = $('panel-messages'), ta = $('mg-text');
        var active = p && p.classList.contains('active') && OPEN && OPEN !== '__new';
        if (active && !BUSY && (!ta || !ta.value.trim()) && INDEX[OPEN] && INDEX[OPEN].unreadAdmin > 0) openThread(OPEN);
      });
    }, 60000);
    if (location.hash === '#messages') setTimeout(function () { try { switchTab('messages'); } catch (e) {} }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
