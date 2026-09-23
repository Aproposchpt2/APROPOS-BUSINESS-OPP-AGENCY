// Shared dedup logic for the self-serve Agency/Advisor Contract Search tools.
// The same open contract can get discovered independently through multiple
// publishers/platforms; this collapses those into one preferred record per
// underlying opportunity. Extracted out of agency-contract-search.mjs so
// agency-taxonomy-tree.mjs can compute counts (in particular, the "Not Yet
// Categorized" count) against the exact same dedup rules the search results
// use -- two independent copies of this logic would only drift apart.
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const dateValue = value => { const d=value?new Date(value):null; return d&&!Number.isNaN(d.valueOf())?d.valueOf():null; };

function sourceIdentity(row) {
  if (clean(row.publisher_id)) return `publisher:${clean(row.publisher_id)}`;
  try { const host=new URL(row.authoritative_detail_url||row.authoritative_response_url).hostname.toLowerCase(); if(host)return `host:${host}`; } catch {}
  if (clean(row.platform_id)) return `platform:${clean(row.platform_id)}`;
  return `agency:${lower(row.agency_name)}`;
}
function opportunityKey(row) {
  const solicitation=lower(row.solicitation_number||row.alternate_id).replace(/[^a-z0-9]+/g,'');
  return solicitation ? `${sourceIdentity(row)}|solicitation:${solicitation}` : `id:${clean(row.id)}`;
}
function preferredRecord(current,candidate,assignedIds) {
  // Taxonomy assignments are keyed to one specific opportunity `id`, but the
  // taxonomy backfill ran once (2026-09-07) against whichever duplicate
  // existed at that moment. A later re-discovery of the same underlying
  // opportunity (fresher last_verified_at, different id, same publisher +
  // solicitation) has no assignment of its own -- if dedup picked purely on
  // recency it would silently orphan a real classification, showing up as a
  // spurious "Not Yet Categorized" / undercounted category (found live
  // during the 2026-09-08 final sweep: IT category tree said 84, the actual
  // filtered search returned 88, off by exactly the number of assignment-
  // holding records a fresher unassigned sibling had displaced). Keeping the
  // assignment-holding record takes priority over recency/richness so the
  // classification a contract already has doesn't get orphaned by its own
  // re-discovery.
  if (assignedIds) {
    const currentAssigned=assignedIds.has(clean(current.id));
    const candidateAssigned=assignedIds.has(clean(candidate.id));
    if (currentAssigned!==candidateAssigned) return candidateAssigned?candidate:current;
  }
  const currentVerified=dateValue(current.last_verified_at)??dateValue(current.updated_at)??0;
  const candidateVerified=dateValue(candidate.last_verified_at)??dateValue(candidate.updated_at)??0;
  if(candidateVerified!==currentVerified)return candidateVerified>currentVerified?candidate:current;
  const richness=row=>[row.description,row.scope_summary,row.authoritative_detail_url,row.authoritative_response_url,row.city,row.state,row.closes_at].filter(v=>clean(v)).length;
  if(richness(candidate)!==richness(current))return richness(candidate)>richness(current)?candidate:current;
  return clean(candidate.id).localeCompare(clean(current.id))<0?candidate:current;
}
export function dedupeRows(rows, assignedIds) {
  const unique=new Map();
  for(const row of rows){const key=opportunityKey(row),existing=unique.get(key);unique.set(key,existing?preferredRecord(existing,row,assignedIds):row);}
  return [...unique.values()];
}
