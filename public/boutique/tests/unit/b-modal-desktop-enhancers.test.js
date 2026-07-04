'use strict';

/**
 * tests/unit/b-modal-desktop-enhancers.test.js
 *
 * js/b-modal-desktop-enhancers.js (734L) — enrichissements desktop ≥900px
 * de la modal produit, branchés sur bus.on('modal:opened').
 *
 * Dépendances lourdes mockées (b-catalog.js, b-cart-core.js, b-modal.js,
 * b-scroll-owner.js, view-models/modal-view-model.js) — pattern déjà utilisé
 * pour b-group-view.js / b-modal-suggestions.js. b-bus.js, b-store.js,
 * b-utils.js, shop-schema.js gardés réels (logique pure / event bus léger).
 *
 * Seuls exports publics : setupModalContractClasses, setupModalDesktopEnhancers.
 * Tout le reste (injectBreadcrumb, injectShareRow, injectSpecs, injectTrustBadges,
 * injectPriceHero, injectFlashAndStock, injectDelivery, injectPayment,
 * updateSubtotal, injectRecentlyViewed, _applyModalContractClasses,
 * _onModalOpened, _setupQtyObserver) n'est exercé qu'indirectement via
 * bus.emit('modal:opened', product) après setup — comme le ferait b-modal-core.js
 * en production.
 *
 * jest.resetModules() à chaque test : les flags singleton du module
 * (_enhancersInstalled, _vmListenerInstalled) et les _listeners de b-bus.js
 * doivent repartir de zéro à chaque cas, sinon les tests d'idempotence et
 * les tests suivants s'entre-polluent (piège déjà documenté pour
 * b-share-cart.js dans le plan d'attaque).
 *
 * Dette assumée (hors périmètre, cohérent avec le reste du bloc 2) :
 *   - setupZoom/_onZoomMove/_onZoomLeave/_startFlashTimer : code mort,
 *     jamais appelés depuis l'orchestration (zoom loupe désactivé en prod,
 *     cf. commentaire "DÉSACTIVÉ 2026-05-19" dans le source), et non exportés
 *     donc inatteignables depuis un test boîte noire.
 */

jest.mock('../../js/b-catalog.js', () => ({
  setActiveCat: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
}));

jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => true),
}));

jest.mock('../../js/view-models/modal-view-model.js', () => ({
  buildModalViewModel: jest.fn((product) => ({ __vm: true, id: product && product.id })),
  applyModalClasses: jest.fn(),
}));

describe('b-modal-desktop-enhancers', () => {
  let bus, state, dom, isDesktop, showToast, setActiveCat, openModal;
  let buildModalViewModel, applyModalClasses;
  let enhancers;

  function buildModalDom() {
    dom.modal = document.createElement('div');
    dom.modal.className = 'k-modal';
    dom.modal.innerHTML =
      '<div class="k-modal-topbar"><button class="k-modal-back"></button></div>' +
      '<div class="k-modal-img-wrap"><div class="k-modal-carousel"><div class="k-modal-carousel-track"></div></div></div>' +
      '<div class="k-modal-info"></div>' +
      '<div class="k-modal-actions"></div>' +
      '<div class="k-modal-scroll"></div>';
    document.body.appendChild(dom.modal);

    // Zones adressées par getElementById (hors .k-modal, câblées ailleurs dans le HTML réel)
    ['k-modal-aed-price', 'k-modal-flash-bar', 'k-modal-stock-bar',
      'k-modal-delivery', 'k-modal-payment', 'k-modal-flash-timer', 'k-qty-val']
      .forEach(function(id) {
        let el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
      });
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    ({ bus } = require('../../js/b-bus.js'));
    ({ state, dom } = require('../../js/b-store.js'));
    ({ isDesktop } = require('../../js/b-scroll-owner.js'));
    ({ showToast } = require('../../js/b-cart-core.js'));
    ({ setActiveCat } = require('../../js/b-catalog.js'));
    ({ openModal } = require('../../js/b-modal.js'));
    ({ buildModalViewModel, applyModalClasses } = require('../../js/view-models/modal-view-model.js'));
    enhancers = require('../../js/b-modal-desktop-enhancers.js');

    isDesktop.mockReturnValue(true);
    buildModalDom();

    // requestAnimationFrame synchrone : _onModalOpened en dépend pour tout son corps.
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(function(cb) { cb(); return 1; });

    // navigator.clipboard n'existe pas nativement en jsdom.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(() => Promise.resolve()) },
      configurable: true,
    });
    jest.spyOn(window, 'open').mockImplementation(() => {});

    state.modalProduct = { id: 42, name: 'Sac à main tressé', category: 'Mode & Beauté', price_kmf: 5000, stock: 3 };
    state.modalQty = 1;
    state.products = [state.modalProduct];
    state.viewedHistory = [];
    state.carouselIndex = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // GATING / IDEMPOTENCE — les deux points d'entrée publics
  // ═══════════════════════════════════════════════════════════════

  describe('setupModalDesktopEnhancers', () => {
    it('mobile (isDesktop=false) → ne branche aucun listener', () => {
      isDesktop.mockReturnValue(false);
      let onSpy = jest.spyOn(bus, 'on');
      enhancers.setupModalDesktopEnhancers();
      expect(onSpy).not.toHaveBeenCalled();
    });

    it('desktop → branche modal:opened et modal:close une seule fois', () => {
      let onSpy = jest.spyOn(bus, 'on');
      enhancers.setupModalDesktopEnhancers();
      expect(onSpy).toHaveBeenCalledWith('modal:opened', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('modal:close', expect.any(Function));
    });

    it('appelé deux fois → idempotent (bus.on pas rappelé la 2e fois)', () => {
      enhancers.setupModalDesktopEnhancers();
      let onSpy = jest.spyOn(bus, 'on');
      enhancers.setupModalDesktopEnhancers();
      expect(onSpy).not.toHaveBeenCalled();
    });

    it('effet réel : émettre modal:opened après setup déclenche les injecteurs', () => {
      enhancers.setupModalDesktopEnhancers();
      bus.emit('modal:opened', state.modalProduct);
      expect(dom.modal.querySelector('.k-modal-breadcrumb')).not.toBeNull();
    });

    it('modal:close → ne throw pas (nettoyage du timer flash, jamais démarré ici)', () => {
      enhancers.setupModalDesktopEnhancers();
      expect(() => bus.emit('modal:close')).not.toThrow();
    });
  });

  describe('setupModalContractClasses', () => {
    it('branche modal:opened une seule fois même appelé deux fois', () => {
      enhancers.setupModalContractClasses();
      let onSpy = jest.spyOn(bus, 'on');
      enhancers.setupModalContractClasses();
      expect(onSpy).not.toHaveBeenCalled();
    });

    it('fonctionne indépendamment du mode desktop/mobile', () => {
      isDesktop.mockReturnValue(false);
      enhancers.setupModalContractClasses();
      bus.emit('modal:opened', state.modalProduct);
      expect(buildModalViewModel).toHaveBeenCalledWith(state.modalProduct);
    });

    it('applique le ViewModel sur dom.modal et l\'expose sur state._currentModalViewModel', () => {
      enhancers.setupModalContractClasses();
      bus.emit('modal:opened', state.modalProduct);
      expect(applyModalClasses).toHaveBeenCalledWith(dom.modal, { __vm: true, id: 42 });
      expect(state._currentModalViewModel).toEqual({ __vm: true, id: 42 });
    });

    it('product falsy → no-op, buildModalViewModel jamais appelé', () => {
      enhancers.setupModalContractClasses();
      bus.emit('modal:opened', null);
      expect(buildModalViewModel).not.toHaveBeenCalled();
    });

    it('dom.modal absent → no-op', () => {
      dom.modal = null;
      enhancers.setupModalContractClasses();
      bus.emit('modal:opened', state.modalProduct);
      expect(buildModalViewModel).not.toHaveBeenCalled();
    });

    it('buildModalViewModel qui throw → catché, fallback silencieux (console.warn), pas de crash', () => {
      let warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      buildModalViewModel.mockImplementationOnce(() => { throw new Error('boom'); });
      enhancers.setupModalContractClasses();
      expect(() => bus.emit('modal:opened', state.modalProduct)).not.toThrow();
      expect(applyModalClasses).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Helper commun pour les tests d'injecteurs individuels
  // ═══════════════════════════════════════════════════════════════

  // Intl.NumberFormat('fr-FR') utilise une espace fine insécable (\u202f),
  // pas une espace normale : on normalise avant comparaison textuelle.
  function normSpaces(txt) {
    return (txt || '').replace(/\u202f|\u00a0/g, ' ');
  }

  function openWithProduct(product) {
    if (product !== undefined) state.modalProduct = product;
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);
  }

  // ═══════════════════════════════════════════════════════════════
  // BREADCRUMB
  // ═══════════════════════════════════════════════════════════════

  describe('injectBreadcrumb (via modal:opened)', () => {
    it('insère le fil d\'ariane après le bouton retour avec catégorie et nom', () => {
      openWithProduct();
      let topbar = dom.modal.querySelector('.k-modal-topbar');
      let bc = topbar.querySelector('.k-modal-breadcrumb');
      expect(bc).not.toBeNull();
      expect(topbar.children[1]).toBe(bc); // juste après k-modal-back
      expect(bc.textContent).toContain('Mode & Beauté');
      expect(bc.textContent).toContain('Sac à main tressé');
    });

    it('sans bouton retour dans la topbar → append en fin de topbar', () => {
      dom.modal.querySelector('.k-modal-back').remove();
      openWithProduct();
      let topbar = dom.modal.querySelector('.k-modal-topbar');
      expect(topbar.lastElementChild.className).toBe('k-modal-breadcrumb');
    });

    it('rappel sur nouveau produit → l\'ancien breadcrumb est remplacé, pas dupliqué', () => {
      openWithProduct();
      openWithProduct({ id: 99, name: 'Autre', category: 'Tech', price_kmf: 1000 });
      expect(dom.modal.querySelectorAll('.k-modal-breadcrumb').length).toBe(1);
      expect(dom.modal.querySelector('.k-modal-breadcrumb').textContent).toContain('Autre');
    });

    it('clic sur la catégorie → ferme la modal et filtre le catalogue (clé inconnue → passthrough)', () => {
      openWithProduct({ id: 1, name: 'P', category: 'catégorie-inexistante', price_kmf: 100 });
      let closeSpy = jest.fn();
      bus.on('modal:close', closeSpy);
      dom.modal.querySelector('.k-modal-breadcrumb-cat').click();
      expect(closeSpy).toHaveBeenCalled();
      expect(setActiveCat).toHaveBeenCalledWith('catégorie-inexistante');
    });

    it('catégorie vide → clic sans effet (pas de setActiveCat)', () => {
      openWithProduct({ id: 1, name: 'P', category: '', price_kmf: 100 });
      dom.modal.querySelector('.k-modal-breadcrumb-cat').click();
      expect(setActiveCat).not.toHaveBeenCalled();
    });

    it('pas de topbar dans la modal → no-op sans throw', () => {
      dom.modal.querySelector('.k-modal-topbar').remove();
      expect(() => openWithProduct()).not.toThrow();
    });

    it('pas de produit ouvert → no-op', () => {
      openWithProduct(null);
      expect(dom.modal.querySelector('.k-modal-breadcrumb')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SHARE ROW
  // ═══════════════════════════════════════════════════════════════

  describe('injectShareRow (via modal:opened)', () => {
    it('insère la ligne de partage dans .k-modal-info', () => {
      openWithProduct();
      let row = dom.modal.querySelector('.k-modal-info .k-modal-share-row');
      expect(row).not.toBeNull();
      expect(row.querySelector('.k-modal-share-btn--wa')).not.toBeNull();
      expect(row.querySelector('[data-action="copy"]')).not.toBeNull();
    });

    it('clic WhatsApp → window.open avec lien wa.me contenant le produit', () => {
      openWithProduct();
      dom.modal.querySelector('.k-modal-share-btn--wa').click();
      expect(window.open).toHaveBeenCalledTimes(1);
      let [url, target] = window.open.mock.calls[0];
      expect(url).toContain('https://wa.me/?text=');
      expect(target).toBe('_blank');
    });

    it('clic Copier → clipboard.writeText puis toast de confirmation', async () => {
      openWithProduct();
      dom.modal.querySelector('[data-action="copy"]').click();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(window.location.origin + '/?p=42')
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(showToast).toHaveBeenCalledWith('🔗 Lien copié !');
    });

    it('rappel → ancienne ligne retirée, une seule ligne au final', () => {
      openWithProduct();
      openWithProduct();
      expect(dom.modal.querySelectorAll('.k-modal-share-row').length).toBe(1);
    });

    it('pas de zone .k-modal-info → no-op', () => {
      dom.modal.querySelector('.k-modal-info').remove();
      expect(() => openWithProduct()).not.toThrow();
    });

    it('pas de produit → no-op', () => {
      openWithProduct(null);
      expect(dom.modal.querySelector('.k-modal-share-row')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SPECS ACCORDION
  // ═══════════════════════════════════════════════════════════════

  describe('injectSpecs (via modal:opened)', () => {
    it('stock > 1 → pluriel, catégorie/poids/ref affichés', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 5, weight_kg: 1.2 });
      let specs = dom.modal.querySelector('.k-modal-specs');
      expect(specs.textContent).toContain('5 unités');
      expect(specs.textContent).toContain('1.2 kg');
      expect(specs.textContent).toContain('#7');
      expect(specs.textContent).toContain('Tech');
    });

    it('stock = 1 → singulier "unité"', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 1 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('1 unité');
      expect(dom.modal.querySelector('.k-modal-specs').textContent).not.toContain('1 unités');
    });

    it('stock = 0 → "Rupture"', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 0 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('Rupture');
    });

    it('pas de weight_kg → tiret cadratin', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 2 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('—');
    });

    it('pas de catégorie → "Non catégorisé"', () => {
      openWithProduct({ id: 7, name: 'X', category: '', price_kmf: 100, stock: 2 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('Non catégorisé');
    });

    it('promo_pct présent → ligne Promotion ajoutée', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 2, promo_pct: 20 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('Promotion');
      expect(dom.modal.querySelector('.k-modal-specs').textContent).toContain('-20%');
    });

    it('sans promo_pct → pas de ligne Promotion', () => {
      openWithProduct({ id: 7, name: 'X', category: 'Tech', price_kmf: 100, stock: 2 });
      expect(dom.modal.querySelector('.k-modal-specs').textContent).not.toContain('Promotion');
    });

    it('inséré avant la ligne de partage quand elle existe déjà', () => {
      openWithProduct();
      let info = dom.modal.querySelector('.k-modal-info');
      let specs = info.querySelector('.k-modal-specs');
      let share = info.querySelector('.k-modal-share-row');
      expect(Array.from(info.children).indexOf(specs))
        .toBeLessThan(Array.from(info.children).indexOf(share));
    });

    it('toggle clic → ouvre/ferme le corps (is-open bascule dans les deux sens)', () => {
      openWithProduct();
      let toggle = dom.modal.querySelector('.k-modal-spec-toggle');
      let body = dom.modal.querySelector('.k-modal-spec-body');
      expect(toggle.classList.contains('is-open')).toBe(true); // ouvert par défaut
      toggle.click();
      expect(toggle.classList.contains('is-open')).toBe(false);
      expect(body.classList.contains('is-open')).toBe(false);
      toggle.click();
      expect(toggle.classList.contains('is-open')).toBe(true);
      expect(body.classList.contains('is-open')).toBe(true);
    });

    it('pas de produit → no-op', () => {
      openWithProduct(null);
      expect(dom.modal.querySelector('.k-modal-specs')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TRUST BADGES
  // ═══════════════════════════════════════════════════════════════

  describe('injectTrustBadges (via modal:opened)', () => {
    it('insère les 3 badges de réassurance avant les specs', () => {
      openWithProduct();
      let info = dom.modal.querySelector('.k-modal-info');
      let trust = info.querySelector('.k-modal-trust');
      let specs = info.querySelector('.k-modal-specs');
      expect(trust.querySelectorAll('.k-modal-trust-item').length).toBe(3);
      expect(Array.from(info.children).indexOf(trust))
        .toBeLessThan(Array.from(info.children).indexOf(specs));
    });

    it('rappel → pas de doublon', () => {
      openWithProduct();
      openWithProduct();
      expect(dom.modal.querySelectorAll('.k-modal-trust').length).toBe(1);
    });

    it('pas de .k-modal-info → no-op', () => {
      dom.modal.querySelector('.k-modal-info').remove();
      expect(() => openWithProduct()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PRIX HÉRO (EUR)
  // ═══════════════════════════════════════════════════════════════

  describe('injectPriceHero (via modal:opened)', () => {
    it('affiche l\'équivalent EUR arrondi', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 5000 });
      let el = document.getElementById('k-modal-aed-price');
      expect(el.textContent).toContain('€');
    });

    it('promo avec original_price_kmf → prix EUR barré affiché en plus', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 4000, original_price_kmf: 5000, promo_pct: 20 });
      let el = document.getElementById('k-modal-aed-price');
      expect(el.querySelector('s')).not.toBeNull();
    });

    it('promo_pct → badge pourcentage', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 4000, promo_pct: 20 });
      let el = document.getElementById('k-modal-aed-price');
      expect(el.querySelector('.k-modal-aed-pct').textContent).toBe('-20%');
    });

    it('promo_pct → mention économie calculée à partir du prix promo', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 4000, promo_pct: 20 });
      let el = document.getElementById('k-modal-aed-price');
      let saving = el.querySelector('.k-modal-price-saving');
      expect(saving).not.toBeNull();
      expect(saving.textContent).toContain('économie');
    });

    it('sans promo_pct → pas de badge ni de mention économie', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 4000 });
      let el = document.getElementById('k-modal-aed-price');
      expect(el.querySelector('.k-modal-aed-pct')).toBeNull();
      expect(el.querySelector('.k-modal-price-saving')).toBeNull();
    });

    it('produit sans price_kmf → zone vidée', () => {
      let el = document.getElementById('k-modal-aed-price');
      el.innerHTML = '<span>reliquat</span>';
      openWithProduct({ id: 1, name: 'P', category: 'Tech' });
      expect(el.innerHTML).toBe('');
    });

    it('élément #k-modal-aed-price absent → no-op', () => {
      document.getElementById('k-modal-aed-price').remove();
      expect(() => openWithProduct()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FLASH + STOCK
  // ═══════════════════════════════════════════════════════════════

  describe('injectFlashAndStock (via modal:opened)', () => {
    it('promo_pct → bandeau promo affiché', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100, promo_pct: 15 });
      expect(document.getElementById('k-modal-flash-bar').textContent).toContain('-15%');
    });

    it('sans promo_pct → bandeau vidé', () => {
      let el = document.getElementById('k-modal-flash-bar');
      el.innerHTML = '<span>reliquat</span>';
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100 });
      expect(el.innerHTML).toBe('');
    });

    it('stock faible (1 à 20) → texte de disponibilité, singulier à 1', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100, stock: 1 });
      let txt = document.getElementById('k-modal-stock-bar').textContent;
      expect(txt).toContain('disponible');
      expect(txt).not.toContain('disponibles');
    });

    it('stock faible pluriel (> 1)', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100, stock: 5 });
      expect(document.getElementById('k-modal-stock-bar').textContent).toContain('disponibles');
    });

    it('stock élevé (> 20) → pas de mention', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100, stock: 50 });
      expect(document.getElementById('k-modal-stock-bar').textContent).toBe('');
    });

    it('stock à 0 → pas de mention (Rupture gérée ailleurs, dans les specs)', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 100, stock: 0 });
      expect(document.getElementById('k-modal-stock-bar').textContent).toBe('');
    });

    it('éléments absents → no-op', () => {
      document.getElementById('k-modal-flash-bar').remove();
      document.getElementById('k-modal-stock-bar').remove();
      expect(() => openWithProduct()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // LIVRAISON / PAIEMENT (statiques mais avec interaction pour paiement)
  // ═══════════════════════════════════════════════════════════════

  describe('injectDelivery (via modal:opened)', () => {
    it('rend le bloc point relais avec les 3 îles', () => {
      openWithProduct();
      let el = document.getElementById('k-modal-delivery');
      expect(el.querySelectorAll('.k-modal-island-chip').length).toBe(3);
      expect(el.textContent).toContain('Point relais');
    });

    it('élément absent → no-op', () => {
      document.getElementById('k-modal-delivery').remove();
      expect(() => openWithProduct()).not.toThrow();
    });
  });

  describe('injectPayment (via modal:opened)', () => {
    it('rend les 4 options avec Stripe actif par défaut', () => {
      openWithProduct();
      let el = document.getElementById('k-modal-payment');
      let opts = el.querySelectorAll('.k-modal-payment-opt');
      expect(opts.length).toBe(4);
      expect(el.querySelector('[data-pay="stripe"]').classList.contains('is-active')).toBe(true);
    });

    it('clic sur une autre option → bascule l\'état actif (radio exclusif)', () => {
      openWithProduct();
      let el = document.getElementById('k-modal-payment');
      el.querySelector('[data-pay="cash"]').click();
      expect(el.querySelector('[data-pay="cash"]').classList.contains('is-active')).toBe(true);
      expect(el.querySelector('[data-pay="stripe"]').classList.contains('is-active')).toBe(false);
    });

    it('élément absent → no-op', () => {
      document.getElementById('k-modal-payment').remove();
      expect(() => openWithProduct()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SOUS-TOTAL
  // ═══════════════════════════════════════════════════════════════

  describe('updateSubtotal (via modal:opened et mutation qty)', () => {
    it('crée le sous-total avec qty par défaut (1)', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 1000 });
      let el = dom.modal.querySelector('.k-modal-actions .k-modal-subtotal');
      expect(normSpaces(el.textContent)).toContain('1 000');
    });

    it('reflète state.modalQty dans le calcul', () => {
      state.modalQty = 3;
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 1000 });
      let el = dom.modal.querySelector('.k-modal-actions .k-modal-subtotal');
      expect(normSpaces(el.textContent)).toContain('3 000');
    });

    it('rappel → met à jour le même élément (pas de doublon)', () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 1000 });
      state.modalQty = 2;
      bus.emit('modal:opened', state.modalProduct);
      expect(dom.modal.querySelectorAll('.k-modal-actions .k-modal-subtotal').length).toBe(1);
      expect(normSpaces(dom.modal.querySelector('.k-modal-actions .k-modal-subtotal').textContent)).toContain('2 000');
    });

    it('pas de zone .k-modal-actions → no-op', () => {
      dom.modal.querySelector('.k-modal-actions').remove();
      expect(() => openWithProduct()).not.toThrow();
    });

    it('pas de produit → no-op', () => {
      openWithProduct(null);
      expect(dom.modal.querySelector('.k-modal-subtotal')).toBeNull();
    });

    it('_setupQtyObserver : mutation de #k-qty-val redéclenche updateSubtotal', async () => {
      openWithProduct({ id: 1, name: 'P', category: 'Tech', price_kmf: 1000 });
      let qtyVal = document.getElementById('k-qty-val');
      state.modalQty = 4;
      qtyVal.textContent = '4';
      await new Promise((resolve) => setTimeout(resolve, 0));
      let el = dom.modal.querySelector('.k-modal-actions .k-modal-subtotal');
      expect(normSpaces(el.textContent)).toContain('4 000');
    });

    it('#k-qty-val absent → setup sans throw, pas d\'observer branché', () => {
      document.getElementById('k-qty-val').remove();
      expect(() => enhancers.setupModalDesktopEnhancers()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // VU RÉCEMMENT
  // ═══════════════════════════════════════════════════════════════

  describe('injectRecentlyViewed (via modal:opened)', () => {
    beforeEach(() => {
      state.products = [
        { id: 1, name: 'Un', price_kmf: 100, image_url: 'un.jpg' },
        { id: 2, name: 'Deux', price_kmf: 200, image_url: 'deux.jpg' },
        { id: 3, name: 'Trois', price_kmf: 300, image_url: 'trois.jpg' },
        { id: 42, name: 'Sac à main tressé', price_kmf: 5000 },
      ];
    });

    it('affiche les produits vus hors le courant, du plus récent au plus ancien', () => {
      state.viewedHistory = [1, 2, 3];
      openWithProduct(state.products[3]); // id 42
      let recent = dom.modal.querySelector('.k-modal-scroll .k-modal-recent');
      let ids = Array.from(recent.querySelectorAll('.k-modal-recent-card')).map((b) => b.getAttribute('data-pid'));
      expect(ids).toEqual(['3', '2', '1']);
    });

    it('exclut le produit courant de la liste même s\'il est dans l\'historique', () => {
      state.viewedHistory = [1, 42, 2];
      openWithProduct(state.products[3]);
      let recent = dom.modal.querySelector('.k-modal-scroll .k-modal-recent');
      let ids = Array.from(recent.querySelectorAll('.k-modal-recent-card')).map((b) => b.getAttribute('data-pid'));
      expect(ids).not.toContain('42');
    });

    it('plafonne à 8 cartes maximum', () => {
      state.products = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: 'P' + i, price_kmf: 10 }));
      state.products.push({ id: 42, name: 'Courant', price_kmf: 5000 });
      state.viewedHistory = state.products.map((p) => p.id).filter((id) => id !== 42);
      openWithProduct(state.products.find((p) => p.id === 42));
      let recent = dom.modal.querySelector('.k-modal-scroll .k-modal-recent');
      expect(recent.querySelectorAll('.k-modal-recent-card').length).toBe(8);
    });

    it('historique vide → aucune section injectée', () => {
      state.viewedHistory = [];
      openWithProduct(state.products[3]);
      expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();
    });

    it('rappel avec historique vidé → l\'ancienne section est retirée', () => {
      state.viewedHistory = [1, 2];
      openWithProduct(state.products[3]);
      expect(dom.modal.querySelector('.k-modal-recent')).not.toBeNull();
      state.viewedHistory = [];
      bus.emit('modal:opened', state.modalProduct);
      expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();
    });

    it('clic sur une carte → openModal(id, true)', () => {
      state.viewedHistory = [1];
      openWithProduct(state.products[3]);
      dom.modal.querySelector('.k-modal-recent-card').click();
      expect(openModal).toHaveBeenCalledWith('1', true);
    });

    it('ID en historique sans produit correspondant → filtré sans planter', () => {
      state.viewedHistory = [999, 1];
      expect(() => openWithProduct(state.products[3])).not.toThrow();
      let recent = dom.modal.querySelector('.k-modal-recent');
      let ids = Array.from(recent.querySelectorAll('.k-modal-recent-card')).map((b) => b.getAttribute('data-pid'));
      expect(ids).toEqual(['1']);
    });

    it('pas de .k-modal-scroll → no-op', () => {
      dom.modal.querySelector('.k-modal-scroll').remove();
      state.viewedHistory = [1];
      expect(() => openWithProduct(state.products[3])).not.toThrow();
    });

    it('pas de produit → no-op', () => {
      openWithProduct(null);
      expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();
    });
  });
});
