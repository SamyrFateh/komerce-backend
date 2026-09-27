-- Migration 243 — external terminology reference memory
-- Purpose: keep reusable EN→FR reference terms (e.g. TERMIUM Plus) separate
-- from catalog_glossary, which remains Komerce's curated/authoritative glossary.
--
-- External references are evidence/context, never automatic editorial authority.

CREATE TABLE IF NOT EXISTS catalog_terminology_reference (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_key         text NOT NULL UNIQUE,
  source                text NOT NULL,
  source_record_id      text,
  dataset_domain        text,
  subject_en            text,
  subject_fr            text,
  term_en               text NOT NULL,
  term_en_normalized    text NOT NULL,
  term_fr               text NOT NULL,
  term_fr_normalized    text NOT NULL,
  term_en_parameter     text,
  term_fr_parameter     text,
  abbreviation_en       text,
  abbreviation_fr       text,
  source_url            text,
  source_license        text NOT NULL,
  source_data_date      date,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active             boolean NOT NULL DEFAULT TRUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_terminology_reference_source_check
    CHECK (source IN ('termium_plus', 'franceterme', 'iate', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_terminology_reference_term_en
  ON catalog_terminology_reference (term_en_normalized)
  WHERE is_active=TRUE;

CREATE INDEX IF NOT EXISTS idx_catalog_terminology_reference_domain
  ON catalog_terminology_reference (source, dataset_domain)
  WHERE is_active=TRUE;

CREATE INDEX IF NOT EXISTS idx_catalog_terminology_reference_subject_en
  ON catalog_terminology_reference (subject_en)
  WHERE is_active=TRUE;

COMMENT ON TABLE catalog_terminology_reference IS
  'External EN→FR terminology references. catalog_glossary remains the curated Komerce authority; this table provides sourced contextual candidates only.';

COMMENT ON COLUMN catalog_terminology_reference.reference_key IS
  'Stable SHA-256 identity of source + record + EN/FR term + context, used for idempotent imports.';

COMMENT ON COLUMN catalog_terminology_reference.source_license IS
  'Licence provenance carried with every imported reference; TERMIUM Plus uses Open Government Licence – Canada.';
