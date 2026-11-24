-- 426: Vague temporaire de tri par destinataire et relais.
-- Reference commerciale UNIQUE CM-YA01-B7Q01, aucun secret de retrait.
-- La mise en service est protegee par KOMERCE_ORDER_WAVES_ENABLED=1 (staging).
ALTER TABLE public.relais
  ADD COLUMN IF NOT EXISTS short_code text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.relais'::regclass AND conname = 'relais_short_code_format'
  ) THEN
    ALTER TABLE public.relais
      ADD CONSTRAINT relais_short_code_format
      CHECK (short_code IS NULL OR short_code ~ '^[A-Z]{2}(0[1-9]|[1-9][0-9])$');
  END IF;
END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_relais_market_short_code
  ON public.relais (market_id, short_code) WHERE short_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_delivery_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_recipient_id uuid NOT NULL REFERENCES public.recipients(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  relais_id uuid NOT NULL REFERENCES public.relais(id) ON DELETE RESTRICT,
  client_code text NOT NULL,
  next_order_number integer NOT NULL DEFAULT 1 CHECK (next_order_number BETWEEN 1 AND 100),
  planned_units integer NOT NULL DEFAULT 0 CHECK (planned_units >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  CONSTRAINT chk_order_wave_client_code
    CHECK (client_code ~ '^[A-Z][A-HJ-NP-Z2-9]{2}$'),
  CONSTRAINT chk_order_wave_close
    CHECK ((closed_at IS NULL AND close_reason IS NULL)
      OR (closed_at IS NOT NULL AND
          close_reason IN ('FIRST_HANDOFF','EXPIRED','LAST_ORDER_CONFIRMED','ALL_CANCELLED'))),
  CONSTRAINT ux_order_wave_relay_client_code UNIQUE (market_id, relais_id, client_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_wave_open_recipient
  ON public.order_delivery_waves(subject_recipient_id, market_id, relais_id)
  WHERE closed_at IS NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_wave_id uuid
    REFERENCES public.order_delivery_waves(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_wave_id
  ON public.orders(delivery_wave_id) WHERE delivery_wave_id IS NOT NULL;

COMMENT ON TABLE public.order_delivery_waves IS
  'Groupe temporaire invisible par destinataire authentifie, marche et relais. Ne sert ni d identite civile, ni de code de retrait, ni de sac ou emplacement.';
COMMENT ON COLUMN public.relais.short_code IS
  'Code stable de deux lettres du nom reel + numero local a deux chiffres (YA01), non reutilise.';
