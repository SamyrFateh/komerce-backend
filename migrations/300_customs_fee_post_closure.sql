-- @migration 300_customs_fee_post_closure.sql
-- @domain    customs / economic-engine
-- @purpose   A6 — frais constatés APRÈS clôture (expédition confirmed) : correction tracée, jamais réécriture.
--
-- customs_shipment_fees est append-only (trigger d'immutabilité 297). Après clôture, un frais tardif
-- ou une correction reste une NOUVELLE ligne (charge ou credit) ; cette colonne la marque et le motif
-- (notes) devient obligatoire côté service. Les lignes existantes gardent post_closure = FALSE.
--
-- Additive, aucun backfill. Rollback : ALTER TABLE public.customs_shipment_fees DROP COLUMN post_closure;

DO $pre$
BEGIN
  IF to_regclass('public.customs_shipment_fees') IS NULL THEN
    RAISE EXCEPTION '300 precondition: customs_shipment_fees requise';
  END IF;
END
$pre$;

ALTER TABLE public.customs_shipment_fees
  ADD COLUMN IF NOT EXISTS post_closure boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customs_shipment_fees.post_closure IS
  'TRUE = ligne enregistrée après clôture de l''expédition (status confirmed) ; correction tracée, montant d''origine jamais réécrit.';
