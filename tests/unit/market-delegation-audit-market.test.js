'use strict';

const fs = require('fs');
const path = require('path');
const { audit } = require('../../services/market-delegation-service');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Market Control Plane M2 — audit market identity', () => {
  test('migration 274 backfill market_id and enforces assignment/membership consistency', () => {
    const migration = read('migrations/274_market_delegation_audit_market.sql');

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets\(id\)/);
    expect(migration).toMatch(/SET market_id = assignment\.market_id/);
    expect(migration).toMatch(/enforce_market_delegation_audit_market/);
    expect(migration).toMatch(/conflicts with assignment market/);
    expect(migration).toMatch(/conflicts with membership market/);
    expect(migration).toMatch(/idx_market_delegation_audit_market/);
  });

  test('audit accepts a direct market before any assignment exists', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await audit(db, {
      marketId: '00000000-0000-0000-0000-000000000001',
      action: 'MARKET_PROVISIONING_STARTED',
      correlationId: 'provision-market-test',
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/actor_user_id, market_id, assignment_id/);
    expect(params[1]).toBe('00000000-0000-0000-0000-000000000001');
    expect(params[5]).toBe('MARKET_PROVISIONING_STARTED');
  });
});
