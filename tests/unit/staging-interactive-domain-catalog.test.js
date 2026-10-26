'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {DOMAINS,interactiveRoutes}=
  require('../../tests/staging-interactive/domain-catalog');
const {pages}=require('../../tests/staging-canonical/matrix');

describe('local interactive staging domain catalog (read-only views)',()=>{
  test('all declared screens originate from the canonical full navigation matrix',()=>{
    const known=new Set(Object.values(pages).flat());
    for(const [domain,routes]of Object.entries(DOMAINS)){
      expect(routes.length).toBeGreaterThan(0);
      for(const route of routes){
        expect(route).toMatch(/^\/(admin|dashboards\/canonical)\//);
        expect(known.has(route)).toBe(true);
      }
    }
  });
  test('Finance only sees Finance/Accounting and not Admin or other markets',()=>{
    expect(interactiveRoutes('finance','finance')).toEqual([
      {domain:'finance',route:'/admin/workspaces/accounting'}
    ]);
    expect(interactiveRoutes('finance','administration')).toEqual([]);
    expect(interactiveRoutes('finance','sourcing')).toEqual([]);
  });
  test('Sourcing has its specific screens without adding dashboard Pilotage',()=>{
    expect(interactiveRoutes('sourcing','sourcing')).toEqual([
      {domain:'sourcing',route:'/admin/workspaces/sourcing'},
      {domain:'sourcing',route:'/admin/import-runtime'}
    ]);
    expect(interactiveRoutes('sourcing','pilotage')).toEqual([]);
    expect(interactiveRoutes('sourcing','raffinerie')).toEqual([
      {domain:'raffinerie',route:'/admin/import-runtime'}
    ]);
  });
  test('Hub and Relay route scopes differ',()=>{
    expect(interactiveRoutes('agent_hub','operations').map(x=>x.route))
      .toEqual(['/admin/workspaces/operations','/admin/hub-live']);
    expect(interactiveRoutes('agent_relais','operations').map(x=>x.route))
      .toEqual(['/admin/workspaces/operations','/admin/relais-live']);
    expect(interactiveRoutes('agent_transitaire','transit')).toEqual([
      {domain:'transit',route:'/admin/workspaces/shipping-customs'}
    ]);
  });
  test('Operator sees market autonomy; no administrative user management',()=>{
    expect(interactiveRoutes('market_operator','marches')).toEqual([
      {domain:'marches',route:'/dashboards/canonical/market-autonomy.html'}
    ]);
    expect(interactiveRoutes('market_operator','administration')).toEqual([]);
  });
  test('invalid role or domain refuses immediately; all is explicit',()=>{
    expect(()=>interactiveRoutes('client','all')).toThrow('UNKNOWN_E2E_ROLE');
    expect(()=>interactiveRoutes('admin','pay-now')).toThrow('UNKNOWN_E2E_DOMAIN');
    const adminRoutes=interactiveRoutes('admin','all');
    expect(adminRoutes).toContainEqual({domain:'pilotage',route:'/admin/pilotage'});
    expect(adminRoutes).toContainEqual({domain:'finance',route:'/admin/workspaces/accounting'});
  });
});
