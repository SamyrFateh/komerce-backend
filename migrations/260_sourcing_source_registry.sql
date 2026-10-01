-- @migration 260_sourcing_source_registry.sql
-- @domain    sourcing
-- @purpose   Registre opérateur des sources : (1) mémoriser le dernier test de connexion
--            d'une source, séparé de la certification ; (2) enregistrer une demande de
--            fournisseur sans connecteur, sans jamais en faire une source exploitable.
--
-- Additif et fail-closed : aucune colonne existante modifiée, aucune source créée ici,
-- autopilot et capacités inchangés. Le reset clean-room préserve sourcing_sources.

ALTER TABLE public.sourcing_sources
  ADD COLUMN IF NOT EXISTS connection_test_status text,
  ADD COLUMN IF NOT EXISTS connection_test_code text,
  ADD COLUMN IF NOT EXISTS connection_tested_at timestamptz;

ALTER TABLE public.sourcing_sources
  DROP CONSTRAINT IF EXISTS sourcing_sources_connection_test_status_chk;
ALTER TABLE public.sourcing_sources
  ADD CONSTRAINT sourcing_sources_connection_test_status_chk
  CHECK (connection_test_status IS NULL OR connection_test_status IN ('ok', 'failed'));

COMMENT ON COLUMN public.sourcing_sources.connection_test_status IS
  'Résultat du dernier test de connexion opérateur (ok/failed). Informatif : ce n''est jamais une certification runtime.';
COMMENT ON COLUMN public.sourcing_sources.connection_test_code IS
  'Code métier court du dernier échec de test (jamais de message brut fournisseur ni de secret).';

CREATE TABLE IF NOT EXISTS public.sourcing_source_requests (
  request_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name   text NOT NULL,
  requested_label text NOT NULL,
  reference_url   text,
  status          text NOT NULL DEFAULT 'connector_required',
  requested_by    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_source_requests_provider_nonempty CHECK (btrim(provider_name) <> ''),
  CONSTRAINT sourcing_source_requests_label_nonempty CHECK (btrim(requested_label) <> ''),
  CONSTRAINT sourcing_source_requests_reference_nonempty
    CHECK (reference_url IS NULL OR btrim(reference_url) <> ''),
  CONSTRAINT sourcing_source_requests_status_chk CHECK (status IN ('connector_required'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sourcing_source_requests_provider
  ON public.sourcing_source_requests (lower(btrim(provider_name)));

COMMENT ON TABLE public.sourcing_source_requests IS
  'Fournisseurs demandés sans connecteur Komerce. Jamais une source : aucun autopilot, aucune capacité, aucune capture, aucun lien avec sourcing_sources.';
