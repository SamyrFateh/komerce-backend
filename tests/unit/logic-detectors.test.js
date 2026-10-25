'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { scanSource } = require('../../scripts/lib/logic-detectors');

describe('audit:logic — detecteurs statiques, jamais des bugs confirmes', () => {
  test('LS-02 detecte PSP avant COMMIT et pas apres COMMIT', () => {
    const risk = "await client.query('BEGIN');\nawait stripe.refunds.create({});";
    expect(scanSource(risk, 'services/refund-service.js').some(f => f.rule === 'LS-02')).toBe(true);
    const safe = "await client.query('BEGIN');\nawait client.query('COMMIT');\nawait stripe.refunds.create({});";
    expect(scanSource(safe, 'services/refund-service.js').some(f => f.rule === 'LS-02')).toBe(false);
  });
  test('LS-03 detecte une cle d idempotence temporelle', () => {
    const result = scanSource('const x = { idempotencyKey: "refund_" + Date.now() };', 'services/paypal-client.js');
    expect(result.map(x => x.rule)).toContain('LS-03');
    expect(scanSource('const x = { idempotencyKey: refundId };', 'services/paypal-client.js')).toEqual([]);
  });
  test('LS-04 detecte les chemins paralleles de mutation des colis', () => {
    expect(scanSource("await db.query('INSERT INTO parcel_items (id) VALUES ($1)')", 'routes/parcels.js').map(x => x.rule)).toContain('LS-04');
    expect(scanSource("await db.query('DELETE FROM parcel_items WHERE id=$1')", 'services/parcel-item-mutation-service.js').map(x => x.rule)).not.toContain('LS-04');
  });
  test('LS-05 detecte un conflit SQL silencieux sur les colis', () => {
    const sql = "INSERT INTO parcel_items (parcel_id, order_item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING";
    expect(scanSource(sql, 'services/parcel-item-mutation-service.js').map(x => x.rule)).toContain('LS-05');
  });

  test('LS-01 : repère la transition directe sans confondre une machine de statut', () => {
    const sql = "await db.query('UPDATE orders SET status = $2 WHERE id=$1')";
    expect(scanSource(sql, 'routes/orders/status.js').map(x => x.rule)).toContain('LS-01');
    expect(scanSource(sql, 'services/order-status-machine.js').map(x => x.rule)).not.toContain('LS-01');
  });

  test('LS-06 : tout remboursement externe demande une intention et une preuve de réconciliation', () => {
    const f = scanSource("await paypal.refundCapture(capture, options);", 'services/payment-paypal.js');
    expect(f).toEqual(expect.arrayContaining([expect.objectContaining({
      rule: 'LS-06', status: 'SUSPICION_STATIQUE', propagation: 'NON_ETABLIE',
    })]));
  });

  test('LS-03 : détecte les clés PayPal et Stripe construites à Date.now sur plusieurs lignes', () => {
    const paypal = "headers: { 'PayPal-Request-Id': \`refund-\${captureId}-\${Date.now()}\` }";
    const stripe = "idempotencyKey:\\n  'refund_' + Date.now()";
    expect(scanSource(paypal, 'services/paypal-client.js').map(x => x.rule)).toContain('LS-03');
    expect(scanSource(stripe, 'services/refund-service.js').map(x => x.rule)).toContain('LS-03');
  });

  test('la classification reste une suspicion avec preuve et empreinte', () => {
    const x = scanSource('const x = { idempotencyKey: "r" + Date.now() };', 'services/test.js')[0];
    expect(x).toMatchObject({ status: 'SUSPICION_STATIQUE', category: 'FIN', priority: 'P1', file: 'services/test.js' });
    expect(x.fingerprint).toContain('LS-03');
  });
});
