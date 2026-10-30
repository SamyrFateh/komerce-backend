'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const ui=require('../../public/dashboards/canonical/js/market-product-register');

const product=(status=null,exposure='DISABLED')=>({
  product_ref:'KPR-100',product_id:'internal-uuid',product_name:'Produit prêt',
  is_available:true,needs_review:false,commercial_exposure:exposure,
  local_price_decision:status?{local_price:15000,decision_status:status}:null,
});

test('Le registre du marché réutilise tous les produits du Catalogue global, y compris non décidés',()=>{
  const rows=ui.decisionRows({
    exposure:[{product_ref:'KPR-1',decision_recorded:false,commercial_exposure:'DISABLED'},
      {product_ref:'KPR-2',decision_recorded:true,commercial_exposure:'ENABLED'}],
  },{products:[{product_ref:'KPR-1',local_price:18000,decision_status:'DRAFT_PENDING_GATE'}]});
  expect(rows).toHaveLength(2);
  expect(rows[0].local_price_decision.local_price).toBe(18000);
  expect(rows[1].local_price_decision).toBeNull();
});

test('Prix brouillon !== publication : enregistrer ne fait que POST local-price',async()=>{
  const calls=[];
  await ui.savePrice({row:product(),amount:15000,marketCode:'CM',
    request:async(url,options)=>{calls.push([url,options]);return {};}})
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('/api/admin/workspaces/pricing/market/CM/products/KPR-100/local-price');
  expect(calls[0][1].method).toBe('POST');
  expect(JSON.stringify(calls)).not.toMatch(/market_id|marketId|\/activate|commercial_exposure/);
  expect(calls[0][1].body.amount).toBe(15000);
});

test('Prix invalide et produit exposé : aucune réécriture commerciale',async()=>{
  const calls=[];
  const request=async(...args)=>{calls.push(args);};
  await expect(ui.savePrice({row:product(),amount:0,marketCode:'KM',request}))
    .rejects.toThrow('strictement positif');
  await expect(ui.savePrice({row:product('LOCAL_ACTIVE','ENABLED'),amount:20000,marketCode:'KM',request}))
    .rejects.toThrow('Masquez');
  await expect(ui.savePrice({row:product('LOCAL_ACTIVE'),amount:20000,marketCode:'KM',request}))
    .rejects.toThrow('Prix actif');
  expect(calls).toHaveLength(0);
});

test('OFF masque le produit et conserve le prix local actif',async()=>{
  const calls=[];
  await ui.setPublication({row:product('LOCAL_ACTIVE','ENABLED'),enabled:false,marketCode:'KM',
    request:async(url,opts)=>{calls.push([url,opts]);return {};}});
  expect(calls).toEqual([[
    '/api/market-delegation/markets/KM/catalog/exposure/internal-uuid',
    {method:'PUT',body:{commercial_exposure:'DISABLED'}},
  ]]);
  expect(JSON.stringify(calls)).not.toMatch(/reset|price.*DELETE/);
});

test('ON sans prix local : refus avant tout appel réseau',async()=>{
  const calls=[];
  await expect(ui.setPublication({row:product(),enabled:true,marketCode:'CG',
    request:async(url)=>{calls.push(url);return {};}})).rejects.toThrow('Enregistrez un prix');
  expect(calls).toHaveLength(0);
});

test('ON avec brouillon : preview économique serveur obligatoire avant activation',async()=>{
  const calls=[],row=product('DRAFT_PENDING_GATE');
  await expect(ui.setPublication({row,enabled:true,marketCode:'KM',request:async(url,opts)=>{
    calls.push([url,opts]);return {activation:{allowed:false,reason:'PRICE_BELOW_VARIABLE_COST'}};
  }})).rejects.toThrow('Publication refusée');
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toContain('/activation-preview');
  const permitted=[];
  await ui.setPublication({row,enabled:true,marketCode:'KM',request:async(url,opts)=>{
    permitted.push([url,opts]);
    return url.endsWith('activation-preview')?{activation:{allowed:true}}:{};
  }});
  expect(permitted.map(x=>x[0])).toEqual([
    '/api/admin/workspaces/pricing/market/KM/products/KPR-100/local-price/activation-preview',
    '/api/admin/workspaces/pricing/market/KM/products/KPR-100/local-price/activate',
  ]);
  expect(permitted[1][1].body.source).toBe('market_catalog_publication_switch');
  expect(JSON.stringify(permitted)).not.toMatch(/market_id|marketId/);
});

test('Prix déjà actif : réexposition par activation serveur idempotente',async()=>{
  const calls=[];
  await ui.setPublication({row:product('LOCAL_ACTIVE'),enabled:true,marketCode:'DJ',
    request:async(url,opts)=>{calls.push([url,opts]);return {};}});
  expect(calls.map(x=>x[0])).toEqual([
    '/api/admin/workspaces/pricing/market/DJ/products/KPR-100/local-price/activate',
  ]);
  expect(ui.publicationState(product('LOCAL_ACTIVE'))).toMatchObject({
    checked:false,label:'Prix actif · produit masqué',
  });
  expect(ui.publicationState(product('LOCAL_ACTIVE','ENABLED'))).toMatchObject({
    checked:true,label:'Publié sur ce marché',
  });
});

test('Fiche à corriger : ON refusé même avec prix local',async()=>{
  const calls=[],row={...product('DRAFT_PENDING_GATE'),needs_review:true};
  await expect(ui.setPublication({row,enabled:true,marketCode:'KM',
    request:async url=>{calls.push(url);}})).rejects.toThrow('Fiche indisponible');
  expect(calls).toHaveLength(0);
});

test('Implémentation UI : prix par marché et switch explicite; ne publie jamais à la sauvegarde',()=>{
  const fs=require('fs'),path=require('path');
  const source=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/market-product-register.js'),'utf8');
  const market=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/market-catalog.js'),'utf8');
  expect(source).toContain("checkbox.setAttribute('role','switch')");
  expect(source).toContain("priceData==null?'Accès Pricing requis'");
  expect(source).toContain("money(e.cdr_complete_kmf,'KMF')");
  expect(source).toContain("money(e.variable_cost_complete_kmf,'KMF')");
  expect(source).toContain("preview.activation?.allowed!==true");
  expect(market).toContain('renderExposure(payload, marketCode, priceData)');
  expect(market).not.toContain('      renderReadyToSell(payload, marketCode);');
});
