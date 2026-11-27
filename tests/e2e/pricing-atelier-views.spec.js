/**
 * @e2e   pricing-atelier-views.spec.js
 * @feature dashboard (Atelier des prix, /admin/workspaces/pricing, marché Comores) — lot UX A
 * @brief Cockpit économique V7/V6 validé : trois onglets exclusifs, centres et postes, budget/engagement/charges,
 *        données serveur, droits, périodes, coefficient et rapprochement de lots. Desktop uniquement pour le backoffice.
 *        La prévision produit ciblée demeure testée. API simulée, aucune preuve staging.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const DEMO = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-economic-illustration-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';
const SHOTS = process.env.ATELIER_SHOTS_DIR || '';

const clone = value => JSON.parse(JSON.stringify(value));
const PRODUCTS = FX.market.simulation_products.slice(0, 6).map((product, index) => ({ ...product, name: `Produit ${index + 1}`, product_ref: `KPR-90000${index + 1}`, category: 'phones' }));
// 1 coût absent · 2 brouillon · 3 actif · 4 brouillon sous plancher · 5-6 à décider
function corridorFor(ref) {
  const index = PRODUCTS.findIndex(product => product.product_ref === ref);
  const data = clone(FX.corridor);
  data.product = { ...data.product, product_ref: ref, name: PRODUCTS[index].name, purchase_cost_kmf: 7000 };
  if (index === 0) data.product.purchase_cost_kmf = 0;
  if (index === 1) data.candidate = { amount: 30000, currency: 'KMF', price_kmf: 30000, status: 'LOCAL_DRAFT', buyer_effective: false, economics: data.selected.economics };
  if (index === 2) data.selected = { ...data.selected, source: 'LOCAL_ACTIVE', buyer_effective: true, local_amount: 30000, local_currency: 'KMF', price_kmf: 30000 };
  if (index === 3) data.candidate = { amount: 9000, currency: 'KMF', price_kmf: 9000, status: 'LOCAL_DRAFT', buyer_effective: false, economics: data.selected.economics };
  if (index === 1) data.corridor.local = { ...data.corridor.local, sample_count: 1, low: { observed_amount: 28000, currency: 'KMF' }, target: { observed_amount: 28000, currency: 'KMF' }, high: { observed_amount: 28000, currency: 'KMF' }, observations: [{ competitor_name: 'Boutique Moroni', observed_amount: 28000, currency: 'KMF', observed_at: '2026-10-20T08:00:00Z', source: 'relevé terrain' }] };
  return data;
}
const COMPONENTS = [
  { key: 'stripe_fee_pct', label: 'Frais Stripe', family: 'business', category: 'payment', unit: 'pct', default_value: 2.9, base_default_value: 3.2, allocation_method: 'per_order', inherited: true, is_active: true },
  { key: 'cash_fee_kmf', label: 'Frais collecte cash', family: 'business', category: 'payment', unit: 'kmf_per_order', default_value: 500, allocation_method: 'per_order', inherited: false, is_active: true },
  { key: 'freight_kg', label: 'Fret maritime', family: 'landed_relay', category: 'freight', unit: 'kmf_per_kg', default_value: null, allocation_method: 'by_weight', inherited: true, is_active: true },
];

async function mount(page, { caps = {}, access = null, posts = [], search = '', components = COMPONENTS, decision = FX.decision, corridorStatus = 200, preview = null, readySelector = '.kmc-v7v6-tabs', costModel = null, costStatus = 200, actor = FX.auth_me, context = FX.context, observed = null, lots = null } = {}) {
  const market = { ...FX.market, simulation_products: PRODUCTS, cost_components: components.map(item => ({ ...item })), access: access || FX.market.access, capabilities: { ...FX.market.capabilities, ...caps } };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin/workspaces/pricing') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'PATCH' && url.pathname.includes('/structure-charges/')) {
      const posted = route.request().postDataJSON();
      posts.push({ path: url.pathname, body: posted, method: 'PATCH' });
      return json({ ok:true, action:'update_market_direct_structure_details' });
    }
    if (url.pathname.endsWith('/forecast-preview') && route.request().method() === 'POST') {
      const posted = route.request().postDataJSON();
      posts.push({ path: url.pathname, body: posted, method: 'POST' });
      return json({ simulation_only: true, writes: false, forecast: {
        status: 'PROVISOIRE', plancher_central_kmf: 7280, plancher_prudent_kmf: 8909,
        cases: { central: { n1_kmf: 6361, n2_fixed_kmf: 919, sale_pct: 0,
          lines: [{ code: 'supplier_delivery', evidence: 'ASSUMED', amount_kmf: 738 }] } },
        prices: [{ price_kmf: 9000, verdict: 'ROBUSTE_DANS_LES_SCENARIOS',
          contribution_centrale_kmf: 1720 }], diagnostics: [],
      } });
    }
    if (route.request().method() === 'POST') {
      const posted = route.request().postDataJSON();
      posts.push({ path: url.pathname, body: posted });
      if (url.pathname.includes('/cost-components/') && url.pathname.endsWith('/update')) {
        const key = decodeURIComponent(url.pathname.split('/cost-components/')[1].split('/update')[0]);
        const row = market.cost_components.find(item => item.key === key);
        if (row) { row.default_value = posted.default_value; row.inherited = false; }
      }
      if (url.pathname.endsWith('/simulate-impact')) return json({ baseline: { metrics: { minimum_safe_price_kmf: 17990, recommended_price_kmf: 26990 } }, scenario: { metrics: { minimum_safe_price_kmf: 18500, recommended_price_kmf: 27600 } }, delta: { minimum_safe_price_kmf: 510, recommended_price_kmf: 610 }, persisted: false });
      return json({ ok: true });
    }
    if (url.pathname === '/api/auth/me') return json(actor);
    if (url.pathname === '/api/admin/dashboard/context') return json(context);
    if (url.pathname.endsWith('/cost-centers')) {
      if(costStatus!==200)return json({error:'Indisponible'},costStatus);
      const month=url.searchParams.get('periodStart');
      return json({...clone(costModel||v7Fixture()),periodStart:month,marketCode:url.pathname.includes('/market/KM/')?'KM':null});
    }
    if(url.pathname.endsWith('/products/margin-steering'))return json(observed||{products:[],truncated:false});
    if(url.pathname.endsWith('/local-stock/receipt-lots'))return json(lots||{receipts:[],sales:[]});
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM') return json(market);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision') return json(decision);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision-policy/history') return json(FX.history);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/charges') {
      const evidence = DEMO.decision.coverage.structure.evidence;
      const allocations = DEMO.decision.coverage.structure.allocation.charges;
      return json({ charges: [...evidence, ...allocations].map(row => ({
        id: row.charge_id, name: row.charge_name, family: 'operationnelle', is_active: true,
        recurrence_period: 'monthly',
      })) });
    }
    if (url.pathname.endsWith('/structure-events')) return json({ events: [] });
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/corridor') {
      if (corridorStatus !== 200) return json({ error: 'Corridor indisponible' }, corridorStatus);
      return json(corridorFor(url.searchParams.get('product_ref')));
    }
    if (url.pathname.endsWith('/local-price/activation-preview')) return json(preview || { activation: { allowed: false, reason: 'Politique de marché requise pour ce prix.' } });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/workspaces/pricing${search}`);
  if (!/market=KM/.test(search)) await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator(readySelector)).toBeVisible();
}

const shot = async (page, name, viewport) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${viewport}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
};


function v7Fixture(overrides={}) {
  const periodStart='2026-11-01';
  const budgetSummary={totalEur:'1200.00',totalPosts:1,coveredPosts:1};
  const recordedBalance={status:'RECORDED_OVER_BUDGET',recordedAvailableEur:'-100.00'};
  const structureEvidence={amountKmf:'640000',amountEur:'1300.00'};
  const center={id:'center1',label:'Logistique locale',is_active:true,responsible_label:'Responsable local',budgetSummary,recordedBalance,structureEvidence};
  const family={id:'family1',center_id:'center1',label:'Locaux'};
  const post={id:'post1',center_id:'center1',family_id:'family1',label:'Loyer relais',economic_nature:'FIXED',allocation_perimeter:'DIRECT',allocation_basis:'Mois',
    budget:{native:'1200.00',currency:'EUR',revision:2},acceptsStructureActual:true,commitments:[],structureEvidence,recordedBalance};
  const range={periodStart,observations:3,physicalClosedCount:4,coefficient:'1.25',purchaseKmf:'400000',transportKmf:'100000',coefficientWeightKg:'20'};
  return {periodStart,marketCode:'KM',scope:'MARKET',central:true,costCapabilities:{},centers:[center],families:[family],posts:[post],resources:[],
    budgetSummary,recordedBalance,structureEvidence,
    activity:{physicalClosedCount:4,financialClosedCount:3,weightKg:'20',volumeM3:'2',receivedArticles:30,expectedArticles:30,boxCount:4,freightCustomsSubtotalKmf:'100000',shipments:[
      {reference:'ECO-E1',rail:'sea',weightKg:'10',volumeM3:'1',purchaseKmf:'40000',freightCustomsKmf:'10000',receivedArticles:10,financialStatus:'DOCUMENTED_CLOSED'},
      {reference:'ECO-E2',rail:'air',weightKg:'10',volumeM3:'1',receivedArticles:20,financialStatus:'PENDING'}]},
    profitability:{groupPeriodResult:{status:'PROVISIONAL',contributionKmf:'720',resultKmf:'-280',netSalesKmf:'2000',variableCostKmf:'1280',structureKmf:'1000',actualRiskKmf:'0',evidenceHash:'ECO_TEST_HASH'},
      salesEvidence:{observedNetSalesKmf:'2000',coveredOrderCount:2,paidOrderCount:3,pendingRefundOrders:0,terminalExceptions:0,invalidOrderCount:0},
      ranges:{month:range,quarter:range,ytd:range},points:[]},...overrides};
}
const nav=page=>page.getByRole('navigation',{name:'Atelier économique',exact:true});
const tab=async(page,label)=>{await nav(page).getByRole('button',{name:label,exact:true}).click();};
const openPost=async page=>{
  await page.getByRole('button',{name:'Consulter',exact:true}).click();
  await page.getByRole('button',{name:'Loyer relais',exact:true}).click();
};
test.describe('Atelier économique V7/V6 — desktop 1440',()=>{
  test.use({viewport:{width:1440,height:900}});
  test('trois onglets exclusifs, centres par défaut et aucun ancien cockpit',async({page})=>{
    const posts=[];
    await mount(page,{search:'?market=KM',posts});
    await expect(nav(page).getByRole('button')).toHaveText(['Centres de coûts','Activité','Rentabilité']);
    await expect(nav(page).getByRole('button',{name:'Centres de coûts'})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-v7-centers]')).toBeVisible();
    await expect(page.locator('[data-atelier-nav], .kmc-economic-family-grid')).toHaveCount(0);
    await expect(page.locator('.kmc-v7-center-card')).toContainText('Logistique locale');
    expect(posts).toHaveLength(0);
    await noOverflow(page);await shot(page,'v7-centres','1440');
  });
  test('centre et poste : détail contextualisé, responsable, nature et attribution',async({page})=>{
    await mount(page,{search:'?market=KM'});
    await openPost(page);
    const detail=page.locator('.kmc-v7-post-detail');
    await expect(detail).toContainText('Loyer relais');
    await expect(detail).toContainText('Fixe');
    await expect(detail).toContainText('Direct');
    await expect(detail).toContainText('Mois');
    await expect(page.locator('[data-v7-centers]')).toContainText('Responsable local');
    await expect(detail.getByRole('button',{name:'Valider le budget'})).toBeVisible();
    await detail.getByRole('button',{name:'Fermer le détail'}).click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('button',{name:'Tous les centres'}).click();
    await expect(page.locator('.kmc-v7-center-card')).toHaveCount(1);
    await noOverflow(page);
  });
  test('filtre des centres en écart et retour',async({page})=>{
    const model=v7Fixture();model.centers.push({...model.centers[0],id:'center2',label:'Centre conforme',recordedBalance:{status:'RECORDED',recordedAvailableEur:'100'}});
    await mount(page,{search:'?market=KM',costModel:model});
    await expect(page.locator('.kmc-v7-center-card')).toHaveCount(2);
    await page.getByRole('button',{name:'Centres en écart'}).click();
    await expect(page.locator('.kmc-v7-center-card')).toHaveCount(1);
    await page.getByRole('button',{name:'Tous les centres'}).click();
    await expect(page.locator('.kmc-v7-center-card')).toHaveCount(2);
  });
  test('ajout d’un poste : aucune écriture avant validation, périmètre et nature transmis',async({page})=>{
    const posts=[];await mount(page,{search:'?market=KM',posts});
    await page.getByRole('button',{name:'Consulter',exact:true}).click();
    await page.getByText('Ajouter un poste',{exact:true}).click();
    const form=page.locator('details').filter({has:page.getByText('Ajouter un poste',{exact:true})}).locator('form');
    await form.locator('[name=label]').fill('Entretien relais');
    await form.locator('[name=code]').fill('ENTRETIEN_RELAIS');
    await form.locator('[name=allocationBasis]').fill('Mois');
    await form.locator('[name=source]').selectOption('STRUCTURE');
    await form.locator('[name=reason]').fill('Justificatif recette');
    expect(posts).toHaveLength(0);
    await form.getByRole('button',{name:'Créer le poste'}).click();
    await expect.poll(()=>posts.length).toBe(1);
    expect(posts[0]).toMatchObject({path:'/api/admin/workspaces/pricing/market/KM/cost-centers/families/family1/posts',body:{label:'Entretien relais',economicNature:'FIXED',allocationPerimeter:'DIRECT',allocationBasis:'Mois',source:'STRUCTURE'}});
  });
  test('lecture seule : aucune action de configuration ni écriture de budget',async({page})=>{
    const actor={...FX.auth_me,role:'market_operator'},context={...FX.context,actor:{...FX.context.actor,role:'market_operator'},access:{...FX.context.access,mode:'market',allowedMarkets:['KM'],defaultMarket:'KM',capabilities:['finance.read']}};
    await mount(page,{search:'?market=KM',actor,context,costModel:v7Fixture({central:false,costCapabilities:{}})});
    await expect(page.getByRole('button',{name:'Initialiser les centres et familles'})).toHaveCount(0);
    await openPost(page);
    await expect(page.getByRole('button',{name:'Valider le budget'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Enregistrer la charge'})).toHaveCount(0);
    await tab(page,'Rentabilité');
    await expect(page.getByRole('button',{name:'Rapprocher les lots locaux'})).toHaveCount(0);
  });
  test('activité : expéditions, poids, rails et clôture distincte',async({page})=>{
    await mount(page,{search:'?market=KM'});
    await tab(page,'Activité');
    const activity=page.locator('.kmc-v6-activity');
    await expect(activity).toContainText('ECO-E1 · Maritime');
    await expect(activity).toContainText('ECO-E2 · Aérien');
    await expect(activity).toContainText('Financièrement clôturée');
    await expect(activity).toContainText('Financier à rapprocher');
    await expect(page.locator('[data-v7-centers]')).toHaveCount(0);
    await noOverflow(page);await shot(page,'v6-activite','1440');
  });
  test('rentabilité : résultat serveur négatif, distinct du coefficient partiel',async({page})=>{
    await mount(page,{search:'?market=KM'});
    await tab(page,'Rentabilité');
    await expect(page.locator('.kmc-v6-profitability')).toContainText('-280 KMF');
    await expect(page.locator('.kmc-v6-profitability')).toContainText('Observation partielle achat + transport — non décisionnelle');
    await expect(page.getByRole('button',{name:'Année à date'})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Mois',exact:true}).click();
    await expect(page.getByRole('button',{name:'Mois',exact:true})).toHaveAttribute('aria-pressed','true');
    await noOverflow(page);await shot(page,'v6-rentabilite','1440');
  });
  test('clôture du résultat : attestation et justificatif obligatoires',async({page})=>{
    const posts=[];await mount(page,{search:'?market=KM',posts});
    await tab(page,'Rentabilité');
    const close=page.getByRole('button',{name:'Valider la clôture'});
    await close.click();
    await expect(page.getByText('Confirmez la revue et renseignez le justificatif.')).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByLabel('Référence du justificatif',{exact:true}).fill('ECO-RECETTE');
    await page.getByLabel('Ventes, remboursements, coûts et pertes du mois vérifiés').check();
    await close.click();
    await expect.poll(()=>posts.length).toBe(1);
    expect(posts[0]).toMatchObject({path:'/api/admin/workspaces/pricing/market/KM/cost-centers/close-period',body:{evidenceHash:'ECO_TEST_HASH',evidenceRef:'ECO-RECETTE',attested:true}});
  });
  test('prix de revient : rails séparés, valeur réelle et statut serveur',async({page})=>{
    const posts=[];await mount(page,{search:'?market=KM',posts,observed:{truncated:false,products:[{product_name:'SKU témoin',observed_landed_cost:[
      {sku_reference:'SKU1',rail:'sea',unit_cost_kmf:7719.68,estimated_unit_cost_kmf:7000,observed_multiplier:1.5691,estimated_vs_real_pct:10.28,status:'DECISIONAL',observations:3,incomplete_lines:0,provisional_lines:0},
      {sku_reference:'SKU1',rail:'LOCAL_STOCK',unit_cost_kmf:5200,estimated_unit_cost_kmf:null,observed_multiplier:1.04,status:'INSUFFICIENT_OBSERVATIONS',observations:2,incomplete_lines:1,provisional_lines:0}]}]}});
    await tab(page,'Rentabilité');
    await page.getByRole('button',{name:'Afficher les prix de revient'}).click();
    const actual=page.locator('.kmc-v7-metric').filter({hasText:'SKU témoin · SKU1 · Maritime'});
    await expect(actual).toContainText(/7\s*719,68 KMF/);
    await expect(actual).toContainText('Décisionnel');
    const local=page.locator('.kmc-v7-metric').filter({hasText:'SKU témoin · SKU1 · Stock local'});
    await expect(local).toContainText('Indicatif');
    await expect(local).toContainText('2 lot(s)');
    expect(posts).toHaveLength(0);
  });
  test('lot local : rattachement quantifié, justificatif et marché explicite',async({page})=>{
    const posts=[];await mount(page,{search:'?market=KM',posts,lots:{receipts:[{receipt_id:'L1',sku_id:'SKU1',product_name:'Produit local',sku_reference:'SKU1',quantity:10,linked_quantity:2,receipt_proof_ref:'BL-1',purchase_total_kmf:'50000',closed_at:'2026-11-01',received_at:'2026-11-01'}],sales:[{order_item_id:'OI1',sku_id:'SKU1',order_reference:'O1',quantity:10,remaining_quantity:6,sold_at:'2026-11-02'}]}});
    await tab(page,'Rentabilité');await page.getByRole('button',{name:'Rapprocher les lots locaux'}).click();
    await page.getByLabel('Lot reçu',{exact:true}).selectOption('L1');
    await page.getByLabel('Quantité attestée de ce lot').fill('4');
    await page.getByLabel('Justificatif du rattachement physique').fill('Scan lot 1');
    await page.getByRole('button',{name:'Rattacher la vente attestée'}).click();
    await expect.poll(()=>posts.length).toBe(1);
    expect(posts[0]).toMatchObject({path:'/api/admin/costing/local-stock/receipt-lots/link',body:{receipt_id:'L1',order_item_id:'OI1',quantity:4,lot_proof_ref:'Scan lot 1',market_code:'KM'}});
  });
  test('absence de données : aucune valeur inventée, aucune ancienne vue',async({page})=>{
    await mount(page,{search:'?market=KM',costStatus:503,readySelector:'.kmc-v7v6-session'});
    await expect(page.getByText('Données économiques indisponibles pour cette période.')).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await expect(page.locator('[data-atelier-nav]')).toHaveCount(0);
  });
  test('changement de mois : nouvelle requête et maintien de l’onglet actif',async({page})=>{
    await mount(page,{search:'?market=KM'});
    await tab(page,'Activité');
    const select=page.getByLabel('Période économique');
    const previous=await select.locator('option').nth(1).getAttribute('value');
    const read=page.waitForRequest(r=>r.url().includes('/cost-centers?periodStart='+previous));
    await select.selectOption(previous);await read;
    await expect(nav(page).getByRole('button',{name:'Activité'})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.kmc-v6-activity')).toBeVisible();
  });
    test('Prévision avant vente : trois scénarios explicites, lecture seule, aucun prix choisi', async ({ page }) => {
      const posts = [];
      await mount(page, { posts, search: '?market=KM&product_ref=KPR-900002', readySelector: '[data-atelier-forecast]' });
      const detail = page.locator('[data-atelier-forecast]');
      await expect(detail).toHaveCount(1);
      await expect(detail).toContainText('NON VÉRIFIÉES');
      expect(posts).toHaveLength(0);
      await detail.locator('summary').first().click();
      await detail.locator('[name="commission_basis"]').selectOption('fixed_unit');
      const numeric = {
        supplier_delivery: 738, bank_pct: 1.5, hub_packaging: 56,
        freight: 88552.8, lot_volume_m3: 3, minimum_billable_m3: 1,
        lot_fee: 110000, insurance_pct: .5, customs_duties: 20,
        last_mile: 500, relay_commission: 600, payment: 200, payment_pct: 0,
        risk_damage_pct: 1, risk_pickup_pct: 5,
      };
      await detail.locator('form').evaluate((form, values) => {
        for (const input of form.querySelectorAll('input[name]')) {
          const key = input.name.replace(/_(favorable|central|defavorable)$/, '');
          if (Object.prototype.hasOwnProperty.call(values, key)) input.value = String(values[key]);
        }
      }, numeric);
      await detail.locator('[name="customs_duties_favorable"]').fill('0');
      await detail.locator('[name="customs_duties_defavorable"]').fill('42');
      await detail.locator('[name="candidate_price"]').fill('9000');
      await detail.getByRole('button', { name: 'Calculer sans enregistrer' }).click();
      await expect(detail.locator('[data-atelier-forecast-output]')).toContainText('Plancher central');
      await expect(detail.locator('[data-atelier-forecast-output]')).toContainText('PROVISOIRE');
      await expect(detail.locator('[data-atelier-forecast-output]')).toContainText(/8\s*909/);
      expect(posts.filter(item => item.path.endsWith('/forecast-preview'))).toHaveLength(1);
      expect(posts.filter(item => /\/local-price|\/activate/.test(item.path))).toHaveLength(0);
      const sent = posts.find(item => item.path.endsWith('/forecast-preview')).body;
      expect(sent.circuit).toBe('import');
      expect(sent.commission_basis).toBe('fixed_unit');
      expect(sent.candidate_prices_local).toEqual([9000]);
      expect(sent.candidate_prices_kmf).toBeUndefined();
      expect(sent.scenarios.central.customs_duties).toBe(20);
      expect(sent.scenarios.defavorable.freight).toBe(88552.8);
      expect(sent.market_code).toBeUndefined();
      await noOverflow(page);
    });


});
