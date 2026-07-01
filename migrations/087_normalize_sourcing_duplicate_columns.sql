-- @migration 087_normalize_sourcing_duplicate_columns.sql
-- @domain    catalog
-- @purpose   Normalisation colonnes doublons sourcing
-- @added-header 2026-07-01 (audit gouvernance)

-- 087_normalize_sourcing_duplicate_columns.sql
-- Lot C5 — Normalisation des colonnes dupliquées sur `products`
-- Source : docs/_work/SOURCING_DB_AUDIT.md (F-01, F-02)
--
-- Contexte :
--   products.cost_kmf / products.cost_price_kmf   (doublon coût)
--   products.weight_kg / products.weight_g        (doublon poids)
-- Source de vérité retenue : cost_kmf et weight_kg (utilisées par pricing-engine,
-- colonnes historiques les plus anciennes).
--
-- Cette migration NE SUPPRIME AUCUNE COLONNE (rollback safe).
-- Elle :
--   1. Backfill cost_kmf depuis cost_price_kmf là où cost_kmf est NULL.
--   2. Backfill weight_kg depuis weight_g là où weight_kg est NULL.
--   3. Annote les colonnes dépréciées via COMMENT ON COLUMN.
--
-- ⚠️ Risque financier — approbation humaine obligatoire avant merge/exécution.
-- Ne pas dropper cost_price_kmf / weight_g avant N jours de stabilité en prod
-- (voir recommandation C5, point 4 de SOURCING_DB_AUDIT.md).

BEGIN;

-- 1. Backfill cost_kmf ← cost_price_kmf (uniquement si cost_kmf manquant)
UPDATE products
   SET cost_kmf = cost_price_kmf
 WHERE cost_kmf IS NULL
   AND cost_price_kmf IS NOT NULL
   AND cost_price_kmf > 0;

-- 2. Backfill weight_kg ← weight_g (uniquement si weight_kg manquant)
UPDATE products
   SET weight_kg = ROUND((weight_g / 1000.0)::numeric, 2)
 WHERE weight_kg IS NULL
   AND weight_g IS NOT NULL
   AND weight_g > 0;

-- 3. Annotation des colonnes dépréciées (pas de suppression)
COMMENT ON COLUMN products.cost_price_kmf IS
  'DEPRECATED (Lot C5, 2026-06) — doublon de cost_kmf. cost_kmf est la source de vérité (pricing-engine). Ne plus écrire ici depuis le code applicatif. Conservée pour rollback safety, suppression prévue après N jours de stabilité prod.';

COMMENT ON COLUMN products.weight_g IS
  'DEPRECATED (Lot C5, 2026-06) — doublon de weight_kg. weight_kg est la source de vérité (pricing-engine). Ne plus écrire ici depuis le code applicatif. Conservée pour rollback safety, suppression prévue après N jours de stabilité prod.';

COMMIT;

-- ── Vérification post-migration (à exécuter manuellement, lecture seule) ───
-- SELECT count(*) FROM products WHERE cost_kmf IS NULL AND cost_price_kmf IS NOT NULL;
-- SELECT count(*) FROM products WHERE weight_kg IS NULL AND weight_g IS NOT NULL;
-- Les deux requêtes doivent retourner 0 après exécution.
