'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * SPIKE Phase 2 — prouve que le flag est strictement no-op par défaut
 * et n'active le shell vertical QUE sous ?shell=vertical.
 */

describe('spike-vertical-shell flag', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function setSearch(search) {
    // jsdom supporte history.replaceState → met à jour window.location.search
    window.history.replaceState({}, '', '/' + (search || ''));
  }

  it('isVerticalShell() = false par défaut (aucun flag)', () => {
    setSearch('');
    const { isVerticalShell } = require('../../js/spike-vertical-shell.js');
    expect(isVerticalShell()).toBe(false);
  });

  it('isVerticalShell() = false avec ?shell=pager', () => {
    setSearch('?shell=pager');
    const { isVerticalShell } = require('../../js/spike-vertical-shell.js');
    expect(isVerticalShell()).toBe(false);
  });

  it('isVerticalShell() = true avec ?shell=vertical', () => {
    setSearch('?shell=vertical');
    const { isVerticalShell } = require('../../js/spike-vertical-shell.js');
    expect(isVerticalShell()).toBe(true);
  });

  it('initVerticalShellSpike() est no-op sans flag (ne touche pas le body)', () => {
    setSearch('');
    const { initVerticalShellSpike } = require('../../js/spike-vertical-shell.js');
    document.body.className = '';
    initVerticalShellSpike(null);
    expect(document.body.classList.contains('spike-shell-vertical')).toBe(false);
    expect(document.getElementById('spike-vertical-css')).toBeNull();
  });

  it('installVerticalNavigation() est no-op sans flag', () => {
    setSearch('');
    const { installVerticalNavigation } = require('../../js/spike-vertical-shell.js');
    // Ne doit pas lever ni installer d'observer
    expect(() => installVerticalNavigation()).not.toThrow();
  });

  it('spikeSnapshot() rapporte window/document comme owner en mode vertical', () => {
    setSearch('?shell=vertical');
    const { spikeSnapshot } = require('../../js/spike-vertical-shell.js');
    const snap = spikeSnapshot();
    expect(snap.shell).toBe('vertical');
    // Sans k-pager-active, l'owner est window/document
    expect(snap.scrollOwner).toBe('window/document');
  });
});
