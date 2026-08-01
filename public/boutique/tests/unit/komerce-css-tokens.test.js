/**
 * @komerce-arch-lite
 * @role          account-style-contract-tests
 * @domain        account
 * @layer         test
 * @status        production
 * @owner         public/boutique/js/b-komerce.js
 * @purpose       Verrouille l'usage des tokens sémantiques pour l'action danger de Mon Komerce.
 * @impact-areas  account, boutique-css-governance
 * @version       2026-08-lot6
 */
'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', '..', 'css', 'komerce.css');

function dangerRule(css) {
  const match = css.match(/\.k-kmc-action-btn--danger\s*\{([\s\S]*?)\}/);
  return match ? match[1] : null;
}

describe('Mon Komerce — contrat CSS danger', () => {
  it('utilise exclusivement les tokens danger sémantiques', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const rule = dangerRule(css);

    expect(rule).not.toBeNull();
    expect(rule).toContain('color: var(--red-danger-text)');
    expect(rule).toContain('border: 1.5px solid var(--red-danger-border)');
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
