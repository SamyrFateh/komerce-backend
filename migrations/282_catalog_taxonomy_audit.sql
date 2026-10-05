-- Migration 282 — audit append-only des mutations de taxonomie Catalogue.
-- Owner: catalog
-- Toute mutation catégorie / sous-catégorie doit conserver acteur, action et snapshots.
-- Aucun trigger : l'owner service écrit l'audit dans la même transaction que la mutation.

CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action            text NOT NULL,
  entity_type       text NOT NULL,
  category_key      text NOT NULL,
  subcategory_key   text NULL,
  actor_user_id     uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role        text NULL,
  source_surface    text NOT NULL DEFAULT 'catalog',
  before_snapshot   jsonb NULL,
  after_snapshot    jsonb NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_taxonomy_audit_action_chk CHECK (
    action IN (
      'CATEGORY_CREATED',
      'CATEGORY_UPDATED',
      'CATEGORY_DEACTIVATED',
      'SUBCATEGORY_CREATED',
      'SUBCATEGORY_UPDATED',
      'SUBCATEGORY_DEACTIVATED',
      'SUBCATEGORY_DELETED'
    )
  ),
  CONSTRAINT catalog_taxonomy_audit_entity_chk CHECK (
    entity_type IN ('category', 'subcategory')
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_audit_created
  ON public.catalog_taxonomy_audit(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_audit_category
  ON public.catalog_taxonomy_audit(category_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_audit_actor
  ON public.catalog_taxonomy_audit(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
