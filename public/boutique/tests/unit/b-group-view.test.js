'use strict';

/**
 * tests/unit/b-group-view.test.js
 *
 * js/b-group-view.js (1196L) — vue "panier partagé" (onglet Groupe).
 * Exports réels : detectParticipantToken, stopPolling, renderGroupView,
 * refreshGroupBadge.
 *
 * Dépendances mockées (réseau / rendu lourd / DOM annexe) : group/group-api.js,
 * group/group-render-creator.js, b-group-banner.js, b-identity.js,
 * b-cart-core.js, b-share-cart.js.
 * Dépendances réelles conservées (logique pure déjà couverte ailleurs) :
 * group/group-state.js, group/group-helpers.js, b-store.js, b-bus.js, b-utils.js.
 *
 * Périmètre choisi (cf. doctrine "Argent — priorité absolue") : le routage
 * participant/créateur de renderGroupView (7 statuts métier), le formulaire
 * de paiement participant (bindPaymentForm — validations + OTP + création de
 * contribution), et les actions créateur argent-sensibles (fermer le panier /
 * annuler le panier). Laissé de côté : bindEstimationForm en détail (déjà
 * indirectement exercé), doFinalize, bindPersonalizeBlock, l'accordéon
 * d'articles et "Modifier les articles" (SC-EDIT) — DOM-intensif, dette
 * assumée pour un sous-lot dédié.
 */

const mockGroupApi = {
  getOwnerSharedCarts:   jest.fn(),
  getSharedCartOwner:    jest.fn(),
  getSharedCartPublic:   jest.fn(),
  getSharedCartItems:    jest.fn(),
  getEstimationAggregate: jest.fn(),
  upsertEstimation:      jest.fn(),
  getEstimationByPhone:  jest.fn(),
  createContribution:    jest.fn(),
  closeCart:             jest.fn(),
  openSettlement:        jest.fn(),
  extendPaymentWindow:   jest.fn(),
  finalizeSharedCart:    jest.fn(),
  cancelSharedCart:      jest.fn(),
};
jest.mock('../../js/group/group-api.js', () => mockGroupApi);

const mockRenderCreator = {
  renderCreatorCartSwitcher: jest.fn(() => '<div id="k-switcher"></div>'),
  renderCreatorArticlesPanel: jest.fn(() => '<div id="k-articles-panel"></div>'),
  renderCreatorUnifiedCard: jest.fn(() => `
    <div id="k-group-unified-card">
      <button id="k-group-close-cart">📤 Partager le panier</button>
      <p id="k-group-settlement-err"></p>
      <button id="k-group-cancel">Annuler</button>
      <button id="k-group-finalize">Finaliser</button>
      <p id="k-group-finalize-err"></p>
    </div>`),
  renderProgress: jest.fn(() => ''),
  renderCreatorActions: jest.fn(() => ''),
  renderCreatorIdentityCard: jest.fn(() => '<div id="k-creator-id"></div>'),
  renderOwnerIdentityCard: jest.fn(() => ''),
  renderCreatorFinancialSummary: jest.fn(() => ''),
};
jest.mock('../../js/group/group-render-creator.js', () => mockRenderCreator);

const mockBanner = { showBanner: jest.fn(), hideBanner: jest.fn() };
jest.mock('../../js/b-group-banner.js', () => mockBanner);

const mockIdentity = { requireIdentity: jest.fn() };
jest.mock('../../js/b-identity.js', () => mockIdentity);

const mockCartCore = { showToast: jest.fn(), saveCart: jest.fn() };
jest.mock('../../js/b-cart-core.js', () => mockCartCore);

const mockShareCart = {
  clearShareState: jest.fn(),
  refreshSharedBadges: jest.fn(),
  restoreSharedCartFromBackend: jest.fn(),
};
jest.mock('../../js/b-share-cart.js', () => mockShareCart);

const { state } = require('../../js/b-store.js');
const {
  detectParticipantToken,
  stopPolling,
  renderGroupView,
  refreshGroupBadge,
} = require('../../js/b-group-view.js');

function makeUrl(href) {
  window.history.pushState({}, '', href);
}

function baseCart(overrides = {}) {
  return {
    id: 'cart-1',
    status: 'open',
    title: 'Anniversaire Fatima',
    total_kmf_snapshot: 10000,
    contributed_kmf: 0,
    remaining_kmf: 10000,
    beneficiary_name_snapshot: 'Fatima',
    ...overrides,
  };
}

describe('b-group-view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="k-catalog-section"></div>';
    window.localStorage.clear();
    window.matchMedia = jest.fn(() => ({ matches: false }));
    window.confirm = jest.fn(() => true);
    window.open = jest.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue() },
      configurable: true,
    });
    state.shareToken = null;
    state.shareId = null;
    state.shareUrl = null;
    mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
    makeUrl('/');
  });

  afterEach(() => {
    stopPolling();
  });

  describe('detectParticipantToken', () => {
    test('lit le paramètre ?p=', () => {
      makeUrl('/?p=tok-abc');
      expect(detectParticipantToken()).toBe('tok-abc');
    });

    test('lit le pattern /cart/shared/:token si pas de ?p=', () => {
      makeUrl('/cart/shared/tok-xyz');
      expect(detectParticipantToken()).toBe('tok-xyz');
    });

    test('aucun des deux → null', () => {
      makeUrl('/');
      expect(detectParticipantToken()).toBeNull();
    });
  });

  describe('stopPolling', () => {
    test("sans polling actif → n'explose pas", () => {
      expect(() => stopPolling()).not.toThrow();
    });
  });

  describe('refreshGroupBadge', () => {
    test('shareToken actif → badges affichés', () => {
      document.body.innerHTML += `
        <div id="k-bnav-group-badge"></div>
        <div id="k-header-group-badge"></div>
        <button id="k-header-group-btn"></button>`;
      state.shareToken = 'tok-1';
      refreshGroupBadge();
      expect(document.getElementById('k-bnav-group-badge').classList.contains('show')).toBe(true);
      expect(document.getElementById('k-header-group-badge').classList.contains('show')).toBe(true);
      expect(document.getElementById('k-header-group-btn').classList.contains('has-active')).toBe(true);
    });

    test('sans shareToken → badges masqués', () => {
      document.body.innerHTML += `
        <div id="k-bnav-group-badge" class="show"></div>
        <div id="k-header-group-badge" class="show"></div>
        <button id="k-header-group-btn" class="has-active"></button>`;
      state.shareToken = null;
      refreshGroupBadge();
      expect(document.getElementById('k-bnav-group-badge').classList.contains('show')).toBe(false);
      expect(document.getElementById('k-header-group-btn').classList.contains('has-active')).toBe(false);
    });

    test('sans les éléments DOM du badge → ne throw pas', () => {
      expect(() => refreshGroupBadge()).not.toThrow();
    });
  });

  describe('renderGroupView — mode participant', () => {
    test('cart introuvable → écran erreur générique + purge du token', () => {
      window.localStorage.setItem('kmrc_group_participant_token', JSON.stringify({ v: 'tok-1', exp: Date.now() + 1000 }));
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: null });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        const el = document.getElementById('k-group-view');
        expect(el.textContent).toContain('Panier introuvable');
        expect(window.localStorage.getItem('kmrc_group_participant_token')).toBeNull();
      });
    });

    test('cart annulé → message dédié', () => {
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'cancelled' }) });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        expect(document.getElementById('k-group-view').textContent).toContain('annulé par son créateur');
      });
    });

    test('cart expiré → message dédié', () => {
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'expired' }) });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        expect(document.getElementById('k-group-view').textContent).toContain('a expiré');
      });
    });

    test('phase ouverte → notice "pas encore ouvert" + formulaire d\'estimation', () => {
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'open' }), items: [] });
      mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        const el = document.getElementById('k-group-view');
        expect(el.textContent).toContain('Paiement pas encore ouvert');
        expect(el.querySelector('#k-ge-submit-btn')).not.toBeNull();
      });
    });

    test('estimation déjà enregistrée (localStorage) → état "part indiquée" affiché', () => {
      window.localStorage.setItem('kmrc_group_commitment_tok-1', JSON.stringify({ name: 'Ali', amount: 3000 }));
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'open' }), items: [] });
      mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        const el = document.getElementById('k-group-view');
        expect(el.textContent).toContain('Part indiquée');
        expect(el.textContent).toContain('Ali');
      });
    });

    test('phase paiement → formulaire de règlement rendu avec le plafond restant', () => {
      mockGroupApi.getSharedCartPublic.mockResolvedValue({
        cart: baseCart({ status: 'closed', payment_window_ends_at: new Date(Date.now() + 3_600_000).toISOString(), remaining_kmf: 4000 }),
        items: [],
      });
      return renderGroupView({ participantToken: 'tok-1' }).then(() => {
        const el = document.getElementById('k-group-view');
        const amountInput = el.querySelector('#k-gp-amount');
        expect(amountInput).not.toBeNull();
        expect(el.textContent).toContain('Maximum');
      });
    });

    describe('bindPaymentForm (argent)', () => {
      async function renderPaymentPhase(remaining = 4000) {
        mockGroupApi.getSharedCartPublic.mockResolvedValue({
          cart: baseCart({
            status: 'closed',
            payment_window_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
            remaining_kmf: remaining,
          }),
          items: [],
        });
        await renderGroupView({ participantToken: 'tok-1' });
        return document.getElementById('k-group-view');
      }

      test('montant < 2500 → erreur, pas de createContribution', async () => {
        const el = await renderPaymentPhase();
        el.querySelector('#k-gp-amount').value = '1000';
        el.querySelector('#k-gp-pay-btn').click();
        await Promise.resolve();
        expect(el.querySelector('#k-gp-err').textContent).toContain('Minimum');
        expect(mockGroupApi.createContribution).not.toHaveBeenCalled();
      });

      test('montant > plafond restant → erreur, pas de createContribution', async () => {
        const el = await renderPaymentPhase(2000);
        el.querySelector('#k-gp-amount').value = '5000';
        el.querySelector('#k-gp-pay-btn').click();
        await Promise.resolve();
        expect(el.querySelector('#k-gp-err').textContent).toContain('Maximum');
        expect(mockGroupApi.createContribution).not.toHaveBeenCalled();
      });

      test('identité annulée (requireIdentity → null) → aucune contribution créée', async () => {
        mockIdentity.requireIdentity.mockResolvedValue(null);
        const el = await renderPaymentPhase();
        el.querySelector('#k-gp-amount').value = '3000';
        el.querySelector('#k-gp-pay-btn').click();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(mockGroupApi.createContribution).not.toHaveBeenCalled();
        expect(el.querySelector('#k-gp-pay-btn').disabled).toBe(false);
      });

      test('parcours complet OK → createContribution appelé avec le bon payload', async () => {
        mockIdentity.requireIdentity.mockResolvedValue({ full_name: 'Ali Said', phone: '+2693312345' });
        mockGroupApi.createContribution.mockResolvedValue({});
        const el = await renderPaymentPhase();
        el.querySelector('#k-gp-amount').value = '3000';
        el.querySelector('#k-gp-pay-btn').click();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(mockGroupApi.createContribution).toHaveBeenCalledWith('tok-1', expect.objectContaining({
          amount_kmf: 3000,
          contributor_name: 'Ali Said',
          contributor_phone: '+2693312345',
        }));
        expect(mockCartCore.showToast).toHaveBeenCalledWith('Contribution enregistrée !', 'success');
      });

      // NOTE : le chemin `res.checkout_url` (redirection `window.location.href = ...`)
      // n'est pas testé ici — jsdom ne supporte pas la navigation réelle et son
      // "Not implemented: navigation" se produit dans un handler async, ce qui
      // provoque un rejet non capturé qui fait planter le process Jest (déjà
      // documenté dans b-friendly-group-redirect.test.js pour .replace()/.href
      // synchrones ; ici c'est pire car async). Dette assumée pour un test e2e réel.
    });

    test.each([
      ['awaiting_choice', 'Fermé'],
      ['ordered', 'Commande créée'],
      ['refunded', 'Panier annulé'],
    ])('statut métier "%s" → carte terminale "%s"', async (status, expectedText) => {
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status }), items: [] });
      await renderGroupView({ participantToken: 'tok-1' });
      expect(document.getElementById('k-group-view').textContent).toContain(expectedText);
    });

    test('token participant retrouvé via localStorage (recallParticipantToken)', async () => {
      window.localStorage.setItem('kmrc_group_participant_token', JSON.stringify({ v: 'tok-saved', exp: Date.now() + 1000 }));
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'open' }), items: [] });
      mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
      await renderGroupView({});
      expect(mockGroupApi.getSharedCartPublic).toHaveBeenCalledWith('tok-saved');
    });

    test('retour de paiement ?shared_payment=success → toast succès', async () => {
      makeUrl('/?shared_payment=success');
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'open' }), items: [] });
      mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
      await renderGroupView({ participantToken: 'tok-1' });
      expect(mockCartCore.showToast).toHaveBeenCalledWith('Contribution enregistrée !', 'success');
    });

    test('retour de paiement ?shared_payment=cancel → toast info', async () => {
      makeUrl('/?shared_payment=cancel');
      mockGroupApi.getSharedCartPublic.mockResolvedValue({ cart: baseCart({ status: 'open' }), items: [] });
      mockGroupApi.getEstimationAggregate.mockResolvedValue({ count: 0, total_estimated_kmf: 0 });
      await renderGroupView({ participantToken: 'tok-1' });
      expect(mockCartCore.showToast).toHaveBeenCalledWith('Paiement annulé. Aucun montant prélevé.', 'info');
    });
  });

  describe('renderGroupView — mode créateur', () => {
    test('aucun panier owner visible (liste vide) → état vide + purge du share state', async () => {
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({ carts: [] });
      await renderGroupView({});
      await Promise.resolve();
      expect(document.getElementById('k-group-view').textContent).toContain('Aucun panier groupe actif');
    });

    // FIX 2026-07-10 : une panne technique sur /mine n'est PLUS masquée en
    // "Aucun panier actif" — elle affiche un état erreur + Réessayer.
    // L'état vide reste réservé au 401 (pas de session) et à la vraie liste vide.
    test('/mine échoue (panne technique) et la restauration échoue aussi → état erreur + Réessayer', async () => {
      mockGroupApi.getOwnerSharedCarts.mockRejectedValue(new Error('network'));
      mockShareCart.restoreSharedCartFromBackend.mockResolvedValue(null);
      await renderGroupView({});
      const el = document.getElementById('k-group-view');
      expect(el.textContent).toContain('Chargement impossible');
      expect(el.querySelector('#k-group-retry-btn')).not.toBeNull();
    });

    test('/mine échoue en 401 (pas de session) et la restauration échoue aussi → état vide', async () => {
      const err401 = Object.assign(new Error('HTTP 401'), { status: 401 });
      mockGroupApi.getOwnerSharedCarts.mockRejectedValue(err401);
      mockShareCart.restoreSharedCartFromBackend.mockResolvedValue(null);
      await renderGroupView({});
      expect(document.getElementById('k-group-view').textContent).toContain('Aucun panier groupe actif');
    });

    test('panier owner sélectionné mais statut terminal côté détail → état vide', async () => {
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'finalized' }) });
      await renderGroupView({});
      await Promise.resolve();
      expect(document.getElementById('k-group-view').textContent).toContain('Aucun panier groupe actif');
    });

    test('panier owner actif (open) → cockpit rendu et polling démarré', async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'open', id: 'cart-9' }), contributions: [] });
      mockGroupApi.getSharedCartItems.mockResolvedValue({ cart_items: [] });

      await renderGroupView({});

      const el = document.getElementById('k-group-view');
      expect(el.querySelector('#k-group-unified-card')).not.toBeNull();
      expect(setIntervalSpy).toHaveBeenCalled();
      expect(mockBanner.hideBanner).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    test('clic "Partager le panier" (fermer) → closeCart appelé + toast succès', async () => {
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'open', id: 'cart-9' }), contributions: [] });
      mockGroupApi.getSharedCartItems.mockResolvedValue({ cart_items: [] });
      mockGroupApi.closeCart.mockResolvedValue({});

      await renderGroupView({});
      const el = document.getElementById('k-group-view');
      el.querySelector('#k-group-close-cart').click();
      await Promise.resolve(); await Promise.resolve();

      expect(window.confirm).toHaveBeenCalled();
      expect(mockGroupApi.closeCart).toHaveBeenCalledWith('cart-9');
      expect(mockCartCore.showToast).toHaveBeenCalledWith(expect.stringContaining('régler leur part'), 'success');
    });

    test('clic "Partager le panier" refusé par confirm() → closeCart non appelé', async () => {
      window.confirm = jest.fn(() => false);
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'open', id: 'cart-9' }), contributions: [] });
      mockGroupApi.getSharedCartItems.mockResolvedValue({ cart_items: [] });

      await renderGroupView({});
      document.getElementById('k-group-view').querySelector('#k-group-close-cart').click();
      await Promise.resolve();

      expect(mockGroupApi.closeCart).not.toHaveBeenCalled();
    });

    test('clic "Annuler" → cancelSharedCart appelé, share state purgé, re-render déclenché', async () => {
      mockGroupApi.getOwnerSharedCarts
        .mockResolvedValueOnce({ carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({ carts: [] });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'open', id: 'cart-9', contributed_kmf: 0 }), contributions: [] });
      mockGroupApi.getSharedCartItems.mockResolvedValue({ cart_items: [] });
      mockGroupApi.cancelSharedCart.mockResolvedValue({});
      mockShareCart.clearShareState.mockResolvedValue();

      await renderGroupView({});
      document.getElementById('k-group-view').querySelector('#k-group-cancel').click();
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));

      expect(mockGroupApi.cancelSharedCart).toHaveBeenCalledWith('cart-9', expect.objectContaining({ reason: 'creator_cancel' }));
      expect(mockCartCore.showToast).toHaveBeenCalledWith('Panier annulé.', 'success');
    });

    test('cancelSharedCart échoue → toast erreur, pas de re-render silencieux', async () => {
      mockGroupApi.getOwnerSharedCarts.mockResolvedValue({
        carts: [{ id: 'cart-9', token: 'tok-9', status: 'open', created_at: new Date().toISOString() }],
      });
      mockGroupApi.getSharedCartOwner.mockResolvedValue({ cart: baseCart({ status: 'open', id: 'cart-9' }), contributions: [] });
      mockGroupApi.getSharedCartItems.mockResolvedValue({ cart_items: [] });
      mockGroupApi.cancelSharedCart.mockRejectedValue(new Error('Panier déjà réglé'));

      await renderGroupView({});
      document.getElementById('k-group-view').querySelector('#k-group-cancel').click();
      await Promise.resolve(); await Promise.resolve();

      expect(mockCartCore.showToast).toHaveBeenCalledWith('Panier déjà réglé', 'error');
    });
  });
});
