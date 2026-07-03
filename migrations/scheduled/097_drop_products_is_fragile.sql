-- @migration 097_drop_products_is_fragile.sql
-- @domain    logistics
-- @purpose   Clôture Q-0 : suppression de products.is_fragile (dépréciée en 096).

-- ============================================================================
--  ⚠️  MIGRATION PLANIFIÉE — NE PAS DÉPLACER DANS migrations/ AVANT LE 2026-07-16
--  (fenêtre de stabilité de 2 semaines après la 096, même discipline que la
--  089 pour weight_g : le runner exécute tout fichier inconnu de migrations/,
--  ce dossier scheduled/ est son seul garde-fou.)
--
--  CHECKLIST AVANT ACTIVATION (git mv migrations/scheduled/097_... migrations/) :
--
--    grep -rn "is_fragile" routes/ services/ validators/ public/ --include="*.js"
--      → Attendu : uniquement services/parcelOptimizationService.js, où
--        is_fragile est une PROPRIÉTÉ D'ITEM fournie par l'appelant (jamais
--        lue en SQL) — sans impact sur ce drop. Si un SELECT ... is_fragile
--        apparaît d'ici là : le basculer sur (fragility IS NOT NULL) AS is_fragile
--        AVANT d'activer cette migration.
--
--    SELECT count(*) FROM products WHERE is_fragile = TRUE AND fragility IS NULL;
--      → Attendu : 0 (backfill 096 complet ; sinon relancer le backfill).
--
--  Ne pas exécuter dans le même déploiement qu'une autre migration à risque.
-- ============================================================================

SET client_encoding = 'UTF8';

ALTER TABLE products
  DROP COLUMN IF EXISTS is_fragile;

DO $$
BEGIN
  RAISE NOTICE 'Migration 097 OK : products.is_fragile supprimée (source unique : fragility)';
END $$;
