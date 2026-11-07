-- @migration 398_hub_stage_notes_append_only.sql
-- @domain logistics
-- @purpose Attach immutable internal Hub progress notes to canonical order_comments.
-- Existing comments remain unchanged; no new parallel journal.
-- A stage note is NOT a transition, custody attestation, payment or authorization.
-- Notes remain immutable throughout the order life; canonical order deletion may
-- cascade during controlled staging reset / legal data retention.
ALTER TABLE public.order_comments
  ADD COLUMN IF NOT EXISTS hub_stage_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'order_comments_hub_stage_key_chk'
      AND conrelid = 'public.order_comments'::regclass) THEN
    ALTER TABLE public.order_comments ADD CONSTRAINT order_comments_hub_stage_key_chk
      CHECK (hub_stage_key IS NULL OR hub_stage_key IN
        ('po','supplier','reception','cartons','departure','remaining'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_comments_hub_stage
  ON public.order_comments(order_id, hub_stage_key, created_at DESC, id DESC)
  WHERE hub_stage_key IS NOT NULL;

-- Database guarantee, not simply a hidden Edit button. Regular legacy comments
-- keep their existing semantics. Deleting the parent order is the only exception:
-- FK ON DELETE CASCADE removes all dependent rows in the same transaction.
CREATE OR REPLACE FUNCTION public.prevent_hub_stage_comment_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.hub_stage_key IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'HUB_STAGE_NOTE_IMMUTABLE'
        USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.orders WHERE id = OLD.order_id) THEN
      RAISE EXCEPTION 'HUB_STAGE_NOTE_IMMUTABLE'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_immutable_hub_stage_note ON public.order_comments;
CREATE TRIGGER trg_immutable_hub_stage_note
  BEFORE UPDATE OR DELETE ON public.order_comments
  FOR EACH ROW
  WHEN (OLD.hub_stage_key IS NOT NULL)
  EXECUTE FUNCTION public.prevent_hub_stage_comment_changes();
