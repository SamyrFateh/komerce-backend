-- @migration 227_sourcing_resolution_foundation.sql
-- @domain    sourcing
-- @purpose   Poser le socle inerte Observation -> Resolution -> Canonical identity
--            sans modifier l'autorite du catalogue ni de la Supplier Order Identity.
--
-- Doctrine : docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md
--
-- PR 1B est strictement additive : aucun writer runtime, aucun backfill,
-- aucune lecture production, aucune selection d'offre. Les decisions de
-- resolution restent separees du futur moteur de selection fournisseur.

-- ---------------------------------------------------------------------------
-- Commercial principal
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_commercial_principals (
  principal_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   text,
  status         text        NOT NULL DEFAULT 'active',
  superseded_by  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_commercial_principals_name_nonempty
    CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  CONSTRAINT sourcing_commercial_principals_status_chk
    CHECK (status IN ('active', 'superseded')),
  CONSTRAINT sourcing_commercial_principals_not_self_superseded
    CHECK (superseded_by IS NULL OR superseded_by <> principal_id),
  CONSTRAINT sourcing_commercial_principals_lifecycle_chk
    CHECK (
      (status = 'active' AND superseded_by IS NULL)
      OR
      (status = 'superseded' AND superseded_by IS NOT NULL)
    ),
  CONSTRAINT sourcing_commercial_principals_superseded_fk
    FOREIGN KEY (superseded_by)
    REFERENCES public.sourcing_commercial_principals(principal_id)
);

CREATE TABLE public.sourcing_source_principal_refs (
  source_id      text NOT NULL
    REFERENCES public.sourcing_sources(source_id) ON DELETE CASCADE,
  principal_ref  text NOT NULL,
  principal_id   uuid NOT NULL
    REFERENCES public.sourcing_commercial_principals(principal_id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (source_id, principal_ref),
  CONSTRAINT sourcing_source_principal_refs_ref_nonempty
    CHECK (btrim(principal_ref) <> '')
);

CREATE INDEX sourcing_source_principal_refs_principal_idx
  ON public.sourcing_source_principal_refs (principal_id);

-- ---------------------------------------------------------------------------
-- Canonical identity supertype
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_canonical_entities (
  canonical_entity_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grain                public.sourcing_observation_grain NOT NULL,
  parent_entity_id     uuid,
  principal_id         uuid
    REFERENCES public.sourcing_commercial_principals(principal_id),
  status               text        NOT NULL DEFAULT 'active',
  superseded_by        uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_canonical_entities_id_grain_uniq
    UNIQUE (canonical_entity_id, grain),
  CONSTRAINT sourcing_canonical_entities_status_chk
    CHECK (status IN ('active', 'superseded')),
  CONSTRAINT sourcing_canonical_entities_not_self_parent
    CHECK (parent_entity_id IS NULL OR parent_entity_id <> canonical_entity_id),
  CONSTRAINT sourcing_canonical_entities_not_self_superseded
    CHECK (superseded_by IS NULL OR superseded_by <> canonical_entity_id),
  CONSTRAINT sourcing_canonical_entities_lifecycle_chk
    CHECK (
      (status = 'active' AND superseded_by IS NULL)
      OR
      (status = 'superseded' AND superseded_by IS NOT NULL)
    ),
  CONSTRAINT sourcing_canonical_entities_principal_grain_chk
    CHECK (principal_id IS NULL OR grain = 'offer'),
  CONSTRAINT sourcing_canonical_entities_parent_fk
    FOREIGN KEY (parent_entity_id)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id),
  CONSTRAINT sourcing_canonical_entities_superseded_same_grain_fk
    FOREIGN KEY (superseded_by, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain)
);

-- Product has no parent. Offer belongs to Product. Unit belongs to Offer.
-- Deferred so a whole canonical graph can be inserted in any order in one txn.
CREATE OR REPLACE FUNCTION public.sourcing_check_canonical_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_grain public.sourcing_observation_grain;
BEGIN
  IF NEW.grain = 'product' THEN
    IF NEW.parent_entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'canonical hierarchy: product % cannot have parent', NEW.canonical_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.parent_entity_id IS NULL THEN
    RAISE EXCEPTION 'canonical hierarchy: % % requires parent', NEW.grain, NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT grain
    INTO parent_grain
    FROM public.sourcing_canonical_entities
   WHERE canonical_entity_id = NEW.parent_entity_id;

  IF NEW.grain = 'offer' AND parent_grain IS DISTINCT FROM 'product'::public.sourcing_observation_grain THEN
    RAISE EXCEPTION 'canonical hierarchy: offer % parent must be product', NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.grain = 'unit' AND parent_grain IS DISTINCT FROM 'offer'::public.sourcing_observation_grain THEN
    RAISE EXCEPTION 'canonical hierarchy: unit % parent must be offer', NEW.canonical_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sourcing_canonical_entities_hierarchy_guard
  AFTER INSERT OR UPDATE ON public.sourcing_canonical_entities
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_canonical_hierarchy();

CREATE INDEX sourcing_canonical_entities_parent_idx
  ON public.sourcing_canonical_entities (parent_entity_id)
  WHERE parent_entity_id IS NOT NULL;
CREATE INDEX sourcing_canonical_entities_grain_status_idx
  ON public.sourcing_canonical_entities (grain, status);
CREATE INDEX sourcing_canonical_entities_principal_idx
  ON public.sourcing_canonical_entities (principal_id)
  WHERE principal_id IS NOT NULL;

-- External identity namespace is technical/source-scoped, not principal-scoped.
CREATE TABLE public.sourcing_canonical_entity_refs (
  canonical_entity_id  uuid NOT NULL
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id) ON DELETE CASCADE,
  source_id            text NOT NULL
    REFERENCES public.sourcing_sources(source_id),
  ref_kind             text NOT NULL,
  ref_value            text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (source_id, ref_kind, ref_value),
  CONSTRAINT sourcing_canonical_entity_refs_kind_nonempty
    CHECK (btrim(ref_kind) <> ''),
  CONSTRAINT sourcing_canonical_entity_refs_value_nonempty
    CHECK (btrim(ref_value) <> '')
);

CREATE INDEX sourcing_canonical_entity_refs_entity_idx
  ON public.sourcing_canonical_entity_refs (canonical_entity_id);

-- ---------------------------------------------------------------------------
-- Candidate comparison / proposal
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_match_proposals (
  proposal_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_run_id      uuid NOT NULL,
  observation_id       uuid NOT NULL
    REFERENCES public.sourcing_observations(observation_id),
  grain                public.sourcing_observation_grain NOT NULL,
  candidate_entity_id  uuid NOT NULL,
  matcher_version      text NOT NULL,
  support_score        numeric(6,5) NOT NULL,
  contradiction_score  numeric(6,5) NOT NULL,
  coverage_score       numeric(6,5) NOT NULL,
  evidence_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_match_proposals_candidate_grain_fk
    FOREIGN KEY (candidate_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_match_proposals_matcher_nonempty
    CHECK (btrim(matcher_version) <> ''),
  CONSTRAINT sourcing_match_proposals_support_chk
    CHECK (support_score >= 0 AND support_score <= 1),
  CONSTRAINT sourcing_match_proposals_contradiction_chk
    CHECK (contradiction_score >= 0 AND contradiction_score <= 1),
  CONSTRAINT sourcing_match_proposals_coverage_chk
    CHECK (coverage_score >= 0 AND coverage_score <= 1),
  CONSTRAINT sourcing_match_proposals_run_candidate_uniq
    UNIQUE (proposal_run_id, observation_id, candidate_entity_id)
);

CREATE INDEX sourcing_match_proposals_observation_idx
  ON public.sourcing_match_proposals (observation_id, created_at DESC);
CREATE INDEX sourcing_match_proposals_candidate_idx
  ON public.sourcing_match_proposals (candidate_entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.sourcing_check_proposal_grain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
BEGIN
  SELECT grain
    INTO observed_grain
    FROM public.sourcing_observations
   WHERE observation_id = NEW.observation_id;

  IF observed_grain IS DISTINCT FROM NEW.grain THEN
    RAISE EXCEPTION 'resolution grain mismatch: observation % is %, proposal is %',
      NEW.observation_id, observed_grain, NEW.grain
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sourcing_match_proposals_grain_guard
  AFTER INSERT OR UPDATE ON public.sourcing_match_proposals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_proposal_grain();

-- ---------------------------------------------------------------------------
-- Sovereign resolution decisions
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_resolution_decisions (
  decision_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_type        text NOT NULL,
  grain                public.sourcing_observation_grain NOT NULL,
  proposal_id          uuid
    REFERENCES public.sourcing_match_proposals(proposal_id),
  observation_id       uuid
    REFERENCES public.sourcing_observations(observation_id),
  canonical_entity_id  uuid,
  related_entity_id    uuid,
  actor_type           text NOT NULL,
  actor_ref            text,
  rationale            text NOT NULL,
  evidence_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_resolution_decisions_type_chk
    CHECK (decision_type IN ('LINK', 'DISTINCT', 'REVIEW_REQUIRED', 'MERGE', 'SPLIT')),
  CONSTRAINT sourcing_resolution_decisions_actor_chk
    CHECK (actor_type IN ('human', 'rule', 'model', 'system')),
  CONSTRAINT sourcing_resolution_decisions_actor_ref_nonempty
    CHECK (actor_ref IS NULL OR btrim(actor_ref) <> ''),
  CONSTRAINT sourcing_resolution_decisions_human_actor_ref_chk
    CHECK (actor_type <> 'human' OR actor_ref IS NOT NULL),
  CONSTRAINT sourcing_resolution_decisions_rationale_nonempty
    CHECK (btrim(rationale) <> ''),
  CONSTRAINT sourcing_resolution_decisions_entity_grain_fk
    FOREIGN KEY (canonical_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_resolution_decisions_related_grain_fk
    FOREIGN KEY (related_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_resolution_decisions_distinct_entities_chk
    CHECK (related_entity_id IS NULL OR related_entity_id <> canonical_entity_id),
  CONSTRAINT sourcing_resolution_decisions_shape_chk
    CHECK (
      (decision_type = 'LINK'
       AND observation_id IS NOT NULL
       AND canonical_entity_id IS NOT NULL
       AND related_entity_id IS NULL)
      OR
      (decision_type = 'DISTINCT'
       AND observation_id IS NOT NULL
       AND canonical_entity_id IS NOT NULL
       AND related_entity_id IS NULL)
      OR
      (decision_type = 'REVIEW_REQUIRED'
       AND observation_id IS NOT NULL
       AND related_entity_id IS NULL)
      OR
      (decision_type IN ('MERGE', 'SPLIT')
       AND observation_id IS NULL
       AND canonical_entity_id IS NOT NULL
       AND related_entity_id IS NOT NULL)
    )
);

CREATE INDEX sourcing_resolution_decisions_observation_idx
  ON public.sourcing_resolution_decisions (observation_id, created_at DESC)
  WHERE observation_id IS NOT NULL;
CREATE INDEX sourcing_resolution_decisions_entity_idx
  ON public.sourcing_resolution_decisions (canonical_entity_id, created_at DESC)
  WHERE canonical_entity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sourcing_check_decision_grain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
  proposal_observation uuid;
  proposal_candidate uuid;
BEGIN
  IF NEW.observation_id IS NOT NULL THEN
    SELECT grain
      INTO observed_grain
      FROM public.sourcing_observations
     WHERE observation_id = NEW.observation_id;

    IF observed_grain IS DISTINCT FROM NEW.grain THEN
      RAISE EXCEPTION 'resolution grain mismatch: observation % is %, decision is %',
        NEW.observation_id, observed_grain, NEW.grain
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.proposal_id IS NOT NULL THEN
    SELECT observation_id, candidate_entity_id
      INTO proposal_observation, proposal_candidate
      FROM public.sourcing_match_proposals
     WHERE proposal_id = NEW.proposal_id;

    IF NEW.observation_id IS DISTINCT FROM proposal_observation THEN
      RAISE EXCEPTION 'resolution decision proposal observation mismatch'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.canonical_entity_id IS NOT NULL
       AND NEW.canonical_entity_id IS DISTINCT FROM proposal_candidate THEN
      RAISE EXCEPTION 'resolution decision proposal candidate mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sourcing_resolution_decisions_grain_guard
  AFTER INSERT OR UPDATE ON public.sourcing_resolution_decisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_decision_grain();

-- ---------------------------------------------------------------------------
-- Materialized current bindings (decision remains sovereign audit)
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_resolution_bindings (
  binding_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id        uuid NOT NULL
    REFERENCES public.sourcing_observations(observation_id),
  grain                 public.sourcing_observation_grain NOT NULL,
  canonical_entity_id   uuid NOT NULL,
  asserted_by_decision_id uuid NOT NULL
    REFERENCES public.sourcing_resolution_decisions(decision_id),
  ended_at               timestamptz,
  ended_by_decision_id   uuid
    REFERENCES public.sourcing_resolution_decisions(decision_id),
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_resolution_bindings_entity_grain_fk
    FOREIGN KEY (canonical_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_resolution_bindings_end_state_chk
    CHECK (
      (ended_at IS NULL AND ended_by_decision_id IS NULL)
      OR
      (ended_at IS NOT NULL AND ended_by_decision_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX sourcing_resolution_bindings_one_active_observation
  ON public.sourcing_resolution_bindings (observation_id)
  WHERE ended_at IS NULL;
CREATE INDEX sourcing_resolution_bindings_entity_active_idx
  ON public.sourcing_resolution_bindings (canonical_entity_id)
  WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.sourcing_check_binding_grain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observed_grain public.sourcing_observation_grain;
BEGIN
  SELECT grain
    INTO observed_grain
    FROM public.sourcing_observations
   WHERE observation_id = NEW.observation_id;

  IF observed_grain IS DISTINCT FROM NEW.grain THEN
    RAISE EXCEPTION 'resolution grain mismatch: observation % is %, binding is %',
      NEW.observation_id, observed_grain, NEW.grain
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sourcing_resolution_bindings_grain_guard
  AFTER INSERT OR UPDATE ON public.sourcing_resolution_bindings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_check_binding_grain();

-- ---------------------------------------------------------------------------
-- Explicit identity knowledge: MUST_LINK / CANNOT_LINK
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_identity_constraints (
  identity_constraint_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grain                   public.sourcing_observation_grain NOT NULL,
  left_entity_id          uuid NOT NULL,
  right_entity_id         uuid NOT NULL,
  constraint_type         text NOT NULL,
  asserted_by_decision_id uuid NOT NULL
    REFERENCES public.sourcing_resolution_decisions(decision_id),
  active                  boolean NOT NULL DEFAULT true,
  revoked_at              timestamptz,
  revoked_by_decision_id  uuid
    REFERENCES public.sourcing_resolution_decisions(decision_id),
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_identity_constraints_left_grain_fk
    FOREIGN KEY (left_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_identity_constraints_right_grain_fk
    FOREIGN KEY (right_entity_id, grain)
    REFERENCES public.sourcing_canonical_entities(canonical_entity_id, grain),
  CONSTRAINT sourcing_identity_constraints_type_chk
    CHECK (constraint_type IN ('MUST_LINK', 'CANNOT_LINK')),
  CONSTRAINT sourcing_identity_constraints_pair_chk
    CHECK (left_entity_id < right_entity_id),
  CONSTRAINT sourcing_identity_constraints_state_chk
    CHECK (
      (active = true AND revoked_at IS NULL AND revoked_by_decision_id IS NULL)
      OR
      (active = false AND revoked_at IS NOT NULL AND revoked_by_decision_id IS NOT NULL)
    )
);

-- Une paire ne peut jamais avoir simultanement deux verites actives opposees.
CREATE UNIQUE INDEX sourcing_identity_constraints_one_active_pair
  ON public.sourcing_identity_constraints (grain, left_entity_id, right_entity_id)
  WHERE active = true;

-- ---------------------------------------------------------------------------
-- Field merge policy, grain-scoped. Resolution preserves competing offers;
-- Selection will arbitrate offers later and is intentionally absent here.
-- ---------------------------------------------------------------------------

CREATE TABLE public.sourcing_merge_policies (
  policy_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grain           public.sourcing_observation_grain NOT NULL,
  field_key       text NOT NULL,
  strategy        text NOT NULL,
  policy_version  text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,

  CONSTRAINT sourcing_merge_policies_field_nonempty
    CHECK (btrim(field_key) <> ''),
  CONSTRAINT sourcing_merge_policies_version_nonempty
    CHECK (btrim(policy_version) <> ''),
  CONSTRAINT sourcing_merge_policies_strategy_chk
    CHECK (strategy IN (
      'prefer_high_confidence',
      'latest_observation',
      'source_priority',
      'require_review',
      'preserve_distinct'
    )),
  CONSTRAINT sourcing_merge_policies_state_chk
    CHECK (
      (active = true AND retired_at IS NULL)
      OR
      (active = false AND retired_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX sourcing_merge_policies_one_active_field
  ON public.sourcing_merge_policies (grain, field_key)
  WHERE active = true;

-- Proposal + Decision are audit facts: append-only. Bindings/constraints/policy
-- rows are materialized current state and may be closed/revoked/retired by a
-- future owner service while the sovereign decision history remains immutable.
CREATE OR REPLACE FUNCTION public.sourcing_forbid_resolution_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % interdit sur %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER sourcing_match_proposals_append_only
  BEFORE UPDATE OR DELETE ON public.sourcing_match_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_forbid_resolution_audit_mutation();

CREATE TRIGGER sourcing_resolution_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.sourcing_resolution_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.sourcing_forbid_resolution_audit_mutation();

COMMENT ON TABLE public.sourcing_commercial_principals IS
  'Shadow commercial identity. One Komerce principal may have refs in many sources.';
COMMENT ON TABLE public.sourcing_canonical_entities IS
  'Shadow canonical identity supertype product/offer/unit; stable IDs, not catalog authority in PR 1B.';
COMMENT ON TABLE public.sourcing_match_proposals IS
  'Candidate comparison facts: support, contradiction, coverage. Never sovereign truth.';
COMMENT ON TABLE public.sourcing_resolution_decisions IS
  'Append-only sovereign identity decisions LINK/DISTINCT/REVIEW/MERGE/SPLIT.';
COMMENT ON TABLE public.sourcing_resolution_bindings IS
  'Materialized current Observation -> Canonical binding derived from decisions.';
COMMENT ON TABLE public.sourcing_identity_constraints IS
  'Materialized MUST_LINK/CANNOT_LINK knowledge; reversible only through an audited decision.';
COMMENT ON TABLE public.sourcing_merge_policies IS
  'Grain-scoped field projection policy. Does not select a winning supplier offer.';

-- Pas de backfill. Pas de writer runtime. Pas de lecture prod dans PR 1B.
