-- @migration 024_notification_log.sql
-- @domain    notification
-- @purpose   Table notification_log
-- @added-header 2026-07-01 (audit gouvernance)

-- 023: Create notification_log table
-- Tracks all WhatsApp, email, SMS notifications sent

CREATE TABLE IF NOT EXISTS notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_ref    VARCHAR(30),
  order_ref     VARCHAR(30),
  channel       VARCHAR(20) NOT NULL,
  event         VARCHAR(50) NOT NULL,
  recipient     VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  detail        JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_parcel ON notification_log(parcel_ref);
CREATE INDEX IF NOT EXISTS idx_notif_order ON notification_log(order_ref);
CREATE INDEX IF NOT EXISTS idx_notif_channel ON notification_log(channel);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notification_log(created_at DESC);
