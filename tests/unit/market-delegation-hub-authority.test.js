'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const delegation = require('../../services/market-delegation-service');

function executor(rows) {
  return { query: jest.fn(async () => ({ rows })) };
}

describe('D4 Hub authority', () => {
  test('listAuthorizedMarketsForCapability ne retourne que les memberships actives sous ceiling actif', async () => {
    const db = executor([
      {
        market_id: 'm-cm',
        market_code: 'CM',
        market_name: 'Cameroun',
        currency: 'XAF',
        assignment_id: 'a-cm',
        membership_id: 'mem-cm',
      },
    ]);

    const rows = await delegation.listAuthorizedMarketsForCapability(db, {
      userId: 'u1',
      requiredCapability: 'operations.read',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ market_id: 'm-cm', market_code: 'CM' });
    expect(db.query.mock.calls[0][0]).toMatch(/JOIN membership_capabilities mc/);
    expect(db.query.mock.calls[0][0]).toMatch(/JOIN assignment_capability_ceiling acc/);
    expect(db.query.mock.calls[0][0]).toMatch(/am\.status = 'ACTIVE'/);
    expect(db.query.mock.calls[0][1]).toEqual(['u1', 'operations.read']);
  });

  test('aucun droit operations.read => aucune autorité marché', async () => {
    const db = executor([]);
    await expect(delegation.listAuthorizedMarketsForCapability(db, {
      userId: 'u1',
      requiredCapability: 'operations.read',
    })).resolves.toEqual([]);
  });

  test('Hub et Hub Dashboard ne consomment plus require-market-scope', () => {
    const root = path.join(__dirname, '..', '..');
    for (const rel of ['routes/hub.js', 'routes/hub-dashboard.js']) {
      const source = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(source).not.toMatch(/require\(['"][^'"]*require-market-scope/);
      expect(source).not.toMatch(/attachAuthorizedMarketsForOperator/);
      expect(source).toContain('operations.read');
    }
    const dashboard = fs.readFileSync(path.join(root, 'routes/hub-dashboard.js'), 'utf8');
    expect(dashboard).toContain('hub.supervise');
  });
});
