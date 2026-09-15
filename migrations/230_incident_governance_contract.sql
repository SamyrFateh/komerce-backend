-- @migration 230_incident_governance_contract.sql
-- @domain    incident-management
-- @purpose   F2 — Incident Governance Contract: persist origin_domain,
--            resolver_domain and resolution_class from incident creation.
--
-- F1 already reserves scheduled migration 229. Historical ambiguous
-- reconciliation_error rows are marked UNCLASSIFIED rather than assigned an
-- invented authority.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS origin_domain    TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolver_domain  TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_class TEXT;

-- Direct incident types: authority is an unambiguous function of incident_type.
UPDATE incidents SET
  origin_domain = CASE incident_type
    WHEN 'content_mismatch'   THEN 'LOGISTICS'
    WHEN 'missing_item'       THEN 'LOGISTICS'
    WHEN 'unexpected_item'    THEN 'LOGISTICS'
    WHEN 'damaged_item'       THEN 'LOGISTICS'
    WHEN 'weight_mismatch'    THEN 'LOGISTICS'
    WHEN 'quantity_mismatch'  THEN 'LOGISTICS'
    WHEN 'scan_anomaly'       THEN 'LOGISTICS'
    WHEN 'sequence_violation' THEN 'LOGISTICS'
    WHEN 'delay'              THEN 'LOGISTICS'
    WHEN 'blocked'            THEN 'LOGISTICS'
    WHEN 'payment_issue'      THEN 'PAYMENTS'
  END,
  resolver_domain = CASE incident_type
    WHEN 'content_mismatch'   THEN 'LOGISTICS'
    WHEN 'missing_item'       THEN 'LOGISTICS'
    WHEN 'unexpected_item'    THEN 'LOGISTICS'
    WHEN 'damaged_item'       THEN 'LOGISTICS'
    WHEN 'weight_mismatch'    THEN 'LOGISTICS'
    WHEN 'quantity_mismatch'  THEN 'LOGISTICS'
    WHEN 'scan_anomaly'       THEN 'LOGISTICS'
    WHEN 'sequence_violation' THEN 'LOGISTICS'
    WHEN 'delay'              THEN 'LOGISTICS'
    WHEN 'blocked'            THEN 'LOGISTICS'
    WHEN 'payment_issue'      THEN 'PAYMENTS'
  END,
  resolution_class = CASE incident_type
    WHEN 'payment_issue'      THEN 'UPSTREAM_TRUTH'
    WHEN 'content_mismatch'   THEN 'PHYSICAL_PROOF'
    WHEN 'missing_item'       THEN 'PHYSICAL_PROOF'
    WHEN 'unexpected_item'    THEN 'PHYSICAL_PROOF'
    WHEN 'damaged_item'       THEN 'PHYSICAL_PROOF'
    WHEN 'weight_mismatch'    THEN 'PHYSICAL_PROOF'
    WHEN 'quantity_mismatch'  THEN 'PHYSICAL_PROOF'
    WHEN 'scan_anomaly'       THEN 'PHYSICAL_PROOF'
    WHEN 'sequence_violation' THEN 'PHYSICAL_PROOF'
    WHEN 'delay'              THEN 'PHYSICAL_PROOF'
    WHEN 'blocked'            THEN 'PHYSICAL_PROOF'
  END
WHERE incident_type <> 'reconciliation_error'
  AND origin_domain IS NULL;

-- reconciliation_error is governed by details.type. These six subtypes are
-- the actual producers in services/reconciliation-service.js. partial_allocation
-- is intentionally absent: it is a normal backorder condition and creates no incident.
UPDATE incidents SET
  origin_domain = CASE details->>'type'
    WHEN 'quantity_chain_break' THEN 'LOGISTICS'
    WHEN 'status_scan_mismatch' THEN 'LOGISTICS'
    WHEN 'stale_parcel'         THEN 'LOGISTICS'
    WHEN 'over_allocation'      THEN 'LOGISTICS'
    WHEN 'unallocated_item'     THEN 'LOGISTICS'
    WHEN 'order_status_drift'   THEN 'ORDERS'
  END,
  resolver_domain = CASE details->>'type'
    WHEN 'quantity_chain_break' THEN 'LOGISTICS'
    WHEN 'status_scan_mismatch' THEN 'LOGISTICS'
    WHEN 'stale_parcel'         THEN 'LOGISTICS'
    WHEN 'over_allocation'      THEN 'LOGISTICS'
    WHEN 'unallocated_item'     THEN 'LOGISTICS'
    WHEN 'order_status_drift'   THEN 'ORDERS'
  END,
  resolution_class = CASE details->>'type'
    WHEN 'quantity_chain_break' THEN 'PHYSICAL_PROOF'
    WHEN 'status_scan_mismatch' THEN 'PHYSICAL_PROOF'
    WHEN 'stale_parcel'         THEN 'PHYSICAL_PROOF'
    WHEN 'over_allocation'      THEN 'PHYSICAL_PROOF'
    WHEN 'unallocated_item'     THEN 'PHYSICAL_PROOF'
    WHEN 'order_status_drift'   THEN 'UPSTREAM_TRUTH'
  END
WHERE incident_type = 'reconciliation_error'
  AND details->>'type' IN (
    'quantity_chain_break', 'status_scan_mismatch', 'stale_parcel',
    'over_allocation', 'unallocated_item', 'order_status_drift'
  )
  AND origin_domain IS NULL;

-- Historical reconciliation rows that cannot be classified without guessing.
UPDATE incidents SET
  origin_domain    = 'UNCLASSIFIED',
  resolver_domain  = 'UNCLASSIFIED',
  resolution_class = 'UNCLASSIFIED'
WHERE incident_type = 'reconciliation_error'
  AND origin_domain IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM incidents
    WHERE origin_domain IS NULL OR resolver_domain IS NULL OR resolution_class IS NULL
  ) THEN
    RAISE EXCEPTION 'F2 backfill incomplete: incident governance triplet still missing';
  END IF;
END $$;

-- NULL is not an acceptable hidden authority. Historical ambiguity remains
-- explicit through UNCLASSIFIED, which generic terminal resolution rejects.
ALTER TABLE incidents ALTER COLUMN origin_domain    SET NOT NULL;
ALTER TABLE incidents ALTER COLUMN resolver_domain  SET NOT NULL;
ALTER TABLE incidents ALTER COLUMN resolution_class SET NOT NULL;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_origin_domain_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_origin_domain_check
  CHECK (origin_domain IN ('LOGISTICS', 'PAYMENTS', 'ORDERS', 'PURCHASING', 'MARKET', 'UNCLASSIFIED'));

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_resolver_domain_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_resolver_domain_check
  CHECK (resolver_domain IN ('LOGISTICS', 'PAYMENTS', 'ORDERS', 'PURCHASING', 'MARKET', 'UNCLASSIFIED'));

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_resolution_class_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_resolution_class_check
  CHECK (resolution_class IN ('PHYSICAL_PROOF', 'UPSTREAM_TRUTH', 'UNCLASSIFIED'));

CREATE INDEX IF NOT EXISTS idx_incidents_governance
  ON incidents (origin_domain, resolution_class)
  WHERE status IN ('open', 'investigating');