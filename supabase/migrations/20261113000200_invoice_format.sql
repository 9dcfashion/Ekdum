-- ════════════════════════════════════════════════════════════════════════════
-- EkDum · 12 · Invoice header and signature line
-- ════════════════════════════════════════════════════════════════════════════
-- The bill format shopkeepers already use carries a "what we deal in" line under
-- the shop name (e.g. "Wholesale Dealer in: Stone Settled Exclusive Fancy
-- Jewellery") and signs off with a title such as "Proprietor" or "Partner".

alter table public.businesses
  add column if not exists invoice_tagline text
    check (invoice_tagline is null or length(invoice_tagline) <= 120),
  add column if not exists signatory_label text not null default 'Authorised Signatory'
    check (length(trim(signatory_label)) between 1 and 40);
