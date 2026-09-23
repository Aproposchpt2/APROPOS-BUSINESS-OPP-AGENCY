// Licensed Business (state/local, non-federal) contract discovery.
//
// Federal contractors get a live SAM.gov feed on the dashboard
// (vendor-presence.mjs action=dashboard, fetchNaicsOpportunities). There is
// no equivalent unified API for state/local procurement, so Licensed
// Business contractors instead get a self-serve taxonomy search --
// Industry -> Service Category -> Work Type, the same interaction pattern
// BDMS's Advisor Contract Search Portal uses (bdms.aproposgroupllc.com,
// agency-contract-search.html / agency-taxonomy-tree.mjs) -- except here the
// CONTRACTOR drives the search directly instead of an advisor searching on
// their behalf. Reads the same cbrief_contract_opportunities data BDMS
// curates: both live in the same Supabase project
// (pwvstaigtdrccirdvqka), so this is a direct read, not a sync/mirror.
//
// Security posture: every row returned here is, by definition, an
// ADDITIONAL match beyond the contractor's one complimentary opportunity
// (which lives on their Vendor Dashboard, sourced separately). Per the
// acquisition-to-subscription funnel spec, additional matches only ever
// show Agency / Category / Status / Deadline -- never solicitation number,
// scope, or official links -- until Vendor Access is unlocked. That
// reduction happens server-side in teaserOpportunity() below, not just in
// the frontend, so there is nothing to unlock by reading the network tab.

import { createHash } from 'node:crypto';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const lower = v => clean(v).toLowerCase();
const dateValue = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.valueOf()) ? d.valueOf() : null; };

function dbConfig() {
  const url = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Contract search service is unavailable.');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbGet(table, query = '') {
  const { url, key } = dbConfig();
  const r = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!r.ok) {
    console.error('vendor-licensed-search db error', table, r.status, data);
    throw new Error(`Contract search service ${table} ${r.status}`);
  }
  return data;
}

function cookieToken(req) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)boda_vendor_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function sessionOk(req) {
  const raw = cookieToken(req);
  if (!raw) return false;
  const hash = createHash('sha256').update(raw).digest('hex');
  const sessions = await dbGet('boda_vendor_sessions',
    `?select=profile_id&token_hash=eq.${encodeURIComponent(hash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  return Boolean(sessions?.length);
}

// ---- Shared dedupe/filter logic, ported unchanged from BDMS's
// Advisor Contract Search Portal (_shared/cbrief-open-contract-*.mjs) ----
import { dedupeRows } from './_shared/cbrief-open-contract-dedupe.mjs';
import { parseNonTaxonomyFilters, applyNonTaxonomyFilters, normalizeState, dateValue as filterDateValue } from './_shared/cbrief-open-contract-filters.mjs';

const DISTRIBUTION_READY_VIEW = 'cbrief_distribution_ready_opportunities';
const TAXONOMY_VERSION = 'gcp_selfserve_taxonomy_v2_2026_09_07';
const UNCATEGORIZED = '__uncategorized__';
const PAGE_SIZE = 1000;
const MAX_RESULT_PAGE_SIZE = 25;

const INDUSTRY_ORDER = [
  'Construction & Public Works','Water, Wastewater & Utilities','Transportation, Roads & Mobility',
  'Architecture, Engineering & Planning','Facilities, Maintenance & Skilled Trades',
  'Information Technology, Software & Digital','Professional, Consulting & Administrative',
  'Health & Medical Services','Human, Housing & Community Services','Public Safety, Security & Emergency',
  'Environmental, Waste & Land Services','Vehicles, Fleet & Heavy Equipment','Goods, Supplies & General Materials',
  'Food, Catering & Concessions','Legal Services','Financial, Insurance & Real Estate',
  'Education, Training & Workforce','Arts, Media, Marketing & Communications','Energy & Power',
  'Records, Document & Information Services','Parks, Recreation & Events','Industrial, Chemical & Laboratory Products'
];
const ALLOWED_INDUSTRIES = new Set(INDUSTRY_ORDER);

const DIRECT_SELECT = [
  'id','publisher_id','platform_id','solicitation_number','alternate_id','title','description','scope_summary',
  'agency_name','department_name','opportunity_type','status','posted_at','closes_at','estimated_value_min',
  'estimated_value_max','city','state','nigp_codes','psc_codes','commodity_codes',
  'authoritative_detail_url','authoritative_response_url','last_verified_at','updated_at'
].join(',');

function directQuery(nowIso) {
  const q = new URLSearchParams({
    select: DIRECT_SELECT,
    status: 'eq.open',
    evidence_status: 'neq.NOT_DISCOVERED',
    requirements_extracted_at: 'not.is.null',
    or: `(closes_at.is.null,closes_at.gte.${nowIso})`,
    order: 'closes_at.asc.nullslast,posted_at.desc'
  });
  return q.toString();
}

async function distributionReadyRows() {
  const { url, key } = dbConfig();
  const nowIso = new Date().toISOString();
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const range = `${from}-${from + PAGE_SIZE - 1}`;
    const r = await fetch(`${url}/rest/v1/${DISTRIBUTION_READY_VIEW}?${directQuery(nowIso)}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json', Range: range },
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) { console.error('[vendor-licensed-search] distribution-ready fetch', r.status); break; }
    const page = await r.json().catch(() => []);
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function taxonomyAssignments({ industry, serviceCategory, workType } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = `?taxonomy_version=eq.${encodeURIComponent(TAXONOMY_VERSION)}&assignment_role=eq.PRIMARY&review_required=eq.false&select=opportunity_id,industry,service_category,work_type`;
    if (industry) q += `&industry=eq.${encodeURIComponent(industry)}`;
    if (serviceCategory) q += `&service_category=eq.${encodeURIComponent(serviceCategory)}`;
    if (workType) q += `&work_type=eq.${encodeURIComponent(workType)}`;
    q += `&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = await dbGet('cbrief_contract_taxonomy_assignments', q);
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildTree(triples) {
  const map = new Map(INDUSTRY_ORDER.map(name => [name, { name, count: 0, service_categories: new Map() }]));
  for (const t of triples) {
    const i = map.get(t.industry); if (!i) continue;
    i.count++;
    if (!i.service_categories.has(t.service_category)) i.service_categories.set(t.service_category, { name: t.service_category, count: 0, work_types: new Map() });
    const s = i.service_categories.get(t.service_category);
    s.count++;
    s.work_types.set(t.work_type, (s.work_types.get(t.work_type) || 0) + 1);
  }
  return INDUSTRY_ORDER.map(name => map.get(name)).map(i => ({
    name: i.name, count: i.count,
    service_categories: [...i.service_categories.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(s => ({
        name: s.name, count: s.count,
        work_types: [...s.work_types.entries()].map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      }))
  }));
}

// Teaser-only mapping -- Agency / Category path / Status / Deadline. Never
// includes solicitation_number, description, scope_summary, or the
// authoritative source links; those stay server-side only.
function teaserOpportunity(row, assignment) {
  const t = assignment || {};
  const daysLeft = (() => {
    const v = filterDateValue(row.closes_at);
    return v == null ? null : Math.ceil((v - Date.now()) / 86400000);
  })();
  return {
    id: row.id,
    agency: row.agency_name || 'Public Agency',
    category_path: [t.industry, t.service_category, t.work_type].filter(Boolean).join(' › ') || 'Not yet categorized',
    status: row.status === 'open' ? 'Open' : (row.status || 'Open'),
    location: [row.city, normalizeState(row.state)].filter(Boolean).join(', ') || null,
    closes_at: row.closes_at || null,
    days_left: daysLeft
  };
}

const tiebreak = (a, b) => clean(a.id).localeCompare(clean(b.id));
function sortRows(rows, sort) {
  if (sort === 'closing_latest') return rows.sort((a, b) => (dateValue(b.closes_at) ?? -Infinity) - (dateValue(a.closes_at) ?? -Infinity) || tiebreak(a, b));
  if (sort === 'newest') return rows.sort((a, b) => (dateValue(b.posted_at) ?? 0) - (dateValue(a.posted_at) ?? 0) || tiebreak(a, b));
  if (sort === 'agency') return rows.sort((a, b) => clean(a.agency_name).localeCompare(clean(b.agency_name)) || tiebreak(a, b));
  return rows.sort((a, b) => (dateValue(a.closes_at) ?? Infinity) - (dateValue(b.closes_at) ?? Infinity) || tiebreak(a, b));
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (!(await sessionOk(req))) return json({ ok: false, error: 'Session required.' }, 401);

    if (req.method === 'GET' && action === 'taxonomy') {
      const filters = parseNonTaxonomyFilters(url.searchParams);
      const [allAssignments, source] = await Promise.all([taxonomyAssignments(), distributionReadyRows()]);
      const validAssignments = allAssignments.filter(r => ALLOWED_INDUSTRIES.has(clean(r.industry)) && clean(r.service_category) && clean(r.work_type));
      const assignmentMap = new Map(allAssignments.map(r => [clean(r.opportunity_id), r]));
      const assignedIds = new Set(validAssignments.map(r => clean(r.opportunity_id)).filter(Boolean));

      const matchingRows = applyNonTaxonomyFilters(dedupeRows(source, assignedIds), filters);
      const categorizedTriples = [];
      let uncategorizedCount = 0;
      for (const row of matchingRows) {
        const a = assignmentMap.get(clean(row.id));
        const industry = clean(a?.industry), service = clean(a?.service_category), work = clean(a?.work_type);
        if (a && ALLOWED_INDUSTRIES.has(industry) && service && work) categorizedTriples.push({ industry, service_category: service, work_type: work });
        else uncategorizedCount++;
      }
      return json({
        ok: true,
        industries: buildTree(categorizedTriples),
        uncategorized: { key: UNCATEGORIZED, name: 'Not Yet Categorized', count: uncategorizedCount }
      });
    }

    if (req.method === 'GET' && action === 'search') {
      const filters = parseNonTaxonomyFilters(url.searchParams);
      const sort = clean(url.searchParams.get('sort')) || 'closing_soonest';
      const page = Math.max(1, Math.min(2000, Number(url.searchParams.get('page')) || 1));
      const pageSize = Math.max(10, Math.min(MAX_RESULT_PAGE_SIZE, Number(url.searchParams.get('page_size')) || 25));
      const industryRaw = clean(url.searchParams.get('industry'));
      const isUncategorized = industryRaw === UNCATEGORIZED;
      const industry = isUncategorized ? '' : industryRaw;
      const serviceCategory = clean(url.searchParams.get('service_category'));
      const workType = clean(url.searchParams.get('work_type'));
      const taxonomyFiltering = Boolean(industry || serviceCategory || workType || isUncategorized);

      const [source, assignmentRows] = await Promise.all([distributionReadyRows(), taxonomyAssignments({ industry, serviceCategory, workType })]);
      const assignmentMap = new Map(assignmentRows.map(a => [clean(a.opportunity_id), a]));
      const assignedIds = new Set(assignmentRows.filter(a => clean(a.service_category) && clean(a.work_type)).map(a => clean(a.opportunity_id)).filter(Boolean));

      let rows;
      if (isUncategorized) rows = dedupeRows(source.filter(row => !assignmentMap.has(clean(row.id))));
      else if (taxonomyFiltering) rows = dedupeRows(source.filter(row => assignmentMap.has(clean(row.id))), assignedIds);
      else rows = dedupeRows(source, assignedIds);
      rows = applyNonTaxonomyFilters(rows, filters);
      sortRows(rows, sort);

      const total = rows.length, start = (page - 1) * pageSize;
      const selected = rows.slice(start, start + pageSize).map(row => teaserOpportunity(row, assignmentMap.get(clean(row.id))));
      const agencies = [...new Set(rows.map(row => clean(row.agency_name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const states = [...new Set(rows.map(row => normalizeState(row.state)).filter(Boolean))].sort();

      return json({
        ok: true, page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)),
        filters: { states, agencies }, opportunities: selected
      });
    }

    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('[vendor-licensed-search]', error);
    return json({ ok: false, error: 'Contract search could not be completed.' }, 500);
  }
}

export const config = { path: '/api/vendor-licensed-search' };
