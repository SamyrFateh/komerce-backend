/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { mountHtmlRoutes } = require('../../bootstrap/html-routes');

const countries = [
  ['KM','Comores','KMF'], ['CM','Cameroun','XAF'], ['CG','Congo','XAF'],
  ['DJ','Djibouti','DJF'], ['YT','Mayotte','EUR'], ['GA','Gabon','XAF'],
];
function setup(rows = countries.map(([code,name,currency])=>({
  code,name,currency,minor_unit:0,is_active:true,lifecycle_status:'ACTIVE',storefront_texts:{}
}))) {
  const app=express();
  const query=jest.fn().mockResolvedValue({rows});
  mountHtmlRoutes(app,path.join(__dirname,'../..'),{query});
  return {app,query};
}

const fs=require('fs');
const serverSource=fs.readFileSync(path.join(__dirname,'../..','server.js'),'utf8');

describe('Routes publiques des catalogues pays dynamiques (PostgreSQL)',()=>{
  test('la garde des entrées statiques précède express.static',()=>{
    const guard=serverSource.indexOf("app.get(['/', '/boutique', '/boutique/', '/boutique/index.html']");
    const staticMount=serverSource.indexOf("app.use(express.static(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(staticMount);
    expect(serverSource).toContain("app.get('/boutique/js/market-registry.js'");
  });

  test.each(countries)('/%s retourne la boutique pour un marché ACTIVE',async code=>{
    const {app}=setup();const res=await request(app).get('/'+code);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/boutique/js/market-registry.js');
  });
  test('nouveau pays accepté sans code applicatif nouveau, URL canonique respectée',async()=>{
    const {app}=setup();
    expect((await request(app).get('/ga?tab=shop')).headers.location).toBe('/GA?tab=shop');
    expect((await request(app).get('/YT/')).headers.location).toBe('/YT');
  });
  test.each(['PROVISIONING','SUSPENDED','CLOSED'])('un marché %s n est jamais servi',async lifecycle_status=>{
    const rows=[{code:'GA',name:'Gabon',currency:'XAF',minor_unit:0,is_active:lifecycle_status!=='PROVISIONING',lifecycle_status,storefront_texts:{}}];
    const {app}=setup(rows);
    expect((await request(app).get('/GA')).status).toBe(404);
    expect((await request(app).get('/ga')).status).toBe(404);
    expect((await request(app).get('/boutique?market=GA')).status).toBe(404);
  });
  test('code inconnu et alias non autorisé: 404; ancienne URL KM fonctionne',async()=>{
    const {app}=setup();
    expect((await request(app).get('/FR')).status).toBe(404);
    expect((await request(app).get('/boutique?market=FR')).status).toBe(404);
    expect((await request(app).get('/boutique?market=CG')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
  });
  test('panne PostgreSQL = 503 sans fallback aux anciens marchés',async()=>{
    const {app,query}=setup();query.mockRejectedValue(new Error('database down'));
    expect((await request(app).get('/CM')).status).toBe(503);
    expect((await request(app).get('/')).status).toBe(503);
  });
  test('le back-office /admin/markets n est pas une boutique publique',async()=>{
    const {app}=setup();const res=await request(app).get('/admin/markets');
    expect(res.status).toBe(200);
    expect(res.headers['x-admin-generation']).toBe('legacy-1');
  });
});
