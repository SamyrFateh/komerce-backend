'use strict';

/**
 * tests/unit/client-tracking.test.js
 *
 * Tests du router routes/client-tracking.js
 *
 * Couverture (invariants critiques) :
 *   ✓ scope strict par user_id (req.user.id) — pas d'IDOR possible sur les commandes
 *   ✓ liste vide → message dédié, pas d'erreur, pas de requêtes supplémentaires (N+1 évité)
 *   ✓ pickupCode n'est JAMAIS exposé tant que la commande n'est pas available/collected
 *   ✓ pickupCode est exposé une fois la commande available
 *   ✓ items/parcels/invoices sont correctement groupés par commande (pas de cross-contamination)
 *   ✓ statusDetail/statusMessage dérivés à la volée depuis les colis (computeOrderStatusDetail)
 *   ✓ scan_events filtrés sur status='applied' uniquement
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'user-1', role: 'client' }; next(); },
}));

jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'user-1', role: 'client' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/client-tracking');
    app.use('/api/client/tracking', router);
  });
});

describe('client-tracking — GET / scoping & cas vide', () => {
  it('interroge les commandes filtrées sur req.user.id (jamais un id arbitraire)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/client/tracking');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE o\.user_id = \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('liste vide : message dédié sans requêtes additionnelles', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/client/tracking');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: [], message: 'Aucune commande trouvée.' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('client-tracking — GET / pickupCode (anti-fuite secret retrait)', () => {
  const baseOrder = {
    id: 'o1', reference: 'CMD-1', status: 'shipped', total_kmf: 10000,
    payment_mode: 'cash', payment_status: 'paid',
    pickup_secret_last4: 'S123', qr_token: 'qr-1',
    created_at: '2026-06-01', ordered_at: '2026-06-01',
    preparation_at: null, shipped_at: '2026-06-02', in_transit_at: null,
    available_at: null, collected_at: null,
    destination_island: 'grande_comore',
    relais_name: null, relais_address: null, relais_island: null,
  };

  it('ne révèle PAS pickup_code tant que la commande n\'est pas available/collected', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseOrder] })  // orders
      .mockResolvedValueOnce({ rows: [] })            // items
      .mockResolvedValueOnce({ rows: [] })            // parcels
      .mockResolvedValueOnce({ rows: [] });           // invoices (no parcels → no scan_events query)

    const res = await request(app).get('/api/client/tracking');

    expect(res.status).toBe(200);
    expect(res.body.orders[0].pickupCode).toBeNull();
  });

  it('révèle pickup_code une fois la commande available', async () => {
    const order = { ...baseOrder, status: 'available', available_at: '2026-06-05' };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/client/tracking');

    expect(res.body.orders[0].pickupCode).toBe('•••-•S1-23');
  });

  it('révèle pickup_code une fois la commande collected', async () => {
    const order = { ...baseOrder, status: 'collected', collected_at: '2026-06-06' };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/client/tracking');

    expect(res.body.orders[0].pickupCode).toBe('•••-•S1-23');
  });
});

describe('client-tracking — GET / regroupement par commande', () => {
  it('regroupe correctement items/parcels/invoices sans cross-contamination entre commandes', async () => {
    const orders = [
      { id: 'o1', reference: 'CMD-1', status: 'shipped', total_kmf: 1000, payment_mode: 'cash', payment_status: 'paid', pickup_code: null, qr_token: null, created_at: 'd', ordered_at: 'd', preparation_at: null, shipped_at: 'd', in_transit_at: null, available_at: null, collected_at: null, destination_island: 'a', relais_name: null, relais_address: null, relais_island: null },
      { id: 'o2', reference: 'CMD-2', status: 'collected', total_kmf: 2000, payment_mode: 'cash', payment_status: 'paid', pickup_code: 'PK2', qr_token: null, created_at: 'd', ordered_at: 'd', preparation_at: 'd', shipped_at: 'd', in_transit_at: 'd', available_at: 'd', collected_at: 'd', destination_island: 'a', relais_name: null, relais_address: null, relais_island: null },
    ];
    const items = [
      { order_id: 'o1', quantity: 1, price_kmf: 1000, product_name: 'A', emoji: '📦', image_url: null, sku: 'A1' },
      { order_id: 'o2', quantity: 2, price_kmf: 1000, product_name: 'B', emoji: '🎁', image_url: null, sku: 'B1' },
    ];
    const parcels = [
      { id: 'p1', order_id: 'o1', reference: 'PCL-1', status: 'shipped', weight_kg: 2, destination_island: 'a', destination_relais: null, shipped_at: 'd', available_at: null, collected_at: null, created_at: 'd' },
      { id: 'p2', order_id: 'o2', reference: 'PCL-2', status: 'collected', weight_kg: 1, destination_island: 'a', destination_relais: null, shipped_at: 'd', available_at: 'd', collected_at: 'd', created_at: 'd' },
    ];
    const scans = [
      { parcel_id: 'p1', event_type: 'shipped', location: 'hub', notes: null, created_at: 'd' },
      { parcel_id: 'p2', event_type: 'collected', location: 'relais', notes: null, created_at: 'd' },
    ];
    const invoices = [
      { order_id: 'o2', invoice_number: 'INV-2', total_kmf: 2000, payment_mode: 'cash', created_at: 'd' },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: orders })
      .mockResolvedValueOnce({ rows: items })
      .mockResolvedValueOnce({ rows: parcels })
      .mockResolvedValueOnce({ rows: scans })
      .mockResolvedValueOnce({ rows: invoices });

    const res = await request(app).get('/api/client/tracking');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const o1 = res.body.orders.find(o => o.reference === 'CMD-1');
    const o2 = res.body.orders.find(o => o.reference === 'CMD-2');

    expect(o1.items).toHaveLength(1);
    expect(o1.items[0].sku).toBe('A1');
    expect(o1.parcels).toHaveLength(1);
    expect(o1.parcels[0].events).toHaveLength(1);
    expect(o1.invoices).toHaveLength(0);

    expect(o2.items).toHaveLength(1);
    expect(o2.items[0].sku).toBe('B1');
    expect(o2.parcels[0].events[0].type).toBe('collected');
    expect(o2.invoices).toHaveLength(1);
    expect(o2.invoices[0].invoiceNumber).toBe('INV-2');

    // scan_events filtré sur status='applied'
    const scanEventsCall = mockQuery.mock.calls[3][0];
    expect(scanEventsCall).toMatch(/status = 'applied'/);
  });

  it('statusDetail dérivé des colis : full_available + message FR associé', async () => {
    const order = { id: 'o1', reference: 'CMD-1', status: 'available', total_kmf: 1000, payment_mode: 'cash', payment_status: 'paid', pickup_code: 'PK1', qr_token: null, created_at: 'd', ordered_at: 'd', preparation_at: 'd', shipped_at: 'd', in_transit_at: 'd', available_at: 'd', collected_at: null, destination_island: 'a', relais_name: null, relais_address: null, relais_island: null };
    const parcels = [
      { id: 'p1', order_id: 'o1', reference: 'PCL-1', status: 'available', weight_kg: 1, destination_island: 'a', destination_relais: null, shipped_at: 'd', available_at: 'd', collected_at: null, created_at: 'd' },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: parcels })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/client/tracking');

    expect(res.body.orders[0].statusDetail).toBe('full_available');
    expect(res.body.orders[0].statusMessage).toBe('Votre commande est disponible au relais.');
  });
});
