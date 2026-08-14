/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-shared-list.spec.js
 * @feature shared-cart, group
 * @brief F22 — Doctrine canonique (2026-08-09) : Mon panier et une liste
 * OPEN affichée coexistent dans deux onglets séparés. La liste est figée ;
 * l'achat passe toujours par sélection locale, récapitulatif, puis checkout.
 *
 * Remplace group-coexistence.spec.js (supprimé) : celui-ci testait un
 * modèle révolu (`.k-shared-list-item`, `.k-shared-item-select`,
 * `#k-cart-surface-switch` en bascule à deux boutons `data-surface`)
 * incompatible avec le contrat DOM actuel (group/group-side-cart.js,
 * b-cart.js::renderCartSnapshot) :
 *   - lignes  → `.k-cart-snapshot-item` (+ `.is-cart-item-claimed`)
 *   - ouverture fiche produit → `.k-cart-snapshot-item-open`
 *   - statut ligne → `.k-cart-snapshot-item-status` / badge `.is-claimed`
 *   - sélection → `.k-cart-item-select`, locale et sans réservation
 *   - commande  → `.k-snap-btn-primary` ("Commander (N · X KMF)")
 *   - récapitulatif obligatoire → `.ck-recap-item` + ✓ statique, puis
 *     `#btn-confirm-recap`
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

  const shareBtn = page.locator('#k-cart-share:visible, #k-sc-share:visible').first();
  await expect(shareBtn).toBeVisible({ timeout: 10_000 });
  await stubShareChannels(page);
  await shareBtn.click();

  // La confirmation d’immutabilité est une modale Komerce, pas un
  // window.confirm() natif : page.on('dialog') ne peut pas la valider.
  const createBtn = page.getByRole('button', {
    name: 'Créer la liste',
    exact: true,
  });
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();

  await page.waitForFunction(
    () => !!sessionStorage.getItem('kmrc_share'),
    { timeout: 15_000 },
  ).catch(() => {});

  // Le token est persisté avant la fin de startShareFlow().
  // Attendre la surface canonique réellement montée avant de rendre la main.
  const isMobile = await page.evaluate(() => window.innerWidth < 900);
  const surfaceSwitch = isMobile
    ? page.locator('#k-cart-surface-switch-drawer')
    : page.locator('#k-cart-surface-switch');

  await expect(surfaceSwitch).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    await expect(page.locator('#k-cart-drawer')).toHaveClass(/open/);
  }

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

async function selectSharedRowsAndOpenRecap(page, indexes) {
  const selectors = page.locator('#k-side-cart .k-cart-item-select');
  for (const index of indexes) {
    const selector = selectors.nth(index);
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await selector.click();
    await expect(selector).toHaveAttribute('aria-checked', 'true');
  }

  const commandBtn = page.locator('#k-side-cart').getByRole('button', { name: /^Commander \(/ });
  await expect(commandBtn).toBeVisible({ timeout: 10_000 });
  await commandBtn.click();

  await expect(page.locator('.ck-recap-gate-heading')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.ck-recap-item')).toHaveCount(indexes.length);
  await expect(page.locator('.ck-recap-check')).toHaveCount(indexes.length);
  await expect(page.locator('.ck-recap-item input[type="checkbox"]')).toHaveCount(0);
}

async function continueRecapToCheckout(page) {
  const recapConfirm = page.locator('#btn-confirm-recap');
  await expect(recapConfirm).toBeVisible({ timeout: 10_000 });
  await recapConfirm.click();
  await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  const confirmBtn = page.locator('#btn-confirm-order');
  await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
  return confirmBtn;
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

  test('F22-1 — Mon panier reste disponible à côté de Ma liste ; la sélection est locale', async ({ page }) => {
    await createSharedList(page, 2);

    // É4 (2026-08) : #k-cart-surface-switch est désormais le conteneur des
    // deux onglets [ Mon panier ] [ Liste partagée ]. Il porte .k-cart-tabs
    // et expose deux boutons .k-cart-tab. Le libellé actif est dans
    // #k-tab-shared-list, qui contient le nom de la liste.
    const tabs = page.locator('#k-cart-surface-switch');
    await expect(tabs).toBeVisible({ timeout: 10_000 });
    await expect(tabs).toHaveClass(/k-cart-tabs/);
    // Deux onglets explicites — Mon panier et Ma liste.
    await expect(tabs.locator('.k-cart-tab')).toHaveCount(2);
    await expect(tabs.locator('.k-tab-personal')).toHaveText('Mon panier');
    await expect(tabs.locator('.k-tab-shared-list')).toContainText('Ma liste');
    // L'onglet liste partagée est actif (liste OPEN affichée).
    await expect(tabs.locator('.k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);

    // Plus aucun ancien conteneur concurrent.
    await expect(page.locator('.k-shared-item-select, .k-shared-list-item, .k-shared-list-items')).toHaveCount(0);

    const rows = page.locator('#k-side-cart .k-cart-snapshot-item');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#k-side-cart .k-cart-item-select')).toHaveCount(2);
    await expect(page.locator('#k-side-cart .k-cart-item-buy')).toHaveCount(0);

    // Tant que rien n'est sélectionné, aucun CTA de commande liste.
    await expect(page.locator('#k-side-cart').getByRole('button', { name: /^Commander \(/ })).toHaveCount(0);

    // L'onglet personnel reste fonctionnel et ne détruit pas la liste.
    await tabs.locator('.k-tab-personal').click();
    await expect(tabs.locator('.k-tab-personal')).toHaveClass(/k-cart-tab--active/);
    await tabs.locator('.k-tab-shared-list').click();
    await expect(rows).toHaveCount(2);
  });

  test('F22-2 — un participant qui ajoute depuis une liste alimente le panier PERSONNEL et bascule vers Mon panier, sans muter la liste', async ({ page, browser }) => {
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

      // Doctrine liste figée / panier vivant :
      // l'ajout personnel devient immédiatement la surface active.
      const tabsAfterAdd = participantPage.locator('#k-cart-surface-switch');
      await expect(tabsAfterAdd).toHaveAttribute('data-active', 'personal');
      await expect(tabsAfterAdd.locator('.k-tab-personal'))
        .toHaveClass(/k-cart-tab--active/);

      // L'article personnel est immédiatement visible.
      await expect(
        participantPage.locator('#k-side-cart .k-sc-item, #k-cart-body .k-cart-item').first()
      ).toBeVisible({ timeout: 10_000 });

      // La liste reste montée mais n'est jamais mutée. On peut y revenir
      // explicitement par son onglet et retrouver son snapshot intact.
      await tabsAfterAdd.locator('.k-tab-shared-list').click();

      const panelAfter = participantPage
        .locator('#k-side-cart .k-cart-snapshot-item, #k-cart-body .k-cart-snapshot-item')
        .first();

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

    const tabsAfterAdd = page.locator('#k-cart-surface-switch');
    await expect(tabsAfterAdd).toHaveAttribute('data-active', 'personal');
    await expect(tabsAfterAdd.locator('.k-tab-personal'))
      .toHaveClass(/k-cart-tab--active/);

    // Revenir explicitement à la liste permet de constater que le snapshot
    // publié est strictement inchangé.
    await tabsAfterAdd.locator('.k-tab-shared-list').click();
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

    // OPEN signifie "sélectionnable/achetable", jamais "éditable".
    await expect(row.locator('.k-cart-item-select')).toBeVisible();
    await expect(row.locator('.k-cart-item-buy')).toHaveCount(0);
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
  test('F22-6 — sélectionner une ligne puis confirmer le récapitulatif la passe "Déjà acheté"', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    await selectSharedRowsAndOpenRecap(page, [0]);
    await expect(page.locator('.ck-recap-origin-title').first()).toHaveText('Ma liste');
    await expect(page.locator('.ck-recap-origin-badge').first()).toHaveText('Liste figée');
    await expect(page.locator('.ck-shared-list-context-banner')).toHaveCount(0);
    const confirmBtn = await continueRecapToCheckout(page);
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
      await expect(claimedRow.locator('.k-cart-item-qty, .k-cart-item-remove, .k-cart-item-buy, .k-cart-item-select')).toHaveCount(0);

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

    await selectSharedRowsAndOpenRecap(page, [0]);
    const confirmBtn = await continueRecapToCheckout(page);
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

  test('F22-8 — "Tout sélectionner" prépare une commande unique sans achat immédiat', async ({ page }) => {
    const { token } = await createSharedList(page, 2);

    const selectAllBtn = page.locator('#k-side-cart').getByRole('button', { name: 'Tout sélectionner', exact: true });
    await expect(selectAllBtn).toBeVisible({ timeout: 10_000 });
    await selectAllBtn.click();
    await expect(page.locator('#k-side-cart .k-cart-item-select[aria-checked="true"]')).toHaveCount(2);

    const commandBtn = page.locator('#k-side-cart').getByRole('button', { name: /^Commander \(2 ·/ });
    await expect(commandBtn).toBeVisible();
    await commandBtn.click();
    await expect(page.locator('.ck-recap-item')).toHaveCount(2);
    await expect(page.locator('.ck-recap-check')).toHaveCount(2);
    const confirmBtn = await continueRecapToCheckout(page);
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
      // Plus rien de disponible → ni sélection ni commande.
      await expect(page.locator('#k-side-cart .k-cart-item-select')).toHaveCount(0);
      await expect(page.locator('#k-side-cart').getByRole('button', { name: /^Commander \(/ })).toHaveCount(0);

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

    const closeBtn = page.locator('#k-side-cart').getByRole('button', { name: 'Clôturer la liste', exact: true });
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await expect(closeBtn).toBeEnabled();
    await closeBtn.click();

    const confirmCloseBtn = page.locator('.k-confirm-dialog').getByRole('button', {
      name: 'Clôturer la liste',
      exact: true,
    });
    await expect(confirmCloseBtn).toBeVisible({ timeout: 10_000 });
    await confirmCloseBtn.click();

    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#k-cart-surface-switch')).toHaveCount(0);
    await expect(page.locator('#k-side-cart').getByRole('button', { name: /Clôturer la liste|Liste clôturée/ })).toHaveCount(0);

    const check = await verifySharedCart(page, token);
    expect(check.exists).toBe(true);
    if (check.cart) expect(check.cart.status).toBe('closed');
  });

  test('F22-9b — × quitte seulement l’affichage, restaure Mon panier et ne ressuscite pas la liste au reload', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    // Alimente le panier personnel après publication : il doit survivre à
    // toute navigation dans la liste et réapparaître à la sortie locale.
    const secondCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(1);
    await secondCard.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await addToCartFromModal(page);
    await closeModal(page);

    const exitBtn = page.locator('#k-cart-surface-switch .k-cart-tab-exit');
    await expect(exitBtn).toBeVisible({ timeout: 10_000 });
    await exitBtn.click();

    await expect(page.locator('#k-cart-surface-switch')).toHaveCount(0);
    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(0);
    await expect(page.locator('#k-side-cart .k-sc-item')).toHaveCount(1);

    const stillOpen = await verifySharedCart(page, token);
    expect(stillOpen.cart?.status).toBe('open');

    await page.reload();
    await openCartDrawer(page);
    await expect(page.locator('#k-cart-surface-switch')).toHaveCount(0);
    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(0);
    await expect(page.locator('#k-side-cart .k-sc-item')).toHaveCount(1);
  });

  test('F22-10 — l’action unique « Partager » réutilise le lien actif, sans recréer de liste', async ({ page }) => {
    const { token } = await createSharedList(page, 1);

    const postSpy = await spyOnApi(page, '/api/shared-carts/from-cart-items', 'POST');
    await stubShareChannels(page);

    await expect(page.locator('#k-cart-reshare, #k-sc-reshare')).toHaveCount(0);
    const shareBtn = page
      .locator('#k-side-cart')
      .getByRole('button', { name: 'Partager', exact: true });
    await expect(shareBtn).toHaveCount(1);
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });
    await shareBtn.click();

    // Laisser une fenêtre courte pour être sûr qu'aucune création ne part.
    await page.waitForTimeout(1_500);
    expect(postSpy.calls().length, 'Partager une liste affichée ne doit jamais recréer une liste').toBe(0);

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

      const saveBtn = participantPage
        .locator('#k-side-cart')
        .getByRole('button', { name: /Sauvegarder|Sauvegardée/ })
        .first();
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

  test('F22-12 — reload : créateur ET participant restaurent la liste active sans reclic ni bascule', async ({ page, browser }) => {
    const { token } = await createSharedList(page, 2);

    // 1. Créateur : couverture historique.
    await page.reload();

    const creatorTabs = page.locator('#k-cart-surface-switch');
    await expect(creatorTabs).toBeVisible({ timeout: 10_000 });
    await expect(
      creatorTabs.locator('.k-tab-shared-list'),
    ).toHaveClass(/k-cart-tab--active/);

    await expect(
      page.locator('#k-side-cart .k-cart-snapshot-item'),
    ).toHaveCount(2, { timeout: 10_000 });

    const creatorState = await getClientShareState(page);
    expect(creatorState?.token).toBe(token);

    // 2. Participant : cas manquant qui reproduit la régression terrain.
    const participantContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await participantContext.clearCookies();

    const participantPage = await participantContext.newPage();

    try {
      await participantPage.goto(getSharePageUrl(token));

      const participantTabs = participantPage.locator('#k-cart-surface-switch');
      await expect(participantTabs).toBeVisible({ timeout: 10_000 });
      await expect(
        participantTabs.locator('.k-tab-shared-list'),
      ).toHaveClass(/k-cart-tab--active/);

      await expect(
        participantPage.locator('#k-side-cart .k-cart-snapshot-item'),
      ).toHaveCount(2, { timeout: 10_000 });

      // ?p=token a été consommé/nettoyé : le reload ne pourra pas
      // récupérer le token depuis l'URL.
      expect(participantPage.url()).not.toContain(`p=${token}`);

      const beforeReload = await participantPage.evaluate(() => {
        try {
          return JSON.parse(sessionStorage.getItem('kmrc_share') || 'null');
        } catch (_) {
          return null;
        }
      });

      expect(beforeReload?.token).toBe(token);

      // Régression P0 réelle.
      await participantPage.reload();

      const tabsAfterReload = participantPage.locator('#k-cart-surface-switch');
      await expect(tabsAfterReload).toBeVisible({ timeout: 10_000 });
      await expect(
        tabsAfterReload.locator('.k-tab-shared-list'),
      ).toHaveClass(/k-cart-tab--active/);

      await expect(
        participantPage.locator('#k-side-cart .k-cart-snapshot-item'),
      ).toHaveCount(2, { timeout: 10_000 });

      const afterReload = await participantPage.evaluate(() => {
        try {
          return JSON.parse(sessionStorage.getItem('kmrc_share') || 'null');
        } catch (_) {
          return null;
        }
      });

      expect(afterReload?.token).toBe(token);
    } finally {
      await participantContext.close();
    }
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
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('L10-D — personal → liste → personal → liste : panier strictement intact', async ({ page }) => {
    // Publier une liste — le panier source est vidé après succès.
    const { token } = await createSharedList(page, 2);
    expect(token).toBeTruthy();

    // Constituer ensuite un panier personnel distinct pendant que la liste
    // reste OPEN.
    const personalCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(2);
    await expect(personalCard).toBeVisible({ timeout: 10_000 });
    await personalCard.click();
    await page.waitForSelector(
      '#k-modal-overlay.open, .k-modal-overlay.open',
      { timeout: 6_000 },
    );
    await addToCartFromModal(page);
    await closeModal(page);

    const cartBefore = await getClientCart(page);
    expect(
      cartBefore.length,
      'Le panier personnel distinct doit contenir 1 article',
    ).toBe(1);

    // Les tabs doivent être présents (liste active dans le slot).
    const tabs = page.locator('#k-cart-surface-switch');
    await expect(tabs).toBeVisible({ timeout: 8_000 });
    await expect(tabs.locator('.k-cart-tab')).toHaveCount(2);
    await expect(tabs.locator('.k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);

    // Basculer vers Mon panier.
    await tabs.locator('.k-tab-personal').click();
    await expect(tabs.locator('.k-tab-personal')).toHaveClass(/k-cart-tab--active/);
    // Le shell reste visible (invariant L1).
    await expect(page.locator('#k-side-cart')).toHaveClass(/has-items/);

    // Revenir à la liste.
    await tabs.locator('.k-tab-shared-list').click();
    await expect(tabs.locator('.k-tab-shared-list')).toHaveClass(/k-cart-tab--active/);
    // Le snapshot doit être présent.
    await expect(page.locator('#k-side-cart .k-cart-snapshot-item')).toHaveCount(2, { timeout: 8_000 });

    // L'état backend de la liste reste OPEN.
    const stateAfter = await getClientShareState(page);
    expect(stateAfter?.token).toBe(token);
  });
});

test.describe('NAVIGATION — Mobile 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('L10-M — personal → liste → personal → liste : drawer mobile symétrique', async ({ page }) => {
    // Publier d’abord la liste depuis son panier source.
    const { token } = await createSharedList(page, 1);
    expect(token).toBeTruthy();

    // Le drawer liste est ouvert après publication : le fermer avant de
    // cliquer le catalogue, puis constituer un panier personnel distinct.
    await page.locator('#k-cart-close').click();
    await expect(page.locator('#k-cart-drawer')).not.toHaveClass(/open/);

    const personalCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(1);
    await expect(personalCard).toBeVisible({ timeout: 10_000 });
    await personalCard.click();
    await page.waitForSelector(
      '#k-modal-overlay.open, .k-modal-overlay.open',
      { timeout: 6_000 },
    );
    await addToCartFromModal(page);
    await closeModal(page);

    const cartBefore = await getClientCart(page);
    expect(
      cartBefore.length,
      'Le panier personnel distinct doit contenir 1 article',
    ).toBe(1);

    await openCartDrawer(page);

    // Tabs dans le drawer mobile.
    // Les tabs sont injectés dans #k-cart-drawer (N1 fix §15).
    const drawerTabs = page.locator('#k-cart-surface-switch-drawer');
    await expect(drawerTabs).toBeVisible({ timeout: 8_000 });
    await expect(drawerTabs.locator('.k-cart-tab')).toHaveCount(2);

    // Basculer vers Mon panier depuis le drawer.
    await drawerTabs.locator('.k-tab-personal').click();
    // Le drawer doit afficher un état vide explicite, pas être blanc.
    const drawerBody = page.locator('#k-cart-body');
    await expect(drawerBody).toBeVisible({ timeout: 5_000 });

    // Revenir à la liste depuis le drawer.
    await drawerTabs.locator('.k-tab-shared-list').click();
    // Les lignes de snapshot doivent réapparaître.
    await expect(page.locator('#k-cart-body .k-cart-snapshot-item, #k-cart-drawer .k-cart-snapshot-item')).toHaveCount(1, { timeout: 8_000 });

    // Mon panier mobile : retour et vérification intégrité.
    await drawerTabs.locator('.k-tab-personal').click();
    const cartAfter = await getClientCart(page);
    // Le panier personnel reste cohérent avec l'état.
    expect(cartAfter).toBeDefined();
  });

  test('L10-M2 — panier non vide visible sur mobile après bascule vers liste et retour', async ({ page }) => {
    // Créer la liste, puis un panier personnel distinct après publication.
    const { token } = await createSharedList(page, 1);
    expect(token).toBeTruthy();

    await page.locator('#k-cart-close').click();
    await expect(page.locator('#k-cart-drawer')).not.toHaveClass(/open/);

    const personalCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').nth(1);
    await expect(personalCard).toBeVisible({ timeout: 10_000 });
    await personalCard.click();
    await page.waitForSelector(
      '#k-modal-overlay.open, .k-modal-overlay.open',
      { timeout: 6_000 },
    );
    await addToCartFromModal(page);
    await closeModal(page);

    await openCartDrawer(page);

    // Basculer : liste → personal → liste → personal.
    // Sur mobile, cartSurface='personal' doit rappeler renderCartBody().
    const drawerTabs = page.locator('#k-cart-surface-switch-drawer');
    if (await drawerTabs.count()) {
      await drawerTabs.locator('.k-tab-personal').click();
      await expect(page.locator('#k-cart-body .k-cart-item')).toHaveCount(1);

      await drawerTabs.locator('.k-tab-shared-list').click();
      await expect(
        page.locator('#k-cart-body .k-cart-snapshot-item'),
      ).toHaveCount(1);

      await drawerTabs.locator('.k-tab-personal').click();
      await expect(page.locator('#k-cart-body .k-cart-item')).toHaveCount(1);
    }

    // L'état backend reste intact.
    const state = await getClientShareState(page);
    expect(state?.token, 'Le token de liste doit survivre aux bascules').toBe(token);
  });
});
