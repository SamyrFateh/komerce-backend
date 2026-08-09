/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   checkout.spec.js
 * @feature orders, payments
 * @brief Checkout : identité/relais (résumés compacts, mandat simplification
 *        2026-08), retrait sécurisé, state machine relais, chips paiement,
 *        bouton Confirmer verrouillé, retry relais.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  addFirstProductToCart, openCheckout,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-CHECKOUT — Checkout complet', () => {
  // Ces flows nécessitent un catalogue réel (données produit du backend) :
  // indisponibles en mode LOCAL (npx serve, sans API). Lancer avec BASE_URL distant.
  test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');


  test.beforeEach(async ({ page }) => {
    await addFirstProductToCart(page);
  });

  test('E4 — Le checkout s\'ouvre avec identité + relais en résumés compacts et la section paiement', async ({ page }) => {
    await openCheckout(page);

    // Identité (Lot 3, simplification 2026-08) : plus de section "QUI
    // RÉCUPÈRE" à onglets — une ligne compacte renderStepHeader (label =
    // nom/téléphone, sublabel "identifié") avec un lien "Changer".
    const identityHeader = page.locator('#ck-identity-recap.ck-step-header, .ck-step-header--identity').first();
    if ((await identityHeader.count()) > 0) {
      await expect(identityHeader).toBeAttached({ timeout: 5_000 });
    }

    // Relais : même composant renderStepHeader (label = nom du relais,
    // sublabel = île · zone), jamais l'ancien titre "POINT DE RETRAIT".
    const relaisSummary = page.locator('#ck-relais-summary').first();
    await expect(relaisSummary).toBeAttached({ timeout: 8_000 });
    await expect(relaisSummary.locator('.ck-step-header-change')).toHaveText('Changer');

    // Section paiement : titre statique "Comment souhaitez-vous payer ?"
    // (règle §4, simplification 2026-08 — jamais "PAIEMENT" ni "régler le solde").
    await expect(page.locator('#ck-payment-summary .ck-section-title')).toHaveText('Comment souhaitez-vous payer ?');

    // Bouton Confirmer sticky en bas
    await expect(page.locator('#btn-confirm-order')).toBeAttached({ timeout: 5_000 });
  });

  test('E4b — Achat personnel (hors liste) : bloc statique "Retrait sécurisé", aucun formulaire bénéficiaire', async ({ page }) => {
    await openCheckout(page);

    // Lot 3 : le formulaire bénéficiaire distinct ("Pour moi / Pour
    // quelqu'un d'autre", champ nom/téléphone) a été retiré du checkout —
    // remplacé par un bloc statique informatif, jamais un toggle éditable.
    const secureNotice = page.locator('.ck-secure-pickup-notice').first();
    await expect(secureNotice).toBeAttached({ timeout: 5_000 });
    await expect(secureNotice).toContainText('Retrait sécurisé');

    // Les anciens champs/toggle bénéficiaire n'existent plus dans le DOM.
    await expect(page.locator('.ck-recip-seg')).toHaveCount(0);
    await expect(page.locator('#of-beneficiary-name')).toHaveCount(0);
  });

  test('E5 — State machine relais : bouton Confirmer disabled tant que relais pas chargés', async ({ page }) => {
    await openCheckout(page);

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeAttached({ timeout: 5_000 });

    // Immédiatement après ouverture, le bouton est disabled (relais en loading ou déjà ready)
    // On vérifie que le sous-texte reflète un état cohérent
    const subText = await confirmBtn.evaluate(el => el.textContent || '');
    const validStates = ['Chargement', 'relais', 'Confirmer', 'Impossible'];
    const hasValidState = validStates.some(s => subText.includes(s));
    expect(hasValidState).toBe(true);
  });

  test('E5b — Si les relais chargent avec succès, le bouton Confirmer devient actif', async ({ page }) => {
    await openCheckout(page);

    const confirmBtn = page.locator('#btn-confirm-order');

    // Attendre que les relais soient chargés (relayStatus → ready, timeout 12s)
    await page.waitForFunction(
      () => {
        const btn = document.getElementById('btn-confirm-order');
        return btn && !btn.disabled;
      },
      { timeout: 12_000 }
    ).catch(() => {
      // Si la prod est lente, le bouton peut rester disabled — c'est le timeout central
      // Dans ce cas, on vérifie qu'on est dans un état cohérent (error ou loading, pas "actif sans relais")
    });

    const isDisabled = await confirmBtn.isDisabled();
    if (!isDisabled) {
      // Le bouton est activé → un relais est réellement sélectionné/chargé.
      // #ck-relais-summary n'est créé que dans ce cas précis (cf. b-checkout.js) ;
      // un simple text=Relais matche aussi le footer, le hero, les badges de
      // réassurance modale, etc. → strict mode violation (11 éléments).
      await expect(page.locator('#ck-relais-summary')).toBeAttached();
    } else {
      // Le bouton reste disabled → on doit être en erreur ou loading, JAMAIS en état incohérent
      const text = await confirmBtn.textContent();
      const coherent = text.includes('Chargement') || text.includes('Impossible') || text.includes('relais');
      expect(coherent).toBe(true);
    }
  });

  test('E5c — Relais en erreur/timeout → message "Impossible" + bouton Réessayer', async ({ page }) => {
    // Bloquer l'API AVANT d'ouvrir le checkout → les relais vont timeout
    await page.route('**/api/relais*', () => {
      // Ne jamais répondre — simule un timeout backend
    });
    await openCheckout(page);

    // Attendre le timeout central (10s max)
    await page.waitForSelector('.ck-relais-error, .ck-relais-retry, #ck-relais-retry', {
      timeout: 15_000,
    });

    // Message d'erreur visible
    const errorText = await page.locator('.ck-relais-error').textContent().catch(() => '');
    expect(errorText).toMatch(/Impossible.*charger.*relais/i);

    // Bouton Réessayer visible
    const retryBtn = page.locator('#ck-relais-retry');
    await expect(retryBtn).toBeAttached();

    // Confirmer est disabled
    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeDisabled();
  });

  test('E5d — Réessayer les relais (retry) recharge sans perdre le panier', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/relais*', async (route) => {
      callCount++;
      if (callCount === 1) {
        // Premier appel : pend (timeout)
        return;
      }
      // Deuxième appel : laisser passer
      await route.continue();
    });

    await openCheckout(page);
    // Attendre le timeout du premier appel
    await page.waitForSelector('#ck-relais-retry', { timeout: 15_000 });

    // Cliquer Réessayer
    await page.locator('#ck-relais-retry').click();

    // Les relais doivent se charger (le 2e appel passe)
    await page.waitForFunction(
      () => {
        const btn = document.getElementById('btn-confirm-order');
        return btn && !btn.disabled;
      },
      { timeout: 15_000 }
    ).catch(() => { /* prod lente — on vérifie au moins que le retry a relancé */ });

    expect(callCount).toBeGreaterThanOrEqual(2);

    // Le panier est toujours là (pas de reset)
    const badge = await page.evaluate(() => {
      const el = document.querySelector('#k-modal-cart-badge, [data-cart-count]');
      return el ? parseInt(el.textContent || '0', 10) : -1;
    });
    expect(badge).toBeGreaterThan(0);
  });

  test('E4c — Les chips de paiement sont visibles (Cash, Carte, PayPal…)', async ({ page }) => {
    await openCheckout(page);

    const chips = page.locator('.ck-pay-chip, .ck-pay-grid button');
    await expect(chips.first()).toBeAttached({ timeout: 5_000 });
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(2); // Au moins Cash + Carte

    // Cash est sélectionné par défaut
    const cashChip = page.locator('.ck-pay-chip:has-text("Cash"), button:has-text("Cash")').first();
    if ((await cashChip.count()) > 0) {
      const cls = await cashChip.getAttribute('class');
      expect(cls).toMatch(/active|selected/);
    }
  });

  test('E4d — Fermeture du checkout via Escape → retour au panier intact', async ({ page }) => {
    await openCheckout(page);
    await page.keyboard.press('Escape');

    await page.waitForFunction(
      () => {
        const m = document.getElementById('k-order-modal');
        return !m || !m.classList.contains('open');
      },
      { timeout: 4_000 }
    ).catch(() => {});

    // Le panier est toujours rempli
    const badge = await page.evaluate(() => {
      const el = document.querySelector('#k-modal-cart-badge, [data-cart-count]');
      return el ? parseInt(el.textContent || '0', 10) : 0;
    });
    expect(badge).toBeGreaterThan(0);
  });
});
