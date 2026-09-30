-- @migration 258_import_runtime_item_events.sql
-- @domain sourcing
-- Traitement par produit d'un run d'import réel : début, fin, issue.
-- Additif et best-effort : une panne d'écriture ne doit jamais faire échouer un import.
-- Les compteurs métier restent dérivés des autorités canoniques (aucune comptabilité parallèle).

CREATE TABLE IF NOT EXISTS import_runtime_item_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES import_runtime_runs(id) ON DELETE CASCADE,
  seq                 INTEGER NOT NULL CHECK (seq > 0),
  candidate_id        UUID REFERENCES sourcing_candidates(id) ON DELETE SET NULL,
  supplier_product_id TEXT,
  product_name        TEXT,
  image_url           TEXT,
  purchase_price      NUMERIC(12,2),
  currency            TEXT,
  stage               TEXT NOT NULL DEFAULT 'REFINERY',
  outcome             TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  CONSTRAINT uq_import_runtime_item_events_run_seq UNIQUE (run_id, seq),
  CONSTRAINT chk_import_runtime_item_events_finish
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_import_runtime_item_events_run_seq
  ON import_runtime_item_events(run_id, seq DESC);
