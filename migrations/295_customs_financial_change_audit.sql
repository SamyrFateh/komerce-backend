-- @migration 295_customs_financial_change_audit.sql
-- Append-only evidence of financial changes to customs shipments.
-- Audit trigger runs in the same transaction as the source UPDATE.
CREATE TABLE IF NOT EXISTS customs_shipment_financial_audit (
  id BIGSERIAL PRIMARY KEY,
  shipment_id UUID NOT NULL REFERENCES customs_shipments(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id TEXT,
  reason TEXT,
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customs_financial_audit_shipment
  ON customs_shipment_financial_audit(shipment_id, changed_at DESC);
CREATE OR REPLACE FUNCTION audit_customs_shipment_financial_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_fin JSONB;
  new_fin JSONB;
BEGIN
  old_fin := jsonb_build_object('customs_paid_kmf', OLD.customs_paid_kmf,
    'freight_kmf', OLD.freight_kmf,
    'allocation_method', OLD.allocation_method,
    'allocation_config', OLD.allocation_config);
  new_fin := jsonb_build_object('customs_paid_kmf', NEW.customs_paid_kmf,
    'freight_kmf', NEW.freight_kmf,
    'allocation_method', NEW.allocation_method,
    'allocation_config', NEW.allocation_config);
  IF old_fin IS DISTINCT FROM new_fin THEN
    INSERT INTO customs_shipment_financial_audit
      (shipment_id, actor_id, reason, old_values, new_values)
    VALUES (NEW.id,
      NULLIF(current_setting('komerce.actor_id', true), ''),
      NULLIF(current_setting('komerce.change_reason', true), ''),
      old_fin, new_fin);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_customs_shipment_financial_change ON customs_shipments;
CREATE TRIGGER trg_customs_shipment_financial_change
AFTER UPDATE OF customs_paid_kmf, freight_kmf, allocation_method, allocation_config
ON customs_shipments
FOR EACH ROW EXECUTE FUNCTION audit_customs_shipment_financial_change();
CREATE OR REPLACE FUNCTION prevent_customs_financial_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customs_shipment_financial_audit is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_customs_financial_audit_immutable ON customs_shipment_financial_audit;
CREATE TRIGGER trg_customs_financial_audit_immutable
BEFORE UPDATE OR DELETE ON customs_shipment_financial_audit
FOR EACH ROW EXECUTE FUNCTION prevent_customs_financial_audit_mutation();
