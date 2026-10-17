-- @migration 301_products_target_margin.sql
-- @domain    economic-engine
-- @purpose   Marge cible commerciale par produit (pilotage par la marge).
--
-- NULL = hérite (marge par défaut de la catégorie, puis finance_config.target_marge_brute_pct).
-- Le prix de vente reste une décision commerciale : cette colonne ne modifie aucun prix existant ;
-- elle sert de référence d'écart (marge réelle − marge cible) et de marge cible du moteur pour ce produit.
-- La marge cible du moment est figée dans order_item_cost_imputations.cost_breakdown à la vente.
--
-- Additive, aucun backfill. Rollback : ALTER TABLE public.products DROP COLUMN target_margin_pct;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric(5,2) NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_target_margin_pct') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT chk_products_target_margin_pct
      CHECK (target_margin_pct IS NULL OR (target_margin_pct >= 0 AND target_margin_pct < 100));
  END IF;
END
$chk$;

COMMENT ON COLUMN public.products.target_margin_pct IS
  'Marge cible commerciale du produit (%) ; NULL = marge par défaut de la catégorie puis finance_config.';
