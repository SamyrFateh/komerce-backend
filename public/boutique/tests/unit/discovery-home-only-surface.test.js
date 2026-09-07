'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Disponible ici — accueil + entrée mobile par bump', () => {
  const discovery = source('js/discovery-rail.js');
  const bounce = source('js/b-pager-end-bounce.js');

  test('Tout conserve le rail natif mobile', () => {
    expect(discovery).toContain(
      '#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])'
    );
    expect(discovery).toContain("shell.dataset.discoveryEntry = 'home';");
  });

  test('le bump vertical porte explicitement son contexte vers Discovery', () => {
    expect(bounce).toContain("const PAGER_BUMP_EVENT = 'komerce:pager-bump';");
    expect(bounce).toContain('emitPagerBump(page, nextPage);');
    expect(discovery).toContain("window.addEventListener(PAGER_BUMP_EVENT, handlePagerBump);");
    expect(discovery).toContain('mountMobileBumpRail(category);');
    expect(discovery).toContain('cardsForCategory(_lastCards, category)');
  });

  test('tap ou swipe horizontal retire la projection de bump', () => {
    expect(discovery).toContain("bus.on('chip:center', handlePagerCategoryCentered);");
    expect(discovery).toContain('if (_pendingBumpCategory === category) {');
    expect(discovery).toContain('_activeMobileBumpCategory = null;');
    expect(discovery).toContain('removeMobileBumpShells();');
  });

  test('desktop reste strictement Tout uniquement', () => {
    expect(discovery).toContain("if (_activeDesktopCategory !== 'all') {");
    expect(discovery).toContain('removeDesktopShell();');
    expect(discovery).not.toContain(
      'cardsForCategory(_lastCards, _activeDesktopCategory)'
    );
  });
});
