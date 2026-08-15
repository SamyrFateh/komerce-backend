-- @migration 132_client_notifications.sql
-- @domain    notifications
-- @purpose   Bandeau client essentiel, acquittable et rattaché à une commande

CREATE TABLE IF NOT EXISTS client_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('order')),
  entity_id UUID NOT NULL,
  order_reference TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'important'
    CHECK (severity IN ('important', 'urgent')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_target TEXT NOT NULL DEFAULT 'orders'
    CHECK (action_target IN ('orders')),
  requires_ack BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (user_id, event_key, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_client_notifications_user_open
  ON client_notifications(user_id, severity, created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_client_notifications_entity
  ON client_notifications(entity_type, entity_id);

COMMENT ON TABLE client_notifications IS
  'Notifications in-app essentielles. Aucun canal externe et aucun contenu sensible.';
