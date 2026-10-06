'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const path = require('node:path');
const reconciliation = require('../../scripts/provider-certification-reconciliation');

const ROOT = path.resolve(__dirname, '../..');

test('R1 — le ledger capability-level réel est cohérent et ne sur-certifie pas une capability CLOSED', () => {
  const report = reconciliation.run({ root: ROOT });
  expect(report.summary.total_capabilities).toBeGreaterThanOrEqual(8);
  expect(report.summary.p4).toBeGreaterThanOrEqual(3);
  expect(report.summary.closed).toBeGreaterThanOrEqual(1);

  const allegroReadiness = report.rows.find(
    row => row.provider === 'allegro' && row.capability === 'purchasing.readiness'
  );
  expect(allegroReadiness).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });


  const allegroOrderReconcile = report.rows.find(
    row => row.provider === 'allegro' && row.capability === 'purchasing.reconcile_order'
  );
  expect(allegroOrderReconcile).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  const aliOrderReconcile = report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'purchasing.reconcile_order'
  );
  expect(aliOrderReconcile).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  const cjSandboxPayment = report.rows.find(
    row => row.provider === 'cj' && row.capability === 'purchasing.payment_sandbox'
  );
  expect(cjSandboxPayment).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P2',
  });

  const cjPaymentReconcile = report.rows.find(
    row => row.provider === 'cj' && row.capability === 'purchasing.reconcile_payment'
  );
  expect(cjPaymentReconcile).toMatchObject({
    classification: 'GAP',
    availability: 'IMPLEMENTED_NOT_LIVE_PROVEN',
    highest_proof: 'P2',
  });

  const allegroAuto = report.rows.find(
    row => row.provider === 'allegro' && row.capability === 'purchasing.auto_order'
  );
  expect(allegroAuto).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'CLOSED',
    highest_proof: 'UNQUALIFIED',
  });

  const aliAuto = report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'purchasing.auto_order'
  );
  expect(aliAuto).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  const aliReadiness = report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'purchasing.readiness'
  );
  expect(aliReadiness).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });
});

test('refuse provider inconnu, doublon de capability, evidence absente et CLOSED sur-certifié', () => {
  const registry = { providers: [{ id: 'allegro' }] };
  const base = {
    schema_version: 1,
    providers: {
      allegro: [{
        capability: 'purchasing.auto_order',
        classification: 'CONFIRMED',
        availability: 'CLOSED',
        highest_proof: 'UNQUALIFIED',
        environment: 'SANDBOX',
        evidence: ['docs/external-providers/suppliers/ALLEGRO_SANDBOX.md'],
      }],
    },
  };

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { ghost: base.providers.allegro } },
    ROOT
  )).toThrow('RECONCILIATION_UNKNOWN_PROVIDER:ghost');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [base.providers.allegro[0], base.providers.allegro[0]] } },
    ROOT
  )).toThrow('RECONCILIATION_CAPABILITY_DUPLICATE');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [{ ...base.providers.allegro[0], evidence: ['docs/nope.md'] }] } },
    ROOT
  )).toThrow('RECONCILIATION_EVIDENCE_NOT_FOUND');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [{ ...base.providers.allegro[0], highest_proof: 'P4' }] } },
    ROOT
  )).toThrow('RECONCILIATION_CLOSED_PROOF_OVERCLAIM');
});

test('résumé distingue CONFIRMED / RECLASSIFIED / GAP sans confondre highest proof et disponibilité', () => {
  const out = reconciliation.summarize([
    { classification: 'CONFIRMED', highest_proof: 'P4', availability: 'PROVEN' },
    { classification: 'RECLASSIFIED', highest_proof: 'P3', availability: 'PROVEN' },
    { classification: 'GAP', highest_proof: 'UNQUALIFIED', availability: 'CLOSED' },
  ]);
  expect(out).toEqual({
    total_capabilities: 3,
    confirmed: 1,
    reclassified: 1,
    gap: 1,
    p4: 1,
    closed: 1,
  });
});


test('cross-domain capability ledger preserves proved eBay, Stripe and PayPal scopes', () => {
  const report = reconciliation.run({ root: ROOT });

  const ebay = report.rows.find(
    row => row.provider === 'ebay' && row.capability === 'sourcing.catalog_pipeline'
  );
  expect(ebay).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P3',
  });

  const stripe = report.rows.find(
    row => row.provider === 'stripe' && row.capability === 'payments.intent_webhook_confirmation'
  );
  expect(stripe).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  const paypal = report.rows.find(
    row => row.provider === 'paypal' && row.capability === 'payments.order_create_readback'
  );
  expect(paypal).toMatchObject({
    classification: 'RECLASSIFIED',
    availability: 'REPORTED_PROOF_NOT_INDEPENDENTLY_RECHECKED',
    highest_proof: 'P1',
  });
});


test('catalog and ops provider capabilities remain scoped to preserved evidence', () => {
  const report = reconciliation.run({ root: ROOT });

  expect(report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'sourcing.exact_unit'
  )).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  expect(report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'sourcing.live_stock_price'
  )).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'PROVEN',
    highest_proof: 'P4',
  });

  expect(report.rows.find(
    row => row.provider === 'noon' && row.capability === 'sourcing.catalog_pipeline'
  )).toMatchObject({
    classification: 'GAP',
    highest_proof: 'UNQUALIFIED',
  });

  expect(report.rows.find(
    row => row.provider === 'cloudinary' && row.capability === 'media.upload'
  )).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'CLOSED_LEGACY_OR_CONFIG_ONLY',
    highest_proof: 'UNQUALIFIED',
  });
});


test('messaging capability ledger does not confuse implementation with provider proof', () => {
  const report = reconciliation.run({ root: ROOT });

  expect(report.rows.find(
    row => row.provider === 'meta-whatsapp' && row.capability === 'messaging.outbound_template_send'
  )).toMatchObject({
    classification: 'GAP',
    availability: 'IMPLEMENTED_NOT_PROVIDER_PROVEN',
    highest_proof: 'UNQUALIFIED',
  });

  expect(report.rows.find(
    row => row.provider === 'authkey' && row.capability === 'auth.otp_delivery'
  )).toMatchObject({
    classification: 'GAP',
    availability: 'IMPLEMENTED_NOT_PROVIDER_PROVEN',
    highest_proof: 'UNQUALIFIED',
  });

  expect(report.rows.find(
    row => row.provider === 'brevo' && row.capability === 'messaging.transactional_email_send'
  )).toMatchObject({
    classification: 'GAP',
    availability: 'CLIENT_IMPLEMENTED_RUNTIME_USE_UNPROVEN',
    highest_proof: 'UNQUALIFIED',
  });

  expect(report.rows.find(
    row => row.provider === 'twilio' && row.capability === 'messaging.runtime'
  )).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'CLOSED_CONFIG_ONLY',
    highest_proof: 'UNQUALIFIED',
  });
});
