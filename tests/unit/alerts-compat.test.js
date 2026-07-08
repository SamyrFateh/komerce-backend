'use strict';

/**
 * tests/unit/alerts-compat.test.js
 *
 * Tests de la couche de compatibilité alerts (PR563).
 * Vérifie la réécriture INSERT INTO alerts legacy → schéma réel.
 */

const { rewriteLegacyAlertInsert, LEGACY_ALERTS_RE, pickEntity } = require('../../utils/alerts-compat');

// ── Helpers ────────────────────────────────────────────────────────────────

function rewrite(sql, params) {
  return rewriteLegacyAlertInsert(sql, params);
}

const BASE_SQL = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`;
const BASE_INLINE = `INSERT INTO alerts (level, source, message, payload) VALUES ('critical', 'stripe_webhook', $1, $2)`;

// ── 1. Détection regex ─────────────────────────────────────────────────────

describe('LEGACY_ALERTS_RE', () => {
  it('détecte INSERT legacy (level, source, message, payload)', () => {
    expect(LEGACY_ALERTS_RE.test(BASE_SQL)).toBe(true);
  });

  it('ne détecte pas un INSERT avec le nouveau schéma', () => {
    const newSql = `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description) VALUES ($1,$2,$3,$4,$5,$6)`;
    expect(LEGACY_ALERTS_RE.test(newSql)).toBe(false);
  });

  it('ne détecte pas un SELECT', () => {
    expect(LEGACY_ALERTS_RE.test('SELECT * FROM alerts')).toBe(false);
  });
});

// ── 2. Mapping severity (point 8) ──────────────────────────────────────────

describe('rewrite — severity mapping', () => {
  const cases = [
    ['critical', 'high'],
    ['elevated', 'high'],
    ['high',     'high'],
    ['error',    'high'],
    ['fatal',    'high'],
    ['medium',   'medium'],
    ['warning',  'medium'],
    ['warn',     'medium'],
    ['low',      'low'],
    ['info',     'low'],
    ['debug',    'low'],
    ['notice',   'low'],
  ];

  test.each(cases)('level="%s" → severity="%s"', (level, expected) => {
    const { params } = rewrite(BASE_SQL, [level, 'test_source', 'test message', JSON.stringify({})]);
    expect(params[3]).toBe(expected); // severity est params[3]
  });

  it('valeur inconnue → fallback medium', () => {
    const { params } = rewrite(BASE_SQL, ['unknown_level', 'src', 'msg', '{}']);
    expect(params[3]).toBe('medium');
  });
});

// ── 3. Colonnes résultat ───────────────────────────────────────────────────

describe('rewrite — colonnes de sortie', () => {
  it('produit les 6 colonnes du nouveau schéma dans le bon ordre', () => {
    const { sql, params } = rewrite(BASE_SQL, ['elevated', 'payment_cycle', 'Alerte test', '{}']);
    expect(sql).toMatch(/INSERT INTO alerts\s*\(type, entity_type, entity_id, severity, title, description\)/i);
    expect(params).toHaveLength(6);
    expect(params[0]).toBe('payment_cycle');   // type
    expect(params[1]).toBe('system');          // entity_type (fallback)
    expect(params[2]).toBeNull();              // entity_id (null)
    expect(params[3]).toBe('high');            // severity
    expect(params[4]).toBe('Alerte test');     // title
  });
});

// ── 4. Valeurs inline dans le SQL (point 5) ────────────────────────────────

describe('rewrite — valeurs inline (littéraux SQL)', () => {
  it('gère les valeurs littérales dans VALUES', () => {
    const { params } = rewrite(BASE_INLINE, [
      'paypal_amount_mismatch — KMC-123',
      JSON.stringify({ order_id: 'aaa', capture_id: 'bbb' }),
    ]);
    expect(params[0]).toBe('stripe_webhook');  // source inline
    expect(params[3]).toBe('high');            // critical → high
    expect(params[4]).toBe('paypal_amount_mismatch — KMC-123');
  });
});

// ── 5. ON CONFLICT DO NOTHING préservé (point 7) ─────────────────────────

describe('rewrite — ON CONFLICT DO NOTHING', () => {
  it('préserve ON CONFLICT DO NOTHING', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'scan', $2, $3) ON CONFLICT DO NOTHING`;
    const { sql: newSql } = rewrite(sql, ['low', 'msg', '{}']);
    expect(newSql).toMatch(/ON CONFLICT DO NOTHING/i);
  });
});

// ── 6. pickEntity — extraction entity_type/entity_id (point 9) ────────────

describe('pickEntity', () => {
  it('extrait order_id → entity_type=order', () => {
    const payload = JSON.stringify({ order_id: 'aabbccdd-0000-0000-0000-000000000001' });
    const { entity_type, entity_id } = pickEntity(payload);
    expect(entity_type).toBe('order');
    expect(entity_id).toBe('aabbccdd-0000-0000-0000-000000000001');
  });

  it('extrait parcel_id → entity_type=parcel', () => {
    const payload = { parcel_id: 'aabbccdd-0000-0000-0000-000000000002' };
    const { entity_type, entity_id } = pickEntity(payload);
    expect(entity_type).toBe('parcel');
    expect(entity_id).toBe('aabbccdd-0000-0000-0000-000000000002');
  });

  it('payload vide → fallback system + null', () => {
    const { entity_type, entity_id } = pickEntity('{}');
    expect(entity_type).toBe('system');
    expect(entity_id).toBeNull();
  });

  it('payload avec UUID invalide → fallback system', () => {
    const { entity_type, entity_id } = pickEntity(JSON.stringify({ order_id: 'pas-un-uuid' }));
    expect(entity_type).toBe('system');
    expect(entity_id).toBeNull();
  });

  it('payload null → fallback system', () => {
    const { entity_type, entity_id } = pickEntity(null);
    expect(entity_type).toBe('system');
    expect(entity_id).toBeNull();
  });

  it('payload non-JSON string → fallback system', () => {
    const { entity_type, entity_id } = pickEntity('pas du json');
    expect(entity_type).toBe('system');
    expect(entity_id).toBeNull();
  });
});

// ── 7. Cas réels des 16 fichiers (point 3) ────────────────────────────────

describe('rewrite — cas réels métier', () => {
  it('admin-order-refund manual_cash — payload avec order_id', () => {
    const payload = JSON.stringify({ order_id: 'aaaabbbb-0000-0000-0000-000000000001', amount_kmf: 5000 });
    const { params } = rewrite(BASE_SQL, ['elevated', 'refund_manual_cash', 'Remboursement cash — KMC-001', payload]);
    expect(params[0]).toBe('refund_manual_cash');
    expect(params[1]).toBe('order');
    expect(params[2]).toBe('aaaabbbb-0000-0000-0000-000000000001');
    expect(params[3]).toBe('high');
  });

  it('scan-operations — ON CONFLICT DO NOTHING + level paramètre', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, 'scan_collect', $2, $3) ON CONFLICT DO NOTHING`;
    const { sql: newSql, params } = rewrite(sql, ['low', 'pickup_code invalide', JSON.stringify({ user_id: 'u-001' })]);
    expect(newSql).toMatch(/ON CONFLICT DO NOTHING/i);
    expect(params[3]).toBe('low');
  });

  it('payment-paypal — level critical inline', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ('critical', 'paypal_capture', $1, $2)`;
    const { params } = rewrite(sql, ['paypal_amount_mismatch — KMC-002', JSON.stringify({ order_id: 'bbbbcccc-0000-0000-0000-000000000001' })]);
    expect(params[0]).toBe('paypal_capture');
    expect(params[3]).toBe('high');
    expect(params[1]).toBe('order'); // entity_type depuis order_id dans payload
  });

  it('payment-stripe — critical client.query inline', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload)\n           VALUES ('critical', 'stripe_webhook', $1, $2)`;
    const { params } = rewrite(sql, ['paid_but_stock_blocked — KMC-003', JSON.stringify({ order_id: 'ccccdddd-0000-0000-0000-000000000001' })]);
    expect(params[3]).toBe('high');
    expect(params[1]).toBe('order');
  });

  it('purchasing-trigger — VALUES avec 4 params positionnels', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated','purchasing',$1,$2)`;
    const { params } = rewrite(sql, ['Stock critique — produit XYZ', JSON.stringify({ product_id: 'ddddeeee-0000-0000-0000-000000000001' })]);
    expect(params[0]).toBe('purchasing');
    expect(params[3]).toBe('high');
    expect(params[1]).toBe('product');
  });
});

// ── 8. Idempotence — nouveau schéma non touché ─────────────────────────────

describe('non-interférence avec le nouveau schéma', () => {
  it('ne touche pas un INSERT avec les nouvelles colonnes', () => {
    const sql = `INSERT INTO alerts (type, severity, title) VALUES ($1, $2, $3)`;
    expect(LEGACY_ALERTS_RE.test(sql)).toBe(false);
  });
});
