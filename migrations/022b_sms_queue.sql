-- Migration 022b: SMS Queue — DB-backed async SMS processing
-- Renommé depuis 022_sms_queue.sql (LOT 5 — résolution doublon numéro 022)
-- Replaces synchronous SMS sending with a reliable queue.

BEGIN;

-- Add queue columns to existing sms_log table
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sms_log_queue_pending
  ON sms_log (priority ASC, next_attempt_at ASC)
  WHERE status = 'pending' AND attempts < 3;

CREATE INDEX IF NOT EXISTS idx_sms_log_failed
  ON sms_log (created_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_sms_log_recent
  ON sms_log (created_at DESC)
  WHERE status IN ('pending', 'sent', 'failed');

COMMIT;
