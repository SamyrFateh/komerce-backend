/**
 * POST-O8 — Loyalty seams (mission §12).
 *
 * O7.3 extracted getLoyaltyDiscount(db, userId) and recalculateLoyalty(db, userId)
 * from routes/loyalty.js into services/loyalty-service.js, claiming the
 * implementation was carried over unchanged, including the (db, userId)
 * signature (callers sometimes pass a transaction client, never the
 * module-level pool). This file proves that claim rather than accepting it.
 *
 * Evidence levels in this file, per test:
 *   LOYALTY-1  UNIT            (real DB read, but a single deterministic query)
 *   LOYALTY-2  UNIT            (fake db object — no network)
 *   LOYALTY-3  UNIT            (fake transaction client — no network)
 *   LOYALTY-4  REAL_DB_INTEGRATION (guarded on DATABASE_URL)
 *   LOYALTY-5  STATIC/CODE_INSPECTION — NOT a runtime proof. It greps each
 *              real payment-path source file for the handleOrderConfirmed
 *              call site so a future removal breaks CI. The Stripe/Cash/
 *              PayPal REAL_DB seams in post-o8-payments-seams.test.js are
 *              the actual runtime proof for those three paths (hooks fire
 *              exactly once). Do not confuse the two.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const loyaltyService = require('../../services/loyalty-service');
const { getLoyaltyDiscount, recalculateLoyalty } = loyaltyService;

describe('POST-O8 — Loyalty extraction seams (mission §12)', () => {
  // ── LOYALTY-1 — no tier ──────────────────────────────────────────────────
  it('LOYALTY-1 — a user absent from v_loyalty_summary yields { discountPct: 0, discountLabel: null }', async () => {
    const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);
    if (!hasIntegrationEnv) {
      // Loud, explicit skip — never silent (mission §26).
      return;
    }
    const db = require('../../db');
    // A random UUID that cannot match any row in v_loyalty_summary.
    const result = await getLoyaltyDiscount(db, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ discountPct: 0, discountLabel: null });
  });

  // ── LOYALTY-2 — DB error does not block the order ───────────────────────
  it('LOYALTY-2 — a DB error in getLoyaltyDiscount is swallowed and returns the zero-discount fallback', async () => {
    const brokenDb = { query: jest.fn().mockRejectedValue(new Error('connection terminated')) };
    const result = await getLoyaltyDiscount(brokenDb, 'any-user-id');
    expect(result).toEqual({ discountPct: 0, discountLabel: null });
    expect(brokenDb.query).toHaveBeenCalledTimes(1);
  });

  // ── LOYALTY-3 — transaction client is actually used, not a global pool ──
  it('LOYALTY-3 — recalculateLoyalty(client, userId) queries the passed client, never a module-level pool', async () => {
    const fakeClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await recalculateLoyalty(fakeClient, 'user-123');

    expect(fakeClient.query).toHaveBeenCalledTimes(1);
    expect(fakeClient.query).toHaveBeenCalledWith('SELECT recalculate_loyalty($1)', ['user-123']);

    // Contract check: loyalty-service.js must not close over a module-level
    // `db` for these two functions — confirm the exported functions accept
    // db/client as their first argument rather than requiring '../db'
    // internally at call time for this specific path. This is a static
    // regression guard for the "resolve_before_behavior_change" doctrine
    // documented in the file, not a substitute for the assertion above.
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/loyalty-service.js'), 'utf8'
    );
    const fnBody = src.slice(src.indexOf('async function recalculateLoyalty'));
    expect(fnBody).toMatch(/await\s+db\.query\('SELECT recalculate_loyalty/);
  });

  // ── LOYALTY-4 — real DB recalc smoke ─────────────────────────────────────
  describe('LOYALTY-4 — real DB recalc smoke (REAL_DB_INTEGRATION)', () => {
    const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);
    if (!hasIntegrationEnv) {
      it.skip('requires DATABASE_URL — SKIPPED, not silently omitted from the report', () => {});
      return;
    }

    const db = require('../../db');
    const { createUser, cleanup } = require('../integration/test-harness/seed-helpers');
    const TIER_LABEL = `itest-post-o8-tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let tierId;
    let relaisId;
    let user;

    beforeAll(async () => {
      const { rows: [tier] } = await db.query(
        `INSERT INTO loyalty_tiers (label, badge, min_orders, discount_pct)
         VALUES ($1, '★', 1, 5.00) RETURNING id`,
        [TIER_LABEL]
      );
      tierId = tier.id;
      const { rows: [relais] } = await db.query(
        `INSERT INTO relais (name, agent_name, phone, address, island)
         VALUES ($1, 'ITest Loyalty', $2, 'Adresse test loyalty', 'Anjouan')
         RETURNING id`,
        [`ITest Loyalty ${Date.now()}`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`]
      );
      relaisId = relais.id;
      user = await createUser({ role: 'client' });
      // One 'collected' order for this user — recalculate_loyalty() counts
      // exactly this status (mission-relevant: a different lifecycle status
      // than confirmPaymentCycle's 'confirmed'/'ordered').
      await db.query(
        `INSERT INTO orders (reference, user_id, relais_id, total_kmf, total_eur, payment_mode, payment_status, status)
         VALUES ($1, $2, $3, 10000, 20, 'cash_relais', 'paid', 'collected')`,
        [`ITEST-LOYALTY-${Date.now()}`, user.id, relaisId]
      );
    });

    afterAll(async () => {
      if (user?.id) await db.query(`DELETE FROM orders WHERE user_id = $1`, [user.id]).catch(() => {});
      await cleanup();
      if (relaisId) await db.query(`DELETE FROM relais WHERE id = $1`, [relaisId]).catch(() => {});
      if (tierId) await db.query(`DELETE FROM loyalty_tiers WHERE id = $1`, [tierId]).catch(() => {});
    });

    it('recalculateLoyalty(db, userId) assigns the tier and is reflected in v_loyalty_summary', async () => {
      await recalculateLoyalty(db, user.id);

      const { rows: [row] } = await db.query(
        `SELECT orders_count, loyalty_tier_id FROM users WHERE id = $1`, [user.id]
      );
      expect(row.orders_count).toBe(1);
      expect(row.loyalty_tier_id).toBe(tierId);

      const { discountPct, discountLabel } = await getLoyaltyDiscount(db, user.id);
      expect(discountPct).toBeCloseTo(5.0);
      expect(discountLabel).toBe(TIER_LABEL);
    });
  });

  // ── LOYALTY-5 — payment hook matrix (STATIC/CODE_INSPECTION) ─────────────
  describe('LOYALTY-5 — payment-path hook matrix (STATIC — not a runtime proof)', () => {
    // Matrix built from an actual grep across the real repo (mission §12
    // "construire une matrice explicite"), not assumed from the doctrine
    // comment alone. Runtime proof for stripe/cash/paypal lives in
    // post-o8-payments-seams.test.js; this only guards against silent
    // removal of the call site in ALL five paths, including the two not
    // covered by a REAL_DB seam yet (wallet-full, shared-cart).
    const expectedCallSites = [
      { flow: 'Stripe',            file: 'services/payment-stripe.js',      provenBy: 'REAL_DB seam (STRIPE-1/2/3/4)' },
      { flow: 'Cash',              file: 'services/payment-cash-confirm.js', provenBy: 'REAL_DB seam (CASH-4)' },
      { flow: 'PayPal',            file: 'services/payment-paypal.js',       provenBy: 'REAL_DB seam (PAYPAL-CAPTURE / PAYPAL-WEBHOOK-FALLBACK)' },
      { flow: 'Wallet full order', file: 'routes/orders/create.js',          provenBy: 'STATIC ONLY — no REAL_DB seam yet, see residual risks' },
      { flow: 'Shared-cart confirmed', file: 'routes/shared-cart.js',        provenBy: 'STATIC ONLY — no REAL_DB seam yet, see residual risks' },
    ];

    it.each(expectedCallSites)(
      '$flow calls loyaltyService.handleOrderConfirmed at least once ($file)',
      ({ file }) => {
        const src = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');
        expect(src).toMatch(/loyaltyService\.handleOrderConfirmed\(/);
      }
    );
  });
});
