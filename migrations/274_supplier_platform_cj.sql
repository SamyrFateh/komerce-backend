-- @komerce-arch
-- @domain    purchasing
-- @purpose   Ajouter CJ à la contrainte canonique suppliers_platform_check.
-- @safety    DDL additive sur allowlist ; aucune mutation de données.
-- @doctrine  services/suppliers/provider-authority.js

ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_platform_check;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_platform_check
  CHECK (
    platform = ANY (
      ARRAY[
        'noon'::text,
        'amazon_uae'::text,
        'aliexpress'::text,
        'local'::text,
        'whatsapp'::text,
        'allegro'::text,
        'cj'::text
      ]
    )
  );
