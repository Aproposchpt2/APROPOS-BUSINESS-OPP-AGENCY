// Business Development Marketing Engine -- managed campaign execution
// against an approved Business Development Roadmap. Built 2026-10-06,
// dependent on roadmap.mjs / BODA issue #19.
//
// SENDING IS DELIBERATELY INERT IN THIS BUILD. admin-queue-outreach writes
// boda_marketing_outreach_events rows with status='READY_TO_SEND' and never
// calls an email provider. Per the build directive (section 15): sender
// domain, SPF, DKIM, and DMARC are not yet configured, and the code must
// not assume they exist. Per section 29's non-goals: "automatic campaign
// activation without human approval" is explicitly out of scope. Flipping
// READY_TO_SEND rows to an actually-sent state (and wiring a real provider
// call) is a separate, later step once Jeff confirms sender-domain setup --
// not a flag to toggle, a function to write.
//
// Payment: subscription entitlement verified the same way
// vendor-presence.mjs's checkEntitlement already does for boda_vendor_card
// (cross-project read of product_entitlements by email + product_code +
// active/trialing status) -- not the one-time session-id pattern roadmap.mjs
// uses for the Roadmap, because this is a recurring subscription, not a
// one-time purchase.
//
// Customer workspace access: the account id (UUIDv4 bearer token), same
// model as roadmap.mjs. Operator access: a dedicated
// MARKETING_ENGINE_ADMIN_KEY, same shared-key pattern as every other
// operator console in this codebase -- intentionally a different key than
// ROADMAP_ADMIN_KEY / VENDOR_SURVEY_ADMIN_KEY so campaign-execution access
// is not bundled with unrelated consoles.

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });

const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v));

function dbConfig() {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Marketing Engine data service is unavailable.');
  return { url: url.replace(/\/$/, ''), key };
}

async function db(table, method = 'GET', query = '', body, prefer = '') {
  const { url, key } = dbConfig();
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url}/rest/v1/${table}${query}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  const raw = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`${table} ${method} failed (${r.status}): ${raw.slice(0, 500)}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

// Cross-project read into the AI4 Product Purchasing hub, same env vars
// vendor-presence.mjs's checkEntitlement and roadmap.mjs already use.
async function activeSubscriptionEntitlement(email) {
  const url = Netlify.env.get('ENTITLEMENTS_SUPABASE_URL');
  const key = Netlify.env.get('ENTITLEMENTS_SUPABASE_SERVICE_KEY');
  if (!url || !key || !email) return null;
  const r = await fetch(
    `${url.replace(/\/$/, '')}/rest/v1/product_entitlements`
      + `?customer_email=eq.${encodeURIComponent(email.toLowerCase())}`
      + `&product_code=eq.boda_marketing_engine&status=in.(active,trialing)&select=*&order=updated_at.desc&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) { console.error('[marketing-engine] entitlement check failed', r.status); return null; }
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

function adminOk(url) {
  const adminKey = Netlify.env.get('MARKETING_ENGINE_ADMIN_KEY');
  const supplied = clean(url.searchParams.get('key'));
  return Boolean(adminKey) && supplied === adminKey;
}

async function loadAccount(accountId) {
  const rows = await db('boda_marketing_engine_accounts', 'GET', `?id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`);
  return rows?.[0] || null;
}
async function loadCampaignForAccount(accountId) {
  const rows = await db('boda_marketing_campaigns', 'GET', `?account_id=eq.${encodeURIComponent(accountId)}&select=*&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}
async function loadCampaign(campaignId) {
  const rows = await db('boda_marketing_campaigns', 'GET', `?id=eq.${encodeURIComponent(campaignId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

const CAMPAIGN_STATUSES = ['SETUP', 'AWAITING_CUSTOMER_APPROVAL', 'APPROVED', 'RESEARCH', 'READY_TO_LAUNCH', 'ACTIVE', 'PAUSED', 'OPTIMIZING', 'COMPLETED', 'CANCELLED'];
const MESSAGE_TYPES = ['INITIAL', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FINAL_FOLLOW_UP'];
const RESPONSE_CLASSIFICATIONS = ['POSITIVE_INTEREST', 'FOLLOW_UP_LATER', 'REFERRAL', 'INFORMATION_REQUEST', 'NOT_INTERESTED', 'UNQUALIFIED', 'OPT_OUT', 'DELIVERY_FAILURE', 'OTHER'];

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = clean(url.searchParams.get('action'), 50);

    // ---- Public: redirect to the Stripe Payment Link ----
    if (req.method === 'GET' && action === 'checkout') {
      const link = Netlify.env.get('BODA_MARKETING_ENGINE_PAYMENT_LINK_URL');
      if (!link) {
        return new Response(
          '<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;max-width:560px;margin:80px auto;text-align:center;color:#14233a"><h1 style="font-family:Georgia,serif">Not available yet</h1><p>The Business Development Marketing Engine purchase link is still being set up. Please check back soon, or contact the Agency directly.</p><p><a href="/opportunity-next-steps">Back to Your Next Steps</a></p></body>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      return new Response(null, { status: 302, headers: { location: link } });
    }

    // ---- Customer: claim account after Stripe subscription checkout ----
    if (req.method === 'POST' && action === 'claim-account') {
      const input = await req.json().catch(() => ({}));
      const email = clean(input.email).toLowerCase();
      if (!emailOk(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);

      const existing = await db('boda_marketing_engine_accounts', 'GET',
        `?contact_email=eq.${encodeURIComponent(email)}&select=id&order=created_at.desc&limit=1`);
      if (existing?.[0]) return json({ ok: true, account_id: existing[0].id });

      const entitlement = await activeSubscriptionEntitlement(email);
      if (!entitlement) return json({ ok: false, error: 'Active subscription not found. If you just completed checkout, wait a moment and try again.' }, 402);

      let roadmapId = isUuid(input.roadmap_id) ? input.roadmap_id : null;
      if (!roadmapId) {
        const roadmapRows = await db('boda_roadmap_orders', 'GET',
          `?email=eq.${encodeURIComponent(email)}&roadmap_status=in.(APPROVED,DELIVERED)&select=id&order=updated_at.desc&limit=1`);
        roadmapId = roadmapRows?.[0]?.id || null;
      }

      const created = await db('boda_marketing_engine_accounts', 'POST', '', [{
        roadmap_id: roadmapId,
        business_name: entitlement.business_name || clean(input.business_name) || email,
        contact_name: entitlement.customer_name || clean(input.contact_name) || null,
        contact_email: email,
        plan_price: 1495.00,
        payment_status: 'paid',
        subscription_status: ['active', 'trialing'].includes(entitlement.status) ? 'active' : 'pending',
        stripe_subscription_id: entitlement.stripe_subscription_id || null,
        campaign_term_start: new Date().toISOString().slice(0, 10),
        campaign_term_end: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
      }], 'return=representation');
      const account = created?.[0];
      if (!account) return json({ ok: false, error: 'Account could not be created.' }, 500);
      return json({ ok: true, account_id: account.id });
    }

    // ---- Customer: load the approved Roadmap's campaign blueprint into a new campaign ----
    if (req.method === 'POST' && action === 'setup-campaign-from-roadmap') {
      const input = await req.json().catch(() => ({}));
      const accountId = clean(input.account_id);
      if (!isUuid(accountId)) return json({ ok: false, error: 'Invalid account.' }, 400);
      const account = await loadAccount(accountId);
      if (!account) return json({ ok: false, error: 'Account not found.' }, 404);

      const existingCampaign = await loadCampaignForAccount(accountId);
      if (existingCampaign) return json({ ok: true, campaign_id: existingCampaign.id });

      let blueprint = null;
      if (account.roadmap_id) {
        const rows = await db('boda_roadmap_campaign_blueprints', 'GET',
          `?order_id=eq.${encodeURIComponent(account.roadmap_id)}&status=eq.APPROVED&select=*&limit=1`);
        blueprint = rows?.[0] || null;
      }

      const created = await db('boda_marketing_campaigns', 'POST', '', [{
        account_id: accountId,
        roadmap_id: account.roadmap_id || null,
        campaign_name: 'Primary Campaign',
        status: 'SETUP',
        target_segment: blueprint?.target_segment || null,
        target_account_criteria: blueprint?.target_account_criteria || null,
        buyer_roles: blueprint?.buyer_roles || null,
        offer: blueprint?.offer || null,
        value_proposition: blueprint?.value_proposition || null,
        message_theme: blueprint?.message_theme || null,
        cta: blueprint?.cta || null,
        primary_channel: 'EMAIL',
        cadence: blueprint?.cadence || null,
        monthly_capacity: 15
      }], 'return=representation');
      const campaign = created?.[0];
      if (!campaign) return json({ ok: false, error: 'Campaign could not be created.' }, 500);
      return json({ ok: true, campaign_id: campaign.id, blueprint_loaded: Boolean(blueprint) });
    }

    // ---- Customer: approve campaign target/message/CTA ----
    if (req.method === 'POST' && action === 'approve-campaign') {
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      if (!isUuid(campaignId)) return json({ ok: false, error: 'Invalid campaign.' }, 400);
      const campaign = await loadCampaign(campaignId);
      if (!campaign) return json({ ok: false, error: 'Campaign not found.' }, 404);
      if (campaign.status !== 'AWAITING_CUSTOMER_APPROVAL') {
        return json({ ok: false, error: `Campaign is not awaiting approval (status: ${campaign.status}).` }, 400);
      }
      await db('boda_marketing_campaigns', 'PATCH', `?id=eq.${encodeURIComponent(campaignId)}`,
        { status: 'APPROVED', customer_approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 'return=minimal');
      return json({ ok: true });
    }

    // ---- Customer: workspace status ----
    if (req.method === 'GET' && action === 'workspace-status') {
      const accountId = clean(url.searchParams.get('account_id'));
      if (!isUuid(accountId)) return json({ ok: false, error: 'Invalid account.' }, 400);
      const account = await loadAccount(accountId);
      if (!account) return json({ ok: false, error: 'Account not found.' }, 404);
      const campaign = await loadCampaignForAccount(accountId);
      if (!campaign) {
        return json({ ok: true, account: { id: account.id, business_name: account.business_name }, campaign: null });
      }

      const [latestSnapshot, opportunities, optimizationNotes, activeMessages] = await Promise.all([
        db('boda_marketing_kpi_snapshots', 'GET', `?campaign_id=eq.${encodeURIComponent(campaign.id)}&select=*&order=snapshot_date.desc&limit=1`),
        db('boda_marketing_opportunities', 'GET', `?campaign_id=eq.${encodeURIComponent(campaign.id)}&handoff_status=eq.HANDED_OFF&select=*&order=handoff_at.desc`),
        db('boda_marketing_optimization_log', 'GET', `?campaign_id=eq.${encodeURIComponent(campaign.id)}&customer_visible=eq.true&select=observation,variable_changed,reason,effective_at&order=effective_at.desc&limit=10`),
        db('boda_marketing_messages', 'GET', `?campaign_id=eq.${encodeURIComponent(campaign.id)}&approval_status=eq.APPROVED&active=eq.true&select=message_type,subject,body,cta&order=message_type.asc`)
      ]);

      return json({
        ok: true,
        account: { id: account.id, business_name: account.business_name },
        campaign: {
          id: campaign.id,
          status: campaign.status,
          target_segment: campaign.target_segment,
          offer: campaign.offer,
          cta: campaign.cta,
          cadence: campaign.cadence,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          customer_approved_at: campaign.customer_approved_at
        },
        approved_messages: activeMessages || [],
        kpis: latestSnapshot?.[0] || null,
        qualified_opportunities: (opportunities || []).map(o => ({
          id: o.id, opportunity_type: o.opportunity_type, recommended_next_action: o.recommended_next_action,
          handoff_at: o.handoff_at, meeting_status: o.meeting_status, proposal_quote_status: o.proposal_quote_status
        })),
        optimization_notes: optimizationNotes || []
      });
    }

    // ================= OPERATOR =================

    if (req.method === 'GET' && action === 'admin-list') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const accounts = await db('boda_marketing_engine_accounts', 'GET',
        '?select=id,business_name,contact_email,subscription_status,campaign_term_start,campaign_term_end,created_at&order=created_at.desc&limit=200');
      return json({ ok: true, accounts: accounts || [] });
    }

    if (req.method === 'GET' && action === 'admin-detail') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const accountId = clean(url.searchParams.get('account_id'));
      if (!isUuid(accountId)) return json({ ok: false, error: 'Invalid account.' }, 400);
      const account = await loadAccount(accountId);
      if (!account) return json({ ok: false, error: 'Account not found.' }, 404);
      const campaign = await loadCampaignForAccount(accountId);
      if (!campaign) return json({ ok: true, account, campaign: null });

      const cid = campaign.id;
      const [targets, contacts, messages, outreach, responses, opportunities, kpiSnapshots, optimizationLog] = await Promise.all([
        db('boda_marketing_target_accounts', 'GET', `?campaign_id=eq.${cid}&select=*&order=created_at.desc`),
        db('boda_marketing_contacts', 'GET', `?campaign_id=eq.${cid}&select=*&order=created_at.desc`),
        db('boda_marketing_messages', 'GET', `?campaign_id=eq.${cid}&select=*&order=message_type.asc,version.desc`),
        db('boda_marketing_outreach_events', 'GET', `?campaign_id=eq.${cid}&select=*&order=created_at.desc&limit=500`),
        db('boda_marketing_responses', 'GET', `?campaign_id=eq.${cid}&select=*&order=received_at.desc`),
        db('boda_marketing_opportunities', 'GET', `?campaign_id=eq.${cid}&select=*&order=created_at.desc`),
        db('boda_marketing_kpi_snapshots', 'GET', `?campaign_id=eq.${cid}&select=*&order=snapshot_date.desc&limit=12`),
        db('boda_marketing_optimization_log', 'GET', `?campaign_id=eq.${cid}&select=*&order=effective_at.desc`)
      ]);
      return json({
        ok: true, account, campaign,
        targets: targets || [], contacts: contacts || [], messages: messages || [],
        outreach: outreach || [], responses: responses || [], opportunities: opportunities || [],
        kpi_snapshots: kpiSnapshots || [], optimization_log: optimizationLog || []
      });
    }

    if (req.method === 'POST' && action === 'admin-set-campaign-spec') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      if (!isUuid(campaignId)) return json({ ok: false, error: 'Invalid campaign.' }, 400);
      const patch = {
        target_segment: clean(input.target_segment, 500),
        target_account_criteria: clean(input.target_account_criteria, 1000),
        buyer_roles: clean(input.buyer_roles, 500),
        offer: clean(input.offer, 1000),
        value_proposition: clean(input.value_proposition, 1000),
        message_theme: clean(input.message_theme, 1000),
        cta: clean(input.cta, 300),
        primary_channel: clean(input.primary_channel, 50) || 'EMAIL',
        cadence: clean(input.cadence, 300),
        monthly_capacity: Number.isFinite(Number(input.monthly_capacity)) ? Number(input.monthly_capacity) : null,
        updated_at: new Date().toISOString()
      };
      if (input.send_for_approval) patch.status = 'AWAITING_CUSTOMER_APPROVAL';
      await db('boda_marketing_campaigns', 'PATCH', `?id=eq.${encodeURIComponent(campaignId)}`, patch, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-update-campaign-status') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const status = clean(input.status, 30);
      if (!isUuid(campaignId) || !CAMPAIGN_STATUSES.includes(status)) return json({ ok: false, error: 'Invalid campaign or status.' }, 400);
      const patch = { status, updated_at: new Date().toISOString() };
      if (status === 'ACTIVE') {
        const campaign = await loadCampaign(campaignId);
        if (!campaign?.start_date) patch.start_date = new Date().toISOString().slice(0, 10);
        if (!campaign?.end_date) patch.end_date = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      }
      await db('boda_marketing_campaigns', 'PATCH', `?id=eq.${encodeURIComponent(campaignId)}`, patch, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-add-target-account') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const businessName = clean(input.business_name, 300);
      if (!isUuid(campaignId) || !businessName) return json({ ok: false, error: 'campaign_id and business_name are required.' }, 400);
      const created = await db('boda_marketing_target_accounts', 'POST', '', [{
        campaign_id: campaignId,
        business_name: businessName,
        website: clean(input.website, 500),
        industry: clean(input.industry, 300),
        geography: clean(input.geography, 300),
        account_type: clean(input.account_type, 200),
        qualification_basis: clean(input.qualification_basis, 1000),
        source: clean(input.source, 300),
        source_url: clean(input.source_url, 1000),
        verification_status: input.verification_status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
        eligibility_status: input.eligibility_status === 'ELIGIBLE' ? 'ELIGIBLE' : 'PENDING'
      }], 'return=representation');
      return json({ ok: true, target_account: created?.[0] || null });
    }

    if (req.method === 'POST' && action === 'admin-add-contact') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const targetAccountId = clean(input.target_account_id);
      const email = clean(input.email).toLowerCase();
      if (!isUuid(campaignId) || !isUuid(targetAccountId) || !emailOk(email)) {
        return json({ ok: false, error: 'campaign_id, target_account_id, and a valid email are required.' }, 400);
      }
      // No guessed/pattern-generated emails: a contact can only be marked
      // VERIFIED, and therefore only eligible for outreach, with evidence
      // attached. This is a code guardrail, not a substitute for operator
      // judgment -- it cannot detect a guessed address by format alone.
      const wantsVerified = input.verification_status === 'VERIFIED';
      const sourceUrl = clean(input.source_url, 1000);
      if (wantsVerified && !sourceUrl) {
        return json({ ok: false, error: 'A source_url is required to mark a contact VERIFIED.' }, 400);
      }
      const created = await db('boda_marketing_contacts', 'POST', '', [{
        target_account_id: targetAccountId,
        campaign_id: campaignId,
        contact_name: clean(input.contact_name, 300),
        title: clean(input.title, 300),
        buyer_role: clean(input.buyer_role, 300),
        email,
        phone: clean(input.phone, 60),
        source: clean(input.source, 300),
        source_url: sourceUrl,
        contact_type: clean(input.contact_type, 100),
        verification_status: wantsVerified ? 'VERIFIED' : 'UNVERIFIED',
        verified_at: wantsVerified ? new Date().toISOString() : null,
        outreach_eligible: wantsVerified && input.outreach_eligible === true
      }], 'return=representation');
      return json({ ok: true, contact: created?.[0] || null });
    }

    if (req.method === 'POST' && action === 'admin-update-contact') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const contactId = clean(input.contact_id);
      if (!isUuid(contactId)) return json({ ok: false, error: 'Invalid contact.' }, 400);
      const patch = {};
      if (input.verification_status === 'VERIFIED' || input.verification_status === 'REJECTED' || input.verification_status === 'UNVERIFIED') {
        patch.verification_status = input.verification_status;
        if (input.verification_status === 'VERIFIED') patch.verified_at = new Date().toISOString();
      }
      if (typeof input.outreach_eligible === 'boolean') {
        // Can never become eligible without being verified first.
        const rows = await db('boda_marketing_contacts', 'GET', `?id=eq.${encodeURIComponent(contactId)}&select=verification_status,do_not_contact&limit=1`);
        const contact = rows?.[0];
        const willBeVerified = patch.verification_status === 'VERIFIED' || (contact?.verification_status === 'VERIFIED' && patch.verification_status === undefined);
        patch.outreach_eligible = input.outreach_eligible === true && willBeVerified && !contact?.do_not_contact;
      }
      if (input.do_not_contact === true) {
        patch.do_not_contact = true;
        patch.do_not_contact_at = new Date().toISOString();
        patch.outreach_eligible = false;
      }
      if (!Object.keys(patch).length) return json({ ok: false, error: 'Nothing to update.' }, 400);
      await db('boda_marketing_contacts', 'PATCH', `?id=eq.${encodeURIComponent(contactId)}`, patch, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-save-message') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const messageType = clean(input.message_type, 30);
      const body = clean(input.body, 5000);
      if (!isUuid(campaignId) || !MESSAGE_TYPES.includes(messageType) || !body) {
        return json({ ok: false, error: 'campaign_id, a valid message_type, and body are required.' }, 400);
      }
      if (input.active === true) {
        // Only one active message per type per campaign.
        await db('boda_marketing_messages', 'PATCH',
          `?campaign_id=eq.${encodeURIComponent(campaignId)}&message_type=eq.${encodeURIComponent(messageType)}`,
          { active: false }, 'return=minimal');
      }
      const created = await db('boda_marketing_messages', 'POST', '', [{
        campaign_id: campaignId,
        version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
        message_type: messageType,
        subject: clean(input.subject, 300),
        body,
        cta: clean(input.cta, 300),
        approval_status: input.approval_status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
        approved_at: input.approval_status === 'APPROVED' ? new Date().toISOString() : null,
        active: input.active === true
      }], 'return=representation');
      return json({ ok: true, message: created?.[0] || null });
    }

    // Queues outreach as READY_TO_SEND. Deliberately inert -- see file
    // header. Enforces: message must be APPROVED + active; contact must be
    // VERIFIED, outreach_eligible, and not do_not_contact.
    if (req.method === 'POST' && action === 'admin-queue-outreach') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const messageId = clean(input.message_id);
      const contactIds = Array.isArray(input.contact_ids) ? input.contact_ids.filter(isUuid) : [];
      if (!isUuid(campaignId) || !isUuid(messageId) || !contactIds.length) {
        return json({ ok: false, error: 'campaign_id, message_id, and at least one contact_id are required.' }, 400);
      }
      const [messageRows, contactRows] = await Promise.all([
        db('boda_marketing_messages', 'GET', `?id=eq.${encodeURIComponent(messageId)}&select=*&limit=1`),
        db('boda_marketing_contacts', 'GET', `?id=in.(${contactIds.map(encodeURIComponent).join(',')})&select=*`)
      ]);
      const message = messageRows?.[0];
      if (!message || message.approval_status !== 'APPROVED' || !message.active) {
        return json({ ok: false, error: 'Message must be approved and active before it can be queued.' }, 400);
      }
      const eligible = (contactRows || []).filter(c => c.verification_status === 'VERIFIED' && c.outreach_eligible && !c.do_not_contact);
      const rejected = (contactRows || []).length - eligible.length;
      if (!eligible.length) return json({ ok: false, error: 'No eligible contacts (must be VERIFIED, outreach_eligible, and not do-not-contact).' }, 400);

      const rows = eligible.map(c => ({
        campaign_id: campaignId,
        contact_id: c.id,
        message_id: messageId,
        scheduled_at: input.scheduled_at ? new Date(input.scheduled_at).toISOString() : new Date().toISOString(),
        status: 'READY_TO_SEND'
      }));
      await db('boda_marketing_outreach_events', 'POST', '', rows, 'return=minimal');
      return json({ ok: true, queued: eligible.length, skipped_ineligible: rejected });
    }

    if (req.method === 'POST' && action === 'admin-add-response') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const outreachEventId = clean(input.outreach_event_id);
      const classification = clean(input.classification, 30);
      if (!isUuid(outreachEventId) || !RESPONSE_CLASSIFICATIONS.includes(classification)) {
        return json({ ok: false, error: 'A valid outreach_event_id and classification are required.' }, 400);
      }
      const eventRows = await db('boda_marketing_outreach_events', 'GET', `?id=eq.${encodeURIComponent(outreachEventId)}&select=campaign_id,contact_id&limit=1`);
      const event = eventRows?.[0];
      if (!event) return json({ ok: false, error: 'Outreach event not found.' }, 404);

      const created = await db('boda_marketing_responses', 'POST', '', [{
        outreach_event_id: outreachEventId,
        campaign_id: event.campaign_id,
        contact_id: event.contact_id,
        response_text: clean(input.response_text, 4000),
        classification,
        next_action: clean(input.next_action, 1000),
        follow_up_date: input.follow_up_date || null
      }], 'return=representation');

      await db('boda_marketing_outreach_events', 'PATCH', `?id=eq.${encodeURIComponent(outreachEventId)}`,
        { response_detected: true, updated_at: new Date().toISOString() }, 'return=minimal');

      // Opt-outs are durable and override all future eligibility.
      if (classification === 'OPT_OUT') {
        await db('boda_marketing_contacts', 'PATCH', `?id=eq.${encodeURIComponent(event.contact_id)}`,
          { do_not_contact: true, do_not_contact_at: new Date().toISOString(), outreach_eligible: false }, 'return=minimal');
      }
      return json({ ok: true, response: created?.[0] || null });
    }

    if (req.method === 'POST' && action === 'admin-review-response') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const responseId = clean(input.response_id);
      if (!isUuid(responseId)) return json({ ok: false, error: 'Invalid response.' }, 400);
      await db('boda_marketing_responses', 'PATCH', `?id=eq.${encodeURIComponent(responseId)}`, {
        operator_reviewed: true,
        next_action: clean(input.next_action, 1000),
        follow_up_date: input.follow_up_date || null
      }, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-create-opportunity') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const contactId = clean(input.contact_id);
      const qualificationBasis = clean(input.qualification_basis, 1000);
      if (!isUuid(campaignId) || !isUuid(contactId) || !qualificationBasis) {
        return json({ ok: false, error: 'campaign_id, contact_id, and qualification_basis are required.' }, 400);
      }
      const created = await db('boda_marketing_opportunities', 'POST', '', [{
        campaign_id: campaignId,
        contact_id: contactId,
        target_account_id: isUuid(input.target_account_id) ? input.target_account_id : null,
        response_id: isUuid(input.response_id) ? input.response_id : null,
        qualification_status: 'QUALIFIED',
        qualification_basis: qualificationBasis,
        opportunity_type: clean(input.opportunity_type, 300),
        recommended_next_action: clean(input.recommended_next_action, 1000)
      }], 'return=representation');
      return json({ ok: true, opportunity: created?.[0] || null });
    }

    if (req.method === 'POST' && action === 'admin-handoff-opportunity') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const opportunityId = clean(input.opportunity_id);
      if (!isUuid(opportunityId)) return json({ ok: false, error: 'Invalid opportunity.' }, 400);
      await db('boda_marketing_opportunities', 'PATCH', `?id=eq.${encodeURIComponent(opportunityId)}`, {
        handoff_status: 'HANDED_OFF', handoff_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-update-opportunity') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const opportunityId = clean(input.opportunity_id);
      if (!isUuid(opportunityId)) return json({ ok: false, error: 'Invalid opportunity.' }, 400);
      const patch = { updated_at: new Date().toISOString() };
      ['customer_follow_up_status', 'meeting_status', 'proposal_quote_status', 'closed_sale_status'].forEach(f => {
        if (input[f] !== undefined) patch[f] = clean(input[f], 200);
      });
      if (input.attributed_revenue !== undefined) {
        patch.attributed_revenue = Number.isFinite(Number(input.attributed_revenue)) ? Number(input.attributed_revenue) : null;
      }
      await db('boda_marketing_opportunities', 'PATCH', `?id=eq.${encodeURIComponent(opportunityId)}`, patch, 'return=minimal');
      return json({ ok: true });
    }

    // Auto-computed from the underlying tables, not operator-entered --
    // avoids vanity-metric drift between what's reported and what actually
    // happened (section 22).
    if (req.method === 'POST' && action === 'admin-record-kpi-snapshot') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      if (!isUuid(campaignId)) return json({ ok: false, error: 'Invalid campaign.' }, 400);

      const [targets, contacts, outreach, responses, opportunities] = await Promise.all([
        db('boda_marketing_target_accounts', 'GET', `?campaign_id=eq.${campaignId}&select=id`),
        db('boda_marketing_contacts', 'GET', `?campaign_id=eq.${campaignId}&verification_status=eq.VERIFIED&select=id`),
        db('boda_marketing_outreach_events', 'GET', `?campaign_id=eq.${campaignId}&select=status,delivery_status,bounce_type`),
        db('boda_marketing_responses', 'GET', `?campaign_id=eq.${campaignId}&select=classification`),
        db('boda_marketing_opportunities', 'GET', `?campaign_id=eq.${campaignId}&select=qualification_status,meeting_status,proposal_quote_status,closed_sale_status`)
      ]);
      const sentStatuses = ['SENT'];
      const outreachSent = (outreach || []).filter(o => sentStatuses.includes(o.status)).length;
      const delivered = (outreach || []).filter(o => o.delivery_status === 'delivered').length;
      const bounces = (outreach || []).filter(o => o.bounce_type).length;
      const positiveResponses = (responses || []).filter(r => r.classification === 'POSITIVE_INTEREST').length;
      const qualifiedOpportunities = (opportunities || []).filter(o => o.qualification_status === 'QUALIFIED').length;
      const meetings = (opportunities || []).filter(o => o.meeting_status).length;
      const proposalsQuotes = (opportunities || []).filter(o => o.proposal_quote_status).length;
      const closedSales = (opportunities || []).filter(o => o.closed_sale_status === 'CLOSED_WON').length;

      const created = await db('boda_marketing_kpi_snapshots', 'POST', '', [{
        campaign_id: campaignId,
        target_accounts_researched: (targets || []).length,
        contacts_verified: (contacts || []).length,
        outreach_sent: outreachSent,
        delivered,
        bounces,
        responses: (responses || []).length,
        positive_responses: positiveResponses,
        qualified_opportunities: qualifiedOpportunities,
        meetings,
        proposals_quotes: proposalsQuotes,
        closed_sales: closedSales,
        attributed_revenue: Number.isFinite(Number(input.attributed_revenue)) ? Number(input.attributed_revenue) : null
      }], 'return=representation');
      return json({ ok: true, snapshot: created?.[0] || null });
    }

    if (req.method === 'POST' && action === 'admin-log-optimization') {
      if (!adminOk(url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const campaignId = clean(input.campaign_id);
      const observation = clean(input.observation, 2000);
      if (!isUuid(campaignId) || !observation) return json({ ok: false, error: 'campaign_id and observation are required.' }, 400);
      const created = await db('boda_marketing_optimization_log', 'POST', '', [{
        campaign_id: campaignId,
        observation,
        diagnosed_bottleneck: clean(input.diagnosed_bottleneck, 1000),
        variable_changed: clean(input.variable_changed, 300),
        old_value: clean(input.old_value, 500),
        new_value: clean(input.new_value, 500),
        reason: clean(input.reason, 1000),
        approved_by: clean(input.approved_by, 200) || 'operator',
        customer_visible: input.customer_visible === true
      }], 'return=representation');
      return json({ ok: true, entry: created?.[0] || null });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error('[marketing-engine]', error?.message);
    return json({ ok: false, error: error?.message || 'Marketing Engine service error.' }, 500);
  }
};

export const config = { path: '/api/marketing-engine' };
