'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const delegation = require('../../services/market-delegation-service');

function executor(sequence) {
  return {
    query: jest.fn(async () => {
      if (!sequence.length) throw new Error('unexpected query');
      return sequence.shift();
    }),
  };
}

describe('D1 transitaire authority', () => {
  test('resolveSingleMarketAuthorization retourne l unique marché autorisé', async () => {
    const row = {
      market_id: 'm1', market_code: 'CM', assignment_id: 'a1',
      membership_id: 'mem1', membership_user_id: 'u1', has_capability: true,
    };
    const db = executor([{ rows: [row] }]);
    await expect(delegation.resolveSingleMarketAuthorization(db, {
      userId: 'u1', requiredCapability: 'logistics.read',
    })).resolves.toEqual({
      market_id: 'm1', market_code: 'CM', assignment_id: 'a1',
      membership_id: 'mem1', membership_user_id: 'u1',
    });
  });

  test('aucune capability active => refus 403', async () => {
    const db = executor([{ rows: [] }]);
    await expect(delegation.resolveSingleMarketAuthorization(db, {
      userId: 'u1', requiredCapability: 'logistics.read',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });
  });

  test('membership unique sans capability => refus 403', async () => {
    const db = executor([{ rows: [{
      market_id: 'm1', market_code: 'CM', assignment_id: 'a1',
      membership_id: 'mem1', membership_user_id: 'u1', has_capability: false,
    }] }]);
    await expect(delegation.resolveSingleMarketAuthorization(db, {
      userId: 'u1', requiredCapability: 'execution.transit.confirm',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });
  });

  test('plus d un marché actif => refus fort', async () => {
    const db = executor([{ rows: [
      { market_id: 'm1', market_code: 'CM' },
      { market_id: 'm2', market_code: 'CG' },
    ] }]);
    await expect(delegation.resolveSingleMarketAuthorization(db, {
      userId: 'u1', requiredCapability: 'logistics.read',
    })).rejects.toMatchObject({ code: 'MARKET_SINGLE_ASSIGNMENT_REQUIRED', status: 409 });
  });

  test('addMembership refuse un second marché actif pour agent_transitaire', async () => {
    const db = executor([
      { rows: [] },
      { rows: [{ role: 'agent_transitaire', has_other_active_market: true }] },
    ]);
    await expect(delegation.addMembership(db, {
      assignmentId: 'a2',
      userId: 'u1',
      actorUserId: 'admin1',
      actorIsCentral: true,
      capabilities: ['logistics.read'],
    })).rejects.toMatchObject({ code: 'TRANSITAIRE_MARKET_MEMBERSHIP_CONFLICT', status: 409 });
  });
});
