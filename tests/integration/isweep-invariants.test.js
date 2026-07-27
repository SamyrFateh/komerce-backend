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
  // Approche intercepteur auth.js abandonnée (STATUS.md L621) — logique dans confirm-pickup-cash-payment.js
  // L'invariant reste : le cash relais passe par confirmPaymentCycle, jamais par UPDATE orders direct.
  test('I-01/I-02: pickup cash is routed through payment confirmation cycle, not direct status update', () => {
    const service = read('services/confirm-pickup-cash-payment.js');

    // Passe obligatoirement par le cycle complet
    expect(service).toContain('confirmPaymentCycle');

    // Jamais de mise à jour directe du statut commande
    expect(service).not.toMatch(/UPDATE\s+orders\s+SET\s+status/i);

    // La route pickup-secret monte bien ce service
    const route = read('routes/pickup-secret.js');
    expect(route).toContain('confirmPickupCashPayment');
    expect(route).toContain('confirm-pickup-cash-payment');
  });

  test('I-03/I-09: QR verify performs order transition, scan insert and parcel sync before commit', () => {
    // P5-L5 (2026-07) : la validation + transition + invalidation QR + scan +
    // parcelSync ont été extraites dans services/qr-collection-core.js,
    // partagé avec scan-operations.js (verifyQr). verify-qr-collection.js ne
    // fait plus que déléguer à ce noyau puis exécuter son propre COMMIT — le
    // test doit donc vérifier chaque moitié de l'invariant dans le bon fichier.
    const service = read('services/verify-qr-collection.js');
    const core = read('services/qr-collection-core.js');

    expect(core).toContain('transitionOrderStatus');
    expect(core).toContain("newStatus: 'collected'");
    expect(core).toContain('safeSyncScanToParcels');
    expect(core).toContain('Retrait client via QR Code');
    expect(service).toContain('resolveQrCollection');

    // Le noyau exécute transition puis scan+parcelSync avant de renvoyer ok:true
    const transitionIndex = core.indexOf('transitionOrderStatus({');
    const syncIndex = core.indexOf('safeSyncScanToParcels');
    const okTrueIndex = core.indexOf('return { ok: true');
    expect(transitionIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(-1);
    expect(okTrueIndex).toBeGreaterThan(-1);
    expect(transitionIndex).toBeLessThan(syncIndex);
    expect(syncIndex).toBeLessThan(okTrueIndex);

    // L'appelant ne COMMIT qu'après avoir attendu le résultat du noyau
    const resolveCallIndex = service.indexOf('await resolveQrCollection(');
    const commitIndex = service.indexOf("client.query('COMMIT')");
    expect(resolveCallIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(-1);
    expect(resolveCallIndex).toBeLessThan(commitIndex);
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

  // Approche intercepteur auth.js abandonnée (STATUS.md L626) — logique dans admin-order-refund.js
  // L'invariant reste : le remboursement passe par processRefund + transitionOrderStatus (action financière explicite).
  test('G4: cancellation refund uses explicit financial action before status transition', () => {
    const service = read('services/admin-order-refund.js');

    // Action financière explicite avant transition
    expect(service).toContain('processRefund');
    expect(service).toContain('transitionOrderStatus');

    // La transition passe bien par la machine de statut (pas de UPDATE direct)
    expect(service).not.toMatch(/UPDATE\s+orders\s+SET\s+status/i);

    // Ordre : processRefund avant transitionOrderStatus
    const refundIdx = service.indexOf('processRefund(');
    const transitionIdx = service.indexOf('transitionOrderStatus(');
    expect(refundIdx).toBeGreaterThan(-1);
    expect(transitionIdx).toBeGreaterThan(-1);
    expect(refundIdx).toBeLessThan(transitionIdx);

    // La route admin monte bien ce service
    const route = read('routes/admin/orders.js');
    expect(route).toContain('refundCancelledOrder');
    expect(route).toContain('admin-order-refund');
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

  // ── Keystone douane — Lot A (migration 091) ─────────────────────────────
  // Doctrine : DOUANE_DECLARATION_PIVOT.md
  // Spec     : docs/specs/SPEC_KEYSTONE_DOUANE.md

  test('I-DOUANE-1: tous les sites INSERT order_items gèlent la classification douanière', () => {
    const create   = read('routes/orders/create.js');
    const engine   = read('services/shared-cart-lifecycle.js'); // Lot C1 (2026-06-28) : INSERT order_items déplacé hors du barrel shared-cart-engine.js
    const adminSys = read('routes/admin/system.js');
    const clf      = read('services/customs-classification.js');

    expect(create).toContain('resolveFrozenClassification');
    expect(engine).toContain('resolveFrozenClassification');
    expect(adminSys).toContain('resolveFrozenClassification');

    for (const src of [create, engine, adminSys]) {
      expect(src).toContain('customs_category_key');
      expect(src).toContain('classification_defaulted');
      expect(src).toContain('sh_code');
      expect(src).toContain('douane_pct');
    }

    expect(clf).toContain('resolveFrozenClassification');
    expect(clf).toContain('module.exports');
  });

  test('I-DOUANE-6: customs-classification.js ne contient aucune logique d\'optimisation de droit', () => {
    const clf = read('services/customs-classification.js');

    expect(clf).toContain('resolveFrozenClassification');
    expect(clf).toContain('customs_categories');

    // Vérifie l'absence de logique algorithmique (patterns de code, pas mots dans commentaires)
    expect(clf).not.toMatch(/Math\.(min|max|floor|ceil|round)\s*\(/);
    expect(clf).not.toMatch(/\.reduce\s*\(/);
    expect(clf).not.toMatch(/\.sort\s*\(/);
    expect(clf).not.toMatch(/predict\s*\(/i);
    expect(clf).not.toMatch(/score\s*[=+*]/i);

    // Jamais bloquant : pas de throw
    const throwCount = (clf.match(/\bthrow\b/g) || []).length;
    expect(throwCount).toBe(0);
  });
});

} // end hasIntegrationEnv guard
