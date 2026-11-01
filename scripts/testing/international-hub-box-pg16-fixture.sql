-- PostgreSQL 16 disposable fixture for additive KOM-BOX shipment bridge.
-- Migration 354 and 355 fixtures create markets and international_shipments first.
CREATE TABLE IF NOT EXISTS public.hub_physical_units(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES public.markets(id),
  reference text NOT NULL UNIQUE,
  unit_type text NOT NULL,
  state text NOT NULL,
  outcome_type text
);
