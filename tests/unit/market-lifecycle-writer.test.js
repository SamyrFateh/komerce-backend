'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const lifecycle = require('../../services/market-lifecycle-service');

const ROOT = path.join(__dirname, '..', '..');

describe('market lifecycle writer — provisioning', () => {
  test('creates only PROVISIONING and never grants authority', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id:'m1', code:'GA', name:'Gabon', currency:'XAF', minor_unit:0,
        is_active:false, lifecycle_status:'PROVISIONING', storefront_texts:{},
      }]}) };
    const market = await lifecycle.createProvisioningMarket(db, {
      code:'ga', name:'Gabon', currency:'xaf', minorUnit:0,
    });
    expect(market.lifecycle_status).toBe('PROVISIONING');
    const insert = db.query.mock.calls[1][0];
    expect(insert).toMatch(/FALSE,'PROVISIONING'/);
    expect(insert).not.toMatch(/assignment_memberships|membership_capabilities/);
  });

  test('refuses duplicate market code before INSERT', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows:[{id:'m1'}] }) };
    await expect(lifecycle.createProvisioningMarket(db, {
      code:'KM', name:'Comores', currency:'KMF',
    })).rejects.toMatchObject({ code:'MARKET_ALREADY_EXISTS', status:409 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
