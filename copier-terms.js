/* ============================================================
   FSD-X Copy Trader — Terms summary (single source)

   Used by:
     · checkout-gate.js   data-gate="copier" (load this file first)
     · copier.html        first-run / new-version accept gate
   The full legal text lives on copier-terms.html.

   VERSION RULE: `version` MUST equal COPIER_TERMS_VERSION in the
   Worker's copier.js and the version printed on copier-terms.html.
   Bump all three together. The Worker rejects an accept for any
   other version, and every member is asked again.

   Evergreen: no prices, trial lengths, or promo numbers here.
   ============================================================ */
window.FSDX_COPIER_TERMS = {
  version: "2026-10-05",
  eyebrow: "Before You Continue",
  title: "FSD-X Copy Trader — Terms of Use",
  points: [
    "The Copy Trader places <strong>real orders</strong> on your accounts. Use it at your own risk. <strong>Test on demo or sim accounts first.</strong>",
    "It copies trades <strong>between Tradovate accounts you own or control</strong>. It never copies FSD-X, another member, or a signal provider. It is <strong>not a signal service, not a managed account, and not financial advice</strong>.",
    "Software can fail. Outages, disconnects, API limits, delayed or rejected orders, partial fills, slippage, and <strong>missed or duplicate orders</strong> can all happen.",
    "Followers copy the leader's <strong>position only, not its stop or target orders</strong>. If the copier stops for any reason, <strong>followers have no stop of their own</strong>. Risk limits are checked on a timer and <strong>can be exceeded</strong> in fast markets.",
    "<strong>You</strong> are responsible for every account and position. Watch your accounts while it runs and be ready to <strong>flatten manually</strong> on Tradovate at any time.",
    "<strong>Prop firm and broker rules are your responsibility.</strong> Some firms ban or restrict copy trading. FSD-X is not liable for rule breaks, failed evaluations, closed accounts, or withheld payouts.",
    "FSD-X makes <strong>no performance claims</strong> and is <strong>not liable for trading losses</strong>. Liability is limited as set out in the full terms.",
    "You authorize FSD-X to read your Tradovate account data (accounts, positions, orders, fills, balances) and place orders on the accounts you choose, <strong>only to run the Copy Trader</strong>. Your acceptance is recorded with the date, terms version, IP address, and browser.",
    "I have read and agree to the full <a href='copier-terms.html' target='_blank' rel='noopener' class='text-green-400 underline hover:text-green-300'>Copy Trader Terms</a> and the <a href='disclosures.html' target='_blank' rel='noopener' class='text-green-400 underline hover:text-green-300'>Disclosures &amp; Terms of Service</a>."
  ],
  agree: "I accept the FSD-X Copy Trader Terms. I am responsible for every account, position, order, and loss it touches. FSD-X is not liable for any result.",
  proceed: "Proceed to Checkout"
};
