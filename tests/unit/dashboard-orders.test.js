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
const { LIFECYCLE, buildOrders, getWorkQueues } = require('../../services/dashboard-orders');

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

describe('dashboard-orders — files de travail partagées avec Opérations', () => {
  it('getWorkQueues borne les deux files au marché et garde le vrai total (pas la troncature)', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (/BOOL_AND/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\)::int AS value/.test(sql)) return { rows: [{ value: 40 }] };
      return { rows: [{ id: 'o1', reference: 'CMD-1', status: 'confirmed', total_kmf: 1000, payment_mode: 'cash' }] };
    });
    const queues = await getWorkQueues({ id: '11111111-1111-1111-1111-111111111111', code: 'KM' });
    expect(queues.pending_cash_total).toBe(40);
    expect(queues.pending_cash_shown).toBe(1);
    expect(queues.to_order_total).toBe(1);
    expect(queues.to_order[0].reference).toBe('CMD-1');
    expect(queues.ready_for_parcel_total).toBe(0);
    expect(db.query.mock.calls.every(([, params]) => params[0] === '11111111-1111-1111-1111-111111111111')).toBe(true);
  });

  it('getWorkQueues sans marché lit la vue globale', async () => {
    db.query.mockResolvedValue({ rows: [{ value: 0 }] });
    const queues = await getWorkQueues();
    expect(queues.pending_cash_total).toBe(0);
    expect(db.query.mock.calls.every(([, params]) => params[0] === null)).toBe(true);
  });
  it('les files portent marché, produits et colis depuis les relations existantes (null si lien absent)', async () => {
    db.query.mockImplementation(async sql => {
      if (/GROUP BY o\.status/.test(sql)) return { rows: [] };
      if (/GROUP BY o\.payment_mode/.test(sql)) return { rows: [] };
      if (/AS paiements_en_attente/.test(sql)) return { rows: [{}] };
      if (/AS creees/.test(sql)) return { rows: [{}] };
      if (/AS market_code/.test(sql)) return { rows: [{ id: 'o1', market_code: 'KM', product_lines: 3, first_product_name: 'Coque', parcel_count: 0 }] };
      if (/BOOL_AND/.test(sql)) return { rows: [] };
      if (/FROM orders o\s+WHERE[\s\S]*payment_status = 'paid'/.test(sql)) {
        return { rows: [{ id: 'o1', reference: 'KMC-1', status: 'ordered' }, { id: 'o2', reference: 'KMC-2', status: 'ordered' }] };
      }
      return { rows: [{ n: 0, value: 2 }], rowCount: 1 };
    });
    const { work_queues: q } = await buildOrders({});
    const [a, b] = q.ready_for_parcel;
    expect(a).toMatchObject({ market_code: 'KM', product_lines: 3, first_product_name: 'Coque', parcel_count: 0 });
    expect(b).toMatchObject({ market_code: null, product_lines: null, parcel_count: null });
  });
});


describe('dashboard-orders — L8 prochaine action réelle', () => {
  const paid = [
    { id: 'c1', reference: 'CMD-C', status: 'confirmed', total_kmf: 1, payment_mode: 'card' },
    { id: 'p1', reference: 'CMD-PARTIEL', status: 'ordered', total_kmf: 1, payment_mode: 'card' },
    { id: 'n1', reference: 'CMD-RIEN', status: 'ordered', total_kmf: 1, payment_mode: 'card' },
    { id: 'f1', reference: 'CMD-COUVERT', status: 'ordered', total_kmf: 1, payment_mode: 'card' },
  ];
  function mockPipeline() {
    let coverageIds = null;
    db.query.mockImplementation(async (sql, params) => {
      if (/BOOL_AND/.test(sql)) {
        coverageIds = params[0];
        return { rows: [
          { order_id: 'p1', lines: 2, needed: 5, usable: 2, covered: false },
          { order_id: 'n1', lines: 1, needed: 4, usable: 0, covered: false },
          { order_id: 'f1', lines: 1, needed: 3, usable: 3, covered: true },
        ] };
      }
      if (/payment_status = 'paid'/.test(sql)) return { rows: paid };
      return { rows: [{ value: 0 }] };
    });
    return () => coverageIds;
  }

  it('trie les commandes payées en trois files selon l’état physique, avec n/N sans action pour l’attente', async () => {
    const ids = mockPipeline();
    const q = await getWorkQueues({ id: '11111111-1111-1111-1111-111111111111', code: 'KM' });
    expect(q.to_order.map(o => o.reference)).toEqual(['CMD-C']);
    expect(q.to_order[0].next_action).toMatchObject({ key: 'order', label: 'À commander', actionable: true });
    expect(q.awaiting_hub_reception.map(o => o.reference)).toEqual(['CMD-PARTIEL', 'CMD-RIEN']);
    expect(q.awaiting_hub_reception[0].next_action).toMatchObject({ label: 'En attente de réception Hub (2/5)', actionable: false, received_units: 2, needed_units: 5 });
    expect(q.awaiting_hub_reception[1].next_action).toMatchObject({ label: expect.stringContaining('(0/'), actionable: false });
    expect(q.ready_for_parcel.map(o => o.reference)).toEqual(['CMD-COUVERT']);
    expect(q.ready_for_parcel[0].next_action).toMatchObject({ key: 'prepare_parcel', label: 'Préparer le colis' });
    expect([q.to_order_total, q.awaiting_hub_reception_total, q.ready_for_parcel_total]).toEqual([1, 2, 1]);
    // couverture lue par lot, en une requête, pour les seules commandes « ordered »
    expect(ids()).toEqual(['p1', 'n1', 'f1']);
    expect(db.query.mock.calls.filter(([sql]) => /BOOL_AND/.test(sql))).toHaveLength(1);
  });

  it('les KPI reprennent les mêmes définitions que les files', async () => {
    mockPipeline();
    const result = await buildOrders({});
    expect(result.summary).toMatchObject({ orders_to_order: 1, awaiting_hub_reception: 2, parcels_to_create: 1 });
    const kpis = Object.fromEntries(result.kpis.map(k => [k.key, k.value]));
    expect(kpis).toMatchObject({ orders_to_order: 1, awaiting_hub_reception: 2, parcels_to_create: 1 });
  });

  it('aucune écriture : le service n’émet que des SELECT', async () => {
    mockPipeline();
    await getWorkQueues();
    db.query.mock.calls.forEach(([sql]) => expect(String(sql).trim()).toMatch(/^(SELECT|WITH)/i));
  });
});
