'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const internals = {
  db: { pool: { connect: jest.fn() } },
  CONFIG: { PUBLIC_TOKEN_PREFIX: 'WS-', CREATOR_TOKEN_PREFIX: 'WC-' },
  _generateToken: jest.fn(),
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => client.query('INSERT INTO collective_workspace_events', [])),
};

jest.mock('../../services/collective-workspace-internals', () => internals);

const { createWorkspace } = require('../../services/collective-workspace-creation');

describe('collective-workspace-creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    internals._generateToken
      .mockReturnValueOnce('WS-public')
      .mockReturnValueOnce('WC-creator');
    internals._hashToken.mockImplementation((token) => `hash:${token}`);
  });

  it('refuse une creation sans event_name ou creator_name', async () => {
    await expect(createWorkspace({ event_name: '', creator_name: 'Sam' })).rejects.toThrow('event_name et creator_name requis');
    await expect(createWorkspace({ event_name: 'Mariage', creator_name: '' })).rejects.toThrow('event_name et creator_name requis');
    expect(internals.db.pool.connect).not.toHaveBeenCalled();
  });

  it('cree un workspace conception avec tokens bruts retournes une seule fois', async () => {
    const workspace = { id: 'ws-001', event_name: 'Mariage', status: 'conception' };
    const client = makeClient([
      { rows: [workspace] },
      { rows: [], rowCount: 1 },
    ]);
    internals.db.pool.connect.mockResolvedValue(client);

    const result = await createWorkspace({
      event_name: 'Mariage',
      event_note: 'Famille',
      creator_name: 'Sam',
      creator_phone: '+269000',
      creator_email: 'sam@example.com',
      creator_user_id: 'user-001',
      recipient_name: 'Ali',
      recipient_phone: '+269111',
      relais_id: 'relais-001',
    });

    expect(result).toEqual({ workspace, public_token: 'WS-public', creator_token: 'WC-creator' });
    expect(client.calls[1].sql).toContain('INSERT INTO collective_workspaces');
    expect(client.calls[1].params).toEqual([
      'hash:WS-public', 'hash:WC-creator', 'Mariage', 'Famille', 'Sam', '+269000',
      'sam@example.com', 'user-001', 'Ali', '+269111', 'relais-001',
    ]);
    expect(internals.logEvent).toHaveBeenCalledWith(client, 'ws-001', 'workspace_created', 'creator', 'sam@example.com', {
      event_name: 'Mariage', recipient_name: 'Ali', relais_id: 'relais-001',
    });
    expectTransactionCommitted(client);
  });

  it('rollback si insertion DB echoue', async () => {
    const client = makeClient([new Error('db_down')]);
    internals.db.pool.connect.mockResolvedValue(client);

    await expect(createWorkspace({ event_name: 'Mariage', creator_name: 'Sam' })).rejects.toThrow('db_down');
    expectTransactionRolledBack(client);
  });
});
