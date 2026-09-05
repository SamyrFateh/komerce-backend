'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Disponible ici — surface Tout uniquement', () => {
  const discovery = source('js/discovery-rail.js');

  test('mobile ne monte Discovery que dans la page Tout', () => {
    expect(discovery).toContain(
      '#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])'
    );
    expect(discovery).not.toContain(
      '#k-grid > .k-cat-section[data-cat]:not([data-ghost])'
    );
  });

  test('desktop retire le rail dès qu un onglet catégorie est actif', () => {
    expect(discovery).toContain("if (_activeDesktopCategory !== 'all') {");
    expect(discovery).toContain('removeDesktopShell();');
    expect(discovery).not.toContain(
      'cardsForCategory(_lastCards, _activeDesktopCategory)'
    );
  });

  test('le contrat documente explicitement une surface accueil seulement', () => {
    expect(discovery).toContain('uniquement sur l\'accueil « Tout »');
    expect(discovery).toContain('n\'est jamais remonté dans les onglets catégorie');
  });
});
