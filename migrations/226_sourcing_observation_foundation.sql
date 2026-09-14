-- @migration 226_sourcing_observation_foundation.sql
-- @domain    sourcing
-- @purpose   Poser le socle inerte Source -> Capture -> Observation -> Evidence
--            avant toute resolution multi-source ou bascule d'autorite.
--
-- Doctrine : docs/doctrine/DOCTRINE_SOURCE_OBSERVATION.md
--
-- PR 1A est strictement additive : aucun retrait, aucun writer runtime,
-- aucun changement d'autorite. sourcing_candidates et product_skus/SOI
-- restent les verites de production.

CREATE TYPE public.sourcing_observation_grain AS ENUM ('product', 'offer', 'unit');

CREATE TABLE public.sourcing_sources (
  source_id       text PRIMARY KEY,
  adapter_type    text        NOT NULL,
  acquisition     text        NOT NULL,
  continuity      text        NOT NULL,
  credential_ref  text,
  status           text        NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_sources_source_id_nonempty
    CHECK (btrim(source_id) <> ''),
  CONSTRAINT sourcing_sources_adapter_type_nonempty
    CHECK (btrim(adapter_type) <> ''),
  CONSTRAINT sourcing_sources_credential_ref_nonempty
    CHECK (credential_ref IS NULL OR btrim(credential_ref) <> ''),
  CONSTRAINT sourcing_sources_acquisition_chk
    CHECK (acquisition IN ('pull', 'push')),
  CONSTRAINT sourcing_sources_continuity_chk
    CHECK (continuity IN ('recurring', 'one_shot')),
  CONSTRAINT sourcing_sources_status_chk
    CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE public.sourcing_source_provides (
  source_id text NOT NULL
    REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE,
  layer     text NOT NULL,

  PRIMARY KEY (source_id, layer),
  CONSTRAINT sourcing_source_provides_layer_chk
    CHECK (layer IN ('catalog', 'offers', 'units'))
);

CREATE TABLE public.sourcing_source_execution_modes (
  source_id text NOT NULL
    REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE,
  mode      text NOT NULL,

  PRIMARY KEY (source_id, mode),
  CONSTRAINT sourcing_source_execution_mode_chk
    CHECK (mode IN ('human', 'api'))
);

-- Invariant relationnel : execution API => identite d'unite disponible.
-- La contrainte est differee afin que l'ordre d'insertion reste libre dans
-- une transaction source/provides/modes.
CREATE OR REPLACE FUNCTION public.sourcing_check_api_requires_units()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  offending_source text;
BEGIN
  SELECT em.source_id
    INTO offending_source
    FROM public.sourcing_source_execution_modes em
   WHERE em.mode = 'api'
     AND NOT EXISTS (
       SELECT 1
         FROM public.sourcing_source_provides sp
        WHERE sp.source_id = em.source_id
          AND sp.layer = 'units'
     )
   LIMIT 1;

  IF offending_source IS NOT NULL THEN
    RAISE EXCEPTION
      'capability invariant: source % supports api execution but does not provide units',
      offending_source
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sourcing_source_exec_api_requires_units
  AFTER INSERT OR UPDATE OR DELETE ON public.sourcing_source_execution_modes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_api_requires_units();

-- UPDATE est couvert : units -> catalog/offers ne peut pas contourner
-- l'invariant si le mode api reste actif.
CREATE CONSTRAINT TRIGGER sourcing_source_provides_units_guard
  AFTER UPDATE OR DELETE ON public.sourcing_source_provides
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_api_requires_units();

CREATE TABLE public.sourcing_captures (
  capture_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        text        NOT NULL
    REFERENCES public.sourcing_sources(source_id),
  status           text        NOT NULL DEFAULT 'running',
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  stats            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  raw_artifact_ref text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_captures_status_chk
    CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  CONSTRAINT sourcing_captures_raw_artifact_ref_nonempty
    CHECK (raw_artifact_ref IS NULL OR btrim(raw_artifact_ref) <> '')
);

CREATE INDEX sourcing_captures_source_started_idx
  ON public.sourcing_captures (source_id, started_at DESC);

-- Observation = etat observe d'UNE entite resolvable, a UN grain, a UN
-- instant. La source n'est pas dupliquee : elle se resout via capture_id.
CREATE TABLE public.sourcing_observations (
  observation_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id            uuid NOT NULL
    REFERENCES public.sourcing_captures(capture_id),
  grain                 public.sourcing_observation_grain NOT NULL,
  source_ref            text,
  principal_ref         text,
  parent_observation_id uuid,
  observed_at           timestamptz NOT NULL,
  normalized            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  field_provenance      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  raw_fragment          jsonb       NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_observations_source_ref_nonempty
    CHECK (source_ref IS NULL OR btrim(source_ref) <> ''),
  CONSTRAINT sourcing_observations_principal_ref_nonempty
    CHECK (principal_ref IS NULL OR btrim(principal_ref) <> ''),
  CONSTRAINT sourcing_observations_identity_capture_uniq
    UNIQUE (observation_id, capture_id),
  CONSTRAINT sourcing_observations_parent_same_capture
    FOREIGN KEY (parent_observation_id, capture_id)
    REFERENCES public.sourcing_observations (observation_id, capture_id)
);

CREATE INDEX sourcing_observations_capture_idx
  ON public.sourcing_observations (capture_id);
CREATE INDEX sourcing_observations_grain_idx
  ON public.sourcing_observations (grain);
CREATE INDEX sourcing_observations_source_ref_idx
  ON public.sourcing_observations (source_ref)
  WHERE source_ref IS NOT NULL;
CREATE INDEX sourcing_observations_observed_at_idx
  ON public.sourcing_observations (observed_at DESC);

-- Evidence = index derive/reconstructible servant plus tard Candidate Retrieval.
-- Le namespace evidence_type + evidence_key evite de confondre gtin/mpn/etc.
CREATE TABLE public.sourcing_observation_evidence (
  evidence_id       bigserial PRIMARY KEY,
  observation_id    uuid NOT NULL
    REFERENCES public.sourcing_observations(observation_id) ON DELETE CASCADE,
  evidence_type     text        NOT NULL,
  evidence_key      text        NOT NULL,
  value             text        NOT NULL,
  extractor_version text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_observation_evidence_type_chk
    CHECK (evidence_type IN (
      'deterministic_id',
      'source_ref',
      'lexical',
      'perceptual',
      'attribute'
    )),
  CONSTRAINT sourcing_observation_evidence_key_nonempty
    CHECK (btrim(evidence_key) <> ''),
  CONSTRAINT sourcing_observation_evidence_value_nonempty
    CHECK (btrim(value) <> ''),
  CONSTRAINT sourcing_observation_evidence_extractor_nonempty
    CHECK (btrim(extractor_version) <> ''),
  CONSTRAINT sourcing_observation_evidence_unique
    UNIQUE (
      observation_id,
      evidence_type,
      evidence_key,
      value,
      extractor_version
    )
);

CREATE INDEX sourcing_observation_evidence_lookup_idx
  ON public.sourcing_observation_evidence (evidence_type, evidence_key, value);
CREATE INDEX sourcing_observation_evidence_observation_idx
  ON public.sourcing_observation_evidence (observation_id);

-- Observation autoritative => append-only. Evidence est reconstructible et
-- ne recoit donc volontairement aucun trigger d'immutabilite.
CREATE OR REPLACE FUNCTION public.sourcing_forbid_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % interdit sur %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER sourcing_observations_append_only
  BEFORE UPDATE OR DELETE ON public.sourcing_observations
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_forbid_observation_mutation();

COMMENT ON TABLE public.sourcing_sources IS
  'PR 1A shadow foundation. Source instance observable; aucune autorite prod.';
COMMENT ON TABLE public.sourcing_captures IS
  'Run ou lot d acquisition d une source; lifecycle operationnel uniquement.';
COMMENT ON TABLE public.sourcing_observations IS
  'Observation immuable d une entite resolvable product, offer ou unit.';
COMMENT ON TABLE public.sourcing_observation_evidence IS
  'Index d evidence derive et reconstructible pour candidate retrieval.';

-- Pas de backfill. Pas de writer runtime. Pas de lecture prod dans PR 1A.
