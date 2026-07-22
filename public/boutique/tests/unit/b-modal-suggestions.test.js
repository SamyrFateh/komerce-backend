'use strict';

/**
 * tests/unit/b-modal-suggestions.test.js
 *
 * js/b-modal-suggestions.js (383L) — rail de suggestions de la fiche
 * produit (extrait de b-modal.js, ARCH-2 PR2). Un seul export public :
 * `renderSuggestions(sameCat, otherCat, categoryName)`.
 *
 * Dépendances mockées : b-cart.js (addToCart/quickAdd/quickRemove — avec
 * mockImplementation simulant l'effet réel sur `state.cart` pour pouvoir
 * vérifier les mises à jour de stepper qui en découlent),
 * b-scroll-owner.js (isDesktop — contrôlé par test). b-store.js, b-utils.js,
 * b-bus.js gardés réels (state/dom mutables partagés, pattern déjà utilisé
 * pour b-modal-cart.test.js / b-modal-desktop-enhancers.test.js).
 *
 * Découplage cycle : la carte suggestion émet bus.emit('modal:open', {id})
 * au lieu d'appeler openModal — testé directement via un listener bus.
 *
 * Particularité de cette version du module (RANK-01) : les actions de carte
 * (add/stepper) passent par `_bindCardActions` (clone+replace du bloc
 * `.k-sug-card-actions`, idempotent) et `_updateCardStepper` (mise à jour
 * ciblée via une Map productId→cardElement, pas de re-render complet). Les
 * mocks cart doivent donc réellement muter `state.cart` pour que ces mises
 * à jour ciblées soient observables en test.
 *
 * Périmètre couvert : `_ensureTwoSuggestionLevels` (complément local quand
 * l'API ne renvoie qu'un niveau), le rendu des 2 sections (même catégorie /
 * cela peut vous plaire), la carte (stepper add/plus/minus via
 * `_bindCardActions`/`_updateCardStepper`, badge promo, reason_label), le
 * clic carte → bus 'modal:open' (hors zone stepper), les chips de filtre
 * sous-catégorie, `applyModalDesktopSuggestionState` (bascule desktop +
 * déplacement DOM), et l'émission de 'modal:suggestions-rendered'.
 *
 * Laissé de côté : le modal infini mobile (auto-advance des chips en fin de
 * scroll, `scrollend`/`scroll` + reshuffle Fisher-Yates + double setTimeout
 * imbriqué avec `scrollIntoView`) — comportement de scroll réel/timing très
 * spécifique au navigateur, dette assumée de même nature que les timers
 * déjà mis de côté dans b-group-view/b-modal-desktop-enhancers. On vérifie
 * seulement que le branchement (fenêtre < 900px) ne fait pas planter le
 * rendu.
 */

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { addToCart, quickAdd, quickRemove } = require('../../js/b-cart.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { renderSuggestions } = require('../../js/b-modal-suggestions.js');

function buildDom() {
  document.body.innerHTML =
    '<div id="k-modal-suggestions">' +
      '<h3>Vous aimerez aussi</h3>' +
    '</div>' +
    '<div id="k-sug-rail"></div>' +
    '<div id="k-modal">' +
      '<div class="k-modal-scroll">' +
        '<div class="k-modal-product-zone"></div>' +
      '</div>' +
    '</div>';
  dom.sugRail = document.getElementById('k-sug-rail');
  dom.modal = document.getElementById('k-modal');
}

function product(overrides) {
  return Object.assign({
    id: 1, name: 'Produit', price_kmf: 1000, category: 'Chaussures',
  }, overrides);
}

describe('b-modal-suggestions', () => {
  beforeEach(() => {
    buildDom();
    isDesktop.mockReturnValue(false);
    state.modalProduct = product({ id: 99 });
    state.products = [];
    state.cart = [];
    state.modalSubcatFilter = null;
    // window.innerWidth par défaut fixé à 1024 => pas de branche "modal infini mobile"
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

    // Simule l'effet réel de addToCart/quickAdd/quickRemove sur state.cart,
    // requis pour observer les mises à jour ciblées de _updateCardStepper.
    addToCart.mockImplementation((prod, qty) => {
      state.cart.push({ product: prod, qty: qty || 1 });
    });
    quickAdd.mockImplementation((pid) => {
      const item = state.cart.find((i) => String(i.product.id) === String(pid));
      if (item) item.qty += 1;
    });
    quickRemove.mockImplementation((pid) => {
      const item = state.cart.find((i) => String(i.product.id) === String(pid));
      if (item) {
        item.qty -= 1;
        if (item.qty <= 0) state.cart = state.cart.filter((i) => i !== item);
      }
    });
  });

  describe('rendu de base', () => {
    it('sameCat + otherCat vides -> masque la section et ne construit rien', () => {
      renderSuggestions([], [], 'Chaussures');
      const section = document.getElementById('k-modal-suggestions');
      expect(section.classList.contains('u-hidden')).toBe(true);
      expect(dom.sugRail.innerHTML).toBe('');
    });

    it('sameCat non vide -> section visible, 1 carte, titre contextuel avec le nom de catégorie', () => {
      renderSuggestions([product({ id: 1, name: 'Basket' })], [], 'Chaussures');
      const section = document.getElementById('k-modal-suggestions');
      expect(section.classList.contains('u-hidden')).toBe(false);
      expect(dom.sugRail.querySelectorAll('.k-sug-card').length).toBe(1);
      expect(dom.sugRail.textContent).toContain('chaussures');
      expect(dom.sugRail.querySelector('.k-sug-card-name').textContent).toBe('Basket');
    });

    it('otherCat non vide -> section "Cela peut vous plaire" avec ses cartes', () => {
      renderSuggestions([], [product({ id: 2, name: 'Sac', category: 'Sacs' })], null);
      expect(dom.sugRail.textContent).toContain('Cela peut vous plaire');
      expect(dom.sugRail.querySelectorAll('.k-sug-grid--other .k-sug-card').length).toBe(1);
    });

    it('masque le vieux <h3> générique s\'il existe', () => {
      renderSuggestions([product({ id: 1 })], [], 'Chaussures');
      const oldH3 = document.querySelector('#k-modal-suggestions h3');
      expect(oldH3.classList.contains('u-hidden')).toBe(true);
    });

    it('badge promo affiché si promo_pct présent', () => {
      renderSuggestions([product({ id: 1, promo_pct: 30 })], [], 'Chaussures');
      expect(dom.sugRail.querySelector('.k-sug-promo-badge').textContent).toContain('-30%');
    });

    it('reason_label affiché si présent, absent sinon', () => {
      renderSuggestions([product({ id: 1, reason_label: 'Souvent acheté ensemble' })], [], 'Chaussures');
      expect(dom.sugRail.querySelector('.k-sug-card-reason').textContent).toBe('Souvent acheté ensemble');
      dom.sugRail.innerHTML = '';
      renderSuggestions([product({ id: 2 })], [], 'Chaussures');
      expect(dom.sugRail.querySelector('.k-sug-card-reason')).toBeNull();
    });
  });

  describe('_ensureTwoSuggestionLevels (complément local)', () => {
    it('sameCat vide + catalogue local dispo -> complété avec des produits de la même catégorie', () => {
      state.modalProduct = product({ id: 99, category: 'Chaussures' });
      state.products = [
        state.modalProduct,
        product({ id: 1, category: 'Chaussures', name: 'Basket A' }),
        product({ id: 2, category: 'Chaussures', name: 'Basket B' }),
        product({ id: 3, category: 'Sacs', name: 'Sac X' }),
      ];
      renderSuggestions([], [], 'Chaussures');
      const names = Array.from(dom.sugRail.querySelectorAll('.k-sug-grid--same .k-sug-card-name')).map((n) => n.textContent);
      expect(names).toEqual(expect.arrayContaining(['Basket A', 'Basket B']));
      expect(names).not.toContain('Sac X');
    });

    it('otherCat vide + catalogue local dispo -> complété avec des produits hors catégorie', () => {
      state.modalProduct = product({ id: 99, category: 'Chaussures' });
      state.products = [
        state.modalProduct,
        product({ id: 3, category: 'Sacs', name: 'Sac X' }),
      ];
      renderSuggestions([product({ id: 1, category: 'Chaussures', name: 'Basket A' })], [], 'Chaussures');
      const otherNames = Array.from(dom.sugRail.querySelectorAll('.k-sug-grid--other .k-sug-card-name')).map((n) => n.textContent);
      expect(otherNames).toContain('Sac X');
    });

    it('exclut le produit courant du complément local', () => {
      state.modalProduct = product({ id: 99, category: 'Chaussures' });
      state.products = [state.modalProduct];
      renderSuggestions([], [], 'Chaussures');
      expect(dom.sugRail.querySelectorAll('.k-sug-card').length).toBe(0);
    });

    it('aucun produit ouvert -> retourne les listes telles quelles (pas de complément)', () => {
      state.modalProduct = null;
      state.products = [product({ id: 1, category: 'X' })];
      renderSuggestions([], [], null);
      const section = document.getElementById('k-modal-suggestions');
      expect(section.classList.contains('u-hidden')).toBe(true);
    });
  });

  describe('interactions carte', () => {
    it('clic sur la carte (hors stepper) émet bus "modal:open" avec l\'id produit', () => {
      renderSuggestions([product({ id: 7, name: 'Basket' })], [], 'Chaussures');
      const openHandler = jest.fn();
      bus.on('modal:open', openHandler);

      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      card.dispatchEvent(new window.Event('click', { bubbles: true }));

      expect(openHandler).toHaveBeenCalledWith({ id: '7' });
    });

    it('clic sur le bouton add (produit hors panier) -> addToCart appelé, puis stepper devient -/qty/+', () => {
      state.products = [product({ id: 7, name: 'Basket' })];
      state.cart = [];
      renderSuggestions([product({ id: 7, name: 'Basket' })], [], 'Chaussures');

      const addBtn = dom.sugRail.querySelector('.k-sug-add[data-add="7"]');
      addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

      expect(addToCart).toHaveBeenCalledWith(state.products[0], 1, addBtn);
      // _updateCardStepper a réagi à la mutation de state.cart faite par le mock
      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      expect(card.querySelector('.k-sug-qty').textContent).toBe('1');
      expect(card.querySelector('.k-sug-add')).toBeNull();
    });

    it('carte déjà dans le panier (qty>0) -> stepper -/qty/+ affiché d\'emblée', () => {
      state.cart = [{ product: { id: 7 }, qty: 3 }];
      renderSuggestions([product({ id: 7 })], [], 'Chaussures');
      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      expect(card.querySelector('.k-sug-qty').textContent).toBe('3');
    });

    it('clic sur "+" du stepper -> quickAdd appelé et qty affichée incrémentée', () => {
      state.cart = [{ product: { id: 7 }, qty: 2 }];
      renderSuggestions([product({ id: 7 })], [], 'Chaussures');
      const plusBtn = dom.sugRail.querySelector('.k-sug-plus[data-pid="7"]');
      plusBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      expect(quickAdd).toHaveBeenCalledWith('7', plusBtn);
      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      expect(card.querySelector('.k-sug-qty').textContent).toBe('3');
    });

    it('clic sur "−" du stepper -> quickRemove appelé et qty affichée décrémentée', () => {
      state.cart = [{ product: { id: 7 }, qty: 2 }];
      renderSuggestions([product({ id: 7 })], [], 'Chaussures');
      const minusBtn = dom.sugRail.querySelector('.k-sug-minus[data-pid="7"]');
      minusBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      expect(quickRemove).toHaveBeenCalledWith('7', minusBtn);
      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      expect(card.querySelector('.k-sug-qty').textContent).toBe('1');
    });

    it('clic sur "−" du stepper qui vide le panier -> revient au bouton add', () => {
      state.cart = [{ product: { id: 7 }, qty: 1 }];
      renderSuggestions([product({ id: 7 })], [], 'Chaussures');
      const minusBtn = dom.sugRail.querySelector('.k-sug-minus[data-pid="7"]');
      minusBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      const card = dom.sugRail.querySelector('.k-sug-card[data-id="7"]');
      expect(card.querySelector('.k-sug-add')).not.toBeNull();
      expect(card.querySelector('.k-sug-qty')).toBeNull();
    });

    it('clic sur le bouton add ne propage pas jusqu\'au handler de clic carte', () => {
      state.products = [product({ id: 7 })];
      renderSuggestions([product({ id: 7 })], [], 'Chaussures');
      const openHandler = jest.fn();
      bus.on('modal:open', openHandler);

      const addBtn = dom.sugRail.querySelector('.k-sug-add[data-add="7"]');
      addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

      expect(openHandler).not.toHaveBeenCalled();
    });
  });

  describe('chips de filtre sous-catégorie', () => {
    it('>=2 sous-catégories -> chips affichées, "Tout" actif par défaut', () => {
      renderSuggestions([
        product({ id: 1, subcategory: 'Sport' }),
        product({ id: 2, subcategory: 'Ville' }),
      ], [], 'Chaussures');
      const chips = dom.sugRail.querySelectorAll('.k-sug-chip');
      expect(chips.length).toBe(3); // Tout + Sport + Ville
      expect(chips[0].classList.contains('is-active')).toBe(true);
    });

    it('< 2 sous-catégories -> pas de chips', () => {
      renderSuggestions([product({ id: 1, subcategory: 'Sport' })], [], 'Chaussures');
      expect(dom.sugRail.querySelectorAll('.k-sug-chip').length).toBe(0);
    });

    it('clic sur une chip filtre les cartes de la grille "même catégorie"', () => {
      renderSuggestions([
        product({ id: 1, subcategory: 'Sport' }),
        product({ id: 2, subcategory: 'Ville' }),
      ], [], 'Chaussures');

      const sportChip = Array.from(dom.sugRail.querySelectorAll('.k-sug-chip'))
        .find((c) => c.dataset.subcat === 'Sport');
      sportChip.dispatchEvent(new window.Event('click', { bubbles: true }));

      expect(state.modalSubcatFilter).toBe('Sport');
      expect(sportChip.classList.contains('is-active')).toBe(true);
      const card1 = dom.sugRail.querySelector('.k-sug-card[data-id="1"]');
      const card2 = dom.sugRail.querySelector('.k-sug-card[data-id="2"]');
      expect(card1.classList.contains('subcat-hidden')).toBe(false);
      expect(card2.classList.contains('subcat-hidden')).toBe(true);
    });

    it('chip "Tout" réaffiche toutes les cartes', () => {
      renderSuggestions([
        product({ id: 1, subcategory: 'Sport' }),
        product({ id: 2, subcategory: 'Ville' }),
      ], [], 'Chaussures');
      const chips = dom.sugRail.querySelectorAll('.k-sug-chip');
      const sportChip = Array.from(chips).find((c) => c.dataset.subcat === 'Sport');
      sportChip.dispatchEvent(new window.Event('click', { bubbles: true }));
      const toutChip = Array.from(dom.sugRail.querySelectorAll('.k-sug-chip')).find((c) => c.dataset.subcat === '');
      toutChip.dispatchEvent(new window.Event('click', { bubbles: true }));

      expect(state.modalSubcatFilter).toBeNull();
      expect(dom.sugRail.querySelector('.k-sug-card[data-id="2"]').classList.contains('subcat-hidden')).toBe(false);
    });
  });

  describe('applyModalDesktopSuggestionState (via renderSuggestions)', () => {
    it('mobile (isDesktop=false) -> pas de classe desktop, pas de déplacement DOM', () => {
      isDesktop.mockReturnValue(false);
      renderSuggestions([product({ id: 1 })], [], 'Chaussures');
      const section = document.getElementById('k-modal-suggestions');
      expect(section.classList.contains('k-modal-suggestions--desktop-list')).toBe(false);
    });

    it('desktop (isDesktop=true) -> classes desktop posées + section déplacée dans .k-modal-scroll', () => {
      isDesktop.mockReturnValue(true);
      renderSuggestions([product({ id: 1 })], [], 'Chaussures');
      const section = document.getElementById('k-modal-suggestions');
      const scroll = document.querySelector('.k-modal-scroll');
      expect(section.classList.contains('k-modal-suggestions--desktop-list')).toBe(true);
      expect(section.parentElement).toBe(scroll);
      expect(dom.sugRail.classList.contains('k-sug-rail--desktop-list')).toBe(true);
    });

    it('desktop, appel répété -> ne déplace pas une deuxième fois (idempotent)', () => {
      isDesktop.mockReturnValue(true);
      renderSuggestions([product({ id: 1 })], [], 'Chaussures');
      renderSuggestions([product({ id: 1 })], [], 'Chaussures');
      const scroll = document.querySelector('.k-modal-scroll');
      expect(scroll.querySelectorAll('#k-modal-suggestions').length).toBe(1);
    });
  });

  it('émet "modal:suggestions-rendered" avec le produit courant', () => {
    const handler = jest.fn();
    bus.on('modal:suggestions-rendered', handler);
    state.modalProduct = product({ id: 99 });
    renderSuggestions([product({ id: 1 })], [], 'Chaussures');
    expect(handler).toHaveBeenCalledWith({ product: state.modalProduct });
  });

  describe('branche "modal infini" mobile — fumée seulement (dette e2e)', () => {
    it('fenêtre < 900px -> le rendu ne plante pas et attache le listener scrollend', () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
      expect(() => renderSuggestions([
        product({ id: 1, subcategory: 'Sport' }),
        product({ id: 2, subcategory: 'Ville' }),
      ], [], 'Chaussures')).not.toThrow();
      const scrollEl = document.querySelector('.k-modal-scroll');
      expect(typeof scrollEl._sugInfinite).toBe('function');
    });
  });
});


describe('b-modal-suggestions — contrat stepper compact is-filled', () => {
  test('le DOM suit explicitement le passage quantité vide/remplie', () => {
    const fs = require('fs');
    const path = require('path');

    const source = fs.readFileSync(
      path.join(__dirname, '../../js/b-modal-suggestions.js'),
      'utf8'
    );

    expect(source).toMatch(
      /classList\.toggle\('is-filled',\s*qty\s*>\s*0\)/
    );

    expect(source).toMatch(
      /k-sug-card-actions\$\{qty\s*>\s*0\s*\?\s*' is-filled'\s*:\s*''\}/
    );
  });
});