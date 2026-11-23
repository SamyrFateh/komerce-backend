-- Migration 426 — Wave grouping behind staging-only flag.
-- This is NOT a customer identifier and never an authorization secret.
-- Commercial order.reference remains immutable; the wave admission is private.
ALTER TABLE public.relais
  ADD COLUMN IF NOT EXISTS short_code text;
ALTER TABLE public.relais
  DROP CONSTRAINT IF EXISTS relais_short_code_format;
ALTER TABLE public.relais
  ADD CONSTRAINT relais_short_code_format
  CHECK (short_code IS NULL OR short_code ~ '^[A-Z]{3}[1-9]$');
CREATE UNIQUE INDEX IF NOT EXISTS ux_relais_market_short_code
  ON public.relais (market_id, short_code) WHERE short_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_delivery_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  relais_id uuid NOT NULL REFERENCES public.relais(id) ON DELETE RESTRICT,
  client_code text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  CONSTRAINT chk_order_wave_client_code CHECK (client_code ~ '^[A-HJ-NP-Z][A-HJ-NP-Z2-9]{3}$'),
  CONSTRAINT chk_order_wave_close CHECK (
    (closed_at IS NULL AND close_reason IS NULL) OR
    (closed_at IS NOT NULL AND close_reason IN ('FIRST_HANDOFF','EXPIRED','LAST_ORDER_CONFIRMED','ALL_CANCELLED'))
  ),
  CONSTRAINT ux_order_wave_relay_client_code UNIQUE (market_id, relais_id, client_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_order_wave_open_subject
  ON public.order_delivery_waves(subject_user_id, market_id, relais_id)
  WHERE closed_at IS NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_wave_id uuid REFERENCES public.order_delivery_waves(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_wave_id
  ON public.orders(delivery_wave_id) WHERE delivery_wave_id IS NOT NULL;

COMMENT ON TABLE public.order_delivery_waves IS
  'Invisible temporary grouping of verified buyer orders per market and relay; not a pickup credential, person identity, bag, storage location, or COMBOX.';
COMMENT ON COLUMN public.relais.short_code IS
  'Name-derived immutable 3 letters + market-local relay number, assigned on first V2 checkout. Never derived from personal information.';
