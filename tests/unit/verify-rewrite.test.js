const { rewriteLegacyAlertInsert } = require('../../utils/alerts-compat');
const assert = require('assert');
const crypto = require('crypto');

function uuid() { return crypto.randomUUID(); }

let failures = 0;
function check(name, text, params, expectRewrite=true) {
  const r = rewriteLegacyAlertInsert(text, params);
  console.log('---', name, '---');
  console.log('rewritten:', r.rewritten);
  if (r.rewritten) {
    console.log('text:', r.text.replace(/\s+/g,' ').trim());
    console.log('params:', r.params);
    // sanity: severity must be one of low/medium/high
    if (!['low','medium','high'].includes(r.params[3])) {
      console.log('FAIL: bad severity', r.params[3]);
      failures++;
    }
    // title/entity_type must be non-null/non-empty
    if (!r.params[1]) { console.log('FAIL: entity_type falsy'); failures++; }
    if (!r.params[4]) { console.log('FAIL: title falsy'); failures++; }
  }
  if (r.rewritten !== expectRewrite) { console.log('FAIL: expected rewritten=', expectRewrite); failures++; }
  console.log();
}

const oid = uuid();

// admin-order-refund.js
check('admin-order-refund', 
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'refund_manual_cash', $1, $2)`,
  [`Remboursement cash manuel requis — REF123`, JSON.stringify({ order_id: oid, reference: 'REF123', amount_kmf: 5000, reason: 'x' })]
);

// cancel-order-purchase-orders.js
check('cancel-order-purchase-orders',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'order_cancel_purchasing', $1, $2)`,
  [`Commande annulée avec PO — REF1`, JSON.stringify({ order_id: oid, order_reference: 'REF1' })]
);

// cash-operations.js - fully parameterized including level/source
check('cash-operations',
  `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
  ['elevated', 'cash_collect', 'msg', JSON.stringify({ order_id: oid })]
);

// catalog-approval.js
check('catalog-approval',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('info', 'catalog_approval_reject', $1, $2)`,
  [`Produit p1 rejeté`, JSON.stringify({ product_id: uuid(), reason: 'x', actor: null })]
);

// confirm-pickup-cash-payment.js
check('confirm-pickup-cash-payment',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'pickup_cash_confirm', $1, $2)`,
  [`agent_relais sans relais_id`, JSON.stringify({ order_reference: 'R1', user_id: uuid() })]
);

// order-payment-confirmation.js
check('order-payment-confirmation',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'payment_cycle', $1, $2)`,
  [`confirmed→ordered rejeté`, JSON.stringify({ orderId: oid, error: 'x' })]
);

// payment-cash-confirm.js
check('payment-cash-confirm',
  `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'cash_confirm', $1, $2)`,
  [`agent_relais sans relais_id`, JSON.stringify({ order_reference: 'R1', user_id: uuid() })]
);

// payment-paypal.js - source is literal BEFORE placeholders (reordered case)
check('payment-paypal',
  `INSERT INTO alerts (level, source, message, payload) VALUES ('critical', 'paypal_capture', $1, $2)`,
  [`paypal_amount_mismatch`, JSON.stringify({ order_id: oid, expected_eur: 10, actual_eur: 9 })]
);

// payment-stripe.js
check('payment-stripe',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('critical', 'stripe_webhook', $1, $2)`,
  [`paid_but_stock_blocked`, JSON.stringify({ order_id: oid })]
);

// product-publication-guard.js
check('product-publication-guard',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('info', 'product_stock_audit', $1, $2)`,
  [`Stock modifié`, JSON.stringify({ product_id: uuid(), old_stock: 1 })]
);

// purchasing-trigger-service.js
check('purchasing-trigger-service',
  `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated','purchasing',$1,$2)`,
  [`PO creation failed`, JSON.stringify({ order_id: oid, product_id: uuid() })]
);

// repair-collective-ready-to-capture.js
check('repair-collective-ready-to-capture',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'collective_repair_ready_to_capture', $1, $2)`,
  [`Repair failed`, JSON.stringify({ session_id: uuid(), workspace_id: uuid() })]
);

// repair-collective-stock-reservations.js
check('repair-collective-stock-reservations',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'collective_stock_reservation_repair', $1, $2)`,
  [`Reservation repair failed`, JSON.stringify({ workspace_id: uuid(), order_id: oid })]
);

// repair-ordered-without-purchase-orders.js
check('repair-ordered-without-purchase-orders',
  `INSERT INTO alerts (level, source, message, payload)
   VALUES ('elevated', 'purchasing_repair', $1, $2)`,
  [`Repair sourcing failed`, JSON.stringify({ order_id: oid, reference: 'REF' })]
);

// scan-operations.js - ON CONFLICT DO NOTHING, source literal in middle position
check('scan-operations',
  `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'scan_collect', $2, $3) ON CONFLICT DO NOTHING`,
  ['elevated', 'scan msg', JSON.stringify({ parcel_id: uuid() })]
);

// parcelSync.js - extra created_at column
check('parcelSync',
  `INSERT INTO alerts (level, source, message, payload, created_at)
   VALUES ('elevated', 'parcel_sync', $1, $2, NOW())`,
  [`safeSyncScanToParcels failed`, JSON.stringify({ order_id: oid, step: 's1', scan_id: uuid() })]
);

// Non-legacy insert should NOT be rewritten (already new schema)
check('already-new-schema', 
  `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description) VALUES ($1,$2,$3,$4,$5,$6)`,
  ['x','order',oid,'high','t','d'], false);

// unrelated query untouched
check('unrelated-query',
  `SELECT * FROM orders WHERE id = $1`, [oid], false);

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
