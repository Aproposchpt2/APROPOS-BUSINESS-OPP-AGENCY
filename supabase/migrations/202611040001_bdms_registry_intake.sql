-- Temporary website and phone details for pending, email-verified Vendor Cards.
alter table public.boda_vendor_claims
  add column if not exists registry_details jsonb;
