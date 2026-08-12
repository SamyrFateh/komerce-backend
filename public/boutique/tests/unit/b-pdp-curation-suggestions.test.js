'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
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

function mockSyncRaf() {
  window.requestAnimationFrame = jest.fn((callback) => { callback(); return 0; });
}

function makeSection(kind, labels) {
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
  grid.className = `k-sug-grid k-sug-grid--${kind}`;
  labels.forEach((label) => {
    const card = document.createElement('article');
    card.className = 'k-sug-card';
    card.dataset.label = label;
    grid.appendChild(card);
  });
  section.append(title, grid);
  return section;
}

function mountSuggestions({ same = ['Chemise'], other = ['Mascara', 'Poudre'], hidden = false } = {}) {
  const root = mountFixture('');
  const suggestions = document.createElement('div');
  suggestions.id = 'k-modal-suggestions';
  if (hidden) suggestions.classList.add('u-hidden');
  const rail = document.createElement('div');
  rail.id = 'k-sug-rail';
  const sameSection = makeSection('same', same);
  const otherSection = makeSection('other', other);
  rail.append(sameSection, otherSection);
  suggestions.appendChild(rail);
  root.appendChild(suggestions);
  return { suggestions, rail, sameSection, otherSection };
}

function trigger(bus, event = 'modal:opened') {
  const handler = bus.on.mock.calls.find((call) => call[0] === event)[1];
  handler();
}

describe('b-pdp-curation-suggestions', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('câble les deux événements une seule fois', () => {
    const { bus, setupPdpCurationSuggestions } = load();
    setupPdpCurationSuggestions();
    setupPdpCurationSuggestions();
    expect(bus.on.mock.calls.map((call) => call[0])).toEqual([
      'modal:opened',
      'modal:suggestions-rendered',
    ]);
  });

  test('mobile ne programme aucun enrichissement', () => {
    const { isDesktop, bus, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(false);
    mockSyncRaf();
    setupPdpCurationSuggestions();
    trigger(bus);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  test('desktop attend deux frames et renomme les deux niveaux honnêtement', () => {
    const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(true);
    mockSyncRaf();
    const { suggestions, sameSection, otherSection } = mountSuggestions();
    state.modalProduct = { id: 1, category: 'Mode & Beauté' };
    setupPdpCurationSuggestions();

    trigger(bus, 'modal:suggestions-rendered');

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(suggestions.classList.contains('k-pdp-curation')).toBe(true);
    expect(sameSection.classList.contains('k-pdp-curation-section--same')).toBe(true);
    expect(sameSection.querySelector('.k-sug-title-text').textContent).toBe('Dans le même univers');
    expect(sameSection.querySelector('.k-pdp-curation-subtitle').textContent).toContain('Mode & Beauté');
    expect(otherSection.classList.contains('k-pdp-curation-section--editorial')).toBe(true);
    expect(otherSection.querySelector('.k-sug-title-text').textContent).toBe('Sélection Komerce');
  });

  test('une chemise homme ne transforme jamais les cosmétiques génériques en compléments', () => {
    const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(true);
    mockSyncRaf();
    const { rail, otherSection } = mountSuggestions({
      same: ['Polo'],
      other: ['Mascara', 'Fard à paupières', 'Poudre', 'Vernis'],
    });
    state.modalProduct = { id: 2, name: 'Chemise homme', category: 'Mode & Beauté' };
    setupPdpCurationSuggestions();

    trigger(bus);

    expect(rail.querySelector('.k-pdp-curation-section--complements')).toBeNull();
    expect(rail.textContent).not.toMatch(/Compléter le look|Assorti|Utile|compatible/i);
    expect(otherSection.querySelectorAll('.k-sug-card')).toHaveLength(4);
    expect(Array.from(otherSection.querySelectorAll('.k-sug-card')).map((card) => card.dataset.label))
      .toEqual(['Mascara', 'Fard à paupières', 'Poudre', 'Vernis']);
  });

  test('masque seulement une sélection éditoriale réellement vide', () => {
    const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(true);
    mockSyncRaf();
    const { otherSection } = mountSuggestions({ other: [] });
    state.modalProduct = { id: 3, category: 'Tech' };
    setupPdpCurationSuggestions();
    trigger(bus);
    expect(otherSection.classList.contains('u-hidden')).toBe(true);
  });

  test.each([
    ['suggestions absentes', '<div id="k-sug-rail"></div>'],
    ['rail absent', '<div id="k-modal-suggestions"></div>'],
    ['rail vide', '<div id="k-modal-suggestions"><div id="k-sug-rail"></div></div>'],
  ])('%s : no-op défensif', (_label, html) => {
    const { isDesktop, bus, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(true);
    mockSyncRaf();
    mountFixture(html);
    setupPdpCurationSuggestions();
    expect(() => trigger(bus)).not.toThrow();
  });

  test('bloc masqué et viewport redevenu mobile restent sans effet', () => {
    const { isDesktop, bus, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValueOnce(true).mockReturnValue(false);
    mockSyncRaf();
    const { suggestions } = mountSuggestions({ hidden: true });
    setupPdpCurationSuggestions();
    trigger(bus);
    expect(suggestions.classList.contains('k-pdp-curation')).toBe(false);
  });

  test('garde par produit : idempotent puis réévalue un nouveau produit', () => {
    const { isDesktop, bus, state, setupPdpCurationSuggestions } = load();
    isDesktop.mockReturnValue(true);
    mockSyncRaf();
    const { suggestions } = mountSuggestions();
    state.modalProduct = { id: 1, category: 'Maison' };
    setupPdpCurationSuggestions();
    trigger(bus);
    trigger(bus);
    expect(suggestions.dataset.curationProductId).toBe('1');
    expect(suggestions.querySelectorAll('.k-pdp-curation-subtitle')).toHaveLength(2);

    state.modalProduct = { id: 2, category: 'Tech' };
    trigger(bus);
    expect(suggestions.dataset.curationProductId).toBe('2');
    expect(suggestions.querySelectorAll('.k-pdp-curation-subtitle')).toHaveLength(2);
  });
});
