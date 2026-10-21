'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('preload-css-swap', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '<link id="k-components-preload" rel="preload" as="style" href="/css/components.css">';
  });

  test('bascule le preload en stylesheet au load', () => {
    require('../../js/preload-css-swap.js');
    const link = document.getElementById('k-components-preload');
    expect(link.rel).toBe('preload');
    link.dispatchEvent(new Event('load'));
    expect(link.rel).toBe('stylesheet');
  });

  test('fail-open sur error et sans lien : aucune exception', () => {
    require('../../js/preload-css-swap.js');
    const link = document.getElementById('k-components-preload');
    link.dispatchEvent(new Event('error'));
    expect(link.rel).toBe('stylesheet');
    document.head.innerHTML = '';
    jest.resetModules();
    expect(() => require('../../js/preload-css-swap.js')).not.toThrow();
  });
});
