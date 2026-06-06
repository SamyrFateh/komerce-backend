# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: boutique.spec.js >> F1 — Ouverture modal produit depuis la grille
- Location: tests\boutique.spec.js:83:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * @file boutique.spec.js
  3   |  * @brief ARCH-7 — Tests Playwright · Flows critiques F1–F5
  4   |  * @version S0 — Sprint 0 complet (05/2026)
  5   |  *
  6   |  * Flows couverts :
  7   |  *   F1 — Ouverture modal produit depuis la grille (mobile + desktop)
  8   |  *   F2 — Ajout au panier depuis la modal → badge + side-cart
  9   |  *   F3 — Checkout complet (renderCheckout → submitOrder — module à 116 écritures DOM)
  10  |  *   F4 — Fermeture modal + retour scroll catalogue
  11  |  *   F5 — Panier partagé : créer, partager, lire (shared-cart-public.html)
  12  |  *   F5b — Chargement offline depuis cache localStorage
  13  |  *
  14  |  * Usage :
  15  |  *   npx playwright test tests/boutique.spec.js --headed
  16  |  *   BASE_URL=https://staging.example.com npx playwright test
  17  |  *
  18  |  * Prérequis :
  19  |  *   npx playwright install chromium
  20  |  */
  21  | 
  22  | const { test, expect } = require('@playwright/test');
  23  | 
  24  | const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  25  | 
  26  | // ─── Helpers ────────────────────────────────────────────────────────────────
  27  | 
  28  | /** Attend que la grille catalogue soit hydratée (au moins une carte présente). */
  29  | async function waitForGrid(page) {
  30  |   await page.waitForSelector('#k-grid .k-promo-card, #k-grid .k-card', {
  31  |     timeout: 10_000,
  32  |   });
  33  | }
  34  | 
  35  | /** Clique sur la première carte produit disponible et retourne son data-id. */
  36  | async function openFirstCard(page) {
  37  |   await waitForGrid(page);
  38  |   const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  39  |   const productId = await card.getAttribute('data-id');
  40  |   await card.click();
  41  |   return productId;
  42  | }
  43  | 
  44  | /** Attend que la modal soit visible et affiche un produit (titre non vide). */
  45  | async function waitForModalOpen(page) {
  46  |   await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', {
  47  |     timeout: 5_000,
  48  |   });
  49  |   await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
  50  | }
  51  | 
  52  | /** Ajoute le premier produit au panier et retourne la quantité ajoutée. */
  53  | async function addFirstProductToCart(page) {
  54  |   await page.goto(BASE_URL);
  55  |   await openFirstCard(page);
  56  |   await waitForModalOpen(page);
  57  | 
  58  |   const badgeBefore = await page.locator('#k-modal-cart-badge').textContent();
  59  |   const qtyBefore = parseInt(badgeBefore || '0', 10);
  60  | 
  61  |   const stepperVal = await page.locator('#k-qty-val').textContent();
  62  |   const qtyToAdd = parseInt(stepperVal || '1', 10);
  63  | 
  64  |   const addBtn = page.locator('#k-add-cart-btn');
  65  |   await expect(addBtn).toBeEnabled({ timeout: 3_000 });
  66  |   await addBtn.click();
  67  | 
  68  |   await page.waitForFunction(
  69  |     ({ sel, before }) => {
  70  |       const el = document.querySelector(sel);
  71  |       return el && parseInt(el.textContent || '0', 10) > before;
  72  |     },
  73  |     { sel: '#k-modal-cart-badge', before: qtyBefore },
  74  |     { timeout: 5_000 }
  75  |   );
  76  | 
  77  |   return qtyToAdd;
  78  | }
  79  | 
  80  | // ─── F1 — Ouverture modal produit depuis la grille ──────────────────────────
  81  | // Vérifie mobile ET desktop via les projets Playwright (configurés dans playwright.config.js)
  82  | 
  83  | test('F1 — Ouverture modal produit depuis la grille', async ({ page }) => {
> 84  |   await page.goto(BASE_URL);
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  85  |   await waitForGrid(page);
  86  | 
  87  |   const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  88  |   const productId = await card.getAttribute('data-id');
  89  |   expect(productId).toBeTruthy();
  90  | 
  91  |   await card.click();
  92  |   await waitForModalOpen(page);
  93  | 
  94  |   await expect(page.locator('#k-modal-overlay')).toBeVisible();
  95  | 
  96  |   const name = await page.locator('#k-modal-name').textContent();
  97  |   expect(name.trim().length).toBeGreaterThan(0);
  98  | 
  99  |   const price = await page.locator('#k-modal-price').textContent();
  100 |   expect(price.trim().length).toBeGreaterThan(0);
  101 | 
  102 |   // Carousel : le slide est recréé dynamiquement par le carousel
  103 |   await page.waitForFunction(
  104 |     () => {
  105 |       const img = document.querySelector('#k-modal-carousel .k-modal-slide');
  106 |       return img && img.src && img.src.length > 0;
  107 |     },
  108 |     { timeout: 5_000 }
  109 |   );
  110 |   const imgSrc = await page
  111 |     .locator('#k-modal-carousel .k-modal-slide')
  112 |     .first()
  113 |     .getAttribute('src');
  114 |   expect(imgSrc).toBeTruthy();
  115 | 
  116 |   await expect(page.locator('#k-modal-close')).toBeVisible();
  117 | });
  118 | 
  119 | // ─── F2 — Ajout au panier depuis la modal ───────────────────────────────────
  120 | 
  121 | test('F2 — Ajout au panier depuis la modal → badge + side-cart', async ({ page }) => {
  122 |   await page.goto(BASE_URL);
  123 |   await openFirstCard(page);
  124 |   await waitForModalOpen(page);
  125 | 
  126 |   const badgeBefore = await page.locator('#k-modal-cart-badge').textContent();
  127 |   const qtyBefore = parseInt(badgeBefore || '0', 10);
  128 | 
  129 |   await expect(page.locator('#k-qty-val')).toBeVisible();
  130 |   const stepperVal = await page.locator('#k-qty-val').textContent();
  131 |   const qtyToAdd = parseInt(stepperVal || '1', 10);
  132 |   expect(qtyToAdd).toBeGreaterThan(0);
  133 | 
  134 |   const addBtn = page.locator('#k-add-cart-btn');
  135 |   await expect(addBtn).toBeEnabled({ timeout: 3_000 });
  136 |   await addBtn.click();
  137 | 
  138 |   // Badge panier doit augmenter
  139 |   await page.waitForFunction(
  140 |     ({ sel, before }) => {
  141 |       const el = document.querySelector(sel);
  142 |       if (!el) return false;
  143 |       return parseInt(el.textContent || '0', 10) > before;
  144 |     },
  145 |     { sel: '#k-modal-cart-badge', before: qtyBefore },
  146 |     { timeout: 5_000 }
  147 |   );
  148 | 
  149 |   const badgeAfter = await page.locator('#k-modal-cart-badge').textContent();
  150 |   expect(parseInt(badgeAfter || '0', 10)).toBeGreaterThan(qtyBefore);
  151 | 
  152 |   // Bouton reflète l'état "dans le panier"
  153 |   const btnClass = await addBtn.getAttribute('class');
  154 |   expect(btnClass).toContain('in-cart');
  155 | 
  156 |   // Fermer la modal et vérifier que le side-cart / tiroir contient le produit
  157 |   await page.locator('#k-modal-close').click();
  158 |   await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
  159 |     timeout: 3_000,
  160 |   });
  161 | 
  162 |   // Ouvrir le side-cart (bouton panier dans le header ou la barre de nav)
  163 |   const cartTrigger = page.locator('#k-cart-btn, #k-header-cart-btn, [data-action="open-cart"]').first();
  164 |   const triggerExists = await cartTrigger.count() > 0;
  165 |   if (triggerExists) {
  166 |     await cartTrigger.click();
  167 |     // Vérifier qu'un item est présent dans le side-cart
  168 |     await page.waitForSelector('.k-cart-item, .k-sc-item, #k-cart-items .k-cart-row', {
  169 |       timeout: 5_000,
  170 |     });
  171 |     const itemCount = await page.locator('.k-cart-item, .k-sc-item, #k-cart-items .k-cart-row').count();
  172 |     expect(itemCount).toBeGreaterThan(0);
  173 |   }
  174 | });
  175 | 
  176 | // ─── F3 — Checkout complet (module à 116 écritures DOM) ─────────────────────
  177 | 
  178 | test('F3 — Checkout complet : renderCheckout → formulaire → bouton payer', async ({ page }) => {
  179 |   // 1. Ajouter un produit au panier
  180 |   await addFirstProductToCart(page);
  181 | 
  182 |   // 2. Ouvrir le tiroir panier et lancer le checkout
  183 |   // Fermer la modal si encore ouverte
  184 |   const modalOpen = await page.locator('#k-modal-overlay.open').count();
```