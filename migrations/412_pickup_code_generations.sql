-- @migration 412_pickup_code_generations.sql
-- @domain logistics
-- @purpose Audit + quota (5 / 24 h / commande) des codes de retrait regénérés par le client propriétaire. Additive. Jamais de code (ni hash) stocké.
CREATE TABLE IF NOT EXISTS public.pickup_code_generations (
  id          bigserial   PRIMARY KEY,
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pickup_code_generations_order_created
  ON public.pickup_code_generations (order_id, created_at DESC);
