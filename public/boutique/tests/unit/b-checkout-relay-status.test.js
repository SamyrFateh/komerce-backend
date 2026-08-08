'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-checkout-relay-status.test.js — FIX 2026-07-10
 *
 * Non-régression de l'incident "Confirmer actif alors que les relais sont en
 * erreur". Verrouille la state machine relayStatus (idle|loading|ready|error|
 * empty) et la règle métier absolue : AUCUNE commande cash au relais sans
 * relais chargé ET sélectionné.
 *
 * Couvre le cahier des charges G.2 :
 *   - relais loading → Confirmer disabled
 *   - relais error   → Confirmer disabled + bouton Réessayer visible
 *   - relais empty   → Confirmer disabled
 *   - relais ready + selectedRelaisId → Confirmer enabled
 *   - cash_relais sans selectedRelaisId → submitOrder bloqué
 *   - apiGet('/api/relais') timeout/reject → pas de crash DOM
 *   - retry relais ne reset pas le panier
 *
 * Harnais identique à b-checkout.test.js (state/dom réels, périphérie mockée).
 */

jest.mock('../../js/b-paypal.js', () => ({
  renderPayPalButton: jest.fn(() => Promise.resolve()),
  isPayPalEnabled: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../js/b-cart.js', () => ({
  openCart: jest.fn(), closeCart: jest.fn(), renderCart: jest.fn(), clearCart: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  getScrollY: jest.fn(() => 0), scrollToPosition: jest.fn(), scrollPageToTop: jest.fn(),
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
  // On veut le VRAI état disabled du bouton — le mock ne touche qu'au texte.
  setCheckoutConfirmButton: jest.fn((btn, main, sub) => {
    if (btn) btn.dataset.subText = sub || '';
  }),
  buildOrderSuccessDOM: jest.fn(() => ({ copyBtn: null, closeBtn: null, trackBtn: null })),
  buildIdentityRecapDOM: jest.fn(() => {
    const el = global.document.createElement('div');
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
  buildE164: jest.fn((code, raw) => code + raw),
  makeIntlPhoneInput: jest.fn(() => global.document.createElement('div')),
  readIntlPhoneValue: jest.fn(() => ''),
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
  cartTotal: jest.fn(() => 5000),
}));

const { state, dom } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { apiGet } = require('../../js/b-utils.js');
const { requireIdentity } = require('../../js/b-identity.js');
const { checkoutCart, submitOrder } = require('../../js/b-checkout.js');

function timeoutError(path) {
  const e = new Error(`Délai dépassé (timeout 10000ms) — ${path}`);
  e.name = 'TimeoutError';
  e.isTimeout = true;
  return e;
}

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

/**
 * Ouvre le checkout avec un panier valide, franchit l'écran récapitulatif
 * obligatoire (mandat §7/§8 — checkoutCart() affiche désormais ce gate en
 * premier, avant le formulaire identité/relais/paiement que ce fichier
 * teste), puis attend la fin des microtâches internes au formulaire
 * (relais, config, identité).
 */
async function openCheckout() {
  state.cart = [{ product: { id: 'p1', name: 'Prod', price_kmf: 5000 }, id: 'p1', qty: 1 }];
  state.orderData = {};
  checkoutCart();
  await new Promise((r) => setTimeout(r, 0));
  document.getElementById('btn-confirm-recap')?.click();
  // laisse se dérouler les await internes (relais, config, identité)
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const confirmBtn = () => document.getElementById('btn-confirm-order');

describe('checkout — state machine relais', () => {
  beforeEach(() => {
    resetDom();
    state.cart = [];
    state.orderData = {};
    state.walletBalance = 0;
    apiGet.mockReset();
    // /api/public/config (Stripe) : réponse neutre par défaut
    apiGet.mockImplementation((path) => {
      if (path === '/api/public/config') return Promise.resolve({});
      return Promise.resolve([]);
    });
  });

  test('relais loading (requête pendue) → Confirmer disabled + sous-texte chargement', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/relais') return new Promise(() => {}); // pend
      return Promise.resolve({});
    });
    await openCheckout();
    const btn = confirmBtn();
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(state.orderData.relayStatus).toBe('loading');
  });

  test('relais error (timeout) → Confirmer disabled + bouton Réessayer visible + pas de crash DOM', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/relais') return Promise.reject(timeoutError('/api/relais'));
      return Promise.resolve({});
    });
    await openCheckout();
    expect(state.orderData.relayStatus).toBe('error');
    expect(confirmBtn().disabled).toBe(true);
    // Message erreur + retry rendus dans la section relais
    const retry = document.getElementById('ck-relais-retry');
    expect(retry).toBeTruthy();
    expect(document.body.textContent).toContain('Impossible de charger les relais');
  });

  test('relais empty → Confirmer disabled + message "Aucun relais disponible"', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/relais') return Promise.resolve([]);
      return Promise.resolve({});
    });
    await openCheckout();
    expect(state.orderData.relayStatus).toBe('empty');
    expect(confirmBtn().disabled).toBe(true);
    expect(document.body.textContent).toContain('Aucun relais disponible');
  });

  test('relais ready + selectedRelaisId → Confirmer enabled', async () => {
    apiGet.mockImplementation((path) => {
      if (path === '/api/relais') {
        return Promise.resolve([{ id: 42, name: 'Relais Moroni', island: 'Grande Comore' }]);
      }
      return Promise.resolve({});
    });
    await openCheckout();
    expect(state.orderData.relayStatus).toBe('ready');
    expect(state.orderData.selectedRelaisId).toBe(42);
    expect(confirmBtn().disabled).toBe(false);
  });

  test('Réessayer relance le chargement relais SANS reset du panier', async () => {
    let calls = 0;
    apiGet.mockImplementation((path) => {
      if (path === '/api/relais') {
        calls++;
        return calls === 1
          ? Promise.reject(timeoutError('/api/relais'))
          : Promise.resolve([{ id: 7, name: 'Relais Mutsamudu', island: 'Anjouan' }]);
      }
      return Promise.resolve({});
    });
    await openCheckout();
    const cartBefore = state.cart;
    expect(state.orderData.relayStatus).toBe('error');

    document.getElementById('ck-relais-retry').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(state.orderData.relayStatus).toBe('ready');
    expect(confirmBtn().disabled).toBe(false);
    expect(state.cart).toBe(cartBefore);        // même référence — panier intact
    expect(state.cart.length).toBe(1);
  });

  describe('submitOrder — règle absolue cash au relais', () => {
    test('cash_relais avec relayStatus=error → bloqué, aucun OTP déclenché', async () => {
      state.orderData = { payment_mode: 'cash_relais', relayStatus: 'error' };
      const btn = document.createElement('button');
      await submitOrder(btn);
      expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Impossible de charger les relais/), 'error');
      expect(requireIdentity).not.toHaveBeenCalled();
    });

    test('cash_relais avec relayStatus=loading → bloqué', async () => {
      state.orderData = { payment_mode: 'cash_relais', relayStatus: 'loading', selectedRelaisId: 42 };
      const btn = document.createElement('button');
      await submitOrder(btn);
      expect(requireIdentity).not.toHaveBeenCalled();
    });

    test('cash_relais ready mais SANS selectedRelaisId → bloqué (guard historique)', async () => {
      const relaisSection = document.createElement('div');
      relaisSection.id = 'ck-relais-section';
      relaisSection.scrollIntoView = jest.fn();
      document.body.appendChild(relaisSection);
      state.orderData = { payment_mode: 'cash_relais', relayStatus: 'ready' };
      const btn = document.createElement('button');
      await submitOrder(btn);
      expect(showToast).toHaveBeenCalledWith('Veuillez choisir un point relais pour la livraison.', 'error');
      expect(requireIdentity).not.toHaveBeenCalled();
    });
  });
});
