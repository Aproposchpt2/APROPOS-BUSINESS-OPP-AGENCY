// Stripe webhook for the Vendor Card Post Manager subscription. Verifies
// the signature (constant-time compare over the raw body, per Stripe's own
// scheme -- t=<timestamp>,v1=<hmac>) before trusting any event content.
// TEST MODE (see vendor-card-billing.mjs for the live-mode switch note).
import { createHmac, timingSafeEqual } from 'node:crypto';

const StripeWebhookSecretEnv = 'STRIPE_WEBHOOK_SECRET_TEST';
const TOLERANCE_SECONDS = 300;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

function verify(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries((sigHeader || '').split(',').map(p => p.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex')); }
  catch { return false; }
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
  if (!r.ok) { console.error('vendor-card-webhook db error', table, r.status, data); throw new Error(`Webhook data service ${table} ${method} ${r.status}`); }
  return data;
}

async function setStatus({ customerId, subscriptionId, status }) {
  if (!customerId) return;
  await db('boda_vendor_profiles', 'PATCH', `?stripe_customer_id=eq.${encodeURIComponent(customerId)}`,
    { subscription_status: status, stripe_subscription_id: subscriptionId || null, updated_at: new Date().toISOString() },
    'return=minimal');
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);

  const secret = Netlify.env.get(StripeWebhookSecretEnv);
  if (!secret) return json({ ok: false, error: 'Webhook is not configured.' }, 503);

  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!verify(rawBody, sig, secret)) return json({ ok: false, error: 'Invalid signature.' }, 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ ok: false, error: 'Invalid payload.' }, 400); }

  try {
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
        if (obj.mode === 'subscription') {
          await setStatus({ customerId: obj.customer, subscriptionId: obj.subscription, status: 'active' });
        }
        break;
      case 'customer.subscription.updated': {
        const status = obj.status === 'active' || obj.status === 'trialing' ? 'active'
          : obj.status === 'past_due' ? 'past_due' : 'canceled';
        await setStatus({ customerId: obj.customer, subscriptionId: obj.id, status });
        break;
      }
      case 'customer.subscription.deleted':
        await setStatus({ customerId: obj.customer, subscriptionId: obj.id, status: 'canceled' });
        break;
      default:
        break; // ignore everything else
    }
    return json({ ok: true });
  } catch (error) {
    console.error('[vendor-card-webhook]', error);
    // Non-2xx makes Stripe retry -- correct behavior for a transient DB error.
    return json({ ok: false, error: 'Webhook processing failed.' }, 500);
  }
}

export const config = { path: '/api/vendor-card-webhook' };
