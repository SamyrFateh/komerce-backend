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

const {v7Money,createV7CostCenters,createV6Activity,createV6Profitability,createV7V6Tabs,fetchV7V6Model,createV7V6Session,createV7BudgetForm,install}=require('../../public/dashboards/canonical/js/pricing-economic-cockpit');
test('les accès Hub distinguent exploitation et refacturation par marché', () => {
  const { createHubEconomyLinks } = require('../../public/dashboards/canonical/js/pricing-economic-cockpit');
  const group = createHubEconomyLinks(doc, {
    user: { role: 'admin' }, adminContext: { access: { allowedMarkets: ['KM', 'CM'] } },
  });
  expect(all(group).filter(x => x.tag === 'a').map(x => [x.textContent, x.href])).toEqual([
    ['Activité du Hub', '/admin/hub'],
    ['KM', '/admin/workspaces/pricing?market=KM#refacturation-marches'],
    ['CM', '/admin/workspaces/pricing?market=CM#refacturation-marches'],
  ]);
  const market = createHubEconomyLinks(doc, { user: { role: 'admin' }, requestedMarket: 'CM' });
  expect(all(market).find(x => x.textContent === 'Refacturation marchés').href).toBe('#refacturation-marches');
  const operator = createHubEconomyLinks(doc, { user: { role: 'market_operator' }, requestedMarket: 'CM' });
  expect(texts(operator)).not.toContain('Refacturation marchés');
});

function node(tag){
  return {tag,children:[],dataset:{},attrs:{},textContent:'',append(...xs){this.children.push(...xs);},appendChild(x){this.children.push(x);return x;},replaceChildren(...xs){this.children=[...xs];},addEventListener(e,fn){this[e]=fn;},setAttribute(k,v){this.attrs[k]=v;}};
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

test('V7 restores the center grid when a refresh clears the last budget overrun',()=>{
  const centerState={};
  const center={id:'a',label:'Relais',recordedBalance:{status:'RECORDED_OVER_BUDGET'}};
  const other={id:'b',label:'Hub'};
  const view=createV7CostCenters(doc,{centers:[center,other]},{centerState});
  find(view,'Centres en écart').click();
  expect(texts(view)).toContain('Relais');
  expect(texts(view)).not.toContain('Hub');

  const updated={...center,recordedBalance:{status:'RECORDED_BALANCE'}};
  const refreshed=createV7CostCenters(doc,{centers:[updated,other]},{centerState});
  expect(texts(refreshed)).toContain('Relais');
  expect(texts(refreshed)).toContain('Hub');
  expect(find(refreshed,'Centres en écart')).toBeUndefined();
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

test('V6 profitability windows display server coefficients, unavailable full result and gaps',()=>{
 const obs={periodStart:'2026-01-01',coefficient:'1.0655',observations:2,physicalClosedCount:3,purchaseKmf:'4000.00',transportKmf:'262.00',measuredWeightCount:3,measuredWeightKg:'40.000',coefficientWeightCount:1,coefficientWeightKg:'25.000',minCoefficient:'1.0437',maxCoefficient:'1.1310'};
 const feb={...obs,periodStart:'2026-02-01',coefficient:null,observations:0,physicalClosedCount:0,coefficientWeightCount:0,coefficientWeightKg:null,minCoefficient:null,maxCoefficient:null};
 const view=createV6Profitability(doc,{profitability:{points:[{periodStart:'2026-01-01',monthly:obs,cumulative:obs,rolling3:obs},{periodStart:'2026-02-01',monthly:feb,cumulative:obs,rolling3:obs}],ranges:{month:feb,quarter:obs,ytd:obs}}});
 expect(texts(view)).toContain('25,000 kg');expect(texts(view)).not.toContain('40,000 kg');
 expect(texts(view)).toContain('2 / 3 expéditions · min. 1,0437 · max. 1,1310');
 expect(texts(view)).toContain('1,0655');expect(texts(view)).toContain('2026-01');expect(texts(view)).toContain('Non disponible');
 find(view,'Mois').click();expect(texts(view)).not.toContain('2026-01');expect(texts(view)).toContain('2026-02');expect(texts(view)).toContain('0 / 0 expéditions');
 find(view,'Année à date').click();expect(texts(view)).toContain('2026-01');
});

test('profitability distinguishes commercial sales cohort from shipment observation and never calculates result',()=>{
 const obs={periodStart:'2026-01-01',coefficient:'1.1310',observations:1,physicalClosedCount:2,purchaseKmf:'1000.00',transportKmf:'131.00',measuredWeightCount:0};
 const view=createV6Profitability(doc,{profitability:{points:[],ranges:{month:obs,quarter:obs,ytd:obs},salesEvidence:{observedNetSalesKmf:'20000.00',paidOrderCount:2,coveredOrderCount:2,pendingRefundOrders:1,terminalExceptions:0,invalidOrderCount:0}}});
 expect(texts(view)).toContain('20\u202f000 KMF');expect(texts(view)).toContain('Ventes nettes observées');expect(texts(view).some(t=>t.includes('Cohorte distincte des expéditions'))).toBe(true);expect(texts(view)).toContain('Non disponible');
});

test('profitability displays handoffs and refunds observed in their own month',()=>{
 const period={periodStart:'2026-02-01',observations:0,physicalClosedCount:0};
 const view=createV6Profitability(doc,{profitability:{points:[],ranges:{month:period,quarter:period,ytd:period},
   recognitionEvidence:{handoffParcelCount:2,attestedUnits:4,confirmedRefundCount:1,confirmedRefundKmf:'500.00',pricedHandoffUnits:3,documentedHandoffSalesKmf:'8000.00',parcelCostEvidenceCount:1,documentedParcelVariableCostKmf:'315.25'}}});
 expect(texts(view)).toEqual(expect.arrayContaining(['Articles remis avec preuve','4','2 colis documentés ce mois',
   'Remboursements confirmés','500 KMF','Nombre ce mois · 1','3 / 4 articles remis avec prix rapproché','315,25 KMF','1 / 2 colis avec des coûts documentés','Non disponible']));
});

test('group profitability displays recognized structure evidence without inferring the economic result',()=>{
 const o={periodStart:'2026-01-01',observations:0,physicalClosedCount:0};
 const view=createV6Profitability(doc,{profitability:{points:[],ranges:{month:o,quarter:o,ytd:o},
   structureCoverage:{evidenceCount:2,groupSharedKmf:100,marketDirectKmf:50,recognizedKmf:150}}});
 expect(texts(view)).toEqual(expect.arrayContaining(['Charges de structure documentées','150 KMF','100 KMF','50 KMF','Non calculable']));
});

test('group result labels documented amounts provisional pending Direction closure',()=>{
 const period={periodStart:'2026-01-01',observations:0,physicalClosedCount:0};
 const view=createV6Profitability(doc,{profitability:{points:[],ranges:{month:period,quarter:period,ytd:period},
   groupPeriodResult:{status:'PROVISIONAL',netSalesKmf:'899.98',variableCostKmf:'365.26',
     actualRiskKmf:'50.01',contributionKmf:'534.72',structureKmf:'200.12',resultKmf:'334.60'}}});
 expect(texts(view)).toEqual(expect.arrayContaining([
   'Formation du résultat provisoire','334,6 KMF','50,01 KMF',
   'Résultat provisoire sur les faits documentés. Clôture Direction en attente.',
 ]));
});

test('canonical mature cohort result never replaces complete cockpit KPI',()=>{
 const o={periodStart:'2026-01-01',coefficient:'1.1310',observations:1,physicalClosedCount:2,purchaseKmf:'1000.00',transportKmf:'131.00',measuredWeightCount:0};
 const view=createV6Profitability(doc,{profitability:{points:[],ranges:{month:o,quarter:o,ytd:o},periodDecisionEvidence:{status:'AVAILABLE_ON_MATURE_COHORT',matureOrderCount:4,revenueBasisKmf:'2000.00',variableCostsKmf:'1200.00',actualRiskKmf:'80.00',contributionKmf:'720.00',structureKmf:'1000.00',resultKmf:'-280.00',remainingKmf:'280.00',coverageRatio:'0.72'}}});
 expect(texts(view)).toContain('Résultat de la cohorte mature');expect(texts(view)).toContain('Formation du résultat — cohorte mature');expect(texts(view)).toContain('Non disponible');expect(texts(view)).toContain('720 KMF');
});

test('shared economic session rejects stale period replies, preserves active tab, clears failures',async()=>{
  const pending=[];
  const workspace={endpointFor:jest.fn(()=>'/api/admin/workspaces/pricing/market/CM'),jsonRequest:jest.fn(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))};
  const session=createV7V6Session(doc,workspace,{requestedMarket:'CM',fetch:jest.fn()},'2026-01-01');
  const first=session.refresh();
  const second=session.refresh('2026-02-01');
  pending[1].resolve({...activityModel,periodStart:'2026-02-01'});
  await expect(second).resolves.toBe(true);
  find(session.element,'Activité').click();
  expect(texts(session.element)).toContain('S1 · Maritime');
  pending[0].resolve(activityModel);
  await expect(first).resolves.toBe(false);
  expect(texts(session.element)).toContain('S1 · Maritime');
  const third=session.refresh('2026-03-01');
  expect(texts(session.element)).not.toContain('S1 · Maritime');
  pending[2].resolve({...activityModel,periodStart:'2026-03-01'});
  await expect(third).resolves.toBe(true);
  expect(texts(session.element)).toContain('S1 · Maritime');
  const wrong=session.refresh('2026-04-01');
  pending[3].resolve({...activityModel,periodStart:'2026-04-01',marketCode:'CG'});
  await expect(wrong).resolves.toBe(false);
  expect(texts(session.element)).not.toContain('S1 · Maritime');
  expect(texts(session.element)).toContain('Données économiques indisponibles pour cette période.');
  const last=session.refresh('2026-05-01');
  session.dispose();
  pending[4].resolve({...activityModel,periodStart:'2026-05-01'});
  await expect(last).resolves.toBe(false);
  expect(find(session.element,'Activité')).toBeUndefined();
});

test('exclusive V7/V6 mount replaces legacy DOM without invoking old mount, for group and market',async()=>{
  const root=node('div');root.append(node('legacy'));
  const original=jest.fn();
  const workspace={mount:original,endpointFor:jest.fn(({requestedMarket})=>'/pricing'+(requestedMarket?'/market/'+requestedMarket:'')),jsonRequest:jest.fn(async(_fetch,url)=>{
    const periodStart=url.split('periodStart=')[1];const marketCode=url.includes('/market/CM')?'CM':null;
    return {...activityModel,scope:marketCode?'MARKET':'GROUP',marketCode,periodStart};
  })};
  expect(install({KomerceCanonicalPricingWorkspace:workspace})).toBe(true);
  for(const requestedMarket of ['CM',null]){
    await workspace.mount({root,document:doc,requestedMarket,fetch:jest.fn()});
    expect(root.children).toHaveLength(1);
    expect(root.children[0].dataset.pricingEconomicCockpit).toBe('');
    expect(all(root).filter(x=>x.tag==='button').map(x=>x.textContent)).toEqual(['Centres de coûts','Activité','Rentabilité']);
    expect(all(root).some(x=>x.tag==='legacy')).toBe(false);
  }
  expect(original).not.toHaveBeenCalled();
  expect(workspace.__economicV7V6Installed).toBe(true);
});

test('budget form is contextual and hidden for non-central readers',()=>{
  const base={...activityModel,centers:[{id:'a',label:'Centre'}],families:[{id:'f',center_id:'a',label:'Famille'}],posts:[{id:'p',center_id:'a',family_id:'f',label:'Poste',budget:{native:'100.0000',currency:'EUR',revision:2}}]};
  for(const central of [false,true]){
    const view=createV7CostCenters(doc,{...base,central},{reviseBudget:jest.fn()});
    find(view,'Consulter').click();find(view,'Poste').click();
    expect(Boolean(find(view,'Valider le budget'))).toBe(central);
  }
  const form=createV7BudgetForm(doc,base,base.posts[0],{reviseBudget:jest.fn()});
  expect(all(form).find(x=>x.name==='amountNative').value).toBe('100');
});

test('commitment forms expose only scoped canonical charge candidates and authorized actions',()=>{
  const base={...activityModel,centers:[{id:'a',label:'Centre'}],families:[{id:'f',center_id:'a',label:'Famille'}],posts:[{id:'p',center_id:'a',family_id:'f',label:'Poste',commitments:[{id:'k',currency:'EUR',remaining_native:'10.0000',evidence_ref:'Contrat'}],eligibleStructureFacts:[{id:'fact',currency:'EUR',remainingNative:'5.00',evidenceRef:'Facture'},{id:'other',currency:'KMF',remainingNative:'10.00',evidenceRef:'Autre devise'}]}]};
  for(const central of [false,true]){
    const view=createV7CostCenters(doc,{...base,central},{openCommitment:jest.fn(),moveCommitment:jest.fn()});
    find(view,'Consulter').click();find(view,'Poste').click();
    expect(Boolean(find(view,'Enregistrer l’engagement'))).toBe(central);
    expect(Boolean(find(view,'Libérer'))).toBe(central);
    expect(Boolean(find(view,'Consommer l’engagement'))).toBe(central);
    expect(all(view).some(x=>x.value==='other')).toBe(false);
  }
});

test('actual entry is available only for linked structure posts and authorized actors',()=>{
  const base={...activityModel,centers:[{id:'a',label:'Centre'}],families:[{id:'f',center_id:'a',label:'Famille'}],posts:[{id:'p',center_id:'a',family_id:'f',label:'Poste',acceptsStructureActual:true},{id:'q',center_id:'a',family_id:'f',label:'Opération',acceptsStructureActual:false}]};
  for(const central of [false,true]){
    const view=createV7CostCenters(doc,{...base,central},{openCommitment:jest.fn(),moveCommitment:jest.fn(),recordActual:jest.fn()});
    find(view,'Consulter').click();find(view,'Poste').click();
    expect(Boolean(find(view,'Enregistrer la charge'))).toBe(central);
    find(view,'Opération').click();
    expect(find(view,'Enregistrer la charge')).toBeUndefined();
  }
});

test('post creation is inside the selected family and absent for read-only readers',()=>{
  const base={...activityModel,centers:[{id:'a',label:'Centre'}],families:[{id:'f',center_id:'a',label:'Famille'}],resources:[{id:'r',center_id:'a',label:'Ressource locale'},{id:'r2',center_id:'b',label:'Ressource étrangère'}],posts:[]};
  for(const central of [false,true]){
    const view=createV7CostCenters(doc,{...base,central},{createPost:jest.fn()});
    find(view,'Consulter').click();
    expect(Boolean(find(view,'Créer le poste'))).toBe(central);
    expect(all(view).some(x=>x.value==='r2')).toBe(false);
  }
});
