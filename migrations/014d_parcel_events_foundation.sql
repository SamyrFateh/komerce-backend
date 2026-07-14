-- Migration 014d — parcel_events foundation (LOT R2, DEBT-05)
--
-- Contexte : parcel_events n'a jamais existé en tant que migration
-- versionnée avant 078_parcels_security_columns.sql. Or
-- 016_add_missing_indexes.sql crée déjà un index sur parcel_events
-- (idx_parcel_events_parcel_id) — cette table doit donc exister AVANT 016,
-- pas seulement avant 078. Sur prod, ça fonctionnait car
-- services/parcel-security.js::ensureSecurityTables() créait la table au
-- boot, bien avant que ces migrations existent. Confirmé par LOT R1 (W0-1).
--
-- Cette migration pose uniquement la fondation (table + 3 index déjà
-- présents dans 078, répétés ici en amont — 100% idempotent, IF NOT EXISTS
-- partout, donc 078 reste sans danger derrière). Les colonnes de sécurité
-- sur `parcels` (external_code, seal_code, ...) restent ajoutées par 078,
-- qui est déjà correcte et versionnée pour ça.
--
-- Contrat reproduit EXACTEMENT depuis docs/db/railway-live-schema.sql.

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
