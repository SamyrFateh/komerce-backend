/**
 * Vérification bout-en-bout de rewriteLegacyAlertInsert() sur les 16 sites
 * d'appel réels du monorepo qui écrivent encore l'ancien format
 * `INSERT INTO alerts (level, source, message, payload)`.
 *
 * Historique : ce fichier existait déjà comme script de debug
 * (console.log/process.exit, référence `.text` au lieu de `.sql` — une forme
 * de retour antérieure de rewriteLegacyAlertInsert) et était cassé/ignoré par
 * la suite. Converti ici en vrai test Jest avec assertions, sans perdre la
 * couverture des cas réels qu'il encodait.
 */

const { rewriteLegacyAlertInsert } = require('../../utils/alerts-compat');
const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function checkRewritten(text, params) {
  const r = rewriteLegacyAlertInsert(text, params);
  expect(r.rewritten).toBe(true);
  expect(typeof r.sql).toBe('string');
  expect(['low', 'medium', 'high']).toContain(r.params[3]); // severity
  expect(r.params[1]).toBeTruthy(); // entity_type
  expect(r.params[4]).toBeTruthy(); // title
  return r;
}

describe('rewriteLegacyAlertInsert — cas réels des 16 sites d\'appel legacy', () => {
  const oid = uuid();

  it('admin-order-refund', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'refund_manual_cash', $1, $2)`,
      [`Remboursement cash manuel requis — REF123`, JSON.stringify({ order_id: oid, reference: 'REF123', amount_kmf: 5000, reason: 'x' })]
    );
  });

  it('cancel-order-purchase-orders', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'order_cancel_purchasing', $1, $2)`,
      [`Commande annulée avec PO — REF1`, JSON.stringify({ order_id: oid, order_reference: 'REF1' })]
    );
  });

  it('cash-operations — entièrement paramétré (level/source inclus)', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
      ['elevated', 'cash_collect', 'msg', JSON.stringify({ order_id: oid })]
    );
  });

  it('catalog-approval', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('info', 'catalog_approval_reject', $1, $2)`,
      [`Produit p1 rejeté`, JSON.stringify({ product_id: uuid(), reason: 'x', actor: null })]
    );
  });

  it('confirm-pickup-cash-payment', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'pickup_cash_confirm', $1, $2)`,
      [`agent_relais sans relais_id`, JSON.stringify({ order_reference: 'R1', user_id: uuid() })]
    );
  });

  it('order-payment-confirmation', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'payment_cycle', $1, $2)`,
      [`confirmed→ordered rejeté`, JSON.stringify({ orderId: oid, error: 'x' })]
    );
  });

  it('payment-cash-confirm', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
      [`agent_relais sans relais_id`, JSON.stringify({ order_reference: 'R1', user_id: uuid() })]
    );
  });

  it('payment-paypal — source littéral avant les placeholders', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload) VALUES ('critical', 'paypal_capture', $1, $2)`,
      [`paypal_amount_mismatch`, JSON.stringify({ order_id: oid, expected_eur: 10, actual_eur: 9 })]
    );
  });

  it('payment-stripe', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('critical', 'stripe_webhook', $1, $2)`,
      [`paid_but_stock_blocked`, JSON.stringify({ order_id: oid })]
    );
  });

  it('product-publication-guard', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('info', 'product_stock_audit', $1, $2)`,
      [`Stock modifié`, JSON.stringify({ product_id: uuid(), old_stock: 1 })]
    );
  });

  it('purchasing-trigger-service', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated','purchasing',$1,$2)`,
      [`PO creation failed`, JSON.stringify({ order_id: oid, product_id: uuid() })]
    );
  });

  it('repair-collective-ready-to-capture', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'collective_repair_ready_to_capture', $1, $2)`,
      [`Repair failed`, JSON.stringify({ session_id: uuid(), workspace_id: uuid() })]
    );
  });

  it('repair-collective-stock-reservations', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'collective_stock_reservation_repair', $1, $2)`,
      [`Reservation repair failed`, JSON.stringify({ workspace_id: uuid(), order_id: oid })]
    );
  });

  it('repair-ordered-without-purchase-orders', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'purchasing_repair', $1, $2)`,
      [`Repair sourcing failed`, JSON.stringify({ order_id: oid, reference: 'REF' })]
    );
  });

  it('scan-operations — ON CONFLICT DO NOTHING, source littéral en position médiane', () => {
    const r = checkRewritten(
      `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'scan_collect', $2, $3) ON CONFLICT DO NOTHING`,
      ['elevated', 'scan msg', JSON.stringify({ parcel_id: uuid() })]
    );
    expect(r.sql).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  it('parcelSync — colonne supplémentaire created_at', () => {
    checkRewritten(
      `INSERT INTO alerts (level, source, message, payload, created_at)
       VALUES ('elevated', 'parcel_sync', $1, $2, NOW())`,
      [`safeSyncScanToParcels failed`, JSON.stringify({ order_id: oid, step: 's1', scan_id: uuid() })]
    );
  });

  it('déjà au nouveau schéma → pas de réécriture', () => {
    const r = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description) VALUES ($1,$2,$3,$4,$5,$6)`,
      ['x', 'order', oid, 'high', 't', 'd']
    );
    expect(r.rewritten).toBe(false);
  });

  it('requête sans rapport avec alerts → inchangée', () => {
    const r = rewriteLegacyAlertInsert(`SELECT * FROM orders WHERE id = $1`, [oid]);
    expect(r.rewritten).toBe(false);
  });
});
