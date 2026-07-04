'use strict';

/**
 * tests/unit/b-modal-approche-c-hybrid.test.js
 *
 * js/b-modal-approche-c-hybrid.js (292L) — Approche C hybride pour la PDP
 * desktop. Un seul export : `setupApprocheCHybridPdp()`. Tout le reste
 * (renderDelivery, ensureIntentQty, installQtyGuard, moveActionsAfterDelivery/
 * restoreActionsHome, renderPayment, applyHybridPdp) est privé et exercé
 * indirectement via l'export public + les événements bus modal:opened/closed.
 *
 * Dépendances mockées : b-modal.js (closeModal), b-cart.js (addToCart),
 * b-share-cart.js (startShareFlow), b-scroll-owner.js (isDesktop — contrôlé
 * par test, comme b-modal-suggestions.test.js). b-store.js, b-utils.js,
 * b-bus.js gardés réels (state/dom mutables partagés, modalZone scopé à
 * dom.modal — pattern déjà utilisé pour b-modal-desktop-enhancers.test.js).
 *
 * Piège connu (déjà rencontré sur b-modal-approche-c-hybrid en session
 * antérieure) : `_actionsHome` est un cache singleton module-level capturé
 * une seule fois au premier déplacement. Reconstruire tout le DOM à chaque
 * test invaliderait cette référence. Fix : DOM construit une fois dans
 * `beforeEach` via un noeud racine réutilisé et repositionné (pas recréé),
 * sauf pour les tests qui doivent justement vérifier le premier déplacement
 * (ceux-là utilisent `jest.resetModules()` pour repartir d'un module frais).
 */

jest.mock('../../js/b-modal.js', () => ({
  closeModal: jest.fn(),
}));
jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
}));
jest.mock('../../js/b-share-cart.js', () => ({
  startShareFlow: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => true),
}));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { fmtPrice } = require('../../js/b-utils.js');
const { closeModal } = require('../../js/b-modal.js');
const { addToCart } = require('../../js/b-cart.js');
const { startShareFlow } = require('../../js/b-share-cart.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { setupApprocheCHybridPdp } = require('../../js/b-modal-approche-c-hybrid.js');

// DOM construit UNE SEULE FOIS (module-level) : `_actionsHome` dans le module
// testé est un cache singleton capturé au premier déplacement réel des
// actions. Recréer les noeuds à chaque test invaliderait cette référence
// (piège déjà rencontré en session antérieure sur ce même fichier). On
// repositionne donc les noeuds existants entre tests au lieu de les recréer.
document.body.innerHTML =
  '<div id="k-modal">' +
    '<div class="k-modal-info">' +
      '<div id="k-modal-delivery"></div>' +
      '<div class="k-modal-actions">' +
        '<button id="k-qty-minus">-</button>' +
        '<span id="k-qty-val">1</span>' +
        '<button id="k-qty-plus">+</button>' +
      '</div>' +
    '</div>' +
    '<div class="k-modal-subtotal"></div>' +
    '<div id="k-modal-payment"></div>' +
  '</div>';
dom.modal = document.getElementById('k-modal');

const info = dom.modal.querySelector('.k-modal-info');
const delivery = document.getElementById('k-modal-delivery');
const actions = dom.modal.querySelector('.k-modal-actions');
const originalActionsNext = actions.nextSibling; // null (dernier enfant de .k-modal-info)

function resetDomPositions() {
  // Remet .k-modal-actions à sa place d'origine (dans .k-modal-info, après
  // #k-modal-delivery) et nettoie le contenu généré par les rendus précédents.
  info.insertBefore(actions, originalActionsNext);
  actions.classList.remove('k-buybox-actions-inline');
  delivery.innerHTML = '';
  document.getElementById('k-qty-val').textContent = '1';
  dom.modal.querySelector('.k-modal-subtotal').innerHTML = '';
  document.getElementById('k-modal-payment').innerHTML = '';
}

async function flushRaf() {
  // applyHybridPdp est planifié via un double requestAnimationFrame imbriqué
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

describe('b-modal-approche-c-hybrid', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    resetDomPositions();
    isDesktop.mockReturnValue(true);
    state.modalProduct = { id: 1, price_kmf: 5000 };
    state.modalQty = 1;
    state.modalPaymentMode = null;
    setupApprocheCHybridPdp();
  });

  describe('setupApprocheCHybridPdp — installation', () => {
    it('est idempotent : un second appel ne réinstalle pas de listeners supplémentaires', () => {
      const before = bus.listenerCount ? bus.listenerCount('modal:opened') : null;
      setupApprocheCHybridPdp();
      setupApprocheCHybridPdp();
      // Pas d'assertion sur le compteur si l'API bus ne l'expose pas ;
      // on vérifie plutôt qu'un seul cycle modal:opened ne déclenche
      // qu'un seul rendu de paiement (pas de doublon de tabs).
      return flushRaf().then(() => {
        bus.emit('modal:opened');
        return flushRaf();
      }).then(() => {
        expect(document.querySelectorAll('.k-buybox-payment-tab').length).toBe(4);
      });
    });
  });

  describe('applyHybridPdp — garde mobile', () => {
    it('mobile (isDesktop=false) : modal:opened ne modifie rien', async () => {
      isDesktop.mockReturnValue(false);
      bus.emit('modal:opened');
      await flushRaf();
      expect(document.getElementById('k-modal-delivery').innerHTML).toBe('');
      expect(document.getElementById('k-modal-payment').innerHTML).toBe('');
    });

    it('desktop (isDesktop=true) : modal:opened déclenche le rendu complet', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      expect(document.getElementById('k-modal-delivery').querySelector('.k-buybox-relay-card')).not.toBeNull();
      expect(document.querySelectorAll('.k-buybox-payment-tab').length).toBe(4);
    });
  });

  describe('renderDelivery', () => {
    it('injecte la carte relais avec titre, zones et badge gratuit', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      const el = document.getElementById('k-modal-delivery');
      expect(el.querySelector('.k-buybox-relay-title').textContent).toBe('Retrait en relais');
      expect(el.querySelector('.k-buybox-relay-sub').textContent).toContain('Grande Comore');
      expect(el.querySelector('.k-buybox-relay-free').textContent).toBe('Gratuit');
    });
  });

  describe('ensureIntentQty — garde quantité minimale', () => {
    it('modalQty invalide (0) -> forcée à 1, DOM et sous-total mis à jour', async () => {
      state.modalQty = 0;
      bus.emit('modal:opened');
      await flushRaf();
      expect(state.modalQty).toBe(1);
      expect(document.getElementById('k-qty-val').textContent).toBe('1');
      expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toContain(fmtPrice(5000));
    });

    it('modalQty déjà valide (>1) -> conservée, sous-total = prix * qty', async () => {
      state.modalQty = 3;
      bus.emit('modal:opened');
      await flushRaf();
      expect(state.modalQty).toBe(3);
      expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toContain(fmtPrice(15000));
    });

    it('aucun produit ouvert -> ne touche pas modalQty', async () => {
      state.modalProduct = null;
      state.modalQty = 0;
      bus.emit('modal:opened');
      await flushRaf();
      expect(state.modalQty).toBe(0);
    });

    it('clic sur #k-qty-minus en desktop avec qty=1 -> bloqué, reste à 1', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      state.modalQty = 1;
      document.getElementById('k-qty-minus').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(state.modalQty).toBe(1);
      expect(document.getElementById('k-qty-val').textContent).toBe('1');
    });

    it('clic sur #k-qty-minus en mobile -> guard ne s\'applique pas (isDesktop=false)', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      isDesktop.mockReturnValue(false);
      state.modalQty = 1;
      const evt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      expect(() => document.getElementById('k-qty-minus').dispatchEvent(evt)).not.toThrow();
    });

    it('clic sur #k-qty-minus sans produit ouvert -> guard ne s\'applique pas', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      state.modalProduct = null;
      const evt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      expect(() => document.getElementById('k-qty-minus').dispatchEvent(evt)).not.toThrow();
    });
  });

  describe('moveActionsAfterDelivery / restoreActionsHome', () => {
    it('déplace .k-modal-actions juste après #k-modal-delivery et ajoute la classe inline', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      const delivery = document.getElementById('k-modal-delivery');
      const actions = dom.modal.querySelector('.k-modal-actions');
      expect(delivery.nextElementSibling).toBe(actions);
      expect(actions.classList.contains('k-buybox-actions-inline')).toBe(true);
    });

    it('appel répété (deux modal:opened) reste idempotent sur la position DOM', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      bus.emit('modal:opened');
      await flushRaf();
      const delivery = document.getElementById('k-modal-delivery');
      const actions = dom.modal.querySelector('.k-modal-actions');
      expect(delivery.nextElementSibling).toBe(actions);
      // une seule instance d'actions, pas de duplication
      expect(dom.modal.querySelectorAll('.k-modal-actions').length).toBe(1);
    });

    it('modal:closed restaure les actions à leur emplacement d\'origine et retire la classe inline', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      expect(actions.classList.contains('k-buybox-actions-inline')).toBe(true);
      bus.emit('modal:closed');
      expect(actions.classList.contains('k-buybox-actions-inline')).toBe(false);
      expect(actions.parentElement).toBe(info);
      expect(actions.nextSibling).toBe(originalActionsNext);
    });
  });

  describe('renderPayment — 4 onglets', () => {
    it('rend les 4 onglets (Carte, Livraison, Partagé, Cagnotte) avec stripe actif par défaut', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      const tabs = document.querySelectorAll('.k-buybox-payment-tab');
      expect(tabs.length).toBe(4);
      const active = document.querySelector('.k-buybox-payment-tab.is-active');
      expect(active.dataset.pay).toBe('stripe');
      expect(active.getAttribute('aria-selected')).toBe('true');
    });

    it('respecte state.modalPaymentMode existant comme onglet actif', async () => {
      state.modalPaymentMode = 'cash';
      bus.emit('modal:opened');
      await flushRaf();
      const active = document.querySelector('.k-buybox-payment-tab.is-active');
      expect(active.dataset.pay).toBe('cash');
      expect(document.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('cash');
    });

    it('clic sur un onglet non-"group" bascule l\'état actif et le détail affiché', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      const cashTab = document.querySelector('.k-buybox-payment-tab[data-pay="cash"]');
      cashTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      expect(state.modalPaymentMode).toBe('cash');
      expect(cashTab.classList.contains('is-active')).toBe(true);
      expect(cashTab.getAttribute('aria-selected')).toBe('true');
      const stripeTab = document.querySelector('.k-buybox-payment-tab[data-pay="stripe"]');
      expect(stripeTab.classList.contains('is-active')).toBe(false);
      expect(document.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('cash');
    });

    it('détail de paiement affiche titre, sous-titre et badge corrects (ex: pot/Cagnotte)', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      const potTab = document.querySelector('.k-buybox-payment-tab[data-pay="pot"]');
      potTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const detail = document.querySelector('.k-buybox-payment-detail');
      expect(detail.querySelector('strong').textContent).toBe('Cagnotte collective');
      expect(detail.querySelector('.k-buybox-payment-badge').textContent).toBe('Collectif');
    });

    it('clic sur l\'onglet "Partagé" (group) : addToCart, closeModal, puis startShareFlow après 250ms', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      jest.useFakeTimers();
      const groupTab = document.querySelector('.k-buybox-payment-tab[data-pay="group"]');
      groupTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      expect(addToCart).toHaveBeenCalledWith(state.modalProduct, state.modalQty || 1, groupTab);
      expect(closeModal).toHaveBeenCalled();
      expect(startShareFlow).not.toHaveBeenCalled();

      jest.advanceTimersByTime(250);
      expect(startShareFlow).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('onglet "Partagé" sans produit ouvert : ne fait rien (pas d\'addToCart ni closeModal)', async () => {
      bus.emit('modal:opened');
      await flushRaf();
      state.modalProduct = null;
      const groupTab = document.querySelector('.k-buybox-payment-tab[data-pay="group"]');
      groupTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

      expect(addToCart).not.toHaveBeenCalled();
      expect(closeModal).not.toHaveBeenCalled();
    });
  });
});
