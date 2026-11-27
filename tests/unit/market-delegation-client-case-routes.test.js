'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-client-case.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('market-delegation client-case routes', () => {
  test('both routes are authenticated', () => {
    const routeDeclarations = routeSource.match(/router\.(get|post|put|delete)\([^\n]+/g) || [];
    expect(routeDeclarations).toHaveLength(2);
    expect(routeDeclarations.every(line => line.includes('authenticate'))).toBe(true);
  });

  test('refund_kmf/refund_eur are explicitly rejected from the request body', () => {
    expect(routeSource).toMatch(/REFUND_AUTHORITY_NOT_DELEGATED/);
    expect(routeSource).toMatch(/body\.refund_kmf/);
    expect(routeSource).toMatch(/body\.refund_eur/);
  });

  test('market_id/marketId supplied by client is rejected; marketCode is the only public locator', () => {
    expect(routeSource).toMatch(/MARKET_ID_FORBIDDEN/);
    expect(routeSource).toMatch(/body\.market_id/);
    expect(routeSource).toMatch(/body\.marketId/);
    expect(routeSource).toMatch(/markets\/:marketCode\/client-cases\/disputes/);
    expect(routeSource).not.toMatch(/markets\/:marketId\/client-cases/);
  });

  test('client-case workflow is capability based, never user role based', () => {
    expect(routeSource).toContain(`'client.case.handle'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
    expect(routeSource).not.toMatch(/req\.user\.role\s*===\s*['"]market_operator/);
  });

  test('no DELETE endpoint', () => {
    expect(routeSource).not.toMatch(/router\.delete/);
  });

  test('API is mounted exactly once at the composition root', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationClientCaseRouter = require\('\.\.\/routes\/market-delegation-client-case'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationClientCaseRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
  });
});

test('la consultation des litiges repose sur client.read, pas sur le droit de traitement',()=>{
  expect(routeSource).toContain("primaryCapability: 'client.read'");
  expect(routeSource).toContain("fallbackCapability: 'client.case.handle'");
  expect(routeSource).toContain("updateDisputeWorkflow(client");
});

test('canonical admin lens only opts into central READ for client.read',()=>{
  const source=require('fs').readFileSync(require('path').join(__dirname,'../../routes/market-delegation-client-case.js'),'utf8');
  const firstGet=source.indexOf('router.get(\'/markets/:marketCode/');
  const firstWrite=source.indexOf('router.post(',firstGet);
  expect(source.slice(firstGet,firstWrite<0?undefined:firstWrite)).toContain('resolveCanonicalMarketRead(resolveAuthorization, client, {');
  expect(source.slice(firstGet,firstWrite<0?undefined:firstWrite)).toContain("primaryCapability: 'client.read'");
});
