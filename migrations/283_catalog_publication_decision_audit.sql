-- @migration 283_catalog_publication_decision_audit.sql
-- @domain    catalog
-- @purpose   Journal append-only des décisions humaines de curation/publication Catalogue.
--
-- Owner: catalog
-- approve / reject / override+approve conservent acteur, raison et snapshots minimaux.
-- L'exposition marché reste auditée séparément dans market_delegation_audit.

CREATE TABLE IF NOT EXISTS public.catalog_publication_decision_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action             text NOT NULL,
  product_id         uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_ref        text NOT NULL,
  actor_user_id      uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role         text NULL,
  source_surface     text NOT NULL DEFAULT 'catalog_approval',
  reason             text NULL,
  overridden_fields  text[] NOT NULL DEFAULT '{}',
  before_snapshot    jsonb NOT NULL,
  after_snapshot     jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_publication_decision_audit_action_chk CHECK (
    action IN ('CATALOG_PRODUCT_APPROVED','CATALOG_PRODUCT_REJECTED','CATALOG_PRODUCT_OVERRIDDEN_AND_APPROVED')
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_publication_decision_audit_product
  ON public.catalog_publication_decision_audit(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_publication_decision_audit_actor
  ON public.catalog_publication_decision_audit(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
