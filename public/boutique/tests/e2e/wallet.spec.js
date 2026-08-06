/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/wallet.spec.js
 * @feature wallet
 * @brief Porte-monnaie avec une VRAIE session (storageState posé par
 *        auth.setup.js — compte de test dédié, jamais un compte réel).
 *
 * Complète wallet.spec.js (public) qui couvre volontairement les états
 * SANS session (E10 — 401 → gate d'identification). Ici, la session existe
 * déjà : on vérifie qu'on n'atterrit JAMAIS sur le gate d'auth, et qu'un
 * état de solde réel (carte solde ou solde à zéro) s'affiche.
 *
 * N'exécute aucune action destructive/financière (pas de débit, pas de
 * commande) — lecture seule (GET /api/wallet, GET /api/wallet/transactions).
 *
 * Ignoré si TEST_ACCOUNT_PHONE/TEST_ACCOUNT_OTP absents (voir auth.setup.js) :
 * dans ce cas, storageState n'existe pas et ce projet ne tourne pas du tout.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers/boutique.helpers');

test.describe('E-WALLET-AUTH — Porte-monnaie (session réelle)', () => {
  test.beforeEach(async ({}, testInfo) => {
    // Ces tests nécessitent une session authentifiée (projet "authenticated").
    // En mode anonyme, le gate d'auth est affiché — c'est le comportement attendu.
    if (testInfo.project.name !== 'authenticated') {
      testInfo.skip(true, 'Nécessite le projet "authenticated" avec storageState (TEST_ACCOUNT_PHONE/OTP)');
    }
  });

  test('EA1 — Session authentifiée → jamais le gate d\'identification', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.locator('[data-tab="wallet"]').first().click();

    const walletView = page.locator('#k-wallet-view');
    await expect(walletView).toBeAttached({ timeout: 5_000 });

    // Attend un état terminal (jamais de loader résiduel — même contrat que
    // les tests publics E8/E9/E10).
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return !!el && !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );

    // Le point qui distingue ce test des specs publics : avec une session
    // valide, on ne doit JAMAIS retomber sur le gate d'auth (#k-wlt-auth-btn),
    // ni sur "Identifiez-vous" / "Session expirée".
    const authGate = page.locator('#k-wlt-auth-btn');
    await expect(authGate).toHaveCount(0);

    const text = await walletView.textContent();
    expect(text).not.toContain('Session expirée');
    expect(text).not.toContain('Identifiez-vous');
  });

  test('EA2 — Solde affiché : carte solde ou état zéro, jamais une erreur', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.locator('[data-tab="wallet"]').first().click();

    const walletView = page.locator('#k-wallet-view');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return !!el && !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );

    // Un des deux états de solde réel doit être présent (jamais les deux,
    // jamais aucun — cf. renderWalletView : balance > 0 → k-wlt-card,
    // sinon k-wlt-zero).
    const balanceCard = page.locator('.k-wlt-card');
    const zeroState = page.locator('.k-wlt-zero');
    const hasBalanceCard = (await balanceCard.count()) > 0;
    const hasZeroState = (await zeroState.count()) > 0;
    expect(hasBalanceCard || hasZeroState).toBe(true);
    expect(hasBalanceCard && hasZeroState).toBe(false);

    // Si un historique est rendu, les montants doivent être au format KMF
    // (pas de "NaN" / valeur brute non formatée — régression déjà vue côté
    // Jest sur toLocaleString('fr-FR')).
    const txWrap = page.locator('.k-wlt-tx-wrap');
    if ((await txWrap.count()) > 0) {
      const firstAmount = await txWrap.locator('.k-wlt-tx-amt').first().textContent();
      expect(firstAmount).not.toContain('NaN');
      expect(firstAmount).toMatch(/KMF/);
    }
  });
});
