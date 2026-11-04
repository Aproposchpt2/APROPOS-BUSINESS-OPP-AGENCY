# AGENT 001 — BODA Transformation: Development Audit and Handoff
Date: 2026-11-04
Status: DEVELOPMENT ONLY; production deployment not authorized.

## Verified source observations
- Repository default branch: main. Static root index.html homepage.
- netlify.toml publishes repository root, runs node scripts/validate-entity-classification.cjs, and injects contact content through contact-inject edge function at / and /index.html.
- Legacy homepage had procurement-centered SEO, structured data and canonical URLs using aproposopportunity.org.
- netlify.toml retains vendor, opportunity, marketing, roadmap, funding and administrative routes with privacy/noindex rules for selected workspaces.
- assets/boda-impact-monitor.js fetches aggregate outreach counts from bcp.aproposgroupllc.com.
- Supabase migrations include boda_claim_codes. No database changes made.

## Implemented on this branch
- Replaced public homepage with responsive black/gold/white STELLAR discovery page.
- Added six STELLAR solution cards, consultation CTA, complimentary BDMS gateway, and formation-service regulatory-review notice.
- Updated homepage title, description, canonical and JSON-LD for boda.aproposgroupllc.com.
- Updated llms.txt to remove procurement-service promotional positioning.
- No changes to Netlify functions, database migrations, legacy HTML routes, or BDMS application.

## Remaining blockers / acceptance checks
1. Inspect all secondary public HTML pages, sitemap.xml, robots.txt, navigation and canonical tags for obsolete promotions. Decide whether legacy service URLs should redirect, be archived, or remain accessible without promotion. Do not remove functional workspaces.
2. Confirm canonical-domain policy for aproposopportunity.org versus boda.aproposgroupllc.com before production.
3. Verify contact-inject edge function does not inject obsolete procurement content or break new homepage.
4. Confirm target URLs resolve and product demo/consultation flows function.
5. Coordinate the BDMS destination and public-access status with Agent 002. Do not edit BDMS.
6. Verify Lead Management and Marketing System public positioning before advertising it.
7. Run Netlify build command, accessibility checks, internal-link crawl, responsive browser screenshots at 1440px, 768px, and 390px, and production-like preview tests.
8. Confirm Netlify preview does not index and no production deploy was triggered.

## Testing status
GitHub writes succeeded. No actual Netlify build, browser screenshot, link-check, or preview test has been performed. Do not mark production-ready.

## Rollback
Restore index.html and llms.txt from main; preserve all other files. Never force push main.
