-- @migration 353_international_shipment_journey.sql
-- @domain logistics / customs / economic-engine
-- @purpose Transport international réel : remise Hub, réception transitaire, fret,
--   suivi conteneur, arrivée, libération, transport local, remise au relais.
-- ADDITIVE: aucune écriture dans customs_shipments ou les coûts N1 historiques.
-- Les frais documentaires ci-dessous ne sont PAS ventilés automatiquement :
-- rapprochement canonique nécessaire pour éviter la double comptabilisation.
-- PostgreSQL 16 compatible; les faits historiques restent intacts.

CREATE TABLE IF NOT EXISTS public.international_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES public.markets(id),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 96),
  forwarder_name text NOT NULL CHECK (length(btrim(forwarder_name)) BETWEEN 2 AND 180),
  transport_mode text NOT NULL CHECK (transport_mode IN ('sea','air')),
  stage text NOT NULL DEFAULT 'hub_ready' CHECK (stage IN (
    'hub_ready','handed_over','forwarder_received','in_transit','arrived',
    'customs_released','local_delivery','relay_received'
  )),
  volume_m3 numeric(12,5) NULL CHECK (volume_m3 > 0),
  freight_rate_kmf_per_m3 numeric(14,2) NULL CHECK (freight_rate_kmf_per_m3 >= 0),
  freight_invoice_kmf numeric(14,2) NULL CHECK (freight_invoice_kmf >= 0),
  freight_invoice_ref text NULL,
  tracking_reference text NULL,
  container_reference text NULL,
  bill_of_lading_ref text NULL,
  estimated_arrival_at timestamptz NULL,
  departed_at timestamptz NULL,
  arrived_at timestamptz NULL,
  customs_shipment_id uuid NULL REFERENCES public.customs_shipments(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_international_market_reference UNIQUE(market_id,reference),
  CONSTRAINT uq_international_customs_shipment UNIQUE(customs_shipment_id),
  CONSTRAINT chk_international_invoice_proof CHECK (
    freight_invoice_kmf IS NULL OR
    (freight_invoice_ref IS NOT NULL AND length(btrim(freight_invoice_ref)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_international_shipments_market ON public.international_shipments(market_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.international_shipment_parcels (
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  parcel_id uuid NOT NULL REFERENCES public.parcels(id) ON DELETE RESTRICT,
  volume_cm3 numeric(14,2) NULL CHECK (volume_cm3 >= 0),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id,parcel_id),
  -- One real parcel cannot silently belong to two independent transport dossiers.
  CONSTRAINT uq_international_parcel UNIQUE(parcel_id)
);

CREATE TABLE IF NOT EXISTS public.international_shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created','stage_changed','tracking_updated','freight_recorded','customs_linked')),
  from_stage text NULL,
  to_stage text NULL,
  proof_ref text NOT NULL CHECK (length(btrim(proof_ref)) > 0),
  actor_id text NOT NULL,
  notes text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_international_events_shipment ON public.international_shipment_events(shipment_id,occurred_at DESC);

-- Faits complémentaires, pas encore une imputation N1 : les droits/taxes douaniers
-- restent customs_shipments.customs_paid_kmf, le fret international est porté
-- par international_shipments.freight_invoice_kmf. Les frais existants déjà
-- présents dans customs_shipment_fees ne doivent pas être ressaisis ici.
CREATE TABLE IF NOT EXISTS public.international_shipment_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.international_shipments(id) ON DELETE RESTRICT,
  fee_type text NOT NULL CHECK (fee_type IN ('handling','storage','forwarder','local_tax','exceptional','other','local_transport')),
  kind text NOT NULL DEFAULT 'charge' CHECK (kind IN ('charge','credit')),
  amount_kmf numeric(14,2) NOT NULL CHECK (amount_kmf >= 0),
  currency text NOT NULL DEFAULT 'KMF' CHECK (currency = 'KMF'),
  proof_ref text NOT NULL CHECK (length(btrim(proof_ref)) > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  notes text NULL,
  actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_international_charge_idem UNIQUE(shipment_id,idempotency_key),
  CONSTRAINT chk_international_charge_credit CHECK(kind='charge' OR amount_kmf > 0)
);
CREATE INDEX IF NOT EXISTS idx_international_charges_shipment ON public.international_shipment_charges(shipment_id,recorded_at DESC);

-- Keep an immutable trace of events and financial source facts.
CREATE OR REPLACE FUNCTION public.international_facts_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'international_shipment_facts append-only (% interdit)',TG_OP
    USING ERRCODE='integrity_constraint_violation';
END;
$$;
DROP TRIGGER IF EXISTS international_events_immutable ON public.international_shipment_events;
CREATE TRIGGER international_events_immutable BEFORE UPDATE OR DELETE ON public.international_shipment_events
FOR EACH ROW EXECUTE FUNCTION public.international_facts_immutable();
DROP TRIGGER IF EXISTS international_charges_immutable ON public.international_shipment_charges;
CREATE TRIGGER international_charges_immutable BEFORE UPDATE OR DELETE ON public.international_shipment_charges
FOR EACH ROW EXECUTE FUNCTION public.international_facts_immutable();

COMMENT ON TABLE public.international_shipments IS
'Transport international réel séparé des déclarations douanières; progression par preuves et coûts de fret facturés.';
COMMENT ON TABLE public.international_shipment_charges IS
'Faits de frais documentaires non ventilés au coût N1 tant que le rapprochement avec customs_shipment_fees n est pas certifié.';
