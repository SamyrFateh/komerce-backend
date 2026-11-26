-- @migration 430_economic_cost_center_reference.sql
-- @domain economic-engine
-- @purpose ECO-1a: administrative reference hierarchy, independent of economic facts.
-- No data seed, no live activation, no new writer of expenses or attributions.
-- Structure references use existing charges; operational costs retain their own sources.
CREATE TABLE public.economic_cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES public.markets(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  responsible_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_cost_center_active_owner CHECK (NOT is_active OR responsible_user_id IS NOT NULL),
  CONSTRAINT economic_cost_center_scope_code UNIQUE NULLS NOT DISTINCT (market_id, code)
);
COMMENT ON COLUMN public.economic_cost_centers.market_id IS 'NULL = group center; non-NULL = exact market. No implied mutation authorization.';
CREATE TABLE public.economic_cost_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.economic_cost_centers(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  UNIQUE (center_id, code),
  UNIQUE (center_id, id)
);
CREATE TABLE public.economic_cost_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.economic_cost_centers(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  resource_kind text NOT NULL CHECK (char_length(btrim(resource_kind)) BETWEEN 1 AND 80),
  UNIQUE (center_id, code),
  UNIQUE (center_id, id)
);
CREATE TABLE public.economic_cost_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES public.economic_cost_centers(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  resource_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  economic_nature text NOT NULL CHECK (economic_nature IN ('FIXED', 'VARIABLE', 'MIXED')),
  allocation_perimeter text NOT NULL CHECK (allocation_perimeter IN ('DIRECT', 'MUTUALIZED')),
  allocation_basis text NOT NULL CHECK (char_length(btrim(allocation_basis)) BETWEEN 1 AND 200),
  structure_charge_id uuid UNIQUE REFERENCES public.charges(id) ON DELETE RESTRICT,
  UNIQUE (family_id, code),
  CONSTRAINT economic_cost_post_family_scope FOREIGN KEY (center_id, family_id)
    REFERENCES public.economic_cost_families(center_id, id) ON DELETE RESTRICT,
  CONSTRAINT economic_cost_post_resource_scope FOREIGN KEY (center_id, resource_id)
    REFERENCES public.economic_cost_resources(center_id, id) ON DELETE RESTRICT,
  CONSTRAINT economic_cost_post_structure_fixed CHECK (structure_charge_id IS NULL OR economic_nature = 'FIXED')
);
COMMENT ON TABLE public.economic_cost_posts IS 'Administrative metadata only; never a ledger of realized expenses. A structure link represents a fixed component; mixed components must be split at source before recognition.';
CREATE OR REPLACE FUNCTION public.economic_cost_post_guard_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  center_market uuid;
  charge_market uuid;
BEGIN
  IF NEW.structure_charge_id IS NULL THEN RETURN NEW; END IF;
  SELECT market_id INTO STRICT center_market FROM public.economic_cost_centers WHERE id = NEW.center_id FOR SHARE;
  SELECT market_owner_id INTO STRICT charge_market FROM public.charges WHERE id = NEW.structure_charge_id FOR SHARE;
  IF center_market IS DISTINCT FROM charge_market THEN
    RAISE EXCEPTION 'economic_cost_post_structure_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_economic_cost_post_guard_scope
  BEFORE INSERT OR UPDATE OF center_id, structure_charge_id ON public.economic_cost_posts
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_post_guard_scope();
-- A linked reference cannot silently move markets or be reclassified by a scope edit.
CREATE OR REPLACE FUNCTION public.economic_cost_center_guard_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'economic_cost_center_scope_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_economic_cost_center_guard_scope
  BEFORE UPDATE OF market_id ON public.economic_cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_center_guard_scope();
-- Do not let changing an existing charge owner break the reference's scope.
CREATE OR REPLACE FUNCTION public.economic_cost_reference_guard_charge_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.market_owner_id IS DISTINCT FROM OLD.market_owner_id AND EXISTS (
    SELECT 1 FROM public.economic_cost_posts p WHERE p.structure_charge_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'economic_cost_reference_charge_scope_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_economic_cost_reference_guard_charge_scope
  BEFORE UPDATE OF market_owner_id ON public.charges
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_reference_guard_charge_scope();
CREATE INDEX idx_economic_cost_posts_center_family ON public.economic_cost_posts(center_id, family_id);
