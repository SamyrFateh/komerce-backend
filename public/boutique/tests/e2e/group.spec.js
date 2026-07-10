/**
 * @e2e   group.spec.js
 * @feature shared-cart
 * @brief Groupe / panier partagé : créateur, participant public, timeout retry
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('./helpers/boutique.helpers');

test.describe('E-GROUP — Panier groupe', () => {

  test('E13 — L\'onglet groupe finit de charger (pas de spinner infini)', async ({ page }) => {
    await page.goto(BASE_URL);
    await navigateToTab(page, 'group');

    const groupView = page.locator('#k-group-view');
    await expect(groupView).toBeAttached({ timeout: 5_000 });

    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-group-view');
        if (!el) return false;
        return !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );

    const text = await groupView.textContent();
    // État terminal : paniers affichés, état vide, erreur, gate auth
    const terminal =
      text.includes('Aucun panier') ||         // état vide (normal)
      text.includes('Créer') ||                 // CTA créer un panier
      text.includes('panier') ||                // un panier est affiché
      text.includes('Réessayer') ||             // erreur + retry
      text.includes('Impossible') ||            // erreur
      text.includes('Identifiez');              // gate auth
    expect(terminal).toBe(true);
  });

  test('E13b — Groupe timeout /mine → erreur + Réessayer (jamais loader infini)', async ({ page }) => {
    await page.route('**/api/shared-carts/mine**', () => { /* pend */ });
    await page.goto(BASE_URL);
    await navigateToTab(page, 'group');

    await page.waitForSelector('#k-group-retry-btn', { timeout: 15_000 });

    const groupView = page.locator('#k-group-view');
    const text = await groupView.textContent();
    expect(text).not.toContain('Chargement…');
    expect(text).toMatch(/Réessayer|Impossible/);
  });

  test('E14 — Page publique panier partagé : charge sans crash', async ({ page }) => {
    // Accès direct à la page publique avec un token bidon
    // BASE_URL se termine désormais par un slash (ex: http://localhost:3000/boutique/) :
    // ne pas préfixer le chemin relatif par un second slash.
    const resp = await page.goto(BASE_URL + 'shared-cart-public.html?token=test-invalid-token');
    // La page HTML elle-même doit charger (200)
    expect(resp.status()).toBeLessThan(400);

    // Attendre que le JS traite le token invalide → message d'erreur (pas un crash)
    await page.waitForFunction(
      () => {
        const body = document.body.textContent || '';
        return body.length > 30;
      },
      { timeout: 10_000 }
    );

    const text = await page.locator('body').textContent();
    // Avec un token invalide, on attend un message d'erreur lisible
    const validResponse =
      text.includes('introuvable') ||
      text.includes('expiré') ||
      text.includes('invalide') ||
      text.includes('Réessayer') ||
      text.includes('Impossible') ||
      text.includes('Erreur');
    expect(validResponse).toBe(true);
  });
});
