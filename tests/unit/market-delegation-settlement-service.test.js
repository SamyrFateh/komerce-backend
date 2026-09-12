'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const service = require('../../services/market-delegation-settlement-service');

function executor() { return { query: jest.fn() }; }

const ids = {
  market: '00000000-0000-4000-8000-000000000001',
  assignment: '00000000-0000-4000-8000-000000000002',
  membership: '00000000-0000-4000-8000-000000000003',
  user: '00000000-0000-4000-8000-000000000004',
  settlement: '00000000-0000-4000-8000-000000000005',
};

function mockAuthz(db, capabilities) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: ids.market, market_code: 'CM', market_name: 'Cameroun', currency: 'XAF', assignment_id: ids.assignment, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: ids.membership, assignment_id: ids.assignment, user_id: ids.user, status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
}

describe('market-delegation settlement orchestration', () => {
  test('finance.act demande un READY du même assignment et audite la capability', async () => {
    const db = executor();
    mockAuthz(db, ['finance.act', 'finance.read']);
    const ready = { id: ids.settlement, market_id: ids.market, assignment_id: ids.assignment, amount: '1000', currency: 'XAF', source: 'CENTRAL_ATTESTATION', status: 'READY' };
    const requested = { ...ready, status: 'REQUESTED', requested_by: ids.user, requested_at: '2026-09-10T13:00:00Z' };
    db.query
      .mockResolvedValueOnce({ rows: [ready] })
      .mockResolvedValueOnce({ rows: [requested] })
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(async (sql, params) => {
        expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
        expect(params[3]).toBe('finance.act');
        expect(params[4]).toBe('SETTLEMENT_REQUESTED');
        return { rows: [] };
      });

    const result = await service.requestSettlement(db, {
      marketCode: 'CM', actorUserId: ids.user, settlementId: ids.settlement,
    });
    expect(result.status).toBe('REQUESTED');
  });

  test('finance.act absent => 403 avant toute mutation settlement', async () => {
    const db = executor();
    mockAuthz(db, ['finance.read']);
    await expect(service.requestSettlement(db, {
      marketCode: 'CM', actorUserId: ids.user, settlementId: ids.settlement,
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('settlement.receive est distinct de finance.act', async () => {
    const db = executor();
    mockAuthz(db, ['finance.act']);
    await expect(service.confirmSettlementReceived(db, {
      marketCode: 'CM', actorUserId: ids.user, settlementId: ids.settlement,
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });
  });

  test('la couche market-delegation ne porte aucun SQL financier direct', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-settlement-service.js'), 'utf8');
    expect(source).not.toMatch(/INSERT INTO market_settlements|UPDATE market_settlements|DELETE FROM market_settlements/i);
    expect(source).toMatch(/requiredCapability: 'finance\.act'/);
    expect(source).toMatch(/requiredCapability: 'settlement\.receive'/);
  });
});
