-- ============================================================
-- MIGRATION 007 — Moteur de règles opérationnelles Komerce
-- ============================================================
-- Point 6 Roadmap : Gouvernance Opérationnelle
-- 47 règles métier variabilisables, zéro breaking change
-- ============================================================

-- 0. Extension UUID si pas déjà activée
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Table des règles métier
CREATE TABLE IF NOT EXISTS business_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category    TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  value_type  TEXT NOT NULL DEFAULT 'number',
  label_fr    TEXT NOT NULL,
  description TEXT,
  min_value   NUMERIC,
  max_value   NUMERIC,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_br_category ON business_rules(category);
CREATE INDEX IF NOT EXISTS idx_br_key ON business_rules(key);

-- 2. Historique des modifications (audit trail)
CREATE TABLE IF NOT EXISTS business_rules_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id       UUID NOT NULL REFERENCES business_rules(id),
  old_value     JSONB,
  new_value     JSONB NOT NULL,
  changed_by    UUID REFERENCES users(id),
  change_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brh_rule ON business_rules_history(rule_id);

-- 3. Remboursements
CREATE TABLE IF NOT EXISTS refunds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id         UUID NOT NULL REFERENCES orders(id),
  amount_kmf       INTEGER NOT NULL,
  amount_eur       NUMERIC(10,2),
  refund_type      TEXT NOT NULL,
  refund_method    TEXT NOT NULL,
  stripe_refund_id TEXT,
  store_credit_id  UUID,
  reason           TEXT,
  initiated_by     UUID REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending',
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- 4. Crédits boutique
CREATE TABLE IF NOT EXISTS store_credits (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id),
  amount_kmf       INTEGER NOT NULL,
  remaining_kmf    INTEGER NOT NULL,
  reason           TEXT,
  source_order_id  UUID REFERENCES orders(id),
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON store_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credits_remaining ON store_credits(user_id, remaining_kmf) WHERE remaining_kmf > 0;

-- 5. Sous-commandes (expédition partielle)
CREATE TABLE IF NOT EXISTS sub_orders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_order_id  UUID NOT NULL REFERENCES orders(id),
  type             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'preparation',
  tracking_ref     TEXT,
  estimated_date   TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_orders_parent ON sub_orders(parent_order_id);

CREATE TABLE IF NOT EXISTS sub_order_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sub_order_id     UUID NOT NULL REFERENCES sub_orders(id),
  order_item_id    UUID NOT NULL REFERENCES order_items(id),
  quantity         INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_order_items_sub ON sub_order_items(sub_order_id);

-- 6. Extension order_items pour backorder
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS estimated_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backorder_reason TEXT;

-- 7. Triggers updated_at
-- Fonction set_updated_at (si elle n'existe pas déjà)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_br_updated') THEN
    CREATE TRIGGER trg_br_updated BEFORE UPDATE ON business_rules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sub_orders_updated') THEN
    CREATE TRIGGER trg_sub_orders_updated BEFORE UPDATE ON sub_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 8. Seed des 37 règles par défaut
INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  -- ═══ Orders ═══
  ('orders', 'CANCEL_FREE_WINDOW_HOURS', '{"value": 24}', 'number',
   'Fenêtre annulation gratuite (heures)', 'Délai après paiement pour annulation avec remboursement 100%', 1, 168),
  ('orders', 'CANCEL_PARTIAL_REFUND_PCT', '{"value": 80}', 'number',
   'Remboursement hors fenêtre (%)', 'Pourcentage remboursé si annulation hors fenêtre gratuite', 0, 100),
  ('orders', 'CANCEL_CUTOFF_STATUS', '{"value": "shipped"}', 'string',
   'Statut max pour annulation', 'Au-delà de ce statut, annulation impossible (retour SAV)', NULL, NULL),
  ('orders', 'CASH_PAYMENT_TIMEOUT_HOURS', '{"value": 36}', 'number',
   'Délai paiement cash relais (heures)', 'Temps accordé au client pour payer en espèces au relais', 12, 168),
  ('orders', 'QR_EXPIRATION_HOURS', '{"value": 48}', 'number',
   'Validité QR retrait (heures)', 'Durée de validité du QR code de retrait', 6, 168),
  ('orders', 'MAX_QUANTITY_PER_ITEM', '{"value": 100}', 'number',
   'Quantité max par article', 'Nombre maximum d''articles identiques par commande', 1, 1000),
  ('orders', 'ORDER_ALERT_48H_AVAILABLE', '{"value": 48}', 'number',
   'Alerte colis non retiré (heures)', 'Durée avant alerte si colis disponible non retiré', 12, 168),

  -- ═══ Shipping ═══
  ('shipping', 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', '{"value": 7}', 'number',
   'Retard déclenchant expédition partielle (jours)', 'Nombre de jours de retard avant déclenchement expédition partielle', 1, 60),
  ('shipping', 'PARTIAL_SHIP_MIN_AVAILABLE_PCT', '{"value": 60}', 'number',
   'Articles disponibles min pour expédition partielle (%)', 'Pourcentage minimum d''articles disponibles', 10, 100),
  ('shipping', 'PARTIAL_SHIP_AUTO_NOTIFY', '{"value": true}', 'boolean',
   'Notification auto expédition partielle', 'Envoyer SMS/email automatiquement au client', NULL, NULL),
  ('shipping', 'BACKORDER_MAX_DAYS', '{"value": 30}', 'number',
   'Backorder max avant proposition annulation (jours)', 'Durée max de backorder avant proposition d''annulation au client', 7, 90),

  -- ═══ SLA ═══
  ('sla', 'SLA_WARNING_DAYS', '{"value": 35}', 'number',
   'SLA Warning (jours)', 'Seuil d''alerte SLA jaune', 7, 90),
  ('sla', 'SLA_LATE_DAYS', '{"value": 42}', 'number',
   'SLA Late (jours)', 'Seuil d''alerte SLA orange', 14, 120),
  ('sla', 'SLA_BLOCKED_DAYS', '{"value": 56}', 'number',
   'SLA Blocked (jours)', 'Seuil d''alerte SLA rouge', 21, 180),
  ('sla', 'SLA_INACTIVE_DAYS', '{"value": 7}', 'number',
   'SLA Inactif (jours)', 'Seuil commande sans activité', 1, 30),
  ('sla', 'PROBLEM_PREP_BLOCKED_DAYS', '{"value": 4}', 'number',
   'Préparation bloquée max (jours)', 'Détection commandes en préparation trop longue', 1, 14),
  ('sla', 'PROBLEM_TRANSIT_MAX_DAYS', '{"value": 12}', 'number',
   'Transit max avant alerte (jours)', 'Détection transit maritime anormalement long', 5, 60),
  ('sla', 'PROBLEM_WAITING_MAX_DAYS', '{"value": 7}', 'number',
   'Attente retrait max (jours)', 'Détection colis non retiré depuis trop longtemps', 1, 30),
  ('sla', 'PROBLEM_STALLED_DAYS', '{"value": 30}', 'number',
   'Commande stagnante (jours)', 'Détection commande sans progression', 7, 90),
  ('sla', 'PROBLEM_NO_NOTIF_HOURS', '{"value": 1}', 'number',
   'Pas de notification après (heures)', 'Détection commande available sans QR token', 0.5, 24),

  -- ═══ Compensation ═══
  ('compensation', 'COMP_PREVENTIVE_DAYS', '{"value": 28}', 'number',
   'Compensation préventive (jours)', 'Seuil de retard pour contact préventif client', 7, 60),
  ('compensation', 'COMP_CREDIT_DAYS', '{"value": 35}', 'number',
   'Avoir boutique (jours)', 'Seuil de retard pour offrir un avoir 5%', 14, 90),
  ('compensation', 'COMP_DISCOUNT_DAYS', '{"value": 42}', 'number',
   'Remise prochaine commande (jours)', 'Seuil de retard pour remise -10%', 21, 120),
  ('compensation', 'COMP_REFUND_DAYS', '{"value": 56}', 'number',
   'Remboursement auto (jours)', 'Seuil de retard pour proposer un remboursement', 28, 180),

  -- ═══ Loyalty ═══
  ('loyalty', 'LOYALTY_SILVER_ORDERS', '{"value": 3}', 'number',
   'Seuil Silver (commandes)', 'Nombre de commandes pour atteindre Silver', 1, 50),
  ('loyalty', 'LOYALTY_GOLD_ORDERS', '{"value": 10}', 'number',
   'Seuil Gold (commandes)', 'Nombre de commandes pour atteindre Gold', 5, 100),
  ('loyalty', 'LOYALTY_PLATINUM_ORDERS', '{"value": 25}', 'number',
   'Seuil Platinum (commandes)', 'Nombre de commandes pour atteindre Platinum', 10, 200),
  ('loyalty', 'LOYALTY_SILVER_DISCOUNT', '{"value": 2}', 'number',
   'Remise Silver (%)', 'Pourcentage de remise pour les clients Silver', 0, 20),
  ('loyalty', 'LOYALTY_GOLD_DISCOUNT', '{"value": 5}', 'number',
   'Remise Gold (%)', 'Pourcentage de remise pour les clients Gold', 0, 30),
  ('loyalty', 'LOYALTY_PLATINUM_DISCOUNT', '{"value": 8}', 'number',
   'Remise Platinum (%)', 'Pourcentage de remise pour les clients Platinum', 0, 50),

  -- ═══ Pricing ═══
  ('pricing', 'CUSTOMS_DEFAULT_PCT', '{"value": 20}', 'number',
   'Douane estimée par défaut (%)', 'Coefficient de douane pour estimation de coût', 5, 50),
  ('pricing', 'FREIGHT_KMF_PER_KG', '{"value": 65}', 'number',
   'Fret par kg (KMF)', 'Coût estimé du fret maritime par kilogramme', 10, 500),
  ('pricing', 'EUR_KMF_FALLBACK', '{"value": 492}', 'number',
   'Taux EUR/KMF fallback', 'Taux de change EUR→KMF utilisé si API indisponible', 400, 600),
  ('pricing', 'AED_KMF_FALLBACK', '{"value": 138}', 'number',
   'Taux AED/KMF fallback', 'Taux de change AED→KMF utilisé si API indisponible', 100, 200),

  -- ═══ System ═══
  ('system', 'DASHBOARD_CACHE_TTL_SEC', '{"value": 30}', 'number',
   'Cache dashboard (secondes)', 'Durée du cache mémoire pour les requêtes dashboard', 5, 300),
  ('system', 'CASH_REMINDER_INTERVAL_MIN', '{"value": 60}', 'number',
   'Intervalle rappels cash (minutes)', 'Fréquence du cron de rappels paiement cash relais', 15, 360)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- FIN MIGRATION 007
-- ============================================================
