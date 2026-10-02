'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ withTransaction: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
const mockTransition = jest.fn();
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: (...a) => mockTransition(...a) }));
const mockScan3 = jest.fn();
jest.mock('../../services/scan-operations', () => ({ triggerScan3: (...a) => mockScan3(...a) }));
const mockAlert = jest.fn();
jest.mock('../../utils/alerts', () => ({ createAlert: (...a) => mockAlert(...a) }));

const db = require('../../db');
const svc = require('../../services/purchasing-completion-service');

const ORDER = '00000000-0000-4000-8000-0000000000a1';
const PO = '00000000-0000-4000-8000-0000000000b1';

/** Client simulé : réponses par motif SQL. */
function makeClient({ order = { id: ORDER, status: 'ordered' }, items = [], lines = [], pos = {}, poProgress = {} } = {}) {
  const updates = [];
  const query = jest.fn(async (sql, params) => {
    if (/FROM orders WHERE id/.test(sql)) return { rows: order ? [order] : [] };
    if (/FROM order_items/.test(sql)) return { rows: items };
    if (/WHERE order_id = \$1 AND NOT cancelled/.test(sql)) return { rows: lines };
    if (/FROM purchase_orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: pos[params[0]] ? [pos[params[0]]] : [] };
    if (/WHERE purchase_order_id = \$1 AND NOT cancelled/.test(sql)) return { rows: poProgress[params[0]] || [] };
    if (/UPDATE purchase_orders/.test(sql)) { updates.push(params[0]); return { rows: [] }; }
    throw new Error(`SQL inattendu : ${sql}`);
  });
  return { client: { query }, updates };
}

function useClient(world) {
  const built = makeClient(world);
  db.withTransaction.mockImplementation(async (work) => work(built.client));
  return built;
}

const line = (id, item, po, effective, received) => ({ line_id: id, order_item_id: item, purchase_order_id: po, effective_quantity: effective, received_quantity: received });

beforeEach(() => {
  jest.clearAllMocks();
  mockTransition.mockResolvedValue({ success: true, noop: false });
  mockScan3.mockResolvedValue(undefined);
  mockAlert.mockResolvedValue({});
});

describe('computeCompletion', () => {
  test('un item est complet si couvert (Σ effectif ≥ quantité) ET entièrement reçu', () => {
    const items = [{ id: 'i1', quantity: 5 }, { id: 'i2', quantity: 2 }];
    expect(svc.computeCompletion(items, [line('l1', 'i1', PO, 5, 5), line('l2', 'i2', PO, 2, 2)])).toEqual({ items_total: 2, items_complete: 2, complete: true });
  });

  test('fail-closed : ligne soldée sans reliquat (Σ effectif < quantité) laisse l\'item incomplet', () => {
    const result = svc.computeCompletion([{ id: 'i1', quantity: 10 }], [line('l1', 'i1', PO, 6, 6)]);
    expect(result).toEqual({ items_total: 1, items_complete: 0, complete: false });
  });

  test('un reliquat ouvert non reçu bloque l\'item ; une somme sur plusieurs lignes est acceptée', () => {
    const items = [{ id: 'i1', quantity: 10 }];
    expect(svc.computeCompletion(items, [line('l1', 'i1', PO, 6, 6), line('l2', 'i1', null, 4, 0)]).complete).toBe(false);
    expect(svc.computeCompletion(items, [line('l1', 'i1', PO, 6, 6), line('l2', 'i1', 'PO2', 4, 4)]).complete).toBe(true);
  });

  test('aucun item ou item sans ligne : jamais complète', () => {
    expect(svc.computeCompletion([], []).complete).toBe(false);
    expect(svc.computeCompletion([{ id: 'i1', quantity: 1 }], []).complete).toBe(false);
  });
});

describe('groupedOrderIdsFrom', () => {
  test('ne retient que les allocations par ligne, dédoublonnées et triées', () => {
    const ids = svc.groupedOrderIdsFrom([
      { allocation: { order_id: 'o2', purchase_line_id: 'l1' }, quantity: 1 },
      { allocation: { order_id: 'o1', purchase_line_id: 'l2' }, quantity: 1 },
      { allocation: { order_id: 'o1', purchase_line_id: 'l3' }, quantity: 1 },
      { allocation: { order_id: 'o9', purchase_line_id: null }, quantity: 1 },
      { order_id: 'o3', purchase_line_id: 'l4' },
      null,
    ]);
    expect(ids).toEqual(['o1', 'o2', 'o3']);
    expect(svc.groupedOrderIdsFrom(undefined)).toEqual([]);
  });
});

describe('evaluateOrderProcurementCompletion', () => {
  test('commande introuvable : verdict found=false, aucune transition', async () => {
    useClient({ order: null });
    expect(await svc.evaluateOrderProcurementCompletion(ORDER)).toEqual({ order_id: ORDER, found: false, complete: false, transition: 'skipped' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('commande complète : PO regroupée en hub_received, preparation puis SCAN 3', async () => {
    const world = useClient({
      items: [{ id: 'i1', quantity: 3 }],
      lines: [line('l1', 'i1', PO, 3, 3)],
      pos: { [PO]: { id: PO, order_id: null, status: 'confirmed' } },
      poProgress: { [PO]: [{ effective_quantity: 3, received_quantity: 3 }] },
    });
    const verdict = await svc.evaluateOrderProcurementCompletion(ORDER, { actor: { id: 'u1', role: 'agent_hub' } });
    expect(world.updates).toEqual([PO]);
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ orderId: ORDER, newStatus: 'preparation', source: 'system', actor: { id: 'u1', role: 'agent_hub' } }));
    expect(mockScan3).toHaveBeenCalledWith(ORDER, 'u1');
    expect(verdict).toMatchObject({ complete: true, transition: 'preparation', purchase_orders_closed: [PO], items_total: 1, items_complete: 1 });
  });

  test('acteur absent : rôle system et SCAN 3 sans utilisateur', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ actor: { id: null, role: 'system' } }));
    expect(mockScan3).toHaveBeenCalledWith(ORDER, null);
  });

  test('idempotence : transition noop → aucun second SCAN 3', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    mockTransition.mockResolvedValue({ success: true, noop: true });
    const verdict = await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(verdict.transition).toBe('noop');
    expect(mockScan3).not.toHaveBeenCalled();
  });

  test('incomplète : aucune transition (la PO complète est tout de même soldée)', async () => {
    const world = useClient({
      items: [{ id: 'i1', quantity: 3 }, { id: 'i2', quantity: 1 }],
      lines: [line('l1', 'i1', PO, 3, 3), line('l2', 'i2', null, 1, 0)],
      pos: { [PO]: { id: PO, order_id: null, status: 'confirmed' } },
      poProgress: { [PO]: [{ effective_quantity: 3, received_quantity: 3 }] },
    });
    const verdict = await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(world.updates).toEqual([PO]);
    expect(verdict).toMatchObject({ complete: false, transition: 'skipped', items_complete: 1 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('commande déjà en preparation : verdict complet mais aucune transition', async () => {
    useClient({ order: { id: ORDER, status: 'preparation' }, items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    const verdict = await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(verdict).toMatchObject({ complete: true, transition: 'skipped' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test.each([
    ['PO historique (order_id renseigné)', { id: PO, order_id: 'o1', status: 'confirmed' }],
    ['PO déjà hub_received', { id: PO, order_id: null, status: 'hub_received' }],
    ['PO annulée', { id: PO, order_id: null, status: 'cancelled' }],
    ['PO introuvable', undefined],
  ])('%s : jamais réécrite', async (_label, po) => {
    const world = useClient({
      items: [{ id: 'i1', quantity: 1 }],
      lines: [line('l1', 'i1', PO, 1, 1)],
      pos: po ? { [PO]: po } : {},
      poProgress: { [PO]: [{ effective_quantity: 1, received_quantity: 1 }] },
    });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(world.updates).toEqual([]);
  });

  test('PO regroupée sans ligne active ou avec une ligne en retard : pas de hub_received', async () => {
    const empty = useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', PO, 1, 1)], pos: { [PO]: { id: PO, order_id: null, status: 'confirmed' } }, poProgress: { [PO]: [] } });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(empty.updates).toEqual([]);
    const late = useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', PO, 1, 1)], pos: { [PO]: { id: PO, order_id: null, status: 'confirmed' } }, poProgress: { [PO]: [{ effective_quantity: 2, received_quantity: 1 }] } });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(late.updates).toEqual([]);
  });

  test('transition refusée par la machine : erreur explicite', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    mockTransition.mockResolvedValue({ success: false, error: 'Transition invalide' });
    await expect(svc.evaluateOrderProcurementCompletion(ORDER)).rejects.toMatchObject({ code: 'ORDER_PREPARATION_TRANSITION_REFUSED', message: 'Transition invalide' });
    mockTransition.mockResolvedValue({ success: false });
    await expect(svc.evaluateOrderProcurementCompletion(ORDER)).rejects.toThrow('Transition vers preparation refusée');
  });

  test('un échec SCAN 3 ne défait pas la transition', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    mockScan3.mockRejectedValue(new Error('sms down'));
    expect((await svc.evaluateOrderProcurementCompletion(ORDER)).transition).toBe('preparation');
  });
});

describe('completeOrdersAfterHubReceipt', () => {
  const allocation = (orderId, lineId = 'l1') => ({ allocation: { order_id: orderId, purchase_line_id: lineId }, quantity: 1 });

  test('une évaluation par commande touchée, jamais pour une allocation historique', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 0)] });
    const results = await svc.completeOrdersAfterHubReceipt([allocation(ORDER), allocation(ORDER, 'l2'), { allocation: { order_id: 'o9', purchase_line_id: null } }]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ order_id: ORDER, complete: false });
    expect(await svc.completeOrdersAfterHubReceipt([])).toEqual([]);
  });

  test('un échec crée une alerte et ne remonte jamais', async () => {
    db.withTransaction.mockRejectedValue(new Error('db down'));
    const results = await svc.completeOrdersAfterHubReceipt([allocation(ORDER)]);
    expect(results).toEqual([{ order_id: ORDER, error: 'db down' }]);
    expect(mockAlert).toHaveBeenCalledWith(db, expect.objectContaining({ type: 'purchasing_completion_failed', entityId: ORDER, severity: 'high' }));
  });

  test('alerte elle-même en échec : toujours aucune exception', async () => {
    db.withTransaction.mockRejectedValue(new Error('db down'));
    mockAlert.mockRejectedValue(new Error('alerts down'));
    await expect(svc.completeOrdersAfterHubReceipt([allocation(ORDER)])).resolves.toHaveLength(1);
  });
});

describe('chargement de SCAN 3', () => {
  test('scan-operations indisponible : repli no-op sans casser la complétude', async () => {
    jest.resetModules();
    jest.doMock('../../db', () => ({ withTransaction: jest.fn(), query: jest.fn() }));
    jest.doMock('../../utils/logger', () => {
      const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      return { child: f };
    });
    jest.doMock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn().mockResolvedValue({ success: true, noop: false }) }));
    jest.doMock('../../utils/alerts', () => ({ createAlert: jest.fn() }));
    jest.doMock('../../services/scan-operations', () => { throw new Error('module absent'); });
    const isolatedDb = require('../../db');
    const { client } = makeClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    isolatedDb.withTransaction.mockImplementation(async (work) => work(client));
    const isolated = require('../../services/purchasing-completion-service');
    await expect(isolated.evaluateOrderProcurementCompletion(ORDER)).resolves.toMatchObject({ transition: 'preparation' });
    jest.dontMock('../../services/scan-operations');
  });
});
