'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief Provisioning E2E Hub : environnement staging uniquement et cible de recette.
 */
const {checkEnv}=require('../../scripts/recette/staging-hub-e2e-market-grant');
function env(overrides={}){
  return {
    KOMERCE_ENV:'staging',
    E2E_STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
    HUB_MARKET_GRANT_MODE:'audit',
    E2E_ADMIN_EMAIL:'e2e-admin@komerce.test',E2E_ADMIN_PASSWORD:'AdminPassword123',
    E2E_MARKET_OPERATOR_EMAIL:'e2e-market@komerce.test',E2E_MARKET_OPERATOR_PASSWORD:'MarketPassword123',
    E2E_AGENT_HUB_EMAIL:'e2e-hub@komerce.test',E2E_AGENT_HUB_PASSWORD:'HubPassword123',
    ...overrides
  };
}
describe('E2E Hub scope least privilege boundary',()=>{
  test('mode audit autorisé avec un compte Hub strictement E2E',()=>{
    expect(checkEnv(env()).HUB_MARKET_GRANT_MODE).toBe('audit');
  });
  test('production ou URL externe rejetée avant toute requête',()=>{
    expect(()=>checkEnv(env({KOMERCE_ENV:'production'}))).toThrow('STAGING_ONLY');
    expect(()=>checkEnv(env({E2E_STAGING_BASE_URL:'https://komerce.co'}))).toThrow('STAGING_ONLY');
  });
  test('pas de grant vers une adresse réelle',()=>{
    expect(()=>checkEnv(env({E2E_AGENT_HUB_EMAIL:'personnel@example.com'}))).toThrow('HUB_E2E_ACCOUNT_NOT_DEDICATED');
  });
  test('aucun mode autre que audit/reconcile',()=>{
    expect(()=>checkEnv(env({HUB_MARKET_GRANT_MODE:'bootstrap'}))).toThrow('MODE_INVALID');
  });
});
