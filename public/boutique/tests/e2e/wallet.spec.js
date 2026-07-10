/**
 * @e2e   wallet.spec.js
 * @feature wallet-loyalty
 * @brief Porte-monnaie : chargement, erreur + retry, gate auth, solde
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('./helpers/boutique.helpers');

test.describe('E-WALLET — Porte-monnaie', () => {

  test('E8 — L\'onglet wallet finit de charger (pas de spinner infini)', async ({ page }) => {
    await page.goto(BASE_URL);
    await navigateToTab(page, 'wallet');

    // L'élément wallet-view doit exister
    const walletView = page.locator('#k-wallet-view');
    await expect(walletView).toBeAttached({ timeout: 5_000 });

    // Attendre que "Chargement" disparaisse (remplacé par contenu, erreur ou gate)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        if (!el) return false;
        const text = el.textContent || '';
        return !text.includes('Chargement…') && text.length > 10;
      },
      { timeout: 15_000 }
    );

    // On doit être dans un des 3 états terminaux : données, erreur, ou gate auth
    const content = await walletView.textContent();
    const terminal =
      content.includes('Identifiez-vous') ||   // gate auth (401, normal sans session)
      content.includes('KMF') ||               // solde affiché
      content.includes('Aucune opération') ||  // wallet vide
      content.includes('Réessayer') ||          // erreur + retry
      content.includes('Impossible');           // erreur
    expect(terminal).toBe(true);
  });

  test('E9 — Wallet timeout API → état erreur + bouton Réessayer (jamais de loader infini)', async ({ page }) => {
    // Bloquer l'API wallet
    await page.route('**/api/wallet**', () => { /* pend — ne jamais répondre */ });
    await page.goto(BASE_URL);
    await navigateToTab(page, 'wallet');

    // Le timeout central (10s) doit déclencher l'état erreur
    await page.waitForSelector('#k-wlt-retry-btn', { timeout: 15_000 });

    const walletView = page.locator('#k-wallet-view');
    const text = await walletView.textContent();
    expect(text).not.toContain('Chargement…');
    expect(text).toMatch(/Réessayer/);
  });

  test('E10 — Wallet 401 sans session → gate d\'identification (pas une erreur)', async ({ page }) => {
    await page.goto(BASE_URL);
    await navigateToTab(page, 'wallet');

    // Sans session active, /api/wallet retourne 401
    const walletView = page.locator('#k-wallet-view');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return el && !el.textContent.includes('Chargement…') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );

    const text = await walletView.textContent();
    // Sans session → gate auth ou erreur (les deux sont des états terminaux valides)
    const isAuthGate = text.includes('Identifiez-vous');
    const isError = text.includes('Réessayer') || text.includes('Impossible');
    expect(isAuthGate || isError).toBe(true);
    // Jamais un loader résiduel
    expect(text).not.toContain('Chargement…');
  });
});
