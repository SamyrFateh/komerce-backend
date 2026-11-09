'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const path=require('path');
const {KNOWN_CANONICAL_ALIASES,expectedPath,resolveNavigationHttp}=
  require('../../tests/staging-canonical/navigation-audit-policy');

test('les trois alias opérationnels proviennent de la déclaration serveur canonique',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','..','bootstrap','html-routes.js'),'utf8');
  for(const [legacy,canonical]of Object.entries(KNOWN_CANONICAL_ALIASES)){
    const declaration=`'${legacy}': '${canonical}'`;
    expect(source).toContain(declaration);
  }
});
test('rediriger vers Opérations est nominal et non un WRONG_ROUTE',()=>{
  expect(expectedPath('/admin/orders-logistics')).toBe('/admin/operations');
  expect(expectedPath('/admin/orders-logistics?status=active')).toBe('/admin/operations');
  expect(expectedPath('/admin/hub-relais')).toBe('/admin/workspaces/operations');
});
test('redirection Operations tenant compte du rôle, sans masquer les refus de droits',()=>{
  const origin='https://komerce-backend-production.up.railway.app';
  expect(expectedPath('/admin/workspaces/operations',origin,{role:'agent_hub'})).toBe('/admin/hub-live');
  expect(expectedPath('/admin/workspaces/operations',origin,{role:'agent_relais'})).toBe('/admin/relais-live');
  expect(expectedPath('/admin/workspaces/operations',origin,{role:'admin'})).toBe('/admin/hub-live');
  expect(expectedPath('/admin/workspaces/operations',origin,{role:'market_operator'})).toBe('/admin/hub-live');
  expect(expectedPath('/admin/workspaces/operations',origin,{role:'finance'})).toBe('/admin/workspaces/operations');
  expect(expectedPath('/admin/hub-live',origin,{role:'agent_hub'})).toBe('/admin/hub-live');
  expect(expectedPath('/admin/relais-live',origin,{role:'agent_relais'})).toBe('/admin/relais-live');
});
test('Sourcing Live remplace le workspace historique uniquement pour ses acteurs autorisés',()=>{
  const origin='https://komerce-backend-production.up.railway.app';
  for(const role of ['admin','sourcing'])
    expect(expectedPath('/admin/workspaces/sourcing',origin,{role})).toBe('/admin/import-runtime');
  for(const role of ['finance','agent_relais','market_operator'])
    expect(expectedPath('/admin/workspaces/sourcing',origin,{role})).toBe('/admin/workspaces/sourcing');
});

test('legacy=1 désactive le traitement d alias',()=>{
  expect(expectedPath('/admin/orders-logistics?legacy=1')).toBe('/admin/orders-logistics');
});
test('une route produit inconnue ne peut pas être classée comme alias nominal',()=>{
  expect(expectedPath('/admin/products/KPR-000094')).toBe('/admin/products/KPR-000094');
  expect(expectedPath('/admin/orders/AUDIT-ND5VE6-NORMAL')).toBe('/admin/orders/AUDIT-ND5VE6-NORMAL');
});
test('origines externes refusées',()=>{
  expect(()=>expectedPath('https://example.org/admin/orders-logistics')).toThrow('OUT_OF_SCOPE_NAVIGATION_ORIGIN');
});

test('client redirect legacy : destination canonique prouvée par son vrai HTTP 200',async()=>{
  const readFinalStatus=jest.fn(async()=>200);
  const proof=await resolveNavigationHttp({
    entryResponse:null,source:'/admin/workspaces/operations',
    actual:'/admin/hub-live',expected:'/admin/hub-live',readFinalStatus,
  });
  expect(proof).toEqual({status:200,proof:'canonical_final_response'});
  expect(readFinalStatus).toHaveBeenCalledWith('/admin/hub-live');
});

test.each([401,403,404,500])('client redirect : HTTP %s final reste non certifié',async status=>{
  const proof=await resolveNavigationHttp({
    entryResponse:null,source:'/admin/workspaces/operations',
    actual:'/admin/hub-live',expected:'/admin/hub-live',
    readFinalStatus:async()=>status,
  });
  expect(proof.status).toBe(status);
  expect(proof.status).not.toBe(200);
});

test('rediriger ailleurs que la destination attendue ne déclenche aucune requête de validation',async()=>{
  const readFinalStatus=jest.fn(async()=>200);
  const proof=await resolveNavigationHttp({
    entryResponse:null,source:'/admin/workspaces/operations',
    actual:'/',expected:'/admin/hub-live',readFinalStatus,
  });
  expect(proof.status).toBeNull();
  expect(proof.proof).toBe('unverified_navigation');
  expect(readFinalStatus).not.toHaveBeenCalled();
});

test('URL non redirigée sans HTTP initial reste non certifiée',async()=>{
  const readFinalStatus=jest.fn(async()=>200);
  const proof=await resolveNavigationHttp({
    entryResponse:null,source:'/admin/hub-live',
    actual:'/admin/hub-live',expected:'/admin/hub-live',readFinalStatus,
  });
  expect(proof.status).toBeNull();
  expect(readFinalStatus).not.toHaveBeenCalled();
});

test('HTTP initial 403 n’est jamais écrasé par un statut secondaire 200',async()=>{
  const readFinalStatus=jest.fn(async()=>200);
  const proof=await resolveNavigationHttp({
    entryResponse:{status:()=>403},source:'/admin/workspaces/operations',
    actual:'/admin/hub-live',expected:'/admin/hub-live',readFinalStatus,
  });
  expect(proof).toEqual({status:403,proof:'entry_response'});
  expect(readFinalStatus).not.toHaveBeenCalled();
});

test('échec du contrôle final conserve un verdict HTTP non prouvé',async()=>{
  const proof=await resolveNavigationHttp({
    entryResponse:null,source:'/admin/workspaces/operations',
    actual:'/admin/hub-live',expected:'/admin/hub-live',
    readFinalStatus:async()=>{throw Error('network down');},
  });
  expect(proof).toEqual({status:null,proof:'canonical_final_unavailable'});
});
