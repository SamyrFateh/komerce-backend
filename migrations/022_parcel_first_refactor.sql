-- ════════════════════════════════════════════════════════════════
-- Migration 022: PARCEL-FIRST REFACTORING
-- Date: 2025-04-14
-- 
-- OBJECTIF: Faire du colis l'unité opérationnelle réelle.
--   - Tracking quantités par étape (allocation → collection)
--   - scan_events = source de vérité (append-only)
--   - incidents = écarts avec impact client
--   - Triggers anti-erreur (contraintes quantités, expédition)
--   - Soft-delete uniquement (jamais de suppression dure)
--   - Vue réconciliation temps réel
--
-- PRINCIPE: qty_ordered >= qty_allocated >= qty_packed 
--           >= qty_shipped >= qty_received >= qty_collected
--
-- IDEMPOTENT: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS partout
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- A. ENRICHISSEMENT order_items — colonnes de quantité
-- ══════════════════════════════════════════════════════════════

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_ordered    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_allocated  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_packed     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_shipped    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_received   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_collected  INTEGER NOT NULL DEFAULT 0;

-- Backfill: qty_ordered = quantity existante
UPDATE order_items 
SET qty_ordered = COALESCE(quantity, 1) 
WHERE qty_ordered = 1 AND quantity IS NOT NULL AND quantity > 1;

-- ══════════════════════════════════════════════════════════════
-- B. ENRICHISSEMENT parcel_items — quantités par étape
-- ══════════════════════════════════════════════════════════════

ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS qty_allocated  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS qty_packed     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS qty_shipped    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS qty_received   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS qty_collected  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS verified       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS verified_at    TIMESTAMPTZ;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS verified_by    UUID;
ALTER TABLE parcel_items ADD COLUMN IF NOT EXISTS product_name   TEXT;

-- Backfill: items existants = alloués avec leur quantity
UPDATE parcel_items 
SET qty_allocated = COALESCE(quantity, 1) 
WHERE qty_allocated = 0 AND COALESCE(quantity, 1) > 0;

-- ══════════════════════════════════════════════════════════════
-- C. ENRICHISSEMENT parcels — vérification, poids, destination
-- ══════════════════════════════════════════════════════════════

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS shipped_at          TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS verified_by         UUID;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS verification_notes  TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS expected_weight_kg  NUMERIC(6,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS actual_weight_kg    NUMERIC(6,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS destination_relais  TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_name      TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_phone     TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS items_count         INTEGER DEFAULT 0;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS total_qty           INTEGER DEFAULT 0;

-- Backfill items_count et total_qty
UPDATE parcels p SET 
  items_count = sub.cnt,
  total_qty = sub.total
FROM (
  SELECT parcel_id, COUNT(*) AS cnt, COALESCE(SUM(COALESCE(quantity, 1)), 0) AS total
  FROM parcel_items
  GROUP BY parcel_id
) sub
WHERE sub.parcel_id = p.id AND (p.items_count IS NULL OR p.items_count = 0);

-- ══════════════════════════════════════════════════════════════
-- D. TABLE scan_events — journal APPEND-ONLY de tous les scans
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scan_events (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  parcel_id       UUID        NOT NULL REFERENCES parcels(id) ON DELETE RESTRICT,
  order_id        UUID        REFERENCES orders(id) ON DELETE SET NULL,
  event_type      TEXT        NOT NULL,
  -- Types: preparation_started, item_scanned, packed, sealed,
  --        weight_check, ready_to_ship, shipped,
  --        transit_confirmed, relais_received, content_verified,
  --        customer_collected, pickup_failed,
  --        anomaly_detected, correction
  scan_code       TEXT,
  scanned_by      UUID        REFERENCES users(id),
  actor_name      TEXT,
  actor_role      TEXT        CHECK (actor_role IN ('hub_agent', 'relay_agent', 'driver', 'system', 'admin')),
  location        TEXT,
  latitude        NUMERIC(10,7),
  longitude       NUMERIC(10,7),
  device_id       TEXT,
  notes           TEXT,
  metadata        JSONB       DEFAULT '{}',
  -- Snapshot des quantités AVANT et APRÈS le scan
  qty_before      JSONB       DEFAULT '{}',
  qty_after       JSONB       DEFAULT '{}',
  -- Résultat du scan
  status          TEXT        NOT NULL DEFAULT 'applied'
                              CHECK (status IN ('applied', 'rejected', 'needs_review', 'reversed')),
  error_message   TEXT,
  -- Lien correction : si cet événement corrige un précédent
  corrects_event_id UUID     REFERENCES scan_events(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROTECTION: Interdire la suppression de scan_events
CREATE OR REPLACE FUNCTION prevent_scan_event_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La suppression de scan_events est interdite. Utilisez status=reversed pour annuler.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_scan_event_delete') THEN
    CREATE TRIGGER trg_prevent_scan_event_delete
      BEFORE DELETE ON scan_events
      FOR EACH ROW EXECUTE FUNCTION prevent_scan_event_delete();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- E. TABLE incidents — gestion complète des écarts
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Contexte
  parcel_id           UUID        REFERENCES parcels(id) ON DELETE SET NULL,
  order_id            UUID        REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id       UUID,
  scan_event_id       UUID        REFERENCES scan_events(id) ON DELETE SET NULL,
  -- Classification
  incident_type       TEXT        NOT NULL
                                  CHECK (incident_type IN (
                                    'content_mismatch', 'missing_item', 'unexpected_item',
                                    'damaged_item', 'weight_mismatch', 'quantity_mismatch',
                                    'scan_anomaly', 'sequence_violation',
                                    'delay', 'blocked',
                                    'payment_issue', 'reconciliation_error'
                                  )),
  severity            TEXT        NOT NULL DEFAULT 'medium'
                                  CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status              TEXT        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  -- Description
  title               TEXT        NOT NULL,
  description         TEXT,
  details             JSONB       DEFAULT '{}',
  -- Impact client
  client_impact       TEXT        DEFAULT 'none'
                                  CHECK (client_impact IN ('none', 'delayed', 'partial_delivery', 'wrong_item', 'blocked')),
  client_notified     BOOLEAN     NOT NULL DEFAULT false,
  client_notification TEXT,
  -- Détection
  detected_by         UUID        REFERENCES users(id),
  detected_source     TEXT        DEFAULT 'system'
                                  CHECK (detected_source IN ('system', 'hub_agent', 'relay_agent', 'driver', 'customer', 'admin', 'reconciliation')),
  -- Résolution
  resolution          JSONB,
  resolution_type     TEXT        CHECK (resolution_type IN ('reship', 'refund', 'manual_fix', 'dismissed', 'auto_resolved', NULL)),
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID        REFERENCES users(id),
  -- Lien parent (chaîner incidents liés)
  parent_incident_id  UUID        REFERENCES incidents(id),
  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROTECTION: Interdire la suppression d'incidents
CREATE OR REPLACE FUNCTION prevent_incident_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La suppression d''incidents est interdite. Utilisez status=dismissed pour fermer.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_incident_delete') THEN
    CREATE TRIGGER trg_prevent_incident_delete
      BEFORE DELETE ON incidents
      FOR EACH ROW EXECUTE FUNCTION prevent_incident_delete();
  END IF;
END $$;

-- Trigger updated_at pour incidents (utilise set_updated_at si elle existe)
DO $$ BEGIN
  -- Vérifier si set_updated_at existe, sinon la créer
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $fn$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_incidents_updated') THEN
    CREATE TRIGGER trg_incidents_updated
      BEFORE UPDATE ON incidents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- F. CONTRAINTES ANTI-ERREUR (TRIGGERS)
-- ══════════════════════════════════════════════════════════════

-- F1: Cohérence quantités parcel_items
CREATE OR REPLACE FUNCTION check_parcel_item_quantities()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qty_packed > NEW.qty_allocated THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_packed (%) > qty_allocated (%) pour parcel_item %', 
      NEW.qty_packed, NEW.qty_allocated, NEW.id;
  END IF;
  IF NEW.qty_shipped > NEW.qty_packed THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_shipped (%) > qty_packed (%) pour parcel_item %', 
      NEW.qty_shipped, NEW.qty_packed, NEW.id;
  END IF;
  IF NEW.qty_received > NEW.qty_shipped THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_received (%) > qty_shipped (%) pour parcel_item %', 
      NEW.qty_received, NEW.qty_shipped, NEW.id;
  END IF;
  IF NEW.qty_collected > NEW.qty_received THEN
    RAISE EXCEPTION 'ANTI-ERREUR: qty_collected (%) > qty_received (%) pour parcel_item %', 
      NEW.qty_collected, NEW.qty_received, NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_check_parcel_item_qty ON parcel_items;
  CREATE TRIGGER trg_check_parcel_item_qty
    BEFORE INSERT OR UPDATE ON parcel_items
    FOR EACH ROW EXECUTE FUNCTION check_parcel_item_quantities();
END $$;

-- F2: Empêcher expédition sans destination
CREATE OR REPLACE FUNCTION check_parcel_ship_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'shipped' AND (OLD.status IS NULL OR OLD.status != 'shipped') THEN
    IF NEW.relais_id IS NULL AND NEW.destination_relais IS NULL THEN
      RAISE EXCEPTION 'ANTI-ERREUR: Impossible d''expédier colis % sans destination', NEW.reference;
    END IF;
  END IF;
  -- Empêcher collected sans available/arrived
  IF NEW.status = 'collected' AND OLD.status NOT IN ('available', 'arrived') THEN
    RAISE EXCEPTION 'ANTI-ERREUR: Colis % ne peut pas passer à collected depuis %', NEW.reference, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_parcel_ship_guard ON parcels;
  CREATE TRIGGER trg_parcel_ship_guard
    BEFORE UPDATE ON parcels
    FOR EACH ROW EXECUTE FUNCTION check_parcel_ship_guard();
END $$;

-- F3: Empêcher suppression de parcels/parcel_items (soft-delete only)
CREATE OR REPLACE FUNCTION prevent_hard_delete_parcels()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite sur %. Utilisez status=cancelled.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_no_delete_parcels') THEN
    CREATE TRIGGER trg_no_delete_parcels
      BEFORE DELETE ON parcels
      FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_parcels();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- G. INDEX PERFORMANCE
-- ══════════════════════════════════════════════════════════════

-- scan_events
CREATE INDEX IF NOT EXISTS idx_scan_events_parcel      ON scan_events(parcel_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_type        ON scan_events(event_type);
CREATE INDEX IF NOT EXISTS idx_scan_events_created     ON scan_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_actor       ON scan_events(scanned_by);
CREATE INDEX IF NOT EXISTS idx_scan_events_order       ON scan_events(order_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_status      ON scan_events(status);

-- incidents
CREATE INDEX IF NOT EXISTS idx_incidents_parcel        ON incidents(parcel_id);
CREATE INDEX IF NOT EXISTS idx_incidents_order         ON incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_type          ON incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_incidents_status        ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity      ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_open          ON incidents(status) WHERE status IN ('open', 'investigating');
CREATE INDEX IF NOT EXISTS idx_incidents_critical      ON incidents(severity, status) WHERE severity IN ('high', 'critical') AND status = 'open';

-- parcels enrichis
CREATE INDEX IF NOT EXISTS idx_parcels_verification    ON parcels(verification_status);
CREATE INDEX IF NOT EXISTS idx_parcel_items_verified   ON parcel_items(verified);

-- order_items quantités
CREATE INDEX IF NOT EXISTS idx_order_items_allocated   ON order_items(qty_allocated) WHERE qty_allocated > 0;

-- ══════════════════════════════════════════════════════════════
-- H. VUE RÉCONCILIATION — état fulfillment par commande
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_order_fulfillment AS
SELECT 
  o.id AS order_id,
  o.reference AS order_ref,
  o.status AS order_status,
  o.created_at AS order_date,
  -- Compteurs colis
  COUNT(DISTINCT p.id) AS total_parcels,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'collected') AS parcels_collected,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'available') AS parcels_available,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('shipped', 'in_transit')) AS parcels_in_transit,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('draft', 'preparation')) AS parcels_pending,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'cancelled') AS parcels_cancelled,
  -- Quantités agrégées (from parcel_items)
  COALESCE(SUM(pi.qty_allocated), 0) AS total_allocated,
  COALESCE(SUM(pi.qty_packed), 0) AS total_packed,
  COALESCE(SUM(pi.qty_shipped), 0) AS total_shipped,
  COALESCE(SUM(pi.qty_received), 0) AS total_received,
  COALESCE(SUM(pi.qty_collected), 0) AS total_collected,
  -- Total commandé (from order_items)
  COALESCE(oi_agg.total_ordered, 0) AS total_ordered,
  -- Incidents
  COUNT(DISTINCT inc.id) FILTER (WHERE inc.status IN ('open', 'investigating')) AS open_incidents,
  COUNT(DISTINCT inc.id) FILTER (WHERE inc.severity IN ('high', 'critical') AND inc.status = 'open') AS critical_incidents,
  -- Statut calculé
  CASE
    WHEN COUNT(DISTINCT p.id) = 0 THEN 'awaiting_allocation'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status NOT IN ('cancelled')) = 0 THEN 'cancelled'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'collected') = COUNT(DISTINCT p.id) FILTER (WHERE p.status NOT IN ('cancelled')) THEN 'fulfilled'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'collected') > 0 THEN 'partially_fulfilled'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('shipped', 'in_transit')) > 0 THEN 'in_transit'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('available', 'arrived')) > 0 THEN 'ready_for_pickup'
    WHEN COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('draft', 'preparation')) > 0 THEN 'in_preparation'
    ELSE 'unknown'
  END AS computed_status
FROM orders o
LEFT JOIN parcels p ON p.order_id = o.id
LEFT JOIN parcel_items pi ON pi.parcel_id = p.id
LEFT JOIN incidents inc ON inc.order_id = o.id
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(qty_ordered, quantity, 1)) AS total_ordered
  FROM order_items WHERE order_id = o.id
) oi_agg ON true
GROUP BY o.id, o.reference, o.status, o.created_at, oi_agg.total_ordered;

-- ══════════════════════════════════════════════════════════════
-- I. VUE TRAÇABILITÉ — parcours complet d'un colis
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_parcel_trace AS
SELECT 
  p.id AS parcel_id,
  p.reference AS parcel_ref,
  p.status AS parcel_status,
  p.order_id,
  o.reference AS order_ref,
  p.relais_id,
  r.name AS relais_name,
  p.verification_status,
  p.expected_weight_kg,
  p.actual_weight_kg,
  p.items_count,
  p.total_qty,
  p.created_at AS parcel_created,
  p.shipped_at,
  -- Dériver received_at et collected_at depuis les scan_events
  (SELECT MIN(se2.created_at) FROM scan_events se2 
   WHERE se2.parcel_id = p.id AND se2.event_type = 'relais_received' AND se2.status = 'applied') AS received_at,
  (SELECT MIN(se3.created_at) FROM scan_events se3 
   WHERE se3.parcel_id = p.id AND se3.event_type = 'customer_collected' AND se3.status = 'applied') AS collected_at,
  -- Dernier scan
  last_scan.event_type AS last_event_type,
  last_scan.created_at AS last_event_at,
  last_scan.actor_name AS last_actor,
  -- Compteur scans
  (SELECT COUNT(*) FROM scan_events se WHERE se.parcel_id = p.id AND se.status = 'applied') AS scan_count,
  -- Incidents ouverts
  (SELECT COUNT(*) FROM incidents i WHERE i.parcel_id = p.id AND i.status IN ('open', 'investigating')) AS open_incidents
FROM parcels p
LEFT JOIN orders o ON o.id = p.order_id
LEFT JOIN relais r ON r.id = p.relais_id
LEFT JOIN LATERAL (
  SELECT event_type, created_at, actor_name
  FROM scan_events 
  WHERE parcel_id = p.id AND status = 'applied'
  ORDER BY created_at DESC LIMIT 1
) last_scan ON true;

COMMIT;
