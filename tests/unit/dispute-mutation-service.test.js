'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const disputeMutation = require('../../services/dispute-mutation-service');

function executor() {
  return { query: jest.fn() };
}

describe('dispute-mutation-service (orders write boundary)', () => {
  test('listDisputesForMarket joint orders et scope au marché', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'open' }] });
    const rows = await disputeMutation.listDisputesForMarket('mkt-cm', db);
    expect(rows).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/JOIN orders o ON o\.id = d\.order_id/);
    expect(sql).toMatch(/WHERE o\.market_id = \$1/);
    expect(params).toEqual(['mkt-cm']);
  });

  test('getOwnedDispute renvoie null — jamais une erreur — pour un litige d’un autre marché', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cg', status: 'open' }] });
    const result = await disputeMutation.getOwnedDispute('d1', 'mkt-cm', db);
    expect(result).toBeNull();
  });

  test('updateDisputeWorkflow renvoie null sans écrire si le litige appartient à un autre marché', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cg', status: 'open' }] });
    const result = await disputeMutation.updateDisputeWorkflow('d1', 'mkt-cm', { status: 'processing' }, 'u1', db);
    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1); // uniquement la lecture
  });

  test('transition open -> resolved directe est refusée (409), aucun UPDATE émis', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'open' }] });
    await expect(disputeMutation.updateDisputeWorkflow('d1', 'mkt-cm', { status: 'resolved' }, 'u1', db))
      .rejects.toMatchObject({ code: 'DISPUTE_TRANSITION_INVALID', status: 409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('statut invalide est refusé (400), aucun UPDATE émis', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'open' }] });
    await expect(disputeMutation.updateDisputeWorkflow('d1', 'mkt-cm', { status: 'archived' }, 'u1', db))
      .rejects.toMatchObject({ code: 'DISPUTE_STATUS_INVALID', status: 400 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('transition open -> processing nominale, resolved_at reste inchangé', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'open', resolution: null }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/UPDATE disputes/);
      expect(params[1]).toBe('processing');
      expect(params[3]).toBe(false); // closesNow
      return { rows: [{ id: 'd1', status: 'processing' }] };
    });
    const result = await disputeMutation.updateDisputeWorkflow('d1', 'mkt-cm', { status: 'processing' }, 'u1', db);
    expect(result.after.status).toBe('processing');
  });

  test('transition processing -> resolved pose resolved_by/resolved_at, jamais refund_kmf/refund_eur', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'processing' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).not.toMatch(/refund_kmf\s*=/);
      expect(sql).not.toMatch(/refund_eur\s*=/);
      expect(params[3]).toBe(true); // closesNow
      expect(params[4]).toBe('u1'); // resolved_by
      return { rows: [{ id: 'd1', status: 'resolved', resolved_by: 'u1' }] };
    });
    const result = await disputeMutation.updateDisputeWorkflow('d1', 'mkt-cm', { status: 'resolved', resolution: 'Remboursé hors ligne' }, 'u1', db);
    expect(result.after.status).toBe('resolved');
  });

  test('le module ne contient aucune écriture SQL sur refund_kmf/refund_eur', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'dispute-mutation-service.js'), 'utf8');
    expect(source).not.toMatch(/SET[\s\S]*refund_kmf\s*=/);
    expect(source).not.toMatch(/SET[\s\S]*refund_eur\s*=/);
  });
});
