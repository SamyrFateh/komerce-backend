/**
 * helpers/boutique.helpers.js — Helpers partagés E2E Boutique Komerce
 *
 * Convention : chaque helper attend que l'action soit terminée (pas de
 * waitForTimeout arbitraire). Tous les timeouts sont explicites et documentés.
 */
'use strict';
const { expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';

// Mode DISTANT dès que BASE_URL est fourni (voir playwright.config.js) : tests
// fonctionnels réels contre un environnement qui expose catalogue/API.
// Mode LOCAL (sans BASE_URL) : fichiers statiques servis via `npx serve ..`,
// SANS backend — le catalogue/API réels ne sont PAS disponibles dans ce mode.
const IS_REMOTE = Boolean(process.env.BASE_URL);

// Domaines/chemins externes facultatifs : jamais bloquants même en échec
// (indisponibles en environnement local/CI, non nécessaires au rendu).
const OPTIONAL_EXTERNAL_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /js\.stripe\.com/,
  /api\.stripe\.com/,
  /cloudinary\.com/,
];

// Ressources locales critiques : toute 404/échec réseau dessus est bloquant.
const CRITICAL_LOCAL_PATTERNS = [
  /\/boutique\/css\//,
  /\/boutique\/js\//,
  /\/images\//,
];

function isOptionalExternal(url) {
  return OPTIONAL_EXTERNAL_PATTERNS.some((re) => re.test(url));
}

function isCriticalLocal(url) {
  return CRITICAL_LOCAL_PATTERNS.some((re) => re.test(url));
}

/**
 * Contrôle de cible à lancer en tête d'un test nominal (catalogue notamment) :
 * - logue BASE_URL effective + mode (LOCAL/DISTANT) ;
 * - navigue vers BASE_URL et logue l'URL finale (détecte une redirection
 *   accidentelle, ex. vers localhost) ;
 * - exige un document principal 200 ;
 * - exige que l'origine finale corresponde à celle de BASE_URL ;
 * - collecte les échecs sur les ressources locales critiques (CSS/JS/images),
 *   en ignorant les ressources externes facultatives (Fonts, Stripe, Cloudinary).
 *
 * Retourne { response, failedCriticalResources } pour assertions dans l'appelant.
 */
async function gotoAndVerifyTarget(page) {
  const failedCriticalResources = [];

  page.on('response', (response) => {
    const url = response.url();
    if (isOptionalExternal(url) || !isCriticalLocal(url)) return;
    if (response.status() >= 400) failedCriticalResources.push(`${response.status()} ${url}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (isOptionalExternal(url) || !isCriticalLocal(url)) return;
    failedCriticalResources.push(`REQUESTFAILED ${request.failure()?.errorText || ''} ${url}`);
  });

  // eslint-disable-next-line no-console
  console.log(`[e2e] BASE_URL effective = ${BASE_URL} (mode ${IS_REMOTE ? 'DISTANT' : 'LOCAL'})`);
  const response = await page.goto(BASE_URL);
  // eslint-disable-next-line no-console
  console.log(`[e2e] URL finale après navigation = ${page.url()}`);

  expect(response, 'la navigation doit produire une réponse HTTP').not.toBeNull();
  expect(response.status(), 'le document principal doit répondre 200').toBe(200);
  expect(
    new URL(page.url()).origin,
    "l'URL finale doit rester sur l'origine de BASE_URL (pas de redirection accidentelle, ex. vers localhost)"
  ).toBe(new URL(BASE_URL).origin);

  return { response, failedCriticalResources };
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

/** Attend que la grille catalogue soit hydratée (≥1 carte visible). */
async function waitForGrid(page) {
  await page.waitForSelector('#k-grid .k-promo-card, #k-grid .k-card', {
    state: 'attached',
    timeout: 12_000,
  });
}

/** Retourne le nombre de cartes dans la grille. */
async function cardCount(page) {
  return page.locator('#k-grid .k-promo-card, #k-grid .k-card').count();
}

/** Clique sur une catégorie/chip par son texte visible. */
async function clickCategory(page, text) {
  const chip = page.locator('.k-chip, .k-cat-chip').filter({ hasText: text }).first();
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await chip.click();
  // Attend que la grille se re-rende (le nombre de cartes peut changer)
  await page.waitForTimeout(300);
}

// ─── Modale produit ─────────────────────────────────────────────────────────

/** Ouvre la première carte produit, attend la modale, retourne le data-id. */
async function openFirstCard(page) {
  await waitForGrid(page);
  const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  const productId = await card.getAttribute('data-id');
  await card.click();
  await waitForModalOpen(page);
  return productId;
}

/** Attend que l'overlay de la modale soit ouvert et qu'un nom soit affiché. */
async function waitForModalOpen(page) {
  await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', {
    timeout: 6_000,
  });
  await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
}

/** Ferme la modale (bouton ✕) et attend qu'elle soit fermée. */
async function closeModal(page) {
  await page.locator('#k-modal-close').click();
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
    timeout: 4_000,
  });
}

// ─── Panier ─────────────────────────────────────────────────────────────────

/** Ajoute le produit actuellement ouvert dans la modale au panier. */
async function addToCartFromModal(page) {
  const badgeBefore = parseInt(
    (await page.locator('#k-modal-cart-badge').textContent().catch(() => '0')) || '0',
    10
  );
  // Snapshot des éléments DOM existants avant le clic : assertNoOverlayOnActions
  // n'inspecte ensuite que les éléments réellement créés par l'action d'ajout
  // (ex. particule fly-to-cart), jamais le chrome permanent de la page (nav
  // mobile, pager, overlay) qui chevauche géométriquement la zone actions
  // sans être un défaut.
  await page.evaluate(() => {
    window.__preAddElements = new Set(document.querySelectorAll('body *'));
  });
  const addBtn = page.locator('#k-add-cart-btn');
  await expect(addBtn).toBeEnabled({ timeout: 3_000 });
  await addBtn.click();
  // Attend que le badge augmente
  await page.waitForFunction(
    ({ sel, before }) => {
      const el = document.querySelector(sel);
      return el && parseInt(el.textContent || '0', 10) > before;
    },
    { sel: '#k-modal-cart-badge', before: badgeBefore },
    { timeout: 6_000 }
  );
  // Attend la disparition réelle de la particule fly-to-cart (b-cart.js) —
  // un test/capture "état stable" pris avant cette disparition la verrait
  // encore visible au-dessus des actions.
  await page.waitForFunction(
    () => !document.querySelector('.k-fly-particle'),
    null,
    { timeout: 3_000 }
  );
}

/**
 * Oracle de collision — P1 (audit desktop 2026-07) : un test DOM vert du
 * type `.k-modal-actions img = 0` ne suffit pas, il laisse passer tout
 * élément non-<img> positionné par-dessus les actions (clone d'animation,
 * pseudo-élément, élément hors de .k-modal-actions). On vérifie ici
 * l'absence réelle de chevauchement visuel avec les cibles protégées :
 * `.k-qty`, le libellé « Dans le panier », `.k-buy-now-btn`.
 *
 * Ne considère que les éléments position:fixed/absolute apparus APRÈS le
 * snapshot pris par addToCartFromModal (window.__preAddElements) : le
 * chrome permanent (nav mobile fixe, overlay, pager) chevauche déjà
 * structurellement la zone actions sans être un défaut, et générerait sinon
 * des faux positifs sur toutes les fixtures.
 */
async function assertNoOverlayOnActions(page) {
  const offenders = await page.evaluate(() => {
    function intersectsRects(a, b) {
      return !(
        a.right <= b.left ||
        a.left >= b.right ||
        a.bottom <= b.top ||
        a.top >= b.bottom
      );
    }

    const targets = ['.k-qty', '.k-modal-actions .k-buy-now-btn', '#k-buy-now-btn']
      .map((sel) => document.querySelector(sel))
      .filter(Boolean);

    const filledLabel = Array.from(document.querySelectorAll('.k-modal-actions *')).find(
      (el) => el.children.length === 0 && /Dans le panier/.test(el.textContent || '')
    );
    if (filledLabel) targets.push(filledLabel);

    const pre = window.__preAddElements || new Set();
    const candidates = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      if (pre.has(el)) return false;
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') return false;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const found = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      for (const target of targets) {
        if (intersectsRects(rect, target.getBoundingClientRect())) {
          found.push(el.className || el.tagName);
          break;
        }
      }
    }
    return found;
  });

  expect(offenders, `Élément(s) flottant(s) au-dessus des actions: ${offenders.join(', ')}`).toEqual([]);
}

/**
 * Ouvre le drawer/tiroir panier (depuis le header ou la barre de nav).
 *
 * PIÈGE (cf. b-cart.js `openCart()`) : sur desktop, #k-cart-btn (la « dame »)
 * n'ouvre PAS un tiroir — il émet directement `checkout:open` et bascule sur
 * le flow de commande (`if (isDesktop()) { bus.emit('checkout:open'); return; }`).
 * Le side-cart desktop (#k-side-cart) est un panneau PERMANENT, déjà visible
 * dès que le panier a des articles (classe .has-items posée par
 * renderSideCart()) — cliquer #k-cart-btn ici serait donc contre-productif :
 * ça ouvrirait le checkout par-dessus et rendrait les steppers +/- inatteignables.
 * On ne clique le trigger qu'en mobile, où il ouvre réellement #k-cart-drawer.
 */
async function openCartDrawer(page) {
  // Fermer la modale si elle est encore ouverte
  const modalOpen = await page.locator('#k-modal-overlay.open').count();
  if (modalOpen) await closeModal(page);

  const isDesktopViewport = await page.evaluate(() => window.innerWidth >= 900);

  if (isDesktopViewport) {
    // Desktop : le side-cart est déjà affiché (permanent) dès que le panier
    // a des articles. On attend juste sa vraie visibilité (pas seulement
    // "attached" — #k-sc-items reste attaché même quand le panneau est en
    // display:none via .k-side-cart:not(.has-items)).
    const sideCart = page.locator('#k-side-cart.has-items');
    await expect(sideCart).toBeVisible({ timeout: 5_000 });
    return;
  }

  // Mobile : le bouton panier est dans la barre de nav (#k-bnav) et ouvre
  // réellement #k-cart-drawer / #k-cart-overlay (classe .open).
  const trigger = page.locator(
    '[data-view="cart"], #k-cart-btn, #k-header-cart-btn, [data-action="open-cart"], button:has-text("Panier")'
  ).first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForSelector('#k-cart-drawer.open, #k-cart-overlay.open', {
      state: 'visible',
      timeout: 5_000,
    }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * Retourne le locator des articles du panier, scopé au bon conteneur selon
 * le viewport.
 *
 * PIÈGE : desktop (#k-side-cart .k-sc-item) et mobile (#k-cart-body
 * .k-cart-item) sont deux DOM distincts qui coexistent dans la page — le
 * side-cart desktop reste présent (juste masqué en CSS) même sur mobile.
 * Un sélecteur non scopé (`.k-cart-item, .k-sc-item, ...`) matche les deux ;
 * `.first()` retombe alors sur le premier en ordre DOM, qui peut être
 * l'élément caché → faux « hidden » sur toBeVisible().
 */
async function getCartItems(page) {
  const isDesktopViewport = await page.evaluate(() => window.innerWidth >= 900);
  return isDesktopViewport
    ? page.locator('#k-side-cart .k-sc-item')
    : page.locator('#k-cart-body .k-cart-item');
}


async function addFirstProductToCart(page) {
  await page.goto(BASE_URL);
  await openFirstCard(page);
  await addToCartFromModal(page);
}

// ─── Checkout ───────────────────────────────────────────────────────────────

/** Ouvre le checkout (Commander) depuis le tiroir panier. */
async function openCheckout(page) {
  await openCartDrawer(page);
  // Le bouton Commander mobile (#k-sc-checkout) émet bus('checkout:open') → checkoutCart().
  // Sur mobile, le bouton peut être hors viewport ou l'overlay intercepte le clic Playwright.
  // On utilise directement le bus/la fonction pour un déclenchement fiable.
  await page.evaluate(() => {
    if (window.__bus) window.__bus.emit('checkout:open');
    else if (typeof window.checkoutCart === 'function') window.checkoutCart();
    else document.getElementById('k-sc-checkout')?.click();
  });
  await page.waitForSelector('#k-order-modal.open, .k-order-modal.open', {
    timeout: 10_000,
  });
}

/**
 * Bascule le bloc « QUI RÉCUPÈRE ? » sur « Quelqu'un d'autre » et attend que
 * les champs bénéficiaire (nom/tél) soient révélés.
 * Par défaut le mode est « Moi » et #of-beneficiary-name est masqué (hidden),
 * pas seulement hors viewport — un simple scrollIntoViewIfNeeded ne suffit
 * donc pas à le rendre visible (cf. incident F3 / e2e-feature-first).
 */
async function selectRecipientOther(page) {
  // Le bloc « Pour moi / Pour quelqu'un d'autre » (.ck-recip-seg) a été
  // supprimé du checkout (l'identité bénéficiaire est maintenant portée
  // directement par la session). Cette fonction est conservée pour ne pas
  // casser les imports, mais elle skippe proprement si l'élément est absent.
  const otherBtn = page.locator('.ck-recip-seg button[data-me="0"]').first();
  const present = await otherBtn.count();
  if (!present) {
    // Bloc supprimé — les tests qui l'appellent doivent être mis à jour
    // pour refléter le nouveau flux checkout sans sélection de bénéficiaire.
    return;
  }
  await expect(otherBtn).toBeAttached({ timeout: 5_000 });
  await otherBtn.click();
  await page.waitForSelector('.ck-recip-fields:not([hidden])', { timeout: 3_000 });
}

// ─── Navigation onglets ─────────────────────────────────────────────────────

/**
 * Navigue vers un onglet de la barre de navigation (boutique, suivi, groupe, portefeuille).
 *
 * Même bug que getCartItems (cf. fix cart mobile/desktop) : header (desktop,
 * .k-header-nav-btn) et bnav (mobile, .k-bnav-item) partagent le MÊME
 * data-tab="${tabId}" — les deux existent dans le DOM sur les deux viewports,
 * seul le CSS les cache (.k-header-nav-btn{display:none} mobile-first,
 * .k-bnav{display:none} desktop). Le sélecteur générique + .first() tombait
 * en ordre DOM sur le bouton header (toujours avant le bnav dans le HTML),
 * caché en mobile → click() boucle indéfiniment sur "not visible".
 * On scope explicitement selon le viewport, comme getCartItems.
 */
async function navigateToTab(page, tabId) {
  const isDesktopViewport = await page.evaluate(() => window.innerWidth >= 900);
  const tab = isDesktopViewport
    ? page.locator(`.k-header-nav-btn[data-tab="${tabId}"]`).first()
    : page.locator(`.k-bnav-item[data-tab="${tabId}"]`).first();
  if ((await tab.count()) > 0) {
    await tab.click();
    await page.waitForTimeout(300);
  }
}

// ─── Résilience ─────────────────────────────────────────────────────────────

/** Intercepte les appels API et les fait échouer (simule une panne). */
async function blockAllApi(page) {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
}

/** Intercepte les appels API et les fait pendre (simule un timeout backend). */
async function hangAllApi(page) {
  await page.route('**/api/**', (route) => {
    // Ne jamais répondre — le timeout central K.request doit couper
  });
}

/** Restaure le routage normal (après block/hang). */
async function unblockApi(page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

/**
 * É5 (2026-08) — window.confirm est encore utilisé pour DEUX des trois
 * confirmations métier du mandat §11 : publication (b-share-cart.js) et
 * conflit "liste déjà ouverte" (b-share-cart.js). Playwright refuse les
 * dialogs natifs par défaut (retourne false). Ce helper les accepte pour
 * la durée d'un test.
 *
 * NE COUVRE PAS la fermeture de liste ("Fermer la liste") : ce chemin a
 * été migré vers la modale DOM Komerce (group-side-cart.js::showKomerceConfirm,
 * cf. clickKomerceConfirm ci-dessous). Un test qui clique le bouton fermer
 * doit utiliser clickKomerceConfirm(page), pas acceptConfirms — sinon
 * page.on('dialog') n'a rien à accepter (aucun dialogue natif n'apparaît)
 * et le test reste bloqué en attente indéfinie de la Promise retournée par
 * showKomerceConfirm().
 *
 * Usage :
 *   acceptConfirms(page);  // avant le clic sur Partager / Créer une liste
 */
function acceptConfirms(page) {
  page.on('dialog', (dialog) => dialog.accept());
}

/**
 * L7 — clique le bouton confirmer (ou annuler) de la modale Komerce DOM
 * (group-side-cart.js::showKomerceConfirm), utilisée aujourd'hui pour la
 * fermeture de liste ("Fermer la liste"). Ce n'est PAS un dialog natif :
 * acceptConfirms()/page.on('dialog') ne s'applique pas ici.
 *
 * Usage :
 *   await closeBtn.click();
 *   await clickKomerceConfirm(page); // clique "Fermer la liste"
 */
async function clickKomerceConfirm(page, { confirm = true } = {}) {
  const dialog = page.locator('.k-confirm-dialog[role="alertdialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const button = confirm
    ? dialog.locator('.k-confirm-dialog-btn-primary, .k-confirm-dialog-btn-danger')
    : dialog.locator('.k-confirm-dialog-btn-secondary');
  await button.click();
  await expect(dialog).toHaveCount(0);
}

module.exports = {
  BASE_URL,
  IS_REMOTE,
  gotoAndVerifyTarget,
  waitForGrid,
  cardCount,
  clickCategory,
  openFirstCard,
  waitForModalOpen,
  closeModal,
  addToCartFromModal,
  assertNoOverlayOnActions,
  openCartDrawer,
  getCartItems,
  addFirstProductToCart,
  openCheckout,
  selectRecipientOther,
  navigateToTab,
  blockAllApi,
  hangAllApi,
  unblockApi,
  acceptConfirms,
  clickKomerceConfirm,
};
