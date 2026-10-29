-- @migration 351_catalog_media_recovery_audit.sql
-- @domain catalog
-- @purpose Durable append-only proof for explicit restoration of supplier media
--           onto a previously empty canonical catalog_media set.
-- No automatic backfill. No publication decision or market authorization.
CREATE TABLE IF NOT EXISTS public.catalog_media_recovery_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_ref text NOT NULL,
  candidate_ref text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source_media_ids text[] NOT NULL,
  source_media_hash text NOT NULL,
  active_before integer NOT NULL CHECK (active_before = 0),
  active_after integer NOT NULL CHECK (active_after > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_media_recovery_audit_product
  ON public.catalog_media_recovery_audit(product_id, created_at DESC);
