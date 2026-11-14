/**
 * @komerce-arch-lite
 * @role hub-v1-clicks-spec
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Rejouer par de vrais clics Chromium (roles reels, ecrans canoniques) les gestes Hub V1 deja prouves par API, sur une fixture E2E KM.
 * @impact-areas dashboard, hub, relay, shipping-customs, staging-only
 *
 * Verdicts : CLICK_PASS (requete du clic 2xx), CLICK_FAIL (geste present, requete refusee/erreur),
 * NOT_REACHABLE_IN_UI (la route marche mais l'ecran n'offre pas le geste). Une capture par etape ; aucune video.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const RUN8 = String(process.env.E2E_PROOF_RUN8 || '').toUpperCase();
const OUT = path.resolve('test-results/hub-v1-clicks');
const SHOTS = path.join(OUT, 'captures');
const EVID = path.join(OUT, 'evidence.json');
// Marche de la fixture (defaut KM = comportement historique). Libelles du selecteur de marche du back-office.
const MARKET_CODE = String(process.env.E2E_CLICKS_MARKET || 'KM').toUpperCase();
const MARKET_LABELS = { KM: 'KM · Comores', CM: 'CM · Cameroun', CG: 'CG · Congo-Brazzaville' };
const MARKET_LABEL = MARKET_LABELS[MARKET_CODE];
if (!MARKET_LABEL) throw new Error('E2E_CLICKS_MARKET invalide : ' + MARKET_CODE);
const evidence = { schema: 'komerce-hub-v1-clicks/1', run8: RUN8, base: null, gestures: [], tests: [] };
const save = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(EVID, JSON.stringify(evidence, (k, v) => (k === 'json' ? undefined : v), 2) + '\n'); };
const shared = { bagRefs: {}, box: null, shipment: null, states: {} }; // states : une connexion par role (evite le rate-limit du login)
let counter = 0;

const ROLE_ENV = { hub: 'E2E_AGENT_HUB_', relais: 'E2E_AGENT_RELAIS_', admin: 'E2E_ADMIN_', transitaire: 'E2E_AGENT_TRANSITAIRE_' };

async function login(browser, baseURL, role) {
  const email = process.env[ROLE_ENV[role] + 'EMAIL'], password = process.env[ROLE_ENV[role] + 'PASSWORD'];
  expect(email && password, `identifiants ${role}`).toBeTruthy();
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, ...(shared.states[role] ? { storageState: shared.states[role] } : {}) });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  if (shared.states[role]) return { ctx, page };
  await page.goto('/login.html');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const resp = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.locator('#btn-submit').click();
  expect((await resp).status()).toBe(200);
  await page.waitForURL((u) => u.pathname !== '/login.html', { timeout: 20000 });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(1500);
  shared.states[role] = await ctx.storageState();
  return { ctx, page };
}

async function openMarket(page, url) {
  // ERR_ABORTED : une redirection client (login, portail) peut couper la navigation en cours -> on la laisse finir puis on reessaie.
  for (let attempt = 0; ; attempt++) {
    try {
      // Shipping & Customs is explicitly market-scoped for ALL central roles,
      // including the transitaire: with no ?market=, the canonical shell
      // correctly stays on "Choisir un marché…" (L1 no implicit fallback).
      // This is only a UI selection, not an authorization bypass.
      const selectedUrl = url.startsWith('/admin/workspaces/shipping-customs')
        ? url + (url.includes('?') ? '&' : '?') + 'market=' + MARKET_CODE
        : url;
      await page.goto(selectedUrl, { waitUntil: 'domcontentloaded' }); break;
    }
    catch (e) { if (attempt >= 3 || !/ERR_ABORTED|interrupted/i.test(String(e.message))) throw e; await page.waitForLoadState('load').catch(() => {}); await page.waitForTimeout(1500); }
  }
  // Expéditions & Douane n'utilise pas toujours le <select> du Workspace
  // opérations : c'est le dossier international visible qui fait foi.
  // Ne jamais valider une redirection vers la vitrine ou une page vide.
  if (url.startsWith('/admin/workspaces/shipping-customs')) {
    await expect(page).toHaveURL(/\/admin\/workspaces\/shipping-customs(?:\/|\?|$)/, { timeout: 20000 });
    // Le panneau des expéditions n'est créé qu'APRÈS la sélection du marché
    // lorsqu'un sélecteur est présent. Ne jamais attendre le panneau d'abord.
    // Market already selected through the URL; do not operate an arbitrary
    // first <select> (it might belong to a customs form, not market picker).
    await expect(page).toHaveURL(new RegExp('(?:[?&])market='+MARKET_CODE+'(?:&|$)'));
    await page.locator('[data-international-journey]').first().waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }
  const sel = page.locator('select').first();
  await sel.waitFor({ timeout: 20000 });
  await sel.selectOption({ label: MARKET_LABEL }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function shot(page, key) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = `${String(++counter).padStart(2, '0')}-${key.replace(/[^a-z0-9]+/gi, '_')}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) }).catch(() => {});
  return file;
}

/**
 * Un geste = un clic. `click` est une fonction qui effectue le clic (et le remplissage prealable) ;
 * `match` identifie la requete declenchee. Renvoie { verdict, http }.
 */
async function gesture(page, { key, role, route, ui, match, method = 'POST', click, absent }) {
  const row = { key, role, route, ui, verdict: 'CLICK_FAIL', http: null };
  evidence.gestures.push(row);
  try {
    if (absent) { row.verdict = 'NOT_REACHABLE_IN_UI'; row.note = absent; row.capture = await shot(page, key); return row; }
    const wait = page.waitForResponse((r) => r.request().method() === method && match(new URL(r.url()).pathname), { timeout: 25000 });
    await click();
    const r = await wait;
    row.http = r.status();
    row.json = await r.json().catch(() => null);
    row.verdict = r.status() >= 200 && r.status() < 300 ? 'CLICK_PASS' : 'CLICK_FAIL';
    if (row.verdict === 'CLICK_FAIL') row.note = String((await r.text().catch(() => '')).slice(0, 160));
    await page.waitForTimeout(800);
  } catch (e) {
    row.note = String(e.message).split('\n')[0].slice(0, 200);
  }
  row.capture = await shot(page, key);
  const { json, ...pub } = row; Object.assign(row, { json }); // json garde pour l'usage interne, retire a la sauvegarde
  save();
  return row;
}

let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const KM = `/api/admin/workspaces/operations/market/${MARKET_CODE}`; // nom historique : prefixe du marche de la fixture

test.describe.serial(`Hub V1 : clics reels Chromium (${MARKET_CODE}, fixture E2E)`, () => {
  test.beforeAll(async () => {
    const baseURL = process.env.E2E_CLICKS_BASE_URL || 'https://komerce-backend-production.up.railway.app';
    expect(RUN8).toMatch(/^[A-F0-9]{8}$/);
    db = require('../../db');
    // Les gestes de cette spec sont des mutations métier, même si le
    // navigateur se contente de cliquer : vérification avant le premier login.
    const origin = new URL(baseURL).origin;
    if (origin === 'https://komerce-backend-production.up.railway.app') {
      await require('../../scripts/recette/hub-v1-staging-target-authorization')
        .authorizeOfficialStaging({ db, run: RUN8 });
      // The owner expressly accepted all staging data as disposable on
      // 10 November 2026. Full visual certification may distribute this
      // staging market only in the guarded, owner-run E2E campaign.
      if(process.env.E2E_CLICKS_ALLOW_DISTRIBUTION==='1'){
        const authorized=require('../../scripts/recette/hub-v1-staging-transactional-preflight')
          .disposableStagingAuthorized(process.env);
        expect(authorized,'owner-only disposable staging required for full distribution').toBe(true);
      }
    } else {
      // La répétition locale doit utiliser une base jetable, jamais un backend
      // localhost connecté silencieusement à Railway staging.
      require('../../scripts/recette/hub-v1-certification-runner')
        .assertEphemeralTarget(process.env.DATABASE_URL, []);
    }
  });
  test.afterEach(async ({}, info) => {
    evidence.tests.push({ title: info.title, status: info.status });
    // Une exception de navigation AVANT le helper gesture() est aussi un FAIL.
    // Sans cette preuve, toutes les requêtes précédentes peuvent laisser un
    // evidence.json trompeusement vert malgré un test Playwright en erreur.
    if (info.status !== 'passed') {
      evidence.gestures.push({
        key: 'test:' + info.title.slice(0, 90), role: 'harness', route: null,
        verdict: info.status === 'skipped' ? 'NOT_RUN' : 'CLICK_FAIL',
        http: null, note: String(info.error?.message || info.status).split('\n')[0].slice(0, 250),
      });
    }
    save();
  });
  test.afterAll(async () => {
    if (process.env.E2E_CLICKS_ALLOW_DISTRIBUTION === '1') {
      const successfulTests = evidence.tests.filter(t => t.status === 'passed').length;
      if (successfulTests !== 10) evidence.gestures.push({
        key: 'full-suite:coverage', role: 'harness', route: null, verdict: 'NOT_RUN', http: null,
        note: 'campagne physique incomplète : ' + successfulTests + '/10 tests Playwright réussis',
      });
    }
    const failures=evidence.gestures.filter((row)=>row.verdict!=='CLICK_PASS');
    evidence.verdict=failures.length||!evidence.gestures.length
      ? 'CHROMIUM_CLICKS_BLOCKED_NOT_PROVEN'
      : 'CHROMIUM_CLICKS_RECORDED_SQL_READBACK_PENDING';
    evidence.blockers=failures.map((row)=>({key:row.key,verdict:row.verdict,note:row.note}));
    evidence.never_claims='G2_CHROMIUM_STAGING_PASS';
    save();
    if(db && db.pool && db.pool.end)await db.pool.end();
    if(evidence.verdict==='CHROMIUM_CLICKS_BLOCKED_NOT_PROVEN')
      throw new Error('HUB_V1_CHROMIUM_GESTURES_NOT_PROVEN:'+failures.map((row)=>row.key).join(','));
  });

  test('Hub : reception fournisseur (ecran Receptions)', async ({ browser, baseURL }) => {
    evidence.base = baseURL;
    const { ctx, page } = await login(browser, baseURL, 'hub');
    await openMarket(page, '/admin/hub-live?view=execute');
    await page.getByRole('tab', { name: 'Réceptions' }).click();
    await page.waitForSelector('[data-receive-po]', { timeout: 20000 });
    const cards = page.locator('[data-receive-po]').filter({ hasText: new RegExp(`E2E-HUB-V1 produit . ${RUN8}`) });
    const n = await cards.count();
    expect(n, 'cartes de reception de la fixture').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const card = page.locator('[data-receive-po]').filter({ hasText: new RegExp(`E2E-HUB-V1 produit . ${RUN8}`) }).first();
      const poId = await card.getAttribute('data-receive-po');
      const [code] = await q(`SELECT c.code FROM product_sku_physical_codes c
                               WHERE c.product_sku_id = (SELECT product_sku_id FROM purchase_lines WHERE purchase_order_id=$1 AND product_sku_id IS NOT NULL LIMIT 1)
                               ORDER BY (c.trust='CONFIRMED') DESC LIMIT 1`, [poId]);
      const scan = card.locator('input.kmc-workspace-receive-scan-input');
      await scan.fill(code.code);
      const scanResp = page.waitForResponse((r) => r.url().includes('/supply/physical-code'));
      await scan.press('Enter');
      await scanResp;
      const qty = card.locator('input.kmc-workspace-receive-qty').first();
      await qty.fill(await qty.getAttribute('max'));
      await gesture(page, {
        key: `hub:receive:${poId.slice(0, 8)}`, role: 'agent_hub', route: 'POST /api/scans/hub/receive',
        ui: 'operations-workspace.js:createReceptionCard (Enregistrer la réception)', match: (p) => p === '/api/scans/hub/receive',
        click: () => card.locator('[data-workspace-action="receive-supplier"]').click(),
      });
      await page.waitForTimeout(1500);
    }
    await ctx.close();
  });

  test('Hub : sacs clients KOM-101 et KOM-102 (creer, deposer par scan, fermer)', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'hub');
    await openMarket(page, '/admin/hub-live?view=execute');
    for (const suffix of ['KOM-101', 'KOM-102']) {
      const ref = `E2E-HUB-V1-${RUN8}-${suffix}`;
      await page.getByText(ref, { exact: true }).first().click();
      await page.waitForTimeout(1200);
      const create = page.locator('[data-hlc-action="create-bag"]').filter({ hasText: ref });
      await gesture(page, {
        key: `hub:bag-create:${suffix}`, role: 'agent_hub', route: `POST ${KM}/bags`, ui: 'hub-live-cockpit.js:673 (Préparer le sac)',
        match: (pp) => pp === `${KM}/bags`, click: () => create.click(),
        absent: (await create.count()) === 0 ? 'bouton Préparer le sac absent' : null,
      }).then((g) => { const u = g.json && (g.json.physical_unit || (g.json.result && g.json.result.physical_unit)); if (u) shared.bagRefs[suffix] = u.reference; });
      await page.waitForTimeout(2500);
      // Le panneau de preparation des sacs est dans « Détails physiques exhaustifs » (details replie) : on l'ouvre comme l'utilisateur.
      await page.locator('[data-hlc-action="open-physical-details"]').first().click().catch(() => {});
      await page.waitForTimeout(1500);
      const holder = () => page.locator('.kmc-hub-bag-open').filter({ hasText: ref });
      const reveal = async () => {
        // Chaque rechargement du dossier replie « Détails physiques exhaustifs » : on le rouvre si le panneau n'est plus visible.
        if (!(await holder().first().isVisible().catch(() => false))) {
          await page.locator('[data-hlc-action="open-physical-details"]').first().click().catch(() => {});
          await page.waitForTimeout(1200);
        }
      };
      for (let guard = 0; guard < 6; guard++) {
        await reveal();
        const h = holder();
        if (!(await h.count())) break;
        const opts = h.locator('select option');
        if (!(await opts.count())) break;
        const label = await opts.first().textContent();
        const avail = Number((label.match(/·\s*(\d+) disponible/) || [])[1] || 1);
        const progress = (await h.locator('.kmc-workspace-muted').first().textContent()).match(/(\d+) \/ (\d+)/);
        const left = progress ? Number(progress[2]) - Number(progress[1]) : 1;
        const items = await q(`SELECT p.name, (SELECT c.code FROM product_sku_physical_codes c WHERE c.product_sku_id = pl.product_sku_id ORDER BY (c.trust='CONFIRMED') DESC LIMIT 1) AS code
                                 FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN purchase_lines pl ON pl.order_item_id = oi.id
                                WHERE oi.order_id = (SELECT id FROM orders WHERE reference=$1)`, [ref]);
        const item = items.find((i) => label.includes(i.name)) || items[0];
        await h.locator('[data-hub-bag-code]').fill(item.code);
        await h.locator('input[type="number"]').fill(String(Math.min(avail, left)));
        await gesture(page, {
          key: `hub:bag-deposit:${suffix}`, role: 'agent_hub', route: `POST ${KM}/bags/:id/deposit`, ui: 'operations-workspace.js:1084 (Déposer dans le sac)',
          match: (pp) => /\/bags\/[^/]+\/deposit$/.test(pp), click: () => h.locator('[data-workspace-action="scan-bag-deposit"]').click(),
        });
        await page.waitForTimeout(2500);
      }
      await reveal();
      const close = holder().locator('[data-workspace-action="close-customer-bag"]');
      await gesture(page, {
        key: `hub:bag-close:${suffix}`, role: 'agent_hub', route: `POST ${KM}/bags/:id/close`, ui: 'operations-workspace.js:1100 (Fermer le sac)',
        match: (pp) => /\/bags\/[^/]+\/close$/.test(pp), click: () => close.click(),
        absent: (await close.count()) === 0 ? 'bouton Fermer le sac absent (contenu incomplet)' : null,
      });
      await page.waitForTimeout(2500);
    }
    await ctx.close();
  });

  test('Hub : repartition, KOM-BOX, mise en caisse des sacs, avancement, ouverture du dossier d\'expedition', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'hub');
    await openMarket(page, '/admin/hub-live?view=execute');
    const bagRef = async (suffix) => shared.bagRefs[suffix] || (await q(`SELECT u.reference FROM hub_physical_units u JOIN orders o ON o.id = u.order_id WHERE o.reference = $1 ORDER BY u.created_at DESC LIMIT 1`, [`E2E-HUB-V1-${RUN8}-${suffix}`]))[0]?.reference;
    // Repartition (ecran Actions Hub) : n'affecte que les commandes pretes du marche -> reservee au mode allow_distribution.
    await page.getByRole('tab', { name: 'Actions Hub' }).click();
    await page.waitForTimeout(1500);
    const dist = page.locator('[data-workspace-action="run-distribution"]');
    if (process.env.E2E_CLICKS_ALLOW_DISTRIBUTION === '1') {
      await gesture(page, { key: 'hub:distribution-run', role: 'agent_hub', route: `POST ${KM}/distribution/run`, ui: 'operations-workspace.js:1289 (Répartir ce marché)',
        match: (pp) => pp === `${KM}/distribution/run`, click: () => dist.click(), absent: (await dist.count()) === 0 ? 'bouton Répartir absent' : null });
    } else {
      evidence.gestures.push({ key: 'hub:distribution-run', role: 'agent_hub', route: `POST ${KM}/distribution/run`, verdict: 'NOT_RUN', note: 'E2E_CLICKS_ALLOW_DISTRIBUTION != 1 (la repartition touche toutes les commandes pretes du marche)' });
    }
    await page.getByRole('tab', { name: 'Dossiers' }).click();
    await page.waitForTimeout(1500);
    const reveal = async () => {
      if (!(await page.locator('[data-supply-boxes]').first().isVisible().catch(() => false))) {
        await page.locator('[data-hlc-action="open-physical-details"]').first().click().catch(() => {});
        await page.waitForTimeout(1200);
      }
    };
    await reveal();
    const created = await gesture(page, { key: 'hub:box-create', role: 'agent_hub', route: `POST ${KM}/boxes`, ui: 'operations-workspace.js:992 (Créer une KOM-BOX)',
      match: (pp) => pp === `${KM}/boxes`, click: () => page.locator('[data-workspace-action="create-box"]').first().click() });
    const unit = created.json && (created.json.physical_unit || (created.json.result && created.json.result.physical_unit));
    expect(unit && unit.reference, 'reference de la KOM-BOX creee').toBeTruthy();
    shared.box = unit.reference;
    await page.waitForTimeout(2500);
    for (const suffix of ['KOM-101', 'KOM-102']) {
      await reveal();
      const row = page.locator('tr').filter({ hasText: shared.box });
      const ref = await bagRef(suffix);
      await row.locator('[data-hub-box-scan]').fill(shared.box);
      await row.locator('[data-hub-bag-scan]').fill(ref);
      await row.locator('[data-hub-bag-scan]').press('Enter');
      const sel = row.locator('select').last();
      await page.waitForTimeout(500);
      // Mode manuel explicitement motivé : saisir la preuve AVANT le clic.
      // Cette campagne ne prétend pas valider un vrai scan matériel.
      if ((await sel.locator('option').count()) > 1) await sel.selectOption('MANUAL');
      const method = await row.locator('[data-hub-box-evidence-method]').inputValue();
      if (method === 'MANUAL') {
        await row.locator('[data-hub-box-manual-proof]').fill(`RECETTE-MANUELLE-${RUN8}-${suffix}`);
      }
      const put = row.locator('[data-workspace-action="put-bag-in-box"]');
      const placement = await gesture(page, { key: `hub:box-add-bag:${suffix}`, role: 'agent_hub', route: `POST ${KM}/boxes/:id/bags`, ui: 'operations-workspace.js:1160 (Placer le sac)',
        match: (pp) => /\/boxes\/[^/]+\/bags$/.test(pp), click: () => put.click(), absent: (await put.count()) === 0 ? 'geste Placer le sac absent' : null });
      placement.evidence_method = method;
      placement.scope_note = method === 'MANUAL' ? 'Preuve de saisie manuelle ; scan physique non certifié' : 'Saisie de références dans champs de scan ; aucun périphérique scanner matériel certifié';
      save();
      await page.waitForTimeout(2500);
    }
    for (let i = 0; i < 8; i++) {
      await reveal();
      const adv = page.locator('tr').filter({ hasText: shared.box }).locator('[data-workspace-action="advance-box"]');
      if (!(await adv.count())) break;
      const label = (await adv.first().textContent()).trim();
      const g = await gesture(page, { key: `hub:box-advance:${i + 1}`, role: 'agent_hub', route: `POST ${KM}/boxes/:id/advance`, ui: 'operations-workspace.js:1170 (' + label + ')',
        match: (pp) => /\/boxes\/[^/]+\/advance$/.test(pp), click: () => adv.first().click() });
      await page.waitForTimeout(2500);
      if (g.verdict !== 'CLICK_PASS') break;
    }
    await reveal();
    shared.shipment = `HTTP-EXP-${RUN8}`;
    await page.locator('input[aria-label="Référence de la nouvelle expédition"]').fill(shared.shipment);
    const pick = page.locator('tr').filter({ hasText: shared.box }).locator('input[type="checkbox"]');
    if (await pick.count()) await pick.first().check();
    await gesture(page, { key: 'hub:shipment-open', role: 'agent_hub', route: `POST ${KM}/boxes/shipment`, ui: 'operations-workspace.js:960 (Ouvrir le dossier)',
      match: (pp) => pp === `${KM}/boxes/shipment`, click: () => page.locator('[data-workspace-action="create-shipment-from-boxes"]').click(),
      absent: (await pick.count()) === 0 ? 'carton non selectionnable (pas PACKED/DISPATCHED)' : null });
    await ctx.close();
  });

  // ---------- Expeditions & Douane : parcours international (clics, role par role) ----------
  const SC = `/api/admin/workspaces/shipping-customs/market/${MARKET_CODE}/international`;
  const SHIP = () => `HTTP-EXP-${RUN8}`;
  async function openJourney(page, tab) {
    await openMarket(page, '/admin/workspaces/shipping-customs');
    await page.locator('[data-international-journey]').first().waitFor({ timeout: 25000 });
    if (tab) { await page.locator('.kmc-journey-tab', { hasText: tab }).click(); await page.waitForTimeout(1200); }
    const row = page.locator('tr').filter({ hasText: SHIP() });
    await row.first().waitFor({ timeout: 20000 });
    const open = row.locator('button', { hasText: /Consulter|Ouvert/ });
    if ((await open.first().textContent()).trim() === 'Consulter') { await open.first().click(); await page.waitForTimeout(1500); }
  }
  // Un formulaire de tache (details > summary) : ouvrir, remplir par nom de champ, Enregistrer.
  async function journeyTask(page, { key, role, summary, fields = {}, tailMatch, tab, route, ui }) {
    const task = page.locator('details.kmc-journey-task').filter({ has: page.locator('summary', { hasText: summary }) });
    const present = (await task.count()) > 0;
    if (present) {
      await task.first().locator('summary').click();
      for (const [name, value] of Object.entries(fields)) {
        const ctl = task.first().locator(`[name="${name}"]`);
        if ((await ctl.evaluate((e) => e.tagName)) === 'SELECT') await ctl.selectOption(value); else await ctl.fill(value);
      }
    }
    return gesture(page, {
      key, role, route, ui, match: (pp) => pp === `${SC}/${SHIP()}/${tailMatch}`,
      click: () => task.first().locator('button[type="submit"]').click(),
      absent: present ? null : `tache « ${summary} » absente de l'ecran pour ce role (onglet ${tab || 'courant'})`,
    });
  }
  const transitionOf = (stageLabel) => `Confirmer : ${stageLabel}`;
  const SCR = 'international-journey-panel.js (formulaire de tache)';

  test('Expeditions & Douane : Hub remet au transitaire', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'hub');
    await openJourney(page, 'Transport & fret');
    await journeyTask(page, { key: 'journey:handed_over', role: 'agent_hub', summary: transitionOf('Remis au transitaire'), tab: 'Transport & fret',
      fields: { forwarder_name: 'E2E Transitaire', transport_mode: 'sea', proof_ref: `CLK-HANDED-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await ctx.close();
  });

  test('Expeditions & Douane : transitaire reel (reception, suivi, transit, arrivee)', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'transitaire');
    await page.waitForLoadState('load').catch(() => {}); await page.goto('/admin/workspaces/shipping-customs', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);
    if (new URL(page.url()).pathname === '/') {
      // Constat, pas un contournement : le portail renvoie le transitaire a la vitrine (GET /api/admin/dashboard/context -> 403 dashboard_access_denied).
      const cap = await shot(page, 'transitaire:redirected_to_storefront');
      for (const k of ['forwarder_received', 'tracking', 'in_transit', 'arrived']) {
        evidence.gestures.push({ key: `journey:${k}`, role: 'agent_transitaire', route: `POST ${SC}/:ref/${k === 'tracking' ? 'tracking' : 'transition'}`, ui: SCR, verdict: 'NOT_REACHABLE_IN_UI', http: null, capture: cap,
          note: 'login transitaire -> / ; /admin/workspaces/shipping-customs redirige vers / (dashboard/context 403 dashboard_access_denied : aucun marche logistics.read delegue)' });
      }
      save(); await ctx.close(); return;
    }
    await openJourney(page, 'Transport & fret');
    await journeyTask(page, { key: 'journey:forwarder_received', role: 'agent_transitaire', summary: transitionOf('Réceptionné par le transitaire'), tab: 'Transport & fret',
      fields: { proof_ref: `CLK-FWD-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await page.waitForTimeout(2000);
    await journeyTask(page, { key: 'journey:tracking', role: 'agent_transitaire', summary: 'Suivi conteneur', tab: 'Transport & fret',
      fields: { tracking_reference: `TRK-${RUN8}`, proof_ref: `CLK-TRK-${RUN8}` }, tailMatch: 'tracking', route: `POST ${SC}/:ref/tracking`, ui: SCR });
    await page.waitForTimeout(2000);
    await journeyTask(page, { key: 'journey:in_transit', role: 'agent_transitaire', summary: transitionOf('Expédié / en transit'), tab: 'Transport & fret',
      fields: { proof_ref: `CLK-TRANSIT-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await page.waitForTimeout(2000);
    await journeyTask(page, { key: 'journey:arrived', role: 'agent_transitaire', summary: transitionOf('Arrivé'), tab: 'Transport & fret',
      fields: { proof_ref: `CLK-ARRIVED-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await ctx.close();
  });

  test('Expeditions & Douane : douane (admin) puis mainlevee', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'admin');
    await openMarket(page, '/admin/workspaces/shipping-customs');
    await openJourney(page, 'Arrivée & douane'); // la section Douane n'existe que dans cet onglet
    await page.locator('[data-workspace-action="create-customs"]').first().waitFor({ timeout: 25000 });
    const customs = `HTTP-DOU-${RUN8}`;
    // Le geste utilise 4 prompts navigateur : reference, date, CIF, colis a rattacher (vide : flux KOM-BOX, lie ensuite a l'expedition).
    const answers = [customs, new Date().toISOString().slice(0, 10), '1000', ''];
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answers.shift() ?? '') : d.accept()));
    await gesture(page, { key: 'customs:create', role: 'admin', route: `POST ${KM.replace('operations', 'shipping-customs')}/customs/shipments`, ui: 'shipping-customs-workspace.js:497 (Nouvelle expédition douane)',
      match: (pp) => pp === `${KM.replace('operations', 'shipping-customs')}/customs/shipments`, click: () => page.locator('[data-workspace-action="create-customs"]').first().click() });
    await journeyTask(page, { key: 'journey:link-customs', role: 'admin', summary: 'Lier le dossier douane', tab: 'Arrivée & douane',
      fields: { customs_reference: customs, proof_ref: `CLK-LINK-${RUN8}` }, tailMatch: 'link-customs', route: `POST ${SC}/:ref/link-customs`, ui: SCR });
    await page.waitForTimeout(2000);
    await journeyTask(page, { key: 'journey:customs-amount', role: 'admin', summary: 'Constater les droits et taxes', tab: 'Arrivée & douane',
      fields: { amount_kmf: '0', proof_ref: `CLK-DROITS-${RUN8}` }, tailMatch: 'customs-amount', route: `POST ${SC}/:ref/customs-amount`, ui: SCR });
    await page.waitForTimeout(2000);
    await journeyTask(page, { key: 'journey:customs_released', role: 'admin', summary: transitionOf('Mainlevée confirmée'), tab: 'Arrivée & douane',
      fields: { proof_ref: `CLK-MAINLEVEE-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await ctx.close();
  });

  test('Expeditions & Douane : Hub engage le transport local', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'hub');
    await openJourney(page, 'Vers les relais');
    await journeyTask(page, { key: 'journey:local_delivery', role: 'agent_hub', summary: transitionOf('Transport local'), tab: 'Vers les relais',
      fields: { proof_ref: `CLK-LOCAL-${RUN8}` }, tailMatch: 'transition', route: `POST ${SC}/:ref/transition`, ui: SCR });
    await ctx.close();
  });

  // ---------- Relais : attestation (import), remise import, circuit local ----------
  const RELAY_URL = '/admin/relais-live?view=execute';
  const parcelsOfRun = () => q(`SELECT p.reference, p.status::text AS status, o.reference AS order_ref FROM parcels p JOIN orders o ON o.id = p.order_id WHERE o.reference LIKE $1 AND p.cancelled_at IS NULL ORDER BY o.reference`, [`E2E-HUB-V1-${RUN8}-%`]);
  // Seuls l'expédition et la réception sont des actions par ligne. Le retrait exige le code client complet.
  const rowButton = (page, ref, label) => page.locator('tr', { hasText: ref }).getByRole('button', { name: label });

  test('Relais : attestation de reception de l\'expedition (import)', async ({ browser, baseURL }) => {
    const { ctx, page } = await login(browser, baseURL, 'relais');
    await openMarket(page, RELAY_URL);
    const card = page.locator(`[data-relay-shipment="${SHIP()}"]`);
    await card.waitFor({ timeout: 30000 }).catch(() => {});
    const inputs = card.locator('input[data-relay-received]');
    const n = await inputs.count();
    const submit = card.locator('[data-workspace-action="relay-shipment-receive"]');
    const absent = (await card.count()) === 0 ? `expedition ${SHIP()} absente de l'ecran Relais` : (n === 0 ? 'aucune ligne attestable (expedition non recevable)' : null);
    if (!absent) {
      for (let i = 0; i < n; i++) {
        const ph = (await inputs.nth(i).getAttribute('placeholder')) || '';
        await inputs.nth(i).fill(String(Number((ph.match(/(\d+)\s*$/) || [])[1] || 0)));
      }
      await card.locator('input[data-relay-proof]').fill(`CLK-RELAIS-${RUN8}`);
    }
    await gesture(page, { key: 'relay:attest', role: 'agent_relais', route: `POST ${KM}/relay-shipments/${SHIP()}/receive`, ui: 'operations-workspace.js:1571 (Attester la reception)',
      match: (pp) => pp === `${KM}/relay-shipments/${SHIP()}/receive`, click: () => submit.click(), absent });
    await ctx.close();
  });

  const canonicalPickupCode = (which) => {
    // Émission par le writer canonique, sur la seule fixture possédée par ce run.
    // Jamais de hash/last4 lu pour fabriquer un code, ni secret dans l'artefact.
    const code = String(process.env[which === 'IMPORT'
      ? 'HUB_PICKUP_CODE_IMPORT' : 'HUB_PICKUP_CODE_LOCAL'] || '');
    expect(code, 'code client canonique de la fixture ' + which)
      .toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    return code;
  };
  const parcelStatus = async (ref) => {
    const rows = await q(
      'SELECT status::text AS status FROM parcels WHERE reference=$1 AND cancelled_at IS NULL',
      [ref]);
    expect(rows, 'colis unique ' + ref).toHaveLength(1);
    return rows[0].status;
  };
  const activatePickupQueue = async (page) => {
    const ws = page.locator('[data-workspace-mode="relay-execution"]');
    await expect(ws).toBeVisible({ timeout: 25000 });
    const jump = ws.locator('[data-relay-execution-jump="collect"]');
    await expect(jump).toBeVisible({ timeout: 20000 });
    await jump.click();
    await expect(ws).toHaveAttribute('data-relay-active-operation', 'collect');
    await expect(ws.locator('#relay-execution-collect')).toBeVisible();
    return ws;
  };

  test('Relais : remise client import par code complet, faux code et seconde remise refusés', async ({ browser, baseURL }) => {
    const parcels = await parcelsOfRun();
    const imp = parcels.find((x) => x.order_ref === 'E2E-HUB-V1-' + RUN8 + '-KOM-101');
    expect(imp, 'colis de la fixture import KOM-101').toBeTruthy();
    expect(await parcelStatus(imp.reference)).toBe('available');
    const code = canonicalPickupCode('IMPORT');
    const { ctx, page } = await login(browser, baseURL, 'relais');
    await openMarket(page, RELAY_URL);
    const ws = await activatePickupQueue(page);
    await expect(ws.locator('#relay-execution-collect tr').filter({ hasText: imp.reference })).toBeVisible({ timeout: 20000 });
    const input = ws.locator('[data-pickup-code-input]');
    const confirm = ws.locator('[data-pickup-code-confirm]');
    await expect(confirm).toBeVisible();
    // Mauvais code complet = refus 4xx, aucune mutation.
    const bad = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    await input.fill(bad);
    const badResponse = page.waitForResponse(r =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/scans/collect');
    await confirm.click();
    const rejected = await badResponse;
    expect(rejected.status(), 'faux code rejeté').toBeGreaterThanOrEqual(400);
    expect(rejected.status(), 'rejet métier, non 5xx').toBeLessThan(500);
    expect(await parcelStatus(imp.reference), 'faux code : aucun retrait').toBe('available');
    evidence.pickup_checks = evidence.pickup_checks || [];
    evidence.pickup_checks.push({ key: 'relay:bad-full-code', expected: 'HTTP 4xx, colis available',
      http: rejected.status(), verdict: 'PASS' });

    const row = await gesture(page, {
      key: 'relay:collect', role: 'agent_relais', route: 'POST /api/scans/collect',
      ui: 'operations-workspace.js:renderPickupCodeSection (Vérifier et remettre)',
      match: p => p === '/api/scans/collect',
      click: async () => { await input.fill(code); await confirm.click(); },
    });
    expect(row.verdict, 'remise par code sur le guichet canonique').toBe('CLICK_PASS');
    expect(row.json?.parcel_reference, 'colis effectivement remis').toBe(imp.reference);
    expect(await parcelStatus(imp.reference)).toBe('collected');
    const remaining = await q(
      "SELECT count(*)::int AS n FROM parcels WHERE order_id=(SELECT id FROM orders WHERE reference=$1) AND status='available' AND cancelled_at IS NULL",
      [imp.order_ref]);
    expect(remaining[0].n).toBe(0);
    // Après la remise, le guichet peut disparaître. Rejeu HTTP authentifié ;
    // ce n'est pas un deuxième clic Chromium fictif.
    const duplicate = await page.request.post('/api/scans/collect', { data: { pickup_code: code } });
    expect(duplicate.status(), 'deuxième remise impossible').toBeGreaterThanOrEqual(400);
    expect(duplicate.status()).toBeLessThan(500);
    expect(await parcelStatus(imp.reference), 'seconde remise : état inchangé').toBe('collected');
    evidence.pickup_checks.push({ key: 'relay:double-collect', expected: 'HTTP 4xx, colis reste collected',
      http: duplicate.status(), verdict: 'PASS' });
    await ctx.close();
  });

  test('Circuit LOCAL_STOCK : attestation physique au relais puis retrait par code', async ({ browser, baseURL }) => {
    const localOrderRef = 'E2E-HUB-V1-' + RUN8 + '-LOCAL';
    const orders = await q('SELECT id, status::text AS status, payment_status::text AS payment_status FROM orders WHERE reference=$1',
      [localOrderRef]);
    expect(orders, 'commande locale unique de ce RUN8').toHaveLength(1);
    const order = orders[0];
    expect(order.payment_status).toBe('paid');
    const before = await q(
      'SELECT pi.id FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1',
      [order.id]);
    expect(before, 'aucun colis Hub ne doit préempter la réception locale').toHaveLength(0);

    const { ctx, page } = await login(browser, baseURL, 'relais');
    await openMarket(page, RELAY_URL);
    const ws = page.locator('[data-workspace-mode="relay-execution"]');
    await expect(ws).toBeVisible({ timeout: 25000 });
    const jump = ws.locator('[data-relay-execution-jump="receive"]');
    await expect(jump).toBeVisible({ timeout: 20000 });
    await jump.click();
    await expect(ws).toHaveAttribute('data-relay-active-operation', 'receive');
    const lane = ws.locator('[data-relay-direct-local-receipts]');
    const card = lane.locator('[data-relay-local-order="' + localOrderRef + '"]');
    await expect(card, 'commande visible dans la file des réceptions directes').toBeVisible({ timeout: 20000 });
    await card.locator('[data-local-physical-proof]').check();
    await card.locator('[data-local-receipt-note]').fill('RECEPTION-PHYSIQUE-LOCALE-' + RUN8);

    const receipt = await gesture(page, {
      key: 'local:direct-receipt', role: 'agent_relais',
      route: 'POST /api/orders/:id/local-relay-receipt',
      ui: 'operations-workspace.js:renderDirectLocalReceiptSection (Attester la réception)',
      match: pp => pp === '/api/orders/' + order.id + '/local-relay-receipt',
      click: () => card.locator('[data-workspace-action="local-relay-receipt"]').click(),
    });
    expect(receipt.verdict, 'preuve physique locale par le bon relais').toBe('CLICK_PASS');
    expect(receipt.json?.status).toBe('available');
    expect(receipt.json?.parcel_reference).toBeTruthy();
    const ref = receipt.json.parcel_reference;
    expect(await parcelStatus(ref)).toBe('available');

    const physical = await q(
      "SELECT p.reference, p.shipped_at, p.in_transit_at, p.shipment_id, "+
      "pi.quantity, pi.qty_shipped, pi.qty_received, pi.qty_collected "+
      "FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id "+
      "JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1 AND p.cancelled_at IS NULL",
      [order.id]);
    expect(physical).toHaveLength(1);
    expect(physical[0].reference).toBe(ref);
    expect(physical[0].shipped_at).toBeNull();
    expect(physical[0].in_transit_at).toBeNull();
    expect(physical[0].shipment_id).toBeNull();
    expect(Number(physical[0].qty_shipped), 'aucun expédié fictif').toBe(0);
    expect(Number(physical[0].qty_received), 'réception physique complète').toBe(Number(physical[0].quantity));
    expect(Number(physical[0].qty_collected)).toBe(0);
    const proof = await q("SELECT id FROM scans WHERE order_id=$1 AND parcel_id=(SELECT id FROM parcels WHERE reference=$2) AND step='relais_received'",
      [order.id, ref]);
    expect(proof, 'attestation de réception persistée').toHaveLength(1);
    await ctx.close();

    const { ctx: collectCtx, page: collectPage } = await login(browser, baseURL, 'relais');
    await openMarket(collectPage, RELAY_URL);
    const collectWs = await activatePickupQueue(collectPage);
    await expect(collectWs.locator('#relay-execution-collect tr').filter({ hasText: ref })).toBeVisible({ timeout: 20000 });
    const code = canonicalPickupCode('LOCAL');
    const result = await gesture(collectPage, {
      key: 'local:collect', role: 'agent_relais', route: 'POST /api/scans/collect',
      ui: 'operations-workspace.js:renderPickupCodeSection (Vérifier et remettre)',
      match: pp => pp === '/api/scans/collect',
      click: async () => {
        await collectWs.locator('[data-pickup-code-input]').fill(code);
        await collectWs.locator('[data-pickup-code-confirm]').click();
      },
    });
    expect(result.verdict, 'remise locale canonique par code complet').toBe('CLICK_PASS');
    expect(result.json?.parcel_reference).toBe(ref);
    expect(await parcelStatus(ref)).toBe('collected');
    const after = await q(
      'SELECT pi.quantity,pi.qty_collected,pi.qty_received,pi.qty_shipped FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.reference=$1',
      [ref]);
    expect(after).toHaveLength(1);
    expect(Number(after[0].qty_collected)).toBe(Number(after[0].quantity));
    expect(Number(after[0].qty_received)).toBe(Number(after[0].quantity));
    expect(Number(after[0].qty_shipped)).toBe(0);
    await collectCtx.close();
  });
});
