'use strict';

/**
 * tests/unit/a8-shadow-extract.test.js
 * A8 — extraction lecture seule shadow vs legacy.
 */

const { extract, parseArgs } = require('../../scripts/a8-shadow-extract');

const item = (id, completeness, shadow, legacy) => ({
  order_id: id, status_order: 'confirmed', completeness, shadow_pct: shadow, legacy_margin_real_pct: legacy,
  delta_pct_points: shadow != null && legacy != null ? Number((shadow - legacy).toFixed(2)) : null,
  basis: null, unknown_types: [],
});

const mkDb = (ro = 'on') => ({
  query: jest.fn(async (sql) => {
    if (/SHOW default_transaction_read_only/.test(sql)) return { rows: [{ default_transaction_read_only: ro }] };
    if (/FROM markets/.test(sql)) return { rows: [{ id: 'm1', code: 'KM' }] };
    throw new Error(`requête inattendue: ${sql}`);
  }),
});

describe('a8-shadow-extract', () => {
  it('parseArgs : défauts et surcharge', () => {
    expect(parseArgs([])).toEqual({ days: 365, maxOrders: 5000, out: null });
    expect(parseArgs(['--days=30', '--max-orders=10', '--out=x.json'])).toEqual({ days: 30, maxOrders: 10, out: 'x.json' });
  });

  it('refuse une session non lecture seule', async () => {
    await expect(extract({ db: mkDb('off'), listRealMarginShadow: jest.fn(), days: 1, maxOrders: 10 })).rejects.toThrow(/lecture seule/);
  });

  it('complétude, écarts et top 10 triés par |écart|', async () => {
    const items = [
      item('a', 'final', 30, 28),
      item('b', 'provisional', 10, 40),
      item('c', 'incomplete', null, 50),
      item('d', 'final', 20, null),
      item('e', 'final', 5, 6),
    ];
    const list = jest.fn().mockResolvedValue({ items });
    const out = await extract({ db: mkDb(), listRealMarginShadow: list, days: 365, maxOrders: 200 });
    expect(out.completeness.total).toEqual({ final: 3, provisional: 1, incomplete: 1 });
    expect(out.deltas).toMatchObject({
      orders_total: 5, orders_with_both: 3, legacy_only_shadow_unknown: 1, shadow_only_legacy_missing: 1,
      shadow_lower_than_legacy: 2, abs_gt_5_pts: 1,
    });
    expect(out.top10.map((t) => t.order_id)).toEqual(['b', 'a', 'e']);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('aucune requête autre que lecture (SHOW/SELECT markets)', async () => {
    const db = mkDb();
    await extract({ db, listRealMarginShadow: jest.fn().mockResolvedValue({ items: [] }), days: 1, maxOrders: 10 });
    for (const [sql] of db.query.mock.calls) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  });
});
