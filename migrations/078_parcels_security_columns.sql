-- ============================================================================
-- Migration 078 — Parcels security columns + parcel_events table
-- FRESH-020 : DDL sorti de services/parcel-security.js (ensureSecurityTables)
-- ============================================================================
-- 100% idempotent : IF NOT EXISTS sur tout.
-- Remplace le DDL inline — ensureSecurityTables() peut être vidée après
-- confirmation que cette migration est appliquée en prod.
-- ============================================================================

-- 1. Table parcel_events
CREATE TABLE IF NOT EXISTS parcel_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID REFERENCES users(id),
  location    TEXT,
  weight_kg   NUMERIC(6,2),
  notes       TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcel_events_parcel_id ON parcel_events(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_events_type      ON parcel_events(event_type);
CREATE INDEX IF NOT EXISTS idx_parcel_events_created   ON parcel_events(created_at);

-- 2. Colonnes sécurité sur parcels (ADD COLUMN IF NOT EXISTS, PG >= 9.6)
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS external_code        TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS seal_code            TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS last_weight_kg       NUMERIC(6,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS last_weight_at       TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS last_weight_location TEXT;

-- 3. Index unique sur external_code (partial, ignore NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_external_code
  ON parcels(external_code) WHERE external_code IS NOT NULL;
