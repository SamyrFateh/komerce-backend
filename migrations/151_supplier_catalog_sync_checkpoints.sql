-- CJ full-catalog sync — resumable supplier/category checkpoints.
-- Feature owner: catalog.

CREATE TABLE IF NOT EXISTS supplier_catalog_sync_checkpoints (
  supplier_name      TEXT        NOT NULL,
  sync_key           TEXT        NOT NULL,
  category_id        TEXT        NOT NULL,
  category_path      TEXT,
  next_page          INTEGER     NOT NULL DEFAULT 1 CHECK (next_page >= 1),
  total_pages        INTEGER     CHECK (total_pages IS NULL OR total_pages >= 0),
  total_records      INTEGER     CHECK (total_records IS NULL OR total_records >= 0),
  api_calls          INTEGER     NOT NULL DEFAULT 0 CHECK (api_calls >= 0),
  accepted_items     INTEGER     NOT NULL DEFAULT 0 CHECK (accepted_items >= 0),
  rejected_items     INTEGER     NOT NULL DEFAULT 0 CHECK (rejected_items >= 0),
  capped_by_supplier BOOLEAN     NOT NULL DEFAULT FALSE,
  completed          BOOLEAN     NOT NULL DEFAULT FALSE,
  last_request_id    TEXT,
  last_error         TEXT,
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (supplier_name, sync_key, category_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_sync_pending
  ON supplier_catalog_sync_checkpoints (supplier_name, sync_key, completed, updated_at);
