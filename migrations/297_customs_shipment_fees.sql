-- @migration 297_customs_shipment_fees.sql
-- @domain    customs / economic-engine
-- @purpose   Frais douaniers typés, réels et justifiés, par expédition (journal append-only).
--
-- customs_shipments.customs_paid_kmf reste le montant global droits/taxes douane (customs) et
-- freight_kmf le fret : cette table ne les remplace pas, elle porte les AUTRES frais constatés :
--   handling    manutention          storage   stockage / surestaries
--   forwarder   transitaire          local_tax taxe locale hors droits de douane
--   exceptional frais exceptionnels  other     autre frais justifié
-- Sémantique : absence de ligne pour un type = INCONNU ; ligne charge à 0 = zéro CONFIRMÉ ;
-- kind=credit = remboursement ou correction à la baisse (jamais de montant négatif ni d'UPDATE).
-- Devise : amount_currency/currency tracent l'origine ; amount_kmf (réellement supporté) fait foi,
-- aucun taux de référence n'est utilisé ni stocké. Preuve (proof_ref) et idempotency_key obligatoires.
-- Le marché se déduit de l'expédition (customs_shipments.market_id), jamais d'un champ libre.
-- Ventilation : services/transport-cost-allocation.js (cost_type 'port_transitaire', source
-- 'customs_shipment_fees', conservée au centime) ; aucune écriture directe dans les allocations ici.
--
-- Additive, aucun backfill. Rollback : DROP TABLE public.customs_shipment_fees;
-- DROP FUNCTION public.customs_shipment_fees_immutable();

DO $pre$
BEGIN
  IF to_regclass('public.customs_shipments') IS NULL THEN
    RAISE EXCEPTION '297 precondition: customs_shipments requise';
  END IF;
  IF to_regclass('public.customs_shipment_fees') IS NOT NULL THEN
    RAISE EXCEPTION '297 precondition: customs_shipment_fees déjà présente (état inattendu)';
  END IF;
END
$pre$;

CREATE TABLE public.customs_shipment_fees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      uuid NOT NULL REFERENCES public.customs_shipments(id) ON DELETE RESTRICT,
  fee_type         text NOT NULL,
  kind             text NOT NULL DEFAULT 'charge',
  amount_currency  numeric(18,4) NOT NULL,
  currency         text NOT NULL,
  amount_kmf       numeric(14,2) NOT NULL,
  proof_ref        text NOT NULL,
  idempotency_key  text NOT NULL,
  notes            text NULL,
  recorded_by      uuid NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_csf_fee_type CHECK (fee_type IN ('handling','storage','forwarder','local_tax','exceptional','other')),
  CONSTRAINT chk_csf_kind CHECK (kind IN ('charge','credit')),
  CONSTRAINT chk_csf_amount_currency CHECK (amount_currency >= 0),
  CONSTRAINT chk_csf_amount_kmf CHECK (amount_kmf >= 0),
  CONSTRAINT chk_csf_credit_positive CHECK (kind = 'charge' OR amount_kmf > 0),
  CONSTRAINT chk_csf_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_csf_kmf_currency CHECK (currency <> 'KMF' OR amount_currency = amount_kmf),
  CONSTRAINT chk_csf_proof CHECK (btrim(proof_ref) <> ''),
  CONSTRAINT chk_csf_idem CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT uq_csf_shipment_idem UNIQUE (shipment_id, idempotency_key)
);

CREATE INDEX idx_csf_shipment ON public.customs_shipment_fees(shipment_id, fee_type);

CREATE OR REPLACE FUNCTION public.customs_shipment_fees_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_fees est append-only (% interdit) : corriger par une ligne credit/charge', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER trg_csf_immutable
  BEFORE UPDATE OR DELETE ON public.customs_shipment_fees
  FOR EACH ROW EXECUTE FUNCTION public.customs_shipment_fees_immutable();
