-- @migration 350_boutique_cable_and_usb_port_terms.sql
-- @domain catalog
-- @purpose Reusable commercial object terms for AliExpress cable organizers and USB-C port covers.
-- Scope: boutique taxonomy only; no customs, publication, supplier mapping or candidate mutation.
-- Schema-only CI snapshots may have no active boutique rows yet.
-- On such databases this migration must be an idempotent no-op, not prevent
-- bootstrap. On configured markets it enriches only ACTIVE destination pairs.
-- A separate staging audit is responsible for proving real coverage.
UPDATE boutique_subcategories SET object_classification_terms =
  object_classification_terms || '{
    "cable organizer":12,
    "cable management":12,
    "wire holder":12,
    "cord holder":12,
    "wire ties":12
  }'::jsonb
WHERE category_key='Tech' AND key='Audio' AND is_active=TRUE
  AND EXISTS (SELECT 1 FROM boutique_categories bc
              WHERE bc.key='Tech' AND bc.is_active=TRUE);

UPDATE boutique_subcategories SET object_classification_terms =
  object_classification_terms || '{
    "usb c dust plug":12,
    "usb c plug cover":12,
    "charging port cover":12
  }'::jsonb
WHERE category_key='Tech' AND key='Phones' AND is_active=TRUE
  AND EXISTS (SELECT 1 FROM boutique_categories bc
              WHERE bc.key='Tech' AND bc.is_active=TRUE);
