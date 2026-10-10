/* ==========================================================================
   admin-nt.js — Admin → NinjaTrader tab
   Self-contained so it can drop into the admin overhaul as-is.

   Needs in admin.html:
     - a nav button  id="tab-nt"   onclick="switchTab('nt')"
     - a panel       <div id="panel-nt" class="tab-panel"></div>
     - 'nt' in switchTab's list, and:  if (tab === 'nt') ntLoad();
     - <script src="admin-nt.js"></script> after the main admin script

   NinjaTrader licenses are added by hand in the NinjaTrader Vendor dashboard.
   This tab tells you who to add, move or remove, and records that you did.
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var D = null;               // last payload
  var FILTER = 'all', QUERY = '';
  var TIMER = null;

  function tok() { try { return localStorage.getItem('fsdx_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + tok() }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function ago(iso) {
    if (!iso) return '—';
    var h = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
    if (h < 48) return Math.round(h) + 'h';
    return Math.round(h / 24) + 'd';
  }
  function hoursSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : 0; }
  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago' }); }
    catch (e) { return iso; }
  }
  function toast(msg, bad) {
    var t = $('ntx-toast'); if (!t) return;
    t.textContent = msg; t.className = 'ntx-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'ntx-toast'; }, 2600);
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast('Copied ' + text); })
      .catch(function () { window.prompt('Copy:', text); });
  }
  function vendorUrl() { try { return localStorage.getItem('ntx_vendor_url') || ''; } catch (e) { return ''; } }

  /* ── Styles ─────────────────────────────────────────────────────────── */
  var CSS = ''
    + '.ntx .ntx-card{border:1px solid rgba(255,255,255,.10);background:rgba(9,9,11,.4);border-radius:16px;padding:18px}'
    + '.ntx .ntx-h{font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.14em;font-weight:900}'
    + '.ntx .ntx-stat{border:1px solid rgba(255,255,255,.10);background:rgba(9,9,11,.4);border-radius:14px;padding:14px}'
    + '.ntx .ntx-stat .n{font-size:24px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums}'
    + '.ntx .ntx-stat .l{font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:800;margin-top:2px}'
    + '.ntx .ntx-stat.red{border-color:rgba(226,83,75,.45);background:rgba(226,83,75,.07)} .ntx .ntx-stat.red .n{color:#E2534B}'
    + '.ntx .ntx-stat.amber{border-color:rgba(245,165,36,.40);background:rgba(245,165,36,.06)} .ntx .ntx-stat.amber .n{color:#F5A524}'
    + '.ntx .ntx-stat.green .n{color:#2FBF7E}'
    + '.ntx .ntx-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);background:#18181b;color:#d4d4d8;'
    +   'font-size:11px;font-weight:800;border-radius:9px;padding:6px 11px;cursor:pointer;white-space:nowrap;transition:all .12s}'
    + '.ntx .ntx-btn:hover{color:#fff;border-color:rgba(255,255,255,.25)}'
    + '.ntx .ntx-btn.pri{background:linear-gradient(135deg,#FF9247,#FF6B1F 52%,#EB550D);color:#0B1119;border:0}'
    + '.ntx .ntx-btn.ok{background:rgba(47,191,126,.14);color:#2FBF7E;border-color:rgba(47,191,126,.35)}'
    + '.ntx .ntx-btn.bad{color:#E2534B;border-color:rgba(226,83,75,.35)}'
    + '.ntx .ntx-btn:disabled{opacity:.5;cursor:default}'
    + '.ntx .ntx-in{background:#05080D;border:1px solid rgba(120,160,210,.18);border-radius:9px;padding:8px 11px;color:#E6EAF0;font-size:12px;outline:none;min-width:0}'
    + '.ntx .ntx-in:focus{border-color:rgba(255,107,31,.5)}'
    + '.ntx textarea.ntx-in{width:100%;min-height:90px;font-family:inherit;resize:vertical}'
    + '.ntx .ntx-task{display:flex;gap:14px;align-items:flex-start;border:1px solid rgba(255,255,255,.08);border-left:3px solid #F5A524;'
    +   'background:rgba(255,255,255,.015);border-radius:12px;padding:12px 14px;margin-top:10px;flex-wrap:wrap}'
    + '.ntx .ntx-task.warn{border-left-color:#FF6B1F;background:rgba(255,107,31,.05)}'
    + '.ntx .ntx-task.late{border-left-color:#E2534B;background:rgba(226,83,75,.06)}'
    + '.ntx .ntx-tag{display:inline-block;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;padding:3px 7px;border-radius:6px;border:1px solid}'
    + 't-add{color:#F5A524;border-color:rgba(245,165,36,.4);background:rgba(245,165,36,.08)}'
    + 't-move{color:#FF6B1F;border-color:rgba(255,107,31,.4);background:rgba(255,107,31,.08)}'
    + 't-active{color:#2FBF7E;border-color:rgba(47,191,126,.4);background:rgba(47,191,126,.08)}'
    + 't-removed{color:#E2534B;border-color:rgba(226,83,75,.4);background:rgba(226,83,75,.08)}'
    + 't-pending{color:#F5A524;border-color:rgba(245,165,36,.4);background:rgba(245,165,36,.08)}'
    + 't-early{color:#7FB2FF;border-color:rgba(127,178,255,.4);background:rgba(127,178,255,.08)}'
    + '.ntx .ntx-mail{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#fff;cursor:pointer;border-bottom:1px dashed rgba(255,255,255,.25)}'
    + '.ntx .ntx-mail:hover{color:#FF6B1F;border-color:#FF6B1F}'
    + '.ntx table.ntx-t{width:100%;border-collapse:collapse;font-size:12px}'
    + '.ntx .ntx-t th{text-align:left;font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:900;padding:8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}'
    + '.ntx .ntx-t td{padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.05);color:#a1a1aa;vertical-align:middle}'
    + '.ntx .ntx-t tr:hover td{background:rgba(255,255,255,.015)}'
    + '.ntx .ntx-scroll{overflow-x:auto}'
    + '.ntx .ntx-chip{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.1);color:#a1a1aa;cursor:pointer;background:transparent}'
    + '.ntx .ntx-chip.on{color:#fff;border-color:rgba(255,107,31,.5);background:rgba(255,107,31,.10)}'
    + '.ntx .ntx-log{font-size:11.5px;color:#a1a1aa;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:10px}'
    + '.ntx .ntx-log .w{color:#52525b;white-space:nowrap;min-width:110px}'
    + '.ntx .ntx-sw{position:relative;width:38px;height:21px;border-radius:999px;background:#27272a;border:1px solid rgba(255,255,255,.12);cursor:pointer;flex-shrink:0}'
    + '.ntx .ntx-sw:after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#71717a;transition:all .15s}'
    + '.ntx .ntx-sw.on{background:rgba(47,191,126,.25);border-color:rgba(47,191,126,.5)} .ntx .ntx-sw.on:after{left:19px;background:#2FBF7E}'
    + '.ntx-toast{position:fixed;bottom:20px;right:20px;z-index:9999;background:#18181b;border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;'
    +   'padding:10px 14px;border-radius:10px;opacity:0;transform:translateY(8px);transition:all .2s;pointer-events:none}'
    + '.ntx-toast.show{opacity:1;transform:none} .ntx-toast.bad{border-color:rgba(226,83,75,.5);color:#E2534B}'
    + '.ntx .ntx-grid{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}'
    + '@media(min-width:1024px){.ntx .ntx-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}'
    + '.ntx .ntx-2col{display:grid;gap:16px;grid-template-columns:1fr} @media(min-width:1024px){.ntx .ntx-2col{grid-template-columns:1fr 1fr}}';

  /* ── Skeleton ───────────────────────────────────────────────────────── */
  function skeleton() {
    ['panel-nt', 'panel-today', 'panel-alerts'].forEach(function (id) { var x = $(id); if (x) x.classList.add('ntx'); });
    var p = $('panel-nt'); if (!p || p.getAttribute('data-ready')) return;
    p.setAttribute('data-ready', '1');
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var t = document.createElement('div'); t.id = 'ntx-toast'; t.className = 'ntx-toast'; document.body.appendChild(t);
    p.innerHTML = ''
      + '<div class="flex items-center justify-between mb-5 flex-wrap gap-2">'
      +   '<div><h2 class="text-lg font-black text-white">NinjaTrader Licenses</h2>'
      +   '<div class="text-[11px] text-zinc-600 mt-0.5">Add and remove licenses in the NinjaTrader Vendor dashboard. Mark them here.</div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap">'
      +     '<span id="ntx-updated" class="text-[10px] text-zinc-600"></span>'
      +     '<a id="ntx-vendor-link" class="ntx-btn" target="_blank" rel="noopener" style="display:none">NT Vendor dashboard &#8599;</a>'
      +     '<button class="ntx-btn" onclick="ntLoad()">Refresh</button>'
      +   '</div>'
      + '</div>'
      + '<div id="ntx-stats" class="ntx-grid mb-5"></div>'

      + '<div class="ntx-card mb-5">'
      +   '<div class="flex items-center justify-between flex-wrap gap-2"><div class="ntx-h">To do</div>'
      +   '<div class="text-[10px] text-zinc-600">oldest first · amber &lt;12h · orange 12–24h · red &gt;24h</div></div>'
      +   '<div id="ntx-queue" class="text-xs text-zinc-600 mt-2">Loading…</div>'
      + '</div>'

      + '<div class="ntx-card mb-5">'
      +   '<div class="flex items-center justify-between flex-wrap gap-2 mb-3">'
      +     '<div class="ntx-h">License register</div>'
      +     '<div class="flex items-center gap-2 flex-wrap" id="ntx-filters"></div>'
      +   '</div>'
      +   '<div class="ntx-scroll"><div id="ntx-register" class="text-xs text-zinc-600">—</div></div>'
      +   '<details class="mt-4"><summary class="text-[11px] text-zinc-400 cursor-pointer font-bold">+ Add a member by hand (existing members, partner, testers)</summary>'
      +   '<div class="flex flex-wrap gap-2 mt-3 items-center">'
      +     '<input id="ntx-a-email" class="ntx-in" placeholder="Site login email" style="flex:1 1 200px">'
      +     '<input id="ntx-a-name" class="ntx-in" placeholder="Name" style="flex:1 1 120px">'
      +     '<input id="ntx-a-nt" class="ntx-in" placeholder="NinjaTrader email" style="flex:1 1 200px">'
      +     '<label class="text-[11px] text-zinc-400 flex items-center gap-1"><input type="checkbox" id="ntx-a-active"> License already added</label>'
      +     '<label class="text-[11px] text-zinc-400 flex items-center gap-1"><input type="checkbox" id="ntx-a-early"> Early access</label>'
      +     '<button class="ntx-btn pri" onclick="ntAdd()">Add</button>'
      +   '</div></details>'
      + '</div>'

      + '<div class="ntx-2col mb-5">'
      +   '<div class="ntx-card"><div class="ntx-h mb-3">Releases</div>'
      +     '<div class="flex flex-wrap gap-2 items-center">'
      +       '<input id="ntx-r-ver" class="ntx-in" placeholder="Version e.g. 1.1.0" style="width:140px">'
      +       '<input id="ntx-r-file" type="file" accept=".zip" class="text-[11px] text-zinc-400" style="flex:1 1 180px">'
      +     '</div>'
      +     '<textarea id="ntx-r-notes" class="ntx-in mt-2" placeholder="What changed (members see this)"></textarea>'
      +     '<div class="flex items-center justify-between mt-2 gap-2 flex-wrap">'
      +       '<label class="text-[11px] text-zinc-400 flex items-center gap-1"><input type="checkbox" id="ntx-r-cur" checked> Make current (members see Update available)</label>'
      +       '<button id="ntx-r-btn" class="ntx-btn pri" onclick="ntUpload()">Upload release</button>'
      +     '</div>'
      +     '<div class="text-[10.5px] text-zinc-600 mt-2">Upload the PROTECTED export zip only. Never the source.</div>'
      +     '<div id="ntx-releases" class="mt-4"></div>'
      +   '</div>'
      +   '<div class="ntx-card"><div class="ntx-h mb-3">Settings</div><div id="ntx-settings"></div></div>'
      + '</div>'

      + '<div class="ntx-card"><div class="ntx-h mb-2">Activity</div><div id="ntx-log" class="text-xs text-zinc-600">—</div></div>';
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function isOwnerRec(r) { return D && D.owners && D.owners.indexOf(r.email) !== -1; }

  function renderStats() {
    var recs = D.records;
    var pend = recs.filter(isTask);
    var late = pend.filter(function (r) { return hoursSince(r.requestedAt || r.createdAt) > 24; });
    var act = recs.filter(function (r) { return r.status === 'active'; });
    var dl = (D.downloads && D.downloads.total) || 0;
    function card(n, l, cls) { return '<div class="ntx-stat ' + (cls || '') + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    $('ntx-stats').innerHTML =
        card(pend.length, 'To do', pend.length ? 'amber' : '')
      + card(late.length, 'Overdue &gt;24h', late.length ? 'red' : '')
      + card(act.length, 'Active licenses', 'green')
      + card(dl, 'Downloads (all versions)')
      + card(D.settings.live ? 'LIVE' : 'PREP', D.settings.live ? 'Members can download' : 'Final prep · owners only', D.settings.live ? 'green' : 'amber');
  }

  // Something you can act on now. Pending with no NT email = waiting on the member.
  function isTask(r) { return r.status === 'remove' || (r.status === 'pending' && !!r.ntEmail); }
  function isWaiting(r) { return r.status === 'pending' && !r.ntEmail; }
  window.ntIsTask = isTask;

  // Shared with the Today tab (window.ntTasksHtml).
  function tasksHtml(data) {
    var list = (data && data.records || []).filter(isTask)
      .sort(function (a, b) { return new Date(a.requestedAt || a.createdAt) - new Date(b.requestedAt || b.createdAt); });
    var waitList = (data && data.records || []).filter(isWaiting);
    var waitHtml = waitingHtml(waitList);
    if (!list.length) return '<div class="text-[12px] text-zinc-500 py-2">Nothing to do. All NinjaTrader licenses match Whop.</div>' + waitHtml;
    return list.map(function (r) {
      var h = hoursSince(r.requestedAt || r.createdAt);
      var cls = h > 24 ? 'late' : (h > 12 ? 'warn' : '');
      var rm = r.status === 'remove', move = !rm && !!r.prevNtEmail;
      var what = rm ? '<span class="ntx-tag t-removed">Remove NT license</span>'
        : move ? '<span class="ntx-tag t-move">Move NT license</span>'
        : r.ntEmail ? '<span class="ntx-tag t-add">Add NT license</span>'
        : '<span class="ntx-tag t-add">Ask for NT email</span>';
      var mail = function (e) { return '<span class="ntx-mail" data-copy="' + esc(e) + '">' + esc(e) + '</span>'; };
      var steps = rm
        ? '<div class="text-[12px] text-zinc-400 mt-2">Remove ' + (r.ntEmail ? mail(r.ntEmail) : '<span class="text-red-400">no NT email on file</span>') + ' in the Vendor dashboard'
          + '<div class="text-[11px] text-zinc-600 mt-1">' + esc(r.removeReason || 'Membership ended') + '</div></div>'
        : move
        ? '<div class="text-[12px] text-zinc-400 mt-2">1. Remove ' + mail(r.prevNtEmail) + '<br>2. Add ' + mail(r.ntEmail) + '</div>'
        : r.ntEmail
        ? '<div class="text-[12px] text-zinc-400 mt-2">Add license for ' + mail(r.ntEmail) + ' <span class="text-[10px] text-zinc-600">(click to copy)</span></div>'
        : '<div class="text-[12px] text-zinc-400 mt-2">No NinjaTrader email at checkout. Ask them in Discord, then click <b class="text-zinc-200">Set NT email</b>.</div>';
      var btns = rm
        ? '<button class="ntx-btn ok" data-act="remove-done" data-e="' + esc(r.email) + '">&#10003; Removed</button>'
        : r.ntEmail
        ? '<button class="ntx-btn ok" data-act="activate" data-e="' + esc(r.email) + '">&#10003; Done, email them</button>'
          + '<button class="ntx-btn" data-act="activate-quiet" data-e="' + esc(r.email) + '" title="Mark done without emailing">Done, no email</button>'
        : '<button class="ntx-btn" data-act="edit" data-e="' + esc(r.email) + '">Set NT email</button>';
      return '<div class="ntx-task ' + cls + '">'
        + '<div style="flex:1 1 280px;min-width:0">'
        +   '<div class="flex items-center gap-2 flex-wrap">' + what
        +     '<span class="text-sm font-black text-white">' + esc(r.name || r.email) + '</span>'
        +     '<span class="text-[11px] text-zinc-500">' + esc(r.email) + '</span></div>'
        +   steps
        + '</div>'
        + '<div class="flex flex-col items-end gap-2">'
        +   '<div class="text-[11px] font-black ' + (h > 24 ? 'text-red-400' : 'text-zinc-500') + '">waiting ' + ago(r.requestedAt || r.createdAt) + '</div>'
        +   '<div class="flex gap-2 flex-wrap justify-end">' + btns + '</div>'
        + '</div></div>';
    }).join('') + waitHtml;
  }

  // Members on an NT plan who haven't given a NinjaTrader email. Not a task:
  // they move to To do on their own once they enter it on the site.
  function waitingHtml(list) {
    if (!list.length) return '';
    var open = (function () { try { return localStorage.getItem('ntx_wait_open') === '1'; } catch (e) { return false; } })();
    return '<details class="mt-4" ' + (open ? 'open' : '') + ' ontoggle="try{localStorage.setItem(\'ntx_wait_open\',this.open?\'1\':\'0\')}catch(e){}">'
      + '<summary class="cursor-pointer text-[12px] text-zinc-400 font-bold">Waiting on member (' + list.length + ') '
      + '<span class="font-normal text-zinc-600">· no NinjaTrader email yet · not counted as to do</span></summary>'
      + '<div class="flex items-center justify-between gap-2 flex-wrap mt-2 mb-1">'
      +   '<div class="text-[11px] text-zinc-500">They show up in To do automatically once they add their NT email on the site. Dismiss anyone who won\'t use NinjaTrader.</div>'
      +   '<button class="ntx-btn" data-bulk="decline_waiting">Dismiss all ' + list.length + '</button>'
      + '</div>'
      + list.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); }).map(function (r) {
          return '<div class="flex items-center gap-2 py-2 border-b border-white/5 flex-wrap">'
            + '<div style="flex:1 1 220px;min-width:0"><span class="text-[12.5px] text-white font-bold">' + esc(r.name || r.email) + '</span> '
            + '<span class="text-[11px] text-zinc-500">' + esc(r.email) + '</span></div>'
            + '<button class="ntx-btn" data-act="edit" data-e="' + esc(r.email) + '">Set NT email</button>'
            + '<button class="ntx-btn" data-act="decline" data-e="' + esc(r.email) + '">Not using NT</button>'
            + '</div>';
        }).join('')
      + '</details>';
  }
  window.ntTasksHtml = tasksHtml;
  window.ntData = function () { return D; };

  function renderQueue() { $('ntx-queue').innerHTML = tasksHtml(D); }

  function renderFilters() {
    var opts = [['all', 'All'], ['active', 'Active'], ['pending', 'To do'], ['waiting', 'Waiting'], ['removed', 'Removed'], ['declined', 'Not using']];
    $('ntx-filters').innerHTML = opts.map(function (o) {
      return '<button class="ntx-chip' + (FILTER === o[0] ? ' on' : '') + '" data-filter="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '<input id="ntx-q" class="ntx-in" placeholder="Search" style="width:150px" value="' + esc(QUERY) + '">';
    var q = $('ntx-q');
    q.addEventListener('input', function () { QUERY = q.value.toLowerCase(); renderRegister(); });
  }

  function renderRegister() {
    var rows = D.records.filter(function (r) {
      if (FILTER === 'pending' ? !isTask(r) : FILTER === 'waiting' ? !isWaiting(r) : (FILTER !== 'all' && r.status !== FILTER)) return false;
      if (QUERY && (r.email + ' ' + (r.ntEmail || '') + ' ' + (r.name || '')).toLowerCase().indexOf(QUERY) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var o = { remove: 0, pending: 0, active: 1, removed: 2, declined: 3 };
      return (o[a.status] - o[b.status]) || (a.name || a.email).localeCompare(b.name || b.email);
    });
    if (!rows.length) { $('ntx-register').innerHTML = '<div class="py-3 text-zinc-500">No members here yet.</div>'; return; }
    var cur = D.settings.current;
    $('ntx-register').innerHTML = '<table class="ntx-t"><tr><th>Member</th><th>NinjaTrader email</th><th>Status</th><th>Added</th><th>Removed</th><th>Version</th><th></th></tr>'
      + rows.map(function (r) {
        var tag = (r.status === 'remove' ? '<span class="ntx-tag t-removed">To remove</span>'
            : isWaiting(r) ? '<span class="ntx-tag t-pending">Waiting</span>'
            : r.status === 'declined' ? '<span class="ntx-tag t-early" style="color:#7C8899;border-color:#253244;background:transparent">Not using</span>'
            : '<span class="ntx-tag t-' + r.status + '">' + (r.status === 'pending' ? 'To do' : r.status) + '</span>')
          + (r.early ? ' <span class="ntx-tag t-early">Early</span>' : '')
          + (isOwnerRec(r) ? ' <span class="ntx-tag t-early">Owner</span>' : '');
        var ver = r.lastVersion ? ('v' + esc(r.lastVersion) + (cur && r.lastVersion !== cur ? ' <span class="ntx-tag t-move">old</span>' : '')) : '<span class="text-zinc-600">—</span>';
        var acts = '';
        if (r.status === 'active') acts += '<button class="ntx-btn bad" data-act="remove" data-e="' + esc(r.email) + '">Remove</button>';
        if (r.status === 'remove') acts += '<button class="ntx-btn ok" data-act="remove-done" data-e="' + esc(r.email) + '">&#10003; Removed</button>';
        if (r.status === 'removed' || r.status === 'declined') acts += '<button class="ntx-btn" data-act="pending" data-e="' + esc(r.email) + '">Re-add</button>';
        if (isWaiting(r)) acts += '<button class="ntx-btn" data-act="decline" data-e="' + esc(r.email) + '">Not using NT</button>';
        acts += '<button class="ntx-btn" data-act="edit" data-e="' + esc(r.email) + '">Edit</button>';
        acts += '<button class="ntx-btn" data-act="early" data-e="' + esc(r.email) + '">' + (r.early ? 'Early off' : 'Early on') + '</button>';
        if (!isOwnerRec(r)) acts += '<button class="ntx-btn bad" data-act="delete" data-e="' + esc(r.email) + '" title="Delete record">&times;</button>';
        return '<tr>'
          + '<td><div class="text-white font-bold">' + esc(r.name || '—') + '</div><div class="text-[11px] text-zinc-500">' + esc(r.email) + '</div>'
          +   (r.note ? '<div class="text-[10.5px] text-zinc-600">' + esc(r.note) + '</div>' : '') + '</td>'
          + '<td>' + (r.ntEmail ? '<span class="ntx-mail" data-copy="' + esc(r.ntEmail) + '">' + esc(r.ntEmail) + '</span>' : '<span class="text-red-400">missing</span>') + '</td>'
          + '<td>' + tag + '</td>'
          + '<td>' + fmt(r.activatedAt) + '</td>'
          + '<td>' + fmt(r.removedAt) + '</td>'
          + '<td>' + ver + '</td>'
          + '<td><div class="flex gap-1 justify-end flex-wrap">' + acts + '</div></td>'
          + '</tr>';
      }).join('') + '</table>';
  }

  function renderReleases() {
    var rel = D.releases, cur = D.settings.current;
    if (!rel.length) { $('ntx-releases').innerHTML = '<div class="text-[12px] text-zinc-500">No releases yet. Upload the protected zip once Agile.NET is set up.</div>'; return; }
    $('ntx-releases').innerHTML = rel.map(function (r) {
      var isCur = r.version === cur;
      var onIt = D.records.filter(function (x) { return x.lastVersion === r.version; }).length;
      return '<div class="flex items-center gap-2 py-2 border-b border-white/5 flex-wrap">'
        + '<div style="flex:1 1 160px"><span class="text-white font-black text-sm">v' + esc(r.version) + '</span> '
        + (isCur ? '<span class="ntx-tag t-active">Current</span>' : '')
        + '<div class="text-[10.5px] text-zinc-600">' + fmt(r.uploadedAt) + ' · ' + Math.round(r.size / 1024) + ' KB · '
        + '<b class="text-zinc-300">' + (r.downloads || 0) + '</b> downloads (' + (r.uniqueDownloads || 0) + ' members) · ' + onIt + ' on it now</div></div>'
        + '<button class="ntx-btn" data-rel="dl" data-v="' + esc(r.version) + '">Download</button>'
        + (isCur ? '' : '<button class="ntx-btn" data-rel="cur" data-v="' + esc(r.version) + '">Make current</button>'
                      + '<button class="ntx-btn bad" data-rel="del" data-v="' + esc(r.version) + '">Delete</button>')
        + '</div>';
    }).join('');
  }

  function renderSettings() {
    var s = D.settings;
    function sw(id, on, label, sub) {
      return '<div class="flex items-start gap-3 py-2"><div class="ntx-sw' + (on ? ' on' : '') + '" id="' + id + '"></div>'
        + '<div><div class="text-[12px] text-white font-bold">' + label + '</div><div class="text-[11px] text-zinc-500">' + sub + '</div></div></div>';
    }
    $('ntx-settings').innerHTML =
        sw('ntx-s-live', s.live, 'Launch: members can download', 'Off = final prep. Members can confirm their NT email; only owners and Early members can download.')
      + '<div class="text-[11px] text-zinc-500 py-2">Email alerts for NinjaTrader tasks are set in <a class="text-green-400 font-bold cursor-pointer" onclick="switchTab(\'alerts\')">Alerts</a>.</div>'
      + '<div class="mt-4 pt-3 border-t border-white/5"><div class="text-[12px] text-white font-bold mb-1">NinjaTrader Vendor dashboard link</div>'
      + '<div class="text-[11px] text-zinc-500 mb-2">Paste the URL of your Manage Add-Ons page. Saved in this browser.</div>'
      + '<div class="flex gap-2"><input id="ntx-s-vendor" class="ntx-in" style="flex:1" placeholder="https://…" value="' + esc(vendorUrl()) + '">'
      + '<button class="ntx-btn" onclick="ntSaveVendor()">Save</button></div></div>'
      + '<div class="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-500">Owner logins (always have access): '
      + (D.owners || []).map(esc).join(', ') + '. Add more with the <span class="text-zinc-300">NT_OWNER_EMAILS</span> worker variable.</div>';
    $('ntx-s-live').onclick = function () {
      var next = !D.settings.live;
      if (next && !D.releases.length) { toast('Upload a release before going live.', true); return; }
      if (!window.confirm(next ? 'Go LIVE? Every member with an active license can download.' : 'Turn downloads off for members?')) return;
      post('/api/admin/nt/settings', { live: next }).then(function () { toast(next ? 'Live' : 'Back to final prep'); ntLoad(); }).catch(function (e) { toast(e.message, true); });
    };
  }

  var LOG_LABEL = {
    request: 'Requested license', email_change: 'Changed NT email', activated: 'License marked added',
    removed: 'License marked removed', set_pending: 'Moved back to To do', download: 'Downloaded',
    release: 'Release uploaded', release_current: 'Current release set', release_delete: 'Release deleted',
    admin_add: 'Added by admin', remove_queued: 'Removal queued (membership ended)', remove_cancelled: 'Removal cancelled (back active)', declined: 'Marked not using NT', admin_update: 'Edited by admin', admin_delete: 'Record deleted', settings: 'Settings changed'
  };
  function renderLog() {
    var log = D.log || [];
    if (!log.length) { $('ntx-log').innerHTML = '<div class="text-zinc-500 py-2">No activity yet.</div>'; return; }
    $('ntx-log').innerHTML = log.slice(0, 60).map(function (l) {
      return '<div class="ntx-log"><span class="w">' + fmt(l.at) + '</span><span><b class="text-zinc-200">' + esc(LOG_LABEL[l.type] || l.type) + '</b> · '
        + esc(l.email || '') + (l.detail ? ' <span class="text-zinc-600">· ' + esc(l.detail) + '</span>' : '') + '</span></div>';
    }).join('');
  }

  function renderAll() {
    renderStats(); renderQueue(); renderFilters(); renderRegister(); renderReleases(); renderSettings(); renderLog();
    var v = vendorUrl(), a = $('ntx-vendor-link');
    if (v) { a.href = v; a.style.display = ''; } else { a.style.display = 'none'; }
    $('ntx-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';
    // Nav badge: open tasks
    var n = D.records.filter(isTask).length;
    setBadges(n);
  }

  function setBadges(n) {
    ['nt-nav-n', 'today-nav-n'].forEach(function (id) {
      var b = $(id); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
    });
  }

  /* ── Actions ────────────────────────────────────────────────────────── */
  function lic(email, action, extra) {
    return post('/api/admin/nt/license', Object.assign({ email: email, action: action }, extra || {}));
  }
  function find(email) { return D.records.filter(function (r) { return r.email === email; })[0]; }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-copy],[data-act],[data-rel],[data-filter],[data-bulk]') : null;
    if (!el) return;
    var inNt = $('panel-nt') && $('panel-nt').contains(el), inToday = $('panel-today') && $('panel-today').contains(el);
    if (!inNt && !inToday) return;
    if (el.hasAttribute('data-copy')) { copy(el.getAttribute('data-copy')); return; }
    if (el.hasAttribute('data-bulk')) {
      var cnt = D.records.filter(isWaiting).length;
      if (!window.confirm('Mark all ' + cnt + ' waiting members as "Not using NinjaTrader"?\nAnyone who adds their NT email on the site later goes straight to To do.')) return;
      el.disabled = true;
      post('/api/admin/nt/bulk', { action: 'decline_waiting' }).then(function (d) {
        toast(d.count + ' dismissed'); ntLoad(); if (window.todayLoad && inToday) todayLoad();
      }).catch(function (x) { el.disabled = false; toast(x.message, true); });
      return;
    }
    if (el.hasAttribute('data-filter')) { FILTER = el.getAttribute('data-filter'); renderFilters(); renderRegister(); return; }

    if (el.hasAttribute('data-rel')) {
      var v = el.getAttribute('data-v'), k = el.getAttribute('data-rel');
      if (k === 'dl') return adminDownload(v);
      if (k === 'cur') return post('/api/admin/nt/release/current', { version: v }).then(function () { toast('v' + v + ' is current'); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      if (k === 'del') {
        if (!window.confirm('Delete v' + v + '? Members can no longer download it.')) return;
        return api('/api/admin/nt/release?v=' + encodeURIComponent(v), { method: 'DELETE' }).then(function () { toast('Deleted'); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      }
      return;
    }

    var em = el.getAttribute('data-e'), act = el.getAttribute('data-act'), r = find(em);
    if (!r) return;
    el.disabled = true;
    var p;
    if (act === 'activate' || act === 'activate-quiet') {
      if (r.prevNtEmail && !window.confirm('Did you REMOVE ' + r.prevNtEmail + ' and ADD ' + r.ntEmail + ' in the Vendor dashboard?')) { el.disabled = false; return; }
      p = lic(em, 'activate', { notify: act === 'activate' }).then(function (d) { toast(d.emailed ? 'Marked added · welcome email sent' : 'Marked added'); });
    } else if (act === 'decline') {
      p = lic(em, 'decline').then(function () { toast('Dismissed · not using NinjaTrader'); });
    } else if (act === 'remove-done') {
      if (!window.confirm('Did you remove ' + (r.ntEmail || em) + ' in the NinjaTrader Vendor dashboard?')) { el.disabled = false; return; }
      p = lic(em, 'remove', { note: r.removeReason || 'Membership ended' }).then(function () { toast('Marked removed'); });
    } else if (act === 'remove') {
      var why = window.prompt('Remove ' + (r.ntEmail || em) + '?\nRemove it in the Vendor dashboard too.\nReason (optional):', 'Cancelled');
      if (why === null) { el.disabled = false; return; }
      p = lic(em, 'remove', { note: why }).then(function () { toast('Marked removed'); });
    } else if (act === 'pending') {
      p = lic(em, 'pending').then(function () { toast('Moved to To do'); });
    } else if (act === 'early') {
      p = lic(em, 'update', { early: !r.early }).then(function () { toast(r.early ? 'Early access off' : 'Early access on'); });
    } else if (act === 'edit') {
      var n = window.prompt('NinjaTrader email for ' + em + ':', r.ntEmail || '');
      if (n === null) { el.disabled = false; return; }
      var note = window.prompt('Note (optional):', r.note || '');
      p = lic(em, 'update', { ntEmail: n.trim(), note: note === null ? r.note : note }).then(function () { toast('Saved'); });
    } else if (act === 'delete') {
      if (!window.confirm('Delete ' + em + ' from the register? This does not touch NinjaTrader.')) { el.disabled = false; return; }
      p = lic(em, 'delete').then(function () { toast('Deleted'); });
    }
    if (p) p.then(function () { ntLoad(); if (window.todayLoad && inToday) todayLoad(); })
      .catch(function (x) { el.disabled = false; toast(x.message, true); });
  }

  function adminDownload(v) {
    fetch(API + '/api/admin/nt/download?v=' + encodeURIComponent(v), { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b);
        a.download = 'FSDX_ORB_Pro_Knightfall_v' + v + '.zip'; document.body.appendChild(a); a.click(); a.remove();
      }).catch(function (e) { toast(e.message, true); });
  }

  window.ntAdd = function () {
    var email = $('ntx-a-email').value.trim();
    if (!email) { toast('Site email required', true); return; }
    lic(email, 'add', {
      name: $('ntx-a-name').value.trim(), ntEmail: $('ntx-a-nt').value.trim(),
      activate: $('ntx-a-active').checked, early: $('ntx-a-early').checked
    }).then(function () {
      toast('Added'); ['ntx-a-email', 'ntx-a-name', 'ntx-a-nt'].forEach(function (i) { $(i).value = ''; });
      ntLoad();
    }).catch(function (e) { toast(e.message, true); });
  };

  window.ntUpload = function () {
    var ver = $('ntx-r-ver').value.trim(), f = $('ntx-r-file').files[0];
    if (!ver || !f) { toast('Version and zip required', true); return; }
    if (!/\.zip$/i.test(f.name)) { toast('Pick the .zip export', true); return; }
    var fd = new FormData();
    fd.append('file', f); fd.append('version', ver);
    fd.append('notes', $('ntx-r-notes').value); fd.append('makeCurrent', $('ntx-r-cur').checked ? 'true' : 'false');
    var b = $('ntx-r-btn'); b.disabled = true; b.textContent = 'Uploading…';
    api('/api/admin/nt/release', { method: 'POST', body: fd }).then(function (d) {
      toast('v' + d.version + ' uploaded'); $('ntx-r-ver').value = ''; $('ntx-r-file').value = ''; $('ntx-r-notes').value = '';
      ntLoad();
    }).catch(function (e) { toast(e.message, true); })
      .then(function () { b.disabled = false; b.textContent = 'Upload release'; });
  };

  window.ntSaveVendor = function () {
    try { localStorage.setItem('ntx_vendor_url', $('ntx-s-vendor').value.trim()); } catch (e) {}
    toast('Saved'); renderAll();
  };

  window.ntLoad = function () {
    skeleton();
    return api('/api/admin/nt').then(function (d) { D = d; renderAll(); })
      .catch(function (e) {
        $('ntx-queue').innerHTML = '<div class="text-[12px] text-red-400 py-2">Couldn\'t load: ' + esc(e.message) + '. Make sure the worker is deployed with nexus-nt.js.</div>';
      });
  };

  // Runs on its own: refresh the badge + panel every 2 minutes while admin is open.
  function startAuto() {
    if (TIMER) return;
    TIMER = setInterval(function () {
      var p = $('panel-nt');
      if (!tok()) return;
      if (p && p.classList.contains('active')) ntLoad();
      else api('/api/admin/nt').then(function (d) { D = d; var n = d.records.filter(isTask).length;
        setBadges(n); }).catch(function () {});
    }, 120000);
  }

  document.addEventListener('click', onClick);
  document.addEventListener('DOMContentLoaded', function () {
    skeleton();
    // Prime the nav badge once the admin session exists.
    setTimeout(function () { if (tok()) api('/api/admin/nt').then(function (d) { D = d; renderAll(); }).catch(function () {}); }, 1500);
    startAuto();
  });
})();
