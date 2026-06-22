/* ============================================================
   FSD-X Checkout Gate
   Intercepts clicks on any whop.com/checkout link, shows a
   Terms-of-Service consent modal, and only proceeds after the
   user checks "I understand and agree."

   Usage:
     <script src="checkout-gate.js"></script>
   Per-product terms:
     Default = membership terms.
     Add data-gate="autotrader" to a checkout link for the
     heavier Auto-Trader terms.
   ============================================================ */
(function () {
  "use strict";

  // ---- TOS content per product ----
  var TERMS = {
    membership: {
      eyebrow: "Before You Continue",
      title: "FSD-X Membership — Terms of Service",
      points: [
        "This is an educational, rules-based tool — <strong>not a signal service</strong> and not financial advice.",
        "Trading involves <strong>substantial risk</strong>; you can lose some or all of your capital. No profit or result is guaranteed.",
        "Once a billing cycle begins, <strong>all fees are non-refundable</strong>. Cancel during any free trial to avoid being charged.",
        "Access is limited to <strong>one Discord and one TradingView account</strong>. Sharing or reselling is prohibited and may end access without refund.",
        "I have read and agree to the full <a href='disclosures.html' target='_blank' rel='noopener' class='text-green-400 underline hover:text-green-300'>Disclosures &amp; Terms of Service</a>."
      ],
      agree: "I understand and agree to the Terms of Service.",
      proceed: "Proceed to Checkout"
    },
    tools: {
      eyebrow: "Before You Continue",
      title: "FSD-X Tool — Terms of Service",
      points: [
        "This is a software utility — <strong>not financial advice</strong> and not a trade-signal service.",
        "Trading involves <strong>substantial risk</strong>; no outcome or result is guaranteed. Tools assist your process; they do not guarantee performance.",
        "Once a billing cycle begins, <strong>all fees are non-refundable</strong>. Cancel during any free trial to avoid being charged.",
        "Access is delivered via a <strong>license key tied to your account</strong>. Sharing, reselling, or redistributing your key or access is prohibited and may end access without refund.",
        "I have read and agree to the full <a href='disclosures.html' target='_blank' rel='noopener' class='text-green-400 underline hover:text-green-300'>Disclosures &amp; Terms of Service</a>."
      ],
      agree: "I understand and agree to the Terms of Service.",
      proceed: "Proceed to Checkout"
    },
    autotrader: {
      eyebrow: "Before You Continue · Automated Product",
      title: "FSD-X // ORB Auto-Trader — Terms of Service",
      points: [
        "The Auto-Trader <strong>emits automation alerts only — it does not place or guarantee any order</strong>. All execution happens through third-party services and brokers <strong>you</strong> select, configure, and control.",
        "FSD-X is <strong>not responsible</strong> for those third parties, their reliability, fills, latency, or outages — or for any activity once the Auto-Trader is running on your account.",
        "A missed, delayed, or failed alert can leave unintended open positions. <strong>You are responsible for your own safeguards</strong> (broker-side stop, end-of-day flatten, risk limits) and for monitoring your account.",
        "<strong>You</strong> are responsible for confirming automated trading is permitted by your broker and prop firm and for complying with their rules.",
        "Validate on a <strong>demo/paper account</strong> before any live use. Trading involves substantial risk; no result is guaranteed.",
        "I have read and agree to the full <a href='disclosures.html' target='_blank' rel='noopener' class='text-green-400 underline hover:text-green-300'>Disclosures &amp; Terms of Service</a>, including the Auto-Trader Addendum."
      ],
      agree: "I understand and accept the Auto-Trader Terms.",
      proceed: "Proceed to Checkout"
    }
  };

  var pendingUrl = null;
  var pendingTarget = "_blank";

  // ---- build modal once ----
  function buildModal() {
    var wrap = document.createElement("div");
    wrap.id = "fsdx-gate";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.8);backdrop-filter:blur(4px);padding:1rem;";
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" aria-labelledby="fsdx-gate-title" ' +
      'style="background:#09090b;border:1px solid rgba(255,255,255,.12);border-radius:1rem;' +
      'max-width:34rem;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);">' +
        '<div style="padding:1.5rem 1.5rem 1.25rem;">' +
          '<div id="fsdx-gate-eyebrow" style="color:#34d399;font-size:10px;letter-spacing:.25em;text-transform:uppercase;font-weight:700;margin-bottom:.5rem;"></div>' +
          '<h2 id="fsdx-gate-title" style="font-size:1.15rem;font-weight:800;color:#fff;margin:0 0 1rem;line-height:1.3;"></h2>' +
          '<ul id="fsdx-gate-points" style="list-style:disc;padding-left:1.1rem;margin:0 0 1.25rem;display:flex;flex-direction:column;gap:.6rem;color:#a1a1aa;font-size:.82rem;line-height:1.5;"></ul>' +
          '<label style="display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;user-select:none;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:.75rem;padding:.75rem .9rem;">' +
            '<input type="checkbox" id="fsdx-gate-check" style="width:1.1rem;height:1.1rem;margin-top:.1rem;accent-color:#22c55e;flex:0 0 auto;cursor:pointer;">' +
            '<span id="fsdx-gate-agree" style="color:#e4e4e7;font-size:.82rem;line-height:1.45;font-weight:600;"></span>' +
          '</label>' +
          '<div style="display:flex;gap:.75rem;margin-top:1.25rem;">' +
            '<button id="fsdx-gate-cancel" type="button" ' +
              'style="flex:0 0 auto;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;font-weight:600;padding:.75rem 1.25rem;border-radius:.85rem;cursor:pointer;">Cancel</button>' +
            '<button id="fsdx-gate-proceed" type="button" disabled ' +
              'style="flex:1;background:#22c55e;color:#000;font-weight:800;padding:.75rem 1.25rem;border-radius:.85rem;cursor:not-allowed;opacity:.5;transition:opacity .15s;"></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var check = wrap.querySelector("#fsdx-gate-check");
    var proceed = wrap.querySelector("#fsdx-gate-proceed");
    var cancel = wrap.querySelector("#fsdx-gate-cancel");

    check.addEventListener("change", function () {
      proceed.disabled = !check.checked;
      proceed.style.cursor = check.checked ? "pointer" : "not-allowed";
      proceed.style.opacity = check.checked ? "1" : ".5";
    });
    cancel.addEventListener("click", closeModal);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && wrap.style.display === "flex") closeModal();
    });
    proceed.addEventListener("click", function () {
      if (!check.checked || !pendingUrl) return;
      var url = pendingUrl;
      var tgt = pendingTarget;
      closeModal();
      if (tgt === "_blank") { window.open(url, "_blank", "noopener"); }
      else { window.location.href = url; }
    });

    return wrap;
  }

  function openModal(variant) {
    var t = TERMS[variant] || TERMS.membership;
    var wrap = document.getElementById("fsdx-gate") || buildModal();
    wrap.querySelector("#fsdx-gate-eyebrow").textContent = t.eyebrow;
    wrap.querySelector("#fsdx-gate-title").textContent = t.title;
    wrap.querySelector("#fsdx-gate-agree").textContent = t.agree;
    var ul = wrap.querySelector("#fsdx-gate-points");
    ul.innerHTML = t.points.map(function (p) { return "<li>" + p + "</li>"; }).join("");
    var proceed = wrap.querySelector("#fsdx-gate-proceed");
    proceed.textContent = t.proceed;
    var check = wrap.querySelector("#fsdx-gate-check");
    check.checked = false;
    proceed.disabled = true;
    proceed.style.cursor = "not-allowed";
    proceed.style.opacity = ".5";
    wrap.style.display = "flex";
    wrap.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    var wrap = document.getElementById("fsdx-gate");
    if (!wrap) return;
    wrap.style.display = "none";
    wrap.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    pendingUrl = null;
  }

  // ---- intercept checkout clicks (delegated; covers future buttons too) ----
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="whop.com/checkout"]');
    if (!a) return;
    e.preventDefault();
    pendingUrl = a.getAttribute("href");
    pendingTarget = a.getAttribute("target") || "_self";
    openModal(a.getAttribute("data-gate") || "membership");
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildModal);
  } else {
    buildModal();
  }
})();
