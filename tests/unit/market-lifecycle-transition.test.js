'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { transitionMarketLifecycle, ALLOWED_TRANSITIONS } = require('../../services/market-lifecycle-service');

describe('market lifecycle writer — transitions', () => {
  test('transition matrix is explicit and CLOSED is terminal', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      PROVISIONING:['ACTIVE','CLOSED'],
      ACTIVE:['SUSPENDED','CLOSED'],
      SUSPENDED:['ACTIVE','CLOSED'],
      CLOSED:[],
    });
  });

  test('writer updates lifecycle_status and compatibility is_active together', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows:[{ id:'m1', code:'GA', lifecycle_status:'PROVISIONING', is_active:false }] })
      .mockResolvedValueOnce({ rows:[{ id:'m1', code:'GA', lifecycle_status:'ACTIVE', is_active:true }] }) };
    await expect(transitionMarketLifecycle(db, {
      marketCode:'GA', targetStatus:'ACTIVE',
    })).resolves.toMatchObject({ changed:true, after:{ lifecycle_status:'ACTIVE', is_active:true } });
    expect(db.query.mock.calls[1][0]).toMatch(/SET lifecycle_status=\$2,[\s\S]*is_active=\$3/);
  });

  test('forbidden transition fails closed before UPDATE', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows:[{ id:'m1', code:'GA', lifecycle_status:'CLOSED', is_active:false }] }) };
    await expect(transitionMarketLifecycle(db, {
      marketCode:'GA', targetStatus:'ACTIVE',
    })).rejects.toMatchObject({ code:'MARKET_LIFECYCLE_TRANSITION_FORBIDDEN', status:409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
