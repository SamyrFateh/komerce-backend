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
  test('la classification reste une suspicion avec preuve et empreinte', () => {
    const x = scanSource('const x = { idempotencyKey: "r" + Date.now() };', 'services/test.js')[0];
    expect(x).toMatchObject({ status: 'SUSPICION_STATIQUE', category: 'FIN', priority: 'P1', file: 'services/test.js' });
    expect(x.fingerprint).toContain('LS-03');
  });
});
