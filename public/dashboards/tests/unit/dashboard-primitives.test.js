'use strict';

require('../../admin/js/filters-store.js');
require('../../admin/js/components/UI.js');

describe('LOT 2A — dashboard primitives', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, '', '/admin/pilotage');
    window.KmcFilters.init({
      from: '2026-08-01',
      to: '2026-08-19',
      island: 'Anjouan',
      channel: 'cash_relais',
    });
  });

  describe('UIState', () => {
    it('réutilise les trois classes d’état existantes', () => {
      const loading = window.UIState.loadingState('Chargement test');
      const empty = window.UIState.emptyState('Vide test');
      const error = window.UIState.errorState('Erreur test');
      expect(loading.className).toBe('loading-state');
      expect(loading.querySelector('.loader')).not.toBeNull();
      expect(loading.textContent).toContain('Chargement test');
      expect(empty.className).toBe('empty-state');
      expect(empty.textContent).toBe('Vide test');
      expect(error.className).toBe('error-state');
      expect(error.textContent).toBe('Erreur test');
    });
  });

  describe('FilterBar', () => {
    it('rend seulement les filtres demandés, dans leur ordre', () => {
      const root = document.getElementById('root');
      window.FilterBar.render(root, ['to', 'island', 'channel']);
      const keys = [...root.querySelectorAll('[data-filter-key]')].map(el => el.dataset.filterKey);
      expect(keys).toEqual(['to', 'island', 'channel']);
      expect(root.querySelector('input[name="from"]')).toBeNull();
      expect(root.querySelector('input[name="to"]').value).toBe('2026-08-19');
      expect(root.querySelector('input[name="island"]').value).toBe('Anjouan');
    });

    it('écrit exclusivement via KmcFilters.set', () => {
      const root = document.getElementById('root');
      const spy = jest.spyOn(window.KmcFilters, 'set');
      window.FilterBar.render(root, ['island']);
      const input = root.querySelector('input[name="island"]');
      input.value = 'Moheli';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(spy).toHaveBeenCalledWith({ island: 'Moheli' });
      expect(window.KmcFilters.get().island).toBe('Moheli');
    });

    it('refuse une clé qui n’appartient pas à KmcFilters', () => {
      const root = document.getElementById('root');
      expect(() => window.FilterBar.render(root, ['country']))
        .toThrow(/filtre\(s\) inconnu\(s\): country/);
    });
  });

  describe('Section', () => {
    it('formalise page-section et son titre sans nouvelle classe CSS', () => {
      const content = document.createElement('p');
      content.textContent = 'Contenu';
      const built = window.Section.create({ title: 'Trajectoire', content });
      expect(built.element.tagName).toBe('SECTION');
      expect(built.element.className).toBe('page-section');
      expect(built.element.querySelector('.page-section-title').textContent).toBe('Trajectoire');
      expect(built.slot.contains(content)).toBe(true);
    });

    it('supporte un titre absent', () => {
      const built = window.Section.create({ content: 'Sans titre' });
      expect(built.element.querySelector('.page-section-title')).toBeNull();
      expect(built.slot.textContent).toBe('Sans titre');
    });

    it.each([
      ['loading', 'loading-state'],
      ['empty', 'empty-state'],
      ['error', 'error-state'],
    ])('rend l’état %s via UIState', (state, cls) => {
      const built = window.Section.create({ state, message: 'État test' });
      expect(built.slot.firstElementChild.className).toBe(cls);
      expect(built.slot.textContent).toContain('État test');
    });
  });
});
