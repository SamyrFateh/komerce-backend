'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-pdp-curation-suggestions.test.js
 *
 * js/b-pdp-curation-suggestions.js — curation éditoriale des suggestions
 * sous la PDP desktop : renomme/réordonne les sections déjà rendues par
 * b-modal-suggestions.js (module additif, ne reconstruit aucune carte).
 *
 * Périmètre couvert :
 *   - setup : bus.on câblé sur 'modal:opened' et 'modal:suggestions-rendered',
 *     idempotent (guard _installed)
 *   - scheduleEnhanceCuration : gating mobile (aucun rAF programmé) vs
 *     desktop (deux rAF imbriqués avant enhanceCuration)
 *   - enhanceCuration : tous les no-op défensifs (desktop redevenu mobile
 *     entre les deux rAF, #k-modal-suggestions/#k-sug-rail absents, bloc
 *     masqué via .u-hidden, rail sans section)
 *   - flux complet : déplacement des cartes complémentaires (max 6, badges
 *     Assorti/Utile), renommage "Dans le même univers" avec la catégorie,
 *     renommage "Sélection Komerce" ou masquage si le bloc devient vide
 *   - pickComplementTitle : mapping catégorie → intitulé, casse et
 *     catégorie inconnue/absente → libellé générique
 *   - garde-fous défensifs de setSectionTitle/addBadge (éléments manquants,
 *     badge déjà posé, carte sans image)
 *   - guard par produit (dataset.curationProductId) : un même produit ne
 *     ré-enrichit pas deux fois, un produit différent lève le guard
 *
 * `_installed` est un état de module → jest.resetModules() + re-require
 * par test (pattern déjà en place pour les autres b-*-premium-v1).
 */

const { mountFixture, resetState } = require('./helpers/boutiqueTestKit.js');

function load() {
  jest.doMock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn() }));
  jest.doMock('../../js/b-bus.js', () => ({ bus: { on: jest.fn(), emit: jest.fn() } }));
  // eslint-disable-next-line global-require
  const { isDesktop } = require('../../js/b-scroll-owner.js');
  // eslint-disable-next-line global-require
  const { bus } = require('../../js/b-bus.js');
  // eslint-disable-next-line global-require
  const { state } = require('../../js/b-store.js');
  resetState(state);
  // eslint-disable-next-line global-require
  const { setupPdpCurationSuggestions } = require('../../js/b-pdp-curation-suggestions.js');
  return { isDesktop, bus, state, setupPdpCurationSuggestions };
}

/** Fait tourner requestAnimationFrame de façon synchrone, en gardant une trace des appels. */
function mockSyncRaf() {
  window.requestAnimationFrame = jest.fn((cb) => { cb(); return 0; });
}

function makeCard({ withImg = true, withBadge = false } = {}) {
  const card = document.createElement('div');
  card.className = 'k-sug-card';
  if (withImg) {
    const img = document.createElement('img');
    img.className = 'k-sug-card-img';
    card.appendChild(img);
  }
  if (withBadge) {
    const badge = document.createElement('span');
    badge.className = 'k-pdp-curation-badge';
    badge.textContent = 'préexistant';
    if (card.firstChild) card.firstChild.appendChild(badge);
    else card.appendChild(badge);
  }
  return card;
}

function makeSection(gridModifier, cardCount, cardOpts) {
  const section = document.createElement('div');
  section.className = 'k-sug-section';

  const title = document.createElement('div');
  title.className = 'k-sug-title';
  const icon = document.createElement('span');
  icon.className = 'k-sug-title-icon';
  const text = document.createElement('span');
  text.className = 'k-sug-title-text';
  title.append(icon, text);

  const grid = document.createElement('div');
  grid.className = `k-sug-grid k-sug-grid--${gridModifier}`;
  for (let i = 0; i < cardCount; i++) {
    grid.appendChild(makeCard(Array.isArray(cardOpts) ? cardOpts[i] : cardOpts));
  }

  section.append(title, grid);
  return section;
}

/** Monte le fixture standard : suggestions > rail > [section same, section other]. */
function mountSuggestions({ sameCount = 3, otherCount = 4, otherCardOpts, hidden = false } = {}) {
  const root = mountFixture('');
  const suggestions = document.createElement('div');
  suggestions.id = 'k-modal-suggestions';
  if (hidden) suggestions.classList.add('u-hidden');

  const rail = document.createElement('div');
  rail.id = 'k-sug-rail';

  const sameSection = makeSection('same', sameCount);
  const otherSection = makeSection('other', otherCount, otherCardOpts);
  rail.append(sameSection, otherSection);

  suggestions.appendChild(rail);
  root.appendChild(suggestions);

  return { suggestions, rail, sameSection, otherSection };
}

describe('b-pdp-curation-suggestions', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe('setupPdpCurationSuggestions', () => {
    test('câble bus.on sur modal:opened et modal:suggestions-rendered', () => {
      const { bus, setupPdpCurationSuggestions } = load();

      setupPdpCurationSuggestions();

      const events = bus.on.mock.calls.map((c) => c[0]);
      expect(events).toEqual(['modal:opened', 'modal:suggestions-rendered']);
    });

    test('appels multiples restent idempotents (guard _installed)', () => {
      const { bus, setupPdpCurationSuggestions } = load();

      setupPdpCurationSuggestions();
      setupPdpCurationSuggestions();

      expect(bus.on).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduleEnhanceCuration — gating desktop/mobile', () => {
    test('mobile : aucun rAF programmé', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(false);
      mockSyncRaf();
      setupPdpCurationSuggestions();
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];

      handler();

      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    test('desktop : deux rAF imbriqués avant enhanceCuration', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      mountSuggestions();
      setupPdpCurationSuggestions();
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];

      handler();

      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
      // Effet retardé mais bien exécuté (rAF synchrone) : la classe est posée.
      expect(document.getElementById('k-modal-suggestions').classList.contains('k-pdp-curation')).toBe(true);
    });

    test('redevenu mobile entre les deux rAF : enhanceCuration se re-vérifie et no-op', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      // 1er appel (dans scheduleEnhanceCuration) : desktop → on programme les rAF.
      // Tous les suivants (dans enhanceCuration) : redevenu mobile.
      isDesktop.mockReturnValueOnce(true).mockReturnValue(false);
      mockSyncRaf();
      mountSuggestions();
      setupPdpCurationSuggestions();
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];

      expect(() => handler()).not.toThrow();

      expect(document.getElementById('k-modal-suggestions').classList.contains('k-pdp-curation')).toBe(false);
    });
  });

  describe('enhanceCuration — no-op défensifs', () => {
    function trigger(bus) {
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      handler();
    }

    test('#k-modal-suggestions absent : no-op sans erreur', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      mountFixture('<div id="k-sug-rail"></div>');
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
    });

    test('#k-sug-rail absent : no-op sans erreur', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      mountFixture('<div id="k-modal-suggestions"></div>');
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
    });

    test('suggestions déjà masquées (.u-hidden) : no-op', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { suggestions } = mountSuggestions({ hidden: true });
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(suggestions.classList.contains('k-pdp-curation')).toBe(false);
    });

    test('rail sans section .k-sug-section : no-op', () => {
      const { isDesktop, bus, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const root = mountFixture('');
      const suggestions = document.createElement('div');
      suggestions.id = 'k-modal-suggestions';
      const rail = document.createElement('div');
      rail.id = 'k-sug-rail';
      suggestions.appendChild(rail);
      root.appendChild(suggestions);
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
      expect(suggestions.classList.contains('k-pdp-curation')).toBe(false);
    });
  });

  describe('enhanceCuration — flux complet', () => {
    function trigger(bus) {
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      handler();
    }

    test('déplace jusqu’à 6 cartes complémentaires vers une nouvelle section en tête de rail, badges Assorti (2 premières) / Utile (le reste)', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail, otherSection } = mountSuggestions({ otherCount: 8 });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);

      const complementSection = rail.firstElementChild;
      expect(complementSection.classList.contains('k-pdp-curation-section--complements')).toBe(true);
      expect(rail.firstElementChild).toBe(complementSection);

      const movedCards = complementSection.querySelectorAll('.k-sug-card');
      expect(movedCards).toHaveLength(6); // maxCount

      const badges = Array.from(movedCards).map((c) => c.querySelector('.k-pdp-curation-badge').textContent);
      expect(badges).toEqual(['Assorti', 'Assorti', 'Utile', 'Utile', 'Utile', 'Utile']);

      // 8 cartes au départ, 6 déplacées → il en reste 2 dans otherSection.
      expect(otherSection.querySelectorAll('.k-sug-card')).toHaveLength(2);
    });

    test('intitulé de la section complémentaire dépend de la catégorie du produit (pickComplementTitle)', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = { id: 1, category: 'mode' };
      setupPdpCurationSuggestions();

      trigger(bus);

      const titleText = rail.firstElementChild.querySelector('.k-sug-title-text').textContent;
      expect(titleText).toBe('Compléter le look');
    });

    test('catégorie inconnue ou produit absent → intitulé générique "Compléter avec"', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = null;
      setupPdpCurationSuggestions();

      trigger(bus);

      const titleText = rail.firstElementChild.querySelector('.k-sug-title-text').textContent;
      expect(titleText).toBe('Compléter avec');
    });

    test('catégorie insensible à la casse et aux espaces ("  TECH  " → Accessoires compatibles)', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = { id: 1, category: '  TECH  ' };
      setupPdpCurationSuggestions();

      trigger(bus);

      const titleText = rail.firstElementChild.querySelector('.k-sug-title-text').textContent;
      expect(titleText).toBe('Accessoires compatibles');
    });

    test('renomme la section "même univers" avec la catégorie du produit', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { sameSection } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = { id: 1, category: 'maison' };
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(sameSection.classList.contains('k-pdp-curation-section--same')).toBe(true);
      expect(sameSection.querySelector('.k-sug-title-icon').textContent).toBe('🌊');
      expect(sameSection.querySelector('.k-sug-title-text').textContent).toBe('Dans le même univers');
      expect(sameSection.querySelector('.k-pdp-curation-subtitle').textContent).toContain('maison');
    });

    test('sans catégorie sur le produit : "ce produit" utilisé dans le sous-titre "même univers"', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { sameSection } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = { id: 1 };
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(sameSection.querySelector('.k-pdp-curation-subtitle').textContent).toContain('ce produit');
    });

    test('renomme "Sélection Komerce" quand il reste des cartes après déplacement des complémentaires', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { otherSection } = mountSuggestions({ otherCount: 8 }); // 8 - 6 = 2 restantes
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(otherSection.classList.contains('k-pdp-curation-section--editorial')).toBe(true);
      expect(otherSection.querySelector('.k-sug-title-text').textContent).toBe('Sélection Komerce');
      expect(otherSection.classList.contains('u-hidden')).toBe(false);
    });

    test('masque la section "autres" (.u-hidden) si elle devient vide après déplacement', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { otherSection } = mountSuggestions({ otherCount: 4 }); // 4 <= maxCount 6 → tout déplacé
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(otherSection.querySelectorAll('.k-sug-card')).toHaveLength(0);
      expect(otherSection.classList.contains('u-hidden')).toBe(true);
      // Pas de renommage puisque la section est vidée, pas de titre "Sélection Komerce".
      expect(otherSection.querySelector('.k-sug-title-text').textContent).toBe('');
    });

    test('section "autres" absente (pas de .k-sug-grid--other) : pas de section complémentaire, pas de throw', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const root = mountFixture('');
      const suggestions = document.createElement('div');
      suggestions.id = 'k-modal-suggestions';
      const rail = document.createElement('div');
      rail.id = 'k-sug-rail';
      const sameSection = makeSection('same', 3);
      rail.appendChild(sameSection);
      suggestions.appendChild(rail);
      root.appendChild(suggestions);
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
      expect(rail.querySelectorAll('.k-pdp-curation-section--complements')).toHaveLength(0);
      expect(sameSection.classList.contains('k-pdp-curation-section--same')).toBe(true);
    });

    test('grille "autres" vide (0 carte) : aucune section complémentaire créée', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 0 });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(rail.querySelectorAll('.k-pdp-curation-section--complements')).toHaveLength(0);
    });
  });

  describe('addBadge / setSectionTitle — garde-fous défensifs', () => {
    function trigger(bus) {
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      handler();
    }

    test('carte sans image (.k-sug-card-img absente) : aucun badge ajouté, pas de throw', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 1, otherCardOpts: { withImg: false } });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
      const complementSection = rail.firstElementChild;
      expect(complementSection.querySelector('.k-pdp-curation-badge')).toBeNull();
    });

    test('carte déjà badgée : addBadge ne pose pas de second badge', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 1, otherCardOpts: { withBadge: true } });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);

      const complementSection = rail.firstElementChild;
      expect(complementSection.querySelectorAll('.k-pdp-curation-badge')).toHaveLength(1);
    });

    test('section sans .k-sug-title : setSectionTitle no-op, la classe de section est quand même posée', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const root = mountFixture('');
      const suggestions = document.createElement('div');
      suggestions.id = 'k-modal-suggestions';
      const rail = document.createElement('div');
      rail.id = 'k-sug-rail';

      // sameSection sans .k-sug-title du tout.
      const sameSection = document.createElement('div');
      sameSection.className = 'k-sug-section';
      const sameGrid = document.createElement('div');
      sameGrid.className = 'k-sug-grid k-sug-grid--same';
      sameSection.appendChild(sameGrid);

      const otherSection = makeSection('other', 2);
      rail.append(sameSection, otherSection);
      suggestions.appendChild(rail);
      root.appendChild(suggestions);
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      expect(() => trigger(bus)).not.toThrow();
      expect(sameSection.classList.contains('k-pdp-curation-section--same')).toBe(true);
    });
  });

  describe('guard par produit (dataset.curationProductId)', () => {
    function trigger(bus) {
      const handler = bus.on.mock.calls.find((c) => c[0] === 'modal:opened')[1];
      handler();
    }

    test('même produit : un second déclenchement ne ré-enrichit pas (pas de doublon de section complémentaire)', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { rail } = mountSuggestions({ otherCount: 8 });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);
      trigger(bus);

      expect(rail.querySelectorAll('.k-pdp-curation-section--complements')).toHaveLength(1);
    });

    test('produit différent : le guard est levé, dataset.curationProductId se met à jour', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { suggestions } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = { id: 1, category: 'tech' };
      setupPdpCurationSuggestions();

      trigger(bus);
      expect(suggestions.dataset.curationProductId).toBe('1');

      state.modalProduct = { id: 2, category: 'mode' };
      trigger(bus);

      expect(suggestions.dataset.curationProductId).toBe('2');
    });

    test('sans state.modalProduct au premier passage : productId vide, enrichissement effectué quand même', () => {
      const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
      isDesktop.mockReturnValue(true);
      mockSyncRaf();
      const { suggestions } = mountSuggestions({ otherCount: 2 });
      state.modalProduct = null;
      setupPdpCurationSuggestions();

      trigger(bus);

      expect(suggestions.classList.contains('k-pdp-curation')).toBe(true);
      expect(suggestions.dataset.curationProductId).toBe('');
    });
  });
});
