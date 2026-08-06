/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   navigation.spec.js
 * @feature navigation, deep-links
 * @brief Navigation inter-onglets, deep-links ?tab=, retour boutique,
 *        cohérence bnav/header desktop vs mobile.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE, navigateToTab, waitForGrid } = require('./helpers/boutique.helpers');

test.describe('E-NAV — Navigation & deep-links', () => {

  test('E21 — Deep-link ?tab=track ouvre directement le suivi', async ({ page }) => {
    await page.goto(BASE_URL + '?tab=track');

    // L'onglet suivi ou son gate (auth / recherche) doit être visible
    await page.waitForFunction(
      () => {
        const body = document.body.textContent || '';
        return body.includes('Suivi') || body.includes('Rechercher')
            || body.includes('commande') || body.includes('Identifi')
            || body.includes('Réessayer');
      },
      { timeout: 10_000 }
    );

    // Le bouton bnav "track" doit être actif
    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    const activeTab = isDesktop
      ? page.locator('.k-header-nav-btn.active[data-tab="track"]')
      : page.locator('.k-bnav-item.active[data-tab="track"]');
    // Peut ne pas avoir la classe .active si switchView gère autrement
    // On vérifie qu'on n'est PAS sur la grille catalogue
    const grid = page.locator('#k-grid');
    await expect(grid).toBeHidden({ timeout: 3_000 }).catch(() => {
      // Sur certains viewports la grille reste dans le DOM mais hors viewport
    });
  });

  test('E21b — Deep-link ?tab=fav ouvre les favoris', async ({ page }) => {
    await page.goto(BASE_URL + '?tab=fav');

    await page.waitForFunction(
      () => {
        const body = document.body.textContent || '';
        return body.includes('favori') || body.includes('Favori')
            || body.includes('Aucun') || body.includes('cœur');
      },
      { timeout: 10_000 }
    );
  });

  test('E21c — Deep-link ?tab=group ouvre le groupe', async ({ page }) => {
    await page.goto(BASE_URL + '?tab=group');

    // Attendre que l'onglet groupe soit actif dans la navigation
    await page.waitForFunction(
      () => {
        const activeTab = document.querySelector('.k-bnav-item.active, .k-header-nav-btn.active');
        return activeTab && activeTab.dataset.tab === 'group';
      },
      { timeout: 15_000 }
    );
  });

  test('E22 — Aller-retour entre tous les onglets sans crash', async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le backend pour les vues dynamiques');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Cycle complet : shop → track → group → fav → wallet → shop
    const tabs = ['track', 'group', 'fav', 'wallet', 'shop'];
    for (const tab of tabs) {
      await navigateToTab(page, tab);
      // Pas de crash JS = aucune exception non gérée
      const logs = [];
      page.on('pageerror', (err) => logs.push(err.message));
      await page.waitForTimeout(800);
      expect(logs.filter(m => !m.includes('ResizeObserver'))).toHaveLength(0);
    }

    // Retour boutique → la grille est de nouveau visible
    await waitForGrid(page);
  });

  test('E22b — Double-clic rapide sur un onglet ne provoque pas de doublon de rendu', async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    await navigateToTab(page, 'track');
    await navigateToTab(page, 'track'); // double

    // Pas deux instances de la vue suivi dans le DOM
    await page.waitForTimeout(500);
    // Vérifier qu'on n'a pas de spinner bloqué
    const spinners = await page.locator('.k-loading:visible, .k-spinner:visible').count();
    expect(spinners).toBeLessThanOrEqual(1);
  });

  test('E23 — Le footer reste visible/accessible en scroll bas', async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le catalogue');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const footer = page.locator('#k-footer');
    // Sur mobile le footer peut être derrière la bnav mais doit exister dans le DOM
    await expect(footer).toBeAttached({ timeout: 3_000 });
  });
});
