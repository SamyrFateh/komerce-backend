-- @migration 233_hub_physical_identity_allocation_custody.sql
-- @domain    logistics
-- @purpose   HUB-001 — séparer l'allocation économique immuable de la
--            manipulation physique Hub (identity, placement, custody).
--
-- Doctrine :
--   - Purchasing reste autorité de purchase_orders et de la Supplier Order Identity.
--   - Market/Orders restent autorité de la destination commerciale.
--   - Hub snapshotte ces faits ; il ne les répare ni ne les réassigne.
--   - Un inbound supplier package peut être multi-market.
--   - Tout outbound PACKED/DISPATCHED doit être mono-market.
--   - SPLIT/MERGE/REPACK ne déplacent que des placements physiques.
--   - L'historique custody est append-only.

CREATE TABLE IF NOT EXISTS hub_purchase_allocations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id       uuid NOT NULL UNIQUE REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  order_id                uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id           uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  product_sku_id          uuid NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  supplier_id             uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_unit_ref       text NOT NULL CHECK (btrim(supplier_unit_ref) <> ''),
  supplier_order_identity jsonb NOT NULL,
  quantity                integer NOT NULL CHECK (quantity > 0),
  market_id               uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  destination_ref         text NOT NULL CHECK (btrim(destination_ref) <> ''),
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_hub_purchase_allocation_soi_shape CHECK (
    jsonb_typeof(supplier_order_identity) = 'object'
    AND jsonb_typeof(supplier_order_identity->'provider') = 'string'
    AND btrim(supplier_order_identity->>'provider') <> ''
    AND jsonb_typeof(supplier_order_identity->'version') = 'number'
    AND (supplier_order_identity->>'version') ~ '^[0-9]+$'
    AND (supplier_order_identity->>'version')::integer >= 1
    AND jsonb_typeof(supplier_order_identity->'payload') = 'object'
    AND supplier_order_identity->'payload' <> '{}'::jsonb
  )
);

CREATE TABLE IF NOT EXISTS hub_physical_units (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE CHECK (btrim(reference) <> ''),
  unit_type              text NOT NULL CHECK (unit_type IN ('SUPPLIER_PACKAGE', 'HANDLING_UNIT', 'MARKET_PARCEL')),
  state                  text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN (
                           'RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED',
                           'ALLOCATED', 'PICKED', 'PACKED', 'DISPATCHED',
                           'QUARANTINED', 'SUPERSEDED'
                         )),
  external_ref           text,
  market_id              uuid REFERENCES markets(id) ON DELETE RESTRICT,
  current_location_ref   text,
  outcome_type           text CHECK (outcome_type IS NULL OR outcome_type IN (
                           'LOST', 'STOLEN', 'DESTROYED', 'DAMAGED_UNUSABLE'
                         )),
  outcome_recorded_at    timestamptz,
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_hub_physical_outcome_timestamp CHECK (
    (outcome_type IS NULL AND outcome_recorded_at IS NULL)
    OR (outcome_type IS NOT NULL AND outcome_recorded_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS hub_physical_unit_placements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  physical_unit_id  uuid NOT NULL REFERENCES hub_physical_units(id) ON DELETE RESTRICT,
  allocation_id     uuid NOT NULL REFERENCES hub_purchase_allocations(id) ON DELETE RESTRICT,
  quantity          integer NOT NULL CHECK (quantity > 0),
  operation_id      uuid,
  operation_type    text CHECK (operation_type IS NULL OR operation_type IN ('RECEIVE', 'SPLIT', 'MERGE', 'REPACK')),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  placed_at         timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,

  CONSTRAINT chk_hub_placement_time_order CHECK (removed_at IS NULL OR removed_at > placed_at)
);

CREATE TABLE IF NOT EXISTS hub_custody_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  physical_unit_id  uuid NOT NULL REFERENCES hub_physical_units(id) ON DELETE RESTRICT,
  event_type        text NOT NULL CHECK (event_type IN (
                       'STATE_TRANSITION', 'PLACEMENT_IN', 'PLACEMENT_OUT',
                       'OUTCOME_REPORTED', 'QUARANTINE'
                     )),
  from_state        text,
  to_state          text,
  allocation_id     uuid REFERENCES hub_purchase_allocations(id) ON DELETE RESTRICT,
  quantity          integer CHECK (quantity IS NULL OR quantity > 0),
  operation_id      uuid,
  operation_type    text CHECK (operation_type IS NULL OR operation_type IN ('RECEIVE', 'SPLIT', 'MERGE', 'REPACK')),
  actor_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  location_ref      text,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_purchase_allocations_order
  ON hub_purchase_allocations(order_id, order_item_id);
CREATE INDEX IF NOT EXISTS idx_hub_purchase_allocations_market
  ON hub_purchase_allocations(market_id);
CREATE INDEX IF NOT EXISTS idx_hub_physical_units_state
  ON hub_physical_units(state);
CREATE INDEX IF NOT EXISTS idx_hub_physical_units_market
  ON hub_physical_units(market_id) WHERE market_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_placements_unit_active
  ON hub_physical_unit_placements(physical_unit_id, allocation_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_placements_allocation_active
  ON hub_physical_unit_placements(allocation_id, physical_unit_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_custody_events_unit_time
  ON hub_custody_events(physical_unit_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_hub_custody_events_operation
  ON hub_custody_events(operation_id) WHERE operation_id IS NOT NULL;

-- Economic allocation is a snapshot, never a mutable routing object.
CREATE OR REPLACE FUNCTION hub_reject_purchase_allocation_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hub_purchase_allocation_immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_purchase_allocation_immutable ON hub_purchase_allocations;
CREATE TRIGGER trg_hub_purchase_allocation_immutable
  BEFORE UPDATE OR DELETE ON hub_purchase_allocations
  FOR EACH ROW EXECUTE FUNCTION hub_reject_purchase_allocation_mutation();

-- Custody history is append-only.
CREATE OR REPLACE FUNCTION hub_reject_custody_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hub_custody_event_append_only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_custody_event_append_only ON hub_custody_events;
CREATE TRIGGER trg_hub_custody_event_append_only
  BEFORE UPDATE OR DELETE ON hub_custody_events
  FOR EACH ROW EXECUTE FUNCTION hub_reject_custody_event_mutation();

-- A placement can only be closed once. Quantity/allocation/unit never change in place.
CREATE OR REPLACE FUNCTION hub_guard_placement_update()
RETURNS trigger AS $$
DECLARE
  unit_state text;
BEGIN
  IF NEW.physical_unit_id IS DISTINCT FROM OLD.physical_unit_id
     OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.placed_at IS DISTINCT FROM OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_identity_immutable';
  END IF;

  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'hub_placement_close_once';
  END IF;

  IF NEW.removed_at <= OLD.placed_at THEN
    RAISE EXCEPTION 'hub_placement_removed_at_invalid';
  END IF;

  SELECT state INTO unit_state
    FROM hub_physical_units
   WHERE id = OLD.physical_unit_id
   FOR UPDATE;

  IF unit_state IN ('PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'hub_physical_unit_content_frozen';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_placement_update_guard ON hub_physical_unit_placements;
CREATE TRIGGER trg_hub_placement_update_guard
  BEFORE UPDATE ON hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION hub_guard_placement_update();

CREATE OR REPLACE FUNCTION hub_reject_placement_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hub_placement_history_no_delete';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_placement_no_delete ON hub_physical_unit_placements;
CREATE TRIGGER trg_hub_placement_no_delete
  BEFORE DELETE ON hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION hub_reject_placement_delete();

-- Serialize every placement change by immutable allocation and cap active physical
-- quantity at the quantity bought. This is the concurrency-proof anti-duplication gate.
CREATE OR REPLACE FUNCTION hub_guard_placement_insert()
RETURNS trigger AS $$
DECLARE
  allocation_qty integer;
  already_placed integer;
  unit_state text;
BEGIN
  SELECT state INTO unit_state
    FROM hub_physical_units
   WHERE id = NEW.physical_unit_id
   FOR UPDATE;

  IF unit_state IS NULL THEN
    RAISE EXCEPTION 'hub_physical_unit_unresolvable';
  END IF;
  IF unit_state IN ('PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'hub_physical_unit_content_frozen';
  END IF;

  SELECT quantity INTO allocation_qty
    FROM hub_purchase_allocations
   WHERE id = NEW.allocation_id
   FOR UPDATE;

  IF allocation_qty IS NULL THEN
    RAISE EXCEPTION 'hub_purchase_allocation_unresolvable';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::integer INTO already_placed
    FROM hub_physical_unit_placements
   WHERE allocation_id = NEW.allocation_id
     AND removed_at IS NULL;

  IF already_placed + NEW.quantity > allocation_qty THEN
    RAISE EXCEPTION 'hub_allocation_overplaced';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_placement_insert_guard ON hub_physical_unit_placements;
CREATE TRIGGER trg_hub_placement_insert_guard
  BEFORE INSERT ON hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION hub_guard_placement_insert();

-- Initial physical identity is neutral: no caller can smuggle an outbound state,
-- Market or terminal outcome at INSERT time. Those facts must pass their canonical boundaries.
CREATE OR REPLACE FUNCTION hub_guard_physical_unit_insert()
RETURNS trigger AS $$
BEGIN
  IF NEW.market_id IS NOT NULL THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.outcome_type IS NOT NULL OR NEW.outcome_recorded_at IS NOT NULL THEN
    RAISE EXCEPTION 'hub_physical_outcome_requires_recording_boundary';
  END IF;

  IF NEW.state NOT IN ('RECEIVED', 'QUARANTINED') THEN
    RAISE EXCEPTION 'hub_physical_initial_state_invalid:%', NEW.state;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_physical_unit_insert_guard ON hub_physical_units;
CREATE TRIGGER trg_hub_physical_unit_insert_guard
  BEFORE INSERT ON hub_physical_units
  FOR EACH ROW EXECUTE FUNCTION hub_guard_physical_unit_insert();

-- Physical state is strict. Market ownership is derived exactly once from active
-- immutable allocations at the outbound boundary, never supplied/inferred by an agent.
CREATE OR REPLACE FUNCTION hub_guard_physical_unit_update()
RETURNS trigger AS $$
DECLARE
  active_count integer;
  market_count integer;
  resolved_market_id uuid;
  transition_ok boolean;
BEGIN
  IF OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'hub_physical_unit_market_immutable';
  END IF;

  IF OLD.outcome_type IS NOT NULL AND NEW.outcome_type IS DISTINCT FROM OLD.outcome_type THEN
    RAISE EXCEPTION 'hub_physical_outcome_immutable';
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     AND NEW.state NOT IN ('PACKED', 'DISPATCHED') THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    transition_ok := CASE OLD.state
      WHEN 'RECEIVED'        THEN NEW.state IN ('IDENTIFIED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'IDENTIFIED'      THEN NEW.state IN ('QUALITY_CHECKED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'QUALITY_CHECKED' THEN NEW.state IN ('LOCATED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'LOCATED'         THEN NEW.state IN ('ALLOCATED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'ALLOCATED'       THEN NEW.state IN ('PICKED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'PICKED'          THEN NEW.state IN ('PACKED', 'QUARANTINED', 'SUPERSEDED')
      WHEN 'PACKED'          THEN NEW.state IN ('DISPATCHED', 'QUARANTINED')
      WHEN 'DISPATCHED'      THEN NEW.state = 'QUARANTINED'
      ELSE false
    END;

    IF NOT transition_ok THEN
      RAISE EXCEPTION 'hub_physical_state_transition_invalid:%->%', OLD.state, NEW.state;
    END IF;
  END IF;

  IF NEW.state IN ('PACKED', 'DISPATCHED') THEN
    SELECT COUNT(*)::integer,
           COUNT(DISTINCT a.market_id)::integer,
           MIN(a.market_id::text)::uuid
      INTO active_count, market_count, resolved_market_id
      FROM hub_physical_unit_placements p
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE p.physical_unit_id = NEW.id
       AND p.removed_at IS NULL;

    IF active_count = 0 THEN
      RAISE EXCEPTION 'hub_outbound_unit_empty';
    END IF;
    IF market_count <> 1 THEN
      RAISE EXCEPTION 'hub_outbound_market_not_homogeneous';
    END IF;
    IF NEW.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM resolved_market_id THEN
      RAISE EXCEPTION 'hub_outbound_market_snapshot_mismatch';
    END IF;

    NEW.market_id := resolved_market_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_physical_unit_update_guard ON hub_physical_units;
CREATE TRIGGER trg_hub_physical_unit_update_guard
  BEFORE UPDATE ON hub_physical_units
  FOR EACH ROW EXECUTE FUNCTION hub_guard_physical_unit_update();

COMMENT ON TABLE hub_purchase_allocations IS
  'HUB-001 immutable economic snapshot: exact Purchase Order identity + order Market/destination. Hub cannot reassign it.';
COMMENT ON TABLE hub_physical_units IS
  'HUB-001 physical identity. Inbound may be multi-market; PACKED/DISPATCHED is forced mono-market from active allocations.';
COMMENT ON TABLE hub_physical_unit_placements IS
  'HUB-001 physical placement history. SPLIT/MERGE/REPACK close old placements and append new ones; allocation remains immutable.';
COMMENT ON TABLE hub_custody_events IS
  'HUB-001 append-only custody/lineage history for physical state and placement operations.';
