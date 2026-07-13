/**
 * KOMERCE — Tests Unitaires : collective-stock-reservation-service (P0 shared-cart)
 *
 * Couvre la réservation de stock pour un workspace collectif : libération des
 * réservations précédentes, calcul de disponibilité (stock - réservé actif),
 * détection de shortage (rollback), release, consume, et le hook ensureTable
 * (no-op désormais, cf. bugfix ReferenceError corrigé dans ce lot).
 *
 * Run : npx jest tests/unit/collective-stock-reservation-service.test.js
 */

'use strict';

const mockEngineGetWorkspaceByCreatorToken = jest.fn();
const mockEngineLogEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/collective-workspace-engine', () => ({
  getWorkspaceByCreatorToken: (...args) => mockEngineGetWorkspaceByCreatorToken(...args),
  logEvent: (...args) => mockEngineLogEvent(...args),
}));

function makeClient(responses) {
  const calls = [];
  const client = {
    query: jest.fn((sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      const next = responses.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next || { rows: [] });
    }),
    release: jest.fn(),
  };
  return { client, calls };
}

const mockPoolConnect = jest.fn();
jest.mock('../../db', () => ({
  pool: { connect: (...args) => mockPoolConnect(...args) },
  query: jest.fn(),
}));

const {
  ensureTable,
  reserveForCreatorToken,
  reserveForWorkspace,
  releaseForWorkspace,
  consumeForWorkspace,
} = require('../../services/collective-stock-reservation-service');

describe('ensureTable', () => {
  test('est un no-op qui ne lève pas (DDL géré par migrations)', async () => {
    await expect(ensureTable()).resolves.toBeUndefined();
  });
});

describe('reserveForCreatorToken', () => {
  beforeEach(() => {
    mockEngineGetWorkspaceByCreatorToken.mockReset();
    mockPoolConnect.mockReset();
  });

  test('lève workspace_not_found si le token ne résout aucun workspace', async () => {
    mockEngineGetWorkspaceByCreatorToken.mockResolvedValueOnce(null);

    await expect(reserveForCreatorToken('tok-x')).rejects.toThrow('workspace_not_found');
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  test('délègue à reserveForWorkspace avec l\'id résolu et un ttl_hours clampé', async () => {
    mockEngineGetWorkspaceByCreatorToken.mockResolvedValueOnce({ id: 'ws-1' });

    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'conception' }] }, // SELECT FOR UPDATE
      {}, // UPDATE released
      { rows: [] }, // SELECT items (vide)
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    const result = await reserveForCreatorToken('tok-x', { ttl_hours: 999 });

    expect(result.ok).toBe(true);
    expect(result.reservations).toEqual([]);
  });
});

describe('reserveForWorkspace', () => {
  beforeEach(() => {
    mockPoolConnect.mockReset();
    mockEngineLogEvent.mockClear();
  });

  test('lève workspace_not_found si le workspace n\'existe pas', async () => {
    const { client } = makeClient([{ rows: [] }]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(reserveForWorkspace('ws-missing')).rejects.toThrow('workspace_not_found');
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('lève workspace_not_reservable si le statut ne permet pas la réservation', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'archived' }] }, // SELECT FOR UPDATE
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(reserveForWorkspace('ws-1')).rejects.toThrow('workspace_not_reservable');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('réserve avec succès quand le stock est suffisant et logue l\'event', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'conception' }] }, // SELECT workspace FOR UPDATE
      {}, // UPDATE release previous reservations
      { rows: [{ product_id: 'p1', quantity: 3 }] }, // SELECT items grouped
      { rows: [{ id: 'p1', name: 'Produit 1', stock: 10 }] }, // SELECT product FOR UPDATE
      { rows: [{ qty: 2 }] }, // SELECT active reserved by other workspaces
      { rows: [{ id: 'r1', workspace_id: 'ws-1', product_id: 'p1', quantity: 3, status: 'reserved' }] }, // INSERT reservation
      {}, // COMMIT (via client.query('COMMIT'))
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    const result = await reserveForWorkspace('ws-1', { ttl_hours: 24 });

    expect(result.ok).toBe(true);
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0].product_id).toBe('p1');
    expect(mockEngineLogEvent).toHaveBeenCalledWith(
      client,
      'ws-1',
      'stock_reserved',
      'system',
      null,
      expect.objectContaining({ reservations_count: 1 })
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('produit un shortage et rollback si le stock disponible est insuffisant', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'conception' }] }, // workspace
      {}, // release previous
      { rows: [{ product_id: 'p1', quantity: 5 }] }, // items
      { rows: [{ id: 'p1', name: 'Produit 1', stock: 4 }] }, // product
      { rows: [{ qty: 0 }] }, // active reserved
      {}, // ROLLBACK
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(reserveForWorkspace('ws-1')).rejects.toThrow('stock_reservation_shortage');

    const rollbackCalls = client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK');
    expect(rollbackCalls.length).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('ignore les produits sans suivi de stock (stock null)', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'ready_to_order' }] },
      {}, // release previous
      { rows: [{ product_id: 'p1', quantity: 2 }] },
      { rows: [{ id: 'p1', name: 'Produit sans stock suivi', stock: null }] },
      {}, // COMMIT
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    const result = await reserveForWorkspace('ws-1');

    expect(result.ok).toBe(true);
    expect(result.reservations).toEqual([]);
  });

  test('enregistre un shortage si le produit est introuvable', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'conception' }] },
      {}, // release previous
      { rows: [{ product_id: 'p-deleted', quantity: 1 }] },
      { rows: [] }, // produit introuvable
      {}, // ROLLBACK
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(reserveForWorkspace('ws-1')).rejects.toThrow('stock_reservation_shortage');
  });

  test('PDC-7 : un produit inventory_model=SKU ne peut pas être réservé via products.stock — shortage explicite, jamais de fallback', async () => {
    const { client } = makeClient([
      {}, // BEGIN
      { rows: [{ id: 'ws-1', status: 'conception' }] }, // workspace
      {}, // release previous
      { rows: [{ product_id: 'p-sku', quantity: 2 }] }, // items (product_id + quantity seulement, pas de sku_id)
      { rows: [{ id: 'p-sku', name: 'Produit SKU', stock: 999, inventory_model: 'SKU' }] }, // product FOR UPDATE — stock élevé, ne doit jamais être utilisé
      {}, // ROLLBACK
    ]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(reserveForWorkspace('ws-1')).rejects.toThrow('stock_reservation_shortage');

    // Aucune requête active_reserved ni INSERT reservation ne doit avoir été
    // tentée pour ce produit : le chemin est fermé avant toute décision basée
    // sur products.stock (collective_workspace_items n'a pas de sku_id).
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO collective_stock_reservations'),
      expect.anything()
    );
    const rollbackCalls = client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK');
    expect(rollbackCalls.length).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('releaseForWorkspace', () => {
  beforeEach(() => {
    mockPoolConnect.mockReset();
    mockEngineLogEvent.mockClear();
  });

  test('libère les réservations actives et logue l\'event avec le motif', async () => {
    const { client } = makeClient([{}, {}, {}]);
    mockPoolConnect.mockResolvedValueOnce(client);

    const result = await releaseForWorkspace('ws-1', 'admin_cancel');

    expect(result).toEqual({ ok: true });
    expect(mockEngineLogEvent).toHaveBeenCalledWith(
      client,
      'ws-1',
      'stock_reservation_released',
      'system',
      null,
      { reason: 'admin_cancel' }
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rollback et propage l\'erreur si l\'UPDATE échoue', async () => {
    const { client } = makeClient([{}, new Error('db down')]);
    mockPoolConnect.mockResolvedValueOnce(client);

    await expect(releaseForWorkspace('ws-1')).rejects.toThrow('db down');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('consumeForWorkspace', () => {
  test('marque les réservations comme consommées via le client fourni', async () => {
    const mockQuery = jest.fn().mockResolvedValue({});
    const fakeClient = { query: mockQuery };

    await consumeForWorkspace('ws-1', fakeClient);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE collective_stock_reservations/);
    expect(sql).toMatch(/status = 'consumed'/);
    expect(params).toEqual(['ws-1']);
  });
});
