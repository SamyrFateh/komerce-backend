'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockInternals = {
  db: { pool: { connect: jest.fn() } },
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => client.query('INSERT INTO collective_workspace_events', [])),
};

jest.mock('../../services/collective-workspace-internals', () => mockInternals);

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
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(addContribution('WS-token', {
      contributor_name: 'Ali', contributor_phone: '+269000', intended_amount_kmf: '5000',
    })).resolves.toBe(contribution);

    expect(client.calls[2].sql).toContain('INSERT INTO collective_workspace_contributions');
    expect(client.calls[2].params).toEqual(['ws-001', 'Ali', '+269000', null, 5000, null, null, 'intention']);
    expectTransactionCommitted(client);
  });

  it('addContribution refuse un contenu vide', async () => {
    await expect(addContribution('WS-token', { contributor_name: 'Ali' })).rejects.toThrow('content_required');
    expect(mockInternals.db.pool.connect).not.toHaveBeenCalled();
  });

  it('addContribution refuse un workspace non ouvert', async () => {
    const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(addContribution('WS-token', { contributor_name: 'Ali', message: 'ok' })).rejects.toThrow('workspace_not_open');
    expectTransactionRolledBack(client);
  });

  it('cancelContribution annule une intention par token public', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(cancelContribution('WS-token', 'contrib-001')).resolves.toEqual({ ok: true });
    expect(client.calls[2].sql).toContain("SET status = 'cancelled'");
    expect(client.calls[2].params).toEqual(['contrib-001', 'ws-001']);
    expectTransactionCommitted(client);
  });

  it('cancelContributionByCreator annule une intention depuis le cockpit createur', async () => {
    const client = makeClient([
      { rows: [{ id: 'ws-001', status: 'conception' }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    mockInternals.db.pool.connect.mockResolvedValue(client);

    await expect(cancelContributionByCreator('WC-token', 'contrib-001')).resolves.toEqual({ ok: true });
    expect(client.calls[2].params).toEqual(['contrib-001', 'ws-001']);
    expectTransactionCommitted(client);
  });
});

describe('collective-workspace-contributions — Lot A, branches manquantes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('addContribution — validations en entrée', () => {
    it('refuse sans contributor_name', async () => {
      await expect(addContribution('WS-token', { message: 'ok' })).rejects.toThrow('contributor_name_required');
      expect(mockInternals.db.pool.connect).not.toHaveBeenCalled();
    });

    it('refuse un montant non numérique', async () => {
      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', intended_amount_kmf: 'abc',
      })).rejects.toThrow('amount_invalid');
      expect(mockInternals.db.pool.connect).not.toHaveBeenCalled();
    });

    it('refuse un montant <= 0', async () => {
      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', intended_amount_kmf: '0',
      })).rejects.toThrow('amount_invalid');
      expect(mockInternals.db.pool.connect).not.toHaveBeenCalled();
    });

    it('intended_amount_kmf vide ("") → amount reste null, content_required si rien d\'autre', async () => {
      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', intended_amount_kmf: '',
      })).rejects.toThrow('content_required');
      expect(mockInternals.db.pool.connect).not.toHaveBeenCalled();
    });
  });

  describe('addContribution — dérivation du kind', () => {
    it('kind explicite valide → utilisé tel quel, non redérivé', async () => {
      const contribution = { id: 'contrib-002' };
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [contribution] },
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', message: 'salut', kind: 'MESSAGE',
      })).resolves.toBe(contribution);
      expect(client.calls[2].params).toEqual(['ws-001', 'Ali', null, null, null, null, 'salut', 'message']);
      expectTransactionCommitted(client);
    });

    it('sans montant, avec suggestion seule → kind derive suggestion', async () => {
      const contribution = { id: 'contrib-003' };
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [contribution] },
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', suggestion: 'Prenez du riz',
      })).resolves.toBe(contribution);
      expect(client.calls[2].params).toEqual(['ws-001', 'Ali', null, null, null, 'Prenez du riz', null, 'suggestion']);
      expectTransactionCommitted(client);
    });

    it('sans montant ni suggestion, avec message seul → kind derive message', async () => {
      const contribution = { id: 'contrib-004' };
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [contribution] },
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addContribution('WS-token', {
        contributor_name: 'Ali', message: 'Bon courage !',
      })).resolves.toBe(contribution);
      expect(client.calls[2].params).toEqual(['ws-001', 'Ali', null, null, null, null, 'Bon courage !', 'message']);
      expectTransactionCommitted(client);
    });
  });

  describe('addContribution — workspace introuvable', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(addContribution('WS-token', { contributor_name: 'Ali', message: 'ok' }))
        .rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });
  });

  describe('cancelContribution', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContribution('WS-token', 'contrib-001')).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('workspace non ouvert → ROLLBACK + workspace_not_open', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-001', status: 'payment_pending' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContribution('WS-token', 'contrib-001')).rejects.toThrow('workspace_not_open');
      expectTransactionRolledBack(client);
    });

    it('contribution introuvable ou déjà traitée → ROLLBACK + contribution_not_found_or_already_handled', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [], rowCount: 0 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContribution('WS-token', 'contrib-999'))
        .rejects.toThrow('contribution_not_found_or_already_handled');
      expectTransactionRolledBack(client);
    });
  });

  describe('cancelContributionByCreator', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContributionByCreator('WC-token', 'contrib-001')).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('workspace non ouvert → ROLLBACK + workspace_not_open', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-001', status: 'session_ended' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContributionByCreator('WC-token', 'contrib-001')).rejects.toThrow('workspace_not_open');
      expectTransactionRolledBack(client);
    });

    it('contribution introuvable ou déjà traitée → ROLLBACK + contribution_not_found_or_already_handled', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [], rowCount: 0 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(cancelContributionByCreator('WC-token', 'contrib-999'))
        .rejects.toThrow('contribution_not_found_or_already_handled');
      expectTransactionRolledBack(client);
    });
  });
});
