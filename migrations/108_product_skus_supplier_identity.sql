-- @migration 108_product_skus_supplier_identity.sql
-- @domain    catalog
-- @purpose   PDC-8 Lot 4 — identité source stable (supplier_sku) pour la
--            re-promotion, distincte de l'upsert historique product_id +
--            variant_combo (insuffisant pour une source qui corrige son
--            variant_combo tout en gardant le même supplier_sku).
-- @added-header 2026-07-13
-- Idempotent : peut être rejoué sans risque.
--
-- AUDIT PRÉALABLE (obligatoire avant contrainte, cf. PDC-8 §SKU) :
-- product_skus a été créée par 104_product_skus.sql (appliquée 2026-07-12)
-- avec la note explicite « Non consommée par le code applicatif tant que
-- les Lots 1-4 ne sont pas livrés ». Aucun code de production n'écrit
-- encore dans product_skus en dehors des routes admin manuelles
-- (routes/products.js — services/product-admin-service.js:upsertProductSku,
-- gouverné par product_id+variant_combo, jamais par un supplier_sku qui
-- n'existe pas encore). Donc :
--   - aucune ligne existante ne peut être en conflit avec la nouvelle
--     contrainte d'unicité (supplier_sku est une colonne neuve, NULL partout
--     à l'application de cette migration) ;
--   - les SKU manuels déjà créés via l'admin restent valides : ils reçoivent
--     source = 'MANUAL' par défaut (backfill immédiat, pas de valeur
--     inventée : c'est un fait vrai, tout SKU existant à ce jour a été créé
--     manuellement puisque le pipeline de promotion n'existe pas encore).
--
-- Vérification recommandée avant d'appliquer en prod (lecture seule) :
--   SELECT count(*) FROM product_skus;  -- attendu : 0 aujourd'hui (Lot 0 confirmé)

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS supplier_sku text;

ALTER TABLE public.product_skus
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE public.product_skus
  DROP CONSTRAINT IF EXISTS chk_product_skus_source;

ALTER TABLE public.product_skus
  ADD CONSTRAINT chk_product_skus_source
  CHECK (source IN ('MANUAL', 'SUPPLIER'));

COMMENT ON COLUMN public.product_skus.supplier_sku IS
  'Identité source stable (NormalizedSupplierProduct V2 sellable_units[].supplier_sku). '
  'NULL pour les SKU manuels (source=MANUAL). Gouverne la re-promotion : un '
  'supplier_sku rejoué conserve TOUJOURS le même product_skus.id, même si '
  'variant_combo change (correction fournisseur). Ne jamais réutiliser '
  'product_id+variant_combo comme identité de re-promotion (insuffisant, '
  'cf. PDC-8 §SKU).';

COMMENT ON COLUMN public.product_skus.source IS
  'MANUAL = créé par un admin via routes/products.js (upsertProductSku). '
  'SUPPLIER = promu depuis normalized_source_contract.sellable_units[] '
  '(PDC-8 Lot 6). Distinction honnête, jamais déduite après coup.';

-- ─────────────────────────────────────────────────────────────────────
--  Identité stable — au plus un SKU par (product_id, supplier_sku) connu.
--  Permet l'upsert idempotent lors d'une re-promotion, y compris quand
--  variant_combo est corrigé par la source (l'identité ne dépend pas
--  du combo).
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_skus_supplier_identity
  ON public.product_skus (product_id, supplier_sku)
  WHERE supplier_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_skus_source
  ON public.product_skus (source);

-- ─────────────────────────────────────────────────────────────────────
-- Vérification post-migration (à lancer manuellement, lecture seule) :
--
--   SELECT source, count(*) FROM product_skus GROUP BY 1;  -- attendu : 100% MANUAL (ou 0 ligne)
--   \d product_skus
-- ─────────────────────────────────────────────────────────────────────
