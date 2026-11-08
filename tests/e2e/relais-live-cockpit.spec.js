/**
 * @e2e   relais-live-cockpit.spec.js
 * @feature dashboard (cockpit Live Relais)
 * @brief Navigation et rendu du cockpit Relais : Suivi → liste → colis, retours contextuels,
 *        Back/Forward, lecture seule, responsive. API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime', 'live-kit', 'relay-workboard'];

const order = (n, over = {}) => ({
  id:`r-${n}`, reference:`KMC-0${100 + n}`, status:'available', client_nom:`Client ${n}`, relais_nom:'Relais Mitsamiouli', ile:'Grande Comore',
  heures_attente:80, age_jours:4, urgence:'haute', nb_items:2, cash_pending:true, payment_status:'pending', incidents_ouverts:0, market_code:'KM', ...over,
});
const dashboard = { kpi:{ en_transit:4, disponibles:9, cash_a_encaisser:3, montant_cash_pending:45000, collectes_aujourd_hui:2, collectes_7j:14, en_attente_72h:2, total_actives:20, incidents_ouverts:1 }, alertes:[] };
const detail = (n) => ({ order:{ id:`r-${n}`, reference:`KMC-0${100 + n}`, status:'available', heures_attente:80, age_jours:4, market_code:'KM' }, client:{ nom:`Client ${n}` },
  relais:{ nom:'Relais Mitsamiouli', ile:'Grande Comore' }, paiement:{ cash_pending:true, total_kmf:12000 }, items:[{ produit:'Coque', quantity:1, prix_kmf:12000 }], timeline:[], incidents:[] });

async function mountRelay(page, search = '', { failDetail = false, empty = false, role = null, completed = false } = {}) {
  const state = { calls:[], writes:[], searchTerms:[], simQueries:[] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') state.writes.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === '/admin/relais-live') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType:'text/html', body:`<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/live-kit.js"></script><script src="/dashboards/canonical/js/relay-live.js"></script></body></html>` });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path:file }) : route.fulfill({ status:404, body:'' });
    }
    if (url.pathname === '/api/relay/incidents') return route.fulfill({
      contentType:'application/json',body:JSON.stringify({incidents:[{
        id:'i-1',order_id:'r-1',order_reference:'KMC-0101',incident_type:'colis_endommage',
        title:'Emballage endommagé',severity:'high',status:'open',source:'relay_report',
      }]})
    });
    if (req.method()==='POST' && url.pathname==='/api/relay/orders/r-1/incident') return route.fulfill({
      status:201,contentType:'application/json',body:'{"success":true,"incident":{"id":"saved-1"}}'
    });
    if (url.pathname === '/api/relay/dashboard') { state.calls.push('dashboard'); const value=empty?{kpi:{...Object.fromEntries(Object.keys(dashboard.kpi).map(k=>[k,0])),collectes_aujourd_hui:completed?1:0},alertes:[]}:dashboard; return route.fulfill({ contentType:'application/json', body:JSON.stringify(value) }); }
    if (url.pathname === '/api/relay/orders') {
      const status = url.searchParams.get('status');
      state.searchTerms.push(url.searchParams.get('search'));
      state.simQueries.push(url.searchParams.get('include_simulation'));
      const offset = Number(url.searchParams.get('offset') || 0);
      state.calls.push(`orders:${status || 'all'}:${offset}`);
      const limit = Number(url.searchParams.get('limit') || 25);
      const length = limit === 25 && offset > 0 ? 3 : limit;
      const rows = status==='collected' && completed
        ? [order(99,{status:'collected',cash_pending:false,payment_status:'paid'})]
        : empty ? [] : Array.from({ length }, (_, i) => order(i + 1 + offset));
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ total:rows.length, orders:rows }) });
    }
    const m = url.pathname.match(/^\/api\/relay\/orders\/r-(\d+)$/);
    if (m) {
      state.calls.push(`order:r-${m[1]}`);
      if (failDetail) return route.fulfill({ status:500, contentType:'application/json', body:'{"error":"Erreur interne du serveur"}' });
      const value=detail(Number(m[1]));
      if (completed && m[1]==='99') { value.order.status='collected'; value.paiement.cash_pending=false; }
      return route.fulfill({ contentType:'application/json', body:JSON.stringify(value) });
    }
    return route.fulfill({ status:404, body:'{}' });
  });
  await page.setViewportSize({ width:1672, height:941 });
  await page.goto(`${ORIGIN}/admin/relais-live${search}`);
  await page.evaluate(role => window.KomerceCanonicalRelayLive.mount({ root:document.getElementById('root'), user:role?{role}:null }),role);
  return state;
}

const crumb = (page) => page.locator('.kir-breadcrumb').innerText().then((s) => s.replace(/\s*›\s*/g, ' > ').replace(/\s+/g, ' ').trim());

test.describe('Cockpit Relais — navigation canonique', () => {
  test('Flux Relais : Kanban quatre étapes et états physiques non inventés', async ({page})=>{
    const state=await mountRelay(page);
    await expect(page.locator('.kmc-relay-flow-heading h1')).toHaveText('Préparer les colis');
    await expect(page.locator('.kmc-relay-work-table th[data-relay-lane]')).toHaveCount(4);
    for(const lane of ['transit','receive','organize','available']) {
      await expect(page.locator('[data-relay-lane="'+lane+'"]')).toBeVisible();
    }
    await expect(page.locator('.kmc-relay-main-nav a[aria-current="page"]')).toHaveText('Flux Relais');
    await expect(page.locator('[data-relay-workboard-order="r-1"] [data-relay-stage="organize"]')).toContainText('Rangement libre');
    await expect(page.locator('[data-relay-workboard-order="r-1"] [data-relay-stage="available"]')).toHaveAttribute('href','/admin/relais-live?view=remises&market=KM');
    await expect(page.locator('.kmc-relay-work-table')).not.toContainText('Remise enregistrée');
    expect(state.writes).toHaveLength(0);
  });

  test('Flux vide : prévision et actions affichées, sans fausse réception',async({page})=>{
    await mountRelay(page,'',{empty:true});
    const board=page.locator('.kmc-relay-flow');
    await expect(board.locator('[data-relay-workboard-order]')).toHaveCount(0);
    await expect(board.locator('[data-relay-empty-lane]')).toHaveCount(4);
    await expect(board).toContainText('Flux sans commande active');
    await expect(board.getByRole('link',{name:/Contrôler les arrivages/})).toHaveAttribute('href','/admin/relais-live?view=execute&focus=shipments');
    await expect(board.getByRole('link',{name:/Ouvrir les remises/})).toHaveAttribute('href','/admin/relais-live?view=remises');
  });

  test('Flux -> dossier -> liste -> retour et historique, sans écriture',async({page})=>{
    const state=await mountRelay(page);
    await page.locator('[data-relay-workboard-order="r-1"] .kmc-relay-work-reference').click();
    await expect(page).toHaveURL(/sel=r-1/);
    await expect(page.locator('[data-relay-detail]')).toContainText('KMC-0101');
    await page.locator('[data-relay-detail] [aria-label="Fermer le dossier"]').click();
    await expect(page.locator('[data-relay-detail]')).toHaveCount(0);
    await page.locator('.kmc-relay-main-nav a',{hasText:'Historique'}).click();
    await expect(page).toHaveURL(/list=collected/);
    await expect(page.locator('.kmc-relay-main-nav a[aria-current="page"]')).toHaveText('Historique');
    await page.goBack();
    await expect(page.locator('.kmc-relay-flow')).toBeVisible();
    expect(state.writes).toHaveLength(0);
  });

  test('Incidents & SAV : file dédiée et retour au dossier de commande',async({page})=>{
    await mountRelay(page);
    await page.locator('.kmc-relay-main-nav a',{hasText:'Incidents & SAV'}).click();
    await expect(page).toHaveURL(/view=incidents/);
    await expect(page.locator('[data-relay-incident="i-1"]')).toContainText('Emballage endommagé');
    await expect(page.locator('.kmc-relay-main-nav a[aria-current="page"]')).toHaveText('Incidents & SAV');
    await page.locator('[data-relay-incident="i-1"] a',{hasText:'Ouvrir le dossier'}).click();
    await expect(page).toHaveURL(/from=incidents/);
    await expect(page.locator('.kir-back')).toContainText('Retour aux incidents');
  });

  test('Signaler un incident utilise le seul writer autorisé du cockpit',async({page})=>{
    const state=await mountRelay(page,'?view=order&order=r-1',{role:'agent_relais'});
    await page.getByText('Signaler un incident sur cette commande').click();
    const form=page.locator('[data-relay-incident-form]');
    await form.locator('select[name="type"]').selectOption('colis_endommage');
    await form.locator('textarea[name="description"]').fill('Carton humide constaté au comptoir');
    await form.getByRole('button',{name:'Enregistrer le signalement'}).click();
    await expect(form.locator('[role="status"]')).toContainText('Signalement enregistré');
    expect(state.writes).toEqual(['POST /api/relay/orders/r-1/incident']);
  });

  test('Droits lecture seule : pas de formulaire si rôle non opérationnel',async({page})=>{
    const state=await mountRelay(page,'?view=order&order=r-1',{role:'finance'});
    await expect(page.locator('[data-relay-incident-form]')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });

  test('Erreur détail : préserver une navigation cohérente vers le flux',async({page})=>{
    await mountRelay(page,'?view=order&order=r-1&from=in_transit',{failDetail:true});
    await expect(page.locator('.kir-error')).toContainText('Le suivi Relais reste accessible');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Colis en transit');
  });

  test('Recherche et pagination de dossiers : filtres transmis au serveur',async({page})=>{
    const state=await mountRelay(page,'?view=orders&list=available&search=Moroni');
    await expect(page.locator('#kmc-relay-search')).toHaveValue('Moroni');
    expect(state.searchTerms).toContain('Moroni');
    await page.getByText('Plus anciens →').click();
    await expect(page).toHaveURL(/offset=25/);
    await expect(page).toHaveURL(/search=Moroni/);
  });

  test('Recette opt-in réservée admin et sans effet sur les actions',async({page})=>{
    const state=await mountRelay(page,'',{role:'admin'});
    const toggle=page.locator('[data-sim-toggle]');
    await expect(toggle).toHaveText('Inclure la recette');
    await toggle.click();
    await expect(page).toHaveURL(/sim=1/);
    expect(state.simQueries).toContain('1');
    expect(state.writes).toEqual([]);
  });

  for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
    test('Responsive '+name+' : Kanban scrolle dans son conteneur',async({page})=>{
      await mountRelay(page);
      await page.setViewportSize({width,height});
      await expect(page.locator('.kmc-relay-work-scroll')).toHaveCSS('overflow-x','auto');
      const d=await page.evaluate(()=>({actual:document.documentElement.scrollWidth,viewport:window.innerWidth}));
      expect(d.actual).toBeLessThanOrEqual(d.viewport+1);
    });
  }
});
