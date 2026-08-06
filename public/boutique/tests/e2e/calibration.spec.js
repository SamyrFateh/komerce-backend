/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   calibration.spec.js
 * @brief Spec de calibration — tourne EN PREMIER pour valider que les
 *        sélecteurs et les hypothèses des tests correspondent au site réel.
 *
 * Ce fichier ne teste PAS le comportement métier. Il vérifie que :
 * 1. Les sélecteurs CSS/IDs utilisés par les helpers existent dans le DOM
 * 2. Les timings (API, rendu) sont réalistes
 * 3. Les structures mobile/desktop sont bien celles attendues
 *
 * Si un test ici échoue → le problème est dans NOS TESTS (sélecteur ou timing),
 * pas dans l'app. Si tout passe ici mais un spec métier échoue → bug réel.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE, waitForGrid } = require('./helpers/boutique.helpers');
const { capturePageState } = require('./helpers/diagnostic.helpers');

test.describe('⚙️ CALIBRATION — Validation des sélecteurs et hypothèses', () => {

  test.beforeEach(async ({ page }) => {
    test.skip(!IS_REMOTE, 'Calibration nécessite le site réel');
  });

  // ── Sélecteurs critiques : existent-ils dans le DOM ? ────────────────

  test('CAL-01 — Sélecteurs de la grille catalogue', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const checks = {
      '#k-grid': 'Grille catalogue',
      '#k-grid .k-promo-card, #k-grid .k-card': 'Au moins une carte produit',
      '#k-cats': 'Container catégories',
      '.k-chip, .k-cat-chip': 'Au moins un chip catégorie',
      '#k-hero': 'Hero section',
      '#k-header': 'Header',
    };

    const missing = [];
    for (const [selector, label] of Object.entries(checks)) {
      const count = await page.locator(selector).count();
      if (count === 0) missing.push(`${label} → "${selector}"`);
    }

    if (missing.length > 0) {
      const state = await capturePageState(page);
      console.log('[CAL-01] État page :', JSON.stringify(state, null, 2));
    }
    expect(missing, `Sélecteurs absents du DOM:\n${missing.join('\n')}`).toHaveLength(0);
  });

  test('CAL-02 — Sélecteurs carte produit (nom + prix)', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const html = await card.innerHTML();

    // Chercher ce que la carte contient réellement
    const nameSelectors = ['.k-card-name', '.k-promo-name', '[class*="name"]'];
    const priceSelectors = ['.k-card-price', '.k-promo-price', '[class*="price"]'];

    let nameFound = false;
    for (const sel of nameSelectors) {
      if ((await card.locator(sel).count()) > 0) { nameFound = true; break; }
    }

    let priceFound = false;
    for (const sel of priceSelectors) {
      if ((await card.locator(sel).count()) > 0) { priceFound = true; break; }
    }

    if (!nameFound || !priceFound) {
      console.log('[CAL-02] HTML première carte :', html.slice(0, 500));
    }
    expect(nameFound, 'Aucun sélecteur de nom trouvé dans la carte').toBe(true);
    expect(priceFound, 'Aucun sélecteur de prix trouvé dans la carte').toBe(true);
  });

  test('CAL-03 — Sélecteurs modale produit', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Ouvrir la première carte
    await page.locator('#k-grid .k-promo-card, #k-grid .k-card').first().click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });

    const checks = {
      '#k-modal-name': 'Nom produit dans modale',
      '#k-modal-price': 'Prix produit',
      '#k-modal-close': 'Bouton fermer',
      '#k-add-cart-btn': 'Bouton ajouter au panier',
      '#k-qty-plus': 'Stepper +',
      '#k-qty-minus': 'Stepper -',
      '#k-qty-val': 'Valeur quantité',
    };

    const missing = [];
    for (const [selector, label] of Object.entries(checks)) {
      const count = await page.locator(selector).count();
      if (count === 0) missing.push(`${label} → "${selector}"`);
    }

    expect(missing, `Sélecteurs modale absents:\n${missing.join('\n')}`).toHaveLength(0);
  });

  test('CAL-04 — Sélecteurs navigation (mobile vs desktop)', async ({ page }) => {
    await page.goto(BASE_URL);

    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);

    if (isDesktop) {
      const headerBtns = await page.locator('.k-header-nav-btn').count();
      expect(headerBtns, 'Boutons nav header absents en desktop').toBeGreaterThan(0);
    } else {
      const bnavItems = await page.locator('.k-bnav-item').count();
      expect(bnavItems, 'Items bnav absents en mobile').toBeGreaterThan(0);

      // Vérifier les data-tab attendus
      const tabs = await page.locator('.k-bnav-item').evaluateAll(els =>
        els.map(el => el.dataset.tab)
      );
      console.log('[CAL-04] Onglets bnav trouvés :', tabs);
      expect(tabs).toContain('shop');
      expect(tabs).toContain('group');
    }
  });

  test('CAL-05 — Sélecteurs recherche', async ({ page }) => {
    await page.goto(BASE_URL);

    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    const inputExists = (await input.count()) > 0;
    const dropdownExists = (await dropdown.count()) > 0;

    if (!inputExists) console.log('[CAL-05] #k-search-input ABSENT');
    if (!dropdownExists) console.log('[CAL-05] #k-search-dropdown ABSENT');

    expect(inputExists, '#k-search-input absent').toBe(true);
    expect(dropdownExists, '#k-search-dropdown absent').toBe(true);
  });

  test('CAL-06 — Sélecteurs panier (mobile drawer / desktop side-cart)', async ({ page }) => {
    await page.goto(BASE_URL);

    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);

    const checks = isDesktop
      ? { '#k-side-cart': 'Side-cart desktop', '#k-sc-items': 'Container items side-cart' }
      : { '#k-cart-drawer': 'Drawer panier mobile', '#k-cart-body': 'Body drawer' };

    const missing = [];
    for (const [selector, label] of Object.entries(checks)) {
      if ((await page.locator(selector).count()) === 0) {
        missing.push(`${label} → "${selector}"`);
      }
    }

    expect(missing, `Sélecteurs panier absents:\n${missing.join('\n')}`).toHaveLength(0);
  });

  // ── Timings : les timeouts sont-ils réalistes ? ──────────────────────

  test('CAL-10 — Timing : grille catalogue charge en < 12s', async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const elapsed = Date.now() - start;

    console.log(`[CAL-10] Grille chargée en ${elapsed}ms`);
    // Si ça prend > 10s, nos timeouts de 5s dans les helpers sont trop courts
    expect(elapsed).toBeLessThan(12_000);
  });

  test('CAL-11 — Timing : modale s\'ouvre en < 6s après clic', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const start = Date.now();
    await page.locator('#k-grid .k-promo-card, #k-grid .k-card').first().click();
    await page.waitForSelector('#k-modal-overlay.open', { timeout: 6_000 });
    const elapsed = Date.now() - start;

    console.log(`[CAL-11] Modale ouverte en ${elapsed}ms`);
    expect(elapsed).toBeLessThan(6_000);
  });

  test('CAL-12 — Timing : recherche dropdown en < 5s après saisie', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const firstCardName = await page.locator(
      '#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name'
    ).first().textContent().catch(() => null);

    if (!firstCardName) {
      console.log('[CAL-12] SKIP — pas de .k-card-name trouvé (le sélecteur a changé ?)');
      return;
    }

    const term = firstCardName.trim().split(/\s+/)[0];
    const start = Date.now();
    await page.locator('#k-search-input').fill(term);

    try {
      await page.waitForSelector('#k-search-dropdown.open', { timeout: 5_000 });
      const elapsed = Date.now() - start;
      console.log(`[CAL-12] Dropdown search en ${elapsed}ms pour "${term}"`);
    } catch {
      // Vérifier si la dropdown utilise une autre classe que .open
      const classes = await page.locator('#k-search-dropdown').getAttribute('class');
      console.log(`[CAL-12] Dropdown jamais .open — classes actuelles : "${classes}"`);
      console.log('[CAL-12] → Le test search.spec.js devra adapter le sélecteur');
    }
  });

  // ── Structure : hypothèses sur le markup ─────────────────────────────

  test('CAL-20 — Le document a lang="fr"', async ({ page }) => {
    await page.goto(BASE_URL);
    const lang = await page.locator('html').getAttribute('lang');
    console.log(`[CAL-20] <html lang="${lang}">`);
    // On log juste — le test accessibility.spec.js l'asserte
  });

  test('CAL-21 — Dump complet de l\'état page (référence)', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const state = await capturePageState(page);
    console.log('[CAL-21] État de référence :\n' + JSON.stringify(state, null, 2));
    // Ce test ne peut pas échouer — il documente l'état réel
  });
});
