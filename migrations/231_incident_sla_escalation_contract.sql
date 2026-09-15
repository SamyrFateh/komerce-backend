-- @migration 231_incident_sla_escalation_contract.sql
-- @domain    incident-management
-- @purpose   F3 — Incident SLA + Proof/Revalidation Contract: persist due_at
--            (deadline derived from F2's resolution_class, stable after
--            creation) and escalation_level (durable idempotence marker for
--            overdue escalation delivery).
--
-- due_at is nullable at the DB level: historical incidents keep due_at = NULL
-- (no invented deadline for the past — same doctrine as F2's UNCLASSIFIED).
-- New incidents get due_at populated by the application at creation time
-- (services/incident-governance.js#computeDueAt), driven by resolution_class,
-- which is already NOT NULL since migration 230.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_escalation_level_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_escalation_level_check
  CHECK (escalation_level >= 0);

-- Overdue scan (services/incident-escalation.js#scanOverdueIncidents) filters
-- on due_at for open/investigating incidents only.
CREATE INDEX IF NOT EXISTS idx_incidents_overdue
  ON incidents (due_at)
  WHERE status IN ('open', 'investigating') AND due_at IS NOT NULL;
