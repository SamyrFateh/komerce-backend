'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

// « Disponible ici » est une surface d'accueil (Tout) uniquement, sur mobile
// comme sur desktop. Le bump vertical (passage automatique à la catégorie
// suivante en bas de page) a été supprimé : aucune catégorie ne projette plus
// de rail local, quelle que soit la façon d'y entrer.
describe('Disponible ici — accueil Tout uniquement', () => {
  const discovery = source('js/discovery-rail.js');

  test('Tout conserve le rail natif mobile', () => {
    expect(discovery).toContain(
      '#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])'
    );
    expect(discovery).toContain("shell.dataset.discoveryEntry = 'home';");
  });

  test('mobile : une catégorie est toujours une surface catalogue pure', () => {
    expect(discovery).toContain("if (category !== 'all') {");
    expect(discovery).toContain('removeMobileShells();');
    expect(discovery).not.toMatch(/bump|Bump|PAGER_BUMP/);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'js', 'b-pager-end-bounce.js'))).toBe(false);
  });

  test('tap ou swipe horizontal retire tout rail hérité de Tout', () => {
    expect(discovery).toContain("bus.on('chip:center', handlePagerCategoryCentered);");
    expect(discovery).toContain('removeMobileShells();');
  });

  test('desktop reste strictement Tout uniquement', () => {
    expect(discovery).toContain("if (_activeDesktopCategory !== 'all') {");
    expect(discovery).toContain('removeDesktopShell();');
    expect(discovery).not.toContain(
      'cardsForCategory(_lastCards, _activeDesktopCategory)'
    );
  });
});
