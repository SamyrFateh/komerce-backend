-- Migration 058: make notification_log.recipient nullable
-- The column was NOT NULL but system events (parcel_created, etc.) don't have a recipient.
-- logNotification() already passes recipient || null — the constraint was wrong.

ALTER TABLE notification_log ALTER COLUMN recipient DROP NOT NULL;
