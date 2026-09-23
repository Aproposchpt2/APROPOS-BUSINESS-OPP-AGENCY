// Vendor Card Post Manager -- $19.99/month subscription that unlocks the
// Vendor Workspace editor. The free complimentary claim already auto-
// publishes a public Vendor Card (see vendor-presence.mjs) -- this billing
// module gates ONLY the ability to edit it, nothing else.
//
// TEST MODE by default (StripeTestKey/StripeWebhookSecretTest below). To go
// live: change StripeKeyEnv/StripeWebhookSecretEnv to the non-_TEST env var
// names -- everything else (price lookup, checkout, webhook) is identical
// between test and live, Stripe just runs on separate key/object spaces.
import { createHash } from 'node:crypto';

const StripeKeyEnv = 'STRIPE_SECRET_KEY_TEST';
const StripeWebhookSecretEnv = 'STRIPE_WEBHOOK_SECRET_TEST';
const PRICE_NAME = 'BODA Vendor Card Post Manager';
const PRICE_AMOUNT_CENTS = 1999;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

function stripeKey() {
  const k = Netlify.env.get(StripeKeyEnv);
  if (!k) throw new Error('Billing is not configured.');
  return k;
}

async function stripe(path, method = 'GET', form) {
  const key = stripeKey();
  const init = {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    },
    body: form ? new URLSearchParams(form).toString() : undefined
  };
  const r = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Stripe ${path} failed (${r.status})`);
  return data;
}

// Idempotent: finds the existing Price by lookup_key if it's already been
// created, otherwise creates the Product + recurring Price once. Safe to
// call repeatedly (e.g. on every checkout) -- cheap after the first call.
const LOOKUP_KEY = 'boda_vendor_card_post_manager_1999_monthly';
let cachedPriceId = null;
async function ensurePriceId() {
  if (cachedPriceId) return cachedPriceId;
  const existing = await stripe(`prices?lookup_keys[]=${encodeURIComponent(LOOKUP_KEY)}&limit=1`);
  if (existing?.data?.length) { cachedPriceId = existing.data[0].id; return cachedPriceId; }
  const product = await stripe('products', 'POST', { name: PRICE_NAME });
  const price = await stripe('prices', 'POST', {
    product: product.id,
    unit_amount: String(PRICE_AMOUNT_CENTS),
    currency: 'usd',
    'recurring[interval]': 'month',
    lookup_key: LOOKUP_KEY
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

function dbConfig() {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Vendor profile data service is unavailable.');
  return { url: url.replace(/\/$/, ''), key };
}
async function db(table, method = 'GET', query = '', body, prefer = '') {
  const { url, key } = dbConfig();
  const r = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!r.ok) { console.error('vendor-card-billing db error', table, r.status, data); throw new Error(`Billing data service ${table} ${method} ${r.status}`); }
  return data;
}
const hash = v => createHash('sha256').update(v).digest('hex');
function cookieToken(req) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)boda_vendor_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
async function sessionProfile(req) {
  const raw = cookieToken(req);
  if (!raw) return null;
  const sessions = await db('boda_vendor_sessions', 'GET',
    `?select=profile_id&token_hash=eq.${encodeURIComponent(hash(raw))}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  if (!sessions?.length) return null;
  const profiles = await db('boda_vendor_profiles', 'GET', `?select=*&id=eq.${encodeURIComponent(sessions[0].profile_id)}&limit=1`);
  return profiles?.[0] || null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (req.method === 'POST' && action === 'create-checkout') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ ok: false, error: 'Session required.' }, 401);

      const priceId = await ensurePriceId();
      let customerId = profile.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe('customers', 'POST', {
          email: profile.owner_email || profile.public_contact_email || undefined,
          name: profile.business_name,
          'metadata[boda_vendor_profile_id]': profile.id
        });
        customerId = customer.id;
        await db('boda_vendor_profiles', 'PATCH', `?id=eq.${encodeURIComponent(profile.id)}`,
          { stripe_customer_id: customerId, updated_at: new Date().toISOString() }, 'return=minimal');
      }

      const origin = `${url.protocol}//${url.host}`;
      const session = await stripe('checkout/sessions', 'POST', {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${origin}/vendor-workspace?billing=success`,
        cancel_url: `${origin}/vendor-workspace?billing=cancelled`,
        'metadata[boda_vendor_profile_id]': profile.id
      });
      return json({ ok: true, url: session.url });
    }

    if (req.method === 'POST' && action === 'portal') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ ok: false, error: 'Session required.' }, 401);
      if (!profile.stripe_customer_id) return json({ ok: false, error: 'No billing account on file yet.' }, 400);

      const origin = `${url.protocol}//${url.host}`;
      const session = await stripe('billing_portal/sessions', 'POST', {
        customer: profile.stripe_customer_id,
        return_url: `${origin}/vendor-workspace`
      });
      return json({ ok: true, url: session.url });
    }

    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('[vendor-card-billing]', error);
    return json({ ok: false, error: error.message || 'Billing request could not be completed.' }, 500);
  }
}

export const config = { path: '/api/vendor-card-billing' };
