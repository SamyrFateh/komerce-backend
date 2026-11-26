'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L5 : l’avis « politique de marché absente » est un bloc d’information stylé, sans variante bouton', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/pricing-economic-cockpit.css'), 'utf8');
  expect(css).toContain('.kmc-pricing-decision-overview .kmc-pricing-configuration-notice');
  expect(css).toContain('.kmc-pricing-configuration-title');
  expect(css).toContain('.kmc-pricing-configuration-copy');
  expect(css).not.toMatch(/kmc-pricing-configuration[^{]*\{[^}]*cursor:\s*pointer/);
});

const {v7Money,createV7CostCenters,createV6Activity,createV7V6Tabs,fetchV7V6Model}=require('../../public/dashboards/canonical/js/pricing-economic-cockpit');
function node(tag){
  return {tag,children:[],dataset:{},attrs:{},textContent:'',append(...xs){this.children.push(...xs);},appendChild(x){this.children.push(x);return x;},replaceChildren(){this.children=[];},addEventListener(e,fn){this[e]=fn;},setAttribute(k,v){this.attrs[k]=v;}};
}
const doc={createElement:node};
function all(n){return [n,...n.children.flatMap(all)];}
function find(n,label){return all(n).find(x=>x.tag==='button'&&x.textContent===label);}
function texts(n){return all(n).map(x=>x.textContent);}
test('V7 renders exact amount text, preserves zero and never treats null as zero',()=>{
  expect(v7Money('100000000000000.01')).toBe('100\u202f000\u202f000\u202f000\u202f000,01 EUR');
  expect(v7Money('0.00')).toBe('0,00 EUR');
  expect(v7Money(null)).toBe('Non disponible');
});
test('V7 scoped center -> family -> post drill-down uses server data; one family only',()=>{
  const model={scope:'MARKET',marketCode:'CM',periodStart:'2026-01-01',budgetSummary:{totalEur:null,recordedEur:'10.00',coveredPosts:1,totalPosts:2},
    commitmentSummary:{totalEur:'7.00'},structureEvidence:{amountKmf:'1000.00',amountEur:'2.03'},centers:[{id:'a',label:'Relais',budgetSummary:{totalEur:'10.00'},commitmentSummary:{totalEur:'7.00'}}],
    families:[{id:'f1',center_id:'a',label:'Personnel'},{id:'f2',center_id:'a',label:'Matériel'}],
    resources:[{id:'r',center_id:'a',label:'Équipe'}],
    posts:[{id:'p',center_id:'a',family_id:'f1',resource_id:'r',label:'Salaires',economic_nature:'FIXED',budget:{native:'6559',currency:'XAF'},commitments:[]},
    {id:'q',center_id:'a',family_id:'f2',label:'Équipement',budget:null,commitments:[]}]};
  const host=createV7CostCenters(doc,model);
  expect(texts(host)).toContain('Centres de coûts');
  expect(texts(host)).toContain('10,00 EUR · partiel (1/2)');
  expect(texts(host)).toContain('7,00 EUR');
  expect(texts(host)).toContain('2,03 EUR · structure partielle');
  find(host,'Consulter').click();
  expect(find(host,'Salaires')).toBeTruthy();expect(find(host,'Équipement')).toBeUndefined();
  find(host,'Salaires').click();expect(texts(host)).toContain('Équipe');
  find(host,'Matériel').click();expect(find(host,'Salaires')).toBeUndefined();expect(find(host,'Équipement')).toBeTruthy();
  expect(texts(host)).not.toContain('Équipe');find(host,'Tous les centres').click();
  expect(texts(host)).toContain('Centres de coûts');
});

const activityModel={scope:'MARKET',marketCode:'CM',periodStart:'2026-01-01',centers:[],activity:{physicalClosedCount:2,financialClosedCount:1,measuredWeightSubtotalKg:'10.000',measuredWeightCount:1,volumeM3:'0.50000',volumeCoveredCount:2,receivedArticles:'2',expectedArticles:'2',boxCount:'2',freightCustomsSubtotalKmf:'120.10',coverage:'PARTIAL',costPerKgKmf:'13.10',weightedShipmentCount:1,minCostPerKgKmf:'13.10',maxCostPerKgKmf:'13.10',shipments:[{reference:'S1',rail:'sea',weightKg:'10.000',purchaseKmf:'1000.00',freightCustomsKmf:'120.10',costPerKgKmf:'13.10',volumeM3:'0.25',receivedArticles:1,financialStatus:'DOCUMENTED_CLOSED'},{reference:'S2',rail:'air',financialStatus:'NOT_RECONCILED'}],purchaseTransportObservation:{purchaseKmf:'1000.00',freightCustomsKmf:'120.10',otherTransportKmf:'10.90',documentedSubtotalKmf:'1131.00',fullEconomicCostKmf:null,observations:1,coefficient:'1.1310',decisional:false}}};
test('V6 activity renders server amounts and missing totals explicitly',()=>{
  const view=createV6Activity(doc,activityModel);expect(texts(view)).toContain('S1 · Maritime');expect(texts(view)).toContain('Financier à rapprocher');expect(texts(view)).toContain('1\u202f131 KMF');expect(texts(view)).toContain('Coût complet de période');expect(texts(view)).toContain('Non disponible');expect(texts(view)).toContain('13,1 KMF');
});
test('three candidate tabs share a single payload, without making partial coefficient decisional',()=>{
  const view=createV7V6Tabs(doc,activityModel);expect(all(view).filter(x=>x.tag==='button').map(x=>x.textContent)).toEqual(['Centres de coûts','Activité','Rentabilité']);find(view,'Activité').click();expect(texts(view)).toContain('S1 · Maritime');find(view,'Rentabilité').click();expect(texts(view)).toContain('Observation partielle achat + transport : 1,1310 · non décisionnelle');expect(texts(view)).not.toContain('S1 · Maritime');
});
test('API model request uses canonical scope and rejects stale/wrong scope',async()=>{
  const workspace={endpointFor:jest.fn(()=>'/api/admin/workspaces/pricing/market/CM'),jsonRequest:jest.fn().mockResolvedValue(activityModel)};const options={requestedMarket:'CM',fetch:jest.fn()};
  await expect(fetchV7V6Model(workspace,options,'2026-01-01')).resolves.toBe(activityModel);expect(workspace.jsonRequest).toHaveBeenCalledWith(options.fetch,'/api/admin/workspaces/pricing/market/CM/cost-centers?periodStart=2026-01-01');
  await expect(fetchV7V6Model(workspace,options,'2026-02-01')).rejects.toThrow('Périmètre économique incohérent');
});
