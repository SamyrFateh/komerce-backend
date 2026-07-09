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
    expect(params[1]).toBe('payment_cycle');   // entity_type (fallback = source normalisé, point 9)
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

// ── 6bis. pickEntity — fallback source normalisé (correction point 9) ─────
// Spec : si aucun ID métier n'est trouvé, entity_type doit être le `source`
// legacy normalisé, pas un générique 'system' — sauf si source est vide.

describe('pickEntity — fallback source normalisé', () => {
  it('payload vide + source fournie → entity_type = source normalisé', () => {
    const { entity_type, entity_id } = pickEntity('{}', 'parcel_sync');
    expect(entity_type).toBe('parcel_sync');
    expect(entity_id).toBeNull();
  });

  it('source avec espaces/majuscules/tirets → normalisée en snake_case minuscule', () => {
    const { entity_type } = pickEntity(null, 'Refund Manual-Cash');
    expect(entity_type).toBe('refund_manual_cash');
  });

  it('payload avec UUID invalide + source fournie → fallback sur source, pas system', () => {
    const { entity_type, entity_id } = pickEntity(JSON.stringify({ order_id: 'pas-un-uuid' }), 'purchasing');
    expect(entity_type).toBe('purchasing');
    expect(entity_id).toBeNull();
  });

  it('source vide/absente → fallback reste system (comportement historique)', () => {
    expect(pickEntity('{}', '').entity_type).toBe('system');
    expect(pickEntity('{}', null).entity_type).toBe('system');
    expect(pickEntity('{}', undefined).entity_type).toBe('system');
  });

  it('source non-alphanumérique uniquement → fallback system', () => {
    expect(pickEntity('{}', '!!!').entity_type).toBe('system');
  });

  it('ID métier trouvé dans le payload → source ignorée, priorité au payload', () => {
    const payload = JSON.stringify({ order_id: 'aabbccdd-0000-0000-0000-000000000009' });
    const { entity_type, entity_id } = pickEntity(payload, 'some_other_source');
    expect(entity_type).toBe('order');
    expect(entity_id).toBe('aabbccdd-0000-0000-0000-000000000009');
  });

  it('rewriteLegacyAlertInsert bout-en-bout : entity_type reflète le source, pas system', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ('elevated', 'parcel_sync', $1, $2)`;
    const { params } = rewrite(sql, ['sync failed', JSON.stringify({ step: 'scan' })]);
    // params = [source, entity_type, entity_id, severity, title, description]
    expect(params[1]).toBe('parcel_sync'); // entity_type
    expect(params[2]).toBeNull();          // entity_id
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

// ── 8bis. Non-régression audit PR563 (ordre colonnes / split naïf / RETURNING)

describe('rewrite — non-régression audit PR563', () => {
  it('réécrit correctement même avec les colonnes dans un ordre différent', () => {
    const sql = `INSERT INTO alerts (payload, message, source, level) VALUES ($1, $2, $3, $4)`;
    const { sql: newSql, params } = rewrite(sql, [
      JSON.stringify({ user_id: 'aabbccdd-0000-4000-8000-000000000009' }),
      'Message reordonne',
      'auth-service',
      'low',
    ]);
    expect(newSql).toMatch(/INSERT INTO alerts\s*\(type, entity_type, entity_id, severity, title, description\)/i);
    expect(params[0]).toBe('auth-service');  // type (source)
    expect(params[1]).toBe('user');          // entity_type déduit du payload
    expect(params[3]).toBe('low');           // severity
    expect(params[4]).toBe('Message reordonne'); // title
  });

  it('ne casse pas sur une valeur contenant des virgules (payload JSON avec plusieurs clés)', () => {
    // Le payload JSON contient des virgules internes : un split(',') naïf sur
    // la chaîne VALUES casserait le découpage des arguments positionnels.
    const payload = JSON.stringify({ order_id: 'aabbccdd-0000-4000-8000-000000000010', amount: 1200, note: 'a, b, c' });
    const { params } = rewrite(BASE_SQL, ['high', 'src', 'msg', payload]);
    expect(params[1]).toBe('order');
    expect(params[2]).toBe('aabbccdd-0000-4000-8000-000000000010');
    expect(JSON.parse(params[5]).note).toBe('a, b, c');
  });

  it('ne casse pas sur une valeur littérale SQL contenant une virgule entre quotes', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ('low', 'scan', 'Colis, retard, verifier', $1)`;
    const { params } = rewrite(sql, ['{}']);
    expect(params[4]).toBe('Colis, retard, verifier');
  });

  it('préserve un suffixe RETURNING id', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4) RETURNING id`;
    const { sql: newSql } = rewrite(sql, ['medium', 'src', 'msg', '{}']);
    expect(newSql).toMatch(/RETURNING id/i);
  });

  it('préserve RETURNING id, created_at (suffixe multi-colonnes)', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4) RETURNING id, created_at`;
    const { sql: newSql } = rewrite(sql, ['medium', 'src', 'msg', '{}']);
    expect(newSql).toMatch(/RETURNING id, created_at/i);
  });

  it('refuse de préserver un suffixe qui référence une colonne legacy (sécurité)', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4) RETURNING source`;
    const { rewritten } = rewrite(sql, ['medium', 'src', 'msg', '{}']);
    expect(rewritten).toBe(false);
  });

  it('LEGACY_ALERTS_RE (ordre exact) ne détecte pas les colonnes réordonnées, mais rewriteLegacyAlertInsert si', () => {
    const sql = `INSERT INTO alerts (payload, message, source, level) VALUES ($1, $2, $3, $4)`;
    expect(LEGACY_ALERTS_RE.test(sql)).toBe(false); // regex figée, comportement documenté
    const { rewritten } = rewrite(sql, ['{}', 'msg', 'src', 'low']);
    expect(rewritten).toBe(true); // mais la réécriture réelle fonctionne quand même
  });
});

// ── 8. Idempotence — nouveau schéma non touché ─────────────────────────────

describe('non-interférence avec le nouveau schéma', () => {
  it('ne touche pas un INSERT avec les nouvelles colonnes', () => {
    const sql = `INSERT INTO alerts (type, severity, title) VALUES ($1, $2, $3)`;
    expect(LEGACY_ALERTS_RE.test(sql)).toBe(false);
  });
});
