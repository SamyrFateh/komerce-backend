'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { assertAllowed, run, ACTORS, PROBES } = require('../../scripts/recette/staging-negative-role-boundaries');
const config = {
  NODE_ENV:'test', KOMERCE_ENV:'staging', EXPECTED_RAILWAY_ENVIRONMENT:'staging',
  STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
  NEGATIVE_ROLE_CONFIRMATION:'CERTIFY-ROLE-REFUSALS',
  E2E_ADMIN_EMAIL:'admin@e2e.test', E2E_ADMIN_PASSWORD:'test-secret',
  E2E_AGENT_HUB_EMAIL:'hub@e2e.test', E2E_AGENT_HUB_PASSWORD:'test-secret',
  E2E_AGENT_TRANSITAIRE_EMAIL:'transitaire@e2e.test', E2E_AGENT_TRANSITAIRE_PASSWORD:'test-secret',
  E2E_AGENT_RELAIS_EMAIL:'relais@e2e.test', E2E_AGENT_RELAIS_PASSWORD:'test-secret',
};
function fakeFetch(leak) {
  return jest.fn(async (url, options) => {
    if (url.endsWith('/api/auth/login')) {
      const body=JSON.parse(options.body), actor=ACTORS.find(a=>config['E2E_'+a.prefix+'_EMAIL']===body.email);
      return { status:200, json: async()=>({user:{role:actor.role}}),
        headers:{get:()=> 'session='+actor.name+'; HttpOnly'} };
    }
    const actor=options.headers.cookie.replace('session=','');
    const probe=PROBES.find(p=>url.endsWith(p.path) && p.method===options.method);
    if (!probe) throw new Error('Unexpected path or method '+url);
    const expected=probe[actor];
    return {status:leak && leak({actor,probe}) || expected};
  });
}
describe('staging role boundary guards', () => {
  test('refuse toute autre cible ou confirmation',()=>{
    expect(assertAllowed(config)).toBe(true);
    for(const patch of [
      {NODE_ENV:'production'}, {KOMERCE_ENV:'production'},
      {STAGING_BASE_URL:'https://komerce.co'},
      {EXPECTED_RAILWAY_ENVIRONMENT:'production'},
      {NEGATIVE_ROLE_CONFIRMATION:'BAD'},
    ])expect(()=>assertAllowed({...config,...patch})).toThrow();
  });
  test('aucun PUT de tarif administratif par admin, aucune référence métier réelle',()=>{
    const put=PROBES.find(p=>p.method==='PUT');
    expect(put).toBeTruthy();
    expect(Object.hasOwn(put,'admin')).toBe(false);
    const hubShip=PROBES.find(p=>p.name==='hub_ship_absent');
    expect(hubShip.admin).toBe(403); // admin central: pas de bypass execution implicite
    expect(hubShip.hub).toBe(404);   // agent Hub autorisé, colis inexistant
    expect(PROBES.filter(p=>p.method==='POST').every(p=>p.path.includes('00000000-0000-4000-8000-000000000000')||p.path.includes('ISOLATION-PROBE-NONEXISTENT'))).toBe(true);
  });
  test('37 sondes attendues avec rôles réels, aucun acte persistant',async()=>{
    const api=fakeFetch();
    const result=await run({env:config,fetchImpl:api});
    expect(result.verdict).toBe('ROLE_BOUNDARY_PASS');
    expect(result.checks).toBe(37);
    expect(result.violations).toHaveLength(0);
  });
  test('une fuite Hub au transitaire rend le verdict rouge',async()=>{
    const api=fakeFetch(({actor,probe})=>actor==='transitaire'&&probe.name==='hub_dashboard'?200:null);
    const r=await run({env:config,fetchImpl:api});
    expect(r.verdict).toBe('ROLE_BOUNDARY_FAIL');
    expect(r.violations).toEqual(expect.arrayContaining([expect.objectContaining({role:'transitaire',probe:'hub_dashboard'})]));
  });
  test('une fuite de modification tarif au relais rend le verdict rouge',async()=>{
    const api=fakeFetch(({actor,probe})=>actor==='relais'&&probe.name==='forbidden_transport_price_write'?400:null);
    expect((await run({env:config,fetchImpl:api})).verdict).toBe('ROLE_BOUNDARY_FAIL');
  });
});
