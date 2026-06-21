'use strict';
/**
 * tests/integration/isweep-invariants.test.js
 *
 * Filet de non-régression I-SWEEP : vérifie par lecture statique du code
 * source (pas de requête DB réelle) que les invariants posés par les lots
 * I-01..I-02 / G1..G5 tiennent toujours.
 *
 * Gardé sous tests/integration (et pas tests/unit) pour rester groupé avec
 * le reste des suites de régression I-SWEEP/sécurité, et gardé derrière le
 * même garde DATABASE_URL que security-grid.test.js par cohérence — même si
 * cette suite particulière ne touche jamais la DB, ce garde évite qu'elle
 * tourne de façon incohérente avec ses suites soeurs en CI/local.
 * Sans DATABASE_URL → suite skippée proprement (comme security-grid).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('I-SWEEP invariants regression net (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {

describe('I-SWEEP invariants regression net', () => {
  test('I-01/I-02: pickup cash is routed through payment confirmation cycle, not direct status update', () => {
    const service = read('services/confirm-pickup-cash-payment.js');
    const auth = read('middleware/auth.js');

    expect(auth).toContain('isPickupPayCashRequest');
    expect(auth).toContain('handleSafePickupCash');
    expect(service).toContain('confirmPaymentCycle');
    expect(service).toContain('generateAndStoreSecret');
    expect(service).toContain('cash_collections');
    expect(service).toContain('ON CONFLICT (order_id) DO NOTHING');

    expect(service).not.toMatch(/UPDATE\s+orders\s+SET\s+status\s*=\s*'confirmed'/i);
  });

  test('I-03/I-09: QR verify performs order transition, scan insert and parcel sync before commit', () => {
    const service = read('services/verify-qr-collection.js');

    expect(service).toContain('transitionOrderStatus');
    expect(service).toContain("newStatus: 'collected'");
    expect(service).toContain('safeSyncScanToParcels');
    expect(service).toContain('Retrait client via QR Code');

    const syncIndex = service.indexOf('safeSyncScanToParcels');
    const commitIndex = service.indexOf("client.query('COMMIT')");
    expect(syncIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeLessThan(commitIndex);
  });

  test('G2: Stripe order intent uses command-level idempotency and reuses existing PaymentIntent', () => {
    const service = read('services/create-stripe-order-intent.js');

    expect(service).toContain('stripe_payment_id');
    expect(service).toContain('paymentIntents.retrieve');
    expect(service).toContain('paymentIntents.create');
    expect(service).toContain('idempotencyKey');
    expect(service).toContain('pi_order_${order.id}');
  });

  test('G2: triggerPurchasing prevents replay duplicates per order and product supplier mapping', () => {
    // Après A-BE-05 : logique métier dans services/purchasing-trigger-service.js
    const triggerService = read('services/purchasing-trigger-service.js');

    expect(triggerService).toContain('already_exists');
    expect(triggerService).toMatch(/WHERE\s+order_id\s*=\s*\$1[\s\S]*AND\s+product_supplier_id\s*=\s*\$2[\s\S]*AND\s+status\s*!=\s*'cancelled'/i);
  });

  // G3 mis à jour 2026-06-01 : le système collective_workspaces a été démonté (ZG-3, 2026-05-30).
  // L'invariant n'est plus « la route repair existe » mais « elle n'est PLUS montée ».
  test('G3: collective repairs route is unmounted (collective_workspaces decommissioned ZG-3)', () => {
    const manifest = read('bootstrap/api-routes.js');
    expect(manifest).not.toContain("app.use('/api/admin/collective', adminCollectiveRepairsRouter)");
    expect(manifest).toContain('ZG-3');
  });

  test('G4: cancellation syncs purchase orders and final financial action remains explicit', () => {
    const machine = read('services/order-status-machine.js');
    const poSync = read('services/cancel-order-purchase-orders.js');
    const refund = read('services/admin-order-refund.js');
    const auth = read('middleware/auth.js');

    expect(machine).toContain('syncPurchaseOrdersOnOrderCancel');
    expect(poSync).toContain('AUTO_CANCEL_STATUSES');
    expect(poSync).toContain("'pending'");
    expect(poSync).toContain("'notified'");
    expect(poSync).toContain('order_cancel_purchasing');

    expect(auth).toContain('isAdminOrderRefundRequest');
    expect(auth).toContain('handleAdminOrderRefund');
    expect(auth).toContain('refundCancelledOrder');
    expect(refund).toContain('dryRun');
    expect(refund).toContain('manual_cash');
    expect(refund).toMatch(/newStatus\s*:\s*['"]refunded['"]/);
    expect(refund).toContain('processRefund');
  });

  test('G5: catalogue and pricing changes are audited and guarded server-side', () => {
    const productAdminService = read('services/product-admin-service.js');
    const pricing = read('services/apply-pricing-updates.js');
    const guard = read('services/product-publication-guard.js');
    const audit = read('services/product-price-audit.js');

    expect(productAdminService).toContain('recordProductPriceChange');
    expect(productAdminService).toContain('auditProductStockChange');
    expect(productAdminService).toContain('validatePublicationUpdate');
    expect(pricing).toContain('computeServerSurvival');
    expect(pricing).toContain('recordProductPriceChange');
    expect(pricing).toContain('below_survival_server');
    expect(guard).toContain('product_stock_audit');
    expect(audit).toContain('price_history');
  });
});

} // end hasIntegrationEnv guard
