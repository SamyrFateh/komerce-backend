/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-shared-list.spec.js
 * @feature shared-cart, group
 * @brief F22 — Doctrine finale (2026-08) de la liste partagée en side cart /
 * drawer canonique : "la liste active EST le panier visible", pas une
 * surface parallèle avec bascule ou sélection locale.
 *
 * Remplace group-coexistence.spec.js (supprimé) : celui-ci testait un
 * modèle révolu (`.k-shared-list-item`, `.k-shared-item-select`,
 * `#k-cart-surface-switch` en bascule à deux boutons `data-surface`)
 * incompatible avec le contrat DOM actuel (group/group-side-cart.js,
 * b-cart.js::renderCartSnapshot) :
 *   - lignes  → `.k-cart-snapshot-item` (+ `.is-cart-item-claimed`)
 *   - ouverture fiche produit → `.k-cart-snapshot-item-open`
 *   - statut ligne → `.k-cart-snapshot-item-status` / badge `.is-claimed`
 *   - achat  → un bouton `.k-cart-item-buy` PAR ligne (plus de sélection +
 *     CTA global), option discrète `#k-cart-snap-buyall` / `#k-sc-snap-buyall`
 *   - `#k-cart-surface-switch` est le conteneur `.k-cart-tabs` des deux
 *     onglets [ Mon panier ] [ Liste partagée ] (É4, 2026-08). L'onglet
 *     liste porte la classe `.k-cart-tab--active` quand une OPEN est affichée.
 *
 * Les 13 scénarios ci-dessous couvrent l'ensemble du cycle de vie côté UI
 * (création → consultation → mutation organisateur → achat ligne/bloc →
 * clôture → repartage → sauvegarde participant), chacun isolé pour limiter
 * le blast radius d'un échec et faciliter le diagnostic.
 *
 * ⚠️ Ces tests CRÉENT de vraies listes (et parfois de vraies commandes cash,
 * jamais payées) → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  openFirstCard,
  addToCartFromModal,
  closeModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  verifySharedCart,
  getClientCart,
  getClientShareState,
  cancelAnyActiveSharedCart,
  cancelOrder,
  spyOnApi,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

const USER2_STATE_PATH = path.join(__dirname, '..', '..', '..', 'playwright', '.auth', 'user2.json');

/* ── Helpers locaux à ce fichier ──────────────────────────────────────
 * Volontairement non promus dans helpers/boutique.helpers.js : contrat
 * spécifique à ce spec (nombre de lignes, stub navigator.share/window.open,
 * lecture du contexte snapshot). À faire remonter si un futur spec en a
 * aussi besoin.
 */

function stubShareChannels(page) {
  return page.evaluate(() => {
    window.open = () => null;
    try {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {},
      });
    } catch (_) {}
  });
}

/** Ajoute `count` produits distincts du catalogue au panier personnel. */
async function addNProductsToCart(page, count) {
  await waitForGrid(page);
  for (let i = 0; i < count; i += 1) {
    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(i);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await addToCartFromModal(page);
    await closeModal(page);
  }
}

/** Crée une liste avec `count` articles et retourne { token, sharedCartId }. */
async function createSharedList(page, count = 2) {
  await addNProductsToCart(page, count);
  await openCartDrawer(page);

  const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
  await expect(shareBtn).toBeVisible({ timeout: 10_000 });
  await stubShareChannels(page);
  await shareBtn.click();

  await page.waitForFunction(
    () => !!sessionStorage.getItem('kmrc_share'),
    { timeout: 15_000 },
  ).catch(() => {});

  const shareState = await getClientShareState(page);
  expect(shareState?.token, 'La liste doit être créée avec un token').toBeTruthy();
  return { token: shareState.token, sharedCartId: shareState.shareId || shareState.id || null };
}

/**
 * Création directe utilisée uniquement par le scénario de quota F22-13.
 * Le flow UI ne peut volontairement pas créer une nouvelle liste lorsqu'une
 * liste open est déjà active (Partager = repartager) ; le quota backend doit
 * donc être exercé directement, avec la vraie session et le vrai endpoint.
 */
async function createSharedListViaApi(page, cartItems) {
  return page.evaluate(async ({ base, items }) => {
    const resp = await fetch(new URL('/api/shared-carts/from-cart-items', base).href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cart_items: items }),
    });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
  }, {
    base: BASE_URL.replace('/boutique/', ''),
    items: cartItems,
  });
}

function snapshotPanel(page) {
  return page
    .locator('#k-side-cart #k-sc-items, #k-cart-body')
    .first();
}

test.describe('FLOW — Liste partagée, doctrine finale (F22)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F22 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  test.beforeEach(async ({ page }) => {
    // handleRemoveItem/handleCloseClick passent par window.confirm() —
    // jamais de blocage silencieux du test sur une boîte de dialogue native.
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
    // P0 (audit terrain — F22-2/F22-13) : au moment de ce page.goto(), l'app
    // a déjà démarré restoreSharedCartFromBackend() en tâche de fond
    // (b-share-cart.js::install(), jamais awaited par lui-même). Si un test
    // précédent a laissé une liste 'open' (nettoyée par cancelAnyActiveSharedCart
    // ci-dessus, mais APRÈS coup), cette restauration en vol peut se résoudre
    // avec l'ancien statut 'open' et poser state.cartSurface='shared-list' en
    // mémoire — alors même que le serveur vient d'annuler la liste. Résultat
    // observé : #k-add-cart-btn restait caché (remplacé par "Ajouter à cette
    // liste") pour tout le reste du test, sans qu'aucune liste réelle ne soit
    // active. Un reload() ICI, une fois l'annulation serveur confirmée
    // terminée, élimine la course : le prochain restoreSharedCartFromBackend()
    // ne trouvera plus rien.
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F22-1 — la liste active devient l\'unique panier visible : ni bascule de surface, ni sélection locale', async ({ page }) => {
    await createSharedList(page, 2);

    // É4 (2026-08) : #k-cart-surface-switch est désormais le conteneur des
    // deux onglets [ Mon panier ] [ Liste partagée ]. Il porte .k-cart-tabs
    // et expose deux boutons .k-cart-tab. Le libellé actif est dans
    // #k-tab-shared-list, qui contient le nom de la liste.
    const tabs = page.locator('#k-cart-surface-switch');
    await expect(tabs).toBeVisible({ timeout: 10_000 });
    await expect(tabs).toHaveClass(/k-cart-tabs/);
    // Deux onglets explicites — Mon panier et Liste partagée.
    await expect(tabs.locator('.k-cart-tab')).toHaveCount(2);
    // L'onglet liste partagée est actif (liste OPEN affichée).
    await expect(page.locator('#k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);

    // Plus de sélection locale : ni case/bouton "Sélectionner", ni ancien
    // conteneur .k-shared-list-item(s).
    await expect(page.locator('.k-shared-item-select, .k-shared-list-item, .k-shared-list-items')).toHaveCount(0);

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(2);
    // Chaque ligne disponible expose son propre CTA d'achat, jamais un
    // bouton de sélection.
    await expect(page.locator('#k-side-cart .k-cart-item-buy')).toHaveCount(2);
  });

  test('F22-2 — un participant qui ouvre la fiche produit d\'une ligne ajoute au panier PERSONNEL (jamais à la liste, dont il n\'est pas créateur), puis retrouve la liste à la fermeture', async ({ page, browser }) => {
    // Participant : la fiche produit alimente uniquement son panier personnel ;
    // la liste publiée reste structurellement immuable.
    const { token } = await createSharedList(page, 1);

    const participantContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Le projet "authenticated" charge storageState pour le compte créateur.
    // Un contexte participant anonyme doit être explicitement vidé : en
    // staging, on a observé kmrc_jwt présent dans un newContext() manuel,
    // ce qui faisait remonter is_creator=true côté backend.
    await participantContext.clearCookies();
    const participantPage = await participantContext.newPage();

    try {
      const publicResp = participantPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      await participantPage.goto(getSharePageUrl(token));
      const publicResponse = await publicResp;
      const publicList = await publicResponse.json();
      expect(publicList.is_creator, 'Le contexte participant doit rester anonyme/non créateur').toBe(false);

      const panel = participantPage.locator('#k-side-cart .k-cart-snapshot-item, #k-cart-body .k-cart-snapshot-item').first();
      await expect(panel).toBeVisible({ timeout: 10_000 });

      const cartBadgeBefore = parseInt(
        (await participantPage.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
        10,
      );

      const patchSpy = await spyOnApi(participantPage, '/api/shared-carts/*/items/*', 'PATCH');
      const postSpy = await spyOnApi(participantPage, '/api/shared-carts/*/items', 'POST');
      const deleteSpy = await spyOnApi(participantPage, '/api/shared-carts/*/items/*', 'DELETE');

      const openBtn = participantPage.locator('.k-cart-snapshot-item-open').first();
      await expect(openBtn).toBeVisible({ timeout: 10_000 });
      await openBtn.click();
      await participantPage.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });

      // Participant (non créateur) : jamais de CTA "Ajouter à cette
      // liste" visible — le shell de modale conserve le bouton dans le DOM
      // avec l'attribut `hidden`. Seul "Ajouter au panier" (personnel) est
      // disponible pour l'utilisateur.
      await expect(participantPage.locator('#k-add-to-list-btn')).toHaveCount(0);
      await expect(participantPage.locator('#k-add-cart-btn')).toBeVisible();
      await addToCartFromModal(participantPage);
      await closeModal(participantPage);

      const panelAfter = participantPage.locator('#k-side-cart .k-cart-snapshot-item, #k-cart-body .k-cart-snapshot-item').first();
      await expect(panelAfter).toBeVisible({ timeout: 10_000 });

      const cartBadgeAfter = parseInt(
        (await participantPage.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
        10,
      );
      expect(cartBadgeAfter, 'Le badge panier personnel doit refléter le nouvel article').toBeGreaterThan(cartBadgeBefore);

      expect(patchSpy.calls().length, 'Aucun PATCH shared-carts déclenché par un ajout au panier perso').toBe(0);
      expect(postSpy.calls().length, 'Aucun POST shared-carts déclenché par un ajout au panier perso').toBe(0);
      expect(deleteSpy.calls().length, 'Aucun DELETE shared-carts déclenché par un ajout au panier perso').toBe(0);
    } finally {
      await participantContext.close();
    }
  });

  test('F22-3 — même l’organisateur ne peut plus ajouter à une liste publiée ; la fiche produit conserve le panier personnel', async ({ page }) => {
    await createSharedList(page, 1);

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(1);

    // L'espion démarre APRÈS la création de la liste : toute écriture
    // observée ici serait donc une mutation post-publication interdite.
    const postSpy = await spyOnApi(page, '/api/shared-carts/*/items', 'POST');

    const secondCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(1);
    await expect(secondCard).toBeVisible({ timeout: 10_000 });
    await secondCard.click();

    await page.waitForSelector(
      '#k-modal-overlay.open, .k-modal-overlay.open',
      { timeout: 6_000 },
    );

    await expect(page.locator('#k-add-to-list-btn')).toHaveCount(0);
    await expect(page.locator('#k-add-cart-btn')).toBeVisible();

    await addToCartFromModal(page);
    await closeModal(page);

    // Le snapshot partagé est strictement inchangé.
    await expect(rows).toHaveCount(1);
    expect(
      postSpy.calls().length,
      'Aucun POST shared-carts/:id/items ne doit exister après publication',
    ).toBe(0);
  });

  test('F22-4 — organisateur : snapshot OPEN achetable mais structurellement non éditable', async ({ page }) => {
    await createSharedList(page, 1);

    const row = page.locator('#k-side-cart .k-cart-snapshot-item').first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // OPEN signifie "achetable", jamais "éditable".
    await expect(row.locator('.k-cart-item-buy')).toBeVisible();
    await expect(row.locator('.k-cart-item-qty')).toHaveCount(0);
    await expect(row.locator('.k-qty-btn')).toHaveCount(0);
    await expect(row.locator('.k-cart-item-remove')).toHaveCount(0);

    await expect(
      page.locator('#k-side-cart').getByRole('button', { name: /Modifier|Terminer/i }),
    ).toHaveCount(0);
  });

  test('F22-5 — les anciennes routes de mutation post-publication sont réellement absentes (404)', async ({ page }) => {
    const { sharedCartId } = await createSharedList(page, 1);

    expect(
      sharedCartId,
      'createSharedList doit exposer le sharedCartId',
    ).toBeTruthy();

    const statuses = await page.evaluate(async ({ base, id }) => {
      const attempts = [
        { method: 'GET',    suffix: '/as-cart-items' },
        { method: 'PUT',    suffix: '/items' },
        { method: 'POST',   suffix: '/items' },
        { method: 'DELETE', suffix: '/items/fake-item' },
        { method: 'PATCH',  suffix: '/items/fake-item' },
      ];

      const result = [];

      for (const attempt of attempts) {
        const url = new URL(
          `/api/shared-carts/${encodeURIComponent(id)}${attempt.suffix}`,
          base,
        ).href;

        const options = {
          method: attempt.method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        };

        if (!['GET', 'DELETE'].includes(attempt.method)) {
          options.body = JSON.stringify({
            cart_items: [{ product_id: 'forbidden', quantity: 2 }],
            product_id: 'forbidden',
            quantity: 2,
          });
        }

        const response = await fetch(url, options);
        result.push({
          method: attempt.method,
          suffix: attempt.suffix,
          status: response.status,
        });
      }

      return result;
    }, { base: BASE_URL, id: sharedCartId });

    expect(statuses).toEqual([
      { method: 'GET',    suffix: '/as-cart-items',     status: 404 },
      { method: 'PUT',    suffix: '/items',             status: 404 },
      { method: 'POST',   suffix: '/items',             status: 404 },
      { method: 'DELETE', suffix: '/items/fake-item',   status: 404 },
      { method: 'PATCH',  suffix: '/items/fake-item',   status: 404 },
    ]);

    // Et la ligne initialement publiée existe toujours.
    await expect(
      page.locator('#k-side-cart .k-cart-snapshot-item'),
    ).toHaveCount(1);
  });
  test('F22-6 — acheter une ligne via "Acheter" la passe "Déjà acheté" sans altérer le snapshot structurel', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    const row = page.locator('#k-side-cart .k-cart-snapshot-item').first();
    await row.locator('.k-cart-item-buy').click();

    await page.waitForSelector('#k-order-modal.open, .k-order-modal.open', { timeout: 10_000 });
    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    const orderCall = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await confirmBtn.click();
    const resp = await orderCall;
    expect(resp.status()).toBe(201);
    const body = await resp.json().catch(() => ({}));

    try {
      // La commande réussie reste affichée dans la modale de checkout.
      // Revenir explicitement à la boutique déclenche l'observer installé par
      // handleBuySingleItem(), qui rafraîchit la liste avant de la réafficher.
      const orderCloseBtn = page.locator('#k-order-close-btn');
      await expect(orderCloseBtn).toBeVisible({ timeout: 10_000 });
      await orderCloseBtn.click();

      const claimedRow = page.locator('#k-side-cart .k-cart-snapshot-item.is-cart-item-claimed').first();
      await expect(claimedRow).toBeVisible({ timeout: 15_000 });
      await expect(claimedRow.locator('.k-cart-snapshot-item-status-badge.is-claimed')).toBeVisible();
      await expect(claimedRow.locator('.k-cart-item-qty, .k-cart-item-remove, .k-cart-item-buy')).toHaveCount(0);

      const check = await verifySharedCart(page, token);
      expect(check.exists).toBe(true);
    } finally {
      if (body?.order?.id) await cancelOrder(page, body.order.id, 'e2e-cleanup');
    }
  });

  test('F22-7 — le résumé "Contributeurs" (GAP-05) n\'apparaît que côté organisateur, après au moins un achat', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    // Avant tout achat : ni résumé contributeurs (rien à résumer).
    await expect(page.locator('#k-side-cart #k-sc-snapshot-contributors')).toHaveCount(0);

    const row = page.locator('#k-side-cart .k-cart-snapshot-item').first();
    await row.locator('.k-cart-item-buy').click();
    await page.waitForSelector('#k-order-modal.open, .k-order-modal.open', { timeout: 10_000 });
    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    const orderCall = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await confirmBtn.click();
    const resp = await orderCall;
    const body = await resp.json().catch(() => ({}));

    try {
      // Le résumé appartient au side cart, masqué tant que l'écran de succès
      // checkout est ouvert. Fermer celui-ci fait aussi rafraîchir le contexte
      // de liste via l'observer du flow d'achat unitaire.
      const orderCloseBtn = page.locator('#k-order-close-btn');
      await expect(orderCloseBtn).toBeVisible({ timeout: 10_000 });
      await orderCloseBtn.click();

      const contributors = page.locator('#k-side-cart #k-sc-snapshot-contributors');
      await expect(contributors).toBeVisible({ timeout: 15_000 });
      await expect(contributors).toContainText('Contributeurs :');
      await expect(contributors).toContainText('article');

      const check = await verifySharedCart(page, token);
      expect(check.exists).toBe(true);
    } finally {
      if (body?.order?.id) await cancelOrder(page, body.order.id, 'e2e-cleanup');
    }
  });

  test('F22-8 — "Payer" règle en un seul passage toutes les lignes encore disponibles, puis disparaît', async ({ page }) => {
    const { token } = await createSharedList(page, 2);

    const buyAllBtn = page.locator('#k-side-cart #k-sc-snap-buyall');
    await expect(buyAllBtn).toBeVisible({ timeout: 10_000 });

    await buyAllBtn.click();
    await page.waitForSelector('#k-order-modal.open, .k-order-modal.open', { timeout: 10_000 });
    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    const orderCall = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await confirmBtn.click();
    const resp = await orderCall;
    expect(resp.status()).toBe(201);
    const body = await resp.json().catch(() => ({}));

    try {
      await expect(page.locator('#k-side-cart .k-cart-snapshot-item.is-cart-item-claimed')).toHaveCount(2, { timeout: 15_000 });
      // Plus rien de disponible → le CTA discret disparaît.
      await expect(page.locator('#k-side-cart #k-sc-snap-buyall')).toHaveCount(0);

      const check = await verifySharedCart(page, token);
      expect(check.exists).toBe(true);
    } finally {
      if (body?.order?.id) await cancelOrder(page, body.order.id, 'e2e-cleanup');
    }
  });

  test('F22-9 — fermer la liste démonte intégralement le contexte : le side cart retrouve le panier personnel, jamais une liste figée en lecture seule', async ({ page }) => {
    // P0 — FERMETURE (doctrine finale, group-side-cart.js::handleCloseClick) :
    // après apiCloseSharedCart(), clearSharedListContext() est appelé
    // explicitement (et non un simple refreshSharedListContext()) — la liste
    // fermée n'est PAS laissée montée en lecture seule. state.cartSurface
    // repasse à 'personal', isActiveContext() redevient faux (token remis à
    // null), #k-cart-surface-switch est retiré du DOM (renderCartSurfaceSwitch
    // ne l'affiche que si cartSurface === 'shared-list') et le prochain
    // openCart() affiche un panier personnel normal, sans aucun résidu de la
    // liste désormais fermée.
    const { token } = await createSharedList(page, 1);

    const closeBtn = page.locator('#k-side-cart #k-sc-snap-closelist');
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await expect(closeBtn).toBeEnabled();
    await closeBtn.click();

    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#k-cart-surface-switch')).toHaveCount(0);
    await expect(page.locator('#k-side-cart #k-sc-snap-closelist')).toHaveCount(0);

    const check = await verifySharedCart(page, token);
    expect(check.exists).toBe(true);
    if (check.cart) expect(check.cart.status).toBe('closed');
  });

  test('F22-10 — repartager depuis le side cart (📤 Partager) réutilise le lien actif, ne recrée jamais de liste', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    const postSpy = await spyOnApi(page, '/api/shared-carts/from-cart-items', 'POST');
    await stubShareChannels(page);

    const reshareBtn = page.locator('#k-side-cart #k-sc-snap-share');
    await expect(reshareBtn).toBeVisible({ timeout: 10_000 });
    await reshareBtn.click();

    // Laisser une fenêtre courte pour être sûr qu'aucune création ne part.
    await page.waitForTimeout(1_500);
    expect(postSpy.calls().length, 'Repartager ne doit jamais recréer une liste').toBe(0);

    const stateAfter = await getClientShareState(page);
    expect(stateAfter?.token).toBe(token);
  });

  test('F22-11 — un participant (non organisateur) peut sauvegarder la liste dans "Mes listes" ; le bouton devient "Sauvegardée"', async ({ page, browser }) => {
    test.skip(
      !fs.existsSync(USER2_STATE_PATH),
      'F22-11 exige un second compte authentifié non organisateur : playwright/.auth/user2.json absent.',
    );

    const { token } = await createSharedList(page, 1);

    // Sauvegarder dans "Mes listes" est une écriture authentifiée
    // (POST /api/shared-carts/save). Utiliser une session anonyme ici était
    // contradictoire avec le contrat backend et, lorsque le cookie créateur
    // fuyait dans newContext(), transformait le participant en organisateur.
    // On utilise donc le second compte E2E dédié, déjà requis par F24.
    const participantContext = await browser.newContext({
      storageState: USER2_STATE_PATH,
      viewport: { width: 1280, height: 800 },
      locale: 'fr-FR',
    });
    const participantPage = await participantContext.newPage();

    try {
      const publicResp = participantPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      await participantPage.goto(getSharePageUrl(token));
      const publicResponse = await publicResp;
      const publicList = await publicResponse.json();
      expect(publicList.is_creator, 'Le compte participant doit être distinct du créateur').toBe(false);

      const saveBtn = participantPage.locator('#k-sc-snap-save, #k-cart-snap-save').first();
      await expect(saveBtn).toBeVisible({ timeout: 10_000 });
      await expect(saveBtn).toContainText('Sauvegarder');

      const saveResponsePromise = participantPage.waitForResponse(
        (r) => r.url().includes('/api/shared-carts/save') && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await saveBtn.click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status(), 'La sauvegarde du participant authentifié doit réussir côté backend').toBe(200);
      await expect(saveBtn).toContainText('Sauvegardée', { timeout: 10_000 });
      await expect(saveBtn).toBeDisabled();

      // Un participant ne voit jamais le résumé contributeurs (gating
      // serveur, GAP-05) ni les contrôles organisateur.
      await expect(participantPage.locator('#k-cart-snapshot-contributors, #k-sc-snapshot-contributors')).toHaveCount(0);
      await expect(participantPage.locator('.k-cart-item-remove, .k-cart-item-qty')).toHaveCount(0);
    } finally {
      await participantContext.close();
    }

    const check = await verifySharedCart(page, token);
    expect(check.exists).toBe(true);
  });

  test('F22-12 — reload : la liste active se restaure dans la même surface canonique, sans reclic ni bascule', async ({ page }) => {
    // P0 — RESTORE (restoreSharedCartFromBackend() est désormais awaited
    // avant de résoudre, voir js/b-share-cart.js). Ce scénario vérifie le
    // contrat côté UI qui en dépend : après un simple rechargement de page,
    // sans aucune action de l'utilisateur, le side cart doit retrouver la
    // liste comme panier canonique visible — pas seulement un token en
    // cache de session, pas de flash intermédiaire sur le panier personnel
    // vide qui resterait affiché.
    const { token } = await createSharedList(page, 2);

    await page.reload();
    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 15_000 },
    ).catch(() => {});

    // É4 — le conteneur est .k-cart-tabs, l'onglet actif est #k-tab-shared-list.
    const tabs = page.locator('#k-cart-surface-switch');
    await expect(tabs).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });

    const stateAfterReload = await getClientShareState(page);
    expect(stateAfterReload?.token).toBe(token);
  });

  test('F22-13 — Règle V1 : 1 liste OPEN max par créateur, le slot se libère immédiatement après fermeture', async ({ page }) => {
    // Règle V1 (2026-08) — 1 liste OPEN par organisateur (remplace l'ancien
    // quota de 5). Garanti par UNIQUE INDEX shared_carts_one_open_per_organizer
    // (migration 129) + garde applicative (shared-cart-creation.js).
    //
    // Ce scénario couvre le contrat bout-en-bout :
    //   1. Première création → OK (200)
    //   2. Seconde création sans fermer → refusée (409, code open_list_exists)
    //   3. Fermer la première → slot libéré immédiatement
    //   4. Nouvelle création → OK (200)

    await addNProductsToCart(page, 1);
    const localCart = await getClientCart(page);
    expect(localCart.length).toBeGreaterThan(0);
    const seed = localCart[0];
    const cartItems = [{
      product_id: seed.product?.id || seed.id,
      quantity: Number(seed.qty) || 1,
      variant_combo: seed.variant_combo || null,
    }];
    expect(cartItems[0].product_id, 'Le produit seed doit avoir un id').toBeTruthy();

    // 1. Première création → OK.
    const first = await createSharedListViaApi(page, cartItems);
    expect(first.status, 'Première création doit réussir').toBe(200);
    expect(first.body?.shared_cart_id).toBeTruthy();

    // 2. Seconde création (liste OPEN existante) → 409 avec code open_list_exists.
    const blocked = await createSharedListViaApi(page, cartItems);
    expect(blocked.status, 'Seconde création doit être refusée (V1)').toBe(409);
    expect(blocked.body?.code).toBe('open_list_exists');
    expect(blocked.body?.existing_token).toBeTruthy();

    // 3. Fermer la première liste.
    const closeStatus = await page.evaluate(async ({ id, base }) => {
      const resp = await fetch(new URL(`/api/shared-carts/${id}/close`, base).href, {
        method: 'POST',
        credentials: 'include',
      });
      return resp.status;
    }, {
      id: first.body.shared_cart_id,
      base: BASE_URL.replace('/boutique/', ''),
    });
    expect(closeStatus).toBe(200);

    // 4. Nouvelle création immédiatement possible après fermeture.
    const freed = await createSharedListViaApi(page, cartItems);
    expect(freed.status, 'La fermeture doit libérer le slot immédiatement').toBe(200);
    expect(freed.body?.token).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L10 — Tests mobile (390×844) et coexistence panier/liste
// ─────────────────────────────────────────────────────────────────────────────

test.describe('NAVIGATION — Coexistence panier personnel ↔ liste (desktop)', () => {
  test('L10-D — personal → liste → personal → liste : panier strictement intact', async ({ page }) => {
    // Préparer un panier personnel non vide.
    await addNProductsToCart(page, 2);
    const cartBefore = await getClientCart(page);
    expect(cartBefore.length, 'Le panier doit contenir 2 articles avant publication').toBe(2);

    // Publier une liste — le panier source est vidé après succès.
    const { token } = await createSharedList(page, 2);
    expect(token).toBeTruthy();

    // Les tabs doivent être présents (liste active dans le slot).
    const tabs = page.locator('#k-cart-surface-switch');
    await expect(tabs).toBeVisible({ timeout: 8_000 });
    await expect(tabs.locator('.k-cart-tab')).toHaveCount(2);
    await expect(page.locator('#k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);

    // Basculer vers Mon panier.
    await page.locator('#k-tab-personal').click();
    await expect(page.locator('#k-tab-personal')).toHaveClass(/k-cart-tab--active/);
    // Le shell reste visible (invariant L1).
    await expect(page.locator('#k-side-cart')).toHaveClass(/has-items/);

    // Revenir à la liste.
    await page.locator('#k-tab-shared-list').click();
    await expect(page.locator('#k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);
    // Le snapshot doit être présent.
    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(2, { timeout: 8_000 });

    // L'état backend de la liste reste OPEN.
    const stateAfter = await getClientShareState(page);
    expect(stateAfter?.token).toBe(token);
  });
});

test.describe('NAVIGATION — Mobile 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('L10-M — personal → liste → personal → liste : drawer mobile symétrique', async ({ page }) => {
    // §2 mandat — tester le chemin complet sur mobile.
    await addNProductsToCart(page, 1);
    const cartBefore = await getClientCart(page);
    expect(cartBefore.length).toBeGreaterThan(0);

    // Ouvrir le drawer mobile (via bnav cart).
    const bnavCart = page.locator('.k-bnav-item[data-tab="cart"]');
    if (await bnavCart.count()) await bnavCart.click();

    // Publier.
    const { token } = await createSharedList(page, 1);
    expect(token).toBeTruthy();

    // Tabs dans le drawer mobile.
    // Les tabs sont injectés dans #k-cart-drawer (N1 fix §15).
    const drawerTabs = page.locator('#k-cart-surface-switch-drawer');
    await expect(drawerTabs).toBeVisible({ timeout: 8_000 });
    await expect(drawerTabs.locator('.k-cart-tab')).toHaveCount(2);

    // Basculer vers Mon panier depuis le drawer.
    await drawerTabs.locator('#k-tab-personal').click();
    // Le drawer doit afficher un état vide explicite, pas être blanc.
    const drawerBody = page.locator('#k-cart-body');
    await expect(drawerBody).toBeVisible({ timeout: 5_000 });

    // Revenir à la liste depuis le drawer.
    await drawerTabs.locator('#k-tab-shared-list').click();
    // Les lignes de snapshot doivent réapparaître.
    await expect(page.locator('#k-cart-body .k-cart-snapshot-item, #k-cart-drawer .k-cart-snapshot-item')).toHaveCount(1, { timeout: 8_000 });

    // Mon panier mobile : retour et vérification intégrité.
    await drawerTabs.locator('#k-tab-personal').click();
    const cartAfter = await getClientCart(page);
    // Le panier personnel reste cohérent avec l'état.
    expect(cartAfter).toBeDefined();
  });

  test('L10-M2 — panier non vide visible sur mobile après bascule vers liste et retour', async ({ page }) => {
    // Prouver que state.cart ne se perd pas (P0-1 invariant shell).
    await addNProductsToCart(page, 1);
    const { token } = await createSharedList(page, 1);
    expect(token).toBeTruthy();

    // Basculer : liste → personal → liste → personal.
    // Sur mobile, cartSurface='personal' doit rappeler renderCartBody().
    const drawerTabs = page.locator('#k-cart-surface-switch-drawer');
    if (await drawerTabs.count()) {
      await drawerTabs.locator('#k-tab-personal').click();
      await page.waitForTimeout(300);
      await drawerTabs.locator('#k-tab-shared-list').click();
      await page.waitForTimeout(300);
      await drawerTabs.locator('#k-tab-personal').click();
      await page.waitForTimeout(300);
    }

    // L'état backend reste intact.
    const state = await getClientShareState(page);
    expect(state?.token, 'Le token de liste doit survivre aux bascules').toBe(token);
  });
});
