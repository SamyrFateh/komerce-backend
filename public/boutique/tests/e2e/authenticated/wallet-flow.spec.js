/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/wallet-flow.spec.js
 * @feature wallet
 * @brief Flux métier wallet authentifié : session → bloc wallet Mon Komerce → cohérence API.
 *
 * Vérifie que la chaîne complète fonctionne :
 *   1. Session active → pas de gate de réauthentification
 *   2. Mon Komerce affiche le bloc wallet compact canonique
 *   3. Le solde affiché correspond au backend (GET /api/wallet)
 *   4. Aucun NaN/undefined n'est rendu
 *
 * READ-ONLY : aucune action destructive (pas de débit, pas de paiement).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('../helpers/boutique.helpers');
const { verifySession, verifyWalletBalance } = require('../helpers/api.helpers');

test.describe('FLOW — Wallet authentifié', () => {

  test('F10 — Session active → solde wallet cohérent entre Mon Komerce et API', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Vérifier que la session est active côté backend ──
    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    // ── 2. Naviguer vers Mon Komerce ──
    // Depuis la consolidation 2026-08, le wallet n'a plus sa vue autonome
    // #k-wallet-view dans ce parcours. Le contrat UI canonique est désormais :
    // #k-komerce-view > #k-kmc-wallet-block.
    await navigateToTab(page, 'komerce');

    const komerceView = page.locator('#k-komerce-view');
    await expect(komerceView).toBeVisible({ timeout: 8_000 });

    const walletBlock = page.locator('#k-kmc-wallet-block');
    await expect(walletBlock).toBeVisible({ timeout: 8_000 });

    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-kmc-wallet-block');
        return !!el && !el.textContent.includes('Chargement…') && el.textContent.trim().length > 5;
      },
      { timeout: 15_000 }
    );

    // ── 3. Une session valide ne doit pas afficher le gate de réauth ──
    await expect(page.locator('#k-kmc-reauth')).toHaveCount(0);

    // ── 4. Vérifier la cohérence UI ↔ API ──
    const apiBalance = await verifyWalletBalance(page);
    expect(apiBalance, 'GET /api/wallet doit répondre').toBeTruthy();

    const amount = walletBlock.locator('.k-kmc-wallet-summary strong');
    await expect(amount).toBeVisible();

    const amountText = (await amount.textContent()) || '';
    expect(amountText).toContain('KMF');
    expect(amountText).not.toContain('NaN');
    expect(amountText).not.toContain('undefined');

    const uiBalance = Number(amountText.replace(/[^0-9-]/g, ''));
    expect(uiBalance, 'Le solde affiché doit être numérique').not.toBeNaN();
    expect(uiBalance, 'Le solde Mon Komerce doit correspondre à GET /api/wallet')
      .toBe(Number(apiBalance.balance));
  });
});
