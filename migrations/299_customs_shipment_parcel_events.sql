-- @migration 299_customs_shipment_parcel_events.sql
-- @domain    customs / economic-engine
-- @purpose   Journal immuable des rattachements / retraits de colis d'une expédition (groupage A1).
--
-- Un ajout ou un retrait de colis modifie la ventilation des coûts réels : il doit être justifié
-- (reason obligatoire) et tracé (acteur, date). Append-only : UPDATE/DELETE refusés. Pas de FK
-- (comme customs_shipment_financial_audit) : la preuve survit à la désactivation/suppression.
-- Additive, aucun backfill. Rollback : DROP TABLE customs_shipment_parcel_events;
-- DROP FUNCTION customs_shipment_parcel_events_immutable();

DO $pre$
BEGIN
  IF to_regclass('public.customs_shipments') IS NULL THEN
    RAISE EXCEPTION '299 precondition: customs_shipments requise';
  END IF;
  IF to_regclass('public.customs_shipment_parcel_events') IS NOT NULL THEN
    RAISE EXCEPTION '299 precondition: customs_shipment_parcel_events déjà présente (état inattendu)';
  END IF;
END
$pre$;

CREATE TABLE public.customs_shipment_parcel_events (
  id          bigserial PRIMARY KEY,
  shipment_id uuid        NOT NULL,
  parcel_id   uuid        NOT NULL,
  event       text        NOT NULL CHECK (event IN ('attach', 'detach')),
  actor_id    text,
  reason      text        NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customs_parcel_events_shipment
  ON public.customs_shipment_parcel_events (shipment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.customs_shipment_parcel_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_parcel_events est append-only (% refusé)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_customs_parcel_events_immutable
  BEFORE UPDATE OR DELETE ON public.customs_shipment_parcel_events
  FOR EACH ROW EXECUTE FUNCTION public.customs_shipment_parcel_events_immutable();
