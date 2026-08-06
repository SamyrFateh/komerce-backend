'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-guards.test.js
 * Tests unitaires des validations pures (sans DB) du lot R4.
 */

// parcel-guards → parcel-service → utils/parcels → utils/rules → db (chain)
jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const {
  validateParcelCreate,
  validateSplitItems,
  checkParcelCancellable,
  validateParcelTransition,
} = require('../../services/parcel-guards');

// ─── validateParcelCreate ─────────────────────────────────────────────────────

describe('validateParcelCreate', () => {
  const order = { id: 'o1', status: 'ordered', ordered_at: new Date().toISOString() };

  test('OK — commande en statut ordered, délai suffisant', () => {
    const result = validateParcelCreate(order, 10, 7);
    expect(result.ok).toBe(true);
  });

  test('404 — commande null', () => {
    const result = validateParcelCreate(null, 10, 7);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test('422 — statut shipped (non autorisé pour partial-ship)', () => {
    const result = validateParcelCreate({ ...order, status: 'shipped' }, 10, 7);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.current_status).toBe('shipped');
  });

  test('422 — délai insuffisant (3 jours < seuil 7)', () => {
    const result = validateParcelCreate(order, 3, 7);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.days_since_ordered).toBe(3);
    expect(result.body.threshold_days).toBe(7);
  });

  test('OK — commande en statut preparation', () => {
    const result = validateParcelCreate({ ...order, status: 'preparation' }, 8, 7);
    expect(result.ok).toBe(true);
  });
});

// ─── validateSplitItems ───────────────────────────────────────────────────────

describe('validateSplitItems', () => {
  const allItems = [
    { id: 'oi1', quantity: 3, product_name: 'Robe A', price_kmf: 5000 },
    { id: 'oi2', quantity: 2, product_name: 'Sac B',  price_kmf: 3000 },
  ];

  test('OK — 3/5 articles disponibles (60% > seuil 30%)', () => {
    const available = [{ order_item_id: 'oi1', quantity: 3 }];
    const result = validateSplitItems(available, allItems, 30);
    expect(result.ok).toBe(true);
    expect(result.availableQty).toBe(3);
    expect(result.availPct).toBeCloseTo(60, 1);
  });

  test('400 — article inexistant dans la commande', () => {
    const available = [{ order_item_id: 'oi-inexistant', quantity: 1 }];
    const result = validateSplitItems(available, allItems, 30);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  test('400 — quantité demandée > quantité commandée', () => {
    const available = [{ order_item_id: 'oi1', quantity: 10 }]; // 10 > 3
    const result = validateSplitItems(available, allItems, 30);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Robe A/);
  });

  test('422 — % disponible insuffisant (1/5 = 20% < seuil 30%)', () => {
    const available = [{ order_item_id: 'oi1', quantity: 1 }];
    const result = validateSplitItems(available, allItems, 30);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.available_pct).toBeCloseTo(20, 1);
  });
});

// ─── checkParcelCancellable ───────────────────────────────────────────────────

describe('checkParcelCancellable', () => {
  test('OK — colis draft annulable', () => {
    const result = checkParcelCancellable({ id: 'p1', status: 'draft', type: 'backorder' });
    expect(result.ok).toBe(true);
  });

  test('OK — colis preparation annulable', () => {
    const result = checkParcelCancellable({ id: 'p1', status: 'preparation', type: 'backorder' });
    expect(result.ok).toBe(true);
  });

  test('404 — colis null', () => {
    const result = checkParcelCancellable(null);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test('422 — colis déjà annulé', () => {
    const result = checkParcelCancellable({ id: 'p1', status: 'cancelled' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/déjà annulé/);
  });

  test.each(['shipped', 'in_transit', 'arrived', 'available', 'collected'])(
    '422 — colis en statut %s (non annulable)',
    (blockedStatus) => {
      const result = checkParcelCancellable({ id: 'p1', status: blockedStatus });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(422);
      expect(result.body.current_status).toBe(blockedStatus);
    }
  );
});

// ─── validateParcelTransition ─────────────────────────────────────────────────

describe('validateParcelTransition', () => {
  test('OK — draft → preparation', () => {
    const result = validateParcelTransition('draft', 'preparation');
    expect(result.ok).toBe(true);
  });

  test('OK — preparation → shipped', () => {
    const result = validateParcelTransition('preparation', 'shipped');
    expect(result.ok).toBe(true);
  });

  test('400 — statut cible invalide', () => {
    const result = validateParcelTransition('draft', 'teleporte');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  test('422 — transition illégale collected → draft', () => {
    const result = validateParcelTransition('collected', 'draft');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.current_status).toBe('collected');
  });

  test('422 — transition illégale shipped → collected (skip)', () => {
    const result = validateParcelTransition('shipped', 'collected');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  test('422 — état terminal collected : aucune transition', () => {
    const result = validateParcelTransition('collected', 'cancelled');
    expect(result.ok).toBe(false);
    expect(result.body.error).toMatch(/terminal/);
  });
});
