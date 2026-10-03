/* ==========================================================================
   FSD-X — Lifetime offer counter + countdown (TradingView transition)

   Ends at whichever comes first:
     · the deadline below (Oct 31 2026, 11:59:59 PM Central = Nov 1 04:59:59 UTC)
     · Remaining hits 0 (set by hand in admin → Sales → Lifetime Spots)
   Whop's plan stock (20) is the hard stop on sales either way — this file only
   controls what the site shows.

   Any element with [data-lt-root] is hidden until the counter loads and is
   active. It then gets data-lt-state = open | low | closed. Children:
     [data-lt="num"]   spots left      [data-lt="fill"]  bar fill (sold %)
     [data-lt="d|h|m|s"] clock parts   [data-lt="left"]  "27d 07h 12m" text
     [data-lt="badge"] status text
   Elements with [data-lt-hide-closed] are removed entirely once closed.
   ========================================================================== */
(function () {
  "use strict";
  var API = "https://nexus-validator.dfuentes4211.workers.dev/api/lifetime-spots";
  var DEADLINE = Date.UTC(2026, 10, 1, 4, 59, 59); // Oct 31 11:59:59 PM CT
  var LOW_AT = 5;

  var roots = [];
  var total = 0, left = 0, timer = null;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function each(sel, fn) {
    roots.forEach(function (r) { r.querySelectorAll('[data-lt="' + sel + '"]').forEach(fn); });
  }

  function state() {
    if (left <= 0 || Date.now() >= DEADLINE) return "closed";
    if (left <= LOW_AT) return "low";
    return "open";
  }

  function paint() {
    var st = state();
    roots.forEach(function (r) {
      if (st === "closed" && r.hasAttribute("data-lt-hide-closed")) { r.hidden = true; return; }
      r.setAttribute("data-lt-state", st);
      r.hidden = false;
    });

    each("num", function (el) {
      el.innerHTML = Math.max(0, left) + ' <small>/ ' + total + ' left</small>';
    });
    each("fill", function (el) {
      el.style.width = (total ? Math.round(((total - Math.max(0, left)) / total) * 100) : 0) + "%";
    });
    each("badge", function (el) {
      el.textContent = st === "closed"
        ? (left <= 0 ? "All " + total + " spots filled" : "Offer ended")
        : st === "low" ? "Only " + left + " left" : total + " spots · Open";
    });
    each("closed-why", function (el) {
      el.textContent = left <= 0 ? "All " + total + " lifetime spots have been claimed."
                                 : "The lifetime offer ended Oct 31 at 11:59 PM CT.";
    });

    var ms = Math.max(0, DEADLINE - Date.now());
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
    each("d", function (el) { el.textContent = pad(d); });
    each("h", function (el) { el.textContent = pad(h); });
    each("m", function (el) { el.textContent = pad(m); });
    each("s", function (el) { el.textContent = pad(sec); });
    each("left", function (el) { el.textContent = d + "d " + pad(h) + "h " + pad(m) + "m"; });

    if (st === "closed" && timer) { clearInterval(timer); timer = null; }
  }

  async function init() {
    roots = Array.prototype.slice.call(document.querySelectorAll("[data-lt-root]"));
    if (!roots.length) return;
    try {
      var res = await fetch(API, { cache: "no-store" });
      var data = await res.json();
      var lt = data && data.lifetimeSpots;
      if (!lt || lt.active === false) return;           // not set up / hidden → show nothing
      total = Math.max(0, Number(lt.total) || 0);
      if (!total) return;
      left = Math.max(0, Math.min(Number(lt.remaining) || 0, total));
      paint();
      if (state() !== "closed") timer = setInterval(paint, 1000);
    } catch (e) { /* endpoint down → blocks stay hidden */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
