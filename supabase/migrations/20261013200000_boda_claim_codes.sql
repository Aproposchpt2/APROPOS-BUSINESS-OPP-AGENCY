-- Applied 2026-10-13 to project pwvstaigtdrccirdvqka (email-first claim flow).
create table if not exists public.boda_claim_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  match_id uuid not null references public.bcp_outreach_match_ready(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  claim_token_hash text unique,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists boda_claim_codes_email_created_idx on public.boda_claim_codes (email, created_at desc);
alter table public.boda_claim_codes enable row level security;
revoke all on public.boda_claim_codes from anon, authenticated;
comment on table public.boda_claim_codes is 'One-time email codes for the BODA email-first claim flow (aproposopportunity.org/claim). Service role only.';
