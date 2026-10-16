-- @migration 295_catalog_media_visual_fr_reviews.sql
-- @domain catalog
-- @purpose Source-linked manual evidence for visual text review; no publication side effect.
-- No historical backfill: missing review is NOT_REVIEWED, never approved by default.
CREATE TABLE IF NOT EXISTS public.catalog_media_visual_fr_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.catalog_media(id) ON DELETE CASCADE,
  source_media_id text NOT NULL,
  source_url text NOT NULL,
  option_values jsonb,
  text_presence text NOT NULL,
  source_transcription text,
  french_translation text,
  french_presentation jsonb,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_media_visual_fr_option_values_object
    CHECK (option_values IS NULL OR jsonb_typeof(option_values)='object'),
  CONSTRAINT catalog_media_visual_fr_text_presence
    CHECK (text_presence IN ('NONE','PRESENT','UNREADABLE')),
  CONSTRAINT catalog_media_visual_fr_reviewer_nonempty
    CHECK (length(btrim(reviewed_by)) > 0),
  CONSTRAINT catalog_media_visual_fr_identity_nonempty
    CHECK (length(btrim(source_media_id)) > 0 AND length(btrim(source_url)) > 0),
  CONSTRAINT catalog_media_visual_fr_one_review_per_media UNIQUE(media_id)
);
CREATE INDEX IF NOT EXISTS catalog_media_visual_fr_reviews_reviewed_at_idx
  ON public.catalog_media_visual_fr_reviews(reviewed_at);
COMMENT ON TABLE public.catalog_media_visual_fr_reviews IS
  'Explicit source-linked human visual-language review. A source URL or variant change invalidates the verdict at read time; not automatic publication authority.';
