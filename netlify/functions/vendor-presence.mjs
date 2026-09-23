// Redeploy trigger: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars were corrected 2026-09-22.
import { createHash, randomBytes } from 'node:crypto';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const hash = v => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const slugify = s => clean(s, 120).toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'business';

function cleanOpportunity(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {
    title: clean(o.title, 300),
    agency_name: clean(o.agency_name, 300),
    solicitation_number: clean(o.solicitation_number, 120),
    response_deadline: clean(o.response_deadline, 60),
    scope_summary: clean(o.scope_summary || o.description, 4000),
    authoritative_url: clean(o.authoritative_url, 1000),
    place_of_performance: clean(o.place_of_performance, 200)
      || [clean(o.city, 120), clean(o.state, 80)].filter(Boolean).join(', '),
    naics: clean(o.naics, 20),
    set_aside: clean(o.set_aside, 120),
    state: clean(o.state, 80)
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// Licensed Business (state/local) complimentary-contract fallback. The real
// complimentary opportunity normally arrives from claim-opportunity.html's
// best-effort fetch against the external marketplace
// (marketplace.aproposgroupllc.com, proxied via opportunity-gateway.mjs) --
// that call is wrapped in a try/catch there and deliberately never blocks
// the claim, so it can legitimately come back empty. Rather than leaving a
// Licensed Business claim with no complimentary contract at all, wire the
// fallback directly to BDMS's own live repository (cbrief_contract_
// opportunities, same Supabase project as boda_vendor_profiles -- no new
// credentials needed). Deterministic per business (hash of name+email picks
// the index), not random, so a re-claim doesn't hand a different business
// a different complimentary contract on every attempt.
async function fallbackComplimentaryFromRepository(businessName, email) {
  const rows = await db('cbrief_distribution_ready_opportunities', 'GET',
    '?select=title,agency_name,solicitation_number,closes_at,scope_summary,description,authoritative_detail_url,city,state'
    + '&status=eq.open&scope_summary=not.is.null'
    + `&closes_at=gte.${encodeURIComponent(new Date().toISOString())}`
    + '&order=closes_at.asc.nullslast&limit=50');
  if (!rows?.length) return null;
  const idx = parseInt(hash(businessName.toLowerCase() + '|' + email), 16) % rows.length;
  const row = rows[idx];
  return {
    title: row.title,
    agency_name: row.agency_name,
    solicitation_number: row.solicitation_number,
    response_deadline: row.closes_at,
    scope_summary: row.scope_summary || row.description,
    authoritative_url: row.authoritative_detail_url,
    place_of_performance: [row.city, row.state].filter(Boolean).join(', '),
    state: row.state
  };
}

// Cloned from RFCP-V2 (rfcp.aproposgroupllc.com) netlify/functions/demo-pipeline.js --
// same live SAM.gov Opportunities API search per NAICS code. Repointed to read NAICS
// from boda_vendor_profiles instead of RFCP's demo_snapshots table.
const SAM_OPP_URL = 'https://api.sam.gov/opportunities/v2/search';
const SAM_PAGE_LIMIT = 50;

function mmddyyyy(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();
}
function daysUntil(deadline) {
  if (!deadline) return null;
  return Math.floor((new Date(deadline) - new Date()) / 86400000);
}
function naicsCode(entry) {
  return clean(String(entry ?? '').split(' — ')[0], 20);
}

// Fetches all NAICS codes in parallel with a per-request timeout -- doing
// this sequentially (the original implementation) summed each call's
// latency and could exceed Netlify's function time limit with 8 codes,
// intermittently returning an HTML timeout page instead of JSON. Found live
// during E2E testing.
async function fetchNaicsOpportunities(samKey, naicsCodes, days = 90) {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - days);
  const seen = new Map();

  async function fetchOne(naics) {
    if (!/^\d{6}$/.test(naics)) return;
    try {
      const u = new URL(SAM_OPP_URL);
      u.searchParams.set('api_key', samKey);
      u.searchParams.set('postedFrom', mmddyyyy(from));
      u.searchParams.set('postedTo', mmddyyyy(now));
      u.searchParams.set('ncode', naics);
      u.searchParams.set('limit', String(SAM_PAGE_LIMIT));
      u.searchParams.set('offset', '0');
      const r = await fetch(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const data = await r.json();
      for (const o of (data.opportunitiesData || [])) {
        if (!o.noticeId || seen.has(o.noticeId)) continue;
        const dl = daysUntil(o.responseDeadLine);
        if (dl !== null && dl < 1) continue;
        seen.set(o.noticeId, {
          notice_id: o.noticeId,
          title: clean(o.title, 300),
          agency: clean(o.fullParentPathName, 300),
          naics: clean(o.naicsCode, 20),
          set_aside: clean(o.typeOfSetAsideDescription || o.setAside || 'None', 120),
          posted_date: o.postedDate || null,
          deadline: o.responseDeadLine || null,
          days_left: dl,
          url: o.uiLink || ('https://sam.gov/opp/' + o.noticeId + '/view'),
          state: (o.placeOfPerformance?.state?.code) || null,
          city: (o.placeOfPerformance?.city?.name) || null
        });
      }
    } catch (e) { console.warn('[vendor-presence dashboard] SAM fetch', naics, e?.message); }
  }

  await Promise.all(naicsCodes.slice(0, 8).map(fetchOne));

  return [...seen.values()]
    .filter(o => o.days_left === null || o.days_left >= 1)
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
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
    console.error('vendor-presence db error', table, r.status, data);
    const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
    throw new Error(`Vendor profile data service ${table} ${method} ${r.status}: ${detail.slice(0, 300)}`);
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
  const sessions = await db(
    'boda_vendor_sessions',
    'GET',
    `?select=profile_id,expires_at&token_hash=eq.${encodeURIComponent(hash(raw))}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`
  );
  if (!sessions?.length) return null;
  await db('boda_vendor_sessions','PATCH',
    `?token_hash=eq.${encodeURIComponent(hash(raw))}`,
    { last_used_at: new Date().toISOString() }
  );
  const profiles = await db('boda_vendor_profiles','GET',
    `?select=*&id=eq.${encodeURIComponent(sessions[0].profile_id)}&limit=1`
  );
  return profiles?.[0] || null;
}

async function profileSeed(businessName, claimantEmail) {
  const seed = {
    website:'', city:'', state:'', service_area:'', about:'', uei:'', sam_registration_status:'',
    naics:[], certifications:[], core_capabilities:[], public_contact_email:claimantEmail
  };
  const filter = encodeURIComponent('*' + businessName.replace(/[%*]/g,'') + '*');

  // NAT-CORP-project seed sources (natcorp_business_discovery_candidates,
  // aoie_business_profiles) removed 2026-09-23 when this site's Supabase
  // dependency moved to pwvstaigtdrccirdvqka (the AI4/BDMS/FCP project) --
  // NAT-CORP work is deferred, out of scope here. FCP and BCP now live in
  // the SAME project as boda_vendor_profiles, so these are direct queries
  // instead of the old cross-site vendor-seed-lookup proxy call.

  try {
    const contacts = await db('fcp_contractor_contacts','GET',
      '?select=uei,business_name,contact_email&business_name=ilike.'+filter+'&limit=1');
    const row = contacts?.[0];
    if (row && emailOk(clean(row.contact_email,180)) && !seed.public_contact_email) {
      seed.public_contact_email = clean(row.contact_email,180);
    }
  } catch (e) { console.warn('fcp_contractor_contacts seed unavailable', e?.message); }

  try {
    const matches = await db('cbrief_match_completed','GET',
      '?select=contractor_name,contractor_state,contractor_email,contractor_naics_details&contractor_name=ilike.'+filter+'&order=matched_at.desc&limit=1');
    const row = matches?.[0];
    if (row) {
      if (!seed.state) seed.state = clean(row.contractor_state,80);
      if (emailOk(clean(row.contractor_email,180)) && !seed.public_contact_email) seed.public_contact_email = clean(row.contractor_email,180);
      const details = Array.isArray(row.contractor_naics_details) ? [...row.contractor_naics_details].sort((a,b)=>(b?.primary?1:0)-(a?.primary?1:0)) : [];
      if (!seed.naics.length) seed.naics = details.map(x=>[clean(x?.code),clean(x?.description)].filter(Boolean).join(' — ')).filter(Boolean).slice(0,20);
      if (!seed.core_capabilities.length) seed.core_capabilities = details.map(x=>clean(x?.description)).filter(Boolean).slice(0,20);
    }
  } catch (e) { console.warn('cbrief_match_completed seed unavailable', e?.message); }

  try {
    const sam = await db('sam_active_contractors','GET',
      '?select=uei,legal_name,city,registration_status,business_types,naics_details&legal_name=ilike.'+filter+'&limit=1');
    const row = sam?.[0];
    if (row) {
      if (!seed.city) seed.city = clean(row.city,120);
      if (!seed.uei) seed.uei = clean(row.uei,32);
      if (!seed.sam_registration_status) seed.sam_registration_status = clean(row.registration_status,60);
      const types = Array.isArray(row.business_types) ? row.business_types.map(x=>clean(x,80)).filter(Boolean) : [];
      if (!seed.certifications.length && types.length) seed.certifications = types.slice(0,20);
      if (!seed.core_capabilities.length) {
        const details = Array.isArray(row.naics_details) ? row.naics_details : [];
        const descs = details.map(x=>clean(x?.description)).filter(Boolean).slice(0,20);
        if (descs.length) seed.core_capabilities = descs;
      }
    }
  } catch (e) { console.warn('sam_active_contractors seed unavailable', e?.message); }

  try {
    const outreach = await db('fcp_outreach','GET',
      '?select=business_name,contact_name,contact_email&business_name=ilike.'+filter+'&order=created_at.desc&limit=1');
    const row = outreach?.[0];
    if (row && emailOk(clean(row.contact_email,180)) && !seed.public_contact_email) {
      seed.public_contact_email = clean(row.contact_email,180);
    }
  } catch (e) { console.warn('fcp_outreach seed unavailable', e?.message); }

  return seed;
}

async function findOrCreateProfile({ businessName, claimId, claimantEmail, publishOnCreate = false, opportunity = null, contractorType = null }) {
  // PostgREST's or=() combinator can't handle a raw comma inside a filter
  // value (common in real business names, e.g. "Precision Grade, Inc."),
  // so this is two plain queries instead of one or=(...) query.
  const nameFilter = encodeURIComponent(businessName.replace(/[%*]/g, ''));
  let existing = await db('boda_vendor_profiles', 'GET',
    `?select=*&business_name=ilike.${nameFilter}&limit=1`);
  if (!existing?.length) {
    existing = await db('boda_vendor_profiles', 'GET',
      `?select=*&owner_email=eq.${encodeURIComponent(claimantEmail)}&limit=1`);
  }
  if (existing?.length) {
    let profile = existing[0];
    if (opportunity || contractorType) {
      const patch = { updated_at: new Date().toISOString() };
      if (opportunity) patch.claimed_opportunity = opportunity;
      if (contractorType) patch.contractor_type = contractorType;
      const rows = await db('boda_vendor_profiles', 'PATCH',
        `?id=eq.${encodeURIComponent(profile.id)}`,
        patch,
        'return=representation');
      if (rows?.[0]) profile = rows[0];
    }
    return { profile, created: false };
  }

  const slug = await uniqueSlug(businessName);
  const seed = await profileSeed(businessName, claimantEmail);
  const rows = await db('boda_vendor_profiles', 'POST', '', [{
    claim_id: claimId,
    business_name: businessName,
    slug,
    owner_email: claimantEmail,
    public_contact_email: seed.public_contact_email || claimantEmail,
    headline: 'Tell customers what your business does best.',
    about: seed.about || '',
    website: seed.website || '',
    city: seed.city || '',
    state: seed.state || '',
    is_published: publishOnCreate,
    uei: seed.uei || '',
    sam_registration_status: seed.sam_registration_status || '',
    service_area: seed.service_area || '',
    core_capabilities: seed.core_capabilities || [],
    products_services: [],
    past_performance: [],
    certifications: seed.certifications || [],
    naics: seed.naics || [],
    claimed_opportunity: opportunity,
    contractor_type: contractorType
  }], 'return=representation');
  return { profile: rows?.[0], created: true };
}

async function uniqueSlug(name) {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${String(i + 1)}`;
    const rows = await db('boda_vendor_profiles','GET',
      `?select=id&slug=eq.${encodeURIComponent(candidate)}&limit=1`);
    if (!rows?.length) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function sendVerification({ businessName, claimantName, email, rawToken }) {
  const apiKey = Netlify.env.get('RESEND_API_KEY');
  const from = Netlify.env.get('RESEND_FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Verification email service is unavailable.');
  const origin = 'https://aproposopportunity.org';
  const verifyUrl = `${origin}/api/vendor-presence?action=verify&token=${encodeURIComponent(rawToken)}`;
  const subject = `Verify your business claim — ${businessName}`;
  const html = `
  <div style="font-family:Arial,sans-serif;color:#14233a;max-width:640px;margin:auto">
    <div style="background:#081a31;color:white;padding:28px;border-bottom:4px solid #c7a75a">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#ead9a5">Business Opportunity Development Agency</div>
      <h1 style="font-family:Georgia,serif;font-weight:500;margin:10px 0 0">Verify your business claim</h1>
    </div>
    <div style="padding:28px;border:1px solid #d6e1e9;border-top:0;background:#f8fcff">
      <p>Hello ${claimantName.replace(/[<>&]/g,'')},</p>
      <p>A claim was submitted for <strong>${businessName.replace(/[<>&]/g,'')}</strong>.</p>
      <p>Only an authorized representative of the business can edit its Business Opportunity Development Agency Vendor Page.</p>
      <p style="margin:26px 0"><a href="${verifyUrl}" style="display:inline-block;background:#c7a75a;color:#081a31;padding:13px 20px;text-decoration:none;font-weight:700">Verify Business Claim</a></p>
      <p style="font-size:12px;color:#657489">This verification link expires in 30 minutes. If you did not submit this claim, no action is required.</p>
    </div>
    <p style="font-size:11px;color:#718094">Business Opportunity Development Agency<br>A property of Apropos Group LLC</p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' },
    body:JSON.stringify({ from, to:[email], subject, html })
  });
  if (!r.ok) {
    console.error('vendor claim email failed', r.status, await r.text());
    throw new Error('Verification email could not be sent.');
  }
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const action = clean(url.searchParams.get('action'), 50);

    if (req.method === 'GET' && action === 'verify') {
      const raw = clean(url.searchParams.get('token'), 200);
      if (!raw) return new Response(null,{status:302,headers:{location:'/vendor-claim?status=invalid'}});
      const claims = await db('boda_vendor_claims','GET',
        `?select=*&verification_token_hash=eq.${encodeURIComponent(hash(raw))}&status=eq.PENDING&verification_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
      if (!claims?.length) return new Response(null,{status:302,headers:{location:'/vendor-claim?status=expired'}});
      const claim = claims[0];

      let profile;
      if (claim.profile_id) {
        const rows = await db('boda_vendor_profiles','GET',`?select=*&id=eq.${encodeURIComponent(claim.profile_id)}&limit=1`);
        profile = rows?.[0];
      }
      if (!profile) {
        ({ profile } = await findOrCreateProfile({
          businessName: claim.business_name,
          claimId: claim.id,
          claimantEmail: claim.claimant_email
        }));
      }
      await db('boda_vendor_claims','PATCH',`?id=eq.${encodeURIComponent(claim.id)}`,{
        status:'VERIFIED', verified_at:new Date().toISOString(),
        profile_id:profile.id, updated_at:new Date().toISOString(),
        verification_token_hash:null
      });

      const rawSession = token();
      await db('boda_vendor_sessions','POST','',[{
        profile_id:profile.id,
        token_hash:hash(rawSession),
        expires_at:new Date(Date.now()+1000*60*60*24*30).toISOString()
      }]);
      return new Response(null,{
        status:302,
        headers:{
          location:'/vendor-workspace?verified=1',
          'set-cookie':`boda_vendor_session=${encodeURIComponent(rawSession)}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`
        }
      });
    }

    if (req.method === 'GET' && action === 'profile') {
      const profile = await sessionProfile(req);
      return profile ? json({ok:true,profile}) : json({ok:false,error:'Session required.'},401);
    }

    if (req.method === 'GET' && action === 'dashboard') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ok:false,error:'Session required.'},401);

      // Null contractor_type predates this column (all federal test data
      // from earlier tonight) -- default to federal so nothing that already
      // worked changes behavior.
      const contractorType = profile.contractor_type === 'licensed' ? 'licensed' : 'federal';
      const naicsCodes = Array.isArray(profile.naics)
        ? [...new Set(profile.naics.map(naicsCode).filter(Boolean))]
        : [];

      let opportunities = [];
      if (contractorType === 'federal') {
        const samKey = Netlify.env.get('SAM_API_KEY');
        if (samKey && naicsCodes.length) {
          try { opportunities = await fetchNaicsOpportunities(samKey, naicsCodes); }
          catch (e) { console.error('[vendor-presence dashboard] opportunity fetch failed', e?.message); }
        }
      }
      // Licensed Business contractors get no auto-populated list here --
      // there is no unified state/local API to match against. They search
      // for their own additional matches on /vendor-licensed-search
      // (Industry -> Service Category -> Work Type, same pattern as BDMS's
      // Advisor Contract Search Portal).

      return json({
        ok: true,
        profile: {
          business_name: profile.business_name,
          slug: profile.slug,
          city: profile.city,
          state: profile.state,
          uei: profile.uei,
          sam_registration_status: profile.sam_registration_status,
          naics: naicsCodes,
          certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
          contractor_type: contractorType
        },
        complimentary: profile.claimed_opportunity || null,
        opportunities
      });
    }

    if (req.method === 'POST' && action === 'survey') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ok:false,error:'Session required.'},401);
      const input = await req.json().catch(()=>({}));
      const rating = Number(input.rating);
      const comment = clean(input.comment, 2000);
      const surveyAction = clean(input.action, 40);
      await db('boda_vendor_surveys','POST','',[{
        profile_id: profile.id,
        business_name: profile.business_name,
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        comment,
        action: surveyAction || null
      }], 'return=minimal');
      return json({ok:true});
    }

    if (req.method === 'POST' && action === 'authorize-registry') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ok:false,error:'Session required.'},401);
      await db('boda_vendor_profiles','PATCH',`?id=eq.${encodeURIComponent(profile.id)}`,{
        registry_consent_at: new Date().toISOString(), updated_at: new Date().toISOString()
      },'return=minimal');
      return json({ok:true});
    }

    if (req.method === 'GET' && action === 'survey-list') {
      const key = clean(url.searchParams.get('key'), 100);
      const adminKey = Netlify.env.get('VENDOR_SURVEY_ADMIN_KEY');
      if (!adminKey || key !== adminKey) return json({ok:false,error:'Not authorized.'},401);
      const rows = await db('boda_vendor_surveys','GET',
        '?select=id,business_name,rating,comment,action,is_public,created_at&order=created_at.desc&limit=200');
      return json({ok:true,surveys:rows||[]});
    }

    if (req.method === 'POST' && action === 'survey-mark-public') {
      const key = clean(url.searchParams.get('key'), 100);
      const adminKey = Netlify.env.get('VENDOR_SURVEY_ADMIN_KEY');
      if (!adminKey || key !== adminKey) return json({ok:false,error:'Not authorized.'},401);
      const input = await req.json().catch(()=>({}));
      const id = clean(input.id, 60);
      if (!id) return json({ok:false,error:'id required.'},400);
      await db('boda_vendor_surveys','PATCH',`?id=eq.${encodeURIComponent(id)}`,{
        is_public: input.is_public === true, reviewed_at: new Date().toISOString()
      },'return=minimal');
      return json({ok:true});
    }

    if (req.method === 'GET' && action === 'public') {
      const slug = clean(url.searchParams.get('slug'),100);
      if (!slug) return json({ok:false,error:'Profile not found.'},404);
      const rows = await db('boda_vendor_profiles','GET',
        `?select=business_name,slug,headline,about,logo_url,website,phone,city,state,uei,sam_registration_status,service_area,naics,certifications,core_capabilities,products_services,past_performance,teaming_interests,social_links,capability_statement_url,public_contact_email,customer_cta_label,customer_cta_url,is_published,claimed_opportunity&slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`);
      return rows?.length ? json({ok:true,profile:rows[0]}) : json({ok:false,error:'Profile not found.'},404);
    }

    if (req.method === 'POST' && action === 'submit-claim') {
      const input = await req.json().catch(()=>({}));
      const businessName = clean(input.business_name,180);
      const claimantName = clean(input.claimant_name,140);
      const email = clean(input.claimant_email,180).toLowerCase();
      const source = clean(input.source,80);
      const opportunityRef = clean(input.opportunity_ref,120);
      if (businessName.length < 2 || claimantName.length < 2 || !emailOk(email))
        return json({ok:false,error:'Please complete the business name, your name, and a valid business email.'},400);

      const recent = await db('boda_vendor_claims','GET',
        `?select=id,created_at&claimant_email=eq.${encodeURIComponent(email)}&business_name=eq.${encodeURIComponent(businessName)}&created_at=gt.${encodeURIComponent(new Date(Date.now()-10*60*1000).toISOString())}&limit=1`);
      if (recent?.length) return json({ok:true,message:'A verification email was recently sent. Please check your inbox.'});

      const rawToken = token();
      await db('boda_vendor_claims','POST','',[{
        business_name:businessName,
        claimant_name:claimantName,
        claimant_email:email,
        source,
        opportunity_ref:opportunityRef,
        verification_token_hash:hash(rawToken),
        verification_expires_at:new Date(Date.now()+30*60*1000).toISOString()
      }]);
      await sendVerification({businessName,claimantName,email,rawToken});
      return json({ok:true,message:'Check your business email to verify your claim.'});
    }

    // Called by claim-opportunity.html immediately after a contract claim
    // succeeds on FCP/BCP -- that claim already verified the business email
    // against the original outreach record (email + Opportunity Reference
    // must match), so this skips the separate magic-link round trip and
    // provisions the Vendor Page directly. Silent/best-effort by design:
    // the contract claim itself is the thing that must not fail.
    if (req.method === 'POST' && action === 'auto-claim') {
      const input = await req.json().catch(()=>({}));
      const businessName = clean(input.business_name,180);
      const claimantName = clean(input.claimant_name,140);
      const email = clean(input.claimant_email,180).toLowerCase();
      const source = clean(input.source,80);
      const opportunityRef = clean(input.opportunity_ref,120);
      let opportunity = cleanOpportunity(input.opportunity);
      // source is 'contract_claim:federal' or 'contract_claim:state-local'
      // (set client-side in claim-opportunity.html from the claim reference
      // prefix: NG- federal, AP- state-local). Federal contractors get the
      // live SAM.gov dashboard feed; state-local ("Licensed Business")
      // contractors get the self-serve taxonomy search instead -- there is
      // no unified API to auto-match them against.
      const contractorType = /state-local/.test(source) ? 'licensed' : (/federal/.test(source) ? 'federal' : null);
      if (businessName.length < 2 || claimantName.length < 2 || !emailOk(email))
        return json({ok:false,error:'Business name, claimant name, and a valid email are required.'},400);

      if (!opportunity && contractorType === 'licensed') {
        try { opportunity = await fallbackComplimentaryFromRepository(businessName, email); }
        catch (e) { console.error('[vendor-presence auto-claim] repository fallback failed', e?.message); }
      }

      const claimRows = await db('boda_vendor_claims','POST','',[{
        business_name:businessName,
        claimant_name:claimantName,
        claimant_email:email,
        source: source || 'auto:contract_claim',
        opportunity_ref:opportunityRef,
        status:'VERIFIED',
        verified_at:new Date().toISOString(),
        verification_token_hash:null,
        verification_expires_at:null
      }], 'return=representation');
      const claim = claimRows?.[0];

      const { profile, created } = await findOrCreateProfile({
        businessName, claimId: claim?.id || null, claimantEmail: email, publishOnCreate: true, opportunity, contractorType
      });
      if (!profile) return json({ok:false,error:'Vendor Page could not be provisioned.'},500);

      if (claim && !profile.claim_id) {
        await db('boda_vendor_claims','PATCH',`?id=eq.${encodeURIComponent(claim.id)}`,
          {profile_id:profile.id,updated_at:new Date().toISOString()},'return=minimal');
      }

      const rawSession = token();
      await db('boda_vendor_sessions','POST','',[{
        profile_id:profile.id,
        token_hash:hash(rawSession),
        expires_at:new Date(Date.now()+1000*60*60*24*30).toISOString()
      }]);
      return json({ok:true,profile:{business_name:profile.business_name,slug:profile.slug},created},200,{
        'set-cookie':`boda_vendor_session=${encodeURIComponent(rawSession)}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`
      });
    }

    if (req.method === 'POST' && action === 'save') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ok:false,error:'Session required.'},401);
      const input = await req.json().catch(()=>({}));
      const list = (v,max=20) => Array.isArray(v) ? v.map(x=>clean(x,220)).filter(Boolean).slice(0,max) : [];
      const object = v => v && typeof v==='object' && !Array.isArray(v) ? v : {};
      const patch = {
        business_name:clean(input.business_name,180) || profile.business_name,
        headline:clean(input.headline,220),
        about:clean(input.about,4000),
        logo_url:clean(input.logo_url,1000),
        website:clean(input.website,1000),
        phone:clean(input.phone,80),
        city:clean(input.city,120),
        state:clean(input.state,80),
        service_area:clean(input.service_area,200),
        naics:list(input.naics,20),
        certifications:list(input.certifications,30),
        core_capabilities:list(input.core_capabilities,20),
        products_services:list(input.products_services,20),
        past_performance:Array.isArray(input.past_performance) ? input.past_performance.slice(0,12) : [],
        teaming_interests:clean(input.teaming_interests,2000),
        social_links:object(input.social_links),
        capability_statement_url:clean(input.capability_statement_url,1000),
        public_contact_email:emailOk(clean(input.public_contact_email,180)) ? clean(input.public_contact_email,180) : profile.public_contact_email,
        customer_cta_label:clean(input.customer_cta_label,80) || 'Contact This Business',
        customer_cta_url:clean(input.customer_cta_url,1000),
        updated_at:new Date().toISOString()
      };
      const rows = await db('boda_vendor_profiles','PATCH',
        `?id=eq.${encodeURIComponent(profile.id)}`,patch,'return=representation');
      return json({ok:true,profile:rows?.[0]||{...profile,...patch}});
    }

    if (req.method === 'POST' && action === 'publish') {
      const profile = await sessionProfile(req);
      if (!profile) return json({ok:false,error:'Session required.'},401);
      const next = !profile.is_published;
      const rows = await db('boda_vendor_profiles','PATCH',
        `?id=eq.${encodeURIComponent(profile.id)}`,
        {is_published:next,updated_at:new Date().toISOString()},'return=representation');
      return json({ok:true,profile:rows?.[0]||{...profile,is_published:next}});
    }

    if (req.method === 'POST' && action === 'logout') {
      const raw = cookieToken(req);
      if (raw) await db('boda_vendor_sessions','DELETE',`?token_hash=eq.${encodeURIComponent(hash(raw))}`);
      return json({ok:true},200,{
        'set-cookie':'boda_vendor_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'
      });
    }

    return json({ok:false,error:'Unsupported vendor profile request.'},404);
  } catch (err) {
    console.error('vendor-presence error', err);
    return json({ok:false,error:err?.message || 'Vendor profile service unavailable.'},500);
  }
};

export const config = { path: '/api/vendor-presence' };
