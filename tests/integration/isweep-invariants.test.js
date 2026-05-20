const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

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
    const purchasing = read('routes/purchasing.js');

    expect(purchasing).toContain('already_exists');
    expect(purchasing).toMatch(/WHERE\s+order_id\s*=\s*\$1[\s\S]*AND\s+product_supplier_id\s*=\s*\$2[\s\S]*AND\s+status\s*!=\s*'cancelled'/i);
  });

  test('G3: collective repairs cover ready_to_capture sessions and stock reservations', () => {
    const route = read('routes/admin-collective-repairs.js');
    const manifest = read('bootstrap/api-routes.js');
    const readyRepair = read('services/repair-collective-ready-to-capture.js');
    const stockRepair = read('services/repair-collective-stock-reservations.js');

    expect(manifest).toContain("require('../routes/admin-collective-repairs')");
    expect(manifest).toContain("app.use('/api/admin/collective', adminCollectiveRepairsRouter)");
    expect(route).toContain("router.post('/repair-ready-to-capture'");
    expect(route).toContain("router.post('/repair-stock-reservations'");
    expect(route).toContain('requireRole([\'admin\'])');
    expect(readyRepair).toContain('ready_to_capture');
    expect(readyRepair).toContain('captureAllAndCreateOrder');
    expect(stockRepair).toContain('consumeForWorkspace');
    expect(stockRepair).toContain('releaseForWorkspace');
  });

  test('G4: cancellation syncs purchase orders and refund remains an explicit admin financial action', () => {
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
    expect(auth).toContain('processRefund');
    expect(refund).toContain('dryRun');
    expect(refund).toContain('manual_cash');
    expect(refund).toMatch(/newStatus\s*:\s*['"]refunded['"]/);
    expect(refund).toContain('processRefund');
  });

  test('G5: catalogue and pricing changes are audited and guarded server-side', () => {
    const products = read('routes/products.js');
    const pricing = read('services/apply-pricing-updates.js');
    const guard = read('services/product-publication-guard.js');
    const audit = read('services/product-price-audit.js');

    expect(products).toContain('recordProductPriceChange');
    expect(products).toContain('auditProductStockChange');
    expect(products).toContain('validatePublicationUpdate');
    expect(pricing).toContain('computeServerSurvival');
    expect(pricing).toContain('recordProductPriceChange');
    expect(pricing).toContain('below_survival_server');
    expect(guard).toContain('product_stock_audit');
    expect(audit).toContain('price_history');
  });
});
