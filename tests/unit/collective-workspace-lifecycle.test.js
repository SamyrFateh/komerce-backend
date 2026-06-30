'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockInternals = {
  db: { query: jest.fn(), pool: { connect: jest.fn() } },
  CONFIG: {
    SESSION_DURATION_MS: 72 * 60 * 60 * 1000,
    SESSION_DURATION_MIN_MS: 60 * 60 * 1000,
    PAYMENT_TOKEN_PREFIX: 'PT-',
  },
  _generateToken: jest.fn(() => 'PT-token-001'),
  _hashToken: jest.fn((token) => `hash:${token}`),
  logEvent: jest.fn(async (client) => {
    if (client) await client.query('INSERT INTO collective_workspace_events', []);
  }),
};

jest.mock('../../services/collective-workspace-internals', () => mockInternals);
jest.mock('../../services/collective-workspace-reads', () => ({
  getWorkspaceByCreatorToken: jest.fn(),
}));

const { getWorkspaceByCreatorToken } = require('../../services/collective-workspace-reads');
const { finalizationReview, finalizeWorkspace, resumeWorkspace } = require('../../services/collective-workspace-lifecycle');

describe('collective-workspace-lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInternals._generateToken.mockReturnValue('PT-token-001');
    mockInternals._hashToken.mockImplementation((token) => `hash:${token}`);
  });

  describe('finalizationReview', () => {
    it('calcule total, intentions, gap et can_finalize', async () => {
      getWorkspaceByCreatorToken.mockResolvedValue({ id: 'ws-001', status: 'conception' });
      mockInternals.db.query
        .mockResolvedValueOnce({ rows: [{
          id: 'item-001', product_id: 'product-001', current_name: 'Riz', quantity: 2,
          current_price_kmf: '1000', product_active: true, price_snapshot_kmf: '900',
        }] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', contributor_name: 'A', intended_amount_kmf: '2000' }] });

      const result = await finalizationReview('creator-token');

      expect(result).toEqual(expect.objectContaining({
        workspace_id: 'ws-001',
        total_kmf: 2000,
        intended_sum_kmf: 2000,
        gap_kmf: 0,
        can_finalize: true,
        issues: [],
      }));
      expect(result.line_items[0]).toEqual(expect.objectContaining({
        product_name: 'Riz',
        line_total_kmf: 2000,
        price_changed: true,
      }));
      expect(mockInternals.logEvent).toHaveBeenCalledWith(null, 'ws-001', 'finalization_reviewed', 'creator', null, expect.any(Object));
    });

    it('refuse un workspace qui nest pas en conception', async () => {
      getWorkspaceByCreatorToken.mockResolvedValue({ id: 'ws-001', status: 'payment_pending' });

      await expect(finalizationReview('creator-token')).rejects.toThrow('workspace_not_in_conception');
    });
  });

  describe('finalizeWorkspace', () => {
    it('renvoie la session existante si le workspace est deja payment_pending', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'payment_pending' }] },
        { rows: [{ id: 'session-001' }] },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      const result = await finalizeWorkspace('creator-token');

      expect(result).toEqual({ workspace_id: 'ws-001', session_id: 'session-001', already_finalized: true, tokens: [] });
      expectTransactionCommitted(client);
    });

    it('rollback si les intentions sont insuffisantes', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'conception' }] },
        { rows: [{ id: 'item-001', product_id: 'p1', product_active: true, current_price_kmf: '5000', quantity: 1 }] },
        { rows: [], rowCount: 1 },
        { rows: [{ id: 'c1', intended_amount_kmf: '2000' }] },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('insufficient_intentions:2000<5000');
      expectTransactionRolledBack(client);
    });
  });

  describe('resumeWorkspace', () => {
    it('reprend une session terminee en conception', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-001', status: 'session_ended', order_id: null }] },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 2 },
        { rows: [], rowCount: 1 },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      const result = await resumeWorkspace('creator-token');

      expect(result).toEqual({ workspace_id: 'ws-001', status: 'conception' });
      expect(client.calls[2].sql).toContain("SET status = 'conception'");
      expect(client.calls[3].sql).toContain("SET status = 'intention'");
      expectTransactionCommitted(client);
    });

    it('refuse de reprendre un workspace deja lie a une commande', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-001', status: 'session_ended', order_id: 'order-001' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(resumeWorkspace('creator-token')).rejects.toThrow('workspace_locked_by_order');
      expectTransactionRolledBack(client);
    });
  });
});
