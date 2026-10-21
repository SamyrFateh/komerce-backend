/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
const mockReceivable = jest.fn();
jest.mock('../../services/hub-receivable', () => ({ listReceivable: (...a) => mockReceivable(...a) }));

const { buildHubDubai, GAPS } = require('../../services/hub-dubai-projection');

const unitRows = [
  { market_code: 'CM', market_name: 'Cameroun', received_today: 2, controlled: 3, dispatched: 1, quarantined: 0 },
  { market_code: 'KM', market_name: 'Comores', received_today: 1, controlled: 0, dispatched: 4, quarantined: 1 },
];

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: unitRows });
  mockReceivable.mockReset().mockResolvedValue({ purchase_orders: [
    { purchase_order_id: 'po1', shape: 'grouped', po_status: 'ordered', supplier: { name: 'S1' }, supplier_order_ref: 'R1',
      lines: [{ expected_quantity: 10, received_quantity: 4, reception_state: 'PARTIAL' }] },
    { purchase_order_id: 'po2', shape: 'historical', po_status: 'ordered', supplier: { name: 'S2' }, supplier_order_ref: null,
      lines: [{ expected_quantity: 5, received_quantity: 0, reception_state: 'NOT_RECEIVED' }] },
  ] });
});

describe('hub-dubai-projection (lecture seule)', () => {
  test('hub global : réceptions, groupages (achats groupés) et unités agrégées par marché', async () => {
    const out = await buildHubDubai();
    expect(out.scope.mode).toBe('global');
    expect(out.receptions).toMatchObject({ available: true, expected_purchase_orders: 2, partial_purchase_orders: 1, grouped_purchase_orders: 1 });
    expect(out.units).toMatchObject({ received_today: 3, controlled: 3, dispatched: 5, quarantined: 1 });
    expect(out.units.by_market).toHaveLength(2);
    expect(mockQuery.mock.calls[0][1][0]).toBeNull();
  });

  test('périmètre marché : filtre serveur appliqué, réceptions déclarées non disponibles (jamais 0)', async () => {
    const out = await buildHubDubai({ authorizedMarkets: new Set(['m-1']) });
    expect(mockQuery.mock.calls[0][1][0]).toEqual(['m-1']);
    expect(out.receptions.available).toBe(false);
    expect(out.receptions.expected_purchase_orders).toBeUndefined();
    expect(mockReceivable).not.toHaveBeenCalled();
  });

  test('sources absentes documentées : expéditions prêtes et groupage transport', () => {
    expect(GAPS.map(g => g.key)).toEqual(['expeditions_ready', 'groupage_en_cours']);
  });
});
