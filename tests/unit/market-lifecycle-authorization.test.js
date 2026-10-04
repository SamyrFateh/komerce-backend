'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const delegation = require('../../services/market-delegation-service');

const ROOT = path.join(__dirname, '..', '..');

describe('Market Control Plane M5 — delegated lifecycle authorization', () => {
  test('resolveAuthorization allows READ while suspended', async () => {
    const db = { query: jest.fn() };
    db.query
      .mockResolvedValueOnce({ rows: [{
        market_id:'m1', market_code:'KM', market_name:'Comores', currency:'KMF',
        lifecycle_status:'SUSPENDED', assignment_id:'a1', assignment_status:'ACTIVE',
      }]})
      .mockResolvedValueOnce({ rows: [{ id:'mem1', assignment_id:'a1', user_id:'u1', status:'ACTIVE' }]})
      .mockResolvedValueOnce({ rows: [{ capability:'finance.read' }]})
      .mockResolvedValueOnce({ rows: [{ effect:'READ' }]});

    await expect(delegation.resolveAuthorization(db, {
      userId:'u1', marketCode:'KM', requiredCapability:'finance.read',
    })).resolves.toMatchObject({ lifecycle_status:'SUSPENDED', membership_id:'mem1' });
  });

  test('resolveAuthorization refuses ACT while suspended', async () => {
    const db = { query: jest.fn() };
    db.query
      .mockResolvedValueOnce({ rows: [{
        market_id:'m1', market_code:'KM', market_name:'Comores', currency:'KMF',
        lifecycle_status:'SUSPENDED', assignment_id:'a1', assignment_status:'ACTIVE',
      }]})
      .mockResolvedValueOnce({ rows: [{ id:'mem1', assignment_id:'a1', user_id:'u1', status:'ACTIVE' }]})
      .mockResolvedValueOnce({ rows: [{ capability:'finance.act' }]})
      .mockResolvedValueOnce({ rows: [{ effect:'ACT' }]});

    await expect(delegation.resolveAuthorization(db, {
      userId:'u1', marketCode:'KM', requiredCapability:'finance.act',
    })).rejects.toMatchObject({ code:'MARKET_SUSPENDED', status:409 });
  });

  test('PROVISIONING and CLOSED are not delegated active markets', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-service.js'), 'utf8');
    expect(source).toContain("m.lifecycle_status IN ('ACTIVE','SUSPENDED')");
    expect(source).not.toMatch(/m\.is_active = TRUE/);
  });
});
