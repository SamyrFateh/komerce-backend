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

async function mountRelay(page, search = '', { failDetail = false, empty = false, role = null } = {}) {
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
    if (url.pathname === '/api/relay/dashboard') { state.calls.push('dashboard'); const value=empty?{kpi:Object.fromEntries(Object.keys(dashboard.kpi).map(k=>[k,0])),alertes:[]}:dashboard; return route.fulfill({ contentType:'application/json', body:JSON.stringify(value) }); }
    if (url.pathname === '/api/relay/orders') {
      const status = url.searchParams.get('status');
      state.searchTerms.push(url.searchParams.get('search'));
      state.simQueries.push(url.searchParams.get('include_simulation'));
      const offset = Number(url.searchParams.get('offset') || 0);
      state.calls.push(`orders:${status || 'all'}:${offset}`);
      const limit = Number(url.searchParams.get('limit') || 25);
      const length = limit === 25 && offset > 0 ? 3 : limit;
      const rows = empty ? [] : Array.from({ length }, (_, i) => order(i + 1 + offset));
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ total:rows.length, orders:rows }) });
    }
    const m = url.pathname.match(/^\/api\/relay\/orders\/r-(\d+)$/);
    if (m) {
      state.calls.push(`order:r-${m[1]}`);
      if (failDetail) return route.fulfill({ status:500, contentType:'application/json', body:'{"error":"Erreur interne du serveur"}' });
      return route.fulfill({ contentType:'application/json', body:JSON.stringify(detail(Number(m[1]))) });
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
  test('Suivi : poste de travail direct, trois actions, supervision en un seul volet', async ({ page }) => {
    await mountRelay(page);
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Suivi');
    await expect(page.locator('.lk-pb-stage')).toHaveCount(3);
    await expect(page.locator('.kir-run-truth-grid > *')).toHaveCount(4);
    await expect(page.locator('.kmc-relay-action-tile')).toHaveCount(3);
    await expect(page.locator('[data-relay-supervision]')).not.toHaveAttribute('open','');
    await expect(page.locator('.kmc-relay-secondary-table tbody tr')).toHaveCount(5);
    await expect(page.locator('.kmc-relay-compact-hero')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await page.screenshot({ path:'test-results/relais-live-cockpit-suivi.png' });
  });

  test('Suivi → Disponibles → colis → Retour à la liste → Retour au suivi', async ({ page }) => {
    const state = await mountRelay(page);
    await page.locator('.kmc-relay-work-filters a', { hasText:'À retirer' }).click();
    await expect(page).toHaveURL(/view=orders.*list=available/);
    expect(await crumb(page)).toBe('Relais > Suivi > Disponibles au retrait');
    await expect(page.locator('.kir-back')).toHaveText('← Retour au suivi');
    await page.locator('.lk-table a', { hasText:/^KMC-0101$/ }).click();
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0101');
    expect(await crumb(page)).toBe('Relais > Suivi > Disponibles au retrait > KMC-0101');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Disponibles au retrait');
    await page.locator('.kir-back').click();
    await expect(page).toHaveURL(/view=orders.*list=available/);
    await page.locator('.kir-back').click();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    expect(state.writes).toEqual([]);
  });

  test('une fiche renvoyant HTTP 500 préserve la navigation vers la file Relais', async ({ page }) => {
    const state = await mountRelay(page, '', { failDetail:true });
    await page.locator('.kmc-relay-work-filters a', { hasText:'En route' }).click();
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-drill-head h2')).toHaveText('Détail indisponible');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Colis en transit');
    await expect(page.locator('.kir-error')).toContainText('Le suivi Relais reste accessible');
    await expect(page.locator('.kir-main')).not.toContainText('Cockpit indisponible');
    await page.locator('.kir-back').click();
    await expect(page.locator('.lk-table')).toBeVisible();
    expect(state.writes).toEqual([]);
  });

  test('Back / Forward : Suivi → liste → colis → Back → Back → Forward', async ({ page }) => {
    await mountRelay(page);
    await page.locator('.kmc-relay-work-filters a', { hasText:'En route' }).click();
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-drill-head h2')).toContainText('KMC-');
    await page.goBack();
    await expect(page).toHaveURL(/list=in_transit/);
    await page.goBack();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    await page.goForward();
    await expect(page).toHaveURL(/list=in_transit/);
  });

  test('Colis : onglet de 1er niveau sans retour ; le colis revient à Colis', async ({ page }) => {
    await mountRelay(page);
    await page.locator('.kir-domain-nav a', { hasText:'Colis' }).click();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Colis');
    await expect(page.locator('.kir-back')).toHaveCount(0);
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Colis');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Colis');
    await page.locator('.kir-back').click();
    await page.locator('.kir-domain-nav a', { hasText:'Suivi' }).click();
    await expect(page.locator('.kir-hero')).toHaveCount(1);
  });

  test('pagination : plus anciens avance le décalage, plus récents revient', async ({ page }) => {
    await mountRelay(page, '?view=orders&list=available');
    await page.getByText('Plus anciens →').click();
    await expect(page).toHaveURL(/offset=25/);
    await page.getByText('← Plus récents').click();
    await expect(page).not.toHaveURL(/offset=25/);
  });

  test('lecture seule : aucune requête d’écriture, aucun bouton', async ({ page }) => {
    const state = await mountRelay(page, '?view=order&order=r-1&from=available');
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0101');
    await expect(page.locator('.kir-main button')).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });


  test('Poste de travail : étapes visibles, dossier contextuel et lien vers le vrai atelier du marché', async ({ page }) => {
    const state = await mountRelay(page);
    const board=page.locator('.kmc-relay-work');
    await expect(board).toBeVisible();
    const row=board.locator('[data-relay-workboard-order="r-1"]');
    await expect(row.locator('[data-relay-stage="available"]')).toHaveAttribute('data-relay-stage-signal','warning');
    await expect(row.locator('[data-relay-stage="available"]')).toContainText('CASH À VÉRIFIER');
    await row.locator('[data-relay-stage="available"]').click();
    await expect(page).toHaveURL(/sel=r-1/);
    const inspector=page.locator('[data-relay-detail]');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('KMC-0101');
    await expect(inspector.locator('[data-relay-action="execute"]')).toHaveAttribute('href','/admin/relais-live?view=execute&market=KM');
    expect(state.writes).toHaveLength(0);
    await inspector.getByRole('link',{name:'Fermer le dossier'}).click();
    await expect(inspector).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('[data-relay-detail]')).toBeVisible();
    expect(state.writes).toHaveLength(0);
  });

  test('Sans colis, la file reste compacte ; le flux ancien ne gaspille plus la surface', async ({ page }) => {
    const state=await mountRelay(page, '', {empty:true});
    const board=page.locator('.kmc-relay-work');
    await expect(board).toContainText('Aucun dossier à traiter');
    await expect(board.locator('[data-relay-workboard-order]')).toHaveCount(0);
    await expect(board.getByText('Aucune commande en cours dans cette file')).toBeVisible();
    await expect(page.locator('.kmc-relay-secondary').first()).not.toHaveAttribute('open','');
    await expect(board.locator('[data-relay-shortcut="shipments"]')).toHaveAttribute('href','/admin/relais-live?view=execute&focus=shipments');
    expect(state.writes).toEqual([]);
  });

  test('Le menu ne flotte pas au scroll : inspecteur dans la grille, statut seulement en lecture', async ({ page }) => {
    const state=await mountRelay(page);
    await page.locator('[data-relay-workboard-order="r-1"] [data-relay-stage="available"]').click();
    const inspector=page.locator('.kmc-relay-work-inspector');
    const style=await inspector.evaluate(el=>({position:getComputedStyle(el).position,left:getComputedStyle(el).left}));
    expect(style.position).toBe('sticky');
    await expect(page.locator('.kmc-relay-work-scroll')).toHaveCSS('overflow-x','auto');
    expect(state.writes).toHaveLength(0);
  });


  test('les trois raccourcis orientent vers le vrai atelier sans écrire ni inventer un reçu',async({page})=>{
    const state=await mountRelay(page);
    const rail=page.locator('.kmc-relay-action-rail');
    await expect(rail.locator('[data-relay-shortcut="shipments"]')).toHaveAttribute('href','/admin/relais-live?view=execute&focus=shipments');
    await expect(rail.locator('[data-relay-shortcut="cash"]')).toHaveAttribute('href','/admin/relais-live?view=execute&focus=cash');
    await expect(rail.locator('[data-relay-shortcut="collect"]')).toHaveAttribute('href','/admin/relais-live?view=execute&focus=collect');
    await expect(rail.locator('[data-relay-shortcut="cash"]')).toContainText('3');
    expect(state.writes).toEqual([]);
  });

  test('mode recette réservé admin : contrôle lisible, activation explicitement marquée, compteurs conservés',async({page})=>{
    const state=await mountRelay(page,'',{role:'admin'});
    const toggle=page.locator('[data-sim-toggle]');
    await expect(toggle).toHaveText('Inclure la recette');
    await expect(toggle).toHaveAttribute('aria-checked','false');
    await expect(toggle).toHaveCSS('text-decoration-line','none');
    await toggle.click();
    await expect(page).toHaveURL(/sim=1/);
    await expect(page.locator('[data-sim-toggle]')).toHaveText('Recette incluse');
    await expect(page.locator('[data-sim-toggle]')).toHaveAttribute('aria-checked','true');
    expect(state.simQueries).toContain('1');
    expect(state.writes).toEqual([]);
  });

  test('recherche dans les dossiers : filtre transmis au backend, pagination et retour préservés',async({page})=>{
    const state=await mountRelay(page,'?view=orders&list=available&search=Moroni');
    await expect(page.locator('#kmc-relay-search')).toHaveValue('Moroni');
    expect(state.searchTerms).toContain('Moroni');
    await page.getByText('Plus anciens →').click();
    await expect(page).toHaveURL(/search=Moroni/);
    await expect(page).toHaveURL(/offset=25/);
    await expect(page.locator('#kmc-relay-search')).toHaveValue('Moroni');
  });

  for (const [name, width, height] of [['1280', 1280, 800], ['1024', 1024, 768], ['mobile', 390, 844]]) {
    test(`responsive ${name} : aucun débordement`, async ({ page }) => {
      await mountRelay(page);
      await page.setViewportSize({ width, height });
      await expect(page.locator('.lk-pb-stage')).toHaveCount(3);
      const geo = await page.evaluate(() => ({ scroll:document.documentElement.scrollWidth, inner:window.innerWidth }));
      expect(geo.scroll).toBeLessThanOrEqual(geo.inner);
    });
  }
});
