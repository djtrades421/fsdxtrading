/* ==========================================================================
   admin-nt.js — Admin → NinjaTrader tab
   Self-contained so it can drop into the admin overhaul as-is.

   Needs in admin.html:
     - a nav button  id="tab-nt"   onclick="switchTab('nt')"
     - a panel       <div id="panel-nt" class="tab-panel"></div>
     - 'nt' in switchTab's list, and:  if (tab === 'nt') ntLoad();
     - <script src="admin-nt.js"></script> after the main admin script

   NinjaTrader licenses are added by hand in the NinjaTrader Vendor dashboard.
   Every NT8 tool (Knightfall, Volume, Raven, Stack, …) is its own product with
   its own license. The worker works out from each member's plan exactly what
   to add or remove; this tab shows it as a checklist, and "Mark done" only
   unlocks once every step is ticked. Releases are uploaded per product.
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
    + '.ntx .ntx-btn.badfill{background:#E2534B;color:#1a0505;border-color:#E2534B}'
    + '.ntx .ntx-btn:disabled{opacity:.45;cursor:not-allowed}'
    + '.ntx .ntx-btn.pri:disabled,.ntx .ntx-btn.badfill:disabled{background:#27272a;color:#71717a;border:1px solid rgba(255,255,255,.08);opacity:1}'
    + '.ntx .ntx-in{background:#05080D;border:1px solid rgba(120,160,210,.18);border-radius:9px;padding:8px 11px;color:#E6EAF0;font-size:12px;outline:none;min-width:0}'
    + '.ntx .ntx-in:focus{border-color:rgba(255,107,31,.5)}'
    + '.ntx textarea.ntx-in{width:100%;min-height:70px;font-family:inherit;resize:vertical}'
    + '.ntx select.ntx-in{padding:7px 9px}'
    + '.ntx .ntx-task{border:1px solid rgba(255,255,255,.08);border-left:3px solid #F5A524;'
    +   'background:rgba(255,255,255,.015);border-radius:12px;padding:14px;margin-top:10px}'
    + '.ntx .ntx-task.warn{border-left-color:#FF6B1F;background:rgba(255,107,31,.05)}'
    + '.ntx .ntx-task.late{border-left-color:#E2534B;background:rgba(226,83,75,.06)}'
    + '.ntx .ntx-task.rm{border-left-color:#E2534B}'
    + '.ntx .ntx-tag{display:inline-block;white-space:nowrap;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;padding:3px 7px;border-radius:6px;border:1px solid}'
    + '.t-add{color:#F5A524;border-color:rgba(245,165,36,.4);background:rgba(245,165,36,.08)}'
    + '.t-move{color:#FF6B1F;border-color:rgba(255,107,31,.4);background:rgba(255,107,31,.08)}'
    + '.t-active{color:#2FBF7E;border-color:rgba(47,191,126,.4);background:rgba(47,191,126,.08)}'
    + '.t-removed{color:#E2534B;border-color:rgba(226,83,75,.4);background:rgba(226,83,75,.08)}'
    + '.t-pending{color:#F5A524;border-color:rgba(245,165,36,.4);background:rgba(245,165,36,.08)}'
    + '.t-early{color:#7FB2FF;border-color:rgba(127,178,255,.4);background:rgba(127,178,255,.08)}'
    + '.t-dim{color:#71717a;border-color:#27272a;background:transparent}'
    + '.ntx .ntx-mail{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#fff;cursor:pointer;border-bottom:1px dashed rgba(255,255,255,.25)}'
    + '.ntx .ntx-mail:hover{color:#FF6B1F;border-color:#FF6B1F}'
    + '.ntx table.ntx-t{width:100%;border-collapse:collapse;font-size:12px}'
    + '.ntx .ntx-t th{text-align:left;font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:900;padding:8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}'
    + '.ntx .ntx-t td{padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.05);color:#a1a1aa;vertical-align:middle}'
    + '.ntx .ntx-t tr.rmrow td{background:rgba(226,83,75,.04)}'
    + '.ntx .ntx-t tr.xrow td{background:rgba(255,255,255,.02);padding:14px}'
    + '.ntx .ntx-scroll{overflow-x:auto}'
    + '.ntx .ntx-chip{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.1);color:#a1a1aa;cursor:pointer;background:transparent}'
    + '.ntx .ntx-chip.on{color:#fff;border-color:rgba(255,107,31,.5);background:rgba(255,107,31,.10)}'
    + '.ntx .ntx-log{font-size:11.5px;color:#a1a1aa;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:10px}'
    + '.ntx .ntx-log .w{color:#52525b;white-space:nowrap;min-width:110px}'
    + '.ntx .ntx-ck{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;font-size:12.5px;font-weight:800;cursor:pointer;'
    +   'border:1px solid rgba(255,255,255,.14);background:#111114;color:#e4e4e7;min-height:40px;box-sizing:border-box;user-select:none}'
    + '.ntx .ntx-ck input{width:17px;height:17px;accent-color:#FF6B1F;margin:0;cursor:pointer}'
    + '.ntx .ntx-ck.on{border-color:rgba(255,107,31,.55);background:rgba(255,107,31,.12);color:#FFC0A0}'
    + '.ntx .ntx-ck.rm.on{border-color:rgba(226,83,75,.55);background:rgba(226,83,75,.12);color:#FCA5A5}'
    + '.ntx .ntx-grp{font-size:11.5px;color:#a1a1aa;font-weight:700;margin:10px 0 6px}'
    + '.ntx .ntx-alert{border:1px solid rgba(226,83,75,.5);background:rgba(226,83,75,.08);border-radius:14px;padding:14px 16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}'
    + '.ntx .ntx-prod{border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin-top:12px}'
    + '.ntx .ntx-prod.live{border-color:rgba(255,107,31,.3)}'
    + '.ntx-toast{position:fixed;bottom:20px;right:20px;z-index:9999;background:#18181b;border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;'
    +   'padding:10px 14px;border-radius:10px;opacity:0;transform:translateY(8px);transition:all .2s;pointer-events:none}'
    + '.ntx-toast.show{opacity:1;transform:none} .ntx-toast.bad{border-color:rgba(226,83,75,.5);color:#E2534B}'
    + '.ntx .ntx-reg{border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden}'
    + '.ntx .ntx-reg-h,.ntx .ntx-reg-line{display:grid;grid-template-columns:2.1fr 2fr 1fr 1.7fr 1.6fr 1.2fr 28px;gap:12px;align-items:center}'
    + '.ntx .ntx-reg-h{padding:10px 16px;background:rgba(255,255,255,.03);font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.12em;font-weight:900}'
    + '.ntx .ntx-reg-row{border-top:1px solid rgba(255,255,255,.06)}'
    + '.ntx .ntx-reg-row.need{background:rgba(245,165,36,.035)} .ntx .ntx-reg-row.rm{background:rgba(226,83,75,.05)} .ntx .ntx-reg-row.ending{background:rgba(245,165,36,.02)}'
    + '.ntx .ntx-reg-row.open{background:rgba(255,255,255,.025)}'
    + '.ntx .ntx-reg-line{width:100%;padding:12px 16px;min-height:58px;background:none;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit}'
    + '.ntx .ntx-reg-line:hover{background:rgba(255,255,255,.02)}'
    + '.ntx .ntx-reg-line span{min-width:0}'
    + '.ntx .c-mem b{display:block;color:#fff;font-size:13.5px} .ntx .c-mem small,.ntx .c-ms small{display:block;color:#71717a;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ntx .c-nt{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ntx .c-plan{font-size:12.5px;color:#d4d4d8}'
    + '.ntx .c-lic{display:flex;flex-direction:column;gap:5px} .ntx .c-lic .dots{display:flex;flex-wrap:wrap;gap:3px}'
    + '.ntx .lt,.ntx .mt{font-size:12.5px;font-weight:800} .ntx .l-ok{color:#2FBF7E} .ntx .l-warn{color:#F5A524} .ntx .l-bad{color:#E2534B} .ntx .l-dim{color:#71717a}'
    + '.ntx .c-st{display:flex;flex-wrap:wrap;gap:4px} .ntx .c-chev{color:#71717a;transition:transform .15s;display:flex;justify-content:center} .ntx .open .c-chev{transform:rotate(180deg)}'
    + '.ntx .ntx-dot{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;border-radius:5px;font:800 9.5px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #27272a;color:#52525b}'
    + '.ntx .ntx-dot.wide{height:auto;padding:3px 7px;letter-spacing:.06em;text-transform:uppercase}'
    + '.ntx .s-held{color:#FFB489;border-color:rgba(255,107,31,.5);background:rgba(255,107,31,.14)}'
    + '.ntx .s-add{color:#F5A524;border-color:rgba(245,165,36,.55);background:rgba(245,165,36,.12)}'
    + '.ntx .s-rm{color:#FCA5A5;border-color:rgba(226,83,75,.55);background:rgba(226,83,75,.12)}'
    + '.ntx .ntx-reg-body{display:flex;flex-wrap:wrap;gap:16px;padding:4px 16px 18px}'
    + '.ntx .ntx-reg-l{flex:3 1 520px;min-width:0} .ntx .ntx-reg-r{flex:1 1 280px;min-width:0}'
    + '.ntx .ntx-pcs{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}'
    + '.ntx .ntx-pc{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#fff}'
    + '.ntx .ntx-pc small{color:#a1a1aa;font-size:11.5px} .ntx .ntx-pc.s-add{background:rgba(245,165,36,.05)} .ntx .ntx-pc.s-rm{background:rgba(226,83,75,.06)}'
    + '.ntx .ntx-pc.s-held,.ntx .ntx-pc.s-add,.ntx .ntx-pc.s-rm{color:#fff}'
    + '.ntx .ntx-facts{border-radius:10px;background:rgba(255,255,255,.03);padding:8px 12px;font-size:12.5px}'
    + '.ntx .ntx-sub{flex:1 1 100%;border-top:1px solid rgba(255,255,255,.06);padding-top:14px}'
    + '@media(max-width:900px){.ntx .ntx-reg-h{display:none}.ntx .ntx-reg-line{grid-template-columns:1fr 1fr;row-gap:8px}.ntx .c-chev{position:absolute;right:16px}.ntx .ntx-reg-line{position:relative;padding-right:40px}}'
    + '.ntx .ntx-grid{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}'
    + '@media(min-width:1024px){.ntx .ntx-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}'
    + '.ntx .ntx-2col{display:grid;gap:16px;grid-template-columns:1fr} @media(min-width:1024px){.ntx .ntx-2col{grid-template-columns:1fr 1fr}}';

  /* ── State ──────────────────────────────────────────────────────────── */
  var TICKS = {};        // email → { 'add:volume': true, 'rm:knightfall': true, 'old:knightfall': true }
  var OPEN = {};         // email → 'remove' | 'edit'  (expanded row in the register)

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
      +   '<div class="text-[11px] text-zinc-600 mt-0.5">You never pick products. The plan does. Do each step in the NinjaTrader Vendor dashboard, tick it here.</div></div>'
      +   '<div class="flex items-center gap-2 flex-wrap">'
      +     '<span id="ntx-updated" class="text-[10px] text-zinc-600"></span>'
      +     '<a id="ntx-vendor-link" class="ntx-btn" target="_blank" rel="noopener" style="display:none">NT Vendor dashboard &#8599;</a>'
      +     '<button class="ntx-btn" onclick="ntLoad()">Refresh</button>'
      +   '</div>'
      + '</div>'
      + '<div id="ntx-alert" class="mb-5" style="display:none"></div>'
      + '<div id="ntx-stats" class="ntx-grid mb-5"></div>'

      + '<div class="ntx-card mb-5" id="ntx-queue-card">'
      +   '<div class="flex items-center justify-between flex-wrap gap-2"><div class="ntx-h">To do</div>'
      +   '<div class="text-[10px] text-zinc-600">removals first, then oldest · amber &lt;12h · orange 12–24h · red &gt;24h</div></div>'
      +   '<div id="ntx-queue" class="text-xs text-zinc-600 mt-2">Loading…</div>'
      + '</div>'

      + '<div class="ntx-card mb-5" id="ntx-members">'
      +   '<div class="flex items-center justify-between flex-wrap gap-2 mb-3">'
      +     '<div class="ntx-h">Members · license register</div>'
      +     '<div class="flex items-center gap-2 flex-wrap" id="ntx-filters"></div>'
      +   '</div>'
      +   '<div class="ntx-scroll"><div id="ntx-register" class="text-xs text-zinc-600">—</div></div>'
      +   '<details class="mt-4"><summary class="text-[11px] text-zinc-400 cursor-pointer font-bold">+ Add a member by hand (existing members, partner, testers)</summary>'
      +   '<div class="flex flex-wrap gap-2 mt-3 items-center">'
      +     '<input id="ntx-a-email" class="ntx-in" placeholder="Site login email" style="flex:1 1 200px">'
      +     '<input id="ntx-a-name" class="ntx-in" placeholder="Name" style="flex:1 1 120px">'
      +     '<input id="ntx-a-nt" class="ntx-in" placeholder="NinjaTrader email" style="flex:1 1 200px">'
      +     '<select id="ntx-a-plan" class="ntx-in"><option value="pro">Full Membership</option><option value="ntsolo">Knightfall NT8</option><option value="raven">Raven</option></select>'
      +   '</div>'
      +   '<div class="text-[11px] text-zinc-400 mt-3 mb-1 font-bold">Already on NinjaTrader for this email (tick what you\'ve added):</div>'
      +   '<div class="flex flex-wrap gap-2" id="ntx-a-held"></div>'
      +   '<div class="flex flex-wrap gap-3 mt-3 items-center">'
      +     '<label class="text-[11px] text-zinc-400 flex items-center gap-1"><input type="checkbox" id="ntx-a-early"> Early access (can download products not released yet)</label>'
      +     '<button class="ntx-btn pri" onclick="ntAdd()">Add member</button>'
      +   '</div></details>'
      + '</div>'

      + '<div class="ntx-card mb-5" id="ntx-products-card">'
      +   '<div class="flex items-center justify-between flex-wrap gap-2"><div class="ntx-h">NT8 products &amp; releases</div>'
      +   '<button class="ntx-btn" onclick="ntToggleNewProduct()">+ Add product</button></div>'
      +   '<div id="ntx-newprod" style="display:none"></div>'
      +   '<div id="ntx-products"></div>'
      + '</div>'

      + '<div class="ntx-2col mb-5">'
      +   '<div class="ntx-card"><div class="ntx-h mb-3">Settings</div><div id="ntx-settings"></div></div>'
      +   '<div class="ntx-card"><div class="ntx-h mb-2">Activity</div><div id="ntx-log" class="text-xs text-zinc-600">—</div></div>'
      + '</div>';
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function isOwnerRec(r) { return D && D.owners && D.owners.indexOf(r.email) !== -1; }
  function prods() { return (D && D.products) || []; }
  function pname(id) { var p = prods().filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }
  function planLabel(r) {
    var g = (D && D.planGroups) || {};
    var map = { pro: 'Full', plus: 'Full', ntsolo: 'Knightfall NT8', raven: 'Raven' };
    var out = [];
    (r.plans || []).forEach(function (p) { var l = map[p] || g[p] || 'Full'; if (out.indexOf(l) === -1) out.push(l); });
    return out.join(' + ') || 'Full';
  }
  function todo(r) { return r.todo || { add: [], remove: [], removeOld: [], from: null }; }
  function hasTodo(r) { var t = todo(r); return t.add.length + t.remove.length + t.removeOld.length > 0; }
  function mail(e) { return '<span class="ntx-mail" data-copy="' + esc(e) + '" title="Click to copy">' + esc(e) + '</span>'; }

  // Something you can act on now. Pending with no NT email = waiting on the member.
  function isTask(r) { return r.status === 'remove' || (r.status === 'pending' && !!r.ntEmail); }
  function isWaiting(r) { return r.status === 'pending' && !r.ntEmail; }
  function isRemoval(r) { var t = todo(r); return r.status === 'remove' || t.remove.length > 0; }
  window.ntIsTask = isTask;

  function stepKeys(r) {
    var t = todo(r), k = [];
    t.removeOld.forEach(function (id) { k.push('old:' + id); });
    t.remove.forEach(function (id) { k.push('rm:' + id); });
    t.add.forEach(function (id) { k.push('add:' + id); });
    return k;
  }
  function ticked(r) {
    var m = TICKS[r.email] || {};
    return stepKeys(r).filter(function (k) { return m[k]; });
  }

  /* ── To do (shared with the Today tab: window.ntTasksHtml) ──────────── */
  function ck(email, key, label, rm) {
    var on = !!(TICKS[email] || {})[key];
    return '<label class="ntx-ck' + (rm ? ' rm' : '') + (on ? ' on' : '') + '"><input type="checkbox" data-tick="' + esc(key) + '" data-e="' + esc(email) + '"' + (on ? ' checked' : '') + '>' + esc(label) + '</label>';
  }

  function taskHtml(r) {
    var h = hoursSince(r.requestedAt || r.createdAt);
    var t = todo(r);
    var rmAll = r.status === 'remove', rm = isRemoval(r), move = t.removeOld.length > 0;
    var cls = (h > 24 ? 'late' : (h > 12 ? 'warn' : '')) + (rm ? ' rm' : '');
    var what = rmAll ? '<span class="ntx-tag t-removed">Remove all licenses</span>'
      : move ? '<span class="ntx-tag t-move">Move licenses</span>'
      : t.remove.length && !t.add.length ? '<span class="ntx-tag t-removed">Plan change · remove</span>'
      : t.add.length ? '<span class="ntx-tag t-add">Add licenses</span>'
      : '<span class="ntx-tag t-add">Check record</span>';
    var steps = '';
    if (t.removeOld.length) {
      steps += '<div class="ntx-grp">1. Remove the OLD email ' + mail(t.from || r.prevNtEmail || '—') + ' from:</div><div class="flex flex-wrap gap-2">'
        + t.removeOld.map(function (id) { return ck(r.email, 'old:' + id, pname(id), true); }).join('') + '</div>';
    }
    if (t.remove.length) {
      steps += '<div class="ntx-grp">' + (rmAll ? 'Remove ' : 'Remove ') + (r.ntEmail ? mail(r.ntEmail) : '<span class="text-red-400">no NT email on file</span>') + ' from:'
        + (rmAll ? ' <span class="text-zinc-600 font-normal">· ' + esc(r.removeReason || 'Membership ended') + '</span>' : ' <span class="text-zinc-600 font-normal">· no longer in their plan</span>') + '</div>'
        + '<div class="flex flex-wrap gap-2">' + t.remove.map(function (id) { return ck(r.email, 'rm:' + id, pname(id), true); }).join('') + '</div>';
    }
    if (t.add.length) {
      steps += '<div class="ntx-grp">' + (move ? '2. ' : '') + 'Add ' + mail(r.ntEmail) + ' to:</div><div class="flex flex-wrap gap-2">'
        + t.add.map(function (id) { return ck(r.email, 'add:' + id, pname(id), false); }).join('') + '</div>';
    }
    if (!t.add.length && !t.remove.length && !t.removeOld.length) {
      steps = '<div class="text-[12px] text-zinc-500 mt-2">Nothing left on the list. Press Refresh. If it stays, open Edit on this member in the register below.</div>';
    }
    var all = stepKeys(r), done = ticked(r).length, full = all.length > 0 && done === all.length;
    var hasAdd = t.add.length > 0;
    var btns = hasAdd
      ? '<button class="ntx-btn pri" data-act="done" data-notify="1" data-e="' + esc(r.email) + '"' + (full ? '' : ' disabled') + '>&#10003; Mark done + email member</button>'
        + '<button class="ntx-btn" data-act="done" data-notify="0" data-e="' + esc(r.email) + '"' + (full ? '' : ' disabled') + ' title="Mark done without emailing">Done, no email</button>'
      : '<button class="ntx-btn ' + (full ? 'badfill' : 'bad') + '" data-act="done" data-notify="0" data-e="' + esc(r.email) + '"' + (full ? '' : ' disabled') + '>&#10003; Mark removed</button>';
    return '<div class="ntx-task ' + cls + '">'
      + '<div class="flex items-start justify-between gap-3 flex-wrap">'
      +   '<div style="min-width:0"><div class="flex items-center gap-2 flex-wrap">' + what
      +     '<span class="text-sm font-black text-white">' + esc(r.name || r.email) + '</span>'
      +     '<span class="text-[11px] text-zinc-400">' + esc(planLabel(r)) + '</span>'
      +     '<span class="text-[11px] text-zinc-600">' + esc(r.email) + '</span></div></div>'
      +   '<div class="text-[11px] font-black ' + (h > 24 ? 'text-red-400' : 'text-zinc-500') + '">waiting ' + ago(r.requestedAt || r.createdAt) + '</div>'
      + '</div>'
      + steps
      + '<div class="flex items-center justify-between gap-2 flex-wrap mt-3">'
      +   '<span class="text-[11px] text-zinc-500">' + done + ' of ' + all.length + ' ticked' + (full ? '' : ' · finish every step to unlock') + '</span>'
      +   '<div class="flex gap-2 flex-wrap justify-end">' + btns + '</div>'
      + '</div></div>';
  }

  function tasksHtml(data) {
    var recs = (data && data.records) || [];
    var list = recs.filter(isTask)
      .sort(function (a, b) {
        var ra = isRemoval(a) ? 0 : 1, rb = isRemoval(b) ? 0 : 1;
        return (ra - rb) || (new Date(a.requestedAt || a.createdAt) - new Date(b.requestedAt || b.createdAt));
      });
    var waitHtml = waitingHtml(recs.filter(isWaiting));
    if (!list.length) return '<div class="text-[12px] text-zinc-500 py-2">Nothing to do. All NinjaTrader licenses match the plans.</div>' + waitHtml;
    return list.map(taskHtml).join('') + waitHtml;
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
            + '<span class="text-[11px] text-zinc-500">' + esc(r.email) + ' · ' + esc(planLabel(r)) + '</span></div>'
            + '<button class="ntx-btn" data-act="setmail" data-e="' + esc(r.email) + '">Set NT email</button>'
            + '<button class="ntx-btn" data-act="decline" data-e="' + esc(r.email) + '">Not using NT</button>'
            + '</div>';
        }).join('')
      + '</details>';
  }
  window.ntTasksHtml = tasksHtml;
  window.ntData = function () { return D; };

  function renderQueue() { $('ntx-queue').innerHTML = tasksHtml(D); }

  /* ── Removal banner ─────────────────────────────────────────────────── */
  function renderAlert() {
    var list = D.records.filter(function (r) { return isTask(r) && isRemoval(r); });
    var soon = D.records.filter(function (r) { return r.status !== 'removed' && r.status !== 'declined' && (r.held || []).length && membership(r).ending; });
    var el = $('ntx-alert');
    var soonHtml = soon.length ? '<div class="ntx-alert" style="border-color:rgba(245,165,36,.45);background:rgba(245,165,36,.06);margin-top:' + (list.length ? '10px' : '0') + '"><div style="min-width:0">'
      + '<div class="text-[13px] font-black" style="color:#F5A524">' + soon.length + ' licensed member' + (soon.length === 1 ? '' : 's') + ' ending soon</div>'
      + '<div class="text-[12px] text-zinc-300 mt-1">' + soon.slice(0, 6).map(function (r) { var m = membership(r); return '<b class="text-white">' + esc(r.name || r.email) + '</b>: ' + esc(m.text); }).join(' · ')
      + '. When it ends you get a removal task here. Nothing to do yet.</div></div>'
      + '<button class="ntx-btn" data-filter="ending" onclick="document.getElementById(\'ntx-members\').scrollIntoView({behavior:\'smooth\'})">Show them</button></div>' : '';
    if (!list.length && !soon.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    if (!list.length) { el.innerHTML = soonHtml; return; }
    el.innerHTML = '<div class="ntx-alert"><div style="min-width:0">'
      + '<div class="text-[14px] font-black" style="color:#FCA5A5">' + list.length + ' NinjaTrader removal' + (list.length === 1 ? '' : 's') + ' waiting</div>'
      + '<div class="text-[12px] text-zinc-300 mt-1">' + list.slice(0, 6).map(function (r) {
          var t = todo(r);
          return '<b class="text-white">' + esc(r.name || r.email) + '</b> (' + esc(planLabel(r)) + '): ' + esc(t.remove.concat(t.removeOld).map(pname).join(', '));
        }).join(' · ') + (list.length > 6 ? ' · and ' + (list.length - 6) + ' more' : '') + '</div></div>'
      + '<button class="ntx-btn badfill" onclick="document.getElementById(\'ntx-queue-card\').scrollIntoView({behavior:\'smooth\'})">Review removals</button></div>' + soonHtml;
  }

  /* ── Stats ──────────────────────────────────────────────────────────── */
  function renderStats() {
    var recs = D.records;
    var pend = recs.filter(isTask);
    var late = pend.filter(function (r) { return hoursSince(r.requestedAt || r.createdAt) > 24; });
    var rms = pend.filter(isRemoval);
    var lic = 0; recs.forEach(function (r) { lic += (r.held || []).length; });
    var dl = (D.downloads && D.downloads.total) || 0;
    function card(n, l, cls) { return '<div class="ntx-stat ' + (cls || '') + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    $('ntx-stats').innerHTML =
        card(pend.length, 'To do', pend.length ? 'amber' : '')
      + card(rms.length, 'Removals', rms.length ? 'red' : '')
      + card(late.length, 'Overdue &gt;24h', late.length ? 'red' : '')
      + card(lic, 'Licenses held (all products)', 'green')
      + card(dl, 'Downloads (all products)');
  }

  /* ── Register (one line per member, click to expand) ────────────────── */
  var EXP = {};          // email → true when the row is expanded

  // Whop membership from the roster the admin already syncs (same data as People).
  var MS_RANK = { past_due: 0, active: 1, yearly: 1, trialing: 2, canceling: 3, trial_cancelled: 3, lifetime: 4, legacy: 4, inactive: 7, cancelled: 8 };
  function roster() { try { return (typeof rosterData !== 'undefined' && Array.isArray(rosterData)) ? rosterData : []; } catch (e) { return []; } }
  function whopFor(email) {
    var e = String(email || '').toLowerCase(), best = null;
    roster().forEach(function (m) {
      if (String(m.email || '').toLowerCase() !== e) return;
      if (!best || (MS_RANK[m.status] == null ? 6 : MS_RANK[m.status]) < (MS_RANK[best.status] == null ? 6 : MS_RANK[best.status])) best = m;
    });
    return best;
  }
  function daysTo(d) {
    if (!d) return null;
    var t = new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).getTime();
    if (isNaN(t)) return null;
    return Math.ceil((t - Date.now()) / 864e5);
  }
  function shortDate(d) {
    if (!d) return '';
    try { return new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }); } catch (e) { return d; }
  }
  /** { text, sub, tone: 'ok'|'warn'|'bad'|'dim', ending: bool, facts: [[k,v]] } */
  function membership(r) {
    var m = whopFor(r.email);
    if (isOwnerRec(r)) return { text: 'Owner', sub: 'Vendor account', tone: 'dim', ending: false, facts: [['Access', 'Owner · always on']] };
    if (!m) return { text: '—', sub: r.source === 'manual' ? 'Added by hand' : 'Not in the Whop roster', tone: 'dim', ending: false, facts: [['Whop', 'No roster record for ' + r.email]] };
    var st = m.status || 'inactive', plan = m.accessType || m.planName || '';
    var facts = [['Plan', plan || '—'], ['Whop status', st.replace(/_/g, ' ')]];
    if (m.joined) facts.push(['Member since', shortDate(m.joined)]);
    var out;
    if (st === 'cancelled' || st === 'inactive') {
      var left = m.leftDate || m.churnedDate;
      out = { text: left ? 'Ended ' + shortDate(left) : 'Ended', sub: m.cancelReason || 'Cancelled', tone: 'bad', ending: false };
      if (left) facts.push(['Ended', shortDate(left)]);
    } else if (st === 'lifetime' || st === 'legacy') {
      out = { text: 'Lifetime', sub: 'No renewal', tone: 'ok', ending: false };
    } else if (st === 'canceling' || st === 'trial_cancelled' || m.cancelAtPeriodEnd) {
      var end = m.cancelingDate || m.renewal, n = daysTo(end);
      out = { text: n == null ? 'Ending' : n <= 0 ? 'Ends today' : 'Ends in ' + n + ' day' + (n === 1 ? '' : 's'),
              sub: (end ? shortDate(end) + ' · ' : '') + 'cancelled, still active', tone: n != null && n <= 2 ? 'bad' : 'warn', ending: n == null || n <= 7 };
      if (end) facts.push(['Access ends', shortDate(end)]);
    } else if (st === 'trialing') {
      var n2 = daysTo(m.renewal);
      out = { text: m.renewal ? 'Trial ends ' + shortDate(m.renewal) : 'Trial', sub: n2 != null ? (n2 <= 0 ? 'converts today' : 'converts in ' + n2 + ' day' + (n2 === 1 ? '' : 's')) : '', tone: n2 != null && n2 <= 7 ? 'warn' : 'ok', ending: n2 != null && n2 <= 7 };
      if (m.renewal) facts.push(['Trial converts', shortDate(m.renewal)]);
    } else if (st === 'past_due') {
      out = { text: 'Past due', sub: 'Whop is retrying the charge', tone: 'bad', ending: true };
    } else {
      out = { text: m.renewal ? 'Renews ' + shortDate(m.renewal) : 'Active', sub: plan, tone: 'ok', ending: false };
      if (m.renewal) facts.push(['Renews', shortDate(m.renewal)]);
    }
    out.facts = facts;
    return out;
  }

  function needsYou(r) { return isTask(r) || isWaiting(r); }
  function prodState(r, p) {
    var t = todo(r), held = (r.held || []).indexOf(p.id) !== -1;
    if (t.remove.indexOf(p.id) !== -1 || t.removeOld.indexOf(p.id) !== -1) return 'rm';
    if (t.add.indexOf(p.id) !== -1) return 'add';
    if (held) return 'held';
    if ((r.entitled || []).indexOf(p.id) !== -1 && !p.live) return 'soon';
    return 'none';
  }
  var PS_WORD = { held: 'Held', add: 'To add', rm: 'To remove', soon: 'Not released', none: 'Not in plan' };
  // Short code for the product squares: first letter of the real name + its version digit (Knightfall MK2 → K2, FSD-X // Volume → V, Stack V1 → S1).
  function initials(name) {
    var n = String(name || '?').replace(/^\s*FSD-X\s*\/\/\s*/i, '').replace(/^\s*ORB\s+/i, '').trim();
    var d = (n.match(/\d/) || [''])[0];
    return (n.charAt(0) + d).toUpperCase();
  }

  function renderFilters() {
    var recs = D.records;
    var count = function (fn) { return recs.filter(fn).length; };
    var opts = [
      ['all', 'All', function () { return true; }],
      ['need', 'Needs attention', needsYou],
      ['ending', 'Ending soon', function (r) { return membership(r).ending; }],
      ['active', 'Active', function (r) { return r.status === 'active'; }],
      ['waiting', 'Waiting', isWaiting],
      ['removed', 'Removed', function (r) { return r.status === 'removed'; }],
      ['declined', 'Not using', function (r) { return r.status === 'declined'; }]
    ];
    renderFilters.opts = opts;
    $('ntx-filters').innerHTML = opts.map(function (o) {
      return '<button class="ntx-chip' + (FILTER === o[0] ? ' on' : '') + '" data-filter="' + o[0] + '">' + o[1] + ' <span style="opacity:.6">' + count(o[2]) + '</span></button>';
    }).join('') + '<input id="ntx-q" class="ntx-in" placeholder="Search" style="width:170px" value="' + esc(QUERY) + '">';
    var q = $('ntx-q');
    q.addEventListener('input', function () { QUERY = q.value.toLowerCase(); renderRegister(); });
  }

  function renderRegister() {
    var P = prods();
    var opt = (renderFilters.opts || []).filter(function (o) { return o[0] === FILTER; })[0];
    var fn = opt ? opt[2] : function () { return true; };
    var rows = D.records.filter(function (r) {
      if (!fn(r)) return false;
      if (QUERY && (r.email + ' ' + (r.ntEmail || '') + ' ' + (r.name || '')).toLowerCase().indexOf(QUERY) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var w = function (r) { return isTask(r) && isRemoval(r) ? 0 : isTask(r) ? 1 : membership(r).ending ? 2 : isWaiting(r) ? 3 : ({ active: 4, removed: 6, declined: 7 }[r.status] || 5); };
      return (w(a) - w(b)) || (a.name || a.email).localeCompare(b.name || b.email);
    });
    if (!rows.length) { $('ntx-register').innerHTML = '<div class="py-3 text-zinc-500">No members here.</div>'; return; }
    $('ntx-register').innerHTML = '<div class="ntx-reg">'
      + '<div class="ntx-reg-h"><span>Member</span><span>NinjaTrader email</span><span>Plan</span><span>Licenses</span><span>Membership</span><span>Status</span><span></span></div>'
      + rows.map(function (r) { return regRow(r, P); }).join('') + '</div>';
  }

  function regRow(r, P) {
    var open = !!EXP[r.email];
    var states = P.map(function (p) { return prodState(r, p); });
    var nAdd = states.filter(function (s) { return s === 'add'; }).length, nRm = states.filter(function (s) { return s === 'rm'; }).length, nHeld = states.filter(function (s) { return s === 'held'; }).length;
    var licText = nRm ? nRm + ' to remove' : nAdd ? nAdd + ' to add' : isWaiting(r) ? 'Waiting on NT email' : nHeld ? 'All ' + nHeld + ' held' : 'None held';
    var licCls = nRm ? 'bad' : (nAdd || isWaiting(r)) ? 'warn' : nHeld ? 'ok' : 'dim';
    var dots = P.map(function (p, i) { return '<span class="ntx-dot s-' + states[i] + '" title="' + esc(p.name + ': ' + PS_WORD[states[i]]) + '">' + esc(initials(p.name)) + '</span>'; }).join('');
    var ms = membership(r);
    var tag = r.status === 'remove' ? '<span class="ntx-tag t-removed">To remove</span>'
      : isWaiting(r) ? '<span class="ntx-tag t-pending">Waiting</span>'
      : r.status === 'declined' ? '<span class="ntx-tag t-dim">Not using</span>'
      : r.status === 'pending' ? (isRemoval(r) ? '<span class="ntx-tag t-removed">To remove</span>' : '<span class="ntx-tag t-pending">To do</span>')
      : '<span class="ntx-tag t-' + esc(r.status) + '">' + esc(r.status) + '</span>';
    var extra = (r.early && !isOwnerRec(r) ? ' <span class="ntx-tag t-early">Early</span>' : '') + (isOwnerRec(r) ? ' <span class="ntx-tag t-early">Owner</span>' : '');
    var cls = 'ntx-reg-row' + (isTask(r) && isRemoval(r) ? ' rm' : needsYou(r) ? ' need' : ms.ending ? ' ending' : '') + (open ? ' open' : '');
    var head = '<button type="button" class="ntx-reg-line" data-act="expand" data-e="' + esc(r.email) + '" aria-expanded="' + (open ? 'true' : 'false') + '">'
      + '<span class="c-mem"><b>' + esc(r.name || r.email) + '</b><small>' + esc(r.email) + '</small></span>'
      + '<span class="c-nt">' + (r.ntEmail ? esc(r.ntEmail) : '<span class="text-red-400">missing</span>') + '</span>'
      + '<span class="c-plan">' + esc(planLabel(r)) + '</span>'
      + '<span class="c-lic"><span class="lt l-' + licCls + '">' + esc(licText) + '</span><span class="dots">' + dots + '</span></span>'
      + '<span class="c-ms"><span class="mt l-' + ms.tone + '">' + esc(ms.text) + '</span><small>' + esc(ms.sub || '') + '</small></span>'
      + '<span class="c-st">' + tag + extra + '</span>'
      + '<span class="c-chev" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>'
      + '</button>';
    if (!open) return '<div class="' + cls + '">' + head + '</div>';

    var cards = P.map(function (p, i) {
      var s = states[i];
      var v = (r.lastVersions || {})[p.id] || (p.id === 'knightfall' ? r.lastVersion : null);
      var sub = s === 'held' ? (v ? 'Downloaded v' + v + (p.current && v !== p.current ? ' · current is v' + p.current : '') : (p.current ? 'Not downloaded yet' : 'No release yet'))
        : s === 'add' ? 'Add ' + (r.ntEmail || 'their email') + ' in the Vendor dashboard'
        : s === 'rm' ? 'Remove it in the Vendor dashboard'
        : s === 'soon' ? 'Gets an Add task when it goes live'
        : 'Their plan doesn\'t include it';
      return '<div class="ntx-pc s-' + s + '"><div class="flex items-center justify-between gap-2"><b>' + esc(p.name) + '</b><span class="ntx-dot wide s-' + s + '">' + PS_WORD[s] + '</span></div><small>' + esc(sub) + '</small></div>';
    }).join('');
    var task = isTask(r) && hasTodo(r) ? '<div class="mt-3">' + taskHtml(r) + '</div>' : '';
    var waiting = isWaiting(r) ? '<div class="text-[12px] text-zinc-400 mt-3">No NinjaTrader email yet. <button class="ntx-btn" data-act="setmail" data-e="' + esc(r.email) + '">Set NT email</button> <button class="ntx-btn" data-act="decline" data-e="' + esc(r.email) + '">Not using NT</button></div>' : '';
    var facts = (ms.facts || []).map(function (f) { return '<div class="flex justify-between gap-3 py-1"><span class="text-zinc-500">' + esc(f[0]) + '</span><span class="text-zinc-100 font-bold text-right">' + esc(f[1]) + '</span></div>'; }).join('');
    var lastDl = r.downloads && r.downloads[0] ? '<div class="flex justify-between gap-3 py-1"><span class="text-zinc-500">Last download</span><span class="text-zinc-100 font-bold text-right">' + fmt(r.downloads[0].at) + ' · ' + esc(pname(r.downloads[0].p || 'knightfall')) + '</span></div>' : '';
    var holds = (r.held || []).length > 0 || todo(r).removeOld.length > 0;
    var acts = '<button class="ntx-btn" data-act="openedit" data-e="' + esc(r.email) + '">Edit</button>'
      + (isOwnerRec(r) ? '' : '<button class="ntx-btn" data-act="early" data-e="' + esc(r.email) + '">' + (r.early ? 'Early off' : 'Early on') + '</button>')
      + (r.status === 'removed' || r.status === 'declined' ? '<button class="ntx-btn" data-act="pending" data-e="' + esc(r.email) + '">Re-add</button>' : '')
      + (holds && !isOwnerRec(r) ? '<button class="ntx-btn bad" data-act="openremove" data-e="' + esc(r.email) + '">Remove all licenses</button>' : '')
      + (isOwnerRec(r) ? '' : '<button class="ntx-btn bad" data-act="delete" data-e="' + esc(r.email) + '" title="Delete record">&times;</button>');
    var sub = OPEN[r.email] === 'remove' ? '<div class="ntx-sub">' + removeBox(r) + '</div>' : OPEN[r.email] === 'edit' ? '<div class="ntx-sub">' + editBox(r) + '</div>' : '';
    var body = '<div class="ntx-reg-body">'
      + '<div class="ntx-reg-l"><div class="ntx-h mb-2">Licenses on NinjaTrader</div><div class="ntx-pcs">' + cards + '</div>' + task + waiting + '</div>'
      + '<div class="ntx-reg-r"><div class="ntx-h mb-2">Membership</div><div class="ntx-facts">' + facts + lastDl
      + (r.note ? '<div class="flex justify-between gap-3 py-1"><span class="text-zinc-500">Note</span><span class="text-zinc-100 text-right">' + esc(r.note) + '</span></div>' : '') + '</div>'
      + '<div class="flex flex-wrap gap-2 mt-3">' + acts + '</div></div>'
      + sub + '</div>';
    return '<div class="' + cls + '">' + head + body + '</div>';
  }

  // Remove all licenses: every product this member holds, ticked one by one.
  function removeBox(r) {
    var t = todo(r);
    var held = (r.held || []).slice();
    var keys = held.map(function (id) { return 'rmall:' + id; }).concat(t.removeOld.map(function (id) { return 'rmallold:' + id; }));
    var m = TICKS[r.email] || {};
    var done = keys.filter(function (k) { return m[k]; }).length, full = done === keys.length;
    return '<div class="text-[12.5px] text-white font-bold mb-1">Remove ' + (r.ntEmail ? mail(r.ntEmail) : 'this member') + ' from every product in the Vendor dashboard, then tick each one:</div>'
      + '<div class="flex flex-wrap gap-2 mt-2">' + held.map(function (id) { return ck(r.email, 'rmall:' + id, pname(id), true); }).join('') + '</div>'
      + (t.removeOld.length ? '<div class="ntx-grp">And the old email ' + mail(t.from || '') + ' from:</div><div class="flex flex-wrap gap-2">'
          + t.removeOld.map(function (id) { return ck(r.email, 'rmallold:' + id, pname(id), true); }).join('') + '</div>' : '')
      + '<div class="flex items-center gap-2 flex-wrap mt-3">'
      +   '<input id="ntx-rm-note-' + esc(r.email) + '" class="ntx-in" placeholder="Reason (optional)" style="flex:1 1 220px" value="' + esc(r.status === 'remove' ? (r.removeReason || 'Membership ended') : '') + '">'
      +   '<span class="text-[11px] text-zinc-500">' + done + ' of ' + keys.length + ' ticked</span>'
      +   '<button class="ntx-btn ' + (full ? 'badfill' : 'bad') + '" data-act="removeall" data-e="' + esc(r.email) + '"' + (full ? '' : ' disabled') + '>&#10003; Mark all removed</button>'
      +   '<button class="ntx-btn" data-act="close" data-e="' + esc(r.email) + '">Cancel</button>'
      + '</div>';
  }

  // Edit: NT email, plan, note, and — to fix a mismatch — what is on NinjaTrader.
  function editBox(r) {
    var id = esc(r.email);
    var plan = (r.plans || [])[0] || 'pro'; if (plan === 'plus') plan = 'pro';
    return '<div class="flex flex-wrap gap-2 items-center">'
      + '<input id="ntx-e-nt-' + id + '" class="ntx-in" placeholder="NinjaTrader email" style="flex:1 1 220px" value="' + esc(r.ntEmail || '') + '">'
      + '<input id="ntx-e-name-' + id + '" class="ntx-in" placeholder="Name" style="flex:1 1 140px" value="' + esc(r.name || '') + '">'
      + '<select id="ntx-e-plan-' + id + '" class="ntx-in">'
      +   [['pro', 'Full Membership'], ['ntsolo', 'Knightfall NT8'], ['raven', 'Raven']].map(function (o) { return '<option value="' + o[0] + '"' + (plan === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
      + '</select>'
      + '<input id="ntx-e-note-' + id + '" class="ntx-in" placeholder="Note" style="flex:1 1 200px" value="' + esc(r.note || '') + '">'
      + '</div>'
      + '<div class="text-[11px] text-zinc-400 mt-3 mb-1 font-bold">On NinjaTrader right now for this email <span class="font-normal text-zinc-600">· only change this to match the Vendor dashboard</span></div>'
      + '<div class="flex flex-wrap gap-2">' + prods().map(function (p) {
          var on = (r.held || []).indexOf(p.id) !== -1;
          return '<label class="ntx-ck' + (on ? ' on' : '') + '"><input type="checkbox" data-held="' + esc(p.id) + '" data-e="' + id + '"' + (on ? ' checked' : '') + '>' + esc(p.name) + '</label>';
        }).join('') + '</div>'
      + '<div class="text-[11px] text-zinc-500 mt-2">Changing the NinjaTrader email moves every license: you get a Move task to remove the old email and add the new one.</div>'
      + '<div class="flex gap-2 mt-3"><button class="ntx-btn pri" data-act="saveedit" data-e="' + id + '">Save</button>'
      + '<button class="ntx-btn" data-act="close" data-e="' + id + '">Cancel</button></div>';
  }

  /* ── Products & releases ────────────────────────────────────────────── */
  function groupNames(plans) {
    var g = (D && D.planGroups) || {};
    return (plans || []).map(function (x) { return g[x] || x; }).join(' · ');
  }
  function eligibleCount(pid) {
    return D.records.filter(function (r) { return r.status !== 'removed' && r.status !== 'declined' && r.status !== 'remove' && (r.entitled || []).indexOf(pid) !== -1; }).length;
  }
  function renderProducts() {
    var g = (D && D.planGroups) || {};
    $('ntx-products').innerHTML = prods().map(function (p) {
      var pid = esc(p.id);
      var rels = p.releases || [];
      var relHtml = rels.length ? rels.map(function (r) {
        var isCur = r.version === p.current;
        var onIt = D.records.filter(function (x) { return ((x.lastVersions || {})[p.id] || (p.id === 'knightfall' ? x.lastVersion : null)) === r.version; }).length;
        return '<div class="flex items-center gap-2 py-2 border-b border-white/5 flex-wrap">'
          + '<div style="flex:1 1 160px"><span class="text-white font-black text-sm">v' + esc(r.version) + '</span> '
          + (isCur ? '<span class="ntx-tag t-active">Current</span>' : '')
          + '<div class="text-[10.5px] text-zinc-600">' + fmt(r.uploadedAt) + ' · ' + Math.round(r.size / 1024) + ' KB · '
          + '<b class="text-zinc-300">' + (r.downloads || 0) + '</b> downloads (' + (r.uniqueDownloads || 0) + ' members) · ' + onIt + ' on it now</div>'
          + (r.notes ? '<div class="text-[11px] text-zinc-500 mt-1" style="white-space:pre-line">' + esc(r.notes) + '</div>' : '') + '</div>'
          + '<button class="ntx-btn" data-rel="dl" data-p="' + pid + '" data-v="' + esc(r.version) + '">Download</button>'
          + (isCur ? '' : '<button class="ntx-btn" data-rel="cur" data-p="' + pid + '" data-v="' + esc(r.version) + '">Make current</button>'
                        + '<button class="ntx-btn bad" data-rel="del" data-p="' + pid + '" data-v="' + esc(r.version) + '">Delete</button>')
          + '</div>';
      }).join('') : '<div class="text-[12px] text-zinc-500 py-2">No releases yet.</div>';
      var liveBtn = p.live
        ? '<button class="ntx-btn" data-prod="offline" data-p="' + pid + '">Take offline</button>'
        : '<button class="ntx-btn pri" data-prod="live" data-p="' + pid + '"' + (rels.length ? '' : ' disabled title="Upload a release first"') + '>Set live</button>';
      return '<div class="ntx-prod' + (p.live ? ' live' : '') + '">'
        + '<div class="flex items-start justify-between gap-3 flex-wrap">'
        +   '<div style="min-width:0"><div class="flex items-center gap-2 flex-wrap"><span class="text-[15px] font-black text-white">' + esc(p.name) + '</span>'
        +     (p.live ? '<span class="ntx-tag t-active">Live</span>' : '<span class="ntx-tag t-dim">Not released</span>')
        +     (p.current ? '<span class="text-[11px] text-zinc-400">current v' + esc(p.current) + '</span>' : '') + '</div>'
        +   '<div class="text-[11.5px] text-zinc-400 mt-1">Included in: ' + esc(groupNames(p.plans)) + '</div>'
        +   '<div class="text-[11px] text-zinc-600 mt-0.5">' + (p.licensed || 0) + ' licensed · ' + eligibleCount(p.id) + ' members on a plan that includes it · ' + (p.downloads || 0) + ' downloads</div></div>'
        +   '<div class="flex gap-2 flex-wrap">' + liveBtn
        +     '<button class="ntx-btn" data-prod="toggleup" data-p="' + pid + '">Upload new version</button>'
        +     '<button class="ntx-btn" data-prod="toggleplans" data-p="' + pid + '">Plans</button></div>'
        + '</div>'
        + '<div id="ntx-up-' + pid + '" style="display:none" class="mt-3">'
        +   '<div class="flex flex-wrap gap-2 items-center">'
        +     '<input id="ntx-r-ver-' + pid + '" class="ntx-in" placeholder="Version e.g. 1.1.0" style="width:150px">'
        +     '<input id="ntx-r-file-' + pid + '" type="file" accept=".zip" class="text-[11px] text-zinc-400" style="flex:1 1 180px">'
        +   '</div>'
        +   '<textarea id="ntx-r-notes-' + pid + '" class="ntx-in mt-2" placeholder="What changed (members see this)"></textarea>'
        +   '<div class="flex items-center justify-between mt-2 gap-2 flex-wrap">'
        +     '<label class="text-[11px] text-zinc-400 flex items-center gap-1"><input type="checkbox" id="ntx-r-cur-' + pid + '" checked> Make current (members see Update available)</label>'
        +     '<button id="ntx-r-btn-' + pid + '" class="ntx-btn pri" data-prod="upload" data-p="' + pid + '">Upload ' + esc(p.name) + ' release</button>'
        +   '</div>'
        +   '<div class="text-[10.5px] text-zinc-600 mt-2">Upload the PROTECTED export zip only. Never the source.</div>'
        + '</div>'
        + '<div id="ntx-pl-' + pid + '" style="display:none" class="mt-3"><div class="text-[11px] text-zinc-400 font-bold mb-2">Included in</div><div class="flex flex-wrap gap-2">'
        +   Object.keys(g).map(function (k) { var on = (p.plans || []).indexOf(k) !== -1;
              return '<label class="ntx-ck' + (on ? ' on' : '') + '"><input type="checkbox" data-plan="' + esc(k) + '" data-p="' + pid + '"' + (on ? ' checked' : '') + '>' + esc(g[k]) + '</label>'; }).join('')
        +   '</div><div class="flex gap-2 mt-2"><button class="ntx-btn pri" data-prod="saveplans" data-p="' + pid + '">Save plans</button>'
        +   '<span class="text-[11px] text-zinc-500 self-center">If it\'s live, members on a newly ticked plan get an Add task.</span></div></div>'
        + '<details class="mt-3"' + (rels.length && rels.length < 4 ? ' open' : '') + '><summary class="text-[11px] text-zinc-400 cursor-pointer font-bold">Releases (' + rels.length + ')</summary>' + relHtml + '</details>'
        + '</div>';
    }).join('');
  }

  window.ntToggleNewProduct = function () {
    var el = $('ntx-newprod');
    if (el.style.display !== 'none') { el.style.display = 'none'; return; }
    var g = (D && D.planGroups) || {};
    el.style.display = '';
    el.innerHTML = '<div class="ntx-prod live">'
      + '<div class="flex flex-wrap gap-2"><input id="ntx-np-name" class="ntx-in" placeholder="Product name, e.g. Stack V2" style="flex:1 1 220px">'
      + '<input id="ntx-np-blurb" class="ntx-in" placeholder="One line members see on the hub" style="flex:2 1 300px"></div>'
      + '<div class="text-[11px] text-zinc-400 font-bold mt-3 mb-2">Included in</div><div class="flex flex-wrap gap-2">'
      + Object.keys(g).map(function (k) { return '<label class="ntx-ck' + (k === 'full' ? ' on' : '') + '"><input type="checkbox" data-np="' + esc(k) + '"' + (k === 'full' ? ' checked' : '') + '>' + esc(g[k]) + '</label>'; }).join('')
      + '</div><div class="text-[11px] text-zinc-500 mt-2">It saves as Not released. Upload its first release, then Set live: every member whose plan includes it gets an Add task.</div>'
      + '<div class="flex gap-2 mt-3"><button class="ntx-btn pri" onclick="ntSaveNewProduct()">Save product</button>'
      + '<button class="ntx-btn" onclick="ntToggleNewProduct()">Cancel</button></div></div>';
  };
  window.ntSaveNewProduct = function () {
    var plans = [].slice.call(document.querySelectorAll('[data-np]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-np'); });
    post('/api/admin/nt/product', { name: $('ntx-np-name').value.trim(), blurb: $('ntx-np-blurb').value.trim(), plans: plans })
      .then(function (d) { toast(d.product.name + ' added · not released yet'); $('ntx-newprod').style.display = 'none'; ntLoad(); })
      .catch(function (e) { toast(e.message, true); });
  };

  /* ── Settings / log ─────────────────────────────────────────────────── */
  function renderSettings() {
    $('ntx-settings').innerHTML =
        '<div class="text-[11px] text-zinc-500 py-1">Each product has its own Live switch in <b class="text-zinc-300">NT8 products &amp; releases</b>. Not released = only owners and Early members can download it.</div>'
      + '<div class="text-[11px] text-zinc-500 py-2">Email and phone alerts for NinjaTrader tasks are set in <a class="text-green-400 font-bold cursor-pointer" onclick="switchTab(\'alerts\')">Alerts</a>.</div>'
      + '<div class="mt-3 pt-3 border-t border-white/5"><div class="text-[12px] text-white font-bold mb-1">NinjaTrader Vendor dashboard link</div>'
      + '<div class="text-[11px] text-zinc-500 mb-2">Paste the URL of your Manage Add-Ons page. Saved in this browser.</div>'
      + '<div class="flex gap-2"><input id="ntx-s-vendor" class="ntx-in" style="flex:1" placeholder="https://…" value="' + esc(vendorUrl()) + '">'
      + '<button class="ntx-btn" onclick="ntSaveVendor()">Save</button></div></div>'
      + '<div class="mt-4 pt-3 border-t border-white/5 text-[11px] text-zinc-500">Owner logins (always have every product): '
      + (D.owners || []).map(esc).join(', ') + '. Add more with the <span class="text-zinc-300">NT_OWNER_EMAILS</span> worker variable.</div>';
  }

  var LOG_LABEL = {
    request: 'Requested license', email_change: 'Changed NT email', activated: 'Licenses marked added',
    removed: 'Licenses marked removed', set_pending: 'Moved back to To do', download: 'Downloaded',
    release: 'Release uploaded', release_current: 'Current release set', release_delete: 'Release deleted',
    admin_add: 'Added by admin', remove_queued: 'Removal queued (membership ended)', remove_cancelled: 'Removal cancelled (back active)',
    declined: 'Marked not using NT', admin_update: 'Edited by admin', admin_delete: 'Record deleted', settings: 'Settings changed',
    product_add: 'Product added', product_update: 'Product changed', product_live: 'Product went live',
    plan_removed: 'Plan ended (other plans stay)', plan_end_ignored: 'Plan end ignored'
  };
  function renderLog() {
    var log = D.log || [];
    if (!log.length) { $('ntx-log').innerHTML = '<div class="text-zinc-500 py-2">No activity yet.</div>'; return; }
    $('ntx-log').innerHTML = log.slice(0, 60).map(function (l) {
      return '<div class="ntx-log"><span class="w">' + fmt(l.at) + '</span><span><b class="text-zinc-200">' + esc(LOG_LABEL[l.type] || l.type) + '</b> · '
        + esc(l.email || '') + (l.detail ? ' <span class="text-zinc-600">· ' + esc(l.detail) + '</span>' : '') + '</span></div>';
    }).join('');
  }

  function renderAddHeld() {
    var el = $('ntx-a-held'); if (!el) return;
    el.innerHTML = prods().map(function (p) {
      return '<label class="ntx-ck"><input type="checkbox" data-addheld="' + esc(p.id) + '">' + esc(p.name) + '</label>';
    }).join('');
  }

  function renderAll() {
    // Drop ticks for steps that no longer exist (task finished or changed).
    D.records.forEach(function (r) {
      var m = TICKS[r.email]; if (!m) return;
      var keep = {}, keys = stepKeys(r);
      Object.keys(m).forEach(function (k) { if (keys.indexOf(k) !== -1 || k.indexOf('rmall') === 0) keep[k] = m[k]; });
      TICKS[r.email] = keep;
    });
    renderAlert(); renderStats(); renderQueue(); renderFilters(); renderRegister(); renderProducts(); renderSettings(); renderLog();
    if (!$('ntx-a-held').children.length) renderAddHeld();
    var v = vendorUrl(), a = $('ntx-vendor-link');
    if (v) { a.href = v; a.style.display = ''; } else { a.style.display = 'none'; }
    $('ntx-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';
    setBadges(D.records.filter(isTask).length);
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
  function rerenderTasks() {
    renderQueue(); renderRegister();
    var td = $('td-tasks'); if (td && window.ntTasksHtml) td.innerHTML = tasksHtml(D);
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var k = el.getAttribute('data-tick');
    if (k) {
      var em = el.getAttribute('data-e');
      TICKS[em] = TICKS[em] || {};
      TICKS[em][k] = el.checked;
      rerenderTasks();
      return;
    }
    if (el.hasAttribute('data-held') || el.hasAttribute('data-plan') || el.hasAttribute('data-np') || el.hasAttribute('data-addheld')) {
      var lab = el.closest('label'); if (lab) lab.classList.toggle('on', el.checked);
    }
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-copy],[data-act],[data-rel],[data-filter],[data-bulk],[data-prod]') : null;
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

    var pid = el.getAttribute('data-p');
    if (el.hasAttribute('data-rel')) {
      var v = el.getAttribute('data-v'), k = el.getAttribute('data-rel');
      if (k === 'dl') return adminDownload(pid, v);
      if (k === 'cur') return post('/api/admin/nt/release/current', { product: pid, version: v }).then(function () { toast(pname(pid) + ' v' + v + ' is current'); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      if (k === 'del') {
        if (!window.confirm('Delete ' + pname(pid) + ' v' + v + '? Members can no longer download it.')) return;
        return api('/api/admin/nt/release?p=' + encodeURIComponent(pid) + '&v=' + encodeURIComponent(v), { method: 'DELETE' }).then(function () { toast('Deleted'); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      }
      return;
    }

    if (el.hasAttribute('data-prod')) {
      var a = el.getAttribute('data-prod');
      if (a === 'toggleup') { var u = $('ntx-up-' + pid); u.style.display = u.style.display === 'none' ? '' : 'none'; return; }
      if (a === 'toggleplans') { var pl = $('ntx-pl-' + pid); pl.style.display = pl.style.display === 'none' ? '' : 'none'; return; }
      if (a === 'upload') return upload(pid);
      if (a === 'live') {
        var n = eligibleCount(pid);
        if (!window.confirm('Set ' + pname(pid) + ' live?\nMembers can download it, and ' + n + ' member' + (n === 1 ? '' : 's') + ' on a plan that includes it get an Add task.')) return;
        el.disabled = true;
        return post('/api/admin/nt/product', { id: pid, live: true }).then(function (d) { toast(pname(pid) + ' is live · ' + (d.queued || 0) + ' to add'); ntLoad(); })
          .catch(function (x) { el.disabled = false; toast(x.message, true); });
      }
      if (a === 'offline') {
        if (!window.confirm('Take ' + pname(pid) + ' offline? Members can no longer download it. Licenses on NinjaTrader are not touched.')) return;
        return post('/api/admin/nt/product', { id: pid, live: false }).then(function () { toast(pname(pid) + ' offline'); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      }
      if (a === 'saveplans') {
        var plans = [].slice.call(document.querySelectorAll('[data-plan][data-p="' + pid + '"]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-plan'); });
        return post('/api/admin/nt/product', { id: pid, plans: plans }).then(function (d) { toast('Saved' + (d.queued ? ' · ' + d.queued + ' to add' : '')); ntLoad(); }).catch(function (x) { toast(x.message, true); });
      }
      return;
    }

    var em = el.getAttribute('data-e'), act = el.getAttribute('data-act'), r = find(em);
    if (!r) return;
    if (act === 'expand') { if (EXP[em]) { delete EXP[em]; delete OPEN[em]; } else EXP[em] = true; renderRegister(); return; }
    if (act === 'openremove' || act === 'openedit') { EXP[em] = true; OPEN[em] = act === 'openremove' ? 'remove' : 'edit'; renderRegister(); return; }
    if (act === 'close') { delete OPEN[em]; renderRegister(); return; }

    el.disabled = true;
    var p;
    if (act === 'done') {
      var t = todo(r), m = TICKS[em] || {};
      var body = {
        add: t.add.filter(function (id) { return m['add:' + id]; }),
        remove: t.remove.filter(function (id) { return m['rm:' + id]; }),
        removeOld: t.removeOld.filter(function (id) { return m['old:' + id]; })
      };
      if (body.add.length + body.remove.length + body.removeOld.length !== stepKeys(r).length) { el.disabled = false; toast('Tick every step first', true); return; }
      var notify = el.getAttribute('data-notify') === '1';
      p = lic(em, 'done', { done: body, notify: notify }).then(function (d) {
        delete TICKS[em];
        toast(body.add.length ? (d.emailed ? 'Marked added · email sent' : 'Marked added') : 'Marked removed');
      });
    } else if (act === 'removeall') {
      var held = r.held || [], mm = TICKS[em] || {};
      var keys = held.map(function (id) { return 'rmall:' + id; }).concat(todo(r).removeOld.map(function (id) { return 'rmallold:' + id; }));
      if (keys.some(function (k2) { return !mm[k2]; })) { el.disabled = false; toast('Tick every product first', true); return; }
      var noteEl = $('ntx-rm-note-' + em);
      p = lic(em, 'remove', { note: noteEl ? noteEl.value.trim() : '' }).then(function () { delete TICKS[em]; delete OPEN[em]; toast('All licenses marked removed'); });
    } else if (act === 'saveedit') {
      var heldNow = [].slice.call(document.querySelectorAll('[data-held][data-e="' + em.replace(/"/g, '\\"') + '"]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-held'); });
      var before = (r.held || []).slice().sort().join(',');
      var payload = {
        ntEmail: $('ntx-e-nt-' + em).value.trim(), name: $('ntx-e-name-' + em).value.trim(),
        plan: $('ntx-e-plan-' + em).value, note: $('ntx-e-note-' + em).value.trim()
      };
      if (heldNow.slice().sort().join(',') !== before) {
        if (!window.confirm('Change what\'s recorded as on NinjaTrader for ' + em + '?\nOnly do this to match the Vendor dashboard.')) { el.disabled = false; return; }
        payload.held = heldNow;
      }
      p = lic(em, 'update', payload).then(function () { delete OPEN[em]; toast('Saved'); });
    } else if (act === 'setmail') {
      var nm = window.prompt('NinjaTrader email for ' + em + ':', r.ntEmail || '');
      if (nm === null) { el.disabled = false; return; }
      p = lic(em, 'update', { ntEmail: nm.trim() }).then(function () { toast('Saved'); });
    } else if (act === 'decline') {
      p = lic(em, 'decline').then(function () { toast('Dismissed · not using NinjaTrader'); });
    } else if (act === 'pending') {
      p = lic(em, 'pending').then(function () { toast('Moved to To do'); });
    } else if (act === 'early') {
      p = lic(em, 'update', { early: !r.early }).then(function () { toast(r.early ? 'Early access off' : 'Early access on'); });
    } else if (act === 'delete') {
      if (!window.confirm('Delete ' + em + ' from the register? This does not touch NinjaTrader.')) { el.disabled = false; return; }
      p = lic(em, 'delete').then(function () { toast('Deleted'); });
    }
    if (p) p.then(function () { ntLoad(); if (window.todayLoad && inToday) todayLoad(); })
      .catch(function (x) { el.disabled = false; toast(x.message, true); });
    else el.disabled = false;
  }

  function adminDownload(pid, v) {
    fetch(API + '/api/admin/nt/download?p=' + encodeURIComponent(pid) + '&v=' + encodeURIComponent(v), { headers: { 'Authorization': 'Bearer ' + tok() } })
      .then(function (r) {
        if (!r.ok) throw new Error('Download failed');
        var cd = r.headers.get('Content-Disposition') || '', m = /filename="([^"]+)"/.exec(cd);
        return r.blob().then(function (b) { return { b: b, name: m ? m[1] : (pid + '_v' + v + '.zip') }; });
      })
      .then(function (x) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(x.b);
        a.download = x.name; document.body.appendChild(a); a.click(); a.remove();
      }).catch(function (e) { toast(e.message, true); });
  }

  function upload(pid) {
    var ver = $('ntx-r-ver-' + pid).value.trim(), f = $('ntx-r-file-' + pid).files[0];
    if (!ver || !f) { toast('Version and zip required', true); return; }
    if (!/\.zip$/i.test(f.name)) { toast('Pick the .zip export', true); return; }
    var fd = new FormData();
    fd.append('product', pid); fd.append('file', f); fd.append('version', ver);
    fd.append('notes', $('ntx-r-notes-' + pid).value); fd.append('makeCurrent', $('ntx-r-cur-' + pid).checked ? 'true' : 'false');
    var b = $('ntx-r-btn-' + pid); b.disabled = true; b.textContent = 'Uploading…';
    api('/api/admin/nt/release', { method: 'POST', body: fd }).then(function (d) {
      toast(pname(pid) + ' v' + d.version + ' uploaded' + (d.live ? '' : ' · press Set live when ready'));
      ntLoad();
    }).catch(function (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Upload release'; });
  }

  window.ntAdd = function () {
    var email = $('ntx-a-email').value.trim();
    if (!email) { toast('Site email required', true); return; }
    var held = [].slice.call(document.querySelectorAll('[data-addheld]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-addheld'); });
    lic(email, 'add', {
      name: $('ntx-a-name').value.trim(), ntEmail: $('ntx-a-nt').value.trim(),
      plan: $('ntx-a-plan').value, held: held, early: $('ntx-a-early').checked
    }).then(function () {
      toast('Added'); ['ntx-a-email', 'ntx-a-name', 'ntx-a-nt'].forEach(function (i) { $(i).value = ''; });
      renderAddHeld(); ntLoad();
    }).catch(function (e) { toast(e.message, true); });
  };

  window.ntSaveVendor = function () {
    try { localStorage.setItem('ntx_vendor_url', $('ntx-s-vendor').value.trim()); } catch (e) {}
    toast('Saved'); renderAll();
  };

  window.ntLoad = function () {
    skeleton();
    return api('/api/admin/nt').then(function (d) {
      if (!d.products) throw new Error('Old worker version — deploy the new nexus-nt.js');
      D = d; renderAll();
    }).catch(function (e) {
      $('ntx-queue').innerHTML = '<div class="text-[12px] text-red-400 py-2">Couldn\'t load: ' + esc(e.message) + '. Make sure the worker is deployed with nexus-nt.js.</div>';
    });
  };

  // Runs on its own: refresh the badge + panel every 2 minutes while admin is open.
  // Skips the panel refresh while you're mid-task so ticks and open rows stay put.
  function busy() { return Object.keys(OPEN).length > 0 || Object.keys(TICKS).some(function (k) { return Object.keys(TICKS[k]).some(function (x) { return TICKS[k][x]; }); }); }
  function startAuto() {
    if (TIMER) return;
    TIMER = setInterval(function () {
      var p = $('panel-nt');
      if (!tok()) return;
      if (p && p.classList.contains('active') && !busy()) ntLoad();
      else api('/api/admin/nt').then(function (d) { if (!d.products) return; if (!busy()) D = d; setBadges(d.records.filter(isTask).length); }).catch(function () {});
    }, 120000);
  }

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('DOMContentLoaded', function () {
    skeleton();
    // Prime the nav badge once the admin session exists.
    setTimeout(function () { if (tok()) api('/api/admin/nt').then(function (d) { if (!d.products) return; D = d; renderAll(); }).catch(function () {}); }, 1500);
    startAuto();
  });
})();
