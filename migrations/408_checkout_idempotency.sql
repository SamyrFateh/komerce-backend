-- @migration 408_checkout_idempotency.sql
-- @domain orders
-- @purpose Exactly-once checkout creation for user-scoped Idempotency-Key (L3 #3927).
-- Transactional claim and outcome are written in the same transaction as the order,
-- item reservations, and wallet debit. No committed in-progress marker.
CREATE TABLE IF NOT EXISTS public.order_checkout_idempotency (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  response_snapshot jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT order_checkout_idempotency_completed_pair
    CHECK ((order_id IS NULL) = (response_snapshot IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_order_checkout_idempotency_order
  ON public.order_checkout_idempotency (order_id);
