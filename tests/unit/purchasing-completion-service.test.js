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
const mockOpenShortage = jest.fn();
jest.mock('../../services/supplier-shortage-service', () => ({ openSupplierShortage: (...a) => mockOpenShortage(...a) }));
const mockDistribute = jest.fn();
jest.mock('../../services/auto-parcel', () => ({ distributeOrder: (...a) => mockDistribute(...a) }));
const mockAlert = jest.fn();
jest.mock('../../utils/alerts', () => ({ createAlert: (...a) => mockAlert(...a) }));

const db = require('../../db');
const svc = require('../../services/purchasing-completion-service');

const ORDER = '00000000-0000-4000-8000-0000000000a1';
const PO = '00000000-0000-4000-8000-0000000000b1';

/** Client simulé : réponses par motif SQL. */
function makeClient({ order = { id: ORDER, status: 'ordered' }, items = [], lines = [], pos = {}, poProgress = {}, settled = [] } = {}) {
  const updates = [];
  const query = jest.fn(async (sql, params) => {
    if (/FROM orders WHERE id/.test(sql)) return { rows: order ? [order] : [] };
    if (/FROM purchase_lines WHERE id = ANY/.test(sql)) return { rows: settled.map((id) => ({ id })) };
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
  mockDistribute.mockResolvedValue({ success: true });
  mockOpenShortage.mockResolvedValue({ created: true, alert_created: true });
  db.query.mockReset();
});

describe('computeCompletion', () => {
  test('un item est complet si couvert (Σ effectif ≥ quantité) ET entièrement reçu', () => {
    const items = [{ id: 'i1', quantity: 5 }, { id: 'i2', quantity: 2 }];
    expect(svc.computeCompletion(items, [line('l1', 'i1', PO, 5, 5), line('l2', 'i2', PO, 2, 2)])).toEqual({ items_total: 2, items_complete: 2, complete: true, shortages: [] });
  });

  test('fail-closed : ligne soldée sans reliquat (Σ effectif < quantité) laisse l\'item incomplet', () => {
    const result = svc.computeCompletion([{ id: 'i1', quantity: 10 }], [line('l1', 'i1', PO, 6, 6)]);
    expect(result).toEqual({ items_total: 1, items_complete: 0, complete: false, shortages: [] });
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
  test('retient les allocations regroupées ET historiques (C2), dédoublonnées et triées', () => {
    const ids = svc.groupedOrderIdsFrom([
      { allocation: { order_id: 'o2', purchase_line_id: 'l1' }, quantity: 1 },
      { allocation: { order_id: 'o1', purchase_line_id: 'l2' }, quantity: 1 },
      { allocation: { order_id: 'o1', purchase_line_id: 'l3' }, quantity: 1 },
      { allocation: { order_id: 'o9', purchase_line_id: null }, quantity: 1 },
      { order_id: 'o3', purchase_line_id: 'l4' },
      null,
    ]);
    expect(ids).toEqual(['o1', 'o2', 'o3', 'o9']);
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

  test('PO historique entièrement reçue PHYSIQUEMENT (vue = custody) : passe en hub_received (C2)', async () => {
    const world = useClient({
      items: [{ id: 'i1', quantity: 1 }],
      lines: [line('l1', 'i1', PO, 1, 1)],
      pos: { [PO]: { id: PO, order_id: 'o1', status: 'confirmed' } },
      poProgress: { [PO]: [{ effective_quantity: 1, received_quantity: 1 }] },
    });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(world.updates.length).toBe(1);
  });

  test('PO historique partiellement reçue physiquement : jamais fermée (C2)', async () => {
    const world = useClient({
      items: [{ id: 'i1', quantity: 2 }],
      lines: [line('l1', 'i1', PO, 2, 1)],
      pos: { [PO]: { id: PO, order_id: 'o1', status: 'confirmed' } },
      poProgress: { [PO]: [{ effective_quantity: 2, received_quantity: 1 }] },
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

  test('une évaluation par commande touchée, allocations historiques incluses (C2)', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 0)] });
    const results = await svc.completeOrdersAfterHubReceipt([allocation(ORDER), allocation(ORDER, 'l2'), { allocation: { order_id: 'o9', purchase_line_id: null } }]);
    expect(results.map((r) => r.order_id).sort()).toEqual([ORDER, 'o9'].sort());
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

describe('H1 — avancement automatique', () => {
  const LINE_SHORT = '00000000-0000-4000-8000-0000000000c1';

  test('HB-02 computeCompletion : ligne soldée sans reliquat = couverte ; le manquant est signalé', () => {
    const r = svc.computeCompletion([{ id: 'i1', quantity: 10 }], [line(LINE_SHORT, 'i1', PO, 6, 6)], new Set([LINE_SHORT]));
    expect(r).toEqual({ items_total: 1, items_complete: 1, complete: true, shortages: [{ order_item_id: 'i1', missing_quantity: 4, received_quantity: 6 }] });
  });

  test('HB-02 : une ligne soldée dont rien n\'a été reçu ne fait pas partir la commande', () => {
    const r = svc.computeCompletion([{ id: 'i1', quantity: 4 }], [line(LINE_SHORT, 'i1', PO, 0, 0)], new Set([LINE_SHORT]));
    expect(r.complete).toBe(false);
    expect(r.shortages).toHaveLength(1);
  });

  test('HB-02 : un reliquat non reçu ou une sous-couverture non soldée bloque toujours', () => {
    expect(svc.computeCompletion([{ id: 'i1', quantity: 10 }], [line(LINE_SHORT, 'i1', PO, 6, 6), line('l2', 'i1', null, 4, 0)], new Set([LINE_SHORT])).complete).toBe(false);
    expect(svc.computeCompletion([{ id: 'i1', quantity: 10 }], [line('l1', 'i1', PO, 6, 6)]).complete).toBe(false);
  });

  test('rupture : transition, répartition du reçu, rattrapage incident + alerte par ligne soldée (idempotent côté service)', async () => {
    useClient({ items: [{ id: 'i1', quantity: 10 }], lines: [line(LINE_SHORT, 'i1', null, 6, 6)], settled: [LINE_SHORT] });
    db.query.mockResolvedValueOnce({ rows: [{ id: LINE_SHORT, missing: 4, settle_reason: 'rupture' }] });
    const verdict = await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(verdict).toMatchObject({ complete: true, transition: 'preparation' });
    expect(mockDistribute).toHaveBeenCalledWith(ORDER);
    expect(mockOpenShortage).toHaveBeenCalledWith(db, expect.objectContaining({ purchaseLineId: LINE_SHORT, orderItemId: 'i1', missingQuantity: 4, actorId: null }));
  });

  test('HB-03 : répartition automatique au passage en preparation ; échec = alerte, transition conservée', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    expect((await svc.evaluateOrderProcurementCompletion(ORDER)).transition).toBe('preparation');
    expect(mockDistribute).toHaveBeenCalledTimes(1);

    mockDistribute.mockRejectedValue(new Error('boom'));
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    expect((await svc.evaluateOrderProcurementCompletion(ORDER)).transition).toBe('preparation');
    expect(mockAlert).toHaveBeenCalledWith(db, expect.objectContaining({ type: 'purchasing_distribution_failed' }));
  });

  test('HB-03 : aucune répartition si la transition est un noop (déjà fait)', async () => {
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    mockTransition.mockResolvedValue({ success: true, noop: true });
    await svc.evaluateOrderProcurementCompletion(ORDER);
    expect(mockDistribute).not.toHaveBeenCalled();
  });

  test('HB-01 : redémarrage simulé entre la réception et la complétude, rattrapé par le balayage', async () => {
    // Réception committée, mais complétude jamais exécutée : la commande est restée `ordered`.
    db.query
      .mockResolvedValueOnce({ rows: [{ id: ORDER }] }) // commandes ordered entièrement reçues
      .mockResolvedValueOnce({ rows: [] });            // aucune commande preparation sans colis
    useClient({ items: [{ id: 'i1', quantity: 2 }], lines: [line('l1', 'i1', null, 2, 2)] });
    const swept = await svc.sweepStalledOrders();
    expect(swept).toEqual({ ordered: 1, distributed: 0, errors: 0 });
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ orderId: ORDER, newStatus: 'preparation' }));
    expect(mockDistribute).toHaveBeenCalledWith(ORDER);
  });

  test('balayage idempotent : second passage = rien à faire ; reprise des commandes preparation sans colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: ORDER }] });
    expect(await svc.sweepStalledOrders()).toEqual({ ordered: 0, distributed: 1, errors: 0 });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockDistribute).toHaveBeenCalledWith(ORDER);
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await svc.sweepStalledOrders()).toEqual({ ordered: 0, distributed: 0, errors: 0 });
  });

  test('balayage : une erreur sur une commande n\'arrête pas les suivantes ni ne lève', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o-bad' }, { id: ORDER }] }).mockResolvedValueOnce({ rows: [] });
    db.withTransaction.mockRejectedValueOnce(new Error('db down'));
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    db.withTransaction.mockRejectedValueOnce(new Error('db down'));
    const swept = await svc.sweepStalledOrders();
    expect(swept.errors).toBeGreaterThanOrEqual(1);
  });

  test('HB-01 rejeu : la complétude est recalculée pour les commandes de l\'unité', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ order_id: ORDER }] });
    useClient({ items: [{ id: 'i1', quantity: 1 }], lines: [line('l1', 'i1', null, 1, 1)] });
    const results = await svc.completeOrdersForPhysicalUnit('unit-1', { actor: { id: 'u1' } });
    expect(results[0]).toMatchObject({ order_id: ORDER, transition: 'preparation' });
    db.query.mockRejectedValueOnce(new Error('x'));
    expect(await svc.completeOrdersForPhysicalUnit('unit-1')).toEqual([]);
  });
});
