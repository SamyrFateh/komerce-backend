/**
 * @komerce-arch
 * @role          bootstrap-startup-migrations
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       scripts/migration-037-fix-products.js, scripts/migration-038-replace-products.js, scripts/migration-039-french-descriptions.js, scripts/run-migrations.js, utils/logger.js
 * @db-write      charges, finance_config, users
 * @db-read      charges, columns, pg_constraint, pg_enum, pg_type
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-06
 */

'use strict';

const log = require('../utils/logger').child({ module: 'startup-migrations' });

/**
 * H1F — Startup migrations bootstrap.
 *
 * Extracted from server.js without changing execution order or SQL content.
 * All historical startup migrations remain non-fatal at the individual block
 * level, and the caller keeps the global non-fatal catch.
 */

async function runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds }) {
  await fixAdminHash();
  await fixMissingSchema();
  await runAllSeeds();

  try {
    await db.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'transit_comores_at')
        THEN ALTER TABLE orders RENAME COLUMN transit_comores_at TO in_transit_at;
             RAISE NOTICE 'Phase1: renamed transit_comores_at → in_transit_at';
        END IF;
      END$$
    `);
  } catch(e) { log.warn({ err: e }, 'Phase1 migration (non-fatal):'); }

  try {
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'scan_step' AND e.enumlabel = 'in_transit')
        THEN ALTER TYPE scan_step ADD VALUE 'in_transit' AFTER 'shipped';
             RAISE NOTICE 'Phase1: added in_transit to scan_step';
        END IF;
      END$$
    `);
  } catch(e) { log.warn({ err: e }, 'Phase1 scan_step migration (non-fatal):'); }

  try {
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stock_nonneg')
      THEN ALTER TABLE products ADD CONSTRAINT chk_stock_nonneg CHECK (stock >= 0 OR stock IS NULL);
           RAISE NOTICE 'F34: stock CHECK constraint added';
      END IF;
    END$$`);
  } catch(e) { log.warn({ err: e }, 'F34 stock CHECK (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number TEXT NOT NULL UNIQUE,
        order_id UUID NOT NULL REFERENCES orders(id),
        parcel_id UUID REFERENCES parcels(id),
        client_name TEXT NOT NULL,
        client_phone TEXT NOT NULL,
        relay_name TEXT NOT NULL,
        items_snapshot JSONB NOT NULL,
        subtotal_kmf INTEGER NOT NULL,
        shipping_kmf INTEGER NOT NULL DEFAULT 0,
        total_kmf INTEGER NOT NULL,
        payment_mode TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'paid',
        delivered_via TEXT,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
      CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    `);
    log.info('✅ Migration 023: invoices table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 023 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parcel_ref VARCHAR(30),
        order_ref VARCHAR(30),
        channel VARCHAR(20) NOT NULL,
        event VARCHAR(50) NOT NULL,
        recipient VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        detail JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notif_parcel ON notification_log(parcel_ref);
      CREATE INDEX IF NOT EXISTS idx_notif_order ON notification_log(order_ref);
      CREATE INDEX IF NOT EXISTS idx_notif_channel ON notification_log(channel);
      CREATE INDEX IF NOT EXISTS idx_notif_created ON notification_log(created_at DESC);
    `);
    log.info('✅ Migration 024: notification_log table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 024 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE,
        purpose TEXT NOT NULL DEFAULT 'login',
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE otp_codes ALTER COLUMN code TYPE TEXT;
      ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';
      ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
      CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose_created ON otp_codes(phone, purpose, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
    `);
    log.info('✅ Migration 025: otp_codes table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 025 (non-fatal):'); }

  try {
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'order_status' AND e.enumlabel = 'pending')
        THEN ALTER TYPE order_status ADD VALUE 'pending' BEFORE 'confirmed';
             RAISE NOTICE 'Added pending to order_status enum';
        END IF;
      END$$
    `);
  } catch(e) { log.warn({ err: e }, 'Pending enum migration (non-fatal):'); }

  await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`);
  log.info('[MIGRATION] pending_at + confirmed_at columns ensured');

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_item_id UUID,
        order_id UUID,
        product_id UUID,
        quantity INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'received',
        parcel_id UUID,
        received_at TIMESTAMPTZ DEFAULT NOW(),
        assigned_at TIMESTAMPTZ,
        buffer_reason TEXT,
        buffer_until TIMESTAMPTZ,
        received_by UUID,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory_items(status);
      CREATE INDEX IF NOT EXISTS idx_inventory_parcel ON inventory_items(parcel_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_order_item ON inventory_items(order_item_id);
    `);
    log.info('✅ Migration 026: inventory_items table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 026 (non-fatal):'); }

  try {
    await db.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS completion_ratio FLOAT DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_received INT DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_total INT DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_dispatch TIMESTAMPTZ;
    `);
    log.info('✅ Migration 027: orders enrichment columns ready');
  } catch(e) { log.warn({ err: e }, 'Migration 027 (non-fatal):'); }

  // Migration 028 : transitaire user
  // Nécessite TRANSITAIRE_PASSWORD — pas de fallback hardcodé (règle SEC-2).
  // Si la variable est absente, on logue un avertissement et on skip.
  try {
    const transitPwd = process.env.TRANSITAIRE_PASSWORD;
    if (!transitPwd) {
      log.warn('⚠️  TRANSITAIRE_PASSWORD non défini — seeding transitaire ignoré (définir la variable pour activer ce compte)');
    } else {
      const bcrypt = require('bcryptjs');
      const transitHash = await bcrypt.hash(transitPwd, 10);
      await db.query(`
        INSERT INTO users (id, full_name, email, phone, role, password_hash)
        VALUES (gen_random_uuid(), 'Transitaire Komerce', 'transitaire@komerce.km', '+2690000003', 'agent_transitaire', $1)
        ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'agent_transitaire'
      `, [transitHash]);
      log.info('✅ Migration 028: transitaire user seeded');
    }
  } catch(e) { log.warn({ err: e }, 'Migration 028 (non-fatal):'); }

  try {
    await db.query(`
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_parcel_id UUID;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ;
    `);
    log.info('✅ Migration 029: inventory_items proposal columns ready');
  } catch(e) { log.warn({ err: e }, 'Migration 029 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS pricing_matrices_audit (
        id             SERIAL PRIMARY KEY,
        matrix_type    VARCHAR(20) NOT NULL CHECK (matrix_type IN ('taxes', 'dims')),
        category       VARCHAR(50) NOT NULL,
        old_value      JSONB NOT NULL,
        new_value      JSONB NOT NULL,
        changed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
        change_reason  TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pma_created ON pricing_matrices_audit(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pma_matrix_cat ON pricing_matrices_audit(matrix_type, category);
    `);
    log.info('✅ Migration 033: pricing_matrices_audit table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 033 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cart_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        share_token VARCHAR(16) NOT NULL,
        cart_items JSONB NOT NULL,
        cart_total_kmf BIGINT NOT NULL,
        items_count SMALLINT NOT NULL,
        sharer_name VARCHAR(50),
        sharer_ip_hash VARCHAR(64),
        sharer_ua_hash VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_opened_at TIMESTAMPTZ,
        open_count INT NOT NULL DEFAULT 0,
        converted_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        converted_at TIMESTAMPTZ,
        CONSTRAINT unique_share_token UNIQUE (share_token)
      );
      CREATE INDEX IF NOT EXISTS idx_cart_shares_token ON cart_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_cart_shares_created ON cart_shares(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cart_shares_converted ON cart_shares(converted_order_id)
        WHERE converted_order_id IS NOT NULL;
    `);
    log.info('✅ Migration 030: cart_shares table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 030 (non-fatal):'); }

  try {
    await db.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
      CREATE INDEX IF NOT EXISTS idx_products_category_subcategory 
        ON products(category, subcategory) WHERE is_available = TRUE;
    `);
    log.info('✅ Migration 031: products.subcategory column ready');
  } catch(e) { log.warn({ err: e }, 'Migration 031 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cash_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        amount_kmf INTEGER NOT NULL,
        collected_by UUID NOT NULL,
        relais_id UUID,
        confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_coll_order ON cash_collections(order_id);
      CREATE INDEX IF NOT EXISTS idx_cash_coll_agent ON cash_collections(collected_by);
      CREATE INDEX IF NOT EXISTS idx_cash_coll_date ON cash_collections(confirmed_at DESC);
    `);
    log.info('✅ Migration 034: cash_collections table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 034 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cash_deposits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        amount_kmf INTEGER NOT NULL,
        deposit_method TEXT NOT NULL,
        reference TEXT,
        proof_url TEXT,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        deposited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        verified_by UUID,
        verified_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cash_dep_agent ON cash_deposits(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cash_dep_status ON cash_deposits(status);
      CREATE INDEX IF NOT EXISTS idx_cash_dep_period ON cash_deposits(period_start, period_end);
    `);
    log.info('✅ Migration 035: cash_deposits table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 035 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cash_reconciliation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        expected_kmf INTEGER NOT NULL DEFAULT 0,
        declared_kmf INTEGER NOT NULL DEFAULT 0,
        deposited_kmf INTEGER NOT NULL DEFAULT 0,
        gap_collection INTEGER NOT NULL DEFAULT 0,
        gap_deposit INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID,
        reviewed_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cash_recon_agent ON cash_reconciliation(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cash_recon_status ON cash_reconciliation(status);
      CREATE INDEX IF NOT EXISTS idx_cash_recon_period ON cash_reconciliation(period_start, period_end);
    `);
    log.info('✅ Migration 036: cash_reconciliation table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 036 (non-fatal):'); }

  try {
    const migration037 = require('../scripts/migration-037-fix-products');
    await migration037(db);
    log.info('✅ Migration 037: products is_active + subcategory fixed');
  } catch(e) { log.warn({ err: e }, 'Migration 037 (non-fatal):'); }

  try {
    const migration038 = require('../scripts/migration-038-replace-products');
    await migration038(db);
    log.info('✅ Migration 038: product catalog replaced');
  } catch(e) { log.warn({ err: e }, 'Migration 038 (non-fatal):'); }

  try {
    const migration039 = require('../scripts/migration-039-french-descriptions');
    await migration039();
    log.info('✅ Migration 039: descriptions updated to French');
  } catch(e) { log.warn({ err: e }, 'Migration 039 (non-fatal):'); }

  try {
    await db.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
    log.info('✅ Migration 041: users.email now nullable (guest checkout)');
  } catch(e) { log.warn({ err: e }, 'Migration 041 (non-fatal):'); }

  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_payer VARCHAR(30);
      CREATE INDEX IF NOT EXISTS idx_users_phone_payer ON users(phone_payer);
    `);
    log.info('✅ Migration 040: phone_payer column added');
  } catch(e) { log.warn({ err: e }, 'Migration 040 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS economic_variables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        unit TEXT DEFAULT 'KMF',
        value_supposed NUMERIC,
        value_observed NUMERIC,
        value_used NUMERIC,
        source_used TEXT DEFAULT 'supposed',
        description TEXT,
        is_critical BOOLEAN DEFAULT FALSE,
        is_computed BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    log.info('✅ Migration 046: economic_variables table created');
  } catch(e) { log.warn({ err: e }, 'Migration 046 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS charges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family TEXT NOT NULL,
        name TEXT NOT NULL,
        amount_kmf NUMERIC NOT NULL,
        is_recurring BOOLEAN DEFAULT FALSE,
        recurrence_period TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    log.info('✅ Migration 047: charges table created');
  } catch(e) { log.warn({ err: e }, 'Migration 047 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS economic_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_data JSONB NOT NULL,
        model_status TEXT NOT NULL DEFAULT 'stable',
        trigger_event TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    log.info('✅ Migration 048: economic_snapshots table created');
  } catch(e) { log.warn({ err: e }, 'Migration 048 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS finance_config (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        cost_fixed_sourcing_kmf     INT NOT NULL DEFAULT 1000,
        cost_fixed_transit_kmf      INT NOT NULL DEFAULT  500,
        cost_fixed_hub_kmf          INT NOT NULL DEFAULT  400,
        cost_fixed_relais_kmf       INT NOT NULL DEFAULT  300,
        cost_fixed_support_kmf      INT NOT NULL DEFAULT  200,
        target_marge_brute_pct      NUMERIC(5,2) NOT NULL DEFAULT 30.00,
        target_panier_moyen_kmf     INT NOT NULL DEFAULT 15000,
        objectif_commandes_mois     INT NOT NULL DEFAULT 100,
        objectif_ca_mensuel_kmf     INT NOT NULL DEFAULT 1500000,
        taux_change_eur_kmf         NUMERIC(10,2) NOT NULL DEFAULT 491.96,
        markup_cible_pct            NUMERIC(5,2) NOT NULL DEFAULT 250.00,
        cout_achat_moyen_eur        NUMERIC(10,2) NOT NULL DEFAULT 5.00,
        delai_transit_jours         INT NOT NULL DEFAULT 25,
        commission_relais_pct       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
        frais_livraison_defaut_kmf  INT NOT NULL DEFAULT 1500,
        seuil_livraison_gratuite_kmf INT NOT NULL DEFAULT 25000,
        taux_conversion_pct         NUMERIC(5,2) NOT NULL DEFAULT 3.00,
        taux_retour_pct             NUMERIC(5,2) NOT NULL DEFAULT 2.00,
        loyalty_active              BOOLEAN NOT NULL DEFAULT TRUE,
        loyalty_threshold_kmf       INT NOT NULL DEFAULT 20000,
        loyalty_trigger_count       INT NOT NULL DEFAULT 3,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by UUID
      );
      INSERT INTO finance_config (id) VALUES (1) ON CONFLICT DO NOTHING;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS big_basket_count INT NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS big_basket_last_notified_count INT NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS loyalty_rewards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        triggered_by_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        basket_count_at_trigger INT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'granted', 'skipped')),
        gift_description TEXT,
        granted_at TIMESTAMPTZ,
        granted_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_user ON loyalty_rewards(user_id);
      CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_status ON loyalty_rewards(status);
      CREATE INDEX IF NOT EXISTS idx_users_big_basket ON users(big_basket_count) WHERE big_basket_count > 0;
    `);
    log.info('✅ Migration 049: finance_config + loyalty_rewards + big_basket');
  } catch(e) { log.warn({ err: e }, 'Migration 049 (non-fatal):'); }

  try {
    await db.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sourcing_rail TEXT;
      -- cost_price_kmf / weight_g RETIRÉS d'ici le 2026-06-24 : dépréciées
      -- depuis la migration 087 (Lot C5), supprimées par la migration 089
      -- (garde-fou date, exécutable à partir du 2026-07-08). Les recréer ici
      -- au boot annulerait silencieusement le drop à chaque redémarrage.
      ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_class TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS fragility TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_mode TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS exposure_mode TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'candidate';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS quality_validated BOOLEAN DEFAULT FALSE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS real_weight_known BOOLEAN DEFAULT FALSE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS real_price_validated BOOLEAN DEFAULT FALSE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_delay_days INTEGER;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_notes TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS last_review_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_products_sourcing_rail ON products(sourcing_rail) WHERE sourcing_rail IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_lifecycle ON products(lifecycle_status) WHERE is_active = TRUE;
    `);
    log.info('✅ Migration 050: sourcing columns on products');
  } catch(e) { log.warn({ err: e }, 'Migration 050 (non-fatal):'); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        signal_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info'
          CHECK (severity IN ('info','warning','critical','urgent')),
        title TEXT NOT NULL,
        summary TEXT,
        source_module TEXT NOT NULL DEFAULT 'signal-service',
        target_shell TEXT DEFAULT 'bo',
        target_view TEXT,
        target_filters JSONB DEFAULT '{}',
        owner_role TEXT NOT NULL DEFAULT 'admin',
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','acknowledged','snoozed','resolved','expired')),
        entity_type TEXT,
        entity_id TEXT,
        recommendation TEXT,
        confidence TEXT DEFAULT 'high'
          CHECK (confidence IN ('low','medium','high')),
        meta JSONB DEFAULT '{}',
        snoozed_until TIMESTAMPTZ,
        escalated_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status) WHERE status IN ('open','acknowledged');
      CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
      CREATE INDEX IF NOT EXISTS idx_signals_severity ON signals(severity);
      CREATE INDEX IF NOT EXISTS idx_signals_owner ON signals(owner_role);
      CREATE INDEX IF NOT EXISTS idx_signals_entity ON signals(entity_type, entity_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup
        ON signals(signal_type, entity_type, entity_id) WHERE status = 'open';
    `);
    log.info('✅ Migration 051: signals table created');
  } catch(e) { log.warn({ err: e }, 'Migration 051 (non-fatal):'); }

  // ── Migration 050b : order_item_cost_imputations (snapshot économique figé) ──
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_item_cost_imputations (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        order_item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
        product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
        quantity              INTEGER NOT NULL,
        sale_unit_price_kmf   NUMERIC(12,2) NOT NULL,
        sale_total_kmf        NUMERIC(12,2) NOT NULL,
        estimated_landed_relay_cost_kmf      NUMERIC(12,2),
        estimated_business_complete_cost_kmf NUMERIC(12,2),
        estimated_margin_kmf                 NUMERIC(12,2),
        estimated_margin_pct                 NUMERIC(6,2),
        cost_breakdown         JSONB,
        allocations            JSONB,
        allocation_averages    JSONB,
        allocation_confidence  TEXT,
        data_quality           JSONB,
        pricing_source         TEXT NOT NULL DEFAULT 'pricing-engine',
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_oici_order      ON order_item_cost_imputations(order_id);
      CREATE INDEX IF NOT EXISTS idx_oici_product    ON order_item_cost_imputations(product_id);
      CREATE INDEX IF NOT EXISTS idx_oici_created_at ON order_item_cost_imputations(created_at);
      DO $do$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'order_item_cost_imputations_order_item_id_unique'
        ) THEN
          ALTER TABLE order_item_cost_imputations
            ADD CONSTRAINT order_item_cost_imputations_order_item_id_unique UNIQUE (order_item_id);
        END IF;
      END $do$;
    `);
    log.info('✅ Migration 050b: order_item_cost_imputations table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 050b (non-fatal):'); }

  // ── Migration 051b : order_item_real_cost_allocations (réventilation terrain) ──
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_item_real_cost_allocations (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        order_item_id     UUID REFERENCES order_items(id) ON DELETE CASCADE,
        cost_type         TEXT NOT NULL,
        allocation_method TEXT NOT NULL DEFAULT 'manual',
        amount_kmf        NUMERIC(12,2) NOT NULL,
        is_actual         BOOLEAN NOT NULL DEFAULT TRUE,
        confidence        TEXT DEFAULT 'high',
        source            TEXT,
        parcel_id         UUID REFERENCES parcels(id) ON DELETE SET NULL,
        shipment_id       UUID,
        meta              JSONB DEFAULT '{}',
        allocated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_oirca_order      ON order_item_real_cost_allocations(order_id);
      CREATE INDEX IF NOT EXISTS idx_oirca_item       ON order_item_real_cost_allocations(order_item_id);
      CREATE INDEX IF NOT EXISTS idx_oirca_cost_type  ON order_item_real_cost_allocations(cost_type);
      CREATE INDEX IF NOT EXISTS idx_oirca_is_actual  ON order_item_real_cost_allocations(is_actual);
    `);
    log.info('✅ Migration 051b: order_item_real_cost_allocations table ready');
  } catch(e) { log.warn({ err: e }, 'Migration 051b (non-fatal):'); }

  try {
    const { rows: existingCharges } = await db.query('SELECT COUNT(*) as c FROM charges');
    if (parseInt(existingCharges[0].c) === 0) {
      await db.query(`
        INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period, is_active, notes) VALUES
        ('logistique', 'Hub Dubai', 40000, true, 'monthly', true, 'Réception & stockage Dubai — défaut 400 KMF/cmd Ã— 100 cmd/mois'),
        ('logistique', 'Relais Comores', 30000, true, 'monthly', true, 'Points relais Comores — défaut 300 KMF/cmd Ã— 100 cmd/mois'),
        ('approvisionnement', 'Sourcing Dubai', 100000, true, 'monthly', true, 'Achat & approvisionnement — défaut 1000 KMF/cmd Ã— 100 cmd/mois'),
        ('support', 'Support client', 20000, true, 'monthly', true, 'SAV & support client — défaut 200 KMF/cmd Ã— 100 cmd/mois'),
        ('logistique', 'Transit Comores', 500, false, null, true, 'Transport Dubai→Comores — variable par commande')
      `);
      log.info('✅ Migration 052: 5 charges seeded with defaults');
    } else {
      log.info('✅ Migration 052: charges already seeded, skipping');
    }
  } catch(e) { log.warn({ err: e }, 'Migration 052 (non-fatal):'); }

  // ── Runner de migrations fichier (migrations/NNN*.sql) ───────────────────
  // Auto-applique les migrations .sql non encore enregistrées dans
  // schema_migrations. SÛR : ne fait rien tant que la base n'a pas été baselinée
  // (cf. scripts/run-migrations.js --baseline). Non-fatal.
  try {
    const { runPendingSafe } = require('../scripts/run-migrations');
    const res = await runPendingSafe();
    if (res.applied && res.applied.length) {
      log.info({ applied: res.applied }, '✅ Runner: migrations fichier appliquées');
    }
  } catch (e) { log.warn({ err: e }, 'Runner migrations fichier (non-fatal):'); }

  log.info('✅ Migrations et seeds terminées');
}

module.exports = {
  runStartupMigrations,
};

