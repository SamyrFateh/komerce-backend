'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const clientCase = require('../../services/market-delegation-client-case-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['client.case.handle'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

describe('market-delegation client-case service — capabilities et audit', () => {
  test('faire avancer le statut appelle la frontière disputes avec le marché résolu serveur et audite CLIENT_CASE_WORKFLOW_UPDATED', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'open' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/UPDATE disputes/);
      expect(sql).not.toMatch(/refund_kmf\s*=/);
      expect(sql).not.toMatch(/refund_eur\s*=/);
      return { rows: [{ id: 'd1', status: 'processing', refund_kmf: 0, refund_eur: 0 }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('CLIENT_CASE_WORKFLOW_UPDATED');
      return { rows: [] };
    });

    const result = await clientCase.updateDisputeWorkflow(db, {
      marketCode: 'CM', actorUserId: 'u1', disputeId: 'd1', status: 'processing',
    });
    expect(result.status).toBe('processing');
  });

  test('capability absente → 403, aucune écriture tentée', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });

    await expect(clientCase.updateDisputeWorkflow(db, {
      marketCode: 'CM', actorUserId: 'u1', disputeId: 'd1', status: 'processing',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('CM ne peut jamais faire avancer un litige appartenant à CG (404, pas de fuite d’existence)', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd-cg', market_id: 'mkt-cg', status: 'open' }] });

    await expect(clientCase.updateDisputeWorkflow(db, {
      marketCode: 'CM', actorUserId: 'u1', disputeId: 'd-cg', status: 'processing',
    })).rejects.toMatchObject({ code: 'CLIENT_CASE_NOT_FOUND', status: 404 });
  });

  test('transition invalide propage le code et le statut HTTP de la frontière (409)', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', market_id: 'mkt-cm', status: 'open' }] });

    await expect(clientCase.updateDisputeWorkflow(db, {
      marketCode: 'CM', actorUserId: 'u1', disputeId: 'd1', status: 'resolved',
    })).rejects.toMatchObject({ code: 'DISPUTE_TRANSITION_INVALID', status: 409 });
  });

  test('aucune promotion de users.role, aucune écriture directe sur disputes.refund_kmf/refund_eur', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-client-case-service.js'), 'utf8');
    expect(source).not.toMatch(/users\.role/);
    expect(source).not.toMatch(/refund_kmf\s*=/);
    expect(source).not.toMatch(/refund_eur\s*=/);
    expect(source).not.toMatch(/UPDATE disputes/i);
  });
});
