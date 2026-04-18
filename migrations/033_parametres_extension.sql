-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 033 — Paramètres V1 : Extension business_rules + matrices
-- ════════════════════════════════════════════════════════════════════════════
-- Safe : idempotent (ON CONFLICT DO NOTHING), peut être rejoué sans risque.
-- Ajoute 27 règles manquantes + crée 2 tables pricing_category_{taxes,dims}
-- Seed les tables avec les valeurs actuellement hardcodées dans pricing.js
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- PARTIE A — Ajout des 27 règles manquantes dans business_rules
-- ──────────────────────────────────────────────────────────────────────────

-- PRICING : Commissions + transport + marge (10 règles)
-- Ces valeurs sont déjà consommées par pricing.js mais tombent toujours sur
-- le fallback car absentes en DB. On insère les valeurs actuelles = aucun changement métier.
INSERT INTO business_rules (key, category, label_fr, description, value, value_type, min_value, max_value, is_active)
VALUES
  ('COMMISSION_AGENT_PCT', 'pricing',
   'Commission agent acheteur (%)',
   'Pourcentage prélevé par l''agent acheteur Dubaï sur le prix d''achat produit.',
   '{"value": 5}'::jsonb, 'number', 0, 30, TRUE),

  ('COMMISSION_RELAIS_STANDARD_KMF', 'pricing',
   'Commission relais standard (KMF)',
   'Commission fixe versée au relais standard pour chaque retrait de commande.',
   '{"value": 500}'::jsonb, 'number', 0, 5000, TRUE),

  ('COMMISSION_RELAIS_SHOWROOM_KMF', 'pricing',
   'Commission relais showroom (KMF)',
   'Commission fixe versée au relais showroom (plus coûteux que standard).',
   '{"value": 750}'::jsonb, 'number', 0, 5000, TRUE),

  ('FRAIS_STRIPE_PCT', 'pricing',
   'Frais Stripe (%)',
   'Pourcentage facturé par Stripe sur les paiements EUR. Impacte la marge réelle.',
   '{"value": 2.5}'::jsonb, 'number', 0, 10, TRUE),

  ('MARGE_PCT', 'pricing',
   'Marge cible (%)',
   'Marge appliquée au prix de revient pour calculer le prix de vente public. ATTENTION CRITIQUE',
   '{"value": 12}'::jsonb, 'number', 0, 100, TRUE),

  ('TRANSPORT_DXB_KMF', 'pricing',
   'Transport Dubaï (KMF)',
   'Coût fixe de transport entre l''entrepôt Dubaï et le hub France.',
   '{"value": 500}'::jsonb, 'number', 0, 5000, TRUE),

  ('TRANSITAIRE_PCT', 'pricing',
   'Transitaire (%)',
   'Pourcentage transitaire sur valeur CIF (assurance + fret).',
   '{"value": 2}'::jsonb, 'number', 0, 20, TRUE),

  ('TRANSITAIRE_FIXED_KMF', 'pricing',
   'Transitaire fixe (KMF)',
   'Frais transitaire fixes par commande, additionnés au pourcentage.',
   '{"value": 450}'::jsonb, 'number', 0, 5000, TRUE),

  ('PORTUAIRES_KMF', 'pricing',
   'Frais portuaires (KMF)',
   'Frais portuaires Mutsamudu par commande.',
   '{"value": 1200}'::jsonb, 'number', 0, 10000, TRUE),

  ('TRANSPORT_RELAIS_KMF', 'pricing',
   'Transport hub → relais (KMF)',
   'Coût de transport entre le hub Comores et chaque relais.',
   '{"value": 840}'::jsonb, 'number', 0, 5000, TRUE)

ON CONFLICT (key) DO NOTHING;

-- COMPENSATION : pourcentages manquants (2 règles)
INSERT INTO business_rules (key, category, label_fr, description, value, value_type, min_value, max_value, is_active)
VALUES
  ('COMP_CREDIT_PCT', 'compensation',
   'Crédit compensation (%)',
   'Pourcentage de crédit wallet offert quand COMP_CREDIT_DAYS est atteint.',
   '{"value": 5}'::jsonb, 'number', 0, 50, TRUE),

  ('COMP_DISCOUNT_PCT', 'compensation',
   'Remise compensation (%)',
   'Pourcentage de remise offerte quand COMP_DISCOUNT_DAYS est atteint.',
   '{"value": 10}'::jsonb, 'number', 0, 50, TRUE)

ON CONFLICT (key) DO NOTHING;

-- COLISAGE avancé (5 règles)
INSERT INTO business_rules (key, category, label_fr, description, value, value_type, min_value, max_value, is_active)
VALUES
  ('PARCEL_MAX_WEIGHT_KG', 'parcel',
   'Poids max par colis (kg)',
   'Seuil au-delà duquel un colis doit être splitté.',
   '{"value": 30}'::jsonb, 'number', 1, 200, TRUE),

  ('PARCEL_MAX_VALUE_KMF', 'parcel',
   'Valeur max par colis (KMF)',
   'Seuil au-delà duquel un colis doit être splitté (contrôle douane).',
   '{"value": 2000000}'::jsonb, 'number', 100000, 50000000, TRUE),

  ('PARCEL_MAX_ORDERS', 'parcel',
   'Nombre max de commandes par colis',
   'Limite d''agrégation de commandes dans un même colis.',
   '{"value": 15}'::jsonb, 'number', 1, 100, TRUE),

  ('HUB_OVERRIDE_TOLERANCE_PCT', 'parcel',
   'Tolérance override agent hub (%)',
   'Marge au-delà des seuils max que l''agent hub peut utiliser avec justification.',
   '{"value": 10}'::jsonb, 'number', 0, 50, TRUE),

  ('HUB_OVERRIDE_MAX_PER_DAY', 'parcel',
   'Overrides max par agent/jour',
   'Nombre maximum d''overrides qu''un agent hub peut effectuer en 24h.',
   '{"value": 5}'::jsonb, 'number', 0, 50, TRUE)

ON CONFLICT (key) DO NOTHING;

-- WALLET (5 règles)
INSERT INTO business_rules (key, category, label_fr, description, value, value_type, min_value, max_value, is_active)
VALUES
  ('WALLET_MAX_BALANCE_KMF', 'wallet',
   'Plafond solde wallet (KMF)',
   'Solde maximum autorisé sur un wallet client individuel. Anti-abus.',
   '{"value": 500000}'::jsonb, 'number', 0, 10000000, TRUE),

  ('WALLET_TOTAL_ALERT_KMF', 'wallet',
   'Alerte encours total wallets (KMF)',
   'Seuil au-delà duquel l''encours total des wallets déclenche une alerte. Indicateur de trésorerie.',
   '{"value": 5000000}'::jsonb, 'number', 0, 100000000, TRUE),

  ('WALLET_LOT_EXPIRATION_DAYS', 'wallet',
   'Expiration lot wallet (jours)',
   'Durée de validité d''un lot de crédit avant expiration automatique.',
   '{"value": 365}'::jsonb, 'number', 30, 3650, TRUE),

  ('WALLET_MANUAL_CREDIT_MAX_KMF', 'wallet',
   'Crédit manuel max par admin (KMF)',
   'Montant maximum qu''un admin peut créditer en une seule opération.',
   '{"value": 100000}'::jsonb, 'number', 0, 10000000, TRUE),

  ('WALLET_REASON_REQUIRED_MIN_CHARS', 'wallet',
   'Longueur min justification crédit (caractères)',
   'Nombre minimum de caractères dans la justification d''un crédit manuel.',
   '{"value": 10}'::jsonb, 'number', 0, 500, TRUE)

ON CONFLICT (key) DO NOTHING;

-- ALERTING (7 règles)
INSERT INTO business_rules (key, category, label_fr, description, value, value_type, min_value, max_value, is_active)
VALUES
  ('CANCEL_RATE_ALERT_PCT', 'alerting',
   'Taux annulation anormal (%)',
   'Pourcentage d''annulation sur 7 jours qui déclenche une alerte critique.',
   '{"value": 15}'::jsonb, 'number', 0, 100, TRUE),

  ('PAYMENT_FAILED_ALERT_COUNT_24H', 'alerting',
   'Échecs paiement 24h (alerte)',
   'Nombre d''échecs de paiement Stripe en 24h qui déclenche une alerte.',
   '{"value": 5}'::jsonb, 'number', 1, 100, TRUE),

  ('CASH_COLLECT_ALERT_KMF', 'alerting',
   'Cash attente relais (KMF)',
   'Montant cumulé de cash en attente de collecte aux relais qui déclenche une alerte.',
   '{"value": 1000000}'::jsonb, 'number', 0, 100000000, TRUE),

  ('STOCK_LOW_THRESHOLD', 'alerting',
   'Seuil stock bas (unités)',
   'Quantité en dessous de laquelle un produit est signalé "stock bas".',
   '{"value": 5}'::jsonb, 'number', 0, 1000, TRUE),

  ('PRODUCT_DORMANT_DAYS', 'alerting',
   'Produit dormant (jours)',
   'Nombre de jours sans vente au-delà duquel un produit est marqué dormant.',
   '{"value": 60}'::jsonb, 'number', 7, 365, TRUE),

  ('CLIENT_REACTIVATE_DAYS', 'alerting',
   'Client à réactiver (jours)',
   'Nombre de jours sans commande au-delà duquel un client récurrent est flaggué à réactiver.',
   '{"value": 60}'::jsonb, 'number', 7, 730, TRUE),

  ('FX_RATE_DELTA_ALERT_PCT', 'alerting',
   'Variation taux change critique (%)',
   'Variation EUR/KMF ou AED/KMF qui déclenche une alerte (impact pricing).',
   '{"value": 5}'::jsonb, 'number', 0.1, 50, TRUE)

ON CONFLICT (key) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- PARTIE B — Tables matrices pricing (TAXES + DIMS par catégorie)
-- ──────────────────────────────────────────────────────────────────────────

-- Table des taux douaniers par catégorie produit
CREATE TABLE IF NOT EXISTS pricing_category_taxes (
  category      VARCHAR(50) PRIMARY KEY,
  label_fr      VARCHAR(100) NOT NULL,
  douane_pct    DECIMAL(5,4) NOT NULL CHECK (douane_pct >= 0 AND douane_pct <= 1),
  tva_pct       DECIMAL(5,4) NOT NULL CHECK (tva_pct >= 0 AND tva_pct <= 1),
  taxe_add_pct  DECIMAL(5,4) NOT NULL CHECK (taxe_add_pct >= 0 AND taxe_add_pct <= 1),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Seed : valeurs actuellement hardcodées dans pricing.js
INSERT INTO pricing_category_taxes (category, label_fr, douane_pct, tva_pct, taxe_add_pct)
VALUES
  ('electronique', 'Électronique',  0.10, 0.10, 0.000),
  ('maison',       'Maison',        0.15, 0.10, 0.000),
  ('mariage',      'Mariage',       0.20, 0.10, 0.025),
  ('mode_beaute',  'Mode & Beauté', 0.20, 0.10, 0.010),
  ('enfants',      'Enfants',       0.10, 0.10, 0.000)
ON CONFLICT (category) DO NOTHING;

-- Table des dimensions standard par catégorie produit
CREATE TABLE IF NOT EXISTS pricing_category_dims (
  category    VARCHAR(50) PRIMARY KEY,
  label_fr    VARCHAR(100) NOT NULL,
  length_cm   INT NOT NULL CHECK (length_cm > 0 AND length_cm <= 200),
  width_cm    INT NOT NULL CHECK (width_cm > 0 AND width_cm <= 200),
  height_cm   INT NOT NULL CHECK (height_cm > 0 AND height_cm <= 200),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Seed : valeurs actuellement hardcodées dans pricing.js
INSERT INTO pricing_category_dims (category, label_fr, length_cm, width_cm, height_cm)
VALUES
  ('electronique', 'Électronique',  17, 12, 11),
  ('maison',       'Maison',        35, 30, 16),
  ('mariage',      'Mariage',       30, 25, 11),
  ('mode_beaute',  'Mode & Beauté', 22, 18, 10),
  ('enfants',      'Enfants',       25, 20,  9)
ON CONFLICT (category) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- PARTIE C — Ajout de label_fr aux 40 règles existantes (si manquants)
-- ──────────────────────────────────────────────────────────────────────────
-- Safe : n'écrase JAMAIS un label_fr déjà défini, seulement ajoute si NULL

UPDATE business_rules SET label_fr = 'Seuil "attention retard" (jours)' WHERE key = 'SLA_WARNING_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Seuil "en retard" (jours)' WHERE key = 'SLA_LATE_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Seuil "bloqué" (jours)' WHERE key = 'SLA_BLOCKED_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Seuil "colis inactif" (jours)' WHERE key = 'SLA_INACTIVE_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Préparation bloquée (jours)' WHERE key = 'PROBLEM_PREP_BLOCKED_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Transit max (jours)' WHERE key = 'PROBLEM_TRANSIT_MAX_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Attente relais max (jours)' WHERE key = 'PROBLEM_WAITING_MAX_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Colis stalled (jours)' WHERE key = 'PROBLEM_STALLED_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Absence notification (heures)' WHERE key = 'PROBLEM_NO_NOTIF_HOURS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Alerte "48h disponible" (heures)' WHERE key = 'ORDER_ALERT_48H_AVAILABLE' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Expiration QR code (heures)' WHERE key = 'QR_EXPIRATION_HOURS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Backorder max (jours)' WHERE key = 'BACKORDER_MAX_DAYS' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Contact préventif (jours)' WHERE key = 'COMP_PREVENTIVE_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Avoir automatique (jours)' WHERE key = 'COMP_CREDIT_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Remise automatique (jours)' WHERE key = 'COMP_DISCOUNT_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Remboursement possible (jours)' WHERE key = 'COMP_REFUND_DAYS' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Timeout paiement cash (heures)' WHERE key = 'CASH_PAYMENT_TIMEOUT_HOURS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Intervalle rappels cash (minutes)' WHERE key = 'CASH_REMINDER_INTERVAL_MIN' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Fenêtre annulation gratuite (heures)' WHERE key = 'CANCEL_FREE_WINDOW_HOURS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Remboursement partiel annulation (%)' WHERE key = 'CANCEL_PARTIAL_REFUND_PCT' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Statut max annulation' WHERE key = 'CANCEL_CUTOFF_STATUS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Quantité max par article' WHERE key = 'MAX_QUANTITY_PER_ITEM' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Taux EUR→KMF fallback' WHERE key = 'EUR_KMF_FALLBACK' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Taux AED→KMF fallback' WHERE key = 'AED_KMF_FALLBACK' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Taux douane défaut (%)' WHERE key = 'CUSTOMS_DEFAULT_PCT' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Fret par kg (KMF)' WHERE key = 'FREIGHT_KMF_PER_KG' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Auto-création colis' WHERE key = 'PARCEL_AUTO_CREATE_ON_ORDER' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Attente stock max (jours)' WHERE key = 'PARCEL_AWAITING_STOCK_MAX_DAYS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Stratégie split défaut' WHERE key = 'PARCEL_DEFAULT_SPLIT_STRATEGY' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Items min pour partial ship' WHERE key = 'PARCEL_SPLIT_MIN_ITEMS_FOR_PARTIAL' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Partial ship auto-notify' WHERE key = 'PARTIAL_SHIP_AUTO_NOTIFY' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Partial ship seuil disponibilité (%)' WHERE key = 'PARTIAL_SHIP_MIN_AVAILABLE_PCT' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Partial ship délai max (jours)' WHERE key = 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Silver : commandes requises' WHERE key = 'LOYALTY_SILVER_ORDERS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Silver : remise (%)' WHERE key = 'LOYALTY_SILVER_DISCOUNT' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Gold : commandes requises' WHERE key = 'LOYALTY_GOLD_ORDERS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Gold : remise (%)' WHERE key = 'LOYALTY_GOLD_DISCOUNT' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Platinum : commandes requises' WHERE key = 'LOYALTY_PLATINUM_ORDERS' AND label_fr IS NULL;
UPDATE business_rules SET label_fr = 'Platinum : remise (%)' WHERE key = 'LOYALTY_PLATINUM_DISCOUNT' AND label_fr IS NULL;

UPDATE business_rules SET label_fr = 'Cache dashboard (secondes)' WHERE key = 'DASHBOARD_CACHE_TTL_SEC' AND label_fr IS NULL;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- VÉRIFICATION finale (informational)
-- ──────────────────────────────────────────────────────────────────────────
SELECT category, COUNT(*) as rules
FROM business_rules
WHERE is_active = TRUE
GROUP BY category
ORDER BY category;

SELECT 'pricing_category_taxes' AS table_name, COUNT(*) AS rows FROM pricing_category_taxes
UNION ALL
SELECT 'pricing_category_dims', COUNT(*) FROM pricing_category_dims;
