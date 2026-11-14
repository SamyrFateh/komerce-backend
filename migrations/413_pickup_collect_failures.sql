-- @migration 413_pickup_collect_failures.sql
-- @domain logistics
-- @purpose Compteur durable des échecs de retrait par code, par agent et relais (anti-bruteforce #3900 R2). Additive. Jamais de code stocké.
CREATE TABLE IF NOT EXISTS public.pickup_collect_failures (
  id          bigserial   PRIMARY KEY,
  agent_id    uuid        NOT NULL,
  relais_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pickup_collect_failures_agent_created
  ON public.pickup_collect_failures (agent_id, created_at DESC);
