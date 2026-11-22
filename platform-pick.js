/* FSD-X — Pick your platform + NinjaTrader 8 pricing (Nov 22, 2026)
 *
 * Every membership is now sold per platform, and the two never overlap:
 *   · FSD-X Trading Pro — TradingView    Monthly / Quarterly / Annual
 *   · FSD-X Trading Pro — NinjaTrader 8  One-Time Payment / Monthly / Quarterly / Annual
 *   · Knightfall NT8 Standalone          Knightfall only (ninjatrader.html)
 * Anyone who needs both platforms DMs first.
 *
 * Page hooks (all optional, any page):
 *   <div data-platform-pick></div>         the two platform tiles
 *   <div data-plat="tv"> … </div>          shown when TradingView is picked
 *   <div data-plat="nt8"> … </div>         shown when NinjaTrader 8 is picked
 *   <div data-nt8-pricing></div>           the NT8 membership cards (one-time featured)
 *       add data-standalone to also show the Knightfall-only card
 *   <a data-plat-link="nt8|tv" href="#pricing">   picks that platform, then scrolls
 *   <div data-platform-pick data-compact>  the old one-line note (no tiles)
 *
 * Nothing is picked until the visitor picks (or arrives with #ninjatrader /
 * #tradingview, or picked on an earlier visit). Without JS both panels show.
 *
 * ── EDIT HERE ──────────────────────────────────────────────────────────────
 * Plan ids are the Whop plan ids of "FSD-X Trading Pro — NinjaTrader 8"
 * (prod_zFDnU37z8a40i). Prices must match Whop.
 * A plan id that still starts with "plan_PASTE" renders a disabled button, so
 * the page never links to a dead checkout.
 * ─────────────────────────────────────────────────────────────────────────── */
(function () {
  var NT8 = {
    onetime:   { plan: 'plan_a9fI5Tt1ovrTM',   price: '$499.99',   per: 'one time' },
    monthly:   { plan: 'plan_Kfbxc8XnIyR8F',   price: '$129.99',   per: '/ month' },
    quarterly: { plan: 'plan_qUR3sFurgMydb', price: '$349.99',   per: '/ 3 months' },
    annual:    { plan: 'plan_l7dou09quUFPB',    price: '$1,299.99', per: '/ year' }
  };
  /* Optional sale on the one-time plan. Off (null) by default: sales run
     through Admin → Promotions and the ticker. If set, the card shows the
     crossed-out price until `ends`, then goes back to the list price. */
  var ONETIME_SALE = null;
  /* Example, for a future sale:
  var ONETIME_SALE = {
    label: 'Black Friday',
    price: '$399.99',
    code:  'CODE',
    endsText: 'Nov 30, 11:59 PM CT',
    ends: Date.UTC(2026, 11, 1, 5, 59, 59)   // Nov 30 2026 11:59:59 PM CT
  }; */
  var STANDALONE = { price: '$59.99', per: '/ month', href: 'ninjatrader.html#pricing' };
  var DM = 'https://discord.gg/RePdHESvSx';
  var KEY = 'fsdx_platform';
  /* ────────────────────────────────────────────────────────────────────── */

  var CSS =
    '.pp-wrap{font-family:Inter,system-ui,sans-serif;color:#fff}' +
    '.pp-eyebrow{font-size:10px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;color:#4ade80}' +
    '.pp-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}' +
    '@media(max-width:700px){.pp-tiles{grid-template-columns:1fr}}' +
    '.pp-tile{position:relative;display:flex;flex-direction:column;gap:8px;text-align:left;cursor:pointer;width:100%;font:inherit;color:#fff;' +
      'border:1px solid rgba(255,255,255,.12);background:rgba(9,9,11,.6);border-radius:18px;padding:22px 22px 20px;transition:border-color .15s,background .15s}' +
    '.pp-tile:hover{border-color:rgba(74,222,128,.45)}' +
    '.pp-tile[aria-pressed="true"]{border:2px solid #22c55e;background:rgba(34,197,94,.07);padding:21px 21px 19px}' +
    '.pp-tile .pp-plat{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#a1a1aa}' +
    '.pp-tile[aria-pressed="true"] .pp-plat{color:#4ade80}' +
    '.pp-tile .pp-t{font-size:19px;font-weight:900;line-height:1.25}' +
    '.pp-tile .pp-d{font-size:13px;line-height:1.55;color:#a1a1aa}' +
    '.pp-tile .pp-go{margin-top:4px;font-size:13px;font-weight:800;color:#4ade80}' +
    '.pp-flag{position:absolute;top:-11px;right:18px;background:#22c55e;color:#000;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;padding:4px 9px;border-radius:7px}' +
    '.pp-hint{margin:14px 0 0;text-align:center;font-size:13px;color:#a1a1aa}' +
    '.pp-hint a{color:#4ade80;text-decoration:underline}' +
    /* NT8 cards */
    '.pp-feat{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);border:2px solid rgba(34,197,94,.55);border-radius:24px;background:#0b110d;overflow:hidden}' +
    '@media(max-width:860px){.pp-feat{grid-template-columns:1fr}}' +
    '.pp-feat-l{padding:32px;display:flex;flex-direction:column;gap:14px}' +
    '.pp-feat-r{padding:32px;background:#0d140f;border-left:1px solid rgba(34,197,94,.18)}' +
    '@media(max-width:860px){.pp-feat-r{border-left:0;border-top:1px solid rgba(34,197,94,.18)}}' +
    '.pp-badges{display:flex;flex-wrap:wrap;gap:8px}' +
    '.pp-b{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border-radius:7px}' +
    '.pp-b.g{background:#22c55e;color:#000}.pp-b.r{background:#E5484D;color:#fff}' +
    '.pp-h{margin:0;font-size:32px;font-weight:900;line-height:1.1;letter-spacing:-.02em}' +
    '.pp-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}' +
    '.pp-price b{font-size:52px;font-weight:900;color:#4ade80;letter-spacing:-.03em;line-height:1}' +
    '.pp-price s{font-size:22px;font-weight:700;color:#8b8b93}' +
    '.pp-price span{font-size:13px;color:#a1a1aa}' +
    '.pp-p{margin:0;font-size:14px;line-height:1.6;color:#a1a1aa}' +
    '.pp-code{font-size:13px;line-height:1.5;color:#e4e4e7;border:1px solid rgba(229,72,77,.45);background:rgba(229,72,77,.08);border-radius:10px;padding:8px 12px}' +
    '.pp-cta{display:block;text-align:center;background:#22c55e;color:#000;font-size:16px;font-weight:900;padding:16px;border-radius:14px;text-decoration:none;transition:background .15s}' +
    '.pp-cta:hover{background:#4ade80}' +
    '.pp-cta.ghost{background:transparent;color:#4ade80;border:1px solid rgba(34,197,94,.45);font-size:14px;padding:12px}' +
    '.pp-cta.ghost:hover{background:rgba(34,197,94,.1)}' +
    '.pp-cta.off{background:#27272a;color:#a1a1aa;cursor:not-allowed}' +
    '.pp-small{text-align:center;font-size:12px;line-height:1.5;color:#a1a1aa}' +
    '.pp-small b{color:#e4e4e7}' +
    '.pp-inc{margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#a1a1aa}' +
    '.pp-ul{list-style:none;margin:0;padding:0}' +
    '.pp-ul li{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}' +
    '.pp-ul li:last-child{border-bottom:0}' +
    '.pp-ul svg{flex:none;margin-top:2px}' +
    '.pp-ul b{display:block;font-size:14px;font-weight:800;color:#fff}' +
    '.pp-ul span{display:block;font-size:12.5px;line-height:1.5;color:#a1a1aa}' +
    '.pp-note{margin:12px 0 0;font-size:11.5px;line-height:1.5;color:#8b8b93}' +
    '.pp-row-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px;margin:28px 0 12px}' +
    '.pp-row-h b{font-size:18px;font-weight:900}.pp-row-h span{font-size:13px;color:#a1a1aa}' +
    '.pp-row{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:12px}' +
    '@media(max-width:900px){.pp-row{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '@media(max-width:520px){.pp-row{grid-template-columns:1fr}}' +
    '.pp-card{display:flex;flex-direction:column;justify-content:space-between;gap:16px;padding:20px;border-radius:18px;border:1px solid rgba(255,255,255,.1);background:rgba(9,9,11,.6)}' +
    '.pp-card .pp-tag{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a1a1aa}' +
    '.pp-card .pp-n{font-size:16px;font-weight:900;margin-top:6px}' +
    '.pp-card .pp-amt{margin-top:6px;font-size:26px;font-weight:900}.pp-card .pp-amt span{font-size:12px;font-weight:500;color:#a1a1aa;margin-left:4px}' +
    '.pp-card .pp-d{margin-top:6px;font-size:12.5px;line-height:1.5;color:#a1a1aa}' +
    '.pp-card.alt{border-style:dashed}';

  function css() {
    if (document.getElementById('pp-css')) return;
    var s = document.createElement('style'); s.id = 'pp-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function saleOn() { return !!(ONETIME_SALE && Date.now() < ONETIME_SALE.ends); }
  function live(p) { return p && p.plan && p.plan.indexOf('plan_PASTE') !== 0; }
  function btn(p, label, gate, cls) {
    if (!live(p)) return '<span class="pp-cta ' + (cls || '') + ' off" aria-disabled="true">Checkout opens soon</span>';
    return '<a class="pp-cta ' + (cls || '') + '" href="https://whop.com/checkout/' + p.plan + '" data-gate="' + gate +
      '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }
  var TICK = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

  /* ── Tiles ─────────────────────────────────────────────────────────────── */
  function tiles() {
    return '<div class="pp-wrap">' +
      '<div class="pp-eyebrow" style="text-align:center;margin-bottom:6px">Step 1</div>' +
      '<div style="text-align:center;font-size:24px;font-weight:900;margin-bottom:6px">Pick your platform.</div>' +
      '<p class="pp-p" style="text-align:center;margin:0 auto 22px;max-width:560px">Each membership runs on one platform. Same method, same grading, same rules. Pick the one you trade on.</p>' +
      '<div class="pp-tiles" role="group" aria-label="Pick your platform">' +
        '<button type="button" class="pp-tile" data-pick="nt8" aria-pressed="false">' +
          '<span class="pp-flag">One-time payment available</span>' +
          '<span class="pp-plat">NinjaTrader&reg; 8</span>' +
          '<span class="pp-t">Knightfall on NinjaTrader 8</span>' +
          '<span class="pp-d">Automation built in, no bridge. Pay once, or go month to month.</span>' +
          '<span class="pp-go">See NinjaTrader 8 options &rarr;</span>' +
        '</button>' +
        '<button type="button" class="pp-tile" data-pick="tv" aria-pressed="false">' +
          '<span class="pp-plat">TradingView</span>' +
          '<span class="pp-t">Knightfall on TradingView</span>' +
          '<span class="pp-d">Invite-only scripts on your TradingView username. Monthly, quarterly or annual.</span>' +
          '<span class="pp-go">See TradingView options &rarr;</span>' +
        '</button>' +
      '</div>' +
      '<p class="pp-hint">Need both platforms? <a href="' + DM + '" target="_blank" rel="noopener noreferrer">DM us on Discord</a> first.</p>' +
    '</div>';
  }

  var COMPACT =
    '<div style="font-family:Inter,system-ui,sans-serif;font-size:12.5px;line-height:1.55;color:#a1a1aa;border:1px solid rgba(255,255,255,.1);background:rgba(9,9,11,.5);border-radius:12px;padding:10px 14px">' +
      '<b style="color:#fff">Pick your platform:</b> each membership runs on TradingView or NinjaTrader&nbsp;8. ' +
      'The one-time payment is NinjaTrader&nbsp;8 only. <b style="color:#fff">Need both?</b> <a href="' + DM + '" target="_blank" rel="noopener noreferrer" style="color:#4ade80;text-decoration:underline">DM us first</a>.' +
    '</div>';

  /* ── NT8 membership cards ──────────────────────────────────────────────── */
  function nt8(withStandalone) {
    var s = saleOn(), o = NT8.onetime;
    var price = s
      ? '<div class="pp-price"><b>' + ONETIME_SALE.price + '</b><s>' + o.price + '</s><span>one time</span></div>'
      : '<div class="pp-price"><b>' + o.price + '</b><span>one time</span></div>';
    var code = s ? '<div class="pp-code"><b>' + ONETIME_SALE.label + ':</b> use code <b>' + ONETIME_SALE.code + '</b> at checkout. Ends ' + ONETIME_SALE.endsText + '.</div>' : '';
    var inc = [
      ['Knightfall for NinjaTrader 8', 'Approved by NinjaTrader. Licensed to the email you log into NinjaTrader with.'],
      ['Automation built in', 'Runs inside NinjaTrader. No webhook or bridge to set up.'],
      ['Volume and Raven', 'The FSD-X NinjaTrader 8 indicators that come with the membership.'],
      ['Member platform and Nexus', 'Journal, backtest workspace, trade importer, account tracker and the Nexus extension.'],
      ['Live trade room and VIP Discord', 'Trade the open with us every market morning.'],
      ['NinjaTrader hub', 'Downloads, settings and setup guides.']
    ];
    var feat =
      '<div class="pp-feat">' +
        '<div class="pp-feat-l">' +
          '<div class="pp-badges"><span class="pp-b g">Best value</span>' + (s ? '<span class="pp-b r">' + ONETIME_SALE.label + '</span>' : '') + '</div>' +
          '<div class="pp-eyebrow">FSD-X Trading Pro &middot; NinjaTrader 8 &middot; One-Time Payment</div>' +
          '<h3 class="pp-h">Pay once.<br>No subscription.</h3>' +
          price +
          '<p class="pp-p">The full FSD-X membership on NinjaTrader&nbsp;8 for one payment. No renewals.</p>' +
          code +
          btn(o, 'Pay once &mdash; ' + (s ? ONETIME_SALE.price : o.price), 'ntonetime') +
          '<div class="pp-small">Instant access &middot; NinjaTrader email asked at checkout</div>' +
          '<div class="pp-small"><b>No free trial &middot; All sales final, no refunds</b> &middot; <a href="disclosures.html#one-time" style="color:#4ade80">Terms</a></div>' +
        '</div>' +
        '<div class="pp-feat-r">' +
          '<div class="pp-inc">What&rsquo;s included</div>' +
          '<ul class="pp-ul">' + inc.map(function (i) { return '<li>' + TICK + '<div><b>' + i[0] + '</b><span>' + i[1] + '</span></div></li>'; }).join('') + '</ul>' +
          '<p class="pp-note">NinjaTrader&nbsp;8 only. TradingView and the Strategy Optimizer are not included. Updates at FSD-X&rsquo;s discretion.</p>' +
        '</div>' +
      '</div>';

    var cards = [
      { tag: 'Try it first', n: 'Monthly', p: NT8.monthly, d: 'Full membership. 30-day free trial for new members, then billed monthly.', b: 'Start free trial' },
      { tag: 'Season pass', n: 'Quarterly', p: NT8.quarterly, d: 'Full membership. Billed at checkout, no trial.', b: 'Get quarterly' },
      { tag: 'Committed', n: 'Annual', p: NT8.annual, d: 'Full membership. Billed at checkout, no trial.', b: 'Get annual' }
    ];
    var row = cards.map(function (c) {
      return '<div class="pp-card"><div><div class="pp-tag">' + c.tag + '</div><div class="pp-n">' + c.n + '</div>' +
        '<div class="pp-amt">' + c.p.price + '<span>' + c.p.per + '</span></div><div class="pp-d">' + c.d + '</div></div>' +
        btn(c.p, c.b, 'ntpro', 'ghost') + '</div>';
    });
    if (withStandalone) {
      row.push('<div class="pp-card alt"><div><div class="pp-tag">Knightfall only</div><div class="pp-n">Knightfall NT8 Standalone</div>' +
        '<div class="pp-amt">' + STANDALONE.price + '<span>' + STANDALONE.per + '</span></div>' +
        '<div class="pp-d">Knightfall, the member platform and Nexus. Free Discord only, no live room. 30-day free trial.</div></div>' +
        '<a class="pp-cta ghost" href="' + STANDALONE.href + '">See standalone plans &rarr;</a></div>');
    }
    return '<div class="pp-wrap">' + feat +
      '<div class="pp-row-h"><b>Rather pay as you go?</b><span>Subscriptions renew until you cancel.</span></div>' +
      '<div class="pp-row" style="--n:' + row.length + '">' + row.join('') + '</div></div>';
  }

  /* ── Picking ───────────────────────────────────────────────────────────── */
  function fromHash() {
    var h = (location.hash || '').toLowerCase();
    if (/ninja|nt8/.test(h)) return 'nt8';
    if (/tradingview|^#tv/.test(h)) return 'tv';
    return '';
  }
  function saved() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function pick(p, remember) {
    if (p !== 'tv' && p !== 'nt8') p = '';
    document.querySelectorAll('[data-plat]').forEach(function (el) { el.hidden = !!p ? el.getAttribute('data-plat') !== p : true; });
    document.querySelectorAll('[data-pick]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-pick') === p ? 'true' : 'false'); });
    document.querySelectorAll('[data-plat-empty]').forEach(function (el) { el.hidden = !!p; });
    if (p && remember) { try { localStorage.setItem(KEY, p); } catch (e) {} }
  }
  function scrollToPick() {
    var t = document.querySelector('[data-platform-pick]:not([data-compact])');
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function run() {
    css();
    var hasTiles = false;
    document.querySelectorAll('[data-platform-pick]').forEach(function (el) {
      if (el.dataset.ppDone) return; el.dataset.ppDone = '1';
      if (el.hasAttribute('data-compact')) { el.innerHTML = COMPACT; return; }
      el.innerHTML = tiles(); hasTiles = true;
    });
    document.querySelectorAll('[data-nt8-pricing]').forEach(function (el) {
      if (el.dataset.ppDone) return; el.dataset.ppDone = '1';
      el.innerHTML = nt8(el.hasAttribute('data-standalone'));
    });
    if (hasTiles) pick(fromHash() || saved(), false);

    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pick]');
      if (b) { pick(b.getAttribute('data-pick'), true); return; }
      var l = e.target.closest && e.target.closest('[data-plat-link]');
      if (l && document.querySelector('[data-platform-pick]:not([data-compact])')) {
        e.preventDefault(); pick(l.getAttribute('data-plat-link'), true); scrollToPick();
      }
    });
    window.addEventListener('hashchange', function () { var h = fromHash(); if (h) pick(h, true); });
    // Logged-in members: let nav-loader relabel the new checkout buttons.
    try { if (typeof window.fsdxPlanCtas === 'function') window.fsdxPlanCtas(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
