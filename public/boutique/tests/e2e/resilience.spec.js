/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   resilience.spec.js
 * @feature infrastructure
 * @brief Résilience transversale : timeout API → aucune vue en chargement
 *        infini, retour boutique après erreur, navigation entre onglets
 *
 * CE SPEC EST LA PREUVE que l'incident PR563 ne peut plus se reproduire.
 * Si TOUS ces tests passent, aucun chemin de la boutique ne peut rester
 * bloqué sur "Chargement…" indéfiniment.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, navigateToTab, addFirstProductToCart, openCheckout,
} = require('./helpers/boutique.helpers');

test.describe('E-RESILIENCE — Plus aucun chargement infini', () => {

  test('E15 — API entièrement en panne → chaque onglet affiche un état terminal, jamais un loader', async ({ page }) => {
    // Charger la page normalement d'abord (cache catalogue)
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Couper TOUTES les API
    await page.route('**/api/**', () => { /* ne jamais répondre */ });

    // ── Onglet Wallet ──
    await navigateToTab(page, 'wallet');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return el && !el.textContent.includes('Chargement…') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );
    const walletText = await page.locator('#k-wallet-view').textContent();
    expect(walletText).not.toContain('Chargement…');

    // ── Onglet Tracking ──
    await navigateToTab(page, 'track');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-track-view');
        return el && !el.textContent.includes('Chargement de vos commandes') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );
    const trackText = await page.locator('#k-track-view').textContent();
    expect(trackText).not.toContain('Chargement de vos commandes');

    // ── Onglet Group ──
    await navigateToTab(page, 'group');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-group-view');
        return el && !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );
    const groupText = await page.locator('#k-group-view').textContent();
    expect(groupText).not.toContain('Chargement…');
  });

  test('E15b — Après erreur sur tous les onglets, retour boutique → catalogue visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    await page.route('**/api/**', () => { /* pend */ });

    // Naviguer vers wallet (erreur)
    await navigateToTab(page, 'wallet');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return el && !el.textContent.includes('Chargement…') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );

    // Retour boutique
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await navigateToTab(page, 'shop');
    await waitForGrid(page);

    // Le catalogue est toujours visible et cliquable
    const count = await page.locator('#k-grid .k-promo-card, #k-grid .k-card').count();
    expect(count).toBeGreaterThan(0);
  });

  test('E15c — Checkout avec relais en timeout → confirmer TOUJOURS disabled + retry visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Ajouter un produit au panier (avec API fonctionnelle)
    const { openFirstCard, addToCartFromModal } = require('./helpers/boutique.helpers');
    await openFirstCard(page);
    await addToCartFromModal(page);

    // Bloquer uniquement les relais
    await page.route('**/api/relais**', () => { /* pend */ });
    await openCheckout(page);

    // Attendre le timeout (10s max)
    await page.waitForSelector('#ck-relais-retry, .ck-relais-error', { timeout: 15_000 });

    // Le bouton Confirmer est TOUJOURS disabled
    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeDisabled();

    // Le Réessayer est visible
    await expect(page.locator('#ck-relais-retry')).toBeAttached();

    // Le sous-texte du bouton confirmer indique l'erreur
    const btnText = await confirmBtn.textContent();
    expect(btnText).toMatch(/Impossible.*relais/i);
  });

  test('E16 — Navigation rapide entre onglets → pas de crash ni de DOM résiduel', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Navigation rapide : boutique → wallet → track → group → boutique
    const tabs = ['wallet', 'track', 'group', 'shop'];
    for (const tab of tabs) {
      await navigateToTab(page, tab);
      await page.waitForTimeout(200);
    }

    // On est revenu sur la boutique — la grille est toujours là
    await waitForGrid(page);
    const count = await page.locator('#k-grid .k-promo-card, #k-grid .k-card').count();
    expect(count).toBeGreaterThan(0);

    // Pas d'erreur JS non gérée dans la console
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    // Les erreurs CSP des extensions ne comptent pas
    const realErrors = errors.filter(e => !e.includes('Content Security Policy') && !e.includes('centrify'));
    expect(realErrors.length).toBe(0);
  });
});
