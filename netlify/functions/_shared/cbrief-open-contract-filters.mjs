// Shared non-taxonomy filter logic for the self-serve Agency Contract
// Search tools. Both agency-contract-search.mjs (the results table) and
// agency-taxonomy-tree.mjs (the category sidebar counts) need to apply the
// exact same keyword/state/agency/closing/posted predicate chain against
// the open-contract repository -- the tree needs it so its per-category
// counts agree with what the search results actually return once a filter
// is active, instead of always reporting unfiltered all-time totals (found
// as a real point of user confusion during the 2026-09-08 VAP: "3 records
// showing but the category shows 10 contracts").
export const asArray = value => Array.isArray(value) ? value : [];
export const clean = value => String(value ?? '').trim();
export const lower = value => clean(value).toLowerCase();
export const dateValue = value => { const d=value?new Date(value):null; return d&&!Number.isNaN(d.valueOf())?d.valueOf():null; };

const STATE_CODES = Object.fromEntries('ALABAMA:AL|ALASKA:AK|ARIZONA:AZ|ARKANSAS:AR|CALIFORNIA:CA|COLORADO:CO|CONNECTICUT:CT|DELAWARE:DE|FLORIDA:FL|GEORGIA:GA|HAWAII:HI|IDAHO:ID|ILLINOIS:IL|INDIANA:IN|IOWA:IA|KANSAS:KS|KENTUCKY:KY|LOUISIANA:LA|MAINE:ME|MARYLAND:MD|MASSACHUSETTS:MA|MICHIGAN:MI|MINNESOTA:MN|MISSISSIPPI:MS|MISSOURI:MO|MONTANA:MT|NEBRASKA:NE|NEVADA:NV|NEW HAMPSHIRE:NH|NEW JERSEY:NJ|NEW MEXICO:NM|NEW YORK:NY|NORTH CAROLINA:NC|NORTH DAKOTA:ND|OHIO:OH|OKLAHOMA:OK|OREGON:OR|PENNSYLVANIA:PA|RHODE ISLAND:RI|SOUTH CAROLINA:SC|SOUTH DAKOTA:SD|TENNESSEE:TN|TEXAS:TX|UTAH:UT|VERMONT:VT|VIRGINIA:VA|WASHINGTON:WA|WEST VIRGINIA:WV|WISCONSIN:WI|WYOMING:WY'.split('|').map(pair => pair.split(':')));
export const normalizeState = value => { const state=clean(value).toUpperCase().replace(/\s+/g,' '); return STATE_CODES[state]||state; };

function searchText(row) {
  return [row.title,row.solicitation_number,row.alternate_id,row.agency_name,row.department_name,row.description,row.scope_summary,
    ...asArray(row.nigp_codes),...asArray(row.psc_codes),...asArray(row.commodity_codes)].filter(Boolean).join(' ').toLowerCase();
}
export function closingCutoff(window){const days=Number(window);return [7,14,30,60,90].includes(days)?Date.now()+days*86400000:null;}
export function postedCutoff(window){const days=Number(window);return [7,14,30,60,90].includes(days)?Date.now()-days*86400000:null;}

// Reads the same non-taxonomy query-string params agency-contract-search.mjs
// accepts (industry/service_category/work_type stay each caller's own
// concern -- the search endpoint gates on them, the tree endpoint is what
// produces them) and returns a normalized filter set.
export function parseNonTaxonomyFilters(searchParams) {
  return {
    q: lower(searchParams.get('q')),
    state: normalizeState(searchParams.get('state')),
    agency: lower(searchParams.get('agency')),
    procurementType: lower(searchParams.get('procurement_type')),
    solicitation: lower(searchParams.get('solicitation')),
    nigp: lower(searchParams.get('nigp')),
    psc: lower(searchParams.get('psc')),
    commodity: lower(searchParams.get('commodity')),
    closing: closingCutoff(searchParams.get('closing')),
    posted: postedCutoff(searchParams.get('posted')),
  };
}

export function applyNonTaxonomyFilters(rows, f) {
  let out = rows;
  if (f.q) out = out.filter(row=>searchText(row).includes(f.q));
  if (f.state) out = out.filter(row=>normalizeState(row.state)===f.state);
  if (f.agency) out = out.filter(row=>lower(row.agency_name)===f.agency);
  if (f.procurementType) out = out.filter(row=>lower(row.opportunity_type)===f.procurementType);
  if (f.solicitation) out = out.filter(row=>lower(row.solicitation_number).includes(f.solicitation)||lower(row.alternate_id).includes(f.solicitation));
  if (f.nigp) out = out.filter(row=>asArray(row.nigp_codes).some(code=>lower(code).includes(f.nigp)));
  if (f.psc) out = out.filter(row=>asArray(row.psc_codes).some(code=>lower(code).includes(f.psc)));
  if (f.commodity) out = out.filter(row=>asArray(row.commodity_codes).some(code=>lower(code).includes(f.commodity)));
  if (f.closing) out = out.filter(row=>{const v=dateValue(row.closes_at);return v!=null&&v>=Date.now()&&v<=f.closing;});
  if (f.posted) out = out.filter(row=>{const v=dateValue(row.posted_at);return v!=null&&v>=f.posted;});
  return out;
}
