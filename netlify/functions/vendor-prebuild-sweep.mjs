import { db, findOrCreateProfile } from './vendor-presence.mjs';

// Single source of truth for pre-building Vendor Cards. Per Jeff,
// 2026-10-06: SAM.gov is the one contractor inventory -- sam_active_contractors
// -- that both the State/Local (BCP) and Federal (FCP) matching pipelines
// draw from; a business qualifies for all three levels of government
// contracting through this one SAM.gov registration, not once per
// pipeline. "We only need one site to build the vendor cards from that
// table." This replaces the separate automations that previously lived in
// BUSINESS-CONTRACT-PIPELINE and FEDERAL-CONTRACT-PIPELINE (each keyed off
// its own downstream, per-contract-match outreach table) with one sweep
// here, keyed off the actual upstream contractor record.
//
// "The businesses we have email addresses for" (per Jeff) maps exactly to
// sam_active_contractors.email_research_status = 'VERIFIED_EMAIL' -- that
// status already IS Jeff's own email-research pipeline's "this is a real,
// live, confirmed email" gate; no separate email-validity heuristic is
// needed here. has_exclusions excludes SAM-debarred entities. The
// test-marker check is cheap insurance against a stray test row slipping
// into that table (none currently exist there, confirmed 2026-10-06), and
// does NOT exclude Apropos Group LLC by name/domain -- per Jeff,
// 2026-10-06: "Apropos definitely should have a card."
const TEST_CONTACT_MARKER = /(^|[._-])(test|retest\d*|walkthrough|demo|sample|example)([._-]|$)/i;

async function sweep() {
  const rows = await db(
    'sam_active_contractors',
    'GET',
    "?select=legal_name,email_address&email_research_status=eq.VERIFIED_EMAIL&has_exclusions=not.is.true&order=updated_at.asc&limit=1000"
  );
  let built = 0;
  for (const row of rows || []) {
    try {
      const businessName = String(row.legal_name || '').trim();
      const claimantEmail = String(row.email_address || '').trim().toLowerCase();
      if (!businessName || !claimantEmail) continue;
      const [localPart] = claimantEmail.split('@');
      if (TEST_CONTACT_MARKER.test(localPart || '')) continue;
      const { created } = await findOrCreateProfile({ businessName, claimantEmail, publishOnCreate: true });
      if (created) built += 1;
    } catch (e) {
      console.warn('vendor-prebuild-sweep: row failed (non-fatal)', e?.message);
    }
  }
  console.log(`vendor-prebuild-sweep: processed ${rows?.length || 0} verified-email contractors, built ${built} new profiles`);
  return built;
}

export default async () => {
  await sweep();
  return new Response(null, { status: 200 });
};

export const config = { schedule: '0 * * * *' };
