-- @migration 240_supplier_platform_allegro.sql
-- @domain    purchasing
-- @purpose   Ajouter « allegro » à la contrainte suppliers_platform_check.
--
-- Contexte : Allegro est une marketplace officielle (Pologne / Europe de l'Est).
-- Le Golden Sandbox a révélé que la chaîne de création de fournisseur Allegro
-- échoue car la contrainte CHECK ne l'inclut pas.
--
-- Stratégie : DROP + re-ADD de la contrainte dans une seule transaction implicite.
-- Forward-only, pas de destructif, fail-closed conservé.

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_platform_check;

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_platform_check
  CHECK (platform = ANY (ARRAY[
    'noon'::text,
    'amazon_uae'::text,
    'aliexpress'::text,
    'local'::text,
    'whatsapp'::text,
    'allegro'::text
  ]));
