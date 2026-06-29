'use strict';

const internals = {
  db: { query: jest.fn() },
  _hashToken: jest.fn((token) => `hash:${token}`),
};

jest.mock('../../services/collective-workspace-internals', () => internals);

const {
  getWorkspaceByPublicToken,
  getWorkspaceByCreatorToken,
  getTokenInfo,
  deriveWorkspacePhase,
} = require('../../services/collective-workspace-reads');

describe('collective-workspace-reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    internals._hashToken.mockImplementation((token) => `hash:${token}`);
  });

  it('getWorkspaceByPublicToken retourne null si le public token est inconnu', async () => {
    internals.db.query.mockResolvedValueOnce({ rows: [] });

    await expect(getWorkspaceByPublicToken('WS-token')).resolves.toBeNull();
    expect(internals.db.query).toHaveBeenCalledWith(expect.stringContaining('public_token_hash = $1'), ['hash:WS-token']);
  });

  it('getWorkspaceByPublicToken assemble workspace, items, contributions et session active', async () => {
    const workspace = { id: 'ws-001', event_name: 'Mariage', status: 'conception' };
    const items = [{ id: 'item-001', product_name_snapshot: 'Riz' }];
    const contributions = [{ id: 'c-001', contributor_name: 'Ali', status: 'intention' }];
    const session = { id: 'session-001', status: 'open' };
    internals.db.query
      .mockResolvedValueOnce({ rows: [workspace] })
      .mockResolvedValueOnce({ rows: items })
      .mockResolvedValueOnce({ rows: contributions })
      .mockResolvedValueOnce({ rows: [session] });

    await expect(getWorkspaceByPublicToken('WS-token')).resolves.toEqual({
      workspace,
      items,
      contributions,
      session,
    });
    expect(internals.db.query.mock.calls[2][0]).toContain("status != 'cancelled'");
    expect(internals.db.query.mock.calls[3][0]).toContain("status IN ('open','ready_to_capture')");
  });

  it('getWorkspaceByCreatorToken retourne la ligne complete du createur', async () => {
    const workspace = { id: 'ws-001', creator_token_hash: 'hash:WC-token' };
    internals.db.query.mockResolvedValueOnce({ rows: [workspace] });

    await expect(getWorkspaceByCreatorToken('WC-token')).resolves.toBe(workspace);
    expect(internals.db.query).toHaveBeenCalledWith(expect.stringContaining('creator_token_hash = $1'), ['hash:WC-token']);
  });

  it('getTokenInfo retourne null si le token de paiement est inconnu', async () => {
    internals.db.query.mockResolvedValueOnce({ rows: [] });

    await expect(getTokenInfo('PT-token')).resolves.toBeNull();
  });

  it('deriveWorkspacePhase expose les phases produit stables', () => {
    expect(deriveWorkspacePhase({ status: 'order_created' })).toBe('order_created');
    expect(deriveWorkspacePhase({ status: 'paid' })).toBe('paid');
    expect(deriveWorkspacePhase({ status: 'session_ended' })).toBe('expired');
    expect(deriveWorkspacePhase({ status: 'cancelled' })).toBe('cancelled');
    expect(deriveWorkspacePhase({ status: 'payment_pending' }, { session: { amount_secured_kmf: 1000, total_to_pay_kmf: 5000 } })).toBe('partially_paid');
    expect(deriveWorkspacePhase({ status: 'payment_pending' }, { session: { amount_secured_kmf: 0, total_to_pay_kmf: 5000 } })).toBe('payment_pending');
    expect(deriveWorkspacePhase({ status: 'conception' }, { items: [], contributions: [] })).toBe('draft');
    expect(deriveWorkspacePhase({ status: 'conception' }, { items: [{ id: 'item-1' }], contributions: [] })).toBe('collecting');
    expect(deriveWorkspacePhase({ status: 'conception' }, { items: [], contributions: [{ id: 'c1' }] })).toBe('reviewing');
  });
});
