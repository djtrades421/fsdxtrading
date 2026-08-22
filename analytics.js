/* ==========================================================================
   analytics.js — FSD-X Trading
   --------------------------------------------------------------------------
   ONE place to put every tracking ID. Fill in the four values below and
   every public page starts reporting. Leave a value as an empty string and
   that platform is skipped entirely — nothing loads, nothing breaks.

        META_PIXEL_ID   Events Manager -> Data Sources -> your pixel ID
        GA4_ID          Google Analytics -> Admin -> Data Streams (G-XXXXXXX)
        GOOGLE_ADS_ID   Google Ads -> Tools -> Conversions (AW-XXXXXXXXX)
        GOOGLE_ADS_LABEL  the conversion action's label (AW-.../LabelHere)
        WHOP_BIZ_ID     Whop dashboard URL -> biz_xxxxxxxxxxxxx

   What gets tracked automatically once IDs are in:
     - PageView on every public page
     - InitiateCheckout / begin_checkout when someone clicks any Whop
       checkout link (this is your trial-start signal — the actual purchase
       completes on Whop's domain, so this click is the last event we own)
     - Lead when someone clicks through to Discord
     - Whop pixel page view on every page, so Whop can attribute the
       purchase/trial (which completes on whop.com) back to this visit
   ========================================================================== */

var FSDX_ANALYTICS = {
  META_PIXEL_ID:    "3483027555206453",   // FSD-X Trading pixel
  GA4_ID:           "G-CKJ2Q0R1KC",   // FSD-X Trading GA4
  GOOGLE_ADS_ID:    "",   // e.g. "AW-123456789"
  GOOGLE_ADS_LABEL: "",   // e.g. "AbCdEfGhIj"
  WHOP_BIZ_ID:      "biz_2f60zABhyFQYpX"   // FSD-X Trading Whop pixel
};

(function () {
  "use strict";
  var C = FSDX_ANALYTICS;

  /* ---------- Meta Pixel ---------- */
  if (C.META_PIXEL_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", C.META_PIXEL_ID);
    fbq("track", "PageView");
  }

  /* ---------- Google (GA4 + Ads share one gtag loader) ---------- */
  var gid = C.GA4_ID || C.GOOGLE_ADS_ID;
  if (gid) {
    var g = document.createElement("script");
    g.async = true;
    g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gid);
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag("js", new Date());
    if (C.GA4_ID) gtag("config", C.GA4_ID);
    if (C.GOOGLE_ADS_ID) gtag("config", C.GOOGLE_ADS_ID);
  }

  /* ---------- Whop Pixel ----------
     Ties a visitor on this site to the purchase/trial that completes on
     whop.com. First-party, so it survives cookie blocking. Checkout views
     and purchases are tracked by Whop on their own domain once the scope
     is set here — nothing extra to fire on our side.                    */
  if (C.WHOP_BIZ_ID) {
    !function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");
    whop.setScope(C.WHOP_BIZ_ID);
    whop.track("page");
  }

  /* ---------- helpers ---------- */
  function metaTrack(name, params) {
    if (window.fbq) fbq("track", name, params || {});
  }
  function gaEvent(name, params) {
    if (window.gtag) gtag("event", name, params || {});
  }
  function whopTrack(name, params) {
    if (window.whop) { params ? whop.track(name, params) : whop.track(name); }
  }
  function adsConversion() {
    if (window.gtag && C.GOOGLE_ADS_ID && C.GOOGLE_ADS_LABEL) {
      gtag("event", "conversion", {
        send_to: C.GOOGLE_ADS_ID + "/" + C.GOOGLE_ADS_LABEL
      });
    }
  }

  /* ---------- outbound click tracking ----------
     Delegated listener: works for links added later by JS (nav, sale
     banner, gated checkout buttons) without needing to re-bind.        */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";

    // Whop checkout = trial start
    if (href.indexOf("whop.com/checkout") > -1) {
      var plan = (href.match(/plan_[A-Za-z0-9]+/) || ["unknown"])[0];
      var label = (a.textContent || "").trim().slice(0, 60);
      metaTrack("InitiateCheckout", { content_name: label, content_ids: [plan], currency: "USD" });
      gaEvent("begin_checkout", { plan_id: plan, link_text: label });
      adsConversion();
      return;
    }

    // Discord = soft lead
    if (href.indexOf("discord.gg") > -1) {
      metaTrack("Lead", { content_name: "Discord" });
      gaEvent("generate_lead", { method: "discord" });
      whopTrack("lead");
    }
  }, true);

  /* expose for manual firing elsewhere if ever needed */
  window.fsdxTrack = { meta: metaTrack, ga: gaEvent, whop: whopTrack, adsConversion: adsConversion };
})();
