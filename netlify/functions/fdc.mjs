import { createHash } from 'node:crypto';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const hash = v => createHash('sha256').update(v).digest('hex');

function dbConfig() {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('FDC data service is unavailable.');
  return { url: url.replace(/\/$/, ''), key };
}

async function db(table, method = 'GET', query = '', body, prefer = '') {
  const { url, key } = dbConfig();
  const r = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!r.ok) {
    console.error('[fdc] db error', table, method, r.status, data);
    throw new Error(`FDC data operation failed (${r.status}).`);
  }
  return data;
}

function cookieToken(req) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)boda_vendor_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function sessionProfile(req) {
  const raw = cookieToken(req);
  if (!raw) return null;
  const now = new Date().toISOString();
  const sessions = await db('boda_vendor_sessions', 'GET',
    `?select=profile_id,expires_at&token_hash=eq.${encodeURIComponent(hash(raw))}&expires_at=gt.${encodeURIComponent(now)}&limit=1`);
  if (!sessions?.length) return null;
  await db('boda_vendor_sessions', 'PATCH',
    `?token_hash=eq.${encodeURIComponent(hash(raw))}`,
    { last_used_at: now });
  const profiles = await db('boda_vendor_profiles', 'GET',
    `?select=id,business_name,owner_email,website,city,state,uei,naics,certifications,core_capabilities,products_services&id=eq.${encodeURIComponent(sessions[0].profile_id)}&limit=1`);
  return profiles?.[0] || null;
}

async function entitlementFor(profileId) {
  const rows = await db('fdc_entitlements', 'GET',
    `?select=*&boda_profile_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

async function fdcProfileFor(profileId) {
  const rows = await db('fdc_profiles', 'GET',
    `?select=*&boda_profile_id=eq.${encodeURIComponent(profileId)}&limit=1`);
  return rows?.[0] || null;
}

async function currentInterview(fdcProfileId) {
  if (!fdcProfileId) return null;
  const rows = await db('fdc_interviews', 'GET',
    `?select=*&fdc_profile_id=eq.${encodeURIComponent(fdcProfileId)}&status=eq.IN_PROGRESS&order=started_at.desc&limit=1`);
  return rows?.[0] || null;
}

async function responsesFor(interviewId) {
  if (!interviewId) return [];
  return await db('fdc_interview_responses', 'GET',
    `?select=section_code,question_code,response_text,response_json,evidence_status,updated_at&interview_id=eq.${encodeURIComponent(interviewId)}&order=created_at.asc`) || [];
}

async function audit(fdcProfileId, action, resourceType, resourceId, eventData = {}) {
  try {
    await db('fdc_audit_log', 'POST', '', {
      fdc_profile_id: fdcProfileId || null,
      actor_type: 'BODA_BUSINESS',
      action,
      resource_type: resourceType || null,
      resource_id: resourceId || null,
      event_data: eventData
    });
  } catch (e) {
    console.warn('[fdc] audit write failed', e?.message);
  }
}

function requireActive(entitlement) {
  return entitlement && entitlement.status === 'ACTIVE';
}

function publicBusiness(profile) {
  return {
    id: profile.id,
    business_name: profile.business_name,
    owner_email: profile.owner_email,
    website: profile.website,
    city: profile.city,
    state: profile.state,
    uei: profile.uei,
    naics: profile.naics,
    certifications: profile.certifications,
    core_capabilities: profile.core_capabilities,
    products_services: profile.products_services
  };
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = clean(url.searchParams.get('action') || 'bootstrap', 80);
    const boda = await sessionProfile(req);
    if (!boda) return json({ ok: false, error: 'BODA business session required.' }, 401);

    const entitlement = await entitlementFor(boda.id);
    const profile = await fdcProfileFor(boda.id);

    if (req.method === 'GET' && action === 'bootstrap') {
      const interview = profile ? await currentInterview(profile.id) : null;
      const responses = interview ? await responsesFor(interview.id) : [];
      return json({
        ok: true,
        business: publicBusiness(boda),
        entitlement: entitlement ? {
          id: entitlement.id,
          status: entitlement.status,
          entitlement_type: entitlement.entitlement_type,
          product_code: entitlement.product_code,
          activated_at: entitlement.activated_at
        } : null,
        access_active: requireActive(entitlement),
        profile,
        interview,
        responses
      });
    }

    if (req.method === 'POST' && action === 'initialize') {
      let ent = entitlement;
      if (!ent) {
        const rows = await db('fdc_entitlements', 'POST', '', {
          boda_profile_id: boda.id,
          product_code: 'FDC_FUNDING_PREPARATION',
          entitlement_type: 'ONE_TIME_PURCHASE',
          status: 'PENDING',
          access_source: 'BODA_FDC'
        }, 'return=representation');
        ent = rows?.[0] || null;
      }
      let fdcProfile = profile;
      if (!fdcProfile) {
        const rows = await db('fdc_profiles', 'POST', '', {
          boda_profile_id: boda.id,
          entitlement_id: ent?.id || null,
          status: 'ACTIVE',
          interview_status: 'NOT_STARTED',
          onboarding_stage: 1,
          preparation_status: 'NOT_STARTED'
        }, 'return=representation');
        fdcProfile = rows?.[0] || null;
        await audit(fdcProfile?.id, 'PROFILE_CREATED', 'fdc_profiles', fdcProfile?.id, { entitlement_status: ent?.status || null });
      }
      return json({ ok: true, entitlement: ent, profile: fdcProfile, access_active: requireActive(ent) });
    }

    if (!profile) return json({ ok: false, error: 'FDC profile has not been initialized.' }, 409);
    if (!requireActive(entitlement)) return json({ ok: false, error: 'FDC access is pending activation.', code: 'ENTITLEMENT_REQUIRED' }, 402);

    if (req.method === 'POST' && action === 'interview-start') {
      let interview = await currentInterview(profile.id);
      if (!interview) {
        const rows = await db('fdc_interviews', 'POST', '', {
          fdc_profile_id: profile.id,
          interview_type: 'FUNDING_DEVELOPMENT',
          status: 'IN_PROGRESS',
          current_section: 'BUSINESS_OBJECTIVE',
          channel: 'WEB'
        }, 'return=representation');
        interview = rows?.[0] || null;
        await db('fdc_profiles', 'PATCH', `?id=eq.${encodeURIComponent(profile.id)}`, {
          interview_status: 'IN_PROGRESS', onboarding_stage: 1, updated_at: new Date().toISOString()
        });
        await audit(profile.id, 'INTERVIEW_STARTED', 'fdc_interviews', interview?.id, { channel: 'WEB' });
      }
      return json({ ok: true, interview, responses: await responsesFor(interview.id) });
    }

    if (req.method === 'POST' && action === 'interview-save') {
      const body = await req.json().catch(() => ({}));
      const interviewId = clean(body.interview_id, 80);
      const sectionCode = clean(body.section_code, 100);
      const questionCode = clean(body.question_code, 120);
      const responseText = clean(body.response_text, 12000);
      if (!interviewId || !sectionCode || !questionCode) return json({ ok: false, error: 'Interview response identifiers are required.' }, 400);

      const owned = await db('fdc_interviews', 'GET',
        `?select=id&fdc_profile_id=eq.${encodeURIComponent(profile.id)}&id=eq.${encodeURIComponent(interviewId)}&limit=1`);
      if (!owned?.length) return json({ ok: false, error: 'Interview not found.' }, 404);

      const existing = await db('fdc_interview_responses', 'GET',
        `?select=id&interview_id=eq.${encodeURIComponent(interviewId)}&question_code=eq.${encodeURIComponent(questionCode)}&limit=1`);
      const payload = {
        interview_id: interviewId,
        fdc_profile_id: profile.id,
        section_code: sectionCode,
        question_code: questionCode,
        response_text: responseText || null,
        evidence_status: 'USER_REPORTED',
        source_channel: 'WEB',
        updated_at: new Date().toISOString()
      };
      let saved;
      if (existing?.length) {
        saved = await db('fdc_interview_responses', 'PATCH', `?id=eq.${encodeURIComponent(existing[0].id)}`, payload, 'return=representation');
      } else {
        saved = await db('fdc_interview_responses', 'POST', '', payload, 'return=representation');
      }

      const profilePatch = { updated_at: new Date().toISOString() };
      if (questionCode === 'funding_objective') profilePatch.funding_objective = responseText || null;
      if (questionCode === 'business_history') profilePatch.business_history = responseText || null;
      if (questionCode === 'current_business_need') profilePatch.current_business_need = responseText || null;
      if (Object.keys(profilePatch).length > 1) await db('fdc_profiles', 'PATCH', `?id=eq.${encodeURIComponent(profile.id)}`, profilePatch);
      await db('fdc_interviews', 'PATCH', `?id=eq.${encodeURIComponent(interviewId)}`, { current_section: sectionCode, updated_at: new Date().toISOString() });
      await audit(profile.id, 'INTERVIEW_RESPONSE_SAVED', 'fdc_interviews', interviewId, { section_code: sectionCode, question_code: questionCode });
      return json({ ok: true, response: saved?.[0] || null });
    }

    if (req.method === 'POST' && action === 'interview-complete') {
      const body = await req.json().catch(() => ({}));
      const interviewId = clean(body.interview_id, 80);
      if (!interviewId) return json({ ok: false, error: 'Interview id is required.' }, 400);
      const owned = await db('fdc_interviews', 'GET',
        `?select=id&fdc_profile_id=eq.${encodeURIComponent(profile.id)}&id=eq.${encodeURIComponent(interviewId)}&limit=1`);
      if (!owned?.length) return json({ ok: false, error: 'Interview not found.' }, 404);
      const now = new Date().toISOString();
      await db('fdc_interviews', 'PATCH', `?id=eq.${encodeURIComponent(interviewId)}`, { status: 'COMPLETED', completed_at: now, updated_at: now });
      await db('fdc_profiles', 'PATCH', `?id=eq.${encodeURIComponent(profile.id)}`, { interview_status: 'COMPLETED', onboarding_stage: 2, preparation_status: 'IN_PROGRESS', updated_at: now });
      await audit(profile.id, 'INTERVIEW_COMPLETED', 'fdc_interviews', interviewId, {});
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unsupported FDC action.' }, 404);
  } catch (e) {
    console.error('[fdc] request failed', e);
    return json({ ok: false, error: 'FDC service request could not be completed.' }, 500);
  }
};

export const config = { path: '/api/fdc' };
