/* ==========================================================================
   admin-bookings.js — Admin → Calls
   Cal.com bookings (webhook → worker → here). Shows upcoming calls by day,
   what each person wants to talk about, and whether they're a member
   (matched by booking email or the Whop email they typed in the form).
   Also: nav badge for today's calls, pop-ups for new bookings, a reminder
   15 minutes before a call, and window.calFor(email) for the People panel.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var CAL_APP = 'https://app.cal.com/bookings/upcoming';
  var B = [], CONF = { webhook: true, api: false }, VIEW = 'upcoming', LOADED = false, NOTE_OPEN = null;
  var TZ = 'America/Chicago';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function low(s) { return String(s || '').trim().toLowerCase(); }
  function toast(m, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = m; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2400);
  }
  function api(path, body) {
    return fetch(API + path, body ? {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    } : { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || d.error) throw new Error(d.error || 'Request failed'); return d; }); });
  }

  /* ── Time helpers (all display in Central) ────────────────────────────── */
  function dayKey(iso, tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || TZ }).format(new Date(iso)); }
  function todayKey() { return dayKey(new Date().toISOString()); }
  function addDays(k, n) { var d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function tm(iso, tz) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz || TZ, hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(k) {
    var t = todayKey();
    var nice = new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
    return k === t ? 'Today · ' + nice : k === addDays(t, 1) ? 'Tomorrow · ' + nice : k === addDays(t, -1) ? 'Yesterday · ' + nice : nice;
  }
  function until(iso) {
    var m = Math.round((Date.parse(iso) - Date.now()) / 60000);
    if (m < -5) return '';
    if (m <= 0) return 'now';
    if (m < 60) return 'in ' + m + 'm';
    var h = Math.round(m / 60); if (h < 36) return 'in ' + h + 'h';
    return 'in ' + Math.round(h / 24) + 'd';
  }

  /* ── Matching ─────────────────────────────────────────────────────────── */
  function kind(b) {
    var s = low(b.event || b.title);
    if (/setup/.test(s)) return { l: 'Setup Call', c: 'p-nt' };
    if (/walk/.test(s)) return { l: 'Walkthrough', c: 'p-pur' };
    if (/question/.test(s)) return { l: 'Quick Questions', c: 'p-blu' };
    return { l: b.title || b.event || 'Call', c: 'p-mut' };
  }
  function member(b) {
    if (!window.peopleLookup) return null;
    return window.peopleLookup(b.whopEmail) || window.peopleLookup(b.email) || null;
  }
  function isPast(b) { return Date.parse(b.end || b.start) < Date.now(); }
  function live(b) { return b.status === 'booked'; }

  window.calFor = function (email) {
    var e = low(email); if (!e) return [];
    return B.filter(function (b) { return low(b.email) === e || low(b.whopEmail) === e; })
      .sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
  };

  /* ── Styles + skeleton ────────────────────────────────────────────────── */
  var CSS = ''
    + '#panel-calls .mn-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:5px;border:1px solid;white-space:nowrap}'
    + '#panel-calls .p-red{color:#E2534B;border-color:rgba(226,83,75,.45);background:rgba(226,83,75,.08)}'
    + '#panel-calls .p-amb{color:#F5A524;border-color:rgba(245,165,36,.45);background:rgba(245,165,36,.08)}'
    + '#panel-calls .p-grn{color:#2FBF7E;border-color:rgba(47,191,126,.4);background:rgba(47,191,126,.07)}'
    + '#panel-calls .p-blu{color:#7FB2FF;border-color:rgba(127,178,255,.4);background:rgba(127,178,255,.07)}'
    + '#panel-calls .p-pur{color:#C4A5FF;border-color:rgba(196,165,255,.4);background:rgba(196,165,255,.07)}'
    + '#panel-calls .p-mut{color:#8A97A8;border-color:#253244}'
    + '#panel-calls .p-nt{color:#FF6B1F;border-color:rgba(255,107,31,.45);background:rgba(255,107,31,.08)}'
    + '#panel-calls .cl-day{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#71717a;margin:18px 2px 8px}'
    + '#panel-calls .cl-day.today{color:#FF8A4C}'
    + '#panel-calls .cl-card{border:1px solid rgba(255,255,255,.08);background:rgba(9,9,11,.4);border-radius:14px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:92px minmax(0,1fr);gap:14px}'
    + '#panel-calls .cl-card.off{opacity:.55}'
    + '#panel-calls .cl-card.soon{border-color:rgba(255,107,31,.55);box-shadow:0 0 0 1px rgba(255,107,31,.15)}'
    + '#panel-calls .cl-time{font-size:15px;font-weight:900;color:#fff;line-height:1.2}'
    + '#panel-calls .cl-sub{font-size:11px;color:#71717a}'
    + '#panel-calls .cl-name{font-size:14px;font-weight:800;color:#fff}'
    + '#panel-calls .cl-topic{margin-top:8px;font-size:12.5px;color:#e4e4e7;background:rgba(255,255,255,.03);border-left:2px solid #FF6B1F;padding:7px 10px;border-radius:0 8px 8px 0;white-space:pre-wrap}'
    + '#panel-calls .cl-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 14px;margin-top:8px}'
    + '#panel-calls .cl-kv .k{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:900;color:#52525b}'
    + '#panel-calls .cl-kv .v{font-size:12px;color:#d4d4d8;word-break:break-word}'
    + '#panel-calls .cl-copy{cursor:pointer;border-bottom:1px dashed rgba(255,255,255,.2)}#panel-calls .cl-copy:hover{color:#FF6B1F}'
    + '#panel-calls .cl-my{margin-top:8px;font-size:12px;color:#a1a1aa}'
    + '@media(max-width:640px){#panel-calls .cl-card{grid-template-columns:1fr;gap:6px}}';

  function skeleton() {
    var p = $('panel-calls'); if (!p || p.getAttribute('data-ready')) return;
    p.setAttribute('data-ready', '1');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    p.innerHTML = ''
      + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
      +   '<div><h2 class="text-lg font-black text-white">Calls</h2>'
      +   '<div class="text-[11px] text-zinc-600 mt-0.5">Cal.com bookings · times in Central · matched to members by email</div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap">'
      +     '<button class="ntx-btn" data-cl="refresh">&#10227; Refresh</button>'
      +     '<button class="ntx-btn" data-cl="pull" id="cl-pull" style="display:none">Pull from Cal.com</button>'
      +     '<a class="ntx-btn" href="' + CAL_APP + '" target="_blank" rel="noopener">Open Cal.com ↗</a>'
      +   '</div></div>'
      + '<div id="cl-setup"></div>'
      + '<div id="cl-stats" class="ntx-grid mb-4"></div>'
      + '<div class="ntx-card mb-2"><div class="flex gap-1 flex-wrap items-center" id="cl-chips"></div></div>'
      + '<div id="cl-list"></div>';
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  var VIEWS = [
    ['upcoming', 'Upcoming', function (b) { return live(b) && !isPast(b); }],
    ['today', 'Today', function (b) { return b.status !== 'rescheduled' && dayKey(b.start) === todayKey(); }],
    ['past', 'Past', function (b) { return live(b) && isPast(b); }],
    ['cancelled', 'Cancelled', function (b) { return b.status === 'cancelled'; }],
    ['all', 'All', function () { return true; }],
  ];
  function viewFn() { for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i][0] === VIEW) return VIEWS[i][2]; return VIEWS[0][2]; }

  function renderSetup() {
    var el = $('cl-setup'); if (!el) return;
    $('cl-pull').style.display = CONF.api ? '' : 'none';
    if (CONF.webhook) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="ntx-card mb-4" style="border-color:rgba(245,165,36,.4)">'
      + '<div class="text-[13px] font-black text-white mb-2">Connect Cal.com (one time)</div>'
      + '<div class="text-[12px] text-zinc-400" style="line-height:1.7">'
      + '1. Cloudflare → worker → Settings → Variables: add secret <b class="text-white">CAL_WEBHOOK_SECRET</b> (any long random string).<br>'
      + '2. Cal.com → Settings → Developer → Webhooks → New. Subscriber URL: <span class="cl-copy text-white" data-ccopy="' + API + '/api/cal/webhook">' + API + '/api/cal/webhook</span><br>'
      + '3. Same secret in the Cal.com "Secret" box. Triggers: Booking Created, Rescheduled, Cancelled. Save + Ping test.<br>'
      + '4. Optional, for bookings made before today: Cal.com → API keys → New, add it to the worker as <b class="text-white">CAL_API_KEY</b>, then press "Pull from Cal.com".'
      + '</div></div>';
  }

  function renderStats() {
    var t = todayKey(), wk = addDays(t, 7);
    var up = B.filter(function (b) { return live(b) && !isPast(b); });
    var today = up.filter(function (b) { return dayKey(b.start) === t; }).length;
    var week = up.filter(function (b) { return dayKey(b.start) <= wk; }).length;
    var mem = up.filter(function (b) { var m = member(b); return m && m.live; }).length;
    var canc = B.filter(function (b) { return b.status === 'cancelled' && Date.parse(b.updatedAt || b.start) > Date.now() - 30 * 864e5; }).length;
    function card(n, l, cls, v) { return '<div class="ntx-stat ' + (cls || '') + '" data-cview="' + v + '" style="cursor:pointer"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    $('cl-stats').innerHTML = card(today, 'Calls today', today ? 'amber' : '', 'today') + card(week, 'Next 7 days', '', 'upcoming')
      + card(mem + ' / ' + up.length, 'Upcoming · members', 'green', 'upcoming') + card(canc, 'Cancelled · 30d', canc ? 'red' : '', 'cancelled');
  }

  function renderChips() {
    $('cl-chips').innerHTML = VIEWS.map(function (v) {
      var n = B.filter(v[2]).length;
      return '<button class="ntx-chip' + (VIEW === v[0] ? ' on' : '') + '" data-cview="' + v[0] + '">' + v[1] + ' <span class="text-zinc-600">' + n + '</span></button>';
    }).join('');
  }

  function copy(v) { return v ? '<span class="cl-copy" data-ccopy="' + esc(v) + '">' + esc(v) + '</span>' : ''; }

  function cardHtml(b) {
    var k = kind(b), m = member(b), past = isPast(b);
    var soon = live(b) && !past && Date.parse(b.start) - Date.now() < 60 * 60000;
    var st = b.status === 'cancelled' ? '<span class="mn-pill p-red">Cancelled</span>'
      : b.status === 'rescheduled' ? '<span class="mn-pill p-mut">Rescheduled</span>'
      : b.outcome === 'done' ? '<span class="mn-pill p-grn">Done</span>'
      : b.outcome === 'noshow' ? '<span class="mn-pill p-red">No-show</span>' : '';
    var mp = m ? '<span class="mn-pill ' + m.cls + '" title="' + esc(m.product || '') + '">' + esc(m.label) + '</span>'
      : '<span class="mn-pill p-mut">Not a member</span>';
    var theirs = b.tz && b.tz !== TZ ? '<div class="cl-sub" title="' + esc(b.tz) + '">' + esc(tm(b.start, b.tz)) + ' their time</div>' : '';
    var shown = /discord|whop|member|sign.?up|account|product|which|platform|notes|help|about|question|topic|goal|why/i;
    // Hide answers already shown above, Cal's internal fields, and repeats of their email.
    var rest = (b.answers || []).filter(function (a) {
      if (shown.test(a.key) || shown.test(a.label) || /^display|^attendee|^rescheduled/i.test(a.key)) return false;
      if (low(a.value) === low(b.email) || low(a.value) === low(b.whopEmail)) return false;
      return true;
    });
    var kv = function (l, v) { return v ? '<div><div class="k">' + l + '</div><div class="v">' + v + '</div></div>' : ''; };
    var wEmail = b.whopEmail && low(b.whopEmail) !== low(b.email) ? b.whopEmail : '';
    var noteOpen = NOTE_OPEN === b.uid;
    return '<div class="cl-card' + (b.status !== 'booked' ? ' off' : '') + (soon ? ' soon' : '') + '">'
      + '<div><div class="cl-time">' + esc(tm(b.start)) + '</div><div class="cl-sub">' + (b.length ? b.length + ' min' : '') + '</div>' + theirs
      +   (live(b) && !past ? '<div class="cl-sub" style="color:#FF8A4C;font-weight:800;margin-top:2px">' + until(b.start) + '</div>' : '') + '</div>'
      + '<div style="min-width:0">'
      +   '<div class="flex items-center gap-2 flex-wrap"><span class="cl-name">' + esc(b.name || b.email || 'Unknown') + '</span>'
      +     '<span class="mn-pill ' + k.c + '">' + esc(k.l) + '</span>' + mp + st + '</div>'
      +   '<div class="cl-kv">'
      +     kv('Email', copy(b.email)) + kv('Whop email', copy(wEmail)) + kv('Discord', copy(b.discord)) + kv('Product', esc(b.product))
      +     (m ? kv('Member', esc((m.product || '') + (m.daysIn != null ? ' · ' + m.daysIn + 'd in' : ''))) : '')
      +     rest.map(function (a) { return kv(esc(a.label), esc(a.value)); }).join('')
      +   '</div>'
      +   (b.topic ? '<div class="cl-topic"><span class="cl-sub" style="display:block;margin-bottom:2px">Wants help with</span>' + esc(b.topic) + '</div>' : '')
      +   (b.cancelReason ? '<div class="cl-sub mt-2">Cancel reason: ' + esc(b.cancelReason) + '</div>' : '')
      +   (b.myNote && !noteOpen ? '<div class="cl-my">📝 ' + esc(b.myNote) + '</div>' : '')
      +   (noteOpen ? '<textarea id="cl-note-in" class="ntx-in" rows="2" style="width:100%;margin-top:8px" placeholder="Your notes on this call">' + esc(b.myNote || '') + '</textarea>' : '')
      +   '<div class="flex gap-2 flex-wrap mt-3">'
      +     (b.meetUrl && live(b) ? '<a class="ntx-btn" href="' + esc(b.meetUrl) + '" target="_blank" rel="noopener" style="border-color:rgba(255,107,31,.6);color:#FF8A4C">Join ↗</a>' : '')
      +     (m ? '<button class="ntx-btn" data-cl="person" data-uid="' + esc(b.uid) + '">Open in People</button>' : '')
      +     (live(b) ? '<button class="ntx-btn" data-cl="done" data-uid="' + esc(b.uid) + '">' + (b.outcome === 'done' ? 'Undo done' : 'Done') + '</button>'
      +       '<button class="ntx-btn" data-cl="noshow" data-uid="' + esc(b.uid) + '">' + (b.outcome === 'noshow' ? 'Undo no-show' : 'No-show') + '</button>' : '')
      +     (noteOpen ? '<button class="ntx-btn" data-cl="savenote" data-uid="' + esc(b.uid) + '">Save note</button>'
      :       '<button class="ntx-btn" data-cl="note" data-uid="' + esc(b.uid) + '">' + (b.myNote ? 'Edit note' : 'Add note') + '</button>')
      +   '</div>'
      + '</div></div>';
  }

  function renderList() {
    var list = B.filter(viewFn());
    var desc = VIEW === 'past' || VIEW === 'cancelled' || VIEW === 'all';
    list.sort(function (a, b) { return desc ? String(b.start).localeCompare(String(a.start)) : String(a.start).localeCompare(String(b.start)); });
    if (!list.length) {
      $('cl-list').innerHTML = '<div class="ntx-card text-[12px] text-zinc-500">' + (LOADED ? (B.length ? 'Nothing here.' : 'No bookings yet. New ones show up here the moment someone books.') : 'Loading…') + '</div>';
      return;
    }
    var html = '', last = '', t = todayKey();
    list.slice(0, 200).forEach(function (b) {
      var k = dayKey(b.start);
      if (k !== last) { html += '<div class="cl-day' + (k === t ? ' today' : '') + '">' + dayLabel(k) + '</div>'; last = k; }
      html += cardHtml(b);
    });
    $('cl-list').innerHTML = html;
  }

  function badge() {
    var btn = $('tab-calls'); if (!btn) return;
    var n = B.filter(function (b) { return live(b) && !isPast(b) && dayKey(b.start) === todayKey(); }).length;
    var el = $('calls-nav-n');
    if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
  }

  function renderAll() {
    badge();
    if (!$('panel-calls') || !$('panel-calls').getAttribute('data-ready')) return;
    renderSetup(); renderStats(); renderChips(); renderList();
  }

  /* ── Pop-ups ──────────────────────────────────────────────────────────── */
  function popup(title, rows, uid) {
    var wrap = $('act-toasts'); if (!wrap) return;
    var card = document.createElement('div');
    card.className = 'act-toast';
    card.innerHTML = '<div class="act-toast-h"><b>' + esc(title) + '</b><button aria-label="Dismiss" class="act-x">✕</button></div>'
      + rows.map(function (r) { return '<div class="act-row lv-' + (r.lv || 'info') + '"><i></i><div><b>' + esc(r.t) + '</b><span>' + esc(r.s) + '</span></div></div>'; }).join('')
      + '<button class="act-toast-go">Open Calls →</button>';
    card.querySelector('.act-x').onclick = function () { card.remove(); };
    card.querySelector('.act-toast-go').onclick = function () { card.remove(); switchTab('calls'); };
    wrap.appendChild(card);
    setTimeout(function () { card.classList.add('on'); }, 20);
    setTimeout(function () { if (card.isConnected) { card.classList.remove('on'); setTimeout(function () { card.remove(); }, 300); } }, 30000);
  }
  function line(b) { return kind(b).l + ' · ' + new Date(b.start).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT'; }

  function notify() {
    var seen = ls('cal_seen');
    var newest = B.reduce(function (m, b) { return (b.updatedAt || '') > m ? b.updatedAt : m; }, '');
    if (!seen) { if (newest) ls('cal_seen', newest); }   // first run: don't flood with history
    else {
      var fresh = B.filter(function (b) { return (b.updatedAt || '') > seen && b.status !== 'rescheduled'; });
      if (fresh.length) {
        popup(fresh.length === 1 ? 'New on your calendar' : fresh.length + ' calendar changes', fresh.slice(0, 4).map(function (b) {
          var m = member(b);
          return { lv: b.status === 'cancelled' ? 'bad' : 'good',
            t: (b.status === 'cancelled' ? 'Cancelled: ' : 'Booked: ') + (b.name || b.email),
            s: line(b) + ' · ' + (m ? m.label : 'not a member') + (b.topic ? ' · “' + b.topic.slice(0, 60) + '”' : '') };
        }));
        ls('cal_seen', newest);
      }
    }
    // 15-minute heads-up, once per call.
    B.forEach(function (b) {
      if (!live(b)) return;
      var mins = (Date.parse(b.start) - Date.now()) / 60000;
      if (mins > 0 && mins <= 15 && !ls('cal_rem_' + b.uid)) {
        ls('cal_rem_' + b.uid, '1');
        popup('Call in ' + Math.max(1, Math.round(mins)) + ' min', [{ lv: 'warn', t: (b.name || b.email) + ' · ' + kind(b).l, s: (b.topic ? '“' + b.topic.slice(0, 90) + '”' : 'No topic given') + (b.discord ? ' · Discord: ' + b.discord : '') }]);
      }
    });
  }

  /* ── Load + actions ───────────────────────────────────────────────────── */
  function load() {
    if (!tok()) return Promise.resolve();
    return api('/api/admin/bookings').then(function (d) {
      B = d.bookings || []; CONF = d.configured || CONF; LOADED = true;
      renderAll(); notify();
      if (window.peopleRefresh) window.peopleRefresh();
    }).catch(function () { LOADED = true; renderAll(); });
  }
  window.callsRender = function () { skeleton(); renderAll(); return load(); };

  function find(uid) { return B.filter(function (b) { return b.uid === uid; })[0]; }
  function mark(uid, body, msg) {
    return api('/api/admin/bookings/mark', Object.assign({ uid: uid }, body)).then(function (d) {
      var i = B.findIndex(function (b) { return b.uid === uid; }); if (i > -1) B[i] = d.booking;
      NOTE_OPEN = null; renderAll(); toast(msg);
    }).catch(function (e) { toast(e.message, true); });
  }

  document.addEventListener('click', function (e) {
    var p = $('panel-calls'); if (!p || !p.contains(e.target)) return;
    var t = e.target;
    var v = t.closest('[data-cview]'); if (v) { VIEW = v.getAttribute('data-cview'); renderChips(); renderList(); return; }
    var cp = t.closest('[data-ccopy]');
    if (cp) { var val = cp.getAttribute('data-ccopy'); (navigator.clipboard ? navigator.clipboard.writeText(val) : Promise.reject()).then(function () { toast('Copied ' + val); }).catch(function () { window.prompt('Copy:', val); }); return; }
    var a = t.closest('[data-cl]'); if (!a) return;
    var act = a.getAttribute('data-cl'), uid = a.getAttribute('data-uid'), b = uid && find(uid);
    if (act === 'refresh') { toast('Refreshing…'); load().then(function () { toast('Up to date'); }); }
    else if (act === 'pull') { toast('Pulling from Cal.com…'); api('/api/admin/bookings/pull', {}).then(function (d) { toast('Pulled ' + d.fetched + ' · ' + d.added + ' new'); return load(); }).catch(function (x) { toast(x.message, true); }); }
    else if (act === 'person' && b) { var m = member(b); if (m && window.peopleOpen) window.peopleOpen(m.email); }
    else if (act === 'done' && b) mark(uid, { outcome: b.outcome === 'done' ? '' : 'done' }, b.outcome === 'done' ? 'Cleared' : 'Marked done');
    else if (act === 'noshow' && b) mark(uid, { outcome: b.outcome === 'noshow' ? '' : 'noshow' }, b.outcome === 'noshow' ? 'Cleared' : 'Marked no-show');
    else if (act === 'note') { NOTE_OPEN = uid; renderList(); var n = $('cl-note-in'); if (n) n.focus(); }
    else if (act === 'savenote') mark(uid, { note: ($('cl-note-in') || {}).value || '' }, 'Note saved');
  });

  // Load once at start (badge + pop-ups work from any tab), then every 3 min.
  function start() { load(); setInterval(load, 3 * 60000); setInterval(notify, 60000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
