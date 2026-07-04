'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockInternals = {
  db: { pool: { connect: jest.fn() } },
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => client.query('INSERT INTO collective_workspace_events', [])),
};

jest.mock('../../services/collective-workspace-internals', () => mockInternals);

const { addItem, updateItem, removeItem } = require('../../services/collective-workspace-items');

describe('collective-workspace-items', () => {
  beforeEach(() => jest.clearAllMocks());

  it('addItem ajoute un produit actif dans un workspace conception', async () => {
    const item = { id: 'item-001', workspace_id: 'ws-001' };
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [{ name: 'Riz', image_url: 'riz.jpg', price_kmf: 1000 }] },
      { rows: [item] },
      { rows: [], rowCount: 1 },
    ]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(addItem('WC-token', { product_id: 'product-001', quantity: 2 })).resolves.toBe(item);
    expect(client.calls[3].params).toEqual(['ws-001', 'product-001', 2, 'Riz', 'riz.jpg', 1000]);
    expectTransactionCommitted(client);
  });

  it('addItem refuse un workspace non modifiable', async () => {
    const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(addItem('WC-token', { product_id: 'product-001', quantity: 1 })).rejects.toThrow('workspace_not_modifiable');
    expectTransactionRolledBack(client);
  });

  it('updateItem force une quantite minimale a 1', async () => {
    const updated = { id: 'item-001', quantity: 1 };
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [updated] },
      { rows: [], rowCount: 1 },
    ]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(updateItem('WC-token', 'item-001', { quantity: 0 })).resolves.toBe(updated);
    expect(client.calls[2].params).toEqual([1, 'item-001', 'ws-001']);
    expectTransactionCommitted(client);
  });

  it('removeItem supprime un item', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(removeItem('WC-token', 'item-001')).resolves.toEqual({ ok: true });
    expect(client.calls[2].sql).toContain('DELETE FROM collective_workspace_items');
    expectTransactionCommitted(client);
  });
});

describe('collective-workspace-items — Lot A, branches manquantes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('addItem', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addItem('WC-token', { product_id: 'p1', quantity: 1 })).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('produit introuvable ou inactif → ROLLBACK + product_not_found', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [] }, // SELECT products → aucun produit actif
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addItem('WC-token', { product_id: 'p1', quantity: 1 })).rejects.toThrow('product_not_found');
      expectTransactionRolledBack(client);
    });

    it('sans product_id → snapshots null, aucune requête products, INSERT direct', async () => {
      const item = { id: 'item-002', workspace_id: 'ws-001' };
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [item] }, // INSERT — pas de SELECT products car product_id absent
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addItem('WC-token', { quantity: 3 })).resolves.toBe(item);
      expect(client.calls[2].params).toEqual(['ws-001', null, 3, null, null, null]);
      expectTransactionCommitted(client);
    });

    it('quantity absente ou invalide → forcée à 1', async () => {
      const item = { id: 'item-003' };
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addItem('WC-token', {})).resolves.toBe(item);
      expect(client.calls[2].params).toEqual(['ws-001', null, 1, null, null, null]);
      expectTransactionCommitted(client);
    });
  });

  describe('updateItem', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(updateItem('WC-token', 'item-001', { quantity: 2 })).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('workspace non modifiable → ROLLBACK + workspace_not_modifiable', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(updateItem('WC-token', 'item-001', { quantity: 2 })).rejects.toThrow('workspace_not_modifiable');
      expectTransactionRolledBack(client);
    });

    it('item introuvable dans ce workspace → ROLLBACK + item_not_found', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [] }, // UPDATE ... RETURNING * → aucune ligne
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(updateItem('WC-token', 'item-999', { quantity: 2 })).rejects.toThrow('item_not_found');
      expectTransactionRolledBack(client);
    });
  });

  describe('removeItem', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(removeItem('WC-token', 'item-001')).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('workspace non modifiable → ROLLBACK + workspace_not_modifiable', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-001', status: 'session_ended' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(removeItem('WC-token', 'item-001')).rejects.toThrow('workspace_not_modifiable');
      expectTransactionRolledBack(client);
    });

    it('item introuvable dans ce workspace → ROLLBACK + item_not_found', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [], rowCount: 0 }, // DELETE → 0 ligne affectée
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(removeItem('WC-token', 'item-999')).rejects.toThrow('item_not_found');
      expectTransactionRolledBack(client);
    });
  });
});
