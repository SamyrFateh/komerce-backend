'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const internals = {
  db: { pool: { connect: jest.fn() } },
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => client.query('INSERT INTO collective_workspace_events', [])),
};

jest.mock('../../services/collective-workspace-internals', () => internals);

const {
  addContribution,
  cancelContribution,
  cancelContributionByCreator,
} = require('../../services/collective-workspace-contributions');

describe('collective-workspace-contributions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('addContribution cree une intention avec montant et kind derive', async () => {
    const contribution = { id: 'contrib-001', status: 'intention', kind: 'intention' };
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [contribution] },
      { rows: [], rowCount: 1 },
    ]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(addContribution('WS-token', {
      contributor_name: 'Ali', contributor_phone: '+269000', intended_amount_kmf: '5000',
    })).resolves.toBe(contribution);

    expect(client.calls[1].sql).toContain('INSERT INTO collective_workspace_contributions');
    expect(client.calls[1].params).toEqual(['ws-001', 'Ali', '+269000', null, 5000, null, null, 'intention']);
    expectTransactionCommitted(client);
  });

  it('addContribution refuse un contenu vide', async () => {
    await expect(addContribution('WS-token', { contributor_name: 'Ali' })).rejects.toThrow('content_required');
    expect(internals.db.pool.connect).not.toHaveBeenCalled();
  });

  it('addContribution refuse un workspace non ouvert', async () => {
    const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(addContribution('WS-token', { contributor_name: 'Ali', message: 'ok' })).rejects.toThrow('workspace_not_open');
    expectTransactionRolledBack(client);
  });

  it('cancelContribution annule une intention par token public', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(cancelContribution('WS-token', 'contrib-001')).resolves.toEqual({ ok: true });
    expect(client.calls[1].sql).toContain("SET status = 'cancelled'");
    expect(client.calls[1].params).toEqual(['contrib-001', 'ws-001']);
    expectTransactionCommitted(client);
  });

  it('cancelContributionByCreator annule une intention depuis le cockpit createur', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(cancelContributionByCreator('WC-token', 'contrib-001')).resolves.toEqual({ ok: true });
    expect(client.calls[1].params).toEqual(['contrib-001', 'ws-001']);
    expectTransactionCommitted(client);
  });
});
