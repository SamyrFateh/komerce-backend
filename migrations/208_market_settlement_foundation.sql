-- @migration 208_market_settlement_foundation.sql
-- @domain    settlement
-- @purpose   Primitive de règlement du Market Operating Assignment.
--            Le montant READY est une attestation centrale explicite : aucune
--            formule de commission/revenue-share n'est inventée ici. Le pays
--            peut ensuite demander le règlement et confirmer sa réception,
--            mais ne peut jamais modifier la vérité monétaire ni se déclarer
--            payé lui-même.

CREATE TABLE IF NOT EXISTS market_settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id           UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  assignment_id       UUID NOT NULL REFERENCES market_operating_assignments(id) ON DELETE RESTRICT,
  amount              NUMERIC(24,6) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source              TEXT NOT NULL DEFAULT 'CENTRAL_ATTESTATION'
                        CHECK (source IN ('CENTRAL_ATTESTATION')),
  source_reference    TEXT,
  period_start        DATE,
  period_end          DATE,
  attestation_note    TEXT,
  status              TEXT NOT NULL DEFAULT 'READY'
                        CHECK (status IN ('READY','REQUESTED','PAID','RECEIVED')),
  attested_by         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_by        UUID REFERENCES users(id) ON DELETE RESTRICT,
  requested_at        TIMESTAMPTZ,
  paid_by             UUID REFERENCES users(id) ON DELETE RESTRICT,
  paid_at             TIMESTAMPTZ,
  payment_reference   TEXT,
  received_by         UUID REFERENCES users(id) ON DELETE RESTRICT,
  received_at         TIMESTAMPTZ,
  receipt_note        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start),
  CHECK (status = 'READY' OR (requested_by IS NOT NULL AND requested_at IS NOT NULL)),
  CHECK (status NOT IN ('PAID','RECEIVED') OR (paid_by IS NOT NULL AND paid_at IS NOT NULL AND NULLIF(BTRIM(payment_reference), '') IS NOT NULL)),
  CHECK (status <> 'RECEIVED' OR (received_by IS NOT NULL AND received_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_market_settlements_assignment_status
  ON market_settlements (assignment_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_settlements_market_status
  ON market_settlements (market_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS market_settlement_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id   UUID NOT NULL REFERENCES market_settlements(id) ON DELETE RESTRICT,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('READY_ATTESTED','REQUESTED','PAID','RECEIVED')),
  payload         JSONB,
  correlation_id  TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_settlement_events_settlement
  ON market_settlement_events (settlement_id, occurred_at ASC);

-- Cohérence structurelle + immutabilité de la vérité monétaire et de l'identité
-- économique. Même un appel SQL direct ne peut pas préremplir des étapes futures,
-- réécrire amount/currency, changer de marché/assignment ou sauter un statut.
CREATE OR REPLACE FUNCTION enforce_market_settlement_invariants()
RETURNS trigger AS $$
DECLARE
  expected_currency TEXT;
  assignment_market UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT m.currency INTO expected_currency FROM markets m WHERE m.id = NEW.market_id;
    SELECT a.market_id INTO assignment_market FROM market_operating_assignments a WHERE a.id = NEW.assignment_id;

    IF expected_currency IS NULL OR assignment_market IS NULL THEN
      RAISE EXCEPTION 'market_settlement_reference_invalid';
    END IF;
    IF assignment_market <> NEW.market_id THEN
      RAISE EXCEPTION 'market_settlement_assignment_market_mismatch';
    END IF;
    IF NEW.currency <> expected_currency THEN
      RAISE EXCEPTION 'market_settlement_currency_mismatch';
    END IF;
    IF NEW.status <> 'READY' THEN
      RAISE EXCEPTION 'market_settlement_must_start_ready';
    END IF;
    IF NEW.requested_by IS NOT NULL OR NEW.requested_at IS NOT NULL
       OR NEW.paid_by IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.payment_reference IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_future_stage_fields_forbidden';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.attested_by IS DISTINCT FROM OLD.attested_by
     OR NEW.attestation_note IS DISTINCT FROM OLD.attestation_note THEN
    RAISE EXCEPTION 'market_settlement_attestation_immutable';
  END IF;

  IF OLD.status = 'READY' AND NEW.status = 'REQUESTED' THEN
    IF NEW.requested_by IS NULL OR NEW.requested_at IS NULL
       OR NEW.paid_by IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.payment_reference IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_requested_stage_invalid';
    END IF;
  ELSIF OLD.status = 'REQUESTED' AND NEW.status = 'PAID' THEN
    IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.paid_by IS NULL OR NEW.paid_at IS NULL OR NULLIF(BTRIM(NEW.payment_reference), '') IS NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL OR NEW.receipt_note IS NOT NULL THEN
      RAISE EXCEPTION 'market_settlement_paid_stage_invalid';
    END IF;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'RECEIVED' THEN
    IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
       OR NEW.received_by IS NULL OR NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'market_settlement_received_stage_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'market_settlement_transition_invalid:%->%', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_market_settlement_invariants ON market_settlements;
CREATE TRIGGER trg_market_settlement_invariants
BEFORE INSERT OR UPDATE ON market_settlements
FOR EACH ROW EXECUTE FUNCTION enforce_market_settlement_invariants();

COMMENT ON TABLE market_settlements IS
  'Vérité de settlement du Market Operating Assignment. READY = attestation centrale, REQUESTED = demande pays, PAID = attestation centrale de paiement, RECEIVED = accusé de réception pays. amount/currency sont immuables après création.';

COMMENT ON TABLE market_settlement_events IS
  'Journal append-only du lifecycle settlement. Complète market_delegation_audit : ici la vérité financière ; là-bas la preuve d usage des capabilities déléguées.';
