'use strict';
require('../../dashboards/admin/js/filters-store.js');

describe('KmcFilters (filters-store)', () => {
  beforeEach(() => {
    window.KmcFilters.init();
  });

  it('init() crée un état par défaut', () => {
    const state = window.KmcFilters.get();
    expect(state).toBeDefined();
    expect(typeof state).toBe('object');
  });

  it('FILTER_KEYS est un tableau non vide', () => {
    expect(Array.isArray(window.KmcFilters.FILTER_KEYS)).toBe(true);
    expect(window.KmcFilters.FILTER_KEYS.length).toBeGreaterThan(0);
  });

  it('set + get cohérent', () => {
    // Utiliser un filtre connu qui accepte une string
    window.KmcFilters.set({ island: 'Moheli' });
    const state = window.KmcFilters.get();
    expect(state.island).toBe('Moheli');
  });

  it('reset remet à zéro', () => {
    const key = window.KmcFilters.FILTER_KEYS[0];
    window.KmcFilters.set({ [key]: 'something' });
    window.KmcFilters.reset();
    const state = window.KmcFilters.get();
    expect(state[key]).toBeFalsy();
  });

  it('subscribe notifie', () => {
    const handler = jest.fn();
    window.KmcFilters.subscribe(handler);
    const key = window.KmcFilters.FILTER_KEYS[0];
    window.KmcFilters.set({ [key]: 'changed' });
    expect(handler).toHaveBeenCalled();
  });
});
