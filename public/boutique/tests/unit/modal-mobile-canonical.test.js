'use strict';

const fs = require('fs');
const path = require('path');

describe('modal-mobile-canonical.css — responsabilités suggestions', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../css/modal-mobile-canonical.css'),
    'utf8'
  );

  test('ne possède plus les styles visuels du bouton suggestion', () => {
    expect(css).not.toMatch(/(^|\n)\s*#k-modal\s+\.k-sug-add(?:[:\s,{])/m);
  });

  test('conserve le layout vertical prix puis actions', () => {
    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-bottom\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*flex-start/s
    );

    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-price\s*\{[^}]*white-space:\s*nowrap/s
    );

    expect(css).toMatch(
      /#k-modal\s+\.k-sug-card-actions\s*\{[^}]*justify-content:\s*flex-start/s
    );
  });
});