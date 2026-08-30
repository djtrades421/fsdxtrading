/* ==========================================================================
   fsdx-account.js — pending-account handling

   A site account can exist without a Whop key. Today the four tool pages
   render "Could not load your key. Log out and back in." in that state —
   advice that cannot work, because logging out does not create a key.

   This replaces that dead end with a panel that says what is behind the lock
   and lets the member attach their key on the spot.

   SAFETY
   - Purely additive. It only renders in a state where the page ALREADY
     refuses to load, so nothing that works today can start failing.
   - No client-side admin bypass. fsdx_admin survives navLogout(), so it would
     leak across accounts in the same browser and silently disable the gate.

   Load after nav-loader.js (nav-loader injects it automatically).
   ========================================================================== */
(function () {
  'use strict';

  var API = 'https://nexus-validator.dfuentes4211.workers.dev';

  /* Pending == the profile came back with no Whop key. Nothing else.
     There is deliberately NO localStorage admin bypass here: fsdx_admin is a
     client-side flag that survives navLogout(), so a burner account created in
     a browser that had ever touched admin.html would silently skip the gate.
     The owner account does not need a bypass anyway — a MASTER_KEYS value is
     stored as a real whopKey, so it is never pending. */
  function isPending(whopKey) {
    return !whopKey;
  }

  var CSS = ''
    + '#fsdx-lock{max-width:520px;margin:0 auto;padding:32px 24px;text-align:left}'
    + '#fsdx-lock .ic{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;'
    +   'justify-content:center;background:rgba(255,107,31,.12);border:1px solid rgba(255,107,31,.28);margin-bottom:16px}'
    + '#fsdx-lock h2{font-size:19px;font-weight:900;letter-spacing:-.02em;margin-bottom:7px;color:#fff}'
    + '#fsdx-lock p{font-size:13px;line-height:1.6;color:#A2AEBF;margin-bottom:16px}'
    + '#fsdx-lock ul{list-style:none;margin:0 0 20px;padding:0}'
    + '#fsdx-lock li{font-size:12.5px;color:#A2AEBF;padding:5px 0 5px 20px;position:relative}'
    + '#fsdx-lock li:before{content:"";position:absolute;left:4px;top:12px;width:5px;height:5px;'
    +   'border-radius:50%;background:#FF6B1F}'
    + '#fsdx-lock .row{display:flex;gap:8px;margin-bottom:10px}'
    + '#fsdx-lock input{flex:1;background:#05080D;border:1px solid rgba(120,160,210,.18);border-radius:9px;'
    +   'padding:11px 13px;color:#E6EAF0;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}'
    + '#fsdx-lock input:focus{border-color:rgba(255,107,31,.5)}'
    + '#fsdx-lock button{background:linear-gradient(135deg,#FF9247,#FF6B1F 52%,#EB550D);color:#0B1119;'
    +   'font-size:12px;font-weight:800;border:0;border-radius:9px;padding:11px 18px;cursor:pointer;white-space:nowrap}'
    + '#fsdx-lock button:disabled{opacity:.55;cursor:default}'
    + '#fsdx-lock .msg{font-size:12px;padding:9px 12px;border-radius:8px;margin-bottom:10px;display:none}'
    + '#fsdx-lock .msg.err{display:block;background:rgba(226,83,75,.12);color:#E2534B}'
    + '#fsdx-lock .msg.ok{display:block;background:rgba(47,191,126,.12);color:#2FBF7E}'
    + '#fsdx-lock .hint{font-size:11.5px;color:#61707F;line-height:1.6}'
    + '#fsdx-lock .hint a{color:#FF6B1F;text-decoration:none;font-weight:700}';

  function injectCss() {
    if (document.getElementById('fsdx-lock-css')) return;
    var s = document.createElement('style');
    s.id = 'fsdx-lock-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /**
   * Render the locked panel.
   * @param {Object} o
   *   o.into  - element id to render into (defaults to 'loading-screen')
   *   o.title - what this page is, e.g. 'Trade Journal'
   *   o.perks - array of strings: what unlocking gets them
   */
  function renderLock(o) {
    o = o || {};
    injectCss();
    var host = document.getElementById(o.into || 'loading-screen');
    if (!host) return;

    var perks = (o.perks || []).map(function (p) {
      return '<li>' + String(p).replace(/</g, '&lt;') + '</li>';
    }).join('');

    host.classList.remove('hidden');
    host.innerHTML = ''
      + '<div id="fsdx-lock">'
      +   '<div class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B1F" '
      +     'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      +     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>'
      +   '<h2>One step left</h2>'
      +   '<p>Your account is created. Add your Whop member key to unlock '
      +     (o.title ? '<strong style="color:#E6EAF0">' + o.title + '</strong>' : 'the member tools') + '.</p>'
      +   (perks ? '<ul>' + perks + '</ul>' : '')
      +   '<div class="msg" id="fsdx-lock-msg"></div>'
      +   '<div class="row">'
      +     '<input id="fsdx-lock-key" placeholder="Paste your Whop key" autocomplete="off" spellcheck="false">'
      +     '<button id="fsdx-lock-btn">Unlock</button>'
      +   '</div>'
      +   '<div class="hint">Find it in your <a href="https://whop.com/hub" target="_blank" '
      +     'rel="noopener noreferrer">Whop dashboard</a> under the Software tab of your FSD-X membership. '
      +     'Full walkthrough on <a href="setup.html">Getting Started</a>.<br>'
      +     'Not subscribed yet? <a href="memberships.html">See membership options</a>.</div>'
      + '</div>';

    var btn = document.getElementById('fsdx-lock-btn');
    var input = document.getElementById('fsdx-lock-key');
    btn.addEventListener('click', function () { attach(input.value.trim(), btn); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') attach(input.value.trim(), btn);
    });
    input.focus();
  }

  function msg(text, kind) {
    var el = document.getElementById('fsdx-lock-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + (kind || 'err');
  }

  function attach(key, btn) {
    if (!key) return msg('Paste your key first.');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    var token = '';
    try { token = localStorage.getItem('fsdx_token') || ''; } catch (e) {}

    fetch(API + '/api/auth/attach-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ key: key })
    })
      .then(function (r) {
        /* The endpoint may not exist yet. Say so plainly rather than showing
           a generic failure the member can do nothing with. */
        if (r.status === 404 || r.status === 405) {
          throw new Error('NOT_DEPLOYED');
        }
        return r.json();
      })
      .then(function (d) {
        if (d && d.success) {
          try {
            if (d.tier)       localStorage.setItem('fsdx_tier', d.tier);
            if (d.plan)       localStorage.setItem('fsdx_plan', d.plan);
            if (d.whopStatus) localStorage.setItem('fsdx_whop_status', d.whopStatus);
          } catch (e) {}
          msg('Key accepted — loading your tools…', 'ok');
          setTimeout(function () { location.reload(); }, 700);
        } else {
          msg((d && d.error) || 'That key was not recognised. Check it and try again.');
          btn.disabled = false;
          btn.textContent = 'Unlock';
        }
      })
      .catch(function (e) {
        if (e && e.message === 'NOT_DEPLOYED') {
          msg('Key activation is not switched on yet. Add your key on the login page for now.');
        } else {
          msg('Connection problem. Try again in a moment.');
        }
        btn.disabled = false;
        btn.textContent = 'Unlock';
      });
  }

  window.fsdxIsPending = isPending;
  window.fsdxRequireKey = renderLock;

  /* nav-loader.js defines a stub renderer so the gate can never be lost to a
     load-order race. If a page locked before this file arrived, the request is
     sitting in __fsdxLockPending — draw it now. */
  if (window.__fsdxLockPending) {
    var queued = window.__fsdxLockPending;
    window.__fsdxLockPending = null;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { renderLock(queued); });
    } else {
      renderLock(queued);
    }
  }
})();
