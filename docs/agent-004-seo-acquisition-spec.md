# Agent 004 — SEO and Acquisition Specification (DRAFT)
Status: research/development only; no production authorization.
Owner: Apropos Group LLC. Coordination: Agent 001 owns BODA public pages; Agent 002 owns BDMS access; Agent 003 owns acquisition campaigns.

## Initial findings (2026-11-04)
- Public fetch of BODA returned HTTP 502; verify with browser, deployment logs and independent uptime check before declaring outage.
- Search-visible BDMS homepage still references advisor name, agency and promo code. Agent 002 is assigned to remove public gates.
- Search-visible stellaruc.com copy still references the earlier STELLAR INTELLIGENT TECHNOLOGIES name. Coordinate with the STELLAR site owner; do not change it here.
- No analytics deployment or Search Console access verified yet. Index coverage, canonical, robots, sitemap, CWV and broken-link checks are pending.

## Search intent clusters and landing pages
1. Free federal government contract opportunities → BODA /government-contracts → BDMS.
2. State procurement and bid opportunities → BODA /state-contracts → BDMS.
3. Small business growth and procurement readiness → BODA /resources.
4. Custom business operating systems, business automation and intelligent workflows → BODA /intelligent-business-systems → STELLAR.
5. AI customer support, automated sales and lead management → educational BODA content → relevant STELLAR product pages.
Routes above are PROPOSALS, not confirmed existing pages. No unsupported volume/rank estimates.

## SEO implementation requirements for Agent 001
- Unique, intent-matched title, H1 and meta description on every indexable page; stable canonical HTTPS URL.
- Sitemap containing only canonical, indexable 200 URLs; robots.txt referencing sitemap; no accidental noindex.
- Organization and WebSite JSON-LD with accurate identity; BreadcrumbList only where visible breadcrumb navigation exists; avoid unsupported ratings or FAQ rich-result promises.
- Human-readable internal links: BODA to BDMS and STELLAR; BDMS back to BODA where appropriate.
- Responsive mobile layouts, accessible navigation, descriptive anchor text, optimized assets and sensible Core Web Vitals.
- Audit 404s, redirect chains, duplicate pages and mixed content. Preserve Agent 001 ownership of public-facing files.

## Event contract (proposal)
Event names: page_view, boda_to_bdms_click, bdms_search_started, bdms_search_completed, bdms_result_opened, bdms_to_boda_click, stellar_product_click, consultation_click, consultation_booked, inquiry_submitted, lead_qualified, customer_acquired.
Common fields: event_id, occurred_at_utc, anonymous_session_id, first_touch_source, first_touch_medium, first_touch_campaign, landing_page, page_location, destination_url, consent_status.
Optional fields: product_slug, opportunity_source, search_filters_count, lead_id (server-side only), qualification_status, acquisition_value_usd.
No names, emails, phone numbers, search text with PII, or government identifiers in analytics events. Deduplicate server-side outcomes by event_id; respect consent and retention requirements.
Use UTM parameters on campaign inbound links; capture original UTMs once and retain first-touch and latest-touch separately. Across BODA/BDMS/STELLAR, configure GA4 cross-domain measurement or an equivalent privacy-aware first-party attribution design; verify self-referral exclusion. Never assume UTM alone preserves sessions.

## KPI definitions
- Website traffic: distinct active users and sessions by hostname, source/medium and landing page.
- Contract portal referrals: distinct outbound BODA→BDMS click sessions, plus independently confirmed BDMS arrivals.
- STELLAR referrals: distinct BODA→STELLAR click sessions, plus independently confirmed STELLAR arrivals.
- Consultation conversion rate: confirmed bookings / eligible landing sessions; click-through separately reported.
- Qualified leads: unique CRM lead records meeting documented ICP, verified contact and explicit business need.
- Customer acquisitions: unique closed-won CRM customers attributable within agreed lookback window.
- Source engagement: qualified leads and customers by first touch and last non-direct touch; show unattributed separately.
- Never sum raw event counts as unique people; avoid cross-domain double counting.

## Agent 003 campaign handoff
Campaign landing URL must be intent-matched. UTM standard: utm_source, utm_medium, utm_campaign, optional utm_content and utm_term. Lowercase snake_case; maintain campaign registry. Separate free contract opportunity campaigns from intelligent systems campaigns. Never require lead forms before free BDMS searches. Use tagged campaign links to BODA and instrument subsequent BDMS and STELLAR transitions.

## Executive dashboard
Date-range selector; hostname and source filters. KPI cards: sessions, engaged sessions, BDMS confirmed arrivals, STELLAR confirmed arrivals, confirmed consultations, qualified leads, closed-won customers. Funnel: BODA landing→BDMS/STELLAR referral→consultation→qualified lead→customer. Source table with sessions, engaged sessions, consultations, qualified leads and customers. Display missing-data coverage and freshness; no fake numbers.

## Content backlog
- How to find and verify federal contract opportunities.
- State procurement searches: agency portals and solicitation deadlines.
- Small business bid-readiness checklist.
- Preparing customer communications for growth.
- How intelligent systems handle predictable operations.
- Designing custom workflows with human approvals.
- After-hours lead capture and support coordination.
Each relevant educational article closes exactly:
Discover why businesses are choosing Intelligent Technology.
https://stellaruc.com

## Validation and release gates
[ ] Verify BODA availability independently.
[ ] Inspect route inventory, rendered titles, descriptions, canonicals, robots and XML sitemap.
[ ] Validate indexing in Search Console and Bing Webmaster Tools, not by search snippets alone.
[ ] Test structured data against rendered content.
[ ] Crawl internal/external links and redirects.
[ ] Test mobile usability and performance on representative routes.
[ ] Obtain analytics property IDs and audit existing scripts before proposing new scripts.
[ ] Test consent, PII exclusions, deduplication, UTMs and cross-domain attribution in staging.
[ ] Validate booking completion server-side and lead/customer CRM lifecycle mapping.
[ ] Obtain Agent 001/002/003 coordination sign-off.
[ ] Obtain explicit owner approval before any live script, publishing or production change.
Production readiness: NOT READY — technical audit incomplete, dependencies unresolved, owner approval pending.
