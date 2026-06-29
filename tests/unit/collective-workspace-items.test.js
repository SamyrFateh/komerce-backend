'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const internals = {
  db: { pool: { connect: jest.fn() } },
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => client.query('INSERT INTO collective_workspace_events', [])),
};

jest.mock('../../services/collective-workspace-internals', () => internals);

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
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(addItem('WC-token', { product_id: 'product-001', quantity: 2 })).resolves.toBe(item);
    expect(client.calls[2].params).toEqual(['ws-001', 'product-001', 2, 'Riz', 'riz.jpg', 1000]);
    expectTransactionCommitted(client);
  });

  it('addItem refuse un workspace non modifiable', async () => {
    const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
    internals.db.pool.connect.mockResolvedValue(client);

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
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(updateItem('WC-token', 'item-001', { quantity: 0 })).resolves.toBe(updated);
    expect(client.calls[1].params).toEqual([1, 'item-001', 'ws-001']);
    expectTransactionCommitted(client);
  });

  it('removeItem supprime un item', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(removeItem('WC-token', 'item-001')).resolves.toEqual({ ok: true });
    expect(client.calls[1].sql).toContain('DELETE FROM collective_workspace_items');
    expectTransactionCommitted(client);
  });
});
