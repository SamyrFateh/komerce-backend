/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          boutique-header-compact-tests
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/header-compact-desktop.test.js
 * @purpose       G-05 — entre 900 et 1199px (borne canonique 1200, cf.
 *                check-breakpoints.js), les 4 boutons texte du header
 *                (Mon Komerce, Mes Favoris, Mes Commandes, Mes Partages)
 *                passent en icône seule (40x40) pour supprimer le
 *                débordement horizontal de .k-header-actions. Le CTA
 *                « Suivre ma commande » (.k-header-nav-btn hors
 *                .k-header-actions) reste inchangé.
 * @impact-areas  boutique-header, responsive, overflow-x
 * @version       2026-09
 */
'use strict';

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../../css/layout.css');
const css = fs.readFileSync(cssPath, 'utf8');

describe('header compact desktop (G-05, 900–1199px)', () => {
  test('media query scopée 900–1199px présente (borne canonique 1200)', () => {
    expect(css).toContain('@media (min-width: 900px) and (max-width: 1199px)');
  });

  test('sélecteur scopé .k-header-actions .k-header-nav-btn passe en icône 40x40', () => {
    expect(css).toMatch(/@media \(min-width: 900px\) and \(max-width: 1199px\)[\s\S]*\.k-header-actions \.k-header-nav-btn \{[\s\S]*flex: 0 0 40px;/);
    expect(css).toMatch(/\.k-header-actions \.k-header-nav-btn \{[\s\S]*width: 40px;[\s\S]*height: 40px;/);
  });

  test('les libellés texte sont masqués dans ce media, pas le badge/icône', () => {
    expect(css).toMatch(/@media \(min-width: 900px\) and \(max-width: 1199px\)[\s\S]*\.k-header-actions \.k-header-nav-btn > span:not\(\.k-komerce-nav-icon, \.k-header-group-badge\),\s*\n\s*\.k-header-actions \.k-header-nav-btn \.k-komerce-nav-label \{\s*\n\s*display: none;/);
  });

  test('ne touche pas le CTA "Suivre ma commande" (sélecteur non scopé .k-header-nav-btn > span)', () => {
    const g05Block = css.slice(css.indexOf('@media (min-width: 900px) and (max-width: 1199px)'));
    expect(g05Block).not.toMatch(/(?<!\.k-header-actions )\.k-header-nav-btn > span \{/);
  });

  test('n’introduit pas de !important', () => {
    const g05Start = css.indexOf('/* G-05');
    expect(g05Start).toBeGreaterThan(-1);
    expect(css.slice(g05Start)).not.toContain('!important');
  });

  test('P-01 : >= 1200 px, le bloc d\'actions ne se comprime pas sous ses boutons', () => {
    expect(css).toMatch(/@media \(min-width: 1200px\) \{\s*\.k-header-actions \{ flex: 0 0 auto; \}/);
  });
});
