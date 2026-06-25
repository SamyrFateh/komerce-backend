-- 091_freeze_customs_classification_order_items.sql
-- Keystone douane — Lot A : gel de la classification douane sur order_items
--
-- Doctrine : DOUANE_DECLARATION_PIVOT.md
-- Spec     : docs/specs/SPEC_KEYSTONE_DOUANE.md (Gap A)
--
-- Ces colonnes sont immuables après l'INSERT (comme price_kmf).
-- Elles portent la classification figée à l'instant de la commande,
-- indépendamment de toute évolution ultérieure du produit ou de la catégorie.
--
-- Migration purement additive — pas de NOT NULL, pas de backfill.
-- On est en build : les commandes existantes resteront à NULL, c'est assumé.
-- Invariant I-DOUANE-1 : tout INSERT order_items doit désormais passer par
-- resolveFrozenClassification() (services/customs-classification.js).

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS customs_category_key    text,
  ADD COLUMN IF NOT EXISTS sh_code                 text,
  ADD COLUMN IF NOT EXISTS douane_pct              numeric(5,2),
  ADD COLUMN IF NOT EXISTS tva_pct                 numeric(5,2),
  ADD COLUMN IF NOT EXISTS taxe_add_pct            numeric(5,2),
  ADD COLUMN IF NOT EXISTS classification_defaulted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.customs_category_key IS
  'Clé customs_categories figée à la création — immuable comme price_kmf. Source : product.category → customs_categories.key.';
COMMENT ON COLUMN public.order_items.sh_code IS
  'Code SH (nomenclature douanière) figé à la création.';
COMMENT ON COLUMN public.order_items.douane_pct IS
  'Taux de droit de douane (%) figé à la création depuis customs_categories.';
COMMENT ON COLUMN public.order_items.tva_pct IS
  'Taux TVA (%) figé à la création depuis customs_categories.';
COMMENT ON COLUMN public.order_items.taxe_add_pct IS
  'Taux taxe additionnelle (%) figé à la création depuis customs_categories.';
COMMENT ON COLUMN public.order_items.classification_defaulted IS
  'true si product.category ne matchait aucune customs_categories.key et que la catégorie "default" a été utilisée en repli.';
