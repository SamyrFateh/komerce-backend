-- Migration 022: SMS Queue — DB-backed async SMS processing
-- Replaces synchronous SMS sending with a reliable queue.
-- Queue processor runs via setInterval (no Redis needed).

BEGIN;

-- Add queue columns to existing sms_log table
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Index for efficient queue polling
CREATE INDEX IF NOT EXISTS idx_sms_log_queue_pending
  ON sms_log (priority ASC, next_attempt_at ASC)
  WHERE status = 'pending' AND attempts < max_attempts;

-- Index for monitoring failed SMS
CREATE INDEX IF NOT EXISTS idx_sms_log_failed
  ON sms_log (created_at DESC)
  WHERE status = 'failed';

-- Partial index for recent SMS (dashboard/monitoring)
CREATE INDEX IF NOT EXISTS idx_sms_log_recent
  ON sms_log (created_at DESC)
  WHERE created_at > NOW() - INTERVAL '7 days';

COMMIT;
