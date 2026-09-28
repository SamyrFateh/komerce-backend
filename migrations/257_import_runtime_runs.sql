-- @migration 257_import_runtime_runs.sql
-- @domain sourcing
-- Projection d'un run d'import réel pour le suivi live Sourcing -> Catalogue.
-- Les compteurs métier restent dérivés des autorités canoniques existantes.

CREATE SEQUENCE IF NOT EXISTS import_runtime_run_ref_seq START 1;

CREATE TABLE IF NOT EXISTS import_runtime_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_ref        TEXT NOT NULL DEFAULT ('KIR-' || LPAD(nextval('import_runtime_run_ref_seq')::text, 6, '0')),
  provider       TEXT NOT NULL,
  source_type    TEXT NOT NULL,
  source_ref     TEXT,
  import_id      UUID REFERENCES supplier_catalog_imports(id) ON DELETE SET NULL,
  mode           TEXT NOT NULL DEFAULT 'normal'
                 CHECK (mode IN ('normal', 'replay', 'reconstruction')),
  status         TEXT NOT NULL DEFAULT 'RUNNING'
                 CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  source_total   INTEGER NOT NULL DEFAULT 0 CHECK (source_total >= 0),
  stages         JSONB NOT NULL DEFAULT '{}'::jsonb,
  intake         JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT,
  started_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_runtime_runs_run_ref
  ON import_runtime_runs(run_ref);
CREATE INDEX IF NOT EXISTS idx_import_runtime_runs_import
  ON import_runtime_runs(import_id);
CREATE INDEX IF NOT EXISTS idx_import_runtime_runs_started
  ON import_runtime_runs(started_at DESC);
