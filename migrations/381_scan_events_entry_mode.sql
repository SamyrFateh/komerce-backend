-- L11 — Mode dégradé traçable : un scan est soit matériel (`scan`), soit une confirmation manuelle depuis l'interface.
-- Colonne dérivée de metadata (source unique, non falsifiable séparément) et contrainte sur les valeurs admises.
ALTER TABLE scan_events
  ADD COLUMN IF NOT EXISTS entry_mode text
  GENERATED ALWAYS AS (COALESCE(metadata->>'entry_mode', 'scan')) STORED;

ALTER TABLE scan_events DROP CONSTRAINT IF EXISTS scan_events_entry_mode_check;
ALTER TABLE scan_events ADD CONSTRAINT scan_events_entry_mode_check
  CHECK (entry_mode IN ('scan', 'manual_confirmation'));

-- Une confirmation manuelle exige un motif.
ALTER TABLE scan_events DROP CONSTRAINT IF EXISTS scan_events_manual_reason_check;
ALTER TABLE scan_events ADD CONSTRAINT scan_events_manual_reason_check
  CHECK (entry_mode <> 'manual_confirmation' OR NULLIF(btrim(metadata->>'manual_reason'), '') IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_scan_events_entry_mode ON scan_events(entry_mode) WHERE entry_mode <> 'scan';
