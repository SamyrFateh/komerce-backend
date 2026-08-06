/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   tracking.spec.js
 * @feature orders
 * @brief Suivi commandes : chargement, erreur + retry, mode recherche, 401
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('./helpers/boutique.helpers');

test.describe('E-TRACKING — Suivi commandes', () => {

  test('E11 — L\'onglet suivi finit de charger (pas de spinner infini)', async ({ page }) => {
    await page.goto(BASE_URL);
    await navigateToTab(page, 'track');

    const trackView = page.locator('#k-track-view');
    await expect(trackView).toBeAttached({ timeout: 5_000 });

    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-track-view');
        if (!el) return false;
        return !el.textContent.includes('Chargement de vos commandes') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );

    const text = await trackView.textContent();
    // État terminal : liste de commandes, mode recherche, erreur+retry
    const terminal =
      text.includes('Rechercher') ||          // mode recherche (401 / 0 commandes)
      text.includes('KM-') ||                 // référence de commande visible
      text.includes('Réessayer') ||            // erreur + retry
      text.includes('Impossible') ||           // erreur
      text.includes('Suivre une commande') ||  // search mode (ancien)
      text.includes('Suivi de commande') ||    // search-first mode (actuel)
      text.includes('référence') ||            // formulaire recherche par référence
      text.includes('historique');              // bouton "Voir tout mon historique"
    expect(terminal).toBe(true);
  });

  test('E12 — Tracking timeout API → erreur + Réessayer + fallback recherche', async ({ page }) => {
    await page.route('**/api/orders**', () => { /* pend */ });
    await page.goto(BASE_URL);
    await navigateToTab(page, 'track');

    // Timeout 10s → état erreur
    await page.waitForSelector('#k-track-retry-btn', { timeout: 15_000 });

    const trackView = page.locator('#k-track-view');
    const text = await trackView.textContent();
    expect(text).not.toContain('Chargement de vos commandes');
    expect(text).toMatch(/Réessayer/);

    // Fallback recherche par référence proposé
    const searchFallback = page.locator('#k-track-search-fallback-btn');
    await expect(searchFallback).toBeAttached();
  });

  test('E12b — Clic "Rechercher par référence" bascule en mode recherche', async ({ page }) => {
    await page.route('**/api/orders**', () => { /* pend */ });
    await page.goto(BASE_URL);
    await navigateToTab(page, 'track');

    await page.waitForSelector('#k-track-search-fallback-btn', { timeout: 15_000 });
    await page.locator('#k-track-search-fallback-btn').click();

    // Le mode recherche doit s'afficher (champ de référence ou quick search)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-track-view');
        return el && (
          el.querySelector('#k-track-quick') !== null ||
          el.querySelector('input') !== null
        );
      },
      { timeout: 5_000 }
    );
  });
});
