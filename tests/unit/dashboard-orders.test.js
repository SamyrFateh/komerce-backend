'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature dashboard
 * @brief « Commandes actives » = une seule définition (ACTIVE_ORDER_STATUSES, partagée avec le Pilotage),
 *        et le cycle de vie affiché suit la machine d'états (aucun statut inexistant comme `paid`).
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const { VALID_TRANSITIONS } = require('../../services/order-status-machine');
const { ACTIVE_ORDER_STATUSES, LATE_THRESHOLDS } = require('../../services/dashboard-metrics/_helpers');
const { LIFECYCLE, buildOrders } = require('../../services/dashboard-orders');

describe('dashboard-orders — vérité des statuts', () => {
  it('le cycle de vie n\'affiche que des statuts de la machine d\'états (jamais `paid`)', () => {
    LIFECYCLE.forEach(status => expect(Object.keys(VALID_TRANSITIONS)).toContain(status));
    expect(LIFECYCLE).not.toContain('paid');
  });

  it('les statuts actifs du Pilotage sont tous dans le cycle de vie (preparation et shipped inclus)', () => {
    ACTIVE_ORDER_STATUSES.forEach(status => expect(LIFECYCLE).toContain(status));
    expect(LIFECYCLE).toEqual(expect.arrayContaining(['preparation', 'shipped']));
  });

  it('active_orders = somme des seuls statuts actifs (ni pending ni collected)', async () => {
    const counts = { pending: 3, confirmed: 2, ordered: 1, preparation: 4, shipped: 5, in_transit: 6, available: 7, collected: 8, cancelled: 9 };
    db.query.mockImplementation(async sql => {
      if (/GROUP BY o\.status/.test(sql)) return { rows: Object.entries(counts).map(([status, n]) => ({ status, n })) };
      if (/GROUP BY o\.payment_mode/.test(sql)) return { rows: [] };
      if (/AS paiements_en_attente/.test(sql)) return { rows: [{}] };
      if (/AS creees/.test(sql)) return { rows: [{}] };
      return { rows: [{ n: 0 }], rowCount: 1 };
    });
    const result = await buildOrders({});
    const expected = ACTIVE_ORDER_STATUSES.reduce((sum, status) => sum + (counts[status] || 0), 0);
    expect(result.summary.active_orders).toBe(expected);
    expect(expected).toBe(2 + 1 + 4 + 5 + 6 + 7);
  });

  it('les seuils de retard sont nommés dans une source unique', () => {
    expect(LATE_THRESHOLDS).toEqual({ shipped_late_days: 14, pickup_late_hours: 72, payment_pending_hours: 72, stale_hours: 72 });
  });
});
