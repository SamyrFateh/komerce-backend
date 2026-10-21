/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../js/preload-css-swap.js'), 'utf8');

function run() {
  // eslint-disable-next-line no-new-func
  new Function(SRC)();
}

describe('preload-css-swap', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('sans lien k-components-preload : no-op', () => {
    expect(() => run()).not.toThrow();
  });

  test("bascule le lien en stylesheet sur l'évènement load", () => {
    document.body.innerHTML = '<link id="k-components-preload" rel="preload" as="style" href="/css/components.css">';
    run();
    const link = document.getElementById('k-components-preload');
    link.dispatchEvent(new Event('load'));
    expect(link.rel).toBe('stylesheet');
  });

  test('fail-open sur erreur', () => {
    document.body.innerHTML = '<link id="k-components-preload" rel="preload" as="style" href="/css/components.css">';
    run();
    const link = document.getElementById('k-components-preload');
    link.dispatchEvent(new Event('error'));
    expect(link.rel).toBe('stylesheet');
  });

  test('conforme au gate de qualité : use strict en tête, pas de var', () => {
    expect(SRC).toMatch(/^\/\*\*[\s\S]*?\*\/\s*'use strict';/);
    expect(SRC).not.toMatch(/\bvar\s/);
  });
});
