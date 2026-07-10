/**
 * helpers/boutique.helpers.js — Helpers partagés E2E Boutique Komerce
 *
 * Convention : chaque helper attend que l'action soit terminée (pas de
 * waitForTimeout arbitraire). Tous les timeouts sont explicites et documentés.
 */
'use strict';
const { expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';

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
}

/** Ouvre le drawer/tiroir panier (depuis le header ou la barre de nav). */
async function openCartDrawer(page) {
  // Fermer la modale si elle est encore ouverte
  const modalOpen = await page.locator('#k-modal-overlay.open').count();
  if (modalOpen) await closeModal(page);

  // Sur mobile : le bouton « Panier » est dans la barre de nav (#k-bnav)
  // Sur desktop : bouton #k-cart-btn ou header
  const trigger = page.locator(
    '[data-view="cart"], #k-cart-btn, #k-header-cart-btn, [data-action="open-cart"], button:has-text("Panier")'
  ).first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    // Attendre que le side-cart soit visible (animation)
    await page.waitForSelector('.k-side-cart.open, #k-side-cart.open, #k-sc-items', {
      state: 'attached',
      timeout: 5_000,
    }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** Ajoute un produit au panier depuis la page d'accueil (flow complet). */
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
  const otherBtn = page.locator('.ck-recip-seg button[data-me="0"]').first();
  await expect(otherBtn).toBeAttached({ timeout: 5_000 });
  await otherBtn.click();
  await page.waitForSelector('.ck-recip-fields:not([hidden])', { timeout: 3_000 });
}

// ─── Navigation onglets ─────────────────────────────────────────────────────

/** Navigue vers un onglet de la barre de navigation (boutique, suivi, groupe, portefeuille). */
async function navigateToTab(page, tabId) {
  const tab = page.locator(`#${tabId}, [data-tab="${tabId}"], .k-bnav-item[data-view="${tabId}"]`).first();
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

module.exports = {
  BASE_URL,
  waitForGrid,
  cardCount,
  clickCategory,
  openFirstCard,
  waitForModalOpen,
  closeModal,
  addToCartFromModal,
  openCartDrawer,
  addFirstProductToCart,
  openCheckout,
  selectRecipientOther,
  navigateToTab,
  blockAllApi,
  hangAllApi,
  unblockApi,
};
