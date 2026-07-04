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

describe('collective-workspace-lifecycle — Lot A, branches manquantes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInternals._generateToken.mockReturnValue('PT-token-001');
    mockInternals._hashToken.mockImplementation((token) => `hash:${token}`);
  });

  describe('finalizeWorkspace — préconditions', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('status ni conception ni payment_pending → workspace_not_in_conception', async () => {
      const client = makeClient([{ rows: [{ id: 'ws-1', status: 'session_ended' }] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('workspace_not_in_conception');
      expectTransactionRolledBack(client);
    });

    it('aucun item → no_items', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception' }] },
        { rows: [] },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('no_items');
      expectTransactionRolledBack(client);
    });

    it('produit désactivé dans le panier → product_inactive:<id>', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception' }] },
        { rows: [{ id: 'i1', product_id: 'p1', product_active: false, current_price_kmf: '100', quantity: 1 }] },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('product_inactive:p1');
      expectTransactionRolledBack(client);
    });

    it('total recalculé <= 0 → total_invalid', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception' }] },
        { rows: [{ id: 'i1', product_id: null, product_active: null, current_price_kmf: null, quantity: 1 }] },
        { rows: [] }, // UPDATE snapshot de l'item (boucle exécutée avant le check total)
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('total_invalid');
      expectTransactionRolledBack(client);
    });

    it('aucune contribution → no_contributions', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception' }] },
        { rows: [{ id: 'i1', product_id: 'p1', product_active: true, current_price_kmf: '1000', quantity: 1 }] },
        { rows: [] }, // UPDATE snapshot
        { rows: [] }, // SELECT contributions → vide
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(finalizeWorkspace('creator-token')).rejects.toThrow('no_contributions');
      expectTransactionRolledBack(client);
    });
  });

  describe('finalizeWorkspace — succès (chemin complet)', () => {
    it('financement exact (intendedSum === total) → 1 token, montant = intention brute', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception' }] },                            // SELECT ws
        { rows: [{ id: 'item-1', product_id: 'p1', product_active: true,
                   current_price_kmf: '1000', quantity: 2,
                   current_name: 'Riz', current_image: null }] },                     // SELECT items
        { rows: [] },                                                                 // UPDATE snapshot item-1
        { rows: [{ id: 'c1', intended_amount_kmf: '2000',
                   contributor_name: 'Ali', contributor_phone: '269000', contributor_email: 'ali@x.km' }] }, // SELECT contributions
        { rows: [{ id: 'sess-1' }] },                                                 // INSERT session RETURNING
        { rows: [] },                                                                 // INSERT token c1
        { rows: [] },                                                                 // UPDATE contribution c1 → converted
        { rows: [] },                                                                 // UPDATE workspace → payment_pending
        { rows: [] },                                                                 // logEvent → client.query
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      const result = await finalizeWorkspace('creator-token', { duration_hours: 48 });

      expect(result.workspace_id).toBe('ws-1');
      expect(result.session_id).toBe('sess-1');
      expect(result.total_kmf).toBe(2000);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]).toEqual(expect.objectContaining({
        contributor_name: 'Ali',
        amount_kmf: 2000,
        payment_token: 'PT-token-001',
        payment_url_path: '/api/collective-payments/PT-token-001',
        payment_page_url: '/event/pay/PT-token-001',
      }));
      expect(mockInternals.logEvent).toHaveBeenCalledWith(client, 'ws-1', 'workspace_finalized', 'creator', null,
        expect.objectContaining({ session_id: 'sess-1', total_kmf: 2000, tokens_count: 1 }));
      expectTransactionCommitted(client);
    });

    it('sur-financement (intendedSum > total) → répartition proportionnelle, arrondi sur la dernière contribution', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-2', status: 'conception' }] },
        { rows: [{ id: 'item-1', product_id: 'p1', product_active: true,
                   current_price_kmf: '1000', quantity: 1,
                   current_name: 'Sucre', current_image: null }] },
        { rows: [] }, // UPDATE snapshot
        { rows: [
            { id: 'c1', intended_amount_kmf: '800', contributor_name: 'Ali', contributor_phone: null, contributor_email: null },
            { id: 'c2', intended_amount_kmf: '800', contributor_name: 'Fatima', contributor_phone: null, contributor_email: null },
          ] }, // SELECT contributions — total intentions 1600 > total 1000
        { rows: [{ id: 'sess-2' }] }, // INSERT session
        { rows: [] }, // INSERT token c1
        { rows: [] }, // UPDATE contribution c1
        { rows: [] }, // INSERT token c2
        { rows: [] }, // UPDATE contribution c2
        { rows: [] }, // UPDATE workspace → payment_pending
        { rows: [] }, // logEvent
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      const result = await finalizeWorkspace('creator-token');

      expect(result.total_kmf).toBe(1000);
      expect(result.tokens).toHaveLength(2);
      // c1 (pas dernière) : floor(800 * 1000/1600) = 500
      expect(result.tokens[0].amount_kmf).toBe(500);
      // c2 (dernière) : total - assignedSum = 1000 - 500 = 500 (absorbe l'arrondi)
      expect(result.tokens[1].amount_kmf).toBe(500);
      expectTransactionCommitted(client);
    });
  });

  describe('resumeWorkspace — branches manquantes', () => {
    it('workspace introuvable → ROLLBACK + workspace_not_found', async () => {
      const client = makeClient([{ rows: [] }]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(resumeWorkspace('creator-token')).rejects.toThrow('workspace_not_found');
      expectTransactionRolledBack(client);
    });

    it('status différent de session_ended (garde 2) → workspace_not_resumable:<status>', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'conception', order_id: null }] },
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(resumeWorkspace('creator-token')).rejects.toThrow('workspace_not_resumable:conception');
      expectTransactionRolledBack(client);
    });

    it('garde SQL (defense in depth) échoue — race condition → workspace_locked_by_order', async () => {
      const client = makeClient([
        { rows: [{ id: 'ws-1', status: 'session_ended', order_id: null }] }, // SELECT FOR UPDATE
        { rows: [], rowCount: 0 }, // UPDATE conception — 0 ligne affectée (race condition)
      ]);
      mockInternals.db.pool.connect.mockResolvedValue(client);

      await expect(resumeWorkspace('creator-token')).rejects.toThrow('workspace_locked_by_order');
      expectTransactionRolledBack(client);
    });
  });
});
