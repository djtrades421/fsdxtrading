// alerts.js — FSD-X Scout alerts on the site
//
// Step 1 of the alert system: the toast itself. Drops a card into the
// bottom-right corner when Scout fires, the same way the Discord webhook does.
// Nothing here talks to a server yet — feed polling gets wired in once the
// Worker endpoint exists. FSDXAlerts.demo() fires a sample sequence so the
// look can be judged before any of that is built.
//
//   FSDXAlerts.show({
//     type:  'breakout' | 'brewing' | 'vwap' | 'tp' | 'sl' | 'level' | 'info',
//     dir:   'BULL' | 'BEAR' | '',
//     title: 'BULL ORB Breakout',
//     sub:   'MNQ1!',                     // symbol / context line
//     grade: 'A+',                        // optional pill
//     lines: [['Entry','20145.25'], ...], // optional detail rows
//     id:    'scout-123',                 // optional; dedupes across pages
//     ttl:   12000                        // optional; 0 = stays until dismissed
//   });

(function () {
  'use strict';

  var STACK_ID = 'fsdx-alert-stack';
  var SEEN_KEY = 'fsdx_alert_seen';
  var MUTE_KEY = 'fsdx_alert_muted';
  var ON_KEY = 'fsdx_alert_enabled';
  var TYPES_KEY = 'fsdx_alert_types';
  var ALL_TYPES = ['breakout','brewing','vwap','level','tp','sl','info'];
  var MAX_VISIBLE = 3;

  // Type drives the accent colour and icon. Direction wins where it applies —
  // a bear breakout should never render green.
  var TYPES = {
    breakout: { accent: '#22c55e', icon: 'bolt',  ring: 'rgba(34,197,94,.35)' },
    brewing:  { accent: '#f59e0b', icon: 'eye',   ring: 'rgba(245,158,11,.35)' },
    vwap:     { accent: '#38bdf8', icon: 'bolt',  ring: 'rgba(56,189,248,.35)' },
    level:    { accent: '#eab308', icon: 'flag',  ring: 'rgba(234,179,8,.35)' },
    tp:       { accent: '#22c55e', icon: 'check', ring: 'rgba(34,197,94,.35)' },
    sl:       { accent: '#ef4444', icon: 'stop',  ring: 'rgba(239,68,68,.35)' },
    info:     { accent: '#a1a1aa', icon: 'info',  ring: 'rgba(161,161,170,.3)' }
  };

  var ICONS = {
    bolt:  'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    eye:   'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z',
    flag:  'M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5',
    check: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    stop:  'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
    info:  'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; }
  }

  // Remembering what's been shown is what stops the same alert re-firing on
  // every page the member opens. Capped so the list can't grow forever.
  function markSeen(id) {
    if (!id) return;
    try {
      var seen = readSeen();
      if (seen.indexOf(id) !== -1) return;
      seen.push(id);
      if (seen.length > 200) seen = seen.slice(-200);
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch (e) {}
  }

  function alreadySeen(id) { return !!id && readSeen().indexOf(id) !== -1; }

  function isMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }

  // Alerts are on unless the member turned them off — an unset value is "on".
  function isEnabled() {
    try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch (e) {}
    if (on) { start(); } else { stop(); clearAll(); }
  }

  // Same rule: nothing stored means every type is on.
  function getTypes() {
    try {
      var raw = localStorage.getItem(TYPES_KEY);
      if (!raw) return ALL_TYPES.slice();
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : ALL_TYPES.slice();
    } catch (e) { return ALL_TYPES.slice(); }
  }

  function setTypes(list) {
    try { localStorage.setItem(TYPES_KEY, JSON.stringify(list || [])); } catch (e) {}
  }

  function typeAllowed(type) {
    return getTypes().indexOf(type || 'info') !== -1;
  }

  function styles() {
    if (document.getElementById('fsdx-alert-style')) return;
    var css = document.createElement('style');
    css.id = 'fsdx-alert-style';
    css.textContent = [
      '#' + STACK_ID + '{position:fixed;z-index:9999;right:1rem;bottom:1rem;display:flex;',
      '  flex-direction:column-reverse;gap:.6rem;pointer-events:none;max-width:min(23rem,calc(100vw - 2rem));}',
      '@media (max-width:640px){#' + STACK_ID + '{left:1rem;right:1rem;bottom:1rem;max-width:none;}}',
      '.fsdx-toast{pointer-events:auto;position:relative;overflow:hidden;border-radius:1rem;',
      '  border:1px solid rgba(255,255,255,.10);background:#09090b;color:#fff;',
      '  box-shadow:0 18px 40px -12px rgba(0,0,0,.9);',
      '  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;',
      '  transform:translateY(8px);opacity:0;transition:transform .22s ease,opacity .22s ease;}',
      '.fsdx-toast.in{transform:translateY(0);opacity:1;}',
      '.fsdx-toast.out{transform:translateY(8px);opacity:0;}',
      '.fsdx-toast-accent{position:absolute;left:0;top:0;bottom:0;width:3px;}',
      '.fsdx-toast-body{padding:.85rem .9rem .85rem 1.05rem;}',
      '.fsdx-toast-x{position:absolute;top:.5rem;right:.5rem;width:1.5rem;height:1.5rem;display:flex;',
      '  align-items:center;justify-content:center;border-radius:.5rem;color:#71717a;background:none;',
      '  border:0;cursor:pointer;transition:color .15s,background .15s;}',
      '.fsdx-toast-x:hover{color:#fff;background:rgba(255,255,255,.06);}',
      '.fsdx-toast-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;transform-origin:left;}',
      '@media (prefers-reduced-motion:reduce){.fsdx-toast,.fsdx-toast-bar{transition:none!important;animation:none!important;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(css);
  }

  function stack() {
    var el = document.getElementById(STACK_ID);
    if (!el) {
      styles();
      el = document.createElement('div');
      el.id = STACK_ID;
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'false');
      document.body.appendChild(el);
    }
    return el;
  }

  // A short two-note blip. Synthesised so there's no audio file to ship, and
  // it stays silent unless the browser has already granted audio.
  function ping(accent) {
    if (isMuted()) return;
    // Browsers block audio until the page has been interacted with, so building
    // a context before then is wasted work (and noisy in the console).
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      if (ctx.state === 'suspended') { ctx.close(); return; }
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(accent === '#ef4444' ? 420 : 660, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.start(); osc.stop(ctx.currentTime + 0.24);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 400);
    } catch (e) {}
  }

  function dismiss(node) {
    if (!node || node.dataset.closing) return;
    node.dataset.closing = '1';
    node.classList.remove('in');
    node.classList.add('out');
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
  }

  function show(a) {
    if (!a) return null;
    // Settings gate everything except an explicit demo, which is how the
    // settings page shows you what an alert looks like.
    if (!a.force && !isEnabled()) return null;
    if (!a.force && !typeAllowed(a.type)) return null;
    if (a.id && alreadySeen(a.id)) return null;
    markSeen(a.id);

    var t = TYPES[a.type] || TYPES.info;
    // Direction overrides the type accent: a bear anything is red.
    var accent = a.dir === 'BEAR' ? '#ef4444' : (a.dir === 'BULL' ? '#22c55e' : t.accent);
    if (a.type === 'sl') accent = '#ef4444';
    if (a.type === 'brewing') accent = a.dir === 'BEAR' ? '#fb7185' : '#f59e0b';

    var host = stack();
    // Keep the corner from filling up during a busy open. dismiss() only
    // *starts* a fade, so evicting has to remove the node outright — counting
    // children while waiting for the animation would spin forever.
    var open = Array.prototype.slice.call(host.children).filter(function (n) { return !n.dataset.closing; });
    while (open.length >= MAX_VISIBLE) {
      var victim = open.shift();
      if (victim && victim.parentNode) victim.parentNode.removeChild(victim);
    }

    var ttl = a.ttl === 0 ? 0 : (a.ttl || 12000);
    var node = document.createElement('div');
    node.className = 'fsdx-toast';
    node.setAttribute('role', 'status');

    var rows = (a.lines || []).map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:.75rem;padding:.15rem 0">' +
        '<span style="color:#71717a;font-size:11px">' + esc(r[0]) + '</span>' +
        '<span style="color:#e4e4e7;font-size:11px;font-weight:700">' + esc(r[1]) + '</span></div>';
    }).join('');

    node.innerHTML =
      '<div class="fsdx-toast-accent" style="background:' + accent + '"></div>' +
      '<button class="fsdx-toast-x" aria-label="Dismiss">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
        '<path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
      '<div class="fsdx-toast-body">' +
        '<div style="display:flex;align-items:center;gap:.5rem;padding-right:1.35rem;margin-bottom:' + (rows ? '.5rem' : '.15rem') + '">' +
          '<span style="display:flex;align-items:center;justify-content:center;width:1.4rem;height:1.4rem;' +
            'border-radius:.5rem;background:' + accent + '1f;flex:0 0 auto">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="' + accent + '" stroke-width="2">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="' + (ICONS[t.icon] || ICONS.info) + '"/></svg>' +
          '</span>' +
          '<span style="font-size:12.5px;font-weight:800;letter-spacing:.01em;min-width:0;flex:1 1 auto;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(a.title || 'Scout Alert') + '</span>' +
          (a.grade ? '<span style="flex:0 0 auto;font-size:10px;font-weight:900;padding:.1rem .4rem;border-radius:.35rem;' +
            'color:' + accent + ';background:' + accent + '1a;border:1px solid ' + accent + '40">' + esc(a.grade) + '</span>' : '') +
        '</div>' +
        (a.sub ? '<div style="font-size:11px;color:#a1a1aa;margin-bottom:' + (rows ? '.45rem' : '0') + '">' + esc(a.sub) + '</div>' : '') +
        (rows ? '<div style="border-top:1px solid rgba(255,255,255,.06);padding-top:.4rem">' + rows + '</div>' : '') +
      '</div>' +
      (ttl ? '<div class="fsdx-toast-bar" style="background:' + accent + '66"></div>' : '');

    host.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('in'); });
    ping(accent);

    node.querySelector('.fsdx-toast-x').addEventListener('click', function () { dismiss(node); });

    if (ttl) {
      var bar = node.querySelector('.fsdx-toast-bar');
      if (bar) {
        bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
                    { duration: ttl, easing: 'linear', fill: 'forwards' });
      }
      var timer = setTimeout(function () { dismiss(node); }, ttl);
      // Reading a setup shouldn't be a race against the timer.
      node.addEventListener('mouseenter', function () { clearTimeout(timer); if (bar) bar.getAnimations().forEach(function (x) { x.pause(); }); });
      node.addEventListener('mouseleave', function () {
        timer = setTimeout(function () { dismiss(node); }, 4000);
        if (bar) bar.getAnimations().forEach(function (x) { x.play(); });
      });
    }
    return node;
  }

  function setMuted(on) {
    try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (e) {}
  }

  function clearAll() {
    var host = document.getElementById(STACK_ID);
    if (host) Array.prototype.slice.call(host.children).forEach(dismiss);
  }

  // Sample sequence — what a live open actually looks like, in order.
  function demo() {
    var now = Date.now();
    var seq = [
      { delay: 0, a: { type:'brewing', dir:'BULL', title:'BULL Setup Brewing', sub:'MNQ1! · 12 pts from ORB High',
          lines:[['HTF','Bullish'],['ORB','62.5 pts'],['Watch close above','20146.00']], id:'demo-'+now+'-1', force:true } },
      { delay: 2600, a: { type:'vwap', dir:'BULL', title:'BULL VWAP Confirmed', sub:'MNQ1! · watch for close confirmation',
          lines:[['ORB High','20146.00'],['VWAP','20138.75']], id:'demo-'+now+'-2', force:true } },
      { delay: 5200, a: { type:'breakout', dir:'BULL', title:'BULL ORB Breakout', sub:'MNQ1!', grade:'A+',
          lines:[['Entry','20147.50'],['TP1','20197.50'],['TP2','20247.50'],['SL','20072.50'],['ORB','62.5 pts']],
          id:'demo-'+now+'-3', ttl:16000, force:true } },
      { delay: 8200, a: { type:'tp', dir:'BULL', title:'TP1 Hit — BULL', sub:'MNQ1! · Grade A+',
          lines:[['Price','20197.50']], id:'demo-'+now+'-4', force:true } }
    ];
    seq.forEach(function (s) { setTimeout(function () { show(s.a); }, s.delay); });
  }

  // ══════════════════════════════════════════════════════════════════
  //  LIVE FEED — polls the Worker and toasts anything new
  // ══════════════════════════════════════════════════════════════════

  var API = 'https://nexus-validator.dfuentes4211.workers.dev';
  var POLL_MS = 30000;         // while the tab is visible
  var CURSOR_KEY = 'fsdx_alert_cursor';
  var timer = null, running = false, failures = 0;

  function readCursor() {
    try { return parseInt(localStorage.getItem(CURSOR_KEY) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function writeCursor(ts) {
    try { localStorage.setItem(CURSOR_KEY, String(ts)); } catch (e) {}
  }

  // Server shape → toast shape.
  function toToast(a) {
    var lines = [];
    if (a.entry != null) lines.push(['Entry', a.entry]);
    if (a.tp1 != null) lines.push(['TP1', a.tp1]);
    if (a.tp2 != null) lines.push(['TP2', a.tp2]);
    if (a.sl != null) lines.push(['SL', a.sl]);
    if (a.orb != null) lines.push(['ORB', a.orb + ' pts']);
    // Nothing structured? Show the first couple of detail lines from the text.
    if (!lines.length && a.content) {
      String(a.content).split('\n').slice(1, 4).forEach(function (l) {
        var bits = l.split(':');
        if (bits.length > 1 && bits[0].trim()) lines.push([bits[0].trim(), bits.slice(1).join(':').trim()]);
      });
    }
    return {
      id: a.id,
      type: a.type || 'info',
      dir: a.dir || '',
      title: a.title || 'Scout Alert',
      sub: a.symbol || '',
      grade: a.grade || '',
      lines: lines.slice(0, 5),
      ttl: (a.type === 'breakout' || a.type === 'sl') ? 18000 : 12000
    };
  }

  async function poll(firstRun) {
    if (!running || document.hidden) return;
    if (!isEnabled()) return;
    var token;
    try { token = localStorage.getItem('fsdx_token'); } catch (e) {}
    if (!token) { stop(); return; }

    try {
      var since = readCursor();
      var res = await fetch(API + '/api/scout/feed?since=' + since + '&limit=20', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      // Logged out or expired — polling forever would be pointless noise.
      if (res.status === 401) { stop(); return; }
      if (!res.ok) throw new Error('status ' + res.status);
      var data = await res.json();
      failures = 0;

      var list = Array.isArray(data.alerts) ? data.alerts : [];
      // Oldest first so a burst arrives in the order it happened.
      list.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });

      // On the very first poll of a session, catch up silently. Opening the
      // site at noon should not fire every alert from the morning session.
      if (firstRun && !since) {
        if (list.length) writeCursor(list[list.length - 1].ts);
        return;
      }

      list.forEach(function (a) {
        show(toToast(a));
        if (a.ts) writeCursor(Math.max(readCursor(), a.ts));
      });
    } catch (e) {
      // Back off on repeated failures rather than hammering a sick endpoint.
      failures++;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    var wait = POLL_MS * Math.min(8, Math.pow(2, Math.max(0, failures - 1)));
    timer = setTimeout(function () { poll(false).finally(schedule); }, wait);
  }

  function start(opts) {
    if (running) return;
    if (opts && opts.api) API = opts.api;
    if (opts && opts.pollMs) POLL_MS = opts.pollMs;
    running = true;
    poll(true).finally(schedule);

    // No point polling a tab nobody is looking at; catch up on return.
    document.addEventListener('visibilitychange', function () {
      if (!running) return;
      if (document.hidden) { clearTimeout(timer); }
      else { poll(false).finally(schedule); }
    });
  }

  function stop() {
    running = false;
    clearTimeout(timer);
  }

  // Auto-start for logged-in members. Pages that shouldn't poll can call
  // FSDXAlerts.stop() after load.
  function autoStart() {
    var token = null;
    try { token = localStorage.getItem('fsdx_token'); } catch (e) {}
    if (token && isEnabled()) start();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }

  window.FSDXAlerts = {
    show: show,
    demo: demo,
    clearAll: clearAll,
    setMuted: setMuted,
    isMuted: isMuted,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getTypes: getTypes,
    setTypes: setTypes,
    start: start,
    stop: stop,
    // Testing helper: forget the cursor so the next poll re-toasts recent alerts.
    resetCursor: function () { try { localStorage.removeItem(CURSOR_KEY); } catch (e) {} }
  };
})();
