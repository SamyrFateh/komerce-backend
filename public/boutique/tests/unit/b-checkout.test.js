/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          checkout-submit-order-tests
 * @domain        checkout
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/b-checkout.test.js
 * @purpose       Tests unitaires du flux de commande (submitOrder, PayPal,
 *                cash_relais). Vérifie le payload POST /api/orders incluant
 *                requested_transport_rail par item (code canonique, cf.
 *                migration DB 117 — plus de champ legacy delivery_mode).
 * @impact-areas  checkout, orders, cart, delivery-mode
 * @version       2026-07
 */

'use strict';

/**
 * tests/unit/b-checkout.test.js
 *
 * Module #2 (suite) du plan d'attaque frontend — js/b-checkout.js (1299L), 0%.
 *
 * Périmètre couvert (logique métier + argent, dans l'esprit "priorité au
 * revenu" déjà appliqué à b-paypal.js/b-cart.js) :
 *   - digitsOnly / normalizeLocal / prettifyLocal / buildE164 (délégation b-phone.js)
 *   - closeOrderModal
 *   - updateWalletDisplay
 *   - checkoutCart (garde panier vide — le chemin succès appelle renderCheckout()
 *     en interne, cf. note de dette ci-dessous)
 *   - submitOrder (LE cœur argent de ce fichier) : toutes les validations
 *     (relais requis, annulation OTP, garde anti double-clic — Lot 3 : plus
 *     de bénéficiaire de retrait distinct à valider), le chemin succès
 *     cash_relais bout-en-bout jusqu'à renderOrderSuccess, et le chemin
 *     erreur Stripe (carte non chargée).
 *   - renderOrderSuccess (construction DOM déléguée à buildOrderSuccessDOM,
 *     on vérifie le câblage des listeners métier : copier, fermer, suivre)
 *   - makeInput / makePhoneInput / makeIntlPhoneInput (délégation render/phone)
 *
 * Dette assumée, hors périmètre de ce lot (même logique que flyToCart/
 * renderSideCart pour b-cart.js) : `renderCheckout()` (550L, orchestration
 * DOM complète du formulaire : identité, relais, fulfillment, PayPal, Stripe
 * card element) et le chemin succès complet de `checkoutCart()` qui l'appelle
 * en interne (binding local ES→CJS, non interceptable par mock). À reprendre
 * en sous-lot dédié avec une fixture DOM plus lourde si on veut pousser plus loin.
 *
 * state/dom viennent du vrai b-store.js (pattern déjà en place). Tous les
 * modules périphériques (identité, rendu checkout, téléphone, PayPal, panier,
 * réseau, scroll) sont mockés.
 */

jest.mock('../../js/b-paypal.js', () => ({
  renderPayPalButton: jest.fn(() => Promise.resolve()),
  isPayPalEnabled: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('../../js/b-cart.js', () => ({
  openCart: jest.fn(),
  closeCart: jest.fn(),
  renderCart: jest.fn(),
  clearCart: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
  scrollPageToTop: jest.fn(),
}));

jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
  getCurrentIdentity: jest.fn(() => null),
  restoreIdentity: jest.fn(() => Promise.resolve(null)),
  bindChangeIdentity: jest.fn(),
  openIdentityModal: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../../js/b-checkout-render.js', () => ({
  renderFulfillmentSelector: jest.fn(),
  setCheckoutConfirmButton: jest.fn(),
  buildOrderSuccessDOM: jest.fn(() => ({ copyBtn: null, closeBtn: null, trackBtn: null })),
  buildIdentityRecapDOM: jest.fn(() => {
    let el = global.document.createElement('div');
    el.id = 'ck-identity-recap';
    el.innerHTML = '<button class="k-ck-id-change"></button><button class="k-ck-id-notyou"></button>';
    return el;
  }),
  applyIdentityToCard: jest.fn(),
  renderStepHeader: jest.fn(({ state: stepState, label, sublabel, onChange }) => {
    const el = global.document.createElement('div');
    el.className = 'ck-step-header ck-step-header--' + stepState;
    el.textContent = [label, sublabel].filter(Boolean).join(' ');
    if (onChange) el.addEventListener('click', onChange);
    return el;
  }),
  makeInput: jest.fn(() => global.document.createElement('div')),
  makePhoneInput: jest.fn(() => global.document.createElement('div')),
}));

jest.mock('../../js/b-phone.js', () => ({
  PHONE_COUNTRIES: [{ code: '+269', name: 'Comores', digits: 7 }],
  digitsOnly: jest.fn((v) => (v || '').replace(/\D/g, '')),
  normalizeLocal: jest.fn((code, digits) => digits),
  prettifyLocal: jest.fn((raw) => raw),
  buildE164: jest.fn((code, digits) => code + digits),
  isValidLocalLength: jest.fn(() => true),
  makeIntlPhoneInput: jest.fn(() => global.document.createElement('div')),
}));

jest.mock('../../js/b-utils.js', () => ({
  fmt: jest.fn((n) => String(n) + ' KMF'),
  sanitize: jest.fn((s) => s),
  genIdempotencyKey: jest.fn(() => 'idem-key-1'),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  cartTotal: jest.fn(() => 0),
}));

const { bus } = require('../../js/b-bus.js');
const { state, dom, scroll } = require('../../js/b-store.js');
const { showToast, cartTotal } = require('../../js/b-cart-core.js');
const { apiPost, apiGet } = require('../../js/b-utils.js');
const { clearCart, openCart, closeCart } = require('../../js/b-cart.js');
const { requireIdentity, getCurrentIdentity, restoreIdentity, bindChangeIdentity, openIdentityModal } = require('../../js/b-identity.js');
const { digitsOnly: _digitsOnly, normalizeLocal: _normalizeLocal, prettifyLocal: _prettifyLocal, buildE164: _buildE164 } =
  require('../../js/b-phone.js');
const { buildOrderSuccessDOM, buildIdentityRecapDOM, applyIdentityToCard, renderStepHeader, setCheckoutConfirmButton, makeInput: _makeInputRender, makePhoneInput: _makePhoneInputRender } =
  require('../../js/b-checkout-render.js');
const { scrollToPosition } = require('../../js/b-scroll-owner.js');
const { renderPayPalButton, isPayPalEnabled } = require('../../js/b-paypal.js');

const {
  digitsOnly, normalizeLocal, prettifyLocal, buildE164,
  checkoutCart, closeOrderModal, updateWalletDisplay, checkWalletBalance,
  submitOrder, renderOrderSuccess, renderCheckout,
  makeInput, makePhoneInput, makeIntlPhoneInput,
  getDefaultPhoneCodeForZone,
} = require('../../js/b-checkout.js');

function resetDom() {
  document.body.innerHTML = '';
  dom.orderModal = document.createElement('div');
  const wrapper = document.createElement('div');
  dom.orderBody = document.createElement('div');
  wrapper.appendChild(dom.orderBody);
  dom.orderTitle = document.createElement('div');
  dom.modalOverlay = document.createElement('div');
  document.body.appendChild(dom.orderModal);
  document.body.appendChild(wrapper);
}

describe('b-checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.cart = [];
    state.orderData = {};
    state.walletBalance = 0;
    state.checkoutAttemptKey = null;
    state.pendingStripeOrderRef = null;
    state.shareToken = null;
    scroll.savedY = 0;
    getCurrentIdentity.mockReturnValue(null);
  });

  describe('délégation téléphone (b-phone.js)', () => {
    it('digitsOnly délègue à b-phone.js', () => {
      digitsOnly('06 12 34');
      expect(_digitsOnly).toHaveBeenCalledWith('06 12 34');
    });
    it('normalizeLocal délègue à b-phone.js', () => {
      normalizeLocal('+269', '123456');
      expect(_normalizeLocal).toHaveBeenCalledWith('+269', '123456');
    });
    it('prettifyLocal délègue à b-phone.js', () => {
      prettifyLocal('123456', '+269');
      expect(_prettifyLocal).toHaveBeenCalledWith('123456', '+269');
    });
    it('buildE164 délègue à b-phone.js', () => {
      buildE164('+269', '123456');
      expect(_buildE164).toHaveBeenCalledWith('+269', '123456');
    });
  });

  describe('getDefaultPhoneCodeForZone (fonction pure interne)', () => {
    it('retourne +33 pour la zone france', () => {
      expect(getDefaultPhoneCodeForZone('france')).toBe('+33');
    });
    it('retourne +269 pour la zone comoros', () => {
      expect(getDefaultPhoneCodeForZone('comoros')).toBe('+269');
    });
    it('retourne +269 par défaut pour toute autre zone/valeur absente', () => {
      expect(getDefaultPhoneCodeForZone('mayotte')).toBe('+269');
      expect(getDefaultPhoneCodeForZone(undefined)).toBe('+269');
      expect(getDefaultPhoneCodeForZone('')).toBe('+269');
    });
  });

  describe('makeInput / makePhoneInput / makeIntlPhoneInput (délégation rendu)', () => {
    it('makeInput délègue à b-checkout-render.js', () => {
      makeInput('id1', 'Label', 'text', 'placeholder', {}, 'key');
      expect(_makeInputRender).toHaveBeenCalledWith('id1', 'Label', 'text', 'placeholder', {}, 'key');
    });
    it('makePhoneInput délègue à b-checkout-render.js', () => {
      makePhoneInput('id2', 'Tel', {}, 'phone');
      expect(_makePhoneInputRender).toHaveBeenCalledWith('id2', 'Tel', {}, 'phone');
    });
    it('makeIntlPhoneInput ne throw pas (délègue à b-phone.js)', () => {
      expect(() => makeIntlPhoneInput('id3', 'Tel intl', {}, 'phone')).not.toThrow();
    });
  });

  describe('closeOrderModal', () => {
    it('ferme la modale et restaure le scroll sauvegardé', () => {
      dom.orderModal.classList.add('open');
      document.body.classList.add('cart-open');
      scroll.savedY = 789;

      closeOrderModal();

      expect(dom.orderModal.classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('cart-open')).toBe(false);
      expect(scrollToPosition).toHaveBeenCalledWith(789);
      expect(scroll.savedY).toBe(0);
    });

    it('restaure la bnav masquée (u-hidden retiré)', () => {
      const bnav = document.createElement('div');
      bnav.id = 'k-bnav';
      bnav.classList.add('u-hidden');
      document.body.appendChild(bnav);

      closeOrderModal();

      expect(bnav.classList.contains('u-hidden')).toBe(false);
    });

    it('sans scroll sauvegardé, ne rappelle pas scrollToPosition', () => {
      scroll.savedY = 0;
      closeOrderModal();
      expect(scrollToPosition).not.toHaveBeenCalled();
    });
  });

  describe('updateWalletDisplay', () => {
    it("aucun élément #wallet-deduction dans le DOM → ne fait rien, ne throw pas", () => {
      expect(() => updateWalletDisplay()).not.toThrow();
    });

    it('case wallet cochée + solde couvrant tout → message "entièrement couvert"', () => {
      const ded = document.createElement('div');
      ded.id = 'wallet-deduction';
      document.body.appendChild(ded);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'cb-use-wallet';
      cb.checked = true;
      document.body.appendChild(cb);

      state.walletBalance = 5000;
      cartTotal.mockReturnValue(3000);

      updateWalletDisplay();

      expect(ded.classList.contains('is-visible')).toBe(true);
      expect(ded.innerHTML).toContain('Entièrement couvert');
    });

    it('case wallet cochée + solde partiel → affiche le montant restant dû (« À payer », jamais « reste à régler »)', () => {
      const ded = document.createElement('div');
      ded.id = 'wallet-deduction';
      document.body.appendChild(ded);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'cb-use-wallet';
      cb.checked = true;
      document.body.appendChild(cb);

      state.walletBalance = 1000;
      cartTotal.mockReturnValue(3000);

      updateWalletDisplay();

      expect(ded.innerHTML).toContain('À payer');
      expect(ded.innerHTML).not.toContain('régler');
    });

    it('case wallet décochée → masque le bloc (is-visible retiré)', () => {
      const ded = document.createElement('div');
      ded.id = 'wallet-deduction';
      ded.classList.add('is-visible');
      document.body.appendChild(ded);

      updateWalletDisplay();

      expect(ded.classList.contains('is-visible')).toBe(false);
    });
  });

  describe('checkoutCart (garde panier vide)', () => {
    it('panier vide → toast erreur, ne touche pas à la modale', () => {
      state.cart = [];
      checkoutCart();
      expect(showToast).toHaveBeenCalledWith('Votre panier est vide.', 'error');
      expect(dom.orderModal.classList.contains('open')).toBe(false);
    });
  });

  describe('submitOrder — validations', () => {
    it('aucun relais sélectionné → toast erreur, marque la section en erreur', () => {
      const relaisSection = document.createElement('div');
      relaisSection.id = 'ck-relais-section';
      relaisSection.scrollIntoView = jest.fn();
      document.body.appendChild(relaisSection);
      // relais chargés (ready) mais AUCUN sélectionné → guard historique
      state.orderData = { relayStatus: 'ready' };
      const btn = document.createElement('button');

      return submitOrder(btn).then(() => {
        expect(showToast).toHaveBeenCalledWith(
          'Veuillez choisir un point relais pour la livraison.', 'error'
        );
        expect(relaisSection.classList.contains('is-error')).toBe(true);
        expect(requireIdentity).not.toHaveBeenCalled();
      });
    });

    it('garde anti double-clic : busy=1 posé après résolution OTP → aucun apiPost déclenché', async () => {
      state.orderData = { selectedRelaisId: 1, relayStatus: 'ready' };
      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      const btn = document.createElement('button');
      btn.dataset.busy = '1';

      await submitOrder(btn);

      expect(requireIdentity).toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('OTP annulé (requireIdentity résout null) → aucune commande créée, panier intact', async () => {
      state.orderData = { selectedRelaisId: 1, relayStatus: 'ready' };
      requireIdentity.mockResolvedValue(null);
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      const btn = document.createElement('button');

      await submitOrder(btn);

      expect(apiPost).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(state.cart).toHaveLength(1);
    });
  });

  describe('submitOrder — chemin succès cash_relais', () => {
    it('crée la commande, vide le panier, affiche la confirmation', async () => {
      state.orderData = { selectedRelaisId: 7, payment_mode: 'cash_relais', relayStatus: 'ready' };
      state.cart = [{ product: { id: 1 }, qty: 2 }];

      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      apiPost.mockResolvedValue({ order: { reference: 'CMD-001', id: 55 } });

      const btn = document.createElement('button');
      await submitOrder(btn);

      // Lot 3 : plus de recipient_name/recipient_phone envoyés — l'identité de
      // retrait est déduite côté backend depuis le compte OTP (tracking_phone).
      expect(apiPost).toHaveBeenCalledWith('/api/orders', expect.objectContaining({
        items: [{ product_id: '1', quantity: 2, confection_type: 'aucun', variant_combo: null, requested_transport_rail: null }],
        relais_id: 7,
        payment_mode: 'cash_relais',
        tracking_phone: '+269123456',
      }));
      const sentPayload = apiPost.mock.calls[0][1];
      expect(sentPayload).not.toHaveProperty('recipient_name');
      expect(sentPayload).not.toHaveProperty('recipient_phone');
      expect(clearCart).toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Commande confirmée !', 'success');
      expect(btn.dataset.busy).toBe('0');
      // renderOrderSuccess a bien tourné (appel interne, vérifié par effet de bord) :
      expect(buildOrderSuccessDOM).toHaveBeenCalled();
      expect(dom.orderTitle.textContent).toBe('✅ Commande confirmée');
    });

    it('Contrat API §3 : propage shared_cart_item_id si présent sur l\'item (panier éphémère liste), absent sinon (panier personnel inchangé)', async () => {
      state.orderData = { selectedRelaisId: 7, payment_mode: 'cash_relais', relayStatus: 'ready' };
      state.cart = [
        { product: { id: 1 }, qty: 1, shared_cart_item_id: 'sci-abc' },
        { product: { id: 2 }, qty: 1 }, // panier personnel classique, pas de shared_cart_item_id
      ];

      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      apiPost.mockResolvedValue({ order: { reference: 'CMD-002', id: 56 } });

      const btn = document.createElement('button');
      await submitOrder(btn);

      const sentItems = apiPost.mock.calls[0][1].items;
      expect(sentItems[0].shared_cart_item_id).toBe('sci-abc');
      expect(sentItems[1].shared_cart_item_id).toBeUndefined();
    });

    it('erreur API → toast erreur, bouton réactivé, busy remis à 0', async () => {
      state.orderData = { selectedRelaisId: 7, payment_mode: 'cash_relais', relayStatus: 'ready' };
      state.cart = [{ product: { id: 1 }, qty: 1 }];

      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      apiPost.mockRejectedValue(new Error('Relais complet'));

      const btn = document.createElement('button');
      btn.disabled = true;
      await submitOrder(btn);

      expect(showToast).toHaveBeenCalledWith('Relais complet', 'error');
      expect(btn.disabled).toBe(false);
      expect(btn.dataset.busy).toBe('0');
      expect(clearCart).not.toHaveBeenCalled();
    });

    it("erreur API -> émet 'checkout:order-failed' avec le code métier (correctif V2-B.1 §5, sans coupler ce module à la liste)", async () => {
      state.orderData = { selectedRelaisId: 7, payment_mode: 'cash_relais', relayStatus: 'ready' };
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      const err = new Error('Cet article de la liste vient déjà d\'être pris par quelqu\'un d\'autre.');
      err.code = 'shared_cart_item_already_claimed';
      err.status = 409;
      apiPost.mockRejectedValue(err);

      const onOrderFailed = jest.fn();
      bus.on('checkout:order-failed', onOrderFailed);

      const btn = document.createElement('button');
      await submitOrder(btn);

      expect(onOrderFailed).toHaveBeenCalledWith({ code: 'shared_cart_item_already_claimed', status: 409 });
      bus.off('checkout:order-failed', onOrderFailed);
    });
  });

  describe('submitOrder — chemin Stripe', () => {
    it('Stripe non chargé après ensureStripe → erreur explicite, commande créée mais paiement bloqué', async () => {
      state.orderData = { selectedRelaisId: 7, payment_mode: 'stripe_eur', relayStatus: 'ready' };
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      const cbIsMe = document.createElement('input');
      cbIsMe.id = 'cb-benf-is-me';
      cbIsMe.checked = true;
      document.body.appendChild(cbIsMe);

      requireIdentity.mockResolvedValue({ phone: '+269123456', full_name: 'Amina' });
      apiPost.mockImplementation((path) => {
        if (path === '/api/orders') return Promise.resolve({ order: { reference: 'CMD-002', id: 56 } });
        return Promise.resolve({});
      });

      // Empêche ensureStripe() de tenter de charger le vrai script externe
      // js.stripe.com (jamais résolu sous jsdom → timeout). window.Stripe
      // reste défini mais _stripeCard n'est jamais initialisé dans ce test,
      // donc le garde-fou "Stripe non chargé" du code se déclenche quand même.
      const originalStripe = window.Stripe;
      window.Stripe = function StripeStub() { return {}; };

      const btn = document.createElement('button');
      await submitOrder(btn);

      window.Stripe = originalStripe;

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Stripe non chargé'), 'error'
      );
      expect(clearCart).not.toHaveBeenCalled();
    });
  });

  describe('renderOrderSuccess', () => {
    it('construit le DOM de confirmation et met à jour le titre', () => {
      renderOrderSuccess({ reference: 'CMD-XYZ' }, 'Amina', undefined, {});
      expect(buildOrderSuccessDOM).toHaveBeenCalledWith(dom.orderBody, { reference: 'CMD-XYZ' });
      expect(dom.orderTitle.textContent).toBe('✅ Commande confirmée');
    });

    it('câble le bouton fermer (closeBtn) : clic → closeOrderModal + scrollPageToTop', () => {
      jest.useFakeTimers();
      const closeBtn = document.createElement('button');
      buildOrderSuccessDOM.mockReturnValueOnce({ copyBtn: null, closeBtn, trackBtn: null });
      dom.orderModal.classList.add('open');

      renderOrderSuccess({ reference: 'CMD-XYZ' }, 'Amina', undefined, {});
      jest.runAllTimers();
      closeBtn.click();

      expect(dom.orderModal.classList.contains('open')).toBe(false);
      jest.useRealTimers();
    });

    it('câble le bouton copier (copyBtn) : clic → copie la référence dans le presse-papier', () => {
      jest.useFakeTimers();
      const copyBtn = document.createElement('button');
      buildOrderSuccessDOM.mockReturnValueOnce({ copyBtn, closeBtn: null, trackBtn: null });
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn(() => Promise.resolve()) },
      });

      renderOrderSuccess({ reference: 'CMD-XYZ' }, 'Amina', undefined, {});
      jest.runAllTimers();
      copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('CMD-XYZ');
      jest.useRealTimers();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // renderCheckout() + checkoutCart() — orchestration DOM complète
  //
  // Dette du plan d'attaque : jusqu'ici hors périmètre car renderCheckout()
  // est une liaison locale ES (non interceptable par mock) appelée en
  // interne par checkoutCart(). On l'exerce désormais réellement, avec une
  // fixture DOM plus lourde et des mocks corrigés pour retourner de vrais
  // noeuds DOM (buildIdentityRecapDOM/makeInput/makePhoneInput/
  // makeIntlPhoneInput renvoyaient des objets litéraux `{}` dans les mocks
  // précédents — jamais démasqué puisque renderCheckout n'était jamais
  // appelée ; insertBefore/appendChild sur un non-Node aurait fait planter
  // le rendu).
  // ═══════════════════════════════════════════════════════════════

  function tick(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick(0);
  }

  describe('checkoutCart — orchestration', () => {
    it('panier non vide → ferme le panier, initialise orderData, ouvre la modale sur le récapitulatif (mandat §7/§8)', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];

      checkoutCart();
      await flush();

      expect(closeCart).toHaveBeenCalled();
      expect(state.orderData.payment_mode).toBe('cash_relais');
      expect(dom.orderModal.classList.contains('open')).toBe(true);
      expect(document.body.classList.contains('cart-open')).toBe(true);
      // Premier écran affiché : le récapitulatif dédié, jamais directement
      // le formulaire identité/paiement — plus de raccourci, même pour un
      // seul article (mandat §7 : "Sélection → Commander → Récapitulatif
      // → confirmation → checkout paiement", toujours la même séquence).
      expect(dom.orderBody.textContent).toContain('Récapitulatif de votre commande');
      expect(dom.orderBody.textContent).not.toContain('Retrait sécurisé');
      expect(dom.orderBody.querySelector('#btn-confirm-recap')).not.toBeNull();
    });

    it('confirmation du récapitulatif → avance vers le formulaire identité/livraison/paiement', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];

      checkoutCart();
      await flush();

      dom.orderBody.querySelector('#btn-confirm-recap').click();
      await flush();

      expect(dom.orderBody.textContent).toContain('Retrait sécurisé');
      expect(dom.orderBody.textContent).not.toContain('Récapitulatif de votre commande');
      expect(dom.orderBody.textContent).not.toContain('QUI RÉCUPÈRE');
    });

    it('modale produit ouverte au moment du checkout → fermée en premier (bus modal:close)', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      dom.modalOverlay.classList.add('open');
      let onModalClose = jest.fn();
      bus.on('modal:close', onModalClose);

      checkoutCart();
      await flush();

      expect(onModalClose).toHaveBeenCalled();
    });

    it('touche Échap après ouverture → ferme la modale de commande', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      checkoutCart();
      await flush();
      expect(dom.orderModal.classList.contains('open')).toBe(true);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(dom.orderModal.classList.contains('open')).toBe(false);
    });

    it('clic sur l\'overlay (en dehors du contenu) → ferme la modale de commande', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      checkoutCart();
      await flush();

      dom.orderModal.dispatchEvent(new Event('click', { bubbles: true }));

      expect(dom.orderModal.classList.contains('open')).toBe(false);
    });
  });

  describe('renderCheckout — structure de base et identité', () => {
    beforeEach(() => {
      state.orderData = {};
      apiGet.mockImplementation(() => Promise.resolve({}));
      getCurrentIdentity.mockReturnValue(null);
      restoreIdentity.mockResolvedValue(null);
    });

    it('construit le titre avec bouton retour « ← Récap », qui rouvre le récapitulatif sans fermer le checkout', async () => {
      // Règle §9 (simplification checkout final, cf. mock) : depuis ce
      // formulaire, "← Récap" ramène au récapitulatif des articles dans le
      // même modal — il ne ferme plus le checkout / ne rouvre plus le
      // tiroir panier (ancien comportement "← Panier", retiré).
      renderCheckout();
      dom.orderModal.classList.add('open');

      let backBtn = dom.orderTitle.querySelector('.ck-modal-back-btn--header');
      expect(backBtn).not.toBeNull();
      expect(backBtn.textContent).toContain('Récap');
      backBtn.click();

      expect(dom.orderModal.classList.contains('open')).toBe(true);
      expect(openCart).not.toHaveBeenCalled();
      // Le récapitulatif redevient le contenu du modal (heading dédié).
      expect(dom.orderBody.querySelector('.ck-recap-gate-heading')).not.toBeNull();
    });

    it('identité déjà connue → ligne repliée (renderStepHeader) insérée en tête, sans passer par restoreIdentity', async () => {
      getCurrentIdentity.mockReturnValue({ full_name: 'Amina', phone: '+269123456' });

      renderCheckout();
      await flush();

      expect(renderStepHeader).toHaveBeenCalledWith(expect.objectContaining({
        state: 'done',
        label: 'Amina',
        sublabel: expect.stringContaining('+269123456'),
        onChange: expect.any(Function),
      }));
      expect(dom.orderBody.firstChild.id).toBe('ck-identity-recap');
      expect(restoreIdentity).not.toHaveBeenCalled();
    });

    it('pas d\'identité connue, restauration silencieuse négative → invitation "Première commande"', async () => {
      restoreIdentity.mockResolvedValue(null);

      renderCheckout();
      await flush();

      expect(dom.orderBody.querySelector('#ck-guest-hint')).not.toBeNull();
      expect(dom.orderBody.querySelector('#ck-identity-recap')).toBeNull();
    });

    it('pas d\'identité connue, restauration silencieuse positive → carte récap insérée après coup', async () => {
      restoreIdentity.mockResolvedValue({ full_name: 'Fatima', phone: '+269987654' });

      renderCheckout();
      await flush();

      expect(renderStepHeader).toHaveBeenCalledWith(expect.objectContaining({
        state: 'done', label: 'Fatima', sublabel: expect.stringContaining('+269987654'),
      }));
      expect(state.user).toEqual({ full_name: 'Fatima', phone: '+269987654' });
      expect(dom.orderBody.querySelector('#ck-guest-hint')).toBeNull();
    });

    it('affiche le bloc statique « Retrait sécurisé » (pas de toggle, pas de champ bénéficiaire)', async () => {
      getCurrentIdentity.mockReturnValue({ full_name: 'Amina', phone: '+269123456' });
      renderCheckout();
      await flush();

      const notice = dom.orderBody.querySelector('.ck-secure-pickup-notice');
      expect(notice).not.toBeNull();
      expect(notice.textContent).toContain('Retrait sécurisé');
      expect(notice.textContent).toContain('WhatsApp vérifié');
      expect(dom.orderBody.querySelector('.ck-recip-seg')).toBeNull();
      expect(dom.orderBody.querySelector('.ck-recip-fields')).toBeNull();
      expect(dom.orderBody.querySelector('#of-beneficiary-name')).toBeNull();
      expect(dom.orderBody.querySelector('#of-beneficiary-phone')).toBeNull();

      // La carte identité est désormais une ligne repliée (accordéon) : plus de
      // bascule Moi/Quelqu'un d'autre à masquer, un seul point de tap "Changer".
      const idCard = dom.orderBody.querySelector('#ck-identity-recap');
      expect(idCard).not.toBeNull();
      expect(idCard.className).toContain('ck-step-header--done');
    });
  });

  describe('renderCheckout — point relais', () => {
    beforeEach(() => {
      state.orderData = {};
      getCurrentIdentity.mockReturnValue(null);
      restoreIdentity.mockResolvedValue(null);
    });

    it('charge et affiche le relais retenu par île (1 relais/île, tri Ndzouani avant Ngazidja)', async () => {
      apiGet.mockImplementation((path) => {
        if (path === '/api/relais') {
          return Promise.resolve([
            { id: 1, name: 'Relais Anjouan', address: 'Mutsamudu' },
            { id: 2, name: 'Relais Moroni', address: 'Moroni' },
          ]);
        }
        return Promise.resolve({});
      });

      renderCheckout();
      await flush();

      let summary = dom.orderBody.querySelector('#ck-relais-summary');
      expect(summary).not.toBeNull();
      expect(summary.textContent).toContain('Relais Anjouan');
      expect(state.orderData.selectedIsland).toBe('Ndzouani');
    });

    it('aucun relais renvoyé par l\'API → message "Aucun relais disponible"', async () => {
      apiGet.mockImplementation((path) => (path === '/api/relais' ? Promise.resolve([]) : Promise.resolve({})));

      renderCheckout();
      await flush();

      expect(dom.orderBody.querySelector('.ck-relais-empty')).not.toBeNull();
    });

    it('erreur réseau au chargement des relais → message d\'erreur', async () => {
      apiGet.mockImplementation((path) =>
        path === '/api/relais' ? Promise.reject(new Error('network down')) : Promise.resolve({})
      );

      renderCheckout();
      await flush();

      expect(dom.orderBody.querySelector('.ck-relais-error')).not.toBeNull();
    });

    it('clic "Changer" → ouvre le picker, sélection d\'une autre île met à jour le relais retenu', async () => {
      apiGet.mockImplementation((path) => {
        if (path === '/api/relais') {
          return Promise.resolve([
            { id: 1, name: 'Relais Anjouan', address: 'Mutsamudu' },
            { id: 2, name: 'Relais Moroni', address: 'Moroni' },
          ]);
        }
        return Promise.resolve({});
      });

      renderCheckout();
      await flush();

      dom.orderBody.querySelector('#ck-relais-summary').click();
      let overlay = document.querySelector('.ck-relais-overlay');
      expect(overlay).not.toBeNull();

      let ileBtn = Array.from(overlay.querySelectorAll('.ck-relais-iles button'))
        .find((b) => b.dataset.ile === 'Ngazidja');
      ileBtn.click();

      overlay.querySelector('.ck-relais-sheet-cta').click();
      await flush();

      expect(state.orderData.selectedRelaisName).toBe('Relais Moroni');
      expect(dom.orderBody.querySelector('#ck-relais-summary').textContent).toContain('Relais Moroni');
    });
  });

  describe('renderCheckout — paiement (chips) et wallet', () => {
    beforeEach(() => {
      state.orderData = {};
      getCurrentIdentity.mockReturnValue(null);
      restoreIdentity.mockResolvedValue(null);
      apiGet.mockImplementation(() => Promise.resolve({}));
    });

    it('mode cash actif par défaut, chip Stripe/PayPal masqués/inactifs au départ', async () => {
      renderCheckout();
      await flush();

      let cashRadio = dom.orderBody.querySelector('input[value="cash_relais"]');
      expect(cashRadio.checked).toBe(true);
      expect(dom.orderBody.querySelector('#ck-chip-cash').classList.contains('ck-pay-chip--active')).toBe(true);
    });

    it('bascule sur Stripe → révèle le bloc carte, affiche "Paiement carte indisponible" (Stripe non chargé en test)', async () => {
      renderCheckout();
      await flush();

      // Empêche ensureStripe() de charger le vrai script externe js.stripe.com
      // (onload/onerror jamais déclenché sous jsdom → promesse qui ne se
      // résout jamais). Même pattern que le test submitOrder — chemin Stripe.
      let originalStripe = window.Stripe;
      window.Stripe = function StripeStub() { return {}; };

      let stripeRadio = dom.orderBody.querySelector('input[value="stripe_eur"]');
      stripeRadio.checked = true;
      stripeRadio.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      window.Stripe = originalStripe;

      let wrap = document.getElementById('stripe-card-wrap');
      expect(wrap.classList.contains('is-visible')).toBe(true);
      expect(document.getElementById('stripe-card-error').textContent).toContain('Paiement carte indisponible');
    });

    it('bascule sur PayPal → révèle le bloc PayPal, câble le bouton officiel, masque "Confirmer"', async () => {
      renderCheckout();
      await flush();

      let paypalRadio = dom.orderBody.querySelector('input[value="paypal_eur"]');
      paypalRadio.checked = true;
      paypalRadio.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      expect(document.getElementById('paypal-wrap').classList.contains('is-visible')).toBe(true);
      expect(renderPayPalButton).toHaveBeenCalledWith('paypal-button-container', expect.objectContaining({
        validateBeforeClick: expect.any(Function),
        prepareKomerceOrder: expect.any(Function),
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }));
      expect(document.getElementById('btn-confirm-order').style.display).toBe('none');
    });

    it('chip PayPal masquée par défaut, révélée si isPayPalEnabled() résout true', async () => {
      isPayPalEnabled.mockResolvedValueOnce(true);
      renderCheckout();
      await flush();

      expect(document.getElementById('ck-chip-paypal').style.display).toBe('');
    });

    it('checkWalletBalance : solde 0 → section masquée, pas de crédit proposé (règle §3, simplification checkout final)', async () => {
      // Règle §3 (mock_checkout_final_simplifie.html) : à crédit nul, on ne
      // propose PAS l'utilisation du crédit — la section reste masquée.
      // Remplace l'ancien test "R3, non-régression" (fix 2026-07-11) qui
      // exigeait l'inverse (section toujours visible, y compris à 0) pour
      // sortir d'un état "Chargement…" bloqué. Le nouvel objectif — ne
      // jamais rester bloqué sur "Chargement…" — est conservé (assertion
      // ci-dessous sur balText), simplement sans rendre la section visible
      // quand il n'y a explicitement rien à proposer.
      global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 0 }) });
      renderCheckout();
      await flush();

      const section = document.getElementById('wallet-section');
      const balText = document.getElementById('wallet-balance-text');
      expect(section.classList.contains('is-visible')).toBe(false);
      expect(balText.textContent).not.toContain('Chargement');
      expect(balText.textContent).not.toContain('NaN');
      expect(balText.textContent).not.toContain('undefined');
    });

    it('checkWalletBalance : solde positif → affiche le montant et rend la section visible', async () => {
      global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 1500 }) });
      renderCheckout();
      await flush();

      const section = document.getElementById('wallet-section');
      const balText = document.getElementById('wallet-balance-text');
      expect(section.classList.contains('is-visible')).toBe(true);
      expect(balText.textContent).toContain('1500');
    });

    it('checkWalletBalance : échec réseau → sort de "Chargement…" sans crasher', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      renderCheckout();
      await flush();

      const balText = document.getElementById('wallet-balance-text');
      expect(balText.textContent).not.toContain('Chargement');
    });

    it('case "utiliser mon crédit" → délègue à updateWalletDisplay (câblage confirmé par effet)', async () => {
      global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 1000 }) });
      renderCheckout();
      await flush();

      let cb = document.getElementById('cb-use-wallet');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));

      expect(state.orderData.use_wallet).toBe(true);
      expect(document.getElementById('wallet-deduction').classList.contains('is-visible')).toBe(true);
    });

    it('clic sur "Confirmer" → délègue à submitOrder (requireIdentity sollicité)', async () => {
      state.cart = [{ product: { id: 1 }, qty: 1 }];
      state.orderData.selectedRelaisId = 1;
      // FIX 2026-07-10 : le bouton n'est activable que si relayStatus === 'ready'
      // → on fait résoudre /api/relais pour passer par la vraie state machine.
      apiGet.mockImplementation((path) => {
        if (path === '/api/relais') return Promise.resolve([{ id: 1, name: 'Relais Moroni', island: 'Grande Comore' }]);
        return Promise.resolve({});
      });
      requireIdentity.mockResolvedValue(null); // on ne pousse pas jusqu'à l'appel API ici
      renderCheckout();
      await flush();

      const btn = document.getElementById('btn-confirm-order');
      expect(btn.disabled).toBe(false); // relais ready + sélectionné
      btn.click();
      await flush();

      expect(requireIdentity).toHaveBeenCalled();
    });

    describe('règle §8 — CTA "Confirmer la commande · X KMF" (jamais "Payer", jamais "(net wallet)")', () => {
      it('mode cash, sans wallet → CTA uniforme avec le total', async () => {
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const lastCall = setCheckoutConfirmButton.mock.calls.at(-1);
        expect(lastCall[1]).toBe('Confirmer la commande · 2000 KMF');
        expect(lastCall[1]).not.toMatch(/Payer|net wallet/);
      });

      it('mode Stripe sélectionné → même gabarit de CTA (jamais "💳 Payer")', async () => {
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const stripeRadio = dom.orderBody.querySelector('input[value="stripe_eur"]');
        stripeRadio.checked = true;
        stripeRadio.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        const lastCall = setCheckoutConfirmButton.mock.calls.at(-1);
        expect(lastCall[1]).toBe('Confirmer la commande · 2000 KMF');
        expect(lastCall[1]).not.toMatch(/Payer/);
      });

      it('wallet coché, couverture partielle → CTA porte le montant NET (après déduction), toujours le même gabarit', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 800 }) });
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const cb = document.getElementById('cb-use-wallet');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        const lastCall = setCheckoutConfirmButton.mock.calls.at(-1);
        expect(lastCall[1]).toBe('Confirmer la commande · 1200 KMF');
      });
    });

    describe('règle §3 — ordre wallet avant paiement + masquage total quand le crédit couvre tout', () => {
      it('le bloc wallet précède le bloc paiement dans le DOM (parité visuelle avec le mock)', async () => {
        renderCheckout();
        await flush();

        const walletSection = document.getElementById('wallet-section');
        const paymentSection = document.querySelector('.ck-payment-section');
        expect(walletSection).toBeTruthy();
        expect(paymentSection).toBeTruthy();
        // DOCUMENT_POSITION_FOLLOWING (4) : paymentSection vient après walletSection.
        expect(walletSection.compareDocumentPosition(paymentSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });

      it('wallet coché + solde couvrant tout le total → masque le choix du moyen de paiement, affiche le message de couverture', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 5000 }) });
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const cb = document.getElementById('cb-use-wallet');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        expect(document.getElementById('ck-payment-summary').classList.contains('ck-force-hidden')).toBe(true);
        expect(document.getElementById('ck-pay-grid').classList.contains('ck-force-hidden')).toBe(true);
        expect(document.getElementById('ck-wallet-full-cover-msg').classList.contains('is-visible')).toBe(true);
        expect(document.getElementById('ck-wallet-full-cover-msg').textContent).toContain('couvre toute la commande');
      });

      it('wallet décoché après avoir tout couvert → réaffiche le choix du moyen de paiement', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 5000 }) });
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const cb = document.getElementById('cb-use-wallet');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        expect(document.getElementById('ck-payment-summary').classList.contains('ck-force-hidden')).toBe(false);
        expect(document.getElementById('ck-pay-grid').classList.contains('ck-force-hidden')).toBe(false);
        expect(document.getElementById('ck-wallet-full-cover-msg').classList.contains('is-visible')).toBe(false);
      });

      it('od.payment_mode n\'est jamais modifié par le masquage — décoration pure (invariant commande/paiement préservé)', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ balance_kmf: 5000 }) });
        cartTotal.mockReturnValue(2000);
        renderCheckout();
        await flush();

        const cb = document.getElementById('cb-use-wallet');
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await flush();

        expect(state.orderData.payment_mode).toBe('cash_relais');
      });
    });
  });

  describe('renderCheckout — PayPal (callbacks _validateCheckoutForm / _createKomerceOrderForPayPal / _onPayPalSuccess)', () => {
    // Ces 3 fonctions sont privées à b-checkout.js (non exportées) : on les
    // exerce via les callbacks passés à renderPayPalButton, capturés par le
    // mock jest.fn() (Migration 079 — cœur argent du chemin PayPal).
    async function activatePaypalAndGetCallbacks() {
      renderCheckout();
      await flush();
      let paypalRadio = dom.orderBody.querySelector('input[value="paypal_eur"]');
      paypalRadio.checked = true;
      paypalRadio.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      return renderPayPalButton.mock.calls[0][1];
    }

    beforeEach(() => {
      state.orderData = {};
      state.pendingPaypalOrderRef = null;
      state.lastApiResult = null;
      state.shareToken = null;
      getCurrentIdentity.mockReturnValue(null);
      restoreIdentity.mockResolvedValue(null);
      apiGet.mockImplementation(() => Promise.resolve({}));
    });

    it("validateBeforeClick : pas d'identité (téléphone) → toast erreur, false", async () => {
      getCurrentIdentity.mockReturnValue(null);
      const { validateBeforeClick } = await activatePaypalAndGetCallbacks();

      const ok = await validateBeforeClick();

      expect(ok).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('téléphone'), 'error');
    });

    it('validateBeforeClick : identité ok mais aucun relais sélectionné → toast erreur, false', async () => {
      getCurrentIdentity.mockReturnValue({ full_name: 'Amina', phone: '+269123456' });
      state.orderData.selectedRelaisId = null;
      const { validateBeforeClick } = await activatePaypalAndGetCallbacks();

      const ok = await validateBeforeClick();

      expect(ok).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('relais'), 'error');
    });

    it('validateBeforeClick : identité + relais ok → true, aucun toast (Lot 3 : plus de validation bénéficiaire)', async () => {
      getCurrentIdentity.mockReturnValue({ full_name: 'Amina', phone: '+269123456' });
      state.orderData.selectedRelaisId = 1;
      const { validateBeforeClick } = await activatePaypalAndGetCallbacks();

      const ok = await validateBeforeClick();

      expect(ok).toBe(true);
      expect(showToast).not.toHaveBeenCalled();
    });

    it("prepareKomerceOrder : crée la commande Komerce (payment_mode=paypal_eur) sans identité de retrait alternative, mémorise la référence pending", async () => {
      getCurrentIdentity.mockReturnValue({ full_name: 'Amina', phone: '+269123456' });
      state.orderData.selectedRelaisId = 7;
      state.orderData.use_wallet = true;
      state.cart = [{ product: { id: 42 }, qty: 2 }];
      apiPost.mockResolvedValueOnce({ order: { reference: 'CMD-PP-001', id: 99 } });
      const { prepareKomerceOrder } = await activatePaypalAndGetCallbacks();

      const result = await prepareKomerceOrder();

      expect(apiPost).toHaveBeenCalledWith('/api/orders', expect.objectContaining({
        items: [{ product_id: '42', quantity: 2, confection_type: 'aucun', variant_combo: null, requested_transport_rail: null }],
        relais_id: 7,
        payment_mode: 'paypal_eur',
        use_wallet: true,
        tracking_phone: '+269123456',
      }), expect.objectContaining({ idempotencyKey: 'idem-key-1' }));
      const [, sentPayload] = apiPost.mock.calls[0];
      expect(sentPayload).not.toHaveProperty('recipient_name');
      expect(sentPayload).not.toHaveProperty('recipient_phone');
      expect(result).toEqual({ order_reference: 'CMD-PP-001', order_id: 99 });
      expect(state.pendingPaypalOrderRef).toBe('CMD-PP-001');
      expect(state.lastApiResult).toEqual({ order: { reference: 'CMD-PP-001', id: 99 } });
    });

    it('prepareKomerceOrder : idempotence — une ref pending existante est réutilisée sans nouvel appel API', async () => {
      state.pendingPaypalOrderRef = 'CMD-PP-EXISTING';
      state.cart = [];
      const { prepareKomerceOrder } = await activatePaypalAndGetCallbacks();

      const result = await prepareKomerceOrder();

      expect(result).toEqual({ order_reference: 'CMD-PP-EXISTING' });
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('onSuccess : vide le panier, réinitialise la ref pending, affiche la confirmation', async () => {
      state.pendingPaypalOrderRef = 'CMD-PP-002';
      state.lastApiResult = { order: { reference: 'CMD-PP-002', total_kmf: 15000 } };
      const { onSuccess } = await activatePaypalAndGetCallbacks();

      onSuccess({ id: 'CAPTURE-1' });

      expect(clearCart).toHaveBeenCalled();
      expect(state.pendingPaypalOrderRef).toBeNull();
      expect(buildOrderSuccessDOM).toHaveBeenCalledWith(
        dom.orderBody,
        { reference: 'CMD-PP-002', total_kmf: 15000 }
      );
    });
  });
});
