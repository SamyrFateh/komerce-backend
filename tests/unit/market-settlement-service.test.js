'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const service = require('../../services/market-settlement-service');

function executor() {
  return { query: jest.fn() };
}

const baseRow = {
  id: '00000000-0000-4000-8000-000000000010',
  market_id: '00000000-0000-4000-8000-000000000001',
  assignment_id: '00000000-0000-4000-8000-000000000002',
  amount: '125000.000000',
  currency: 'XAF',
  source: 'CENTRAL_ATTESTATION',
  status: 'READY',
  created_at: '2026-09-10T12:00:00Z',
  updated_at: '2026-09-10T12:00:00Z',
};

describe('market-settlement lifecycle owner', () => {
  test('normalise uniquement un montant positif décimal explicite', () => {
    expect(service.normalizeAmount('125000')).toBe('125000');
    expect(service.normalizeAmount('125000.50')).toBe('125000.50');
    for (const value of [null, '', '0', '-1', '1e6', 'abc']) {
      let caught = null;
      try {
        service.normalizeAmount(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'SETTLEMENT_AMOUNT_INVALID', status: 400 });
    }
  });

  test('READY dérive la devise du marché serveur et journalise CENTRAL_ATTESTATION', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ market_id: baseRow.market_id, market_code: 'CM', currency: 'XAF', assignment_id: baseRow.assignment_id, assignment_status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.createReadySettlement(db, {
      marketId: baseRow.market_id,
      assignmentId: baseRow.assignment_id,
      amount: '125000',
      actorUserId: '00000000-0000-4000-8000-000000000003',
      sourceReference: 'STATEMENT-2026-09',
    });

    expect(result.currency).toBe('XAF');
    expect(result.status).toBe('READY');
    const insertParams = db.query.mock.calls[1][1];
    expect(insertParams[3]).toBe('XAF');
    expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO market_settlement_events/);
    expect(db.query.mock.calls[2][1][2]).toBe('READY_ATTESTED');
  });

  test('finance.act owner transition ne fait que READY -> REQUESTED', async () => {
    const db = executor();
    const requested = { ...baseRow, status: 'REQUESTED', requested_by: 'u1', requested_at: '2026-09-10T13:00:00Z' };
    db.query
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rows: [requested] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.requestSettlement(db, {
      settlementId: baseRow.id,
      marketId: baseRow.market_id,
      assignmentId: baseRow.assignment_id,
      actorUserId: '00000000-0000-4000-8000-000000000004',
    });
    expect(result.before.status).toBe('READY');
    expect(result.after.status).toBe('REQUESTED');
    expect(db.query.mock.calls[1][0]).not.toMatch(/amount\s*=|currency\s*=/i);
  });

  test('PAID est impossible depuis READY et exige REQUESTED', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [baseRow] });
    await expect(service.markPaid(db, {
      settlementId: baseRow.id,
      actorUserId: '00000000-0000-4000-8000-000000000003',
      paymentReference: 'BANK-001',
    })).rejects.toMatchObject({ code: 'SETTLEMENT_TRANSITION_INVALID', status: 409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('un settlement hors assignment/marché retourne 404 sans fuite', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(service.confirmReceived(db, {
      settlementId: baseRow.id,
      marketId: '00000000-0000-4000-8000-000000000099',
      assignmentId: baseRow.assignment_id,
      actorUserId: '00000000-0000-4000-8000-000000000004',
    })).rejects.toMatchObject({ code: 'SETTLEMENT_NOT_FOUND', status: 404 });
  });

  test('le lifecycle owner ne contient aucune formule commission/revenue share', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-settlement-service.js'), 'utf8');
    expect(source).not.toMatch(/commission_rate|margin_share|revenue_share|amount_due\s*[=*]/i);
  });
});
