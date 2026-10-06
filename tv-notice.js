/* FSD-X — TradingView Nov 1 notice
 *
 * One short notice, shown on every page that sells or sets up our TradingView
 * scripts. Pages opt in with an empty <div data-tv-notice></div>; the wording
 * lives only here, so changing it is a one-file edit.
 *
 * Inline styles on purpose: tailwind.css is a compiled build, so utility
 * classes that aren't already used somewhere on the site would not exist.
 *
 * When TradingView answers (Marketplace approved or not), edit TEXT below and
 * the full explainer page, tradingview-update.html. Nothing else.
 */
(function () {
  var TEXT =
    '<b style="color:#fde68a">TradingView users:</b> from <b style="color:#fff">November 1, 2026</b>, ' +
    'TradingView requires paid private scripts to be bought through its own Marketplace, not through us or Whop. ' +
    'NinjaTrader, the member platform, Nexus and the Discord aren’t affected.';

  function render(el) {
    if (el.dataset.tvNoticeDone) return;
    el.dataset.tvNoticeDone = '1';
    el.setAttribute('role', 'note');
    el.innerHTML =
      '<div style="max-width:64rem;margin:0 auto;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;' +
      'border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.06);border-radius:14px;padding:14px 16px">' +
        '<span aria-hidden="true" style="flex:none;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;' +
        'background:rgba(251,191,36,.15);color:#fbbf24;font:800 12px Inter,system-ui,sans-serif">!</span>' +
        '<div style="flex:1 1 260px;min-width:0;font:500 13px/1.55 Inter,system-ui,sans-serif;color:#d4d4d8">' + TEXT + '</div>' +
        '<a href="tradingview-update.html" style="flex:none;align-self:center;font:700 12.5px Inter,system-ui,sans-serif;color:#fbbf24;' +
        'text-decoration:none;border:1px solid rgba(251,191,36,.4);border-radius:10px;padding:8px 12px;white-space:nowrap">What changes &rarr;</a>' +
      '</div>';
  }
  function run() { document.querySelectorAll('[data-tv-notice]').forEach(render); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
