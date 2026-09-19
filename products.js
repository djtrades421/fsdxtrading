// FSD-X — Whop product registry and plan entitlements
//
// One place. Before this file the product allowlist was copy-pasted into five
// modules (auth, validate, nexus-validate, nexus-journal, nexus-ai,
// nexus-playbook). Adding a product meant editing all of them and the one you
// forgot was the one that silently locked a paying member out. Every module now
// imports from here instead.
//
// Adding a product later: put its id in ONE of the arrays below (or set the
// matching env var in the Cloudflare dashboard) and every gate picks it up.

/* ── Known product ids ──────────────────────────────────────────────────── */

export const PRODUCT = {
  VIP_LEGACY:        'prod_0ZpIOMxxHMSok', // FSD-X ORB PRO v4 Alpha VIP Access
  PRO:               'prod_oMd0Gd3AhJ3FP', // FSD-X Pro (Plus + Auto Trader)
  NEXUS_STANDALONE:  'prod_jNTNmXVjVsTUx', // FSD-X Nexus Standalone
  NEXUS_MARKETPLACE: 'prod_ufb6xrzAO7lwo', // FSD-X Nexus Marketplace
  NIGHTWING:         'prod_LwWpX164TGT7Q', // Nightwing — Site Access + Nexus 2.0 ($9.99)
  RAVEN:             'prod_9gteCsUjkCpjS', // Raven — ORB Levels + Platform ($39.99)
};

/* ── Plans ──────────────────────────────────────────────────────────────────
   'pro'   — full VIP bundle, everything including the Auto Trader
   'plus'  — VIP indicators, no Auto Trader
   'site'  — Nightwing: site access + Nexus. Web platform and the
             extension, no VIP TradingView scripts and no Scout Alerts.
   'raven' — NEW. Raven: everything in 'site', plus the ORB Raven
             invite-only script on TradingView. The script is granted by
             Whop against a TradingView username, so as far as this worker
             is concerned Raven and Nightwing are identical — same site
             tools, same Nexus, still no Scout and no VIP scripts. The
             plans are kept apart so the label is right and so a future
             gate has somewhere to hang.
   'nexus' — the standalone extension product. Extension only, no site login.
   ─────────────────────────────────────────────────────────────────────────── */

/** The $9.99 Nightwing tier: "FSD-X Nightwing — Site Access + Nexus 2.0".
 *  One Whop product, four billing plans (monthly / 3mo / 6mo / yearly) — they
 *  all share one product_id, so one id covers the lot.
 *
 *  The id is baked in, same as the other products above, so NOTHING has to be
 *  set in Cloudflare for this tier to work. WHOP_PRODUCT_ID_SITE stays
 *  supported as an override: set it if the product is ever recreated and you
 *  need the fix live before a code deploy. _SITE_2 is a second slot in case
 *  the offer is ever split into its own product. */
export function siteProductIds(env) {
  const raw = [
    PRODUCT.NIGHTWING,
    env.WHOP_PRODUCT_ID_SITE,
    env.WHOP_PRODUCT_ID_SITE_2,
  ].filter(Boolean);

  /* Easiest mistake to make here is pasting a plan id. Whop surfaces plan ids
     everywhere — checkout links, the embedded-checkout snippet — and product
     ids almost nowhere, so `plan_…` in this variable is a very likely typo.
     It would never match a product_id, so the tier would just silently refuse
     every member. Say so in the log instead of failing quietly. */
  const ids = [];
  for (const v of raw) {
    const id = String(v).trim();
    if (id.startsWith('plan_')) {
      console.error(
        '[products] WHOP_PRODUCT_ID_SITE is set to a PLAN id (' + id + '). ' +
        'It must be the PRODUCT id, which starts with prod_. ' +
        'Nightwing memberships will be rejected until this is fixed.');
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/** The $39.99 Raven tier: "FSD-X Raven — ORB Levels + Platform".
 *  One Whop product, four billing plans (monthly / 3mo / 6mo / yearly) sharing
 *  one product_id, exactly like Nightwing.
 *
 *  Same plan_-id guard as siteProductIds, and for the same reason: Whop shows
 *  plan ids everywhere and product ids almost nowhere, so a pasted plan_ id is
 *  the likely mistake and it would silently refuse every Raven member. */
export function ravenProductIds(env) {
  const raw = [
    PRODUCT.RAVEN,
    env.WHOP_PRODUCT_ID_RAVEN,
    env.WHOP_PRODUCT_ID_RAVEN_2,
  ].filter(Boolean);

  const ids = [];
  for (const v of raw) {
    const id = String(v).trim();
    if (id.startsWith('plan_')) {
      console.error(
        '[products] WHOP_PRODUCT_ID_RAVEN is set to a PLAN id (' + id + '). ' +
        'It must be the PRODUCT id, which starts with prod_. ' +
        'Raven memberships will be rejected until this is fixed.');
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/** The two lower tiers behave identically on the web platform and in Nexus.
 *  Anywhere the old code asked `plan === 'site'`, ask this instead, or Raven
 *  members quietly get Nightwing's restrictions without Nightwing's label. */
export function isToolsPlan(plan) {
  return plan === 'site' || plan === 'raven';
}

/** Products that grant the full VIP bundle (indicators + site + Nexus). */
export function vipProductIds(env) {
  return [
    PRODUCT.VIP_LEGACY,
    PRODUCT.NEXUS_STANDALONE,
    PRODUCT.NEXUS_MARKETPLACE,
    env.WHOP_PRODUCT_ID,
    env.WHOP_PRODUCT_ID_2,
    env.WHOP_PRODUCT_ID_3,
    env.WHOP_PRODUCT_ID_4,
    env.WHOP_PRODUCT_ID_5,
    env.WHOP_PRODUCT_ID_6, // Pro (Plus + Auto Trader)
  ].filter(Boolean);
}

/** Products that grant the Nexus extension and its APIs.
 *  Deliberately NOT `vipProductIds` + site: the Optimizer products
 *  (WHOP_PRODUCT_ID_4 / _5) can sign in to the site but have never carried
 *  Nexus, and folding them in here would hand them the extension by accident.
 *  This is the list nexus-journal / -ai / -playbook / -validate always used,
 *  plus the new Nightwing tier. */
export function nexusProductIds(env) {
  return [
    PRODUCT.NEXUS_STANDALONE,
    PRODUCT.NEXUS_MARKETPLACE,
    PRODUCT.VIP_LEGACY,
    PRODUCT.PRO,
    env.WHOP_PRODUCT_ID_6, // Pro, when overridden in the dashboard
    ...siteProductIds(env),
    ...ravenProductIds(env),
  ].filter(Boolean);
}

/** True for the full VIP bundle plans — used where a trial or a standalone
 *  product must be told apart from a real VIP membership. */
export function isVipPlan(plan) {
  return plan === 'pro' || plan === 'plus';
}

/** Everything that may sign in to the site or use a Nexus API. */
export function allowedProductIds(env) {
  return [...vipProductIds(env), ...siteProductIds(env), ...ravenProductIds(env)];
}

/** Whop membership statuses we treat as live access. */
export const OK_STATUSES = ['active', 'trialing', 'past_due', 'completed'];

/** The looser list the Nexus endpoints have always used. Left as-is so this
 *  refactor changes nobody's access. */
export const NEXUS_OK_STATUSES =
  ['active', 'trialing', 'canceling', 'renewing', 'joined', 'completed'];

/** product_id → plan. Unknown ids fall through to 'plus', which is what the
 *  old `pid === proPid ? 'pro' : 'plus'` did — keep it, so an id we have not
 *  catalogued never silently downgrades an existing member. */
export function planForProduct(productId, env) {
  if (!productId) return null;
  if (siteProductIds(env).includes(productId)) return 'site';
  if (ravenProductIds(env).includes(productId)) return 'raven';
  if (productId === PRODUCT.NEXUS_STANDALONE ||
      productId === PRODUCT.NEXUS_MARKETPLACE) return 'nexus';
  const proPid = env.WHOP_PRODUCT_ID_6 || PRODUCT.PRO;
  if (productId === proPid) return 'pro';
  return 'plus';
}

/* ── Entitlements ───────────────────────────────────────────────────────────
   What each plan may use.

   ENFORCED TODAY: `scout` only. Every other flag is descriptive — it drives
   labels and locked-state copy in the UI, and gives the next gate somewhere
   obvious to live. Do not assume a false flag is blocking anything server-side
   until a route actually checks it.
   ─────────────────────────────────────────────────────────────────────────── */

const FEATURES = {
  pro: {
    label: 'VIP Pro',
    scout: true, journal: true, backtest: true, converter: true,
    playbook: true, accounts: true, course: true, refer: true,
    nexus: true, vipIndicators: true, autoTrader: true,
  },
  plus: {
    label: 'VIP Plus',
    scout: true, journal: true, backtest: true, converter: true,
    playbook: true, accounts: true, course: true, refer: true,
    nexus: true, vipIndicators: true, autoTrader: false,
  },
  site: {
    label: 'Nightwing',
    // Everything on the web platform except the live signal relay. Scout is
    // the reason to hold a VIP membership, so it stays behind that wall.
    scout: false,
    journal: true, backtest: true, converter: true,
    playbook: true, accounts: true, course: true, refer: true,
    nexus: true, vipIndicators: false, autoTrader: false,
  },
  raven: {
    label: 'Raven',
    // Identical to Nightwing on the web platform. The difference between the
    // two tiers is the ORB Raven script on TradingView, which Whop grants
    // directly — nothing here gates it, so nothing here needs to know about it.
    // vipIndicators stays false: that flag means the VIP suite (Knightfall,
    // Stack, Volume), which Raven does not include.
    scout: false,
    journal: true, backtest: true, converter: true,
    playbook: true, accounts: true, course: true, refer: true,
    nexus: true, vipIndicators: false, autoTrader: false,
  },
  nexus: {
    label: 'Nexus',
    // scout stays true here only because standalone Nexus keys can read the
    // feed today and this change is not the place to take that away. Set it
    // false when you want the alert feed to be VIP-only across the board.
    scout: true,
    journal: true, backtest: false, converter: false,
    playbook: true, accounts: false, course: false, refer: false,
    nexus: true, vipIndicators: false, autoTrader: false,
  },
};

/** Entitlements for a plan. An unknown or missing plan gets the VIP Plus set —
 *  fail open, never lock out a paying member over a mapping gap. */
export function entitlements(plan) {
  return { ...(FEATURES[plan] || FEATURES.plus), plan: plan || null };
}

/** Convenience: does this plan have the feature? */
export function can(plan, feature) {
  return !!entitlements(plan)[feature];
}
