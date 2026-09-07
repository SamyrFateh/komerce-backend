-- ============================================================
-- Migration 164 : separer N2 variable et N3 structure dans les snapshots
-- Date : 2026-09-06
--
-- Doctrine :
--   order_item_cost_imputations doit permettre de calculer la contribution
--   figee d'une vente sans confondre N2 (business variable) et N3 (structure).
--
-- Compatibilite :
--   estimated_business_complete_cost_kmf est conserve. Il porte historiquement
--   le CDR complet unitaire * quantite, malgre son nom legacy.
--
-- Backfill :
--   uniquement quand le cost_breakdown fige contient les champs canoniques
--   payment / risk_provision / fixed_overhead. Une donnee absente reste NULL :
--   jamais de fallback silencieux a 0.
-- ============================================================

SET client_encoding = 'UTF8';

ALTER TABLE order_item_cost_imputations
  ADD COLUMN IF NOT EXISTS estimated_business_variable_cost_kmf NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_fixed_overhead_kmf        NUMERIC(12,2);

-- N2 = payment + risk_provision, multiplie par la quantite du snapshot.
UPDATE order_item_cost_imputations
   SET estimated_business_variable_cost_kmf =
       (
         NULLIF(cost_breakdown #>> '{business,payment}', '')::numeric
         + NULLIF(cost_breakdown #>> '{business,risk_provision}', '')::numeric
       ) * quantity
 WHERE estimated_business_variable_cost_kmf IS NULL
   AND cost_breakdown #>> '{business,payment}' IS NOT NULL
   AND cost_breakdown #>> '{business,risk_provision}' IS NOT NULL;

-- N3 = fixed_overhead, multiplie par la quantite du snapshot.
UPDATE order_item_cost_imputations
   SET estimated_fixed_overhead_kmf =
       NULLIF(cost_breakdown #>> '{business,fixed_overhead}', '')::numeric * quantity
 WHERE estimated_fixed_overhead_kmf IS NULL
   AND cost_breakdown #>> '{business,fixed_overhead}' IS NOT NULL;

COMMENT ON COLUMN order_item_cost_imputations.estimated_business_variable_cost_kmf IS
  'Snapshot N2 total de l order_item : paiement + provision risque. NULL si non reconstructible.';

COMMENT ON COLUMN order_item_cost_imputations.estimated_fixed_overhead_kmf IS
  'Snapshot N3 total de l order_item : allocation de structure pour lecture. NULL si non reconstructible.';

-- ============================================================
-- FIN MIGRATION 164
-- ============================================================
