/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

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
 *   LOYALTY-2  UNIT            (fake db object — no network)
 *   LOYALTY-3  UNIT            (fake transaction client — no network)
 *   LOYALTY-5  STATIC/CODE_INSPECTION — NOT a runtime proof. It greps each
 *              real payment-path source file for the handleOrderConfirmed
 *              call site so a future removal breaks CI. The Stripe/Cash/
 *              PayPal REAL_DB seams in post-o8-payments-seams.test.js are
 *              the actual runtime proof for those three paths (hooks fire
 *              exactly once). Do not confuse the two.
 *
 * LOYALTY-1 (real DB read) and LOYALTY-4 (real DB recalc smoke) were
 * extracted to tests/integration/post-o8-loyalty-real-db.test.js — this
 * file mixed two incompatible execution contexts (mission §12, Étape 2 de
 * la classification des tests). Zero coverage lost in the split.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const loyaltyService = require('../../services/loyalty-service');
const { getLoyaltyDiscount, recalculateLoyalty } = loyaltyService;

describe('POST-O8 — Loyalty extraction seams (mission §12)', () => {
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

  // ── LOYALTY-5 — payment hook matrix (STATIC/CODE_INSPECTION) ─────────────
  describe('LOYALTY-5 — payment-path hook matrix (STATIC — not a runtime proof)', () => {
    // Matrix built from an actual grep across the real repo (mission §12
    // "construire une matrice explicite"), not assumed from the doctrine
    // comment alone. Runtime proof for stripe/cash/paypal lives in
    // post-o8-payments-seams.test.js; this only guards against silent
    // removal of the call site in the four paths that create or confirm
    // orders directly.
    //
    // Boutique First — la ligne "Shared-cart confirmed" a été retirée :
    // le panier partagé ne confirme plus ses propres commandes. Une
    // commande issue d'une liste passe par routes/orders/create.js puis
    // par l'un des trois chemins de confirmation ci-dessous (Stripe,
    // Cash, PayPal), exactement comme toute autre commande.
    const expectedCallSites = [
      { flow: 'Stripe',            file: 'services/payment-stripe.js',      provenBy: 'REAL_DB seam (STRIPE-1/2/3/4)' },
      { flow: 'Cash',              file: 'services/payment-cash-confirm.js', provenBy: 'REAL_DB seam (CASH-4)' },
      { flow: 'PayPal',            file: 'services/payment-paypal.js',       provenBy: 'REAL_DB seam (PAYPAL-CAPTURE / PAYPAL-WEBHOOK-FALLBACK)' },
      { flow: 'Wallet full order', file: 'routes/orders/create.js',          provenBy: 'STATIC ONLY — no REAL_DB seam yet, see residual risks' },
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
