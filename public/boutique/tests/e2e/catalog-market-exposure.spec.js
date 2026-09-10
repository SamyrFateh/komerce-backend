/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   catalog-market-exposure.spec.js
 * @feature catalog
 * @brief Cutover catalog.expose — l'exposition produit x marché
 *        (product_market_exposure) doit réellement filtrer la vitrine.
 *
 *        Deux natures de tests ici, volontairement séparées :
 *
 *        1. EXP1 — CÂBLAGE, tourne en LOCAL. Observe les requêtes réseau
 *           réelles : aucun chemin catalogue vivant ne doit appeler
 *           /api/products sans code marché. C'est bon marché, déterministe,
 *           et ça garde une vraie valeur — un appel sans ?market contourne
 *           l'exposition entièrement, quelle que soit la qualité du backend.
 *
 *        2. EXP2+ — COMPORTEMENT, exigent BASE_URL distant, comme tous les
 *           specs catalogue de cette suite (playwright.config.js : le mode
 *           LOCAL sert des fichiers statiques SANS backend). Stubber tout le
 *           boot pour forcer un rendu en LOCAL produirait des verts trompeurs :
 *           une assertion d'absence dans une grille vide est trivialement vraie.
 *
 *        Ces specs valident la chaîne navigateur -> requête -> rendu. Ils ne
 *        valident PAS les contraintes SQL ni les migrations de promotion —
 *        celles-ci relèvent de tests/e2e-api/ (Jest, contre un vrai Postgres),
 *        qui reste à écrire pour market-delegation.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, IS_REMOTE, waitForGrid, cardCount,
} = require('./helpers/boutique.helpers');

const MARKET_QS = /[?&]market=[A-Z]{2}(&|$)/;

test.describe('E-CATALOG-EXPOSURE — Exposition produit x marché (cutover catalog.expose)', () => {

  test('EXP1 — aucun chemin catalogue n’appelle /api/products sans code marché', async ({ page }) => {
    // Invariant de câblage, vérifiable sans backend : product_market_exposure
    // ne peut filtrer la vitrine que si le code marché atteint l'API.
    //
    // Ce test observe le trafic réel plutôt que le source, et c'est essentiel
    // ici : le code marché n'est PAS ajouté par les appelants. b-catalog.js
    // appelle encore K.products.list({ limit: 1000 }) sans marché ; c'est
    // installMarketAwareProductApi() (product-store.js) qui enveloppe
    // K.products.list au chargement du module et impose le contexte marché.
    // Une lecture statique des appelants conclurait donc à tort qu'un chemin
    // catalogue contourne l'exposition — seule l'exécution le dit.
    //
    // Vérifié par mutation : neutraliser l'injection dans marketAwareList
    // fait échouer ce test. Il détecte réellement la régression qu'il
    // surveille, et protège un wrapper discret dont la suppression
    // « nettoyage » casserait silencieusement l'exposition par marché.
    const listCalls = [];

    page.on('request', (request) => {
      const url = request.url();
      // Liste seulement : /api/products?... — exclut /api/products/:id[/detail]
      if (/\/api\/products(\?|$)/.test(url)) listCalls.push(url);
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    expect(
      listCalls.length,
      'Aucun appel /api/products observé au boot — le test ne prouverait rien.'
    ).toBeGreaterThan(0);

    const withoutMarket = listCalls.filter((url) => !MARKET_QS.test(url));
    expect(
      withoutMarket,
      'Appel(s) catalogue sans ?market : sur ces chemins l’exposition produit x '
      + 'marché est contournée et un produit DISABLED resterait visible.\n'
      + withoutMarket.map((u) => u.replace(/^https?:\/\/[^/]+/, '')).join('\n')
    ).toHaveLength(0);
  });

  test('EXP2 — le détail produit transmet aussi le code marché', async ({ page }) => {
    // Même invariant sur le chemin détail : sans ?market, le fail-closed
    // serveur ne peut pas s'appliquer et un produit non exposé resterait
    // consultable en accès direct.
    test.skip(!IS_REMOTE, 'Catalogue réel indisponible en mode LOCAL (pas de backend) — lancer avec BASE_URL distant');

    const detailCalls = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/\/api\/products\/[^/?]+(\/detail)?(\?|$)/.test(url)) detailCalls.push(url);
    });

    await page.goto(BASE_URL);
    await waitForGrid(page);
    await page.locator('#k-grid .k-promo-card, #k-grid .k-card').first().click();
    await page.waitForLoadState('networkidle');

    expect(detailCalls.length, 'Aucun appel détail observé').toBeGreaterThan(0);
    const withoutMarket = detailCalls.filter((url) => !MARKET_QS.test(url));
    expect(
      withoutMarket,
      `Appel(s) détail sans ?market :\n${withoutMarket.map((u) => u.replace(/^https?:\/\/[^/]+/, '')).join('\n')}`
    ).toHaveLength(0);
  });

  test('EXP3 — la grille ne rend que des produits exposés sur le marché courant', async ({ page }) => {
    // Contrôle positif : la grille rend réellement des produits. Sans lui, une
    // assertion d'absence ne prouverait rien (page vide = absence triviale).
    // Le serveur ayant déjà filtré par exposition, tout ce qui est rendu est
    // par construction exposé sur ce marché — ce test verrouille surtout le
    // fait que le filtrage ne vide PAS la vitrine (régression du cutover :
    // un fail-closed sans snapshot masquerait tout le catalogue).
    test.skip(!IS_REMOTE, 'Catalogue réel indisponible en mode LOCAL (pas de backend) — lancer avec BASE_URL distant');

    await page.goto(BASE_URL);
    await waitForGrid(page);

    const count = await cardCount(page);
    expect(
      count,
      'Grille vide sur un marché actif : le cutover catalog.expose a masqué '
      + 'tout le catalogue (snapshot de compatibilité absent ou incomplet).'
    ).toBeGreaterThan(0);
  });

  test('EXP4 — un produit non exposé n’est pas consultable en accès direct', async ({ page }) => {
    // Fail-closed sur le chemin détail. Requiert un id de produit réellement
    // DISABLED sur le marché testé, fourni par l'environnement — sans lui, le
    // test se skippe plutôt que de passer à vide.
    test.skip(!IS_REMOTE, 'Catalogue réel indisponible en mode LOCAL (pas de backend) — lancer avec BASE_URL distant');
    const hiddenId = process.env.E2E_HIDDEN_PRODUCT_ID;
    test.skip(
      !hiddenId,
      'E2E_HIDDEN_PRODUCT_ID absent : fournir l’id d’un produit DISABLED sur le '
      + 'marché testé, sinon ce test passerait sans rien prouver.'
    );

    const response = await page.request.get(
      `${BASE_URL.replace(/\/boutique\/?$/, '')}/api/products/${hiddenId}/detail?market=KM`
    );
    expect(
      response.status(),
      'Un produit non exposé sur ce marché doit être introuvable (404), '
      + 'jamais servi.'
    ).toBe(404);
  });
});
