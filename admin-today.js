/* ==========================================================================
   admin-today.js — Admin → Today and Admin → Alerts
   Today:  everything that needs you + everything that happened, one screen.
   Alerts: pick which events email you instantly, go in the summary, or stay off.

   Data comes from the worker (Whop webhooks → event log), so it is complete
   even when this page was closed. The page just reads it.
   Needs admin-nt.js loaded first (shared NinjaTrader task list + styles).
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var EV = null, PREFS = null, FEED = 'all';

  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + tok() }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status)); return d;
      });
    });
  }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2600);
  }
  function ctDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d || new Date()); }
  function when(iso) {
    var d = new Date(iso), today = ctDay(), day = ctDay(d);
    var t = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    if (day === today) return t;
    var y = ctDay(new Date(Date.now() - 864e5));
    if (day === y) return 'Yesterday ' + t;
    return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }) + ' ' + t;
  }
  function agoTxt(iso) {
    if (!iso) return 'never';
    var m = (Date.now() - new Date(iso).getTime()) / 6e4;
    if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + ' min ago';
    if (m < 2880) return Math.round(m / 60) + 'h ago'; return Math.round(m / 1440) + 'd ago';
  }

  var META = {
    member_joined:   { l: 'New member',          i: '+', c: 'new',  g: 'members' },
    trial_started:   { l: 'Trial started',       i: '+', c: 'new',  g: 'members' },
    trial_ending:    { l: 'Trial ending soon',   i: '⏳', c: 'can', g: 'members' },
    payment:         { l: 'Payment',             i: '$', c: 'pay',  g: 'money' },
    payment_failed:  { l: 'Payment failed',      i: '!', c: 'fail', g: 'money' },
    past_due:        { l: 'Past due',            i: '!', c: 'fail', g: 'money' },
    cancel_scheduled:{ l: 'Cancel scheduled',    i: '↓', c: 'can',  g: 'members' },
    cancel_reverted: { l: 'Cancel reversed',     i: '↑', c: 'pay',  g: 'members' },
    access_lost:     { l: 'Membership ended',    i: '×', c: 'fail', g: 'members' },
    refund:          { l: 'Refund',              i: '↩', c: 'fail', g: 'money' },
    dispute:         { l: 'Dispute',             i: '⚠', c: 'fail', g: 'money' },
    nt_task:         { l: 'NinjaTrader task',    i: 'N', c: 'nt',   g: 'nt' },
    nt_download:     { l: 'Downloaded',          i: '⬇', c: 'nt',   g: 'nt' },
    task_overdue:    { l: 'Task overdue',        i: '⏰', c: 'fail', g: 'nt' },
  };

  var CSS = ''
    + '#panel-today .td-ev{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}'
    + '#panel-today .td-ev:first-child{border-top:0}'
    + '#panel-today .td-ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;flex-shrink:0}'
    + '#panel-today .c-pay{background:rgba(47,191,126,.12);color:#2FBF7E}#panel-today .c-fail{background:rgba(226,83,75,.14);color:#E2534B}'
    + '#panel-today .c-new{background:rgba(127,178,255,.12);color:#7FB2FF}#panel-today .c-can{background:rgba(245,165,36,.12);color:#F5A524}'
    + '#panel-today .c-nt{background:rgba(255,107,31,.14);color:#FF6B1F}'
    + '#panel-today .td-t{flex:1;min-width:0;font-size:12.5px;color:#a1a1aa}#panel-today .td-t b{color:#fff}'
    + '#panel-today .td-w{font-size:10.5px;color:#52525b;white-space:nowrap}'
    + '#panel-today .td-nt{display:inline-block;font-size:8.5px;font-weight:900;letter-spacing:.1em;padding:2px 6px;border-radius:5px;border:1px solid rgba(255,107,31,.45);color:#FF6B1F;background:rgba(255,107,31,.08);margin-left:4px;vertical-align:1px}'
    + '#panel-today .td-2{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1100px){#panel-today .td-2{grid-template-columns:1.15fr 1fr}}'
    + '#panel-today .td-health{font-size:11px;color:#71717a;display:flex;gap:6px;align-items:center}'
    + '#panel-today .td-dot{width:7px;height:7px;border-radius:50%;background:#52525b;display:inline-block}'
    + '#panel-today .td-dot.ok{background:#2FBF7E}#panel-today .td-dot.bad{background:#E2534B}'
    + '#panel-alerts .al-seg{display:inline-flex;border:1px solid rgba(255,255,255,.12);border-radius:8px;overflow:hidden}'
    + '#panel-alerts .al-seg button{font-size:10.5px;font-weight:800;padding:6px 10px;color:#71717a;background:transparent;border:0;cursor:pointer}'
    + '#panel-alerts .al-seg button.on{background:rgba(255,107,31,.16);color:#FF8A4C}'
    + '#panel-alerts table{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '#panel-alerts th{text-align:left;font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:900;padding:8px;border-bottom:1px solid rgba(255,255,255,.1)}'
    + '#panel-alerts td{padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.05);color:#d4d4d8}'
    + '#panel-alerts .ntx-card{border:1px solid rgba(255,255,255,.10);background:rgba(9,9,11,.4);border-radius:16px;padding:18px}'
    + '#panel-alerts .ntx-in{background:#05080D;border:1px solid rgba(120,160,210,.18);border-radius:9px;padding:8px 11px;color:#E6EAF0;font-size:12px;outline:none}'
    + '#panel-alerts .ntx-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);background:#18181b;color:#d4d4d8;font-size:11px;font-weight:800;border-radius:9px;padding:7px 12px;cursor:pointer}'
    + '#panel-alerts .ntx-btn.pri{background:linear-gradient(135deg,#FF9247,#FF6B1F 52%,#EB550D);color:#0B1119;border:0}'
    + '#panel-alerts .ntx-sw{position:relative;width:38px;height:21px;border-radius:999px;background:#27272a;border:1px solid rgba(255,255,255,.12);cursor:pointer;flex-shrink:0;display:inline-block;vertical-align:middle}'
    + '#panel-alerts .ntx-sw:after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#71717a;transition:all .15s}'
    + '#panel-alerts .ntx-sw.on{background:rgba(47,191,126,.25);border-color:rgba(47,191,126,.5)}#panel-alerts .ntx-sw.on:after{left:19px;background:#2FBF7E}'
    + '#panel-alerts .ntx-sw.vac.on{background:rgba(255,107,31,.25);border-color:rgba(255,107,31,.5)}#panel-alerts .ntx-sw.vac.on:after{background:#FF6B1F}';

  /* ── Skeletons ─────────────────────────────────────────────────────── */
  function skeleton() {
    var p = $('panel-today');
    if (p && !p.getAttribute('data-ready')) {
      p.setAttribute('data-ready', '1');
      var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      p.innerHTML = ''
        + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
        +   '<div><h2 class="text-lg font-black text-white">Today</h2>'
        +   '<div id="td-health" class="td-health mt-1"><span class="td-dot"></span> Checking Whop connection…</div></div>'
        +   '<div class="flex items-center gap-2 flex-wrap">'
        +     '<button class="ntx-btn" onclick="todayReconcile()" title="Compare Whop with the NinjaTrader register now">Check Whop now</button>'
        +     '<button class="ntx-btn" onclick="todayDigest()">Email me a summary</button>'
        +     '<button class="ntx-btn" onclick="todayLoad()">Refresh</button>'
        +   '</div>'
        + '</div>'
        + '<div id="td-stats" class="ntx-grid mb-5"></div>'
        + '<div class="td-2">'
        +   '<div class="ntx-card"><div class="flex items-center justify-between flex-wrap gap-2"><div class="ntx-h">To do</div>'
        +     '<div class="text-[10px] text-zinc-600">oldest first · orange 12h+ · red 24h+</div></div>'
        +     '<div id="td-tasks" class="text-xs text-zinc-600 mt-2">Loading…</div></div>'
        +   '<div class="ntx-card"><div class="flex items-center justify-between flex-wrap gap-2 mb-1"><div class="ntx-h">What happened</div>'
        +     '<div class="flex gap-1 flex-wrap" id="td-chips"></div></div>'
        +     '<div id="td-feed" class="text-xs text-zinc-600">Loading…</div></div>'
        + '</div>';

    }
    var a = $('panel-alerts');
    if (a && !a.getAttribute('data-ready')) {
      a.setAttribute('data-ready', '1');
      a.innerHTML = ''
        + '<div class="mb-5"><h2 class="text-lg font-black text-white">Alerts</h2>'
        + '<div class="text-[11px] text-zinc-600 mt-0.5">Pick what reaches your inbox. Everything is logged in Today either way. Works with the admin closed.</div></div>'
        + '<div id="al-body" class="text-xs text-zinc-600">Loading…</div>';
    }
  }

  /* ── Today ─────────────────────────────────────────────────────────── */
  function renderHealth() {
    var h = $('td-health'); if (!h || !EV) return;
    if (!EV.secretSet) { h.innerHTML = '<span class="td-dot bad"></span> Whop webhook not connected yet. Add WHOP_WEBHOOK_SECRET to the worker.'; return; }
    if (!EV.webhook) { h.innerHTML = '<span class="td-dot"></span> Webhook ready. Waiting for the first Whop event.'; return; }
    var rc = EV.reconcile ? ' · daily Whop check ' + agoTxt(EV.reconcile.at) : '';
    h.innerHTML = '<span class="td-dot ok"></span> Whop connected · last event ' + agoTxt(EV.webhook.lastAt) + rc;
  }

  function renderStats() {
    var evs = (EV && EV.events) || [], nt = window.ntData && window.ntData();
    var today = ctDay(), weekAgo = Date.now() - 7 * 864e5;
    var isToday = function (e) { return ctDay(new Date(e.at)) === today; };
    var inWeek = function (e) { return new Date(e.at).getTime() > weekAgo; };
    var tasks = nt ? nt.records.filter(function (r) { return r.status === 'pending' || r.status === 'remove'; }) : [];
    var late = tasks.filter(function (r) { return Date.now() - new Date(r.requestedAt || r.createdAt) > 864e5; }).length;
    var money = evs.filter(function (e) { return e.type === 'payment' && isToday(e); }).reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var fails = evs.filter(function (e) { return (e.type === 'payment_failed' || e.type === 'past_due') && inWeek(e); }).length;
    var joins = evs.filter(function (e) { return (e.type === 'member_joined' || e.type === 'trial_started') && isToday(e); }).length;
    var cancels = evs.filter(function (e) { return e.type === 'cancel_scheduled' && inWeek(e); }).length;
    function card(n, l, cls) { return '<div class="ntx-stat ' + (cls || '') + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    $('td-stats').innerHTML =
        card(tasks.length, late ? 'To do · ' + late + ' overdue' : 'To do', late ? 'red' : (tasks.length ? 'amber' : ''))
      + card(fails, 'Failed / past due · 7d', fails ? 'red' : '')
      + card('$' + money.toFixed(0), 'Collected today', 'green')
      + card(joins, 'New today')
      + card(cancels, 'Cancels scheduled · 7d', cancels ? 'amber' : '');
  }

  function renderTasks() {
    var nt = window.ntData && window.ntData();
    $('td-tasks').innerHTML = nt && window.ntTasksHtml ? window.ntTasksHtml(nt) : 'Loading…';
  }

  function renderFeed() {
    var chips = [['all', 'All'], ['money', 'Money'], ['members', 'Members'], ['nt', 'NinjaTrader']];
    $('td-chips').innerHTML = chips.map(function (c) {
      return '<button class="ntx-chip' + (FEED === c[0] ? ' on' : '') + '" data-feed="' + c[0] + '">' + c[1] + '</button>';
    }).join('');
    var evs = ((EV && EV.events) || []).filter(function (e) {
      if (FEED === 'all') return true;
      if (FEED === 'nt') return e.nt || (META[e.type] || {}).g === 'nt';
      return (META[e.type] || {}).g === FEED;
    });
    if (!evs.length) { $('td-feed').innerHTML = '<div class="text-[12px] text-zinc-500 py-3">Nothing yet. Events show up here as Whop sends them.</div>'; return; }
    $('td-feed').innerHTML = evs.slice(0, 80).map(function (e) {
      var m = META[e.type] || { l: e.type, i: '•', c: 'new' };
      var amt = e.amount != null ? ' · $' + Number(e.amount).toFixed(2) : '';
      return '<div class="td-ev"><div class="td-ic c-' + m.c + '">' + m.i + '</div>'
        + '<div class="td-t"><b>' + esc(m.l) + '</b> · ' + esc(e.name || e.email || '—') + (e.nt ? '<span class="td-nt">NT</span>' : '')
        + '<div class="text-[11.5px] text-zinc-500">' + esc([e.product, e.detail].filter(Boolean).join(' · ')) + amt + '</div></div>'
        + '<div class="td-w">' + when(e.at) + '</div></div>';
    }).join('');
  }

  window.todayLoad = function () {
    skeleton();
    var p1 = api('/api/admin/events?limit=150').then(function (d) { EV = d; }).catch(function (e) {
      $('td-feed').innerHTML = '<div class="text-red-400 text-[12px]">Couldn\'t load events: ' + esc(e.message) + '. Deploy nexus-events.js.</div>';
    });
    var p2 = window.ntLoad ? window.ntLoad() : Promise.resolve();
    return Promise.all([p1, p2]).then(function () { renderHealth(); renderStats(); renderTasks(); renderFeed(); });
  };
  window.todayReconcile = function () {
    toast('Checking Whop…');
    post('/api/admin/reconcile').then(function (d) {
      toast('Whop check: ' + d.added + ' to add, ' + d.removed + ' to remove');
      todayLoad();
    }).catch(function (e) { toast(e.message, true); });
  };
  window.todayDigest = function () {
    post('/api/admin/alerts/digest').then(function (d) { toast(d.sent ? 'Summary sent' : 'Nothing sent'); }).catch(function (e) { toast(e.message, true); });
  };

  /* ── Alerts ────────────────────────────────────────────────────────── */
  function renderAlerts(d) {
    PREFS = d.prefs;
    var rows = d.types.map(function (t) {
      var ev = PREFS.events[t.key] || { mode: 'off' };
      var seg = ['instant', 'digest', 'off'].map(function (m) {
        return '<button class="' + (ev.mode === m ? 'on' : '') + '" data-ev="' + t.key + '" data-mode="' + m + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>';
      }).join('');
      return '<tr><td><b class="text-white">' + esc(t.label) + '</b></td>'
        + '<td>' + (t.ntOpt ? '<span class="ntx-sw' + (ev.ntOnly ? ' on' : '') + '" data-nt="' + t.key + '" title="Only email this for NinjaTrader members"></span>' : '<span class="text-zinc-600">—</span>') + '</td>'
        + '<td><div class="al-seg">' + seg + '</div></td></tr>';
    }).join('');
    var times = PREFS.digestTimes || ['07:30', '18:00'];
    $('al-body').innerHTML = ''
      + '<div class="ntx-card mb-4"><div class="flex flex-wrap gap-4 items-center">'
      +   '<div style="flex:1 1 260px"><div class="text-[11px] text-zinc-500 mb-1">Send alerts to</div>'
      +     '<div class="flex gap-2"><input id="al-to" class="ntx-in" style="flex:1" value="' + esc(PREFS.to || '') + '" placeholder="' + esc(d.to) + '">'
      +     '<button class="ntx-btn" onclick="alSaveTo()">Save</button><button class="ntx-btn" onclick="alTest()">Send test</button></div></div>'
      +   '<div class="flex items-center gap-3"><span class="ntx-sw vac' + (PREFS.vacation ? ' on' : '') + '" id="al-vac"></span>'
      +     '<div><div class="text-[12px] text-white font-bold">Vacation mode</div><div class="text-[11px] text-zinc-500">Everything not Off is emailed instantly</div></div></div>'
      + '</div></div>'
      + '<div class="ntx-card mb-4"><table><tr><th>Event</th><th>Only NT members</th><th>Delivery</th></tr>' + rows + '</table></div>'
      + '<div class="ntx-card"><div class="flex flex-wrap gap-4 items-center">'
      +   '<div class="text-[12px] text-white font-bold">Summary emails (CT)</div>'
      +   '<input id="al-t1" type="time" class="ntx-in" value="' + esc(times[0] || '') + '">'
      +   '<input id="al-t2" type="time" class="ntx-in" value="' + esc(times[1] || '') + '">'
      +   '<label class="text-[11px] text-zinc-400 flex items-center gap-2"><span class="ntx-sw' + (PREFS.skipEmptyDigest ? ' on' : '') + '" id="al-skip"></span> Skip when nothing happened</label>'
      +   '<button class="ntx-btn pri" onclick="alSaveTimes()">Save times</button>'
      + '</div><div class="text-[11px] text-zinc-600 mt-2">The summary lists open tasks plus everything set to Digest since the last one. Leave a time blank to drop it.</div></div>';
    $('al-vac').onclick = function () { save({ vacation: !PREFS.vacation }, PREFS.vacation ? 'Vacation mode off' : 'Vacation mode on'); };
    $('al-skip').onclick = function () { save({ skipEmptyDigest: !PREFS.skipEmptyDigest }); };
  }
  function save(body, msg) {
    return post('/api/admin/alerts', body).then(function (d) { toast(msg || 'Saved'); renderAlerts({ prefs: d.prefs, to: d.to, types: TYPES }); })
      .catch(function (e) { toast(e.message, true); });
  }
  var TYPES = [];
  window.alertsLoad = function () {
    skeleton();
    return api('/api/admin/alerts').then(function (d) { TYPES = d.types; renderAlerts(d); })
      .catch(function (e) { $('al-body').innerHTML = '<div class="text-red-400 text-[12px]">Couldn\'t load: ' + esc(e.message) + '</div>'; });
  };
  window.alSaveTo = function () { save({ to: $('al-to').value.trim() }); };
  window.alTest = function () { post('/api/admin/alerts/test').then(function (d) { toast(d.success ? 'Test sent to ' + d.to : 'Send failed', !d.success); }).catch(function (e) { toast(e.message, true); }); };
  window.alSaveTimes = function () { save({ digestTimes: [$('al-t1').value, $('al-t2').value].filter(Boolean) }); };

  document.addEventListener('click', function (e) {
    var t = e.target;
    var f = t.closest && t.closest('[data-feed]');
    if (f && $('panel-today').contains(f)) { FEED = f.getAttribute('data-feed'); renderFeed(); return; }
    var seg = t.closest && t.closest('[data-mode]');
    if (seg && $('panel-alerts').contains(seg)) {
      var ev = {}; ev[seg.getAttribute('data-ev')] = { mode: seg.getAttribute('data-mode') };
      save({ events: ev }); return;
    }
    var sw = t.closest && t.closest('[data-nt]');
    if (sw && $('panel-alerts').contains(sw)) {
      var k = sw.getAttribute('data-nt'), ev2 = {};
      ev2[k] = { ntOnly: !(PREFS.events[k] && PREFS.events[k].ntOnly) };
      save({ events: ev2 });
    }
  });

  // Keep Today fresh while the admin sits open (same 2-minute rhythm as NT).
  setInterval(function () {
    var p = $('panel-today');
    if (tok() && p && p.classList.contains('active')) todayLoad();
  }, 120000);

  document.addEventListener('DOMContentLoaded', function () {
    skeleton();
    setTimeout(function () { var p = $('panel-today'); if (tok() && p && p.classList.contains('active')) todayLoad(); }, 600);
  });
})();
