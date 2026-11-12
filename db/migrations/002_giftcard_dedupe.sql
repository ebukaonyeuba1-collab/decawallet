-- Prevent the same gift card code from being submitted twice (keyed hash, never the code itself).
alter table gift_card_submissions add column code_hash text;
create unique index gift_card_code_unique_idx on gift_card_submissions (brand, code_hash)
  where code_hash is not null and status <> 'rejected';
