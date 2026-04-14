-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 015 — Add backorder_reminder_sent to parcels
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- CRIT-02 FIX: This column was previously created at RUNTIME by an ALTER TABLE
-- inside processBackorderReminders() in utils/sms.js.
--
-- Problem: ALTER TABLE takes an exclusive lock on the parcels table, blocking
-- ALL writes while it runs. This was executed every 6 hours via cron.
--
-- Fix: Create the column ONCE via this migration. Remove ALTER TABLE from sms.js.
--
-- Run this BEFORE deploying the new sms.js.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add the column if it doesn't already exist (safe to re-run)
ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS backorder_reminder_sent BOOLEAN DEFAULT FALSE;

-- Add index for the cron query that filters on this column
CREATE INDEX IF NOT EXISTS idx_parcels_backorder_reminder
  ON parcels (type, status, backorder_reminder_sent)
  WHERE type = 'backorder'
    AND status NOT IN ('collected', 'cancelled')
    AND backorder_reminder_sent = FALSE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Verification query (run manually to confirm):
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'parcels' AND column_name = 'backorder_reminder_sent';
-- ═══════════════════════════════════════════════════════════════════════════════
