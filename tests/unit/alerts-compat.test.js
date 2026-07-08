'use strict';

const { rewriteLegacyAlertInsert, severityFromLegacy } = require('../../utils/alerts-compat');

const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('alerts-compat', () => {
  it('mappe les anciens niveaux vers le CHECK severity réel', () => {
    expect(severityFromLegacy('critical')).toBe('high');
    expect(severityFromLegacy('elevated')).toBe('high');
    expect(severityFromLegacy('warning')).toBe('medium');
    expect(severityFromLegacy('info')).toBe('low');
    expect(severityFromLegacy('unknown')).toBe('medium');
  });

  it('réécrit un INSERT legacy simple vers le schéma réel alerts', () => {
    const out = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('elevated', 'cash_collect', $1, $2)`,
      [
        'Cross-relais refusé',
        JSON.stringify({ order_id: ORDER_ID, user_id: USER_ID }),
      ]
    );

    expect(out.rewritten).toBe(true);
    expect(out.text).toContain('INSERT INTO alerts (type, entity_type, entity_id, severity, title, description, created_at)');
    expect(out.text).not.toContain('level');
    expect(out.text).not.toContain('source');
    expect(out.params).toEqual(expect.arrayContaining([
      'cash_collect',
      'order',
      ORDER_ID,
      'high',
      'Cross-relais refusé',
    ]));
  });

  it('gère les paramètres réordonnés et les littéraux SQL', () => {
    const out = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ($1, 'paypal_webhook', $2, $3)`,
      [
        'warning',
        'paypal_capture_denied',
        JSON.stringify({ event_id: 'evt_1' }),
      ]
    );

    expect(out.rewritten).toBe(true);
    expect(out.params[0]).toBe('paypal_webhook');
    expect(out.params[3]).toBe('medium');
    expect(out.params[4]).toBe('paypal_capture_denied');
  });

  it('ignore une colonne legacy created_at en trop et pose created_at via NOW()', () => {
    const out = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (level, source, message, payload, created_at)
       VALUES ('elevated', 'parcel_sync', $1, $2, NOW())`,
      [
        'safeSyncScanToParcels failed',
        JSON.stringify({ order_id: ORDER_ID }),
      ]
    );

    expect(out.rewritten).toBe(true);
    expect(out.text).toContain('created_at');
    expect(out.text).toContain('NOW()');
    expect(out.params[1]).toBe('order');
    expect(out.params[2]).toBe(ORDER_ID);
  });

  it('préserve un suffixe RETURNING sûr', () => {
    const out = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('critical', 'catalog_approval_reject', $1, $2)
       RETURNING id`,
      [
        'catalog reject',
        JSON.stringify({ product_id: ORDER_ID }),
      ]
    );

    expect(out.rewritten).toBe(true);
    expect(out.text).toContain('RETURNING id');
    expect(out.params[1]).toBe('product');
  });

  it('préserve un suffixe ON CONFLICT DO NOTHING sûr', () => {
    const out = rewriteLegacyAlertInsert(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        'critical',
        'scan_operations',
        'scan anomaly',
        JSON.stringify({ order_id: ORDER_ID }),
      ]
    );

    expect(out.rewritten).toBe(true);
    expect(out.text).toContain('ON CONFLICT DO NOTHING');
  });

  it('ne modifie pas les requêtes non legacy', () => {
    const sql = 'SELECT * FROM alerts WHERE type = $1';
    const params = ['cash_collect'];
    const out = rewriteLegacyAlertInsert(sql, params);

    expect(out).toEqual({ text: sql, params, rewritten: false });
  });

  it('refuse de préserver un suffixe qui référence les anciennes colonnes', () => {
    const sql = `INSERT INTO alerts (level, source, message, payload)
                 VALUES ('critical', 'x', $1, $2)
                 RETURNING source`;
    const params = ['bad suffix', '{}'];
    const out = rewriteLegacyAlertInsert(sql, params);

    expect(out).toEqual({ text: sql, params, rewritten: false });
  });
});
