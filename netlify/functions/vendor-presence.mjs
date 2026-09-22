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
    throw new Error('Vendor profile data service request failed.');
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
    website:'', city:'', state:'', service_area:'', about:'',
    naics:[], certifications:[], core_capabilities:[], public_contact_email:claimantEmail
  };
  const filter = encodeURIComponent('*' + businessName.replace(/[%*]/g,'') + '*');
  try {
    const federal = await db('ngcc_contractor_candidates','GET',
      '?select=business_name,city,state,registered_naics,business_classifications,official_website_url,contact_email,capability_verification&business_name=ilike.'+filter+'&order=updated_at.desc&limit=1');
    const row = federal?.[0];
    if (row) {
      seed.website = clean(row.official_website_url,1000);
      seed.city = clean(row.city,120);
      seed.state = clean(row.state,80);
      seed.naics = Array.isArray(row.registered_naics) ? row.registered_naics.map(x=>{
        if (typeof x === 'string') return clean(x,120);
        if (x && typeof x === 'object') {
          const code = clean(x.naics_code || x.code,20);
          const description = clean(x.description || x.title,100);
          return [code, description].filter(Boolean).join(' — ');
        }
        return '';
      }).filter(Boolean).slice(0,20) : [];
      seed.certifications = Array.isArray(row.business_classifications) ? row.business_classifications.map(x=>{
        if (typeof x === 'string') return clean(x,120);
        if (x && typeof x === 'object') return clean(x.name || x.classification || x.description,120);
        return '';
      }).filter(Boolean).slice(0,30) : [];
      if (emailOk(clean(row.contact_email,180))) seed.public_contact_email = clean(row.contact_email,180);
      const cv = row.capability_verification;
      if (cv && typeof cv === 'object') {
        const possible = cv.capabilities || cv.verified_capabilities || cv.services || [];
        if (Array.isArray(possible)) seed.core_capabilities = possible.map(x=>clean(typeof x==='string'?x:(x?.name||x?.capability||''),220)).filter(Boolean).slice(0,20);
      }
    }
  } catch (e) { console.warn('federal profile seed unavailable', e?.message); }

  try {
    const local = await db('natcorp_business_discovery_candidates','GET',
      '?select=business_name,website,location,capability_evidence,contact_email&business_name=ilike.'+filter+'&order=updated_at.desc&limit=1');
    const row = local?.[0];
    if (row) {
      if (!seed.website) seed.website = clean(row.website,1000);
      if (!seed.service_area) seed.service_area = clean(row.location,200);
      if (emailOk(clean(row.contact_email,180)) && !seed.public_contact_email) seed.public_contact_email = clean(row.contact_email,180);
      const ev = row.capability_evidence;
      if (!seed.core_capabilities.length && Array.isArray(ev)) seed.core_capabilities = ev.map(x=>clean(typeof x==='string'?x:(x?.name||x?.capability||''),220)).filter(Boolean).slice(0,20);
    }
  } catch (e) { console.warn('state-local profile seed unavailable', e?.message); }

  try {
    const aoie = await db('aoie_business_profiles','GET',
      '?select=legal_business_name,business_description,website,primary_location,service_territory&legal_business_name=ilike.'+filter+'&order=updated_at.desc&limit=1');
    const row = aoie?.[0];
    if (row) {
      if (!seed.about) seed.about = clean(row.business_description,4000);
      if (!seed.website) seed.website = clean(row.website,1000);
      if (row.primary_location && typeof row.primary_location==='object') {
        if (!seed.city) seed.city = clean(row.primary_location.city,120);
        if (!seed.state) seed.state = clean(row.primary_location.state,80);
      }
      if (!seed.service_area && row.service_territory) seed.service_area = clean(
        typeof row.service_territory==='string' ? row.service_territory : JSON.stringify(row.service_territory),200);
    }
  } catch (e) { console.warn('business profile seed unavailable', e?.message); }

  // FCP (fcp_contractor_contacts) and BCP (cbrief_match_completed) both live
  // in a different Supabase project than boda_vendor_profiles, so this calls
  // a small read-only endpoint FCP already exposes with its own service_role
  // credentials for that project, rather than minting new credentials here.
  try {
    const seedKey = Netlify.env.get('VENDOR_SEED_SHARED_SECRET');
    if (seedKey) {
      const r = await fetch(
        'https://fcp.aproposgroupllc.com/.netlify/functions/vendor-seed-lookup?business=' + encodeURIComponent(businessName),
        { headers: { 'x-aboa-seed-key': seedKey } }
      );
      if (r.ok) {
        const d = await r.json().catch(() => null);
        const row = d?.found ? d.seed : null;
        if (row) {
          if (!seed.state) seed.state = clean(row.state,80);
          if (!seed.naics.length && Array.isArray(row.naics)) seed.naics = row.naics.map(x=>clean(x,120)).filter(Boolean).slice(0,20);
          if (!seed.core_capabilities.length && Array.isArray(row.core_capabilities)) seed.core_capabilities = row.core_capabilities.map(x=>clean(x,220)).filter(Boolean).slice(0,20);
          if (!seed.public_contact_email && emailOk(clean(row.public_contact_email,180))) seed.public_contact_email = clean(row.public_contact_email,180);
        }
      }
    }
  } catch (e) { console.warn('FCP/BCP vendor seed lookup unavailable', e?.message); }

  return seed;
}

async function findOrCreateProfile({ businessName, claimId, claimantEmail }) {
  const nameFilter = encodeURIComponent(businessName.replace(/[%*]/g, ''));
  const existing = await db('boda_vendor_profiles', 'GET',
    `?select=*&or=(business_name.ilike.${nameFilter},owner_email.eq.${encodeURIComponent(claimantEmail)})&limit=1`);
  if (existing?.length) return { profile: existing[0], created: false };

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
    service_area: seed.service_area || '',
    core_capabilities: seed.core_capabilities || [],
    products_services: [],
    past_performance: [],
    certifications: seed.certifications || [],
    naics: seed.naics || []
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

    if (req.method === 'GET' && action === 'public') {
      const slug = clean(url.searchParams.get('slug'),100);
      if (!slug) return json({ok:false,error:'Profile not found.'},404);
      const rows = await db('boda_vendor_profiles','GET',
        `?select=business_name,slug,headline,about,logo_url,website,phone,city,state,service_area,naics,certifications,core_capabilities,products_services,past_performance,teaming_interests,social_links,capability_statement_url,public_contact_email,customer_cta_label,customer_cta_url,is_published&slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`);
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
      if (businessName.length < 2 || claimantName.length < 2 || !emailOk(email))
        return json({ok:false,error:'Business name, claimant name, and a valid email are required.'},400);

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
        businessName, claimId: claim?.id || null, claimantEmail: email
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
