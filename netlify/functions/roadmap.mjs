// Business Development Roadmap -- order, intake, customer workspace, and
// operator workflow. Built from BODA issue #19 (2026-10-06). Payment is
// verified server-side against the AI4 Product Purchasing hub's
// product_entitlements table (same cross-project pattern as
// vendor-presence.mjs's checkEntitlement) -- a client-supplied email/session
// id is only ever used as a lookup key into that server-verified data,
// never trusted as proof of payment by itself.
//
// Customer workspace access model: the order id (a UUIDv4, effectively a
// 122-bit bearer token) is the only credential a customer needs -- it is
// handed to the browser once, at claim time, and never listed/enumerable
// anywhere. This is intentionally lighter than a full login system, per the
// brief's own non-goal ("no new standalone auth architecture if existing
// session pattern can be reused") -- there is no existing Roadmap-customer
// login pattern to reuse, so this is the minimum viable equivalent of one.
//
// Operator access reuses the exact pattern already proven in this file's
// sibling (vendor-presence.mjs's action=survey-list / survey-mark-public,
// gated on VENDOR_SURVEY_ADMIN_KEY): a single shared admin key compared to
// a query-string key, no new auth architecture.

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
  if (!url || !key) throw new Error('Roadmap data service is unavailable.');
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

// Cross-project read into the AI4 Product Purchasing hub -- same
// ENTITLEMENTS_SUPABASE_URL / ENTITLEMENTS_SUPABASE_SERVICE_KEY env vars
// vendor-presence.mjs already uses for boda_vendor_card.
async function paidEntitlementForSession({ email, sessionId }) {
  const url = Netlify.env.get('ENTITLEMENTS_SUPABASE_URL');
  const key = Netlify.env.get('ENTITLEMENTS_SUPABASE_SERVICE_KEY');
  if (!url || !key || !email || !sessionId) return null;
  const r = await fetch(
    `${url.replace(/\/$/, '')}/rest/v1/product_entitlements`
      + `?customer_email=eq.${encodeURIComponent(email.toLowerCase())}`
      + `&stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}`
      + `&product_code=eq.boda_roadmap&status=eq.paid&select=*&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) { console.error('[roadmap] entitlement check failed', r.status); return null; }
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

function adminOk(req, url) {
  const adminKey = Netlify.env.get('ROADMAP_ADMIN_KEY');
  const supplied = clean(url.searchParams.get('key'));
  return Boolean(adminKey) && supplied === adminKey;
}

async function loadOrder(orderId) {
  const rows = await db('boda_roadmap_orders', 'GET', `?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

const REQUIRED_INTAKE_FIELDS = ['primary_services', 'service_area', 'growth_objectives'];

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = clean(url.searchParams.get('action'), 50);

    // ---- Public: redirect to the Stripe Payment Link ----
    // The actual Payment Link URL is server-configured (not hardcoded in
    // business-development-roadmap.html) so it can be set the moment Jeff
    // creates the live $1,295 Price in Stripe, with zero code changes. The
    // Payment Link's own success_url must be configured in Stripe to
    // https://aproposopportunity.org/roadmap-intake?session_id={CHECKOUT_SESSION_ID}.
    if (req.method === 'GET' && action === 'checkout') {
      const link = Netlify.env.get('BODA_ROADMAP_PAYMENT_LINK_URL');
      if (!link) {
        return new Response(
          '<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;max-width:560px;margin:80px auto;text-align:center;color:#14233a"><h1 style="font-family:Georgia,serif">Not available yet</h1><p>The Business Development Roadmap purchase link is still being set up. Please check back soon, or contact the Agency directly.</p><p><a href="/opportunity-next-steps">Back to Your Next Steps</a></p></body>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      return new Response(null, { status: 302, headers: { location: link } });
    }

    // ---- Customer: claim an order right after Stripe redirects back ----
    if (req.method === 'POST' && action === 'claim-order') {
      const input = await req.json().catch(() => ({}));
      const email = clean(input.email).toLowerCase();
      const sessionId = clean(input.session_id, 200);
      if (!emailOk(email) || !sessionId) return json({ ok: false, error: 'Email and session_id are required.' }, 400);

      // Idempotent: a page refresh (or a second claim-order call after
      // intake has already progressed) must return the SAME order and must
      // never reset its roadmap_status back to INTAKE_PENDING. Checked
      // first for the common case; the unique index on
      // stripe_checkout_session_id is the real guarantee against a
      // double-click race, caught below rather than relied on alone.
      const existing = await db('boda_roadmap_orders', 'GET',
        `?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=id&limit=1`);
      if (existing?.[0]) return json({ ok: true, order_id: existing[0].id });

      const entitlement = await paidEntitlementForSession({ email, sessionId });
      if (!entitlement) return json({ ok: false, error: 'Payment not confirmed yet. If you just completed checkout, wait a moment and try again.' }, 402);

      let order;
      try {
        const created = await db('boda_roadmap_orders', 'POST', '', [{
          business_name: entitlement.business_name || clean(input.business_name) || email,
          contact_name: entitlement.customer_name || clean(input.contact_name) || null,
          email,
          source: clean(input.source) || 'direct',
          source_opportunity_reference: clean(input.source_opportunity_reference) || null,
          price: 1295.00,
          payment_status: 'paid',
          roadmap_status: 'INTAKE_PENDING',
          stripe_checkout_session_id: sessionId,
          stripe_customer_email: email
        }], 'return=representation');
        order = created?.[0];
      } catch (e) {
        // 23505 = unique_violation -- another concurrent request already
        // created this order between the check above and this insert.
        if (!/23505|duplicate key/i.test(e?.message || '')) throw e;
        const raced = await db('boda_roadmap_orders', 'GET',
          `?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=id&limit=1`);
        order = raced?.[0];
      }
      if (!order) return json({ ok: false, error: 'Order could not be created.' }, 500);
      return json({ ok: true, order_id: order.id });
    }

    // ---- Customer: submit intake ----
    if (req.method === 'POST' && action === 'intake') {
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const order = await loadOrder(orderId);
      if (!order) return json({ ok: false, error: 'Order not found.' }, 404);

      const missing = REQUIRED_INTAKE_FIELDS.filter(f => {
        const v = input[f];
        return Array.isArray(v) ? v.length === 0 : !clean(v);
      });
      if (missing.length) return json({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);

      const profileRow = {
        order_id: orderId,
        business_name: clean(input.business_name) || order.business_name,
        website: clean(input.website, 500),
        headquarters: clean(input.headquarters, 300),
        service_area: clean(input.service_area, 500),
        years_in_operation: clean(input.years_in_operation, 100),
        primary_services: clean(input.primary_services, 2000),
        secondary_services: clean(input.secondary_services, 2000),
        naics_codes: Array.isArray(input.naics_codes) ? input.naics_codes.map(x => clean(x, 20)).filter(Boolean) : [],
        certifications: Array.isArray(input.certifications) ? input.certifications.map(x => clean(x, 120)).filter(Boolean) : [],
        team_size: clean(input.team_size, 100),
        typical_customer_types: clean(input.typical_customer_types, 1000),
        typical_job_value: clean(input.typical_job_value, 200),
        growth_objectives: Array.isArray(input.growth_objectives) ? input.growth_objectives.map(x => clean(x, 120)).filter(Boolean) : [],
        growth_objective_other: clean(input.growth_objective_other, 500),
        current_lead_sources: clean(input.current_lead_sources, 1000),
        current_marketing_channels: clean(input.current_marketing_channels, 1000),
        current_outreach_activity: clean(input.current_outreach_activity, 1000),
        current_sales_process: clean(input.current_sales_process, 1000),
        crm_tracking_method: clean(input.crm_tracking_method, 500),
        sales_response_process: clean(input.sales_response_process, 1000),
        known_competitors: clean(input.known_competitors, 1000),
        main_growth_obstacle: clean(input.main_growth_obstacle, 1000),
        capacity_limitations: clean(input.capacity_limitations, 1000),
        geographic_limitations: clean(input.geographic_limitations, 1000),
        desired_90_day_result: clean(input.desired_90_day_result, 1000),
        additional_context: clean(input.additional_context, 2000),
        updated_at: new Date().toISOString()
      };
      await db('boda_roadmap_profiles', 'POST', '?on_conflict=order_id', [profileRow],
        'resolution=merge-duplicates,return=minimal');

      const orderUpdate = { roadmap_status: 'INTAKE_COMPLETE', updated_at: new Date().toISOString() };
      if (profileRow.business_name) orderUpdate.business_name = profileRow.business_name;
      await db('boda_roadmap_orders', 'PATCH', `?id=eq.${encodeURIComponent(orderId)}`, orderUpdate, 'return=minimal');
      return json({ ok: true });
    }

    // ---- Customer: workspace status ----
    if (req.method === 'GET' && action === 'status') {
      const orderId = clean(url.searchParams.get('order_id'));
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const order = await loadOrder(orderId);
      if (!order) return json({ ok: false, error: 'Order not found.' }, 404);

      const isDelivered = ['APPROVED', 'DELIVERED'].includes(order.roadmap_status);
      const [profileRows, priorities, actions, kpis, blueprint] = await Promise.all([
        db('boda_roadmap_profiles', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`),
        isDelivered ? db('boda_roadmap_priorities', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.APPROVED&select=*&order=priority_rank.asc`) : [],
        isDelivered ? db('boda_roadmap_actions', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=phase.asc,sort_order.asc`) : [],
        isDelivered ? db('boda_roadmap_kpis', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`) : [],
        isDelivered ? db('boda_roadmap_campaign_blueprints', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.APPROVED&select=*&limit=1`) : []
      ]);

      return json({
        ok: true,
        order: {
          id: order.id,
          business_name: order.business_name,
          roadmap_status: order.roadmap_status,
          payment_status: order.payment_status,
          created_at: order.created_at,
          completed_at: order.completed_at
        },
        intake_complete: Boolean(profileRows?.[0]),
        deliverable: isDelivered ? {
          priorities: priorities || [],
          actions: actions || [],
          kpis: kpis?.[0] || null,
          campaign_blueprint: blueprint?.[0] || null
        } : null
      });
    }

    // ================= OPERATOR =================
    // Each admin-* branch checks adminOk() independently below.

    if (req.method === 'GET' && action === 'admin-list') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const rows = await db('boda_roadmap_orders', 'GET',
        '?select=id,business_name,email,roadmap_status,payment_status,created_at,completed_at&order=created_at.desc&limit=200');
      return json({ ok: true, orders: rows || [] });
    }

    if (req.method === 'GET' && action === 'admin-detail') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const orderId = clean(url.searchParams.get('order_id'));
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const [order, profile, research, priorities, actions, kpis, blueprint] = await Promise.all([
        loadOrder(orderId),
        db('boda_roadmap_profiles', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`),
        db('boda_roadmap_research', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=created_at.desc`),
        db('boda_roadmap_priorities', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=priority_rank.asc.nullslast`),
        db('boda_roadmap_actions', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=phase.asc,sort_order.asc`),
        db('boda_roadmap_kpis', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`),
        db('boda_roadmap_campaign_blueprints', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`)
      ]);
      if (!order) return json({ ok: false, error: 'Order not found.' }, 404);
      return json({
        ok: true, order, profile: profile?.[0] || null, research: research || [],
        priorities: priorities || [], actions: actions || [], kpis: kpis?.[0] || null,
        campaign_blueprint: blueprint?.[0] || null
      });
    }

    if (req.method === 'POST' && action === 'admin-update-status') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      const status = clean(input.roadmap_status, 30);
      const allowed = ['PURCHASED', 'INTAKE_PENDING', 'INTAKE_COMPLETE', 'RESEARCH', 'ANALYSIS', 'QA_REVIEW', 'REVISION_REQUIRED', 'APPROVED', 'DELIVERED', 'CLOSED'];
      if (!isUuid(orderId) || !allowed.includes(status)) return json({ ok: false, error: 'Invalid order or status.' }, 400);
      await db('boda_roadmap_orders', 'PATCH', `?id=eq.${encodeURIComponent(orderId)}`,
        { roadmap_status: status, updated_at: new Date().toISOString() }, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-add-research') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const findingTypes = ['CUSTOMER_PROVIDED', 'VERIFIED_PUBLIC', 'ASSUMPTION', 'BODA_ANALYSIS', 'RECOMMENDATION'];
      const lenses = ['MARKET_FIT', 'BUYER_FIT', 'OFFER_FIT', 'POSITIONING', 'SALES_READINESS', 'EXECUTION_CAPACITY'];
      const findingType = clean(input.finding_type, 30);
      if (!findingTypes.includes(findingType)) return json({ ok: false, error: 'Invalid finding_type.' }, 400);
      const summary = clean(input.summary, 2000);
      if (!summary) return json({ ok: false, error: 'summary is required.' }, 400);
      await db('boda_roadmap_research', 'POST', '', [{
        order_id: orderId,
        finding_type: findingType,
        lens: lenses.includes(clean(input.lens, 30)) ? clean(input.lens, 30) : null,
        summary,
        detail: clean(input.detail, 4000),
        source_url: clean(input.source_url, 1000),
        captured_at: input.captured_at ? new Date(input.captured_at).toISOString() : null,
        created_by: clean(input.created_by, 200) || 'operator'
      }], 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-save-priorities') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId) || !Array.isArray(input.priorities)) return json({ ok: false, error: 'order_id and priorities[] are required.' }, 400);
      await db('boda_roadmap_priorities', 'DELETE', `?order_id=eq.${encodeURIComponent(orderId)}`, undefined, 'return=minimal');
      if (input.priorities.length) {
        const rows = input.priorities.map(p => ({
          order_id: orderId,
          priority_rank: Number.isInteger(p.priority_rank) ? p.priority_rank : null,
          opportunity_type: clean(p.opportunity_type, 300),
          market_segment: clean(p.market_segment, 300),
          target_buyer_type: clean(p.target_buyer_type, 300),
          rationale: clean(p.rationale, 2000),
          demand_relevance_score: Number.isFinite(Number(p.demand_relevance_score)) ? Number(p.demand_relevance_score) : null,
          capability_fit_score: Number.isFinite(Number(p.capability_fit_score)) ? Number(p.capability_fit_score) : null,
          buyer_accessibility_score: Number.isFinite(Number(p.buyer_accessibility_score)) ? Number(p.buyer_accessibility_score) : null,
          revenue_potential_score: Number.isFinite(Number(p.revenue_potential_score)) ? Number(p.revenue_potential_score) : null,
          recurring_revenue_score: Number.isFinite(Number(p.recurring_revenue_score)) ? Number(p.recurring_revenue_score) : null,
          competition_score: Number.isFinite(Number(p.competition_score)) ? Number(p.competition_score) : null,
          sales_cycle_score: Number.isFinite(Number(p.sales_cycle_score)) ? Number(p.sales_cycle_score) : null,
          geographic_feasibility_score: Number.isFinite(Number(p.geographic_feasibility_score)) ? Number(p.geographic_feasibility_score) : null,
          execution_difficulty_score: Number.isFinite(Number(p.execution_difficulty_score)) ? Number(p.execution_difficulty_score) : null,
          total_score: Number.isFinite(Number(p.total_score)) ? Number(p.total_score) : null,
          status: p.status === 'APPROVED' ? 'APPROVED' : 'DRAFT'
        }));
        await db('boda_roadmap_priorities', 'POST', '', rows, 'return=minimal');
      }
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-save-actions') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId) || !Array.isArray(input.actions)) return json({ ok: false, error: 'order_id and actions[] are required.' }, 400);
      const phases = ['DO_NOW', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90'];
      await db('boda_roadmap_actions', 'DELETE', `?order_id=eq.${encodeURIComponent(orderId)}`, undefined, 'return=minimal');
      if (input.actions.length) {
        const rows = input.actions.map((a, i) => ({
          order_id: orderId,
          phase: phases.includes(a.phase) ? a.phase : 'DO_NOW',
          action: clean(a.action, 500),
          purpose: clean(a.purpose, 1000),
          dependency: clean(a.dependency, 500),
          expected_result: clean(a.expected_result, 1000),
          priority: Number.isInteger(a.priority) ? a.priority : null,
          owner: clean(a.owner, 200),
          status: ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(a.status) ? a.status : 'PLANNED',
          sort_order: i
        })).filter(r => r.action);
        if (rows.length) await db('boda_roadmap_actions', 'POST', '', rows, 'return=minimal');
      }
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-save-kpis') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
      await db('boda_roadmap_kpis', 'POST', '?on_conflict=order_id', [{
        order_id: orderId,
        target_accounts: num(input.target_accounts),
        contacts_reached: num(input.contacts_reached),
        responses: num(input.responses),
        qualified_opportunities: num(input.qualified_opportunities),
        meetings: num(input.meetings),
        proposals_quotes: num(input.proposals_quotes),
        closed_sales: num(input.closed_sales),
        notes: clean(input.notes, 2000),
        updated_at: new Date().toISOString()
      }], 'resolution=merge-duplicates,return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-save-blueprint') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      await db('boda_roadmap_campaign_blueprints', 'POST', '?on_conflict=order_id', [{
        order_id: orderId,
        target_segment: clean(input.target_segment, 500),
        target_account_criteria: clean(input.target_account_criteria, 1000),
        buyer_roles: clean(input.buyer_roles, 500),
        offer: clean(input.offer, 1000),
        value_proposition: clean(input.value_proposition, 1000),
        message_theme: clean(input.message_theme, 1000),
        cta: clean(input.cta, 300),
        recommended_channel: clean(input.recommended_channel, 300),
        cadence: clean(input.cadence, 300),
        campaign_volume_assumption: clean(input.campaign_volume_assumption, 500),
        kpi_targets: clean(input.kpi_targets, 1000),
        status: input.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
        updated_at: new Date().toISOString()
      }], 'resolution=merge-duplicates,return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-approve') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      // QA completeness gate (section 15): the full 12-point human review
      // is operator judgment, not something code can verify -- this enforces
      // only that every required section actually has content before the
      // status can move to APPROVED.
      const [priorities, actions, kpis, blueprint] = await Promise.all([
        db('boda_roadmap_priorities', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.APPROVED&select=id`),
        db('boda_roadmap_actions', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=id`),
        db('boda_roadmap_kpis', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&select=id&limit=1`),
        db('boda_roadmap_campaign_blueprints', 'GET', `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.APPROVED&select=id&limit=1`)
      ]);
      const gaps = [];
      if (!priorities?.length) gaps.push('no approved growth priorities');
      if (!actions?.length) gaps.push('no 90-day actions');
      if (!kpis?.length) gaps.push('no KPI targets');
      if (!blueprint?.length) gaps.push('no approved campaign blueprint');
      if (gaps.length) return json({ ok: false, error: `Cannot approve: ${gaps.join('; ')}.` }, 400);

      await db('boda_roadmap_orders', 'PATCH', `?id=eq.${encodeURIComponent(orderId)}`,
        { roadmap_status: 'APPROVED', updated_at: new Date().toISOString() }, 'return=minimal');
      return json({ ok: true });
    }

    if (req.method === 'POST' && action === 'admin-deliver') {
      if (!adminOk(req, url)) return json({ ok: false, error: 'Not authorized.' }, 401);
      const input = await req.json().catch(() => ({}));
      const orderId = clean(input.order_id);
      if (!isUuid(orderId)) return json({ ok: false, error: 'Invalid order.' }, 400);
      const order = await loadOrder(orderId);
      if (!order) return json({ ok: false, error: 'Order not found.' }, 404);
      if (order.roadmap_status !== 'APPROVED') return json({ ok: false, error: 'Order must be APPROVED before delivery.' }, 400);
      const now = new Date().toISOString();
      await db('boda_roadmap_orders', 'PATCH', `?id=eq.${encodeURIComponent(orderId)}`,
        { roadmap_status: 'DELIVERED', completed_at: now, updated_at: now }, 'return=minimal');
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error('[roadmap]', error?.message);
    return json({ ok: false, error: error?.message || 'Roadmap service error.' }, 500);
  }
};

export const config = { path: '/api/roadmap' };
