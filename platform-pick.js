/* FSD-X — "Choose your platform" block (Nov 2026)
 *
 * Shown wherever the full membership is sold. Pages opt in with an empty
 * <div data-platform-pick></div>; the wording lives only here, so changing it
 * is a one-file edit. Add data-compact to the div for the one-line version.
 *
 * Why it exists: under TradingView's Feb 1, 2027 terms every person with
 * active TradingView access counts toward our seat limit. Members pick the
 * platform they trade on; anyone who wants both asks first, so we know who is
 * holding a TradingView seat. Wording rules: never say "only one" or
 * "doesn't include both" — members can still technically claim both.
 *
 * Inline styles on purpose: tailwind.css is a compiled build (see tv-notice.js).
 */
(function () {
  var DM = 'https://discord.gg/RePdHESvSx';

  var F = 'font-family:Inter,system-ui,sans-serif;';
  function card(tag, title, items, field) {
    return '<div style="flex:1 1 240px;min-width:0;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.35);border-radius:14px;padding:16px 18px">' +
      '<div style="' + F + 'font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#4ade80">' + tag + '</div>' +
      '<div style="' + F + 'font-size:16px;font-weight:900;color:#fff;margin:4px 0 8px">' + title + '</div>' +
      '<ul style="' + F + 'list-style:none;padding:0;margin:0;font-size:12.5px;line-height:1.55;color:#a1a1aa">' +
        items.map(function (i) { return '<li style="display:flex;gap:6px"><span style="color:#4ade80">&#10003;</span><span>' + i + '</span></li>'; }).join('') +
      '</ul>' +
      '<div style="' + F + 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;line-height:1.5;color:#71717a">At checkout: <b style="color:#e4e4e7">' + field + '</b></div>' +
    '</div>';
  }

  var FULL =
    '<div style="border:1px solid rgba(74,222,128,.25);background:rgba(9,9,11,.6);border-radius:16px;padding:18px 18px 16px">' +
      '<div style="' + F + 'font-size:10px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;color:#4ade80;margin-bottom:4px">// Choose your platform</div>' +
      '<div style="' + F + 'font-size:18px;font-weight:900;color:#fff;line-height:1.3">TradingView or NinjaTrader&nbsp;8. Pick the one you trade on.</div>' +
      '<p style="' + F + 'font-size:13px;line-height:1.55;color:#a1a1aa;margin:6px 0 14px">Same method, same grading, same rules on both. Either way you get the member platform, Nexus&nbsp;2.0, the live trade room and the VIP Discord.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
        card('TradingView', 'Knightfall on TradingView',
          ['Knightfall MK2 (strategy + backtester)', 'Auto Trader script (runs through your bridge)', 'Stack V1, Volume Engine and Raven'],
          'your TradingView username') +
        card('NinjaTrader 8', 'Knightfall on NinjaTrader&nbsp;8',
          ['Knightfall with automation built in', 'No webhook or bridge needed', 'Volume Engine and Raven'],
          'the email you log into NinjaTrader with') +
      '</div>' +
      '<p style="' + F + 'font-size:12.5px;line-height:1.55;color:#a1a1aa;margin:12px 0 0">' +
        '<b style="color:#fff">Want both?</b> <a href="' + DM + '" target="_blank" rel="noopener noreferrer" style="color:#4ade80;text-decoration:underline">DM us on Discord</a> before you set up, and we&rsquo;ll sort it out with you.' +
      '</p>' +
    '</div>';

  var COMPACT =
    '<div style="' + F + 'font-size:12.5px;line-height:1.55;color:#a1a1aa;border:1px solid rgba(255,255,255,.1);background:rgba(9,9,11,.5);border-radius:12px;padding:10px 14px">' +
      '<b style="color:#fff">Choose your platform:</b> TradingView or NinjaTrader&nbsp;8. Enter your TradingView username or your NinjaTrader email at checkout. ' +
      '<b style="color:#fff">Want both?</b> <a href="' + DM + '" target="_blank" rel="noopener noreferrer" style="color:#4ade80;text-decoration:underline">DM us first</a>.' +
    '</div>';

  function render(el) {
    if (el.dataset.platformPickDone) return;
    el.dataset.platformPickDone = '1';
    el.innerHTML = el.hasAttribute('data-compact') ? COMPACT : FULL;
  }
  function run() { document.querySelectorAll('[data-platform-pick]').forEach(render); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
