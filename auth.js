// auth.js — FSD-X Site Authentication
// Signup, login, logout, session verify, forgot/reset password, admin routes

import {
  allowedProductIds, planForProduct,
  entitlements, OK_STATUSES,
} from './products.js';
import {
  hashPassword, verifyPassword, generateToken, randomCode6,
  createSession, getSessionFromRequest, updateSession, destroySession,
  revokeAllSessions, bearerToken, isAdminSession, adminEmail as adminEmailOf,
  rateCheck, rateHit, rateClear, clientIp, totpAlreadyUsed,
  escapeHtml, cleanName, cleanEmail, maskKey,
} from './security.js';
import { purgeMember as purgeTradovate } from './tradovate.js';

/* Sign in with Whop is a SETUP door, not a login method (Oct 2026).
   Setup is done once the account has a password AND its Whop key; after that
   the door is closed and cannot be reopened. Email + password (+ 2FA) only. */
function whopSetupDone(user) { return !!(user && user.passwordHash && user.whopKey); }
function whopSignInOpen(user) { return !!user && user.whopLoginEnabled !== false && !whopSetupDone(user); }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

// ── Site-traffic helpers ──
// Store/aggregate visits by America/Chicago calendar date so "today" matches DJ's day.
function ctDay(d = new Date()) {
  // en-CA locale yields YYYY-MM-DD; timeZone handles DST automatically
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}
function lastNDays(n) {
  const days = [];
  // Anchor at 12:00Z (06:00/07:00 CT — always same calendar date) and step back a day at a time
  let cur = new Date(ctDay() + 'T12:00:00Z');
  for (let i = 0; i < n; i++) {
    days.push(cur.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
    cur = new Date(cur.getTime() - 86400000);
  }
  return days; // today first
}

export async function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code ?? '').trim())) return false;
  // RFC 6238 TOTP — 30 second window, check current + prev + next step for clock drift
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Decode base32 secret
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = base32Chars.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const keyBytes = new Uint8Array(bytes);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);

  const timeStep = Math.floor(Date.now() / 1000 / 30);
  for (const step of [timeStep - 1, timeStep, timeStep + 1]) {
    const msg = new Uint8Array(8);
    let t = step;
    for (let i = 7; i >= 0; i--) { msg[i] = t & 0xff; t = Math.floor(t / 256); }
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
    const h = new Uint8Array(sig);
    const offset = h[19] & 0xf;
    const otp = ((h[offset] & 0x7f) << 24 | h[offset+1] << 16 | h[offset+2] << 8 | h[offset+3]) % 1000000;
    if (String(otp).padStart(6, '0') === String(code).trim()) return true;
  }
  return false;
}

// The products that grant site access, and what each one is worth. Both the
// license-key check and the OAuth membership lookup read the same registry, so
// they can never drift apart. See products.js.
const WHOP_OK_STATUSES = OK_STATUSES;

async function validateWhopKey(key, env) {
  const masterKeys = (env.MASTER_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (masterKeys.includes(key)) return { valid: true, tier: 'pro', plan: 'pro', status: 'completed', expiresAt: null, renewalEnd: null, cancelAtPeriodEnd: false };

  // Nightwing ($9.99) counts here too — it is a real membership, it just
  // maps to a thinner plan. The plan decides what they see; this list only
  // decides whether they get in at all.
  const allowedProducts = allowedProductIds(env);

  const allowedStatuses = WHOP_OK_STATUSES;

  try {
    const whopRes = await fetch(`https://api.whop.com/v5/company/memberships/${key}`, {
      headers: { 'Authorization': `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json' }
    });
    const whopData = await whopRes.json();
    if (!whopData.valid || !allowedStatuses.includes(whopData.status)) {
      return { valid: false, reason: `Subscription status: ${whopData.status || 'invalid'}` };
    }
    if (!allowedProducts.includes(whopData.product_id)) {
      return { valid: false, reason: 'This key is not valid for FSD-X site access.' };
    }
    const tier = whopData.status === 'trialing' ? 'trial' : 'pro';
    const plan = planForProduct(whopData.product_id, env);
    // The Whop account behind this key, saved at login.
    const wu = whopData.user;
    const whopUserId = (wu && typeof wu === 'object' ? wu.id : wu) || whopData.user_id || null;
    return {
      valid: true, tier, plan, status: whopData.status,
      whopUserId: (typeof whopUserId === 'string' && whopUserId.startsWith('user_')) ? whopUserId : null,
      expiresAt: whopData.expires_at || null,
      renewalEnd: whopData.renewal_period_end || null,
      cancelAtPeriodEnd: whopData.cancel_at_period_end || false,
    };
  } catch (err) {
    console.error('[auth] Whop fetch error:', err.message);
    return { valid: false, reason: 'Could not reach Whop API' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Sign in with Whop (OAuth 2.1 + PKCE)

   Point of the whole thing: the member never sees a license key. They click
   one button, approve on Whop, and we read their membership — key, status,
   plan — straight from the API.

   Whop requires PKCE, so we mint a verifier per attempt and keep it in KV
   next to the state value. Both die after 10 minutes.
   ══════════════════════════════════════════════════════════════════════════ */

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64url(len = 32) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

function whopRedirectUri(env) {
  return env.WHOP_REDIRECT_URI
    || 'https://nexus-validator.dfuentes4211.workers.dev/api/auth/whop/callback';
}

function siteUrl(env) {
  return (env.SITE_URL || 'https://fsdxtrading.com').replace(/\/+$/, '');
}

/* Where to send the browser when OAuth cannot finish. Always the login page
   with a readable reason — never a bare error, and never an open redirect. */
function whopFail(env, reason) {
  return Response.redirect(`${siteUrl(env)}/login.html?whop=${encodeURIComponent(reason)}`, 302);
}

/**
 * Find the membership we should honour for a Whop user.
 * A user can hold several; rank by status, then prefer one that actually
 * carries a license_key. Returns null when they hold none of our products —
 * that is a pending account, not an error.
 */
async function whopMembershipForUser(whopUserId, env) {
  const companyId = env.WHOP_COMPANY_ID || 'biz_2f60zABhyFQYpX';
  const url = `https://api.whop.com/api/v1/memberships`
    + `?company_id=${encodeURIComponent(companyId)}`
    + `&user_ids[]=${encodeURIComponent(whopUserId)}&first=50`;

  let list = [];
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json' }
    });
    const body = await res.json();
    list = Array.isArray(body?.data) ? body.data : [];
  } catch (err) {
    console.error('[whop-oauth] memberships fetch failed:', err.message);
    return null;
  }

  const allowed = allowedProductIds(env);
  const mine = list.filter(m => {
    const pid = m?.product?.id || m?.product_id;
    return pid && allowed.includes(pid);
  });
  if (!mine.length) return null;

  const rank = s => {
    const i = WHOP_OK_STATUSES.indexOf(s);
    return i === -1 ? 99 : i;
  };
  /* Someone can hold the $9.99 Nightwing tier AND a full VIP membership at the
     same time — a member who downgraded but whose old term has not run out, or
     an upgrade bought mid-cycle. Honour the richer one, or the upgrade looks
     like it did nothing. */
  const planRank = m => {
    // raven/site carry the same platform.
    const order = { pro: 0, plus: 1, ntsolo: 2, raven: 3, site: 4, nexus: 5 };
    const p = planForProduct(m?.product?.id || m?.product_id, env);
    return p in order ? order[p] : 4;
  };

  mine.sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    const p = planRank(a) - planRank(b);
    if (p !== 0) return p;
    // Among equals, the one that actually has a key wins — it is the whole point.
    return (b.license_key ? 1 : 0) - (a.license_key ? 1 : 0);
  });

  const m = mine[0];
  if (!WHOP_OK_STATUSES.includes(m.status)) return null;

  const pid = m?.product?.id || m?.product_id;
  return {
    licenseKey: m.license_key || null,
    status: m.status,
    tier: m.status === 'trialing' ? 'trial' : 'pro',
    plan: planForProduct(pid, env),
    renewalEnd: m.renewal_period_end || null,
    cancelAtPeriodEnd: m.cancel_at_period_end || false,
    expiresAt: m.expires_at || null
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Whop admin sync — pull the whole company roster instead of importing CSVs.

   Same v1 API the OAuth path already uses, but company-wide and paged.
   These helpers only READ. Nothing here touches user:{email} records or
   anyone's live access — the output goes to the admin roster and nowhere else.
   ══════════════════════════════════════════════════════════════════════════ */

// Cursor-paginate a v1 list endpoint. Hard page cap so a bad cursor can never
// spin the worker until it is killed.
async function whopPaged(path, params, env, { pageSize = 100, maxPages = 60 } = {}) {
  const out = [];
  let after = null;
  let pages = 0;

  while (pages < maxPages) {
    const url = new URL(`https://api.whop.com/api/v1/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, v);
    }
    url.searchParams.set('first', String(pageSize));
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 403 here almost always means the API key is missing a read scope.
      throw new Error(`Whop ${path} returned ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }

    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    out.push(...rows);
    pages++;

    const info = body?.page_info || {};
    if (!info.has_next_page || !info.end_cursor || !rows.length) break;
    after = info.end_cursor;
  }

  return { rows: out, pages, capped: pages >= maxPages };
}

// "$129.99" / "$1,299.00 / year" → 129.99 / 1299. Whop only gives the renewal
// price pre-formatted; the roster does arithmetic on it.
function moneyToNumber(s) {
  if (s === null || s === undefined || s === '') return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? (Number(m[0]) || 0) : 0;
}

/**
 * Whop membership status → roster status.
 * Mirrors parseWhopMemberships() in admin.html exactly. "completed" is a
 * finished one-time / lifetime purchase, not a churn — do not map it to
 * cancelled or the member drops out of the roster.
 */
function rosterStatusFor(rawStatus, cancelAtEnd) {
  const s = (rawStatus || '').toLowerCase();
  if (s === 'canceled' || s === 'cancelled' || s === 'expired') return 'cancelled';
  if (s === 'completed') return 'lifetime';
  if (s === 'past_due' || s === 'unresolved') return 'past_due';
  if (s === 'trialing') return cancelAtEnd ? 'trial_cancelled' : 'trialing';
  if (s === 'paused' || s === 'drafted') return 'inactive';
  if (s === 'active') return cancelAtEnd ? 'canceling' : 'active';
  return 'active';
}

const ROSTER_STATUS_PRIORITY = {
  active: 0, trialing: 1, canceling: 2, past_due: 3,
  lifetime: 4, trial_cancelled: 5, inactive: 6, cancelled: 7
};

/**
 * Normalize v1 memberships into roster rows and collapse to one row per user.
 *
 * The collapse matters: someone who upgraded holds two memberships, and the
 * roster merge in admin.html matches on email, so two rows for one person
 * means the last one wins — which can quietly downgrade a paying member to
 * whatever their dead old membership says.
 *
 * accessType is deliberately left as the product title. admin.html owns
 * PLAN_MAP and relabels from planIds after this lands, so plan naming stays
 * in one place.
 */
function normalizeWhopMemberships(list) {
  const today = ctDay();

  const rows = list.map(m => {
    const cancelAtEnd = m.cancel_at_period_end === true;
    const status = rosterStatusFor(m.status, cancelAtEnd);
    const periodEnd = (m.renewal_period_end || '').split('T')[0];
    const created = (m.created_at || '').split('T')[0];
    const updated = (m.updated_at || '').split('T')[0];

    /* When did they actually leave?
       Whop gives `renewal_period_end` — the end of the period they were in.
       That is the right answer for someone who cancelled at period end and
       then lapsed. It is the wrong answer for an immediate cancel, where it
       points at a renewal date they never reached, and a churn date in the
       future poisons tenure, the trial-leaver flag and the churn history.
       Nobody can have left on a future date, so fall back to when Whop last
       touched the record — that is when it was flipped. */
    const churnedDate = status === 'cancelled'
      ? ((periodEnd && periodEnd <= today) ? periodEnd
        : (updated && updated <= today) ? updated
        : today)
      : '';
    const planId = m?.plan?.id || m?.plan_id || '';
    const productId = m?.product?.id || m?.product_id || '';
    const title = m?.product?.title || '';
    const u = m?.user || {};

    // Lifetime and cancelled rows have no renewal coming. Leave it blank so
    // they never land in the revenue forecast.
    const renewal = (status === 'cancelled' || status === 'lifetime') ? '' : periodEnd;

    return {
      id: m.id || '',
      membershipId: m.id || '',
      userId: u.id || '',
      name: u.name || '',
      whopUsername: u.username || '',
      // The CSV export has no email column, which is why the old flow needed a
      // second file and a merge. The API carries it.
      email: (u.email || '').toLowerCase(),
      whopKey: m.license_key || '',
      status,
      rawStatus: m.status || '',
      accessType: title || planId || '—',
      planName: title || planId || '—',
      planId,
      planIds: planId ? [planId] : [],
      productId,
      productName: title,
      source: 'Whop',
      joined: created,
      renewal,
      tvRenew: renewal,
      tvRemoval: status === 'cancelled' ? 'Removed' : cancelAtEnd ? 'Pending' : 'No',
      churnedDate,
      cancelingDate: (cancelAtEnd && status !== 'cancelled') ? periodEnd : '',
      cancelAtPeriodEnd: cancelAtEnd,
      currency: m.currency || '',
      // admin.html expects numbers here — billingAmount falls back to
      // renewalPrice, and a formatted "$129.99" string would poison the
      // revenue forecast. Keep the display string alongside, not instead.
      renewalPrice: moneyToNumber(m.formatted_renewal_price),
      renewalPriceFormatted: m.formatted_renewal_price || '',
      initialPrice: Number(m.initial_price_paid ?? 0) || 0,
      // Blank, not '0' — the roster merge keeps the existing value when the
      // incoming one is falsy. '0' is truthy and would wipe real spend,
      // Discord names and countries that only exist in the CSV history.
      spend: '',
      discordName: '',
      discordId: '',
      tvUsername: '',
      country: '',
      cancelReason: '',
      notes: '',
      source_detail: 'whop_api',
    };
  });

  // One row per user, best live status wins.
  const bestByUser = {};
  const loose = [];
  for (const row of rows) {
    const uk = row.userId || row.email || row.whopKey;
    if (!uk) { loose.push(row); continue; }

    const ex = bestByUser[uk];
    if (!ex) { bestByUser[uk] = row; continue; }

    const exPri = ROSTER_STATUS_PRIORITY[ex.status] ?? 99;
    const newPri = ROSTER_STATUS_PRIORITY[row.status] ?? 99;
    const winner = newPri < exPri ? row : ex;
    const loser  = winner === row ? ex : row;

    // Carry forward anything the winning row is missing.
    winner.whopKey = winner.whopKey || loser.whopKey;
    winner.email = winner.email || loser.email;
    winner.name = winner.name || loser.name;
    winner.whopUsername = winner.whopUsername || loser.whopUsername;
    if (loser.joined && (!winner.joined || loser.joined < winner.joined)) winner.joined = loser.joined;
    // Keep every plan they hold so admin.html can label the stack.
    for (const p of loser.planIds) if (p && !winner.planIds.includes(p)) winner.planIds.push(p);

    bestByUser[uk] = winner;
  }

  return [...Object.values(bestByUser), ...loose];
}

/**
 * Normalize v1 payments into the row shape handlePaymentsImport() produces,
 * so synced payments and CSV-imported payments are interchangeable.
 */
function normalizeWhopPayments(list) {
  return list.map(p => {
    const u = p?.user || {};
    const gross = p.usd_total ?? p.total ?? 0;
    const net = (p.amount_after_fees === undefined || p.amount_after_fees === null)
      ? null : Number(p.amount_after_fees);

    return {
      id: p.id || '',
      paidAt: p.paid_at || p.created_at || '',
      status: p.status || '',
      substatus: p.substatus || '',
      description: p?.product?.title || '',
      email: (u.email || '').toLowerCase(),
      discordName: '',
      amount: Number(gross) || 0,
      netAmount: net,
      productId: p?.product?.id || '',
      planId: p?.plan?.id || '',
      subtotal: Number(p.subtotal ?? 0) || 0,
      // Whop's CSV "Promo code" column is the discount AMOUNT, not a code.
      // amount_off is the API equivalent — keep the same meaning.
      promoDiscount: Number(p?.promo_code?.amount_off ?? 0) || 0,
      promoCode: p?.promo_code?.code || '',
      taxAmount: Number(p.tax_amount ?? 0) || 0,
      refundedAmount: Number(p.refunded_amount ?? 0) || 0,
      nativeAmount: Number(p.total ?? 0) || 0,
      currency: p.currency || 'usd',
      billingReason: p.billing_reason || '',
      failureReason: p.failure_message || p.decline_code || '',
      customerName: u.name || '',
      country: '',
      receiptNumber: '',
      source_detail: 'whop_api',
    };
  });
}

async function sendEmail(env, { to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Transactional sender. "onboarding@" reads as marketing to spam filters;
        // replies go to the real support inbox.
        from: 'FSD-X Trading <no-reply@fsdxtrading.com>',
        reply_to: 'fsdxteam@gmail.com',
        to,
        subject,
        html
      })
    });
    // Resend answers errors (bad key, unverified domain) with a normal HTTP
    // response, not an exception — so check the status, don't assume success.
    const data = await res.json().catch(() => ({}));
    if (!env.RESEND_API_KEY) console.error('[auth] email NOT sent: RESEND_API_KEY is not set on the worker');
    if (!res.ok || !data.id) {
      console.error('[auth] email FAILED:', res.status, JSON.stringify(data).slice(0, 300));
      return { success: false, status: res.status, error: data?.message || data?.name || 'send failed' };
    }
    console.log('[auth] email sent:', data.id);
    return { success: true };
  } catch (err) {
    console.error('[auth] email error:', err.message);
    return { success: false };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── POST /api/auth/signup ──
    if (path === '/api/auth/signup' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { email, password, key } = body || {};
      const firstName = cleanName(body?.firstName);
      const lastName  = cleanName(body?.lastName);
      if (!email || !password) return json({ error: 'Email and password are required.' }, 400);
      if (typeof password !== 'string' || password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      if (password.length > 256) return json({ error: 'Password is too long.' }, 400);
      const emailKey = cleanEmail(email);
      if (!emailKey) return json({ error: 'Please enter a valid email address.' }, 400);

      // Slow down scripted signups: 10 per IP per hour.
      if (await rateHit(env, 'signup', clientIp(request), 10, 3600)) {
        return json({ error: 'Too many signups from this network. Try again later.' }, 429);
      }
      const existing = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });
      if (existing) return json({ error: 'An account with this email already exists. Please log in.' }, 400);

      // Key is optional. Without one the account is created "pending" — it exists,
      // but every VIP tool stays locked until a key is attached. This lets someone
      // create an account without hunting for their key first.
      let whopCheck = { valid: false, tier: 'pending', plan: null, status: 'pending',
                        expiresAt: null, renewalEnd: null, cancelAtPeriodEnd: false };
      if (key) {
        const existingKeyOwner = await env.NEXUS_KV.get(`key_account:${key}`);
        if (existingKeyOwner && existingKeyOwner !== emailKey) {
          return json({ error: 'This Whop key is already linked to another account. Contact support.' }, 400);
        }
        whopCheck = await validateWhopKey(key, env);
        if (!whopCheck.valid) return json({ error: `Key not valid: ${whopCheck.reason}` }, 400);
      }

      const passwordHash = await hashPassword(password);
      const user = {
        email: emailKey,
        firstName: firstName || '',
        lastName: lastName || '',
        passwordHash,
        whopKey: key || null,
        tier: whopCheck.tier,
        whopStatus: whopCheck.status,
        whopPlan: whopCheck.plan || null,
        whopExpiresAt: whopCheck.expiresAt || null,
        whopRenewalEnd: whopCheck.renewalEnd || null,
        whopCancelAtPeriodEnd: whopCheck.cancelAtPeriodEnd || false,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
      if (key) await env.NEXUS_KV.put(`key_account:${key}`, emailKey);

      // Track member list
      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      memberList.unshift({ email: emailKey, firstName: user.firstName, lastName: user.lastName, createdAt: user.createdAt, tier: user.tier, whopKey: key || null });
      await env.NEXUS_KV.put('admin:member_list', JSON.stringify(memberList));

      const token = await createSession(env, {
        email: emailKey, firstName: user.firstName, tier: whopCheck.tier,
        plan: whopCheck.plan || null,
        subscriptionActive: !!key, expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
      }, 7 * 24 * 60 * 60);

      // Welcome email — the full version prints the key, so only send it when keyed.
      if (key) await sendEmail(env, {
        to: emailKey,
        subject: 'Welcome to FSD-X VIP — Your account is active',
        html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#ffffff;padding:0;margin:0;">
          <div style="max-width:520px;margin:0 auto;padding:40px 32px;">

            <!-- Header -->
            <div style="margin-bottom:32px;">
              <div style="font-size:22px;font-weight:900;color:#22c55e;letter-spacing:0.05em;">FSD-X</div>
              <div style="font-size:11px;color:#52525b;text-transform:uppercase;letter-spacing:0.15em;margin-top:2px;">Trading</div>
            </div>

            <!-- Main -->
            <div style="border:1px solid #27272a;border-radius:12px;padding:28px 28px 24px;margin-bottom:24px;">
              <p style="font-size:18px;font-weight:700;color:#ffffff;margin:0 0 6px;">Welcome, ${escapeHtml(firstName || 'Trader')} 👋</p>
              <p style="font-size:14px;color:#71717a;margin:0 0 24px;line-height:1.6;">Your VIP account is active. Here's everything you need to get started.</p>

              <!-- Whop Key -->
              <div style="background:#0d1f14;border:1px solid #166534;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                <div style="font-size:10px;color:#4ade80;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:8px;">// Your Whop License Key</div>
                <div style="font-family:'Courier New',monospace;font-size:13px;color:#22c55e;word-break:break-all;line-height:1.5;">${escapeHtml(key)}</div>
                <div style="font-size:11px;color:#4b5563;margin-top:8px;">You'll need this to activate FSD-X Nexus. Keep it safe.</div>
              </div>

              <!-- Links -->
              <div style="display:flex;flex-direction:column;gap:10px;">
                <a href="https://www.fsdxtrading.com/setup" style="display:block;background:#22c55e;color:#000000;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:700;text-align:center;letter-spacing:0.03em;">Get Started →</a>
                <a href="https://www.fsdxtrading.com/suite" style="display:block;background:#18181b;border:1px solid #27272a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:600;text-align:center;">View the FSD-X Suite</a>
              </div>
            </div>

            <!-- Support -->
            <div style="border:1px solid #27272a;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <p style="font-size:13px;color:#a1a1aa;margin:0;line-height:1.6;">Need help? Visit our <a href="https://www.fsdxtrading.com/contact" style="color:#22c55e;text-decoration:none;font-weight:600;">support page</a> and we'll get you sorted.</p>
            </div>

            <!-- Security -->
            <p style="font-size:11px;color:#3f3f46;line-height:1.6;margin:0;">If you didn't sign up for an FSD-X account, please <a href="https://www.fsdxtrading.com/contact" style="color:#52525b;">contact us immediately</a> so we can secure your key.</p>

          </div>
        </div>`
      });

      console.log('[auth] signup success:', emailKey, key ? '(keyed)' : '(pending)');
      return json({ success: true, token, firstName: user.firstName, tier: whopCheck.tier,
                    plan: whopCheck.plan || null,
                    entitlements: entitlements(whopCheck.plan),
                    whopStatus: whopCheck.status || 'active', pending: !key });
    }

    // ── POST /api/auth/login ──
    if (path === '/api/auth/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { email, password } = body || {};
      if (!email || !password) return json({ error: 'Email and password are required.' }, 400);

      const emailKey = String(email).trim().toLowerCase();
      const ip = clientIp(request);

      // Attempt limits: 10 misses per account and 30 per IP, per 15 minutes.
      // The same generic message either way, so this can't be used to probe emails.
      const LOCKED = 'Too many failed attempts. Wait 15 minutes, or reset your password.';
      if (await rateCheck(env, 'login_email', emailKey, 10) || await rateCheck(env, 'login_ip', ip, 30)) {
        return json({ error: LOCKED }, 429);
      }

      const user = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });
      // verifyPassword runs the full hash even when there's no account, so
      // "no such email" and "wrong password" look identical from outside.
      const pw = await verifyPassword(password, user?.passwordHash);
      if (!user || !pw.ok) {
        await rateHit(env, 'login_email', emailKey, 10, 900);
        await rateHit(env, 'login_ip', ip, 30, 900);
        return json({ error: 'Incorrect email or password.' }, 401);
      }
      await rateClear(env, 'login_email', emailKey);

      // Old unsalted hash → upgrade in place, silently.
      if (pw.needsUpgrade) {
        user.passwordHash = await hashPassword(password);
        try { await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user)); } catch (e) {}
      }

      let tier = user.tier;
      let subscriptionActive = true;

      /* ── Pending account ──────────────────────────────────────────────────
         Signup no longer requires a Whop key, so an account can legitimately
         have none. Without this branch validateWhopKey(null) fails and login
         answers "Your membership is no longer active" with a 403 — locking the
         member out of the one screen where they could add their key. A missing
         key is not a lapsed membership; let them in, flagged as pending. */
      const isPendingAccount = !user.whopKey;
      if (isPendingAccount) {
        tier = 'pending';
        subscriptionActive = false;
        user.tier = 'pending';
        user.whopStatus = 'pending';
        user.lastLogin = new Date().toISOString();
        try { await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user)); } catch (e) {}

        if (user.twoFactorEnabled && user.totpSecret) {
          const preToken = generateToken(16);
          await env.NEXUS_KV.put(`user_preauth:${preToken}`, emailKey, { expirationTtl: 300 });
          return json({ success: true, requires2FA: true, preToken, firstName: user.firstName || '' });
        }

        const pendingToken = await createSession(env, {
          email: emailKey, firstName: user.firstName || '', tier: 'pending',
          subscriptionActive: false, expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
        }, 7 * 24 * 60 * 60);

        console.log('[auth] login success (pending, no key):', emailKey);
        return json({
          success: true, token: pendingToken, firstName: user.firstName || '',
          tier: 'pending', plan: null, subscriptionActive: false,
          whopStatus: 'pending', pending: true
        });
      }

      try {
        // Check master key first — master keys always have active subscription
        const masterKeys = (env.MASTER_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
        if (masterKeys.includes(user.whopKey)) {
          tier = 'pro';
          subscriptionActive = true;
          // Master keys = lifetime members — set completed status so dashboard shows correctly
          user.whopStatus = 'completed';
          user.whopPlan = 'pro';
          user.whopExpiresAt = null;
          user.whopRenewalEnd = null;
          user.whopCancelAtPeriodEnd = false;
        } else {
          const whopCheck = await validateWhopKey(user.whopKey, env);
          tier = whopCheck.valid ? whopCheck.tier : 'inactive';
          subscriptionActive = whopCheck.valid;
          if (whopCheck.valid) {
            user.whopStatus = whopCheck.status;
            user.whopPlan = whopCheck.plan || user.whopPlan || null;
            user.whopExpiresAt = whopCheck.expiresAt;
            user.whopRenewalEnd = whopCheck.renewalEnd;
            user.whopCancelAtPeriodEnd = whopCheck.cancelAtPeriodEnd;
            /* Remember which Whop account this member uses. Never overwrite
               an existing link, never claim an id already linked to someone else. */
            if (whopCheck.whopUserId && !user.whopUserId) {
              const owner = await env.NEXUS_KV.get(`whop_user:${whopCheck.whopUserId}`);
              if (!owner || owner === emailKey) {
                user.whopUserId = whopCheck.whopUserId;
                if (!owner) await env.NEXUS_KV.put(`whop_user:${whopCheck.whopUserId}`, emailKey);
              }
            }
          } else {
            user.whopStatus = 'inactive';
            user.lastLogin = new Date().toISOString();
            await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
            return json({
              error: 'Your membership is no longer active. Renew at https://whop.com/joined/dj-trades-fsdx/ or contact fsdxteam@gmail.com for help.',
              inactive: true
            }, 403);
          }
        }
        user.tier = tier;
        user.lastLogin = new Date().toISOString();
        await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
      } catch (err) {
        console.error('[auth] Whop re-validation error:', err.message);
        // Don't block login if Whop check fails — let them in on cached status
      }

      // If user has 2FA enabled, issue a short-lived preToken instead of a full session
      if (user.twoFactorEnabled && user.totpSecret) {
        const preToken = generateToken(16);
        await env.NEXUS_KV.put(`user_preauth:${preToken}`, emailKey, { expirationTtl: 300 });
        console.log('[auth] login step 1 (2FA required):', emailKey);
        return json({ success: true, requires2FA: true, preToken, firstName: user.firstName || '' });
      }

      const token = await createSession(env, {
        email: emailKey, firstName: user.firstName || '', tier,
        plan: user.whopPlan || null,
        subscriptionActive, expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
      }, 7 * 24 * 60 * 60);

      console.log('[auth] login success:', emailKey, 'tier:', tier, 'plan:', user.whopPlan || '-');
      return json({ success: true, token, firstName: user.firstName || '', tier,
                    plan: user.whopPlan || null,
                    entitlements: entitlements(user.whopPlan),
                    subscriptionActive, whopStatus: user.whopStatus || 'active' });
    }

    /* ── GET /api/auth/whop/start ──────────────────────────────────────────
       Kicks off "Continue with Whop". Mints state + PKCE verifier, parks them
       in KV for 10 minutes, and bounces the browser to Whop's consent screen. */
    if (path === '/api/auth/whop/start' && request.method === 'GET') {
      if (!env.WHOP_CLIENT_ID) return whopFail(env, 'notconfigured');

      const state = randomB64url(32);
      const verifier = randomB64url(48);
      const challenge = await pkceChallenge(verifier);

      // `next` is allow-listed. An open redirect here would be a real hole.
      const ALLOWED_NEXT = ['dashboard.html', 'journal.html', 'playbook.html',
                            'backtest.html', 'accounts.html', 'alerts.html', 'converter.html'];
      const wanted = url.searchParams.get('next') || 'dashboard.html';
      const next = ALLOWED_NEXT.includes(wanted) ? wanted : 'dashboard.html';

      await env.NEXUS_KV.put(`oauth_state:${state}`,
        JSON.stringify({ verifier, next, createdAt: Date.now() }),
        { expirationTtl: 600 });

      const authorize = new URL('https://api.whop.com/oauth/authorize');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', env.WHOP_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', whopRedirectUri(env));
      authorize.searchParams.set('scope', 'openid profile email');
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('nonce', randomB64url(16));
      authorize.searchParams.set('code_challenge', challenge);
      authorize.searchParams.set('code_challenge_method', 'S256');

      return Response.redirect(authorize.toString(), 302);
    }

    /* ── GET /api/auth/whop/callback ───────────────────────────────────────
       Whop sends the browser back here with ?code&state. This is the only
       place the client secret is used, which is why it cannot live on the
       static site. Ends by handing the browser a one-time code in the URL
       hash; the page trades that for a real session token. */
    if (path === '/api/auth/whop/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (url.searchParams.get('error')) return whopFail(env, 'denied');
      if (!code || !state) return whopFail(env, 'missing');

      const stashed = await env.NEXUS_KV.get(`oauth_state:${state}`, { type: 'json' });
      if (!stashed) return whopFail(env, 'state');           // CSRF guard, or just expired
      await env.NEXUS_KV.delete(`oauth_state:${state}`);      // single use

      /* 1. code → token
         Whop's published example sends client_secret in a JSON body, but a
         Confidential app rejects that with invalid_client. Rather than guess
         which convention their server wants, try each accepted OAuth style in
         order and take the first that returns a token. The attempt that works
         is logged, so this can be collapsed to one call afterwards.

         A failed CLIENT authentication does not redeem the authorization
         code, so falling through to the next style is safe. */
      const basic = btoa(`${env.WHOP_CLIENT_ID}:${env.WHOP_CLIENT_SECRET}`);
      const commonParams = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: whopRedirectUri(env),
        code_verifier: stashed.verifier
      };

      /* The app's OAuth client mode decides which of these Whop accepts.
         Public (PKCE only, no secret) is listed first because that is how the
         FSD-X app is configured; the secret-bearing styles follow so this keeps
         working if the mode is ever switched back to Confidential. The winning
         style is logged. */
      const attempts = [
        { name: 'json+pkce',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ ...commonParams, client_id: env.WHOP_CLIENT_ID }) },
        { name: 'form+pkce',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body: new URLSearchParams({ ...commonParams, client_id: env.WHOP_CLIENT_ID }).toString() },
        { name: 'json+secret',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ ...commonParams, client_id: env.WHOP_CLIENT_ID,
                                 client_secret: env.WHOP_CLIENT_SECRET }) },
        { name: 'basic+json',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                     'Authorization': `Basic ${basic}` },
          body: JSON.stringify({ ...commonParams, client_id: env.WHOP_CLIENT_ID }) },
        { name: 'form+secret',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body: new URLSearchParams({ ...commonParams, client_id: env.WHOP_CLIENT_ID,
                                      client_secret: env.WHOP_CLIENT_SECRET }).toString() },
        { name: 'basic+form',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
                     'Authorization': `Basic ${basic}` },
          body: new URLSearchParams({ ...commonParams, client_id: env.WHOP_CLIENT_ID }).toString() }
      ];

      let tokenData = null;
      const tried = [];
      for (const a of attempts) {
        try {
          const res = await fetch('https://api.whop.com/oauth/token', {
            method: 'POST', headers: a.headers, body: a.body
          });
          const body = await res.json().catch(() => null);
          if (body && body.access_token) {
            console.log('[whop-oauth] token exchange succeeded via:', a.name);
            tokenData = body;
            break;
          }
          tried.push(`${a.name}=${res.status}:${body?.error || '?'}`);
          console.error('[whop-oauth] token attempt', a.name, 'http', res.status,
                        'body', JSON.stringify(body));
        } catch (err) {
          tried.push(`${a.name}=threw`);
          console.error('[whop-oauth] token attempt', a.name, 'threw:', err.message);
        }
      }

      if (!tokenData) {
        // Every style refused. Carry the per-attempt results back to the page
        // so the failure is diagnosable without digging through worker logs.
        const d = tried.join(' | ').slice(0, 180);
        return Response.redirect(
          `${siteUrl(env)}/login.html?whop=token&d=${encodeURIComponent(d)}`, 302);
      }

      // 2. who are they
      let info;
      try {
        const res = await fetch('https://api.whop.com/oauth/userinfo', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        info = await res.json();
      } catch (err) {
        console.error('[whop-oauth] userinfo failed:', err.message);
        return whopFail(env, 'userinfo');
      }

      const whopUserId = info?.sub;
      const whopEmail = (info?.email || '').toLowerCase();
      if (!whopUserId) return whopFail(env, 'userinfo');

      const givenName = cleanName(info?.given_name || (info?.name || '').split(' ')[0] || '');
      const familyName = cleanName(info?.family_name || (info?.name || '').split(' ').slice(1).join(' ') || '');

      // 3. what do they hold — null means pending, which is fine, not an error
      const membership = await whopMembershipForUser(whopUserId, env);

      /* 4. Which site account is this?
            a) one already linked to this Whop user
            b) one with the same email  → link it
            c) neither                  → create one
         Only (b) needs care: we match on the email Whop gave us, which Whop
         has already verified for the account they just logged into. */
      let emailKey = await env.NEXUS_KV.get(`whop_user:${whopUserId}`);
      let user = emailKey ? await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' }) : null;

      // Only link by email when Whop says the address is verified (an explicit
      // false blocks it; older Whop responses without the claim still link).
      if (!user && whopEmail && info?.email_verified !== false) {
        const byEmail = await env.NEXUS_KV.get(`user:${whopEmail}`, { type: 'json' });
        if (byEmail) { user = byEmail; emailKey = whopEmail; }
      }

      /* A member who has set a password can switch this door off. Whop sign-in
         is a bootstrap — it exists to create the account and pull the key once.
         Once they have a password, leaving it open means their 2FA guards only
         one of two entrances. Undefined means enabled: every existing account
         keeps working. Refuse before touching anything. */
      if (user && user.whopLoginEnabled === false) {
        console.log('[whop-oauth] refused, member disabled Whop sign-in:', emailKey);
        return whopFail(env, 'whopoff');
      }
      /* Oct 2026: Whop sign-in is for first-time setup ONLY. Once an account
         has a password AND its Whop key, setup is finished and this door is
         closed for good — email + password (+ 2FA) is the only way in. An
         account with a password but no key yet (email signup, key not
         attached) may still use it once to link the key. */
      if (user && whopSetupDone(user)) {
        if (user.whopLoginEnabled !== false) {
          user.whopLoginEnabled = false;
          await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
        }
        console.log('[whop-oauth] refused, setup already finished (has password):', emailKey);
        return whopFail(env, 'haspassword');
      }

      const isNew = !user;
      if (!user) {
        if (!whopEmail) return whopFail(env, 'noemail');
        emailKey = whopEmail;
        user = {
          email: emailKey,
          firstName: givenName,
          lastName: familyName,
          passwordHash: null,          // OAuth-only account until they set a password
          whopKey: null,
          tier: 'pending',
          whopStatus: 'pending',
          whopPlan: null,
          createdAt: new Date().toISOString()
        };
      }

      // If this key already belongs to someone else, do not silently steal it.
      if (membership?.licenseKey) {
        const owner = await env.NEXUS_KV.get(`key_account:${membership.licenseKey}`);
        if (owner && owner !== emailKey) return whopFail(env, 'keyinuse');
      }

      user.whopUserId = whopUserId;
      if (!user.firstName && givenName) user.firstName = givenName;

      if (membership) {
        const previousKey = user.whopKey || null;
        user.whopKey = membership.licenseKey || user.whopKey || null;
        user.tier = membership.tier;
        user.whopStatus = membership.status;
        user.whopPlan = membership.plan;
        user.whopExpiresAt = membership.expiresAt;
        user.whopRenewalEnd = membership.renewalEnd;
        user.whopCancelAtPeriodEnd = membership.cancelAtPeriodEnd;
        if (user.whopKey) {
          await env.NEXUS_KV.put(`key_account:${user.whopKey}`, emailKey);
          if (previousKey && previousKey !== user.whopKey) {
            try { await env.NEXUS_KV.delete(`key_account:${previousKey}`); } catch (e) {}
          }
        }
      } else if (!user.whopKey) {
        user.tier = 'pending';
        user.whopStatus = 'pending';
      }

      user.lastLogin = new Date().toISOString();
      // This sign-in just linked the key to an account that already has a
      // password — that was the last setup step, so close the door behind it.
      if (whopSetupDone(user)) user.whopLoginEnabled = false;
      await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
      await env.NEXUS_KV.put(`whop_user:${whopUserId}`, emailKey);

      // Keep the admin member list in step.
      try {
        const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
        const idx = memberList.findIndex(m => m.email === emailKey);
        if (idx > -1) {
          memberList[idx].whopKey = user.whopKey || null;
          memberList[idx].tier = user.tier;
        } else {
          memberList.unshift({ email: emailKey, firstName: user.firstName, lastName: user.lastName || '',
                               createdAt: user.createdAt, tier: user.tier, whopKey: user.whopKey || null });
        }
        await env.NEXUS_KV.put('admin:member_list', JSON.stringify(memberList));
      } catch (e) {
        // Not worth failing the sign-in over — but a silent catch here means a
        // member who never reaches the admin Members tab looks like a bug in
        // OAuth rather than a bad write. Leave a trace.
        console.error('[whop-oauth] member_list update failed for', emailKey, e.message);
      }

      console.log('[whop-oauth] signed in:', emailKey, isNew ? '(new)' : '(existing)',
                  'key:', user.whopKey ? 'yes' : 'none');

      /* The site keeps its session in localStorage, which a worker cannot set.
         So hand over a single-use code in the fragment — fragments are never
         sent to servers or written to proxy logs — and let the page swap it
         for the real token. 2 minutes, one use. */
      const handoff = generateToken(24);
      await env.NEXUS_KV.put(`whop_handoff:${handoff}`, emailKey, { expirationTtl: 120 });

      return Response.redirect(
        `${siteUrl(env)}/login.html#whop=${handoff}&next=${encodeURIComponent(stashed.next || 'dashboard.html')}`,
        302
      );
    }

    /* ── POST /api/auth/whop/exchange ──────────────────────────────────────
       Trades the one-time handoff code for a real session token. Same
       response shape as login, so login.html handles it identically. */
    if (path === '/api/auth/whop/exchange' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const handoff = (body?.code || '').trim();
      if (!handoff) return json({ error: 'Missing code' }, 400);

      const emailKey = await env.NEXUS_KV.get(`whop_handoff:${handoff}`);
      if (!emailKey) return json({ error: 'That sign-in link has expired. Try again.' }, 401);
      await env.NEXUS_KV.delete(`whop_handoff:${handoff}`);   // burn on first use

      const user = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });
      if (!user) return json({ error: 'Account not found.' }, 404);

      const pending = !user.whopKey;
      const token = await createSession(env, {
        email: emailKey, firstName: user.firstName || '',
        tier: pending ? 'pending' : (user.tier || 'pro'),
        plan: user.whopPlan || null,
        subscriptionActive: !pending, expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
      }, 7 * 24 * 60 * 60);

      return json({
        success: true, token, firstName: user.firstName || '',
        tier: pending ? 'pending' : (user.tier || 'pro'),
        plan: user.whopPlan || null,
        entitlements: entitlements(user.whopPlan),
        whopStatus: pending ? 'pending' : (user.whopStatus || 'active'),
        subscriptionActive: !pending,
        pending,
        needsPassword: !user.passwordHash,
      });
    }

    // ── GET /api/auth/me ──
    if (path === '/api/auth/me' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ authenticated: false }, 401);
      return json({ authenticated: true, email: session.email, firstName: session.firstName,
                    isAdmin: isAdminSession(session, env),
                    tier: session.tier, plan: session.plan || null,
                    entitlements: entitlements(session.plan),
                    subscriptionActive: session.subscriptionActive });
    }

    // ── POST /api/auth/logout ──
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = bearerToken(request);
      if (token) await destroySession(env, token);
      return json({ success: true });
    }

    // ── POST /api/auth/forgot ──
    if (path === '/api/auth/forgot' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { email } = body || {};
      if (!email) return json({ error: 'Email is required.' }, 400);

      const emailKey = String(email).trim().toLowerCase();
      const okMsg = { success: true, message: 'If an account exists for that email, a reset link has been sent.' };

      // Stop reset-email flooding: 10 requests per IP per hour, and at most
      // 3 emails per address per hour. Over the limit still answers "sent".
      if (await rateHit(env, 'forgot_ip', clientIp(request), 10, 3600)) return json(okMsg);
      if (await rateHit(env, 'forgot_email', emailKey, 3, 3600)) return json(okMsg);

      const user = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });

      // Always return success to prevent email enumeration
      if (user) {
        const resetToken = generateToken(24);
        await env.NEXUS_KV.put(`reset:${resetToken}`, emailKey, { expirationTtl: 3600 }); // 1 hour

        const resetUrl = `${env.SITE_URL}/reset.html?token=${resetToken}`;

        await sendEmail(env, {
          to: emailKey,
          subject: 'Reset your FSD-X password',
          html: `<div style="font-family:sans-serif;background:#000;color:#fff;padding:32px;max-width:480px;margin:0 auto;border-radius:12px;">
            <h1 style="color:#22c55e;font-size:24px;">FSD-X Trading</h1>
            <hr style="border-color:#27272a;margin:20px 0;"/>
            <h2 style="font-size:18px;">Reset your password</h2>
            <p style="color:#a1a1aa;line-height:1.6;">Click the button below to reset your password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#22c55e;color:#000;font-weight:900;border-radius:10px;text-decoration:none;font-size:14px;letter-spacing:0.05em;">Reset Password</a>
            <p style="color:#52525b;font-size:12px;">If you didn't request this, ignore this email. Your password won't change.</p>
            <p style="color:#52525b;font-size:11px;margin-top:24px;">FSD-X Trading · fsdxteam@gmail.com</p>
          </div>`
        });
      }

      return json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
    }

    // ── POST /api/auth/reset ──
    if (path === '/api/auth/reset' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { token, password } = body || {};
      if (!token || !password) return json({ error: 'Token and new password are required.' }, 400);
      if (typeof password !== 'string' || password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      if (password.length > 256) return json({ error: 'Password is too long.' }, 400);
      if (await rateHit(env, 'reset_ip', clientIp(request), 20, 900)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }

      const emailKey = await env.NEXUS_KV.get(`reset:${token}`);
      if (!emailKey) return json({ error: 'Reset link is invalid or has expired.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });
      if (!user) return json({ error: 'Account not found.' }, 400);

      user.passwordHash = await hashPassword(password);
      if (whopSetupDone(user)) user.whopLoginEnabled = false;   // setup finished → Whop door closed
      await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
      await env.NEXUS_KV.delete(`reset:${token}`);
      // A reset means the old password may be compromised — sign out everywhere.
      await revokeAllSessions(env, emailKey);
      await rateClear(env, 'login_email', emailKey);

      console.log('[auth] password reset success:', emailKey);
      return json({ success: true });
    }

    // ── POST /api/admin/login — admin credential check (no hardcoded hash in HTML) ──
    if (path === '/api/admin/login' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { email, password } = body || {};
      if (!email || !password) return json({ error: 'Email and password required.' }, 400);

      // Rate limit: max 5 attempts per IP per 15 min
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = `admin_login_attempts:${ip}`;
      const attempts = await env.NEXUS_KV.get(rateLimitKey, { type: 'json' }) || { count: 0, first: Date.now() };
      if (attempts.count >= 5 && (Date.now() - attempts.first) < 15 * 60 * 1000) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }

      const adminEmail = (env.ADMIN_EMAIL || 'fsdxteam@gmail.com').toLowerCase();
      if (email.toLowerCase() !== adminEmail) {
        return json({ error: 'Invalid credentials.' }, 401);
      }

      // Verify against the actual user record (same hash as regular login)
      const user = await env.NEXUS_KV.get(`user:${adminEmail}`, { type: 'json' });
      if (!user) return json({ error: 'Invalid credentials.' }, 401);

      const pw = await verifyPassword(password, user.passwordHash);
      if (!pw.ok) {
        // Track failed attempt
        await env.NEXUS_KV.put(rateLimitKey, JSON.stringify({
          count: attempts.count + 1, first: attempts.count === 0 ? Date.now() : attempts.first
        }), { expirationTtl: 900 });
        return json({ error: 'Invalid credentials.' }, 401);
      }

      // Clear rate limit on success
      await env.NEXUS_KV.delete(rateLimitKey);
      if (pw.needsUpgrade) {
        user.passwordHash = await hashPassword(password);
        try { await env.NEXUS_KV.put(`user:${adminEmail}`, JSON.stringify(user)); } catch (e) {}
      }

      // Issue a short-lived pre-auth token (valid 5 min, must complete TOTP)
      const preToken = generateToken(16);
      await env.NEXUS_KV.put(`admin_preauth:${preToken}`, adminEmail, { expirationTtl: 300 });

      console.log('[admin] login step 1 passed:', adminEmail);
      return json({ success: true, preToken });
    }

    // ── POST /api/admin/verify-totp — verify 6-digit TOTP code ──
    if (path === '/api/admin/verify-totp' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { preToken, code } = body || {};
      if (!preToken || !code) return json({ error: 'Pre-auth token and code required.' }, 400);

      const ip = clientIp(request);
      if (await rateCheck(env, 'admin_totp_ip', ip, 10)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }
      const adminEmail = await env.NEXUS_KV.get(`admin_preauth:${preToken}`);
      if (!adminEmail) return json({ error: 'Session expired. Please log in again.' }, 401);

      // TOTP secret must be set as ADMIN_TOTP_SECRET env var in Cloudflare dashboard
      // Generate one at: https://totp.danhersam.com/ or use any TOTP secret generator
      const secret = env.ADMIN_TOTP_SECRET || '';
      if (!secret) return json({ error: 'TOTP not configured on server.' }, 500);

      const isValid = await verifyTotp(secret, code);
      if (!isValid) {
        await rateHit(env, 'admin_totp_ip', ip, 10, 900);
        // 5 wrong codes burns this pre-auth token — back to the password step.
        if (await rateHit(env, 'admin_totp_pre', preToken, 4, 300)) {
          await env.NEXUS_KV.delete(`admin_preauth:${preToken}`);
          return json({ error: 'Too many wrong codes. Please log in again.' }, 401);
        }
        return json({ error: 'Invalid or expired code. Try again.' }, 401);
      }
      if (await totpAlreadyUsed(env, 'admin', code)) {
        return json({ error: 'That code was already used. Wait for the next one.' }, 401);
      }

      // TOTP passed — issue a full admin session token
      await env.NEXUS_KV.delete(`admin_preauth:${preToken}`);
      const token = await createSession(env, {
        email: adminEmail, firstName: 'Admin', tier: 'pro',
        subscriptionActive: true, isAdmin: true,
        expires: Date.now() + (8 * 60 * 60 * 1000) // 8 hour admin session
      }, 8 * 60 * 60);

      console.log('[admin] TOTP verified, session issued:', adminEmail);
      return json({ success: true, token });
    }

    // ── ADMIN: GET /api/admin/kv-lookup — search all KV keys containing a string ──
    if (path === '/api/admin/kv-lookup' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      const searchTerm = url.searchParams.get('q') || '';
      if (!searchTerm || searchTerm.length < 4) return json({ error: 'Search term must be at least 4 characters.' }, 400);

      // KV list() only supports prefix search, so we list ALL keys and filter client-side
      // We scan known prefixes that would contain a whop key
      const prefixes = ['journal:', 'journal_settings:', 'backtest_sessions:', 'backtest:', 'key_account:', 'nexus_fp:'];
      const hits = [];

      for (const prefix of prefixes) {
        try {
          let cursor = null;
          do {
            const opts = { prefix, limit: 1000 };
            if (cursor) opts.cursor = cursor;
            const result = await env.NEXUS_KV.list(opts);
            for (const key of result.keys) {
              if (key.name.includes(searchTerm)) {
                hits.push({ key: key.name, prefix });
              }
            }
            cursor = result.list_complete ? null : result.cursor;
          } while (cursor);
        } catch (err) {
          console.error('[kv-lookup] error scanning prefix', prefix, err.message);
        }
      }

      // Also check user record directly
      try {
        const keyOwner = await env.NEXUS_KV.get(`key_account:${searchTerm}`);
        if (keyOwner && !hits.find(h => h.key === `key_account:${searchTerm}`)) {
          hits.unshift({ key: `key_account:${searchTerm}`, value: keyOwner, prefix: 'key_account:' });
        }
      } catch {}

      return json({ hits, term: searchTerm, total: hits.length });
    }

    // ── ADMIN: DELETE /api/admin/kv-lookup — delete a specific KV key ──
    if (path === '/api/admin/kv-lookup' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { key } = body || {};
      if (!key) return json({ error: 'Key required.' }, 400);

      // Safety guard — never allow deleting user accounts or sessions from this tool
      if (key.startsWith('user:') || key.startsWith('session:') || key.startsWith('reset:') || key.startsWith('admin:')) {
        return json({ error: `Deleting "${key.split(':')[0]}:" keys is not allowed from this tool.` }, 403);
      }

      await env.NEXUS_KV.delete(key);
      console.log('[admin] kv-lookup deleted key:', key);
      return json({ success: true, deleted: key });
    }

    // ── ADMIN: GET /api/admin/members ──
    if (path === '/api/admin/members' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      // Enrich with live data from user record (whopKey, whopStatus, lastLogin)
      const enriched = await Promise.all(memberList.map(async (m) => {
        try {
          const user = await env.NEXUS_KV.get(`user:${m.email}`, { type: 'json' });
          if (user) return {
            ...m,
            whopKey: user.whopKey || m.whopKey || null,
            whopStatus: user.whopStatus || null,
            lastLogin: user.lastLogin || null,
            tier: user.tier || m.tier
          };
        } catch {}
        return m;
      }));
      return json({ members: enriched });
    }

    /* ── ADMIN: POST /api/admin/whop-sync ──────────────────────────────────
       Replaces the CSV export/import loop. Body: { type, since? }

         type: 'memberships' → every membership on the company, one row per
                               user, in the roster row shape.
         type: 'payments'    → payment rows in the shape handlePaymentsImport()
                               produces. Optional `since` (ISO date) limits the
                               pull; leave it off for a full backfill.

       Read-only against Whop, and read-only against our own user records —
       this does not change anyone's access. admin.html owns the merge.
       ──────────────────────────────────────────────────────────────────── */
    if (path === '/api/admin/whop-sync' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      if (!env.WHOP_API_KEY) {
        return json({ success: false, error: 'WHOP_API_KEY is not set on the worker.' }, 500);
      }

      const body = await request.json().catch(() => ({}));
      const type = body.type;
      const companyId = env.WHOP_COMPANY_ID || 'biz_2f60zABhyFQYpX';

      try {
        if (type === 'memberships') {
          const { rows, pages, capped } = await whopPaged('memberships', { company_id: companyId }, env);
          const data = normalizeWhopMemberships(rows);
          console.log('[whop-sync] memberships:', rows.length, 'raw →', data.length, 'users,', pages, 'pages');
          return json({
            success: true,
            type,
            count: data.length,
            rawCount: rows.length,
            pages,
            // If this ever comes back true the page cap was hit and the pull is
            // incomplete — surface it rather than silently syncing a partial roster.
            truncated: capped,
            syncedAt: new Date().toISOString(),
            data
          });
        }

        if (type === 'payments') {
          const params = { company_id: companyId, order: 'created_at', direction: 'desc' };
          if (body.since) params.created_after = body.since;
          const { rows, pages, capped } = await whopPaged('payments', params, env);
          const data = normalizeWhopPayments(rows);
          console.log('[whop-sync] payments:', data.length, 'rows,', pages, 'pages');
          return json({
            success: true,
            type,
            count: data.length,
            pages,
            truncated: capped,
            syncedAt: new Date().toISOString(),
            data
          });
        }

        return json({ success: false, error: `Unknown sync type: ${type}` }, 400);

      } catch (err) {
        console.error('[whop-sync]', type, err.message);
        return json({ success: false, error: err.message }, 502);
      }
    }

    // ── ADMIN: DELETE /api/admin/member ──
    if (path === '/api/admin/member' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { email } = body || {};
      if (!email) return json({ error: 'Email required.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${email}`, { type: 'json' });
      const whopKey = user?.whopKey || null;

      // Delete account + reverse lookup
      await env.NEXUS_KV.delete(`user:${email}`);
      // Deleted member is signed out everywhere, immediately.
      await revokeAllSessions(env, email);
      try { await purgeTradovate(env, email); } catch (e) {}
      if (whopKey) await env.NEXUS_KV.delete(`key_account:${whopKey}`);

      // Delete all journal/backtest data by whop key
      if (whopKey) {
        await env.NEXUS_KV.delete(`journal:${whopKey}`);
        await env.NEXUS_KV.delete(`journal_settings:${whopKey}`);
        // Delete backtest sessions + each session's trades
        const sessions = await env.NEXUS_KV.get(`backtest_sessions:${whopKey}`, { type: 'json' }) || [];
        for (const s of sessions) {
          await env.NEXUS_KV.delete(`backtest:${whopKey}:${s.id}`);
        }
        await env.NEXUS_KV.delete(`backtest_sessions:${whopKey}`);
        await env.NEXUS_KV.delete(`nexus_fp:${whopKey}`);
      }

      // Remove from member list
      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      const filtered = memberList.filter(m => m.email !== email);
      await env.NEXUS_KV.put('admin:member_list', JSON.stringify(filtered));

      console.log('[admin] member deleted:', email, 'whopKey:', maskKey(whopKey));
      return json({ success: true });
    }

    // ── ADMIN: PATCH /api/admin/member — update whop key on a member's account ──
    if (path === '/api/admin/member' && request.method === 'PATCH') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { email, newWhopKey } = body || {};
      if (!email || !newWhopKey) return json({ error: 'Email and newWhopKey required.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found.' }, 404);

      const oldKey = user.whopKey;

      // Validate the new key against Whop before saving
      const whopCheck = await validateWhopKey(newWhopKey, env);
      if (!whopCheck.valid) return json({ error: `Key not valid: ${whopCheck.reason}` }, 400);

      // Update user record
      user.whopKey = newWhopKey;
      user.tier = whopCheck.tier;
      user.whopStatus = whopCheck.status;
      await env.NEXUS_KV.put(`user:${email}`, JSON.stringify(user));

      // Update key_account reverse lookup
      if (oldKey) await env.NEXUS_KV.delete(`key_account:${oldKey}`);
      await env.NEXUS_KV.put(`key_account:${newWhopKey}`, email);

      // Update member list entry
      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      const idx = memberList.findIndex(m => m.email === email);
      if (idx !== -1) { memberList[idx].whopKey = newWhopKey; memberList[idx].tier = whopCheck.tier; }
      await env.NEXUS_KV.put('admin:member_list', JSON.stringify(memberList));

      console.log('[admin] whop key updated:', email, maskKey(oldKey), '->', maskKey(newWhopKey));
      return json({ success: true, tier: whopCheck.tier });
    }

    // ── ADMIN: POST /api/admin/recap ──
    if (path === '/api/admin/recap' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { id, date, title, summary, grade, result, notes, tags, chartUrl, setups } = body || {};
      if (!date || !title || !summary) return json({ error: 'Date, title, and summary are required.' }, 400);

      const recaps = await env.NEXUS_KV.get('recaps:all', { type: 'json' }) || [];

      if (id) {
        // UPDATE existing recap
        const idx = recaps.findIndex(r => r.id === id);
        if (idx >= 0) {
          recaps[idx] = { ...recaps[idx], date, title, summary, grade: grade || '', result: result || '', notes: notes || '', tags: tags || [], chartUrl: chartUrl || '', setups: setups || [], updatedAt: new Date().toISOString() };
        }
        await env.NEXUS_KV.put('recaps:all', JSON.stringify(recaps));
        return json({ success: true, recap: recaps[idx] });
      } else {
        // CREATE new recap
        const recap = {
          id: Date.now().toString(),
          date, title, summary, grade: grade || '', result: result || '',
          notes: notes || '', tags: tags || [], chartUrl: chartUrl || '', setups: setups || [],
          createdAt: new Date().toISOString()
        };
        recaps.unshift(recap);
        await env.NEXUS_KV.put('recaps:all', JSON.stringify(recaps));
        console.log('[admin] recap saved:', recap.id);
        return json({ success: true, recap });
      }
    }

    // ── ADMIN: DELETE /api/admin/recap ──
    if (path === '/api/admin/recap' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { id } = body || {};
      if (!id) return json({ error: 'Recap ID required.' }, 400);

      const recaps = await env.NEXUS_KV.get('recaps:all', { type: 'json' }) || [];
      const filtered = recaps.filter(r => r.id !== id);
      await env.NEXUS_KV.put('recaps:all', JSON.stringify(filtered));
      return json({ success: true });
    }

    // ── MEMBER: GET /api/calendar ──
    if (path === '/api/calendar' && request.method === 'GET') {
      try {
        // Serve from KV cache if fresh (< 30 min old)
        const cached = await env.NEXUS_KV.get('cache:ff_calendar', { type: 'json' });
        if (cached && cached.xml && (Date.now() - cached.ts) < 30 * 60 * 1000) {
          return new Response(cached.xml, { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } });
        }
        // Fetch fresh
        const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.xml', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const xml = await res.text();
        await env.NEXUS_KV.put('cache:ff_calendar', JSON.stringify({ xml, ts: Date.now() }), { expirationTtl: 3600 });
        return new Response(xml, { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } });
      } catch(err) {
        try {
          const stale = await env.NEXUS_KV.get('cache:ff_calendar', { type: 'json' });
          if (stale && stale.xml) return new Response(stale.xml, { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } });
        } catch(e) {}
        return json({ error: 'Could not fetch calendar' }, 500);
      }
    }

    // ── MEMBER: GET /api/recaps ──
    if (path === '/api/recaps' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      const recaps = await env.NEXUS_KV.get('recaps:all', { type: 'json' }) || [];
      return json({ recaps });
    }

    // /api/track and /api/admin/visits moved to nexus-traffic.js (Oct 2026).

    // ── ADMIN: POST /api/admin/announcement ──
    if (path === '/api/admin/announcement' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { message, type } = body || {};
      if (!message) return json({ error: 'Message is required.' }, 400);

      const announcement = { id: Date.now().toString(), message, type: type || 'info', createdAt: new Date().toISOString() };
      await env.NEXUS_KV.put('admin:announcement', JSON.stringify(announcement));
      return json({ success: true, announcement });
    }

    // ── ADMIN: DELETE /api/admin/announcement ──
    if (path === '/api/admin/announcement' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      await env.NEXUS_KV.delete('admin:announcement');
      return json({ success: true });
    }

    // ── MEMBER: GET /api/announcement ──
    if (path === '/api/announcement' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      const announcement = await env.NEXUS_KV.get('admin:announcement', { type: 'json' });
      return json({ announcement });
    }

    // ── Sales ──
    // Several sales can run at once, each tagged with the products it covers
    // (membership, ntsolo, raven, nightwing). Stored as one list in
    // admin:sales. The old single admin:sale is read once and migrated, and
    // GET /api/sale still returns `sale` (the membership one, or null)
    // so pages that only know the old shape keep working.
    const SALE_PRODUCTS = ['membership', 'ntsolo', 'raven', 'nightwing'];
    async function loadSales() {
      let list = await env.NEXUS_KV.get('admin:sales', { type: 'json' });
      if (!Array.isArray(list)) {
        const legacy = await env.NEXUS_KV.get('admin:sale', { type: 'json' });
        list = legacy ? [{ ...legacy, products: legacy.products || ['membership'] }] : [];
        await env.NEXUS_KV.put('admin:sales', JSON.stringify(list));
        if (legacy) await env.NEXUS_KV.delete('admin:sale');
      }
      const now = Date.now();
      const live = list.filter(s => !s.expiresAt || new Date(s.expiresAt).getTime() > now);
      if (live.length !== list.length) await env.NEXUS_KV.put('admin:sales', JSON.stringify(live));
      return live;
    }

    // ── PUBLIC: GET /api/sale ──
    if (path === '/api/sale' && request.method === 'GET') {
      const sales = await loadSales();
      const primary = sales.find(s => (s.products || []).includes('membership')) || null;
      // featured = the one sale admin picked for the site-wide banner (or null).
      const featured = sales.find(s => s.featured) || null;
      return json({ sale: primary, sales, featured });
    }

    // ── ADMIN: POST /api/admin/sale ── create, or update when `id` matches
    if (path === '/api/admin/sale' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { id, label, code, discount, applies, expiresAt } = body || {};
      if (!label || !code || !discount) return json({ error: 'label, code, and discount are required.' }, 400);
      const products = (Array.isArray(body.products) ? body.products : ['membership']).filter(p => SALE_PRODUCTS.includes(p));
      if (!products.length) return json({ error: 'Pick at least one product for the sale.' }, 400);
      const sales = await loadSales();
      const prev = id ? sales.find(s => s.id === id) : null;
      const sale = {
        id: prev ? prev.id : Date.now().toString(),
        label,        // e.g. "Launch Sale"
        code,         // e.g. "NT8LAUNCH" — the Whop coupon, restricted to these products in Whop
        discount,     // e.g. "20% OFF"
        applies,      // e.g. "Monthly plan only."
        products,     // which products' pages and nav links show it
        featured: body.featured === true,   // the one sale on the site-wide banner + homepage
        expiresAt: expiresAt || null,
        createdAt: prev ? prev.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let next = prev ? sales.map(s => s.id === prev.id ? sale : s) : [sale, ...sales];
      // Only one featured sale at a time: featuring this one un-features the rest.
      if (sale.featured) next = next.map(s => s.id === sale.id ? s : { ...s, featured: false });
      await env.NEXUS_KV.put('admin:sales', JSON.stringify(next));
      return json({ success: true, sale, sales: next });
    }

    // ── ADMIN: DELETE /api/admin/sale?id= ── end one sale (no id = end all)
    if (path === '/api/admin/sale' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      const id = url.searchParams.get('id');
      const sales = await loadSales();
      const next = id ? sales.filter(s => s.id !== id) : [];
      await env.NEXUS_KV.put('admin:sales', JSON.stringify(next));
      return json({ success: true, sales: next });
    }

    // ── Ticker ──
    // One rotating bar at the top of every page. Items come from three places:
    //   sales      — every live sale in admin:sales (id "sale:<id>")
    //   lifetime   — the lifetime spots counter (id "lifetime")
    //   release    — a slot the page fills from releases.json (id "release")
    //   manual     — partner / update / announcement items added in admin
    // admin:ticker holds the order, which items are switched off, the featured
    // item and three settings. Everyone sees the same ticker, logged in or not.
    const TICKER_DEFAULTS = { speed: 5, autoRelease: true, inlineSales: false, featured: null, order: [], off: [], items: [] };
    const LIFETIME_ENDS = '2026-11-01T04:59:59Z';   // Oct 31 11:59:59 PM CT — same as lifetime.js
    const SALE_PAGE = { membership: ['memberships.html', 'See membership'], ntsolo: ['ninjatrader.html#pricing', 'See Knightfall NT8'],
                        raven: ['raven.html#plans', 'See Raven'], nightwing: ['nightwing.html#plans', 'See Nightwing'] };
    async function loadTicker() {
      const t = await env.NEXUS_KV.get('admin:ticker', { type: 'json' });
      return { ...TICKER_DEFAULTS, ...(t || {}) };
    }
    async function tickerAll(cfg) {
      const now = Date.now();
      const sales = await loadSales();
      const out = [];
      for (const s of sales) {
        const p = (s.products || ['membership'])[0];
        const pg = SALE_PAGE[p] || SALE_PAGE.membership;
        out.push({ id: 'sale:' + s.id, kind: 'sale', source: 'Sales', tag: 'SALE',
          // Short on purpose: label, plus the discount only if the label doesn't already say it.
          text: String(s.label || '').toLowerCase().includes(String(s.discount || '').toLowerCase()) ? s.label : s.label + ' — ' + s.discount,
          detail: s.applies || '',
          code: s.code, link: pg[0], linkText: pg[1], endsAt: s.expiresAt || null, featuredSale: !!s.featured });
      }
      const lt = await env.NEXUS_KV.get('admin:lifetime_spots', { type: 'json' });
      if (lt && lt.active !== false && Number(lt.total) > 0 && Number(lt.remaining) > 0 && now < Date.parse(LIFETIME_ENDS)) {
        out.push({ id: 'lifetime', kind: 'lifetime', source: 'Lifetime Spots', tag: 'LIFETIME',
          text: `Lifetime access, $399 one time · ${lt.remaining} of ${lt.total} spots left`,
          code: '', link: 'memberships.html#lifetime', linkText: 'See the offer', endsAt: LIFETIME_ENDS });
      }
      if (cfg.autoRelease) out.push({ id: 'release', kind: 'release', source: 'Releases', tag: 'UPDATE', text: '(newest release note)', code: '', link: 'releases.html', linkText: 'Release notes', endsAt: null });
      for (const m of (cfg.items || [])) {
        if (m.startsAt && Date.parse(m.startsAt) > now) { out.push({ ...m, kind: m.type, source: 'Manual', scheduled: true }); continue; }
        if (m.endsAt && Date.parse(m.endsAt) < now) continue;
        out.push({ ...m, kind: m.type, source: 'Manual' });
      }
      // Order: saved order first, then anything new in its natural order.
      const pos = id => { const i = (cfg.order || []).indexOf(id); return i === -1 ? 1e6 : i; };
      out.forEach((x, i) => { x._n = i; });
      out.sort((a, b) => pos(a.id) - pos(b.id) || a._n - b._n);
      const featured = cfg.featured || (out.find(x => x.featuredSale) || {}).id || null;
      return out.map(({ _n, ...x }) => ({ ...x, on: !(cfg.off || []).includes(x.id) && !x.scheduled, featured: x.id === featured }));
    }

    // ── PUBLIC: GET /api/ticker ──
    if (path === '/api/ticker' && request.method === 'GET') {
      const cfg = await loadTicker();
      let items = (await tickerAll(cfg)).filter(x => x.on);
      const f = items.findIndex(x => x.featured);
      if (f > 0) items = [items[f], ...items.slice(0, f), ...items.slice(f + 1)];
      const sales = await loadSales();
      return json({ settings: { speed: cfg.speed, autoRelease: cfg.autoRelease, inlineSales: cfg.inlineSales },
        items: items.map(({ on, source, scheduled, featuredSale, ...x }) => x), sales });
    }

    // ── ADMIN: GET /api/admin/ticker ── everything, including items switched off
    if (path === '/api/admin/ticker' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Unauthorized' }, 403);
      const cfg = await loadTicker();
      return json({ config: cfg, items: await tickerAll(cfg) });
    }

    // ── ADMIN: POST /api/admin/ticker ── save settings, order, off, featured, manual items
    if (path === '/api/admin/ticker' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Unauthorized' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const cur = await loadTicker();
      const clean = v => String(v == null ? '' : v).trim().slice(0, 240);
      const next = { ...cur };
      if ([3, 4, 5, 6, 7, 8, 10, 12].includes(+body.speed)) next.speed = +body.speed;
      if (typeof body.autoRelease === 'boolean') next.autoRelease = body.autoRelease;
      if (typeof body.inlineSales === 'boolean') next.inlineSales = body.inlineSales;
      if ('featured' in body) next.featured = body.featured ? clean(body.featured) : null;
      if (Array.isArray(body.order)) next.order = body.order.map(clean).filter(Boolean).slice(0, 100);
      if (Array.isArray(body.off)) next.off = body.off.map(clean).filter(Boolean).slice(0, 100);
      if (Array.isArray(body.items)) {
        const TYPES = ['partner', 'update', 'announcement'];
        next.items = body.items.slice(0, 40).map(m => {
          const type = TYPES.includes(m.type) ? m.type : 'announcement';
          const text = clean(m.text);
          if (!text) return null;
          let link = clean(m.link);
          if (link && !/^(https:\/\/|[a-z0-9-]+\.html)/i.test(link)) link = '';
          return { id: /^m:[a-z0-9]{4,20}$/.test(m.id || '') ? m.id : 'm:' + Math.random().toString(36).slice(2, 10),
            type, tag: type === 'partner' ? 'PARTNER' : type === 'update' ? 'UPDATE' : 'NEWS', text,
            code: clean(m.code).toUpperCase().slice(0, 30), link, linkText: clean(m.linkText) || (type === 'partner' ? 'See details' : 'Read more'),
            affiliate: type === 'partner',
            startsAt: m.startsAt ? new Date(m.startsAt).toISOString() : null,
            endsAt: m.endsAt ? new Date(m.endsAt).toISOString() : null };
        }).filter(Boolean);
      }
      await env.NEXUS_KV.put('admin:ticker', JSON.stringify(next));
      return json({ success: true, config: next, items: await tickerAll(next) });
    }

    // ── PUBLIC: GET /api/founder-spots ──
    // Returns the Auto-Trader founder-spot counter the autotrader page reads.
    // null  -> never set up / turned off  -> page behaves as a plain waitlist.
    if (path === '/api/founder-spots' && request.method === 'GET') {
      const fs = await env.NEXUS_KV.get('admin:founder_spots', { type: 'json' });
      return json({ founderSpots: fs || null });
    }

    // ── ADMIN: POST /api/admin/founder-spots ──
    // Body: { total, remaining, active }. Admin sets these by hand in the panel.
    if (path === '/api/admin/founder-spots' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { total, remaining, active } = body || {};
      const t = Number.isFinite(+total)     ? Math.max(0, Math.floor(+total))     : 0;
      let   r = Number.isFinite(+remaining) ? Math.max(0, Math.floor(+remaining)) : 0;
      if (r > t) r = t;  // remaining can never exceed total
      const fs = {
        total: t,
        remaining: r,
        active: active !== false,   // defaults to true unless explicitly turned off
        updatedAt: new Date().toISOString()
      };
      await env.NEXUS_KV.put('admin:founder_spots', JSON.stringify(fs));
      return json({ success: true, founderSpots: fs });
    }

    // ── ADMIN: DELETE /api/admin/founder-spots ── (remove the counter entirely)
    if (path === '/api/admin/founder-spots' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      await env.NEXUS_KV.delete('admin:founder_spots');
      return json({ success: true });
    }

    // ── PUBLIC: GET /api/lifetime-spots ──
    // Lifetime offer counter read by lifetime.js (homepage + Memberships).
    // null -> never set up -> the lifetime blocks stay hidden.
    if (path === '/api/lifetime-spots' && request.method === 'GET') {
      const lt = await env.NEXUS_KV.get('admin:lifetime_spots', { type: 'json' });
      return json({ lifetimeSpots: lt || null });
    }

    // ── ADMIN: POST /api/admin/lifetime-spots ──
    // Body: { total, remaining, active }. Display only; Whop plan stock is the hard stop.
    if (path === '/api/admin/lifetime-spots' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { total, remaining, active } = body || {};
      const t = Number.isFinite(+total)     ? Math.max(0, Math.floor(+total))     : 0;
      let   r = Number.isFinite(+remaining) ? Math.max(0, Math.floor(+remaining)) : 0;
      if (r > t) r = t;
      const lt = { total: t, remaining: r, active: active !== false, updatedAt: new Date().toISOString() };
      await env.NEXUS_KV.put('admin:lifetime_spots', JSON.stringify(lt));
      return json({ success: true, lifetimeSpots: lt });
    }

    // ── ADMIN: DELETE /api/admin/lifetime-spots ──
    if (path === '/api/admin/lifetime-spots' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      await env.NEXUS_KV.delete('admin:lifetime_spots');
      return json({ success: true });
    }

    // ── PUBLIC: GET /api/member-cap ──
    // Returns the Pro membership cap counter the homepage reads.
    // null  -> never set up / turned off  -> the page says nothing about capacity.
    if (path === '/api/member-cap' && request.method === 'GET') {
      const mc = await env.NEXUS_KV.get('admin:member_cap', { type: 'json' });
      return json({ memberCap: mc || null });
    }

    // ── ADMIN: POST /api/admin/member-cap ──
    // Body: { total, remaining, active }. Set by hand in the panel — deliberately
    // not derived from the Whop roster sync, which only runs while admin is open.
    if (path === '/api/admin/member-cap' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { total, remaining, active } = body || {};
      const t = Number.isFinite(+total)     ? Math.max(0, Math.floor(+total))     : 0;
      let   r = Number.isFinite(+remaining) ? Math.max(0, Math.floor(+remaining)) : 0;
      if (r > t) r = t;  // remaining can never exceed total
      const mc = {
        total: t,
        remaining: r,
        active: active !== false,   // defaults to true unless explicitly turned off
        updatedAt: new Date().toISOString()
      };
      await env.NEXUS_KV.put('admin:member_cap', JSON.stringify(mc));
      return json({ success: true, memberCap: mc });
    }

    // ── ADMIN: DELETE /api/admin/member-cap ── (remove the counter entirely)
    if (path === '/api/admin/member-cap' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) {
        return json({ error: 'Unauthorized' }, 403);
      }
      await env.NEXUS_KV.delete('admin:member_cap');
      return json({ success: true });
    }

    // ── ADMIN: POST /api/admin/update ──
    if (path === '/api/admin/update' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Forbidden' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { id, type, title, body: bodyText, visibility } = body || {};
      if (!title) return json({ error: 'Title is required' }, 400);
      const vis = ['all', 'annual', 'lifetime'].includes(visibility) ? visibility : 'all';
      const updates = await env.NEXUS_KV.get('admin:updates', { type: 'json' }) || [];
      if (id) {
        const idx = updates.findIndex(u => u.id === id);
        if (idx !== -1) {
          updates[idx] = { ...updates[idx], type: type || 'update', title, body: bodyText || '', visibility: vis, updatedAt: new Date().toISOString() };
          await env.NEXUS_KV.put('admin:updates', JSON.stringify(updates));
          return json({ success: true, update: updates[idx] });
        }
        return json({ error: 'Update not found' }, 404);
      }
      const update = { id: Date.now().toString(), type: type || 'update', title, body: bodyText || '', visibility: vis, createdAt: new Date().toISOString() };
      updates.unshift(update);
      await env.NEXUS_KV.put('admin:updates', JSON.stringify(updates));
      return json({ success: true, update });
    }

    // ── ADMIN: DELETE /api/admin/update ──
    if (path === '/api/admin/update' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Forbidden' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { id } = body || {};
      if (!id) return json({ error: 'id required' }, 400);
      const updates = await env.NEXUS_KV.get('admin:updates', { type: 'json' }) || [];
      await env.NEXUS_KV.put('admin:updates', JSON.stringify(updates.filter(u => u.id !== id)));
      return json({ success: true });
    }

    // ── MEMBER: GET /api/updates ──
    if (path === '/api/updates' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);

      const updates = await env.NEXUS_KV.get('admin:updates', { type: 'json' }) || [];

      // Determine user plan to filter visibility
      // Check roster for plan name (most reliable), fall back to user record
      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      let isAnnualOrAbove = false, isLifetime = false;

      if (user) {
        // Check roster for plan name
        try {
          const rosterKeys = await env.NEXUS_KV.list({ prefix: 'journal:roster_data:' });
          for (const k of (rosterKeys.keys || []).slice(0, 5)) {
            const rosterRaw = await env.NEXUS_KV.get(k.name, { type: 'json' });
            const match = (rosterRaw?.trades || []).find(m =>
              (m.email && user.email && m.email.toLowerCase() === user.email.toLowerCase()) ||
              (m.whopKey && user.whopKey && m.whopKey === user.whopKey)
            );
            if (match) {
              const plan = (match.planName || match.accessType || '').toLowerCase();
              isLifetime = plan.includes('lifetime');
              isAnnualOrAbove = isLifetime || plan.includes('annual');
              break;
            }
          }
        } catch(e) { /* roster lookup failed */ }

        // Fallback: master keys are lifetime members
        if (!isLifetime && user.whopKey) {
          const masterKeys = (env.MASTER_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
          if (masterKeys.includes(user.whopKey)) { isLifetime = true; isAnnualOrAbove = true; }
        }
      }

      // Filter based on visibility
      const filtered = updates.filter(u => {
        const vis = u.visibility || 'all';
        if (vis === 'all') return true;
        if (vis === 'annual') return isAnnualOrAbove;
        if (vis === 'lifetime') return isLifetime;
        return true;
      });

      return json({ updates: filtered });
    }

    // ── ADMIN: POST /api/admin/schedule — create or update a schedule event ──
    if (path === '/api/admin/schedule' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Forbidden' }, 403);
      const { id, title, subtitle, time, timezone, description, bullets, type, link, linkLabel, status } = await request.json();
      const events = await env.NEXUS_KV.get('admin:schedule', { type: 'json' }) || [];
      if (id) {
        const idx = events.findIndex(e => e.id === id);
        if (idx !== -1) {
          events[idx] = { ...events[idx], title, subtitle: subtitle || '', time: time || '', timezone: timezone || 'CT', description: description || '', bullets: bullets || [], type: type || 'regular', link: link || '', linkLabel: linkLabel || '', status: status || 'active', updatedAt: new Date().toISOString() };
          await env.NEXUS_KV.put('admin:schedule', JSON.stringify(events));
          return json({ success: true, event: events[idx] });
        }
        return json({ error: 'Event not found' }, 404);
      }
      const event = { id: Date.now().toString(), title, subtitle: subtitle || '', time: time || '', timezone: timezone || 'CT', description: description || '', bullets: bullets || [], type: type || 'regular', link: link || '', linkLabel: linkLabel || '', status: status || 'active', createdAt: new Date().toISOString() };
      events.push(event);
      await env.NEXUS_KV.put('admin:schedule', JSON.stringify(events));
      return json({ success: true, event });
    }

    // ── ADMIN: DELETE /api/admin/schedule ──
    if (path === '/api/admin/schedule' && request.method === 'DELETE') {
      const session = await getSessionFromRequest(request, env);
      if (!isAdminSession(session, env)) return json({ error: 'Forbidden' }, 403);
      const { id } = await request.json();
      if (!id) return json({ error: 'ID required' }, 400);
      const events = await env.NEXUS_KV.get('admin:schedule', { type: 'json' }) || [];
      await env.NEXUS_KV.put('admin:schedule', JSON.stringify(events.filter(e => e.id !== id)));
      return json({ success: true });
    }

    // ── PUBLIC: GET /api/schedule ──
    if (path === '/api/schedule' && request.method === 'GET') {
      const events = await env.NEXUS_KV.get('admin:schedule', { type: 'json' }) || [];
      return json({ events: events.filter(e => e.status !== 'hidden') });
    }

    // ── GET /api/auth/profile ──
    if (path === '/api/auth/profile' && request.method === 'GET') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      // Try to enrich with roster data (more up to date than KV timestamps)
      // Roster is stored under admin owner key — try to find matching member
      let rosterRenewal = null, rosterStatus = null, rosterPlanName = null;
      try {
        // Look up roster by whop key prefix pattern
        const rosterKeys = await env.NEXUS_KV.list({ prefix: 'journal:roster_data:' });
        for (const k of (rosterKeys.keys || []).slice(0, 5)) {
          const rosterRaw = await env.NEXUS_KV.get(k.name, { type: 'json' });
          const members = rosterRaw?.trades || [];
          const match = members.find(m =>
            (m.email && user.email && m.email.toLowerCase() === user.email.toLowerCase()) ||
            (m.whopKey && user.whopKey && m.whopKey === user.whopKey)
          );
          if (match) {
            rosterRenewal = match.renewal || null;
            rosterStatus = match.status || null;
            rosterPlanName = match.planName || match.accessType || null;
            break;
          }
        }
      } catch(e) { /* roster lookup failed, use KV data */ }

      /* Which plan: the stored whopPlan first, else infer from the roster's
         plan name. Nightwing is checked before Pro, and the test covers the
         old "Site Access" wording too — the product carried the word VIP in
         its name at one point, and without this a name like that would read as
         a full membership and hand them Scout. */
      const inferPlan = (name) => {
        /* Raven first. Its product name has no "pro" in it today, but the test
           below is a loose word match and the ordering costs nothing. */
        if (/\braven\b/i.test(name)) return 'raven';
        // Knightfall NT8 standalone. Needs both words: the full membership's
        // name may mention NinjaTrader, and Nexus Standalone has no "ninja".
        if (/ninja/i.test(name) && /standalone/i.test(name)) return 'ntsolo';
        if (/nightwing|site\s*access/i.test(name)) return 'site';
        if (/\bpro\b/i.test(name)) return 'pro';
        return 'plus';
      };
      const memberPlan = user.whopPlan
        || (rosterPlanName ? inferPlan(rosterPlanName) : null);

      return json({ user: {
        email: user.email, firstName: user.firstName, lastName: user.lastName,
        tier: user.tier, plan: memberPlan, entitlements: entitlements(memberPlan),
        whopKey: user.whopKey, createdAt: user.createdAt, lastLogin: user.lastLogin,
        whopStatus: user.whopStatus || null,
        whopExpiresAt: user.whopExpiresAt || null,
        whopRenewalEnd: user.whopRenewalEnd || null,
        whopCancelAtPeriodEnd: user.whopCancelAtPeriodEnd || false,
        twoFactorEnabled: user.twoFactorEnabled || false,
        // Accounts created through Sign in with Whop have no password yet.
        // The profile page needs this to say "Set a password" instead of
        // asking for a current one that has never existed.
        hasPassword: !!user.passwordHash,
        // Open only while setup is unfinished (no password, or no key yet).
        whopLoginEnabled: whopSignInOpen(user),
        onboardingDismissed: !!user.onboardingDismissed,
        // Roster enrichment — more reliable than KV timestamps
        rosterRenewal,
        rosterStatus,
        rosterPlanName,
      }});
    }

    // ── POST /api/auth/profile ──
    if (path === '/api/auth/profile' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const firstName = cleanName(body?.firstName);
      const lastName  = cleanName(body?.lastName);
      const email = body?.email;
      if (!firstName || !email) return json({ error: 'First name and email are required.' }, 400);
      const newEmail = cleanEmail(email);
      if (!newEmail) return json({ error: 'Invalid email address.' }, 400);

      const oldEmail = session.email;

      const user = await env.NEXUS_KV.get(`user:${oldEmail}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      // If email changed — don't apply directly, send a confirmation code instead
      if (newEmail !== oldEmail) {
        const existing = await env.NEXUS_KV.get(`user:${newEmail}`, { type: 'json' });
        if (existing) return json({ error: 'That email is already in use.' }, 400);

        // Save name changes immediately (email change is pending confirmation)
        user.firstName = firstName;
        user.lastName = lastName || '';
        await env.NEXUS_KV.put(`user:${oldEmail}`, JSON.stringify(user));

        // Generate and send confirmation code to the CURRENT (old) email — confirms the account owner authorized this
        if (await rateHit(env, 'email_change_req', oldEmail, 5, 3600)) {
          return json({ error: 'Too many email change requests. Try again in an hour.' }, 429);
        }
        const code = randomCode6();
        await env.NEXUS_KV.put(`email_change:${oldEmail}`, JSON.stringify({ newEmail, code, firstName, lastName: lastName||'' }), { expirationTtl: 600 });

        const sent = await sendEmail(env, {
          to: oldEmail,
          subject: 'Confirm your FSD-X email change',
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#fff;border-radius:12px">
            <div style="font-size:22px;font-weight:900;color:#22c55e;margin-bottom:8px">FSD-X Trading</div>
            <h2 style="font-size:18px;font-weight:800;margin:0 0 12px">Confirm your email change</h2>
            <p style="color:#a1a1aa;font-size:14px;margin:0 0 24px">Someone requested changing your FSD-X email to <strong style="color:#fff">${escapeHtml(newEmail)}</strong>. Enter this code to confirm. It expires in 10 minutes.</p>
            <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#22c55e;text-align:center;padding:20px;background:#18181b;border-radius:8px;margin-bottom:24px">${code}</div>
            <p style="color:#ef4444;font-size:12px;font-weight:700">If you didn't request this, your account may be compromised. Change your password immediately.</p>
          </div>`
        });

        // Don't show the "enter your code" screen when no code went out.
        if (!sent.success) {
          await env.NEXUS_KV.delete(`email_change:${oldEmail}`);
          return json({ error: 'We could not send the confirmation email right now. Your name was saved; try the email change again later or contact support.' }, 502);
        }
        return json({ success: true, emailChangeRequested: true });
      }

      // No email change — update name only
      user.firstName = firstName;
      user.lastName = lastName || '';
      await env.NEXUS_KV.put(`user:${oldEmail}`, JSON.stringify(user));

      console.log('[auth] profile updated:', newEmail);
      return json({ success: true });
    }

    // ── POST /api/auth/change-password ──
    // ── POST /api/auth/attach-key ──
    // Adds a Whop key to an existing (pending) account, or replaces one that has
    // gone stale. Same validation path as signup, so master keys work here too.
    if (path === '/api/auth/attach-key' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const key = String(body?.key || '').trim();
      if (!key) return json({ error: 'Whop key is required.' }, 400);
      if (key.length > 128 || !/^[A-Za-z0-9_\-]+$/.test(key)) return json({ error: 'That does not look like a Whop key.' }, 400);

      const emailKey = session.email;
      // 10 key checks per account per hour — stops using this as a key-guessing oracle.
      if (await rateHit(env, 'attach_key', emailKey, 10, 3600)) {
        return json({ error: 'Too many key attempts. Try again in an hour.' }, 429);
      }
      const user = await env.NEXUS_KV.get(`user:${emailKey}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      // Already keyed with this exact key — nothing to do, report success so the
      // UI just unlocks rather than showing a confusing error.
      if (user.whopKey === key) {
        return json({ success: true, tier: user.tier, plan: user.whopPlan || null,
                      whopStatus: user.whopStatus || 'active', unchanged: true });
      }

      // One key, one account.
      const existingKeyOwner = await env.NEXUS_KV.get(`key_account:${key}`);
      if (existingKeyOwner && existingKeyOwner !== emailKey) {
        return json({ error: 'This Whop key is already linked to another account. Contact support.' }, 400);
      }

      const whopCheck = await validateWhopKey(key, env);
      if (!whopCheck.valid) return json({ error: `Key not valid: ${whopCheck.reason}` }, 400);

      const previousKey = user.whopKey || null;

      user.whopKey = key;
      user.tier = whopCheck.tier;
      user.whopStatus = whopCheck.status;
      user.whopPlan = whopCheck.plan || user.whopPlan || null;
      user.whopExpiresAt = whopCheck.expiresAt || null;
      user.whopRenewalEnd = whopCheck.renewalEnd || null;
      user.whopCancelAtPeriodEnd = whopCheck.cancelAtPeriodEnd || false;
      user.keyAttachedAt = new Date().toISOString();
      if (whopSetupDone(user)) user.whopLoginEnabled = false;   // password + key → setup finished

      await env.NEXUS_KV.put(`user:${emailKey}`, JSON.stringify(user));
      await env.NEXUS_KV.put(`key_account:${key}`, emailKey);
      // Release the old mapping so a replaced key can be reused on another account.
      if (previousKey && previousKey !== key) {
        try { await env.NEXUS_KV.delete(`key_account:${previousKey}`); } catch (e) {}
      }

      // Keep the admin member list in step.
      try {
        const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
        const idx = memberList.findIndex(m => m.email === emailKey);
        if (idx > -1) {
          memberList[idx].whopKey = key;
          memberList[idx].tier = user.tier;
          await env.NEXUS_KV.put('admin:member_list', JSON.stringify(memberList));
        }
      } catch (e) { /* member list is a convenience, never block on it */ }

      // Refresh the session so tier/subscriptionActive reflect the new state.
      try {
        const tok = bearerToken(request);
        if (tok) await updateSession(env, tok, {
          tier: user.tier, plan: user.whopPlan || null, subscriptionActive: true,
        });
      } catch (e) { /* non-fatal */ }

      console.log('[auth] key attached:', emailKey, maskKey(key));
      return json({ success: true, tier: user.tier, plan: user.whopPlan || null,
                    entitlements: entitlements(user.whopPlan),
                    whopStatus: user.whopStatus || 'active' });
    }

    if (path === '/api/auth/change-password' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { currentPassword, newPassword } = body || {};
      if (!newPassword) return json({ error: 'A new password is required.' }, 400);
      if (typeof newPassword !== 'string' || newPassword.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      if (newPassword.length > 256) return json({ error: 'Password is too long.' }, 400);
      if (await rateCheck(env, 'pw_change', session.email, 5)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      /* An account created through Sign in with Whop has passwordHash: null.
         Demanding the "current" password locked those members out of ever
         setting one — hashPassword() can never equal null, so every attempt
         returned "Current password is incorrect" forever.

         Setting a first password needs no prior secret: the session token
         already proves who they are, and that is the same proof the reset-email
         flow accepts. Changing an EXISTING password still requires the old one,
         so a hijacked session cannot silently lock the real owner out. */
      const hasPassword = !!user.passwordHash;
      if (hasPassword) {
        if (!currentPassword) return json({ error: 'Current password is required.' }, 400);
        const cur = await verifyPassword(currentPassword, user.passwordHash);
        if (!cur.ok) {
          await rateHit(env, 'pw_change', session.email, 5, 900);
          return json({ error: 'Current password is incorrect.' }, 401);
        }
      }

      user.passwordHash = await hashPassword(newPassword);
      // Password + key = setup finished → Sign in with Whop closes automatically.
      const closedWhop = whopSetupDone(user) && user.whopLoginEnabled !== false;
      if (whopSetupDone(user)) user.whopLoginEnabled = false;
      await env.NEXUS_KV.put(`user:${session.email}`, JSON.stringify(user));

      // Sign out every other device, keep this one: revoke, then mint a fresh
      // session for the caller. The page swaps to newToken if it's returned.
      await revokeAllSessions(env, session.email);
      const { iat, expires, ...carry } = session;
      const newToken = await createSession(env, carry, 7 * 24 * 60 * 60);

      console.log('[auth]', hasPassword ? 'password changed:' : 'first password set:', session.email);
      return json({ success: true, wasFirstPassword: !hasPassword, newToken,
                    whopLoginEnabled: whopSignInOpen(user), whopClosedNow: closedWhop,
                    twoFactorEnabled: !!user.twoFactorEnabled });
    }


    /* ── POST /api/auth/onboarding — remember the first-run checklist ────────
       Dismissal lives on the account, not in localStorage, so the modal does
       not come back the first time the member opens the site on their phone.
       ────────────────────────────────────────────────────────────────────── */
    if (path === '/api/auth/onboarding' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      if (body.dismissed === true) user.onboardingDismissed = true;

      await env.NEXUS_KV.put(`user:${session.email}`, JSON.stringify(user));
      return json({ success: true, onboardingDismissed: !!user.onboardingDismissed });
    }

    /* ── POST /api/auth/whop-login — turn Sign in with Whop on or off ────────
       Whop sign-in bootstraps the account: it pulls their identity and license
       key so they never handle a key by hand. Once a password exists that job
       is done, and a member may reasonably want the second entrance closed —
       otherwise 2FA guards the email door while Whop's door stays open.

       Disabling requires a password, checked server-side. Without one, turning
       this off would lock them out of their own account permanently.
       Membership status is unaffected: password login re-validates the key with
       Whop on every sign-in, so nothing goes stale.
       ────────────────────────────────────────────────────────────────────── */
    if (path === '/api/auth/whop-login' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const enabled = body?.enabled === true;

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);

      if (!enabled && !user.passwordHash) {
        return json({ error: 'Set a password first — otherwise turning this off would lock you out of your account.' }, 400);
      }
      if (enabled && whopSetupDone(user)) {
        return json({ error: 'Sign in with Whop is only for first-time setup. Your account has a password, so use your email and password.' }, 400);
      }

      user.whopLoginEnabled = enabled;
      await env.NEXUS_KV.put(`user:${session.email}`, JSON.stringify(user));

      console.log('[auth] whop sign-in', enabled ? 'enabled:' : 'disabled:', session.email);
      return json({ success: true, whopLoginEnabled: enabled });
    }

    // ── POST /api/auth/2fa/setup — generate TOTP secret for user ──
    if (path === '/api/auth/2fa/setup' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);

      const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const raw = new Uint8Array(20);
      crypto.getRandomValues(raw);
      let secret = '', bits = 0, value = 0;
      for (const byte of raw) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { secret += base32Chars[(value >>> (bits - 5)) & 31]; bits -= 5; }
      }
      if (bits > 0) secret += base32Chars[(value << (5 - bits)) & 31];

      await env.NEXUS_KV.put(`2fa_pending:${session.email}`, secret, { expirationTtl: 600 });

      const issuer = 'FSD-X Trading';
      const label = encodeURIComponent(issuer + ':' + session.email);
      const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      return json({ success: true, secret, otpauthUrl });
    }

    // ── POST /api/auth/2fa/verify — confirm setup code, activate 2FA ──
    if (path === '/api/auth/2fa/verify' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { code } = body || {};
      if (!code) return json({ error: 'Code required.' }, 400);

      const secret = await env.NEXUS_KV.get(`2fa_pending:${session.email}`);
      if (!secret) return json({ error: 'Setup session expired. Please start over.' }, 400);

      const isValid = await verifyTotp(secret, code);
      if (!isValid) {
        if (await rateHit(env, '2fa_setup', session.email, 10, 600)) {
          await env.NEXUS_KV.delete(`2fa_pending:${session.email}`);
          return json({ error: 'Too many wrong codes. Start setup again.' }, 429);
        }
        return json({ error: 'Invalid code. Check your authenticator and try again.' }, 401);
      }

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);
      user.totpSecret = secret;
      user.twoFactorEnabled = true;
      await env.NEXUS_KV.put(`user:${session.email}`, JSON.stringify(user));
      await env.NEXUS_KV.delete(`2fa_pending:${session.email}`);
      console.log('[auth] 2FA enabled:', session.email);
      return json({ success: true });
    }

    // ── POST /api/auth/2fa/disable — disable 2FA (requires password) ──
    if (path === '/api/auth/2fa/disable' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { password } = body || {};
      if (!password) return json({ error: 'Password required to disable 2FA.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found' }, 404);
      if (await rateCheck(env, 'pw_change', session.email, 5)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }
      const pwc = await verifyPassword(password, user.passwordHash);
      if (!pwc.ok) {
        await rateHit(env, 'pw_change', session.email, 5, 900);
        return json({ error: 'Incorrect password.' }, 401);
      }

      user.totpSecret = null;
      user.twoFactorEnabled = false;
      await env.NEXUS_KV.put(`user:${session.email}`, JSON.stringify(user));
      console.log('[auth] 2FA disabled:', session.email);
      return json({ success: true });
    }

    // ── POST /api/auth/2fa/login — complete login with TOTP code ──
    if (path === '/api/auth/2fa/login' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { preToken, code } = body || {};
      if (!preToken || !code) return json({ error: 'Pre-auth token and code required.' }, 400);

      const pendingEmail = await env.NEXUS_KV.get(`user_preauth:${preToken}`);
      if (!pendingEmail) return json({ error: 'Session expired. Please log in again.' }, 401);

      if (await rateCheck(env, 'totp_email', pendingEmail, 10)) {
        return json({ error: 'Too many wrong codes. Wait 15 minutes and log in again.' }, 429);
      }

      const user = await env.NEXUS_KV.get(`user:${pendingEmail}`, { type: 'json' });
      if (!user || !user.totpSecret) return json({ error: 'User not found or 2FA not configured.' }, 404);

      const isValid = await verifyTotp(user.totpSecret, code);
      if (!isValid) {
        await rateHit(env, 'totp_email', pendingEmail, 10, 900);
        // 5 wrong codes burns this pre-auth token — back to the password step.
        if (await rateHit(env, 'totp_pre', preToken, 4, 300)) {
          await env.NEXUS_KV.delete(`user_preauth:${preToken}`);
          return json({ error: 'Too many wrong codes. Please log in again.' }, 401);
        }
        return json({ error: 'Invalid or expired code.' }, 401);
      }
      if (await totpAlreadyUsed(env, pendingEmail, code)) {
        return json({ error: 'That code was already used. Wait for the next one.' }, 401);
      }
      await rateClear(env, 'totp_email', pendingEmail);

      await env.NEXUS_KV.delete(`user_preauth:${preToken}`);
      // An account with no Whop key is pending, not a lapsed member.
      const isPending2fa = !user.whopKey;
      const token = await createSession(env, {
        email: pendingEmail, firstName: user.firstName,
        tier: isPending2fa ? 'pending' : (user.tier || 'pro'),
        plan: user.whopPlan || null,
        subscriptionActive: !isPending2fa, expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
      }, 7 * 24 * 60 * 60);

      return json({
        success: true, token, firstName: user.firstName,
        tier: isPending2fa ? 'pending' : (user.tier || 'pro'),
        whopStatus: isPending2fa ? 'pending' : (user.whopStatus || 'active'),
        pending: isPending2fa
      });
    }

    // ── POST /api/auth/email-change/confirm — verify code and apply email change ──
    if (path === '/api/auth/email-change/confirm' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const { code } = body || {};
      if (!code) return json({ error: 'Confirmation code required.' }, 400);

      const pending = await env.NEXUS_KV.get(`email_change:${session.email}`, { type: 'json' });
      if (!pending) return json({ error: 'No pending email change, or it has expired. Please save your profile again.' }, 400);
      if (String(pending.code) !== String(code).trim()) {
        // 5 wrong codes kills the pending change — they must request a new one.
        if (await rateHit(env, 'email_change_code', session.email, 4, 600)) {
          await env.NEXUS_KV.delete(`email_change:${session.email}`);
          return json({ error: 'Too many wrong codes. Save your profile again to get a new one.' }, 429);
        }
        return json({ error: 'Incorrect code. Try again.' }, 401);
      }
      await rateClear(env, 'email_change_code', session.email);

      const oldEmail = session.email;
      const newEmail = pending.newEmail;
      const existing = await env.NEXUS_KV.get(`user:${newEmail}`, { type: 'json' });
      if (existing) return json({ error: 'That email is already in use.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${oldEmail}`, { type: 'json' });
      if (!user) return json({ error: 'User not found.' }, 404);
      user.email = newEmail;
      if (pending.firstName) user.firstName = pending.firstName;
      if (pending.lastName !== undefined) user.lastName = pending.lastName;

      await env.NEXUS_KV.put(`user:${newEmail}`, JSON.stringify(user));
      await env.NEXUS_KV.delete(`user:${oldEmail}`);
      await env.NEXUS_KV.delete(`email_change:${oldEmail}`);
      if (user.whopKey) await env.NEXUS_KV.put(`key_account:${user.whopKey}`, newEmail);

      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      const idx = memberList.findIndex(m => m.email === oldEmail);
      if (idx !== -1) { memberList[idx].email = newEmail; memberList[idx].firstName = user.firstName; memberList[idx].lastName = user.lastName; }
      await env.NEXUS_KV.put('admin:member_list', JSON.stringify(memberList));

      // Every session under the old email dies; the caller gets a fresh one below.
      await revokeAllSessions(env, oldEmail);
      const oldToken = bearerToken(request);
      if (oldToken) await destroySession(env, oldToken);
      const newToken = await createSession(env, {
        email: newEmail, firstName: user.firstName, tier: session.tier,
        plan: session.plan || user.whopPlan || null,
        subscriptionActive: session.subscriptionActive,
        expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
      }, 7 * 24 * 60 * 60);

      console.log('[auth] email changed confirmed:', oldEmail, '->', newEmail);
      return json({ success: true, newToken, emailChanged: true });
    }

    // ── POST /api/auth/delete-account — member self-delete ──
    if (path === '/api/auth/delete-account' && request.method === 'POST') {
      const session = await getSessionFromRequest(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const { password } = body || {};
      if (!password) return json({ error: 'Password required to confirm deletion.' }, 400);

      const user = await env.NEXUS_KV.get(`user:${session.email}`, { type: 'json' });
      if (!user) return json({ error: 'User not found.' }, 404);

      if (await rateCheck(env, 'pw_change', session.email, 5)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      }
      const pwd = await verifyPassword(password, user.passwordHash);
      if (!pwd.ok) {
        await rateHit(env, 'pw_change', session.email, 5, 900);
        return json({ error: 'Incorrect password.' }, 401);
      }

      const whopKey = user.whopKey || null;

      // Delete account + reverse lookup
      await env.NEXUS_KV.delete(`user:${session.email}`);
      if (whopKey) await env.NEXUS_KV.delete(`key_account:${whopKey}`);

      // Delete all data
      if (whopKey) {
        await env.NEXUS_KV.delete(`journal:${whopKey}`);
        await env.NEXUS_KV.delete(`journal_settings:${whopKey}`);
        const sessions = await env.NEXUS_KV.get(`backtest_sessions:${whopKey}`, { type: 'json' }) || [];
        for (const s of sessions) {
          await env.NEXUS_KV.delete(`backtest:${whopKey}:${s.id}`);
        }
        await env.NEXUS_KV.delete(`backtest_sessions:${whopKey}`);
        await env.NEXUS_KV.delete(`nexus_fp:${whopKey}`);
      }

      // Remove from member list
      const memberList = await env.NEXUS_KV.get('admin:member_list', { type: 'json' }) || [];
      const filtered = memberList.filter(m => m.email !== session.email);
      await env.NEXUS_KV.put('admin:member_list', JSON.stringify(filtered));

      // Remove any stored Tradovate connection + synced data
      try { await purgeTradovate(env, session.email); } catch (e) {}
      // Invalidate every session for this account
      await revokeAllSessions(env, session.email);
      const token = bearerToken(request);
      if (token) await destroySession(env, token);

      console.log('[auth] account self-deleted:', session.email);
      return json({ success: true });
    }

    return json({ error: 'Not found' }, 404);
  }
};
