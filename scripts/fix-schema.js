/**
 * KOMERCE — Auto-migrations schéma & hash admin
 *
 * Extrait de server.js (FIX-012) — Étape 3 clean-up
 * Exécuté au démarrage avant les seeds.
 */

'use strict';

const db = require('../db');
const bcryptMigrate = require('bcryptjs');

// ── Auto-migration : fix admin bcrypt hash (one-time) ──────────────────────
// Le seed original stockait un hash SHA-256 incompatible avec bcrypt.compare().
// Cette migration corrige automatiquement au premier démarrage.

async function fixAdminHash() {
  try {
    // D3 : Si ADMIN_PASSWORD est défini dans l'env, utiliser ce mot de passe au lieu du défaut
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      console.warn('⚠️  ADMIN_PASSWORD non défini — migration admin hash ignorée');
      return;
    }
    console.log('🔒 ADMIN_PASSWORD défini — migration du hash admin');
    const newAdminHash = await bcryptMigrate.hash(adminPassword, 10);
    const adminResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE email = 'admin@komerce.km'",
      [newAdminHash]
    );
    console.log(`✅ Migration: admin hash forcé — ${adminResult.rowCount} row(s) updated`);

    // If admin doesn't exist at all, create it
    if (adminResult.rowCount === 0) {
      await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ('Admin Komerce', 'admin@komerce.km', '+269000000', 'admin', 'KMF', 'KM', $1)
         ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin'`,
        [newAdminHash]
      );
      console.log('✅ Migration: admin user créé/upserted');
    }

    // Also fix demo clients
    const newClientHash = await bcryptMigrate.hash('client123', 10);
    const clientResult = await db.query(
      "UPDATE users SET password_hash = $1 WHERE role = 'client' AND password_hash NOT LIKE '$2b$%'",
      [newClientHash]
    );
    if (clientResult.rowCount > 0) {
      console.log(`✅ Migration: ${clientResult.rowCount} demo client hashes corrigés`);
    }
  } catch (err) {
    console.error('Migration admin hash error (non-fatal):', err.message);
  }
}

// ── Auto-migration : tables/colonnes manquantes ─────────────────────────────

async function fixMissingSchema() {
  const run = async (label, sql) => {
    try {
      await db.query(sql);
      console.log(`  ✅ ${label}`);
    } catch (err) {
      console.error(`  ⚠️ ${label}: ${err.message}`);
    }
  };

  console.log('🔧 Running schema migrations...');

  // 1. customs_history — colonnes manquantes pour admin/customs
  await run('customs_history.customs_estimated_kmf',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_estimated_kmf INTEGER DEFAULT 0`);
  await run('customs_history.notes',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS notes TEXT`);
  await run('customs_history.customs_agent_id',
    `ALTER TABLE customs_history ADD COLUMN IF NOT EXISTS customs_agent_id UUID`);

  // 2. partners — table manquante pour admin/partners
  await run('partners table', `
    CREATE TABLE IF NOT EXISTS partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      partner_type TEXT NOT NULL DEFAULT 'relais',
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      island TEXT,
      zone TEXT,
      commission_kmf INTEGER DEFAULT 0,
      notes TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 3. loyalty_tiers — table nécessaire pour pilotage/clients
  await run('loyalty_tiers table', `
    CREATE TABLE IF NOT EXISTS loyalty_tiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL UNIQUE,
      min_orders INT NOT NULL DEFAULT 0,
      discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
      badge TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 4. users.loyalty_tier_id — colonne FK pour pilotage/clients
  await run('users.loyalty_tier_id',
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_tier_id UUID`);

  // 5. customs_taux_mensuel — vue pour pilotage.js
  await run('customs_taux_mensuel view', `
    CREATE OR REPLACE VIEW customs_taux_mensuel AS
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') AS mois,
      ROUND(AVG(customs_delta_pct)::numeric, 2) AS taux_effectif_pct
    FROM customs_history
    WHERE customs_real_kmf > 0
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
  `);

  // 6. Seed default loyalty tiers si vide
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM loyalty_tiers');
    if (rows[0].c === 0) {
      await run('loyalty tiers seed', `
        INSERT INTO loyalty_tiers (label, min_orders, discount_pct, badge) VALUES
          ('Bronze',   0,  0, '🥉'),
          ('Silver',   3,  2, '🥈'),
          ('Gold',    10,  5, '🥇'),
          ('Platinum', 25, 8, '💎')
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (err) {
    console.error(`  ⚠️ loyalty seed: ${err.message}`);
  }

  // 7. business_rules — moteur de règles opérationnelles (Point 6)
  await run('business_rules table', `
    CREATE TABLE IF NOT EXISTS business_rules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    )
  `);

  await run('business_rules_history table', `
    CREATE TABLE IF NOT EXISTS business_rules_history (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id       UUID NOT NULL REFERENCES business_rules(id),
      old_value     JSONB,
      new_value     JSONB NOT NULL,
      changed_by    UUID REFERENCES users(id),
      change_reason TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run('refunds table', `
    CREATE TABLE IF NOT EXISTS refunds (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    )
  `);

  await run('store_credits table', `
    CREATE TABLE IF NOT EXISTS store_credits (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id),
      amount_kmf       INTEGER NOT NULL,
      remaining_kmf    INTEGER NOT NULL,
      reason           TEXT,
      source_order_id  UUID REFERENCES orders(id),
      expires_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await run('order_items.availability_status',
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'pending'`);
  await run('order_items.estimated_available_at',
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS estimated_available_at TIMESTAMPTZ`);
  await run('order_items.backorder_reason',
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS backorder_reason TEXT`);

  // Seed business_rules (46 règles par défaut — 36 originales + 10 pricing) — ON CONFLICT DO NOTHING
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM business_rules');
    if (rows[0].c === 0) {
      await run('business_rules seed', `
        INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
        VALUES
          ('orders', 'CANCEL_FREE_WINDOW_HOURS', '{"value": 24}', 'number', 'Fenêtre annulation gratuite (heures)', 'Délai après paiement pour annulation avec remboursement 100%', 1, 168),
          ('orders', 'CANCEL_PARTIAL_REFUND_PCT', '{"value": 80}', 'number', 'Remboursement hors fenêtre (%)', 'Pourcentage remboursé si annulation hors fenêtre gratuite', 0, 100),
          ('orders', 'CANCEL_CUTOFF_STATUS', '{"value": "shipped"}', 'string', 'Statut max pour annulation', 'Au-delà de ce statut, annulation impossible', NULL, NULL),
          ('orders', 'CASH_PAYMENT_TIMEOUT_HOURS', '{"value": 36}', 'number', 'Délai paiement cash relais (heures)', NULL, 12, 168),
          ('orders', 'QR_EXPIRATION_HOURS', '{"value": 48}', 'number', 'Validité QR retrait (heures)', NULL, 6, 168),
          ('orders', 'MAX_QUANTITY_PER_ITEM', '{"value": 100}', 'number', 'Quantité max par article', NULL, 1, 1000),
          ('orders', 'ORDER_ALERT_48H_AVAILABLE', '{"value": 48}', 'number', 'Alerte colis non retiré (heures)', NULL, 12, 168),
          ('shipping', 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', '{"value": 7}', 'number', 'Retard déclenchant expédition partielle (jours)', NULL, 1, 60),
          ('shipping', 'PARTIAL_SHIP_MIN_AVAILABLE_PCT', '{"value": 60}', 'number', 'Articles dispo min pour expé partielle (%)', NULL, 10, 100),
          ('shipping', 'PARTIAL_SHIP_AUTO_NOTIFY', '{"value": true}', 'boolean', 'Notification auto expédition partielle', NULL, NULL, NULL),
          ('shipping', 'BACKORDER_MAX_DAYS', '{"value": 30}', 'number', 'Backorder max (jours)', NULL, 7, 90),
          ('sla', 'SLA_WARNING_DAYS', '{"value": 35}', 'number', 'SLA Warning (jours)', NULL, 7, 90),
          ('sla', 'SLA_LATE_DAYS', '{"value": 42}', 'number', 'SLA Late (jours)', NULL, 14, 120),
          ('sla', 'SLA_BLOCKED_DAYS', '{"value": 56}', 'number', 'SLA Blocked (jours)', NULL, 21, 180),
          ('sla', 'SLA_INACTIVE_DAYS', '{"value": 7}', 'number', 'SLA Inactif (jours)', NULL, 1, 30),
          ('sla', 'PROBLEM_PREP_BLOCKED_DAYS', '{"value": 4}', 'number', 'Préparation bloquée max (jours)', NULL, 1, 14),
          ('sla', 'PROBLEM_TRANSIT_MAX_DAYS', '{"value": 12}', 'number', 'Transit max (jours)', NULL, 5, 60),
          ('sla', 'PROBLEM_WAITING_MAX_DAYS', '{"value": 7}', 'number', 'Attente retrait max (jours)', NULL, 1, 30),
          ('sla', 'PROBLEM_STALLED_DAYS', '{"value": 30}', 'number', 'Commande stagnante (jours)', NULL, 7, 90),
          ('sla', 'PROBLEM_NO_NOTIF_HOURS', '{"value": 1}', 'number', 'Pas de notif après (heures)', NULL, 0.5, 24),
          ('compensation', 'COMP_PREVENTIVE_DAYS', '{"value": 28}', 'number', 'Compensation préventive (jours)', NULL, 7, 60),
          ('compensation', 'COMP_CREDIT_DAYS', '{"value": 35}', 'number', 'Avoir boutique (jours)', NULL, 14, 90),
          ('compensation', 'COMP_DISCOUNT_DAYS', '{"value": 42}', 'number', 'Remise (jours)', NULL, 21, 120),
          ('compensation', 'COMP_REFUND_DAYS', '{"value": 56}', 'number', 'Remboursement auto (jours)', NULL, 28, 180),
          ('loyalty', 'LOYALTY_SILVER_ORDERS', '{"value": 3}', 'number', 'Seuil Silver (commandes)', 'Info — géré via PUT /api/loyalty/tiers/:id', 1, 50),
          ('loyalty', 'LOYALTY_GOLD_ORDERS', '{"value": 10}', 'number', 'Seuil Gold (commandes)', 'Info — géré via PUT /api/loyalty/tiers/:id', 5, 100),
          ('loyalty', 'LOYALTY_PLATINUM_ORDERS', '{"value": 25}', 'number', 'Seuil Platinum (commandes)', 'Info — géré via PUT /api/loyalty/tiers/:id', 10, 200),
          ('loyalty', 'LOYALTY_SILVER_DISCOUNT', '{"value": 2}', 'number', 'Remise Silver (%)', 'Info — géré via PUT /api/loyalty/tiers/:id', 0, 20),
          ('loyalty', 'LOYALTY_GOLD_DISCOUNT', '{"value": 5}', 'number', 'Remise Gold (%)', 'Info — géré via PUT /api/loyalty/tiers/:id', 0, 30),
          ('loyalty', 'LOYALTY_PLATINUM_DISCOUNT', '{"value": 8}', 'number', 'Remise Platinum (%)', 'Info — géré via PUT /api/loyalty/tiers/:id', 0, 50),
          ('pricing', 'CUSTOMS_DEFAULT_PCT', '{"value": 20}', 'number', 'Douane estimée (%)', NULL, 5, 50),
          ('pricing', 'FREIGHT_KMF_PER_KG', '{"value": 65}', 'number', 'Fret par kg (KMF)', NULL, 10, 500),
          ('pricing', 'EUR_KMF_FALLBACK', '{"value": 492}', 'number', 'Taux EUR/KMF fallback', NULL, 400, 600),
          ('pricing', 'AED_KMF_FALLBACK', '{"value": 138}', 'number', 'Taux AED/KMF fallback', NULL, 100, 200),
          ('system', 'DASHBOARD_CACHE_TTL_SEC', '{"value": 30}', 'number', 'Cache dashboard (secondes)', NULL, 5, 300),
          ('system', 'CASH_REMINDER_INTERVAL_MIN', '{"value": 60}', 'number', 'Intervalle rappels cash (minutes)', NULL, 15, 360),
          ('pricing', 'COMMISSION_AGENT_PCT', '{"value": 5}', 'number', 'Commission agent S1 (%)', 'Pourcentage commission agent source S1', 0, 30),
          ('pricing', 'TRANSPORT_DXB_KMF', '{"value": 500}', 'number', 'Transport intra-Dubai (KMF)', NULL, 0, 5000),
          ('pricing', 'TRANSITAIRE_PCT', '{"value": 2}', 'number', 'Commission transitaire (%)', NULL, 0, 20),
          ('pricing', 'TRANSITAIRE_FIXED_KMF', '{"value": 450}', 'number', 'Frais fixes transitaire (KMF)', NULL, 0, 5000),
          ('pricing', 'PORTUAIRES_KMF', '{"value": 1200}', 'number', 'Frais portuaires (KMF)', NULL, 0, 10000),
          ('pricing', 'TRANSPORT_RELAIS_KMF', '{"value": 840}', 'number', 'Transport relais (KMF)', NULL, 0, 5000),
          ('pricing', 'COMMISSION_RELAIS_STANDARD_KMF', '{"value": 500}', 'number', 'Commission relais standard (KMF)', NULL, 0, 5000),
          ('pricing', 'COMMISSION_RELAIS_SHOWROOM_KMF', '{"value": 750}', 'number', 'Commission relais showroom (KMF)', NULL, 0, 5000),
          ('pricing', 'FRAIS_STRIPE_PCT', '{"value": 2.5}', 'number', 'Frais Stripe diaspora (%)', NULL, 0, 10),
          ('pricing', 'MARGE_PCT', '{"value": 12}', 'number', 'Marge commerciale (%)', 'Pourcentage de marge appliqué sur le prix final', 0, 50)
        ON CONFLICT (key) DO NOTHING
      `);
    }
  } catch (err) {
    console.error(`  ⚠️ business_rules seed: ${err.message}`);
  }

  console.log('🔧 Schema migrations complete.');
}

module.exports = { fixAdminHash, fixMissingSchema };
