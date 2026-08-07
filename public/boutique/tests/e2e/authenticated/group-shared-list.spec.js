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
 *   - `#k-cart-surface-switch` n'est plus qu'un indicateur (`.k-list-indicator`,
 *     texte "Liste de X · Ouverte/Fermée") — plus de boutons ni de bascule
 *     panier personnel/liste, plus jamais deux surfaces vivantes en parallèle.
 *
 * Les 11 scénarios ci-dessous couvrent l'ensemble du cycle de vie côté UI
 * (création → consultation → mutation organisateur → achat ligne/bloc →
 * clôture → repartage → sauvegarde participant), chacun isolé pour limiter
 * le blast radius d'un échec et faciliter le diagnostic.
 *
 * ⚠️ Ces tests CRÉENT de vraies listes (et parfois de vraies commandes cash,
 * jamais payées) → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

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
  getClientShareState,
  cancelAnyActiveSharedCart,
  cancelOrder,
  spyOnApi,
} = require('../helpers/api.helpers');

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
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F22-1 — la liste active devient l\'unique panier visible : ni bascule de surface, ni sélection locale', async ({ page }) => {
    await createSharedList(page, 2);

    // Plus de bascule à deux boutons : #k-cart-surface-switch est un simple
    // indicateur, jamais un contrôle interactif.
    const switcher = page.locator('#k-cart-surface-switch');
    await expect(switcher).toBeVisible({ timeout: 10_000 });
    await expect(switcher).toHaveClass(/k-list-indicator/);
    await expect(switcher.locator('button, [data-surface]')).toHaveCount(0);
    await expect(switcher.locator('.k-list-indicator-text')).toContainText('Ouverte');

    // Plus de sélection locale : ni case/bouton "Sélectionner", ni ancien
    // conteneur .k-shared-list-item(s).
    await expect(page.locator('.k-shared-item-select, .k-shared-list-item, .k-shared-list-items')).toHaveCount(0);

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(2);
    // Chaque ligne disponible expose son propre CTA d'achat, jamais un
    // bouton de sélection.
    await expect(page.locator('#k-side-cart .k-cart-item-buy')).toHaveCount(2);
  });

  test('F22-2 — ouvrir la fiche produit d\'une ligne ajoute au panier PERSONNEL, jamais à la liste, puis restaure la liste à la fermeture', async ({ page }) => {
    await createSharedList(page, 1);

    const panel = snapshotPanel(page);
    await expect(panel.locator('.k-cart-snapshot-item')).toHaveCount(1);
    const snapshotBefore = await panel.innerHTML();

    const cartBadgeBefore = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );

    const patchSpy = await spyOnApi(page, '/api/shared-carts/', 'PATCH');
    const postSpy = await spyOnApi(page, '/api/shared-carts/', 'POST');
    const deleteSpy = await spyOnApi(page, '/api/shared-carts/', 'DELETE');

    const openBtn = page.locator('#k-side-cart .k-cart-snapshot-item-open').first();
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    await openBtn.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });

    await addToCartFromModal(page); // panier personnel par défaut
    await closeModal(page);

    const panelAfter = snapshotPanel(page);
    await expect(panelAfter).toBeVisible({ timeout: 10_000 });
    await expect(panelAfter.innerHTML()).resolves.toBe(snapshotBefore);

    const cartBadgeAfter = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );
    expect(cartBadgeAfter, 'Le badge panier personnel doit refléter le nouvel article').toBeGreaterThan(cartBadgeBefore);

    expect(patchSpy.calls().length, 'Aucun PATCH shared-carts déclenché par un ajout au panier perso').toBe(0);
    expect(postSpy.calls().length, 'Aucun POST shared-carts déclenché par un ajout au panier perso').toBe(0);
    expect(deleteSpy.calls().length, 'Aucun DELETE shared-carts déclenché par un ajout au panier perso').toBe(0);
  });

  test('F22-3 — le CTA "Ajouter à cette liste" (organisateur, liste ouverte) écrit réellement sur la liste, jamais sur le panier personnel', async ({ page }) => {
    await createSharedList(page, 1);

    // Produit du catalogue distinct de celui déjà présent dans la liste.
    const secondCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(1);
    await expect(secondCard).toBeVisible({ timeout: 10_000 });
    await secondCard.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });

    const addToListBtn = page.locator('#k-add-to-list-btn');
    await expect(addToListBtn).toBeVisible({ timeout: 10_000 });
    await expect(addToListBtn).toBeEnabled();

    const itemsPostSpy = await spyOnApi(page, '/api/shared-carts/', 'POST');
    const cartBadgeBefore = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );

    await addToListBtn.click();
    const call = await itemsPostSpy.waitForCall(10_000);
    expect(call, 'Un POST vers shared-carts/:id/items doit partir').not.toBeNull();
    expect(call.url).toContain('/items');

    await closeModal(page);

    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(2, { timeout: 10_000 });

    const cartBadgeAfter = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );
    expect(cartBadgeAfter, 'Le panier personnel ne doit jamais recevoir cet ajout').toBe(cartBadgeBefore);
  });

  test('F22-4 — l\'organisateur peut modifier la quantité d\'une ligne non réclamée, steppers toujours visibles (pas de bascule "Modifier")', async ({ page }) => {
    await createSharedList(page, 1);

    const row = page.locator('#k-side-cart .k-cart-snapshot-item').first();
    const qtyControl = row.locator('.k-cart-item-qty');
    // Toujours visible pour l'organisateur, aucun bouton "Modifier" à activer.
    await expect(qtyControl).toBeVisible({ timeout: 10_000 });

    const qtyVal = qtyControl.locator('.k-qty-val');
    const before = parseInt((await qtyVal.textContent()) || '1', 10);

    // group-api.js::updateSharedListItemQuantity — PATCH par ligne, plus
    // l'ancien PUT groupé (voir commentaire source : "sans passer par
    // l'ancien PUT groupé").
    const patchSpy = await spyOnApi(page, '/api/shared-carts/', 'PATCH');
    await qtyControl.locator('[data-qty-step="1"]').click();
    const call = await patchSpy.waitForCall(10_000);
    expect(call).not.toBeNull();

    await expect(qtyVal).toHaveText(String(before + 1), { timeout: 10_000 });
  });

  test('F22-5 — l\'organisateur peut retirer une ligne non réclamée (✕), elle disparaît de la liste sans jamais toucher le panier personnel', async ({ page }) => {
    await createSharedList(page, 2);

    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(2);

    const cartBadgeBefore = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );

    const deleteSpy = await spyOnApi(page, '/api/shared-carts/', 'DELETE');
    const row = page.locator('#k-side-cart .k-cart-snapshot-item').first();
    await row.locator('.k-cart-item-remove').click();

    const call = await deleteSpy.waitForCall(10_000);
    expect(call).not.toBeNull();

    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(1, { timeout: 10_000 });

    const cartBadgeAfter = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );
    expect(cartBadgeAfter, 'Retirer une ligne de la liste ne doit jamais modifier le panier personnel').toBe(cartBadgeBefore);
  });

  test('F22-6 — acheter une ligne via son bouton "Acheter" dédié la passe "Déjà acheté" (badge, plus de quantité/retrait)', async ({ page }) => {
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

  test('F22-8 — "Tout acheter" achète en un seul passage toutes les lignes encore disponibles, puis disparaît', async ({ page }) => {
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
    const { token } = await createSharedList(page, 1);

    // Contexte participant : nouvelle session anonyme, ouvre le lien public.
    const participantContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const participantPage = await participantContext.newPage();

    try {
      const publicResp = participantPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      const { getSharePageUrl } = require('../helpers/business.helpers');
      await participantPage.goto(getSharePageUrl(token));
      await publicResp;

      const saveBtn = participantPage.locator('#k-sc-snap-save, #k-cart-snap-save').first();
      await expect(saveBtn).toBeVisible({ timeout: 10_000 });
      await expect(saveBtn).toContainText('Sauvegarder');

      await saveBtn.click();
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

    const switcher = page.locator('#k-cart-surface-switch');
    await expect(switcher).toBeVisible({ timeout: 10_000 });
    await expect(switcher.locator('.k-list-indicator-text')).toContainText('Ouverte');

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });

    const stateAfterReload = await getClientShareState(page);
    expect(stateAfterReload?.token).toBe(token);
  });

  test('F22-13 — le quota de listes actives se libère immédiatement après une fermeture (P0)', async ({ page }) => {
    // P0 — QUOTA BACKEND (services/shared-cart-creation.js : le COUNT du
    // quota ne filtre plus que status = 'open'). Ce scénario couvre le
    // contrat de bout en bout, pas seulement la requête SQL isolée (déjà
    // couverte en unitaire, tests/unit/shared-cart-creation.test.js) :
    // atteindre la limite, fermer UNE liste, et vérifier qu'une nouvelle
    // création redevient immédiatement possible, sans délai ni attente.
    const MAX_ACTIVE_CARTS_PER_USER = 5;
    const tokens = [];

    for (let i = 0; i < MAX_ACTIVE_CARTS_PER_USER; i += 1) {
      const { token } = await createSharedList(page, 1);
      tokens.push(token);
      // Repartir d'un panier personnel vide pour la prochaine création —
      // createSharedList() ajoute ses propres articles à chaque appel.
      await page.reload();
    }

    // La limite est atteinte : une 6e création doit échouer avec le
    // message de quota (jamais une création silencieuse au-delà de la
    // limite).
    await addNProductsToCart(page, 1);
    await openCartDrawer(page);
    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });
    await stubShareChannels(page);
    const toastLocator = page.locator('#k-toast, .k-toast, [role="status"]').last();
    await shareBtn.click();
    await expect(toastLocator).toContainText(/Limite atteinte/i, { timeout: 10_000 });

    // On ferme UNE des listes déjà créées (peu importe laquelle) puis on
    // retente : la création doit désormais réussir sans aucune attente.
    await cancelAnyActiveSharedCart(page); // cleanup défensif si le shareBtn a laissé un état incohérent
    const closeCheck = await verifySharedCart(page, tokens[0]);
    if (closeCheck.exists && closeCheck.cart?.status === 'open') {
      // Fermeture directe via l'API (indépendant de l'UI, pour isoler ce
      // scénario du test F22-9 qui couvre déjà la fermeture via l'UI).
      await page.evaluate(async ({ id, base }) => {
        await fetch(new URL(`/api/shared-carts/${id}/close`, base).href, {
          method: 'POST', credentials: 'include',
        });
      }, { id: closeCheck.cart.id, base: BASE_URL.replace('/boutique/', '') });
    }

    await page.reload();
    await addNProductsToCart(page, 1);
    await openCartDrawer(page);
    const retryShareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(retryShareBtn).toBeVisible({ timeout: 10_000 });
    await stubShareChannels(page);
    await retryShareBtn.click();

    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 15_000 },
    ).catch(() => {});
    const freedState = await getClientShareState(page);
    expect(freedState?.token, 'Une nouvelle liste doit se créer dès qu\'un slot est libéré par la fermeture').toBeTruthy();
    tokens.push(freedState.token);
  });
});
