'use strict';

/**
 * tests/unit/modal-topbar-mobile.test.js
 *
 * Oracle §6.1 — topbar mobile full-bleed.
 *
 * Vérifie statiquement que le CSS source respecte les trois invariants
 * de la topbar mobile canonique :
 *   1. position:absolute (topbar flotte sur le hero, pas de bande opaque)
 *   2. background transparent/voile (pas de fond crème solid)
 *   3. CTA (k-modal-actions) fixed/sticky en bas — via position:fixed
 *      (reparenting JS → position:static via #k-modal > .k-modal-actions)
 *
 * Lecture CSS statique — même pattern que modal-layout-invariant.test.js.
 * Ne dépend d'aucun mock DOM.
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '../..');
const SHELL_CSS  = path.join(ROOT, 'css/modal-shell.css');
const MOBILE_CSS = path.join(ROOT, 'css/modal-mobile-canonical.css');

const shell  = fs.readFileSync(SHELL_CSS,  'utf8');
const mobile = fs.readFileSync(MOBILE_CSS, 'utf8');

describe('topbar mobile full-bleed — oracle §6.1', () => {

  test('k-modal-topbar a position:absolute sur mobile (base rule)', () => {
    // La règle de base (mobile) doit déclarer position:absolute.
    // La règle ≥900px la réécrit en position:relative — ce test porte sur la base.
    const baseBlock = shell.slice(0, shell.indexOf('@media'));
    expect(baseBlock).toMatch(/\.k-modal-topbar\s*\{[^}]*position\s*:\s*absolute/);
  });

  test("k-modal-topbar n'a pas de background opaque sur mobile (base rule)", () => {
    // La topbar mobile doit être transparente ou semi-transparente (rgba).
    // background:var(--surface-sand-96) serait une bande opaque — interdit.
    const baseBlock = shell.slice(0, shell.indexOf('@media'));
    const topbarRule = baseBlock.match(/\.k-modal-topbar\s*\{([^}]*)\}/)?.[1] ?? '';
    // Ne doit pas contenir de variable de surface solide crème
    expect(topbarRule).not.toMatch(/var\(--surface-sand/);
  });

  test('k-modal a position:relative (contexte de positionnement pour topbar absolue)', () => {
    const baseBlock = shell.slice(0, shell.indexOf('@media'));
    expect(baseBlock).toMatch(/\.k-modal\s*\{[^}]*position\s*:\s*relative/);
  });

  test('desktop override remet position:relative sur k-modal-topbar (non-régression)', () => {
    // La règle ≥900px doit réinitialiser en position:relative pour le desktop.
    const desktopSection = shell.slice(shell.indexOf('@media (min-width: 900px)'));
    expect(desktopSection).toMatch(/k-modal-topbar[^}]*position\s*:\s*relative/);
  });

  test('CTA k-modal-actions est fixed en bas sur mobile (fallback avant reparenting JS)', () => {
    // Le CTA doit être accessible même si le JS de reparenting n'a pas encore tourné.
    expect(shell).toMatch(/\.k-modal-actions\s*\{[^}]*position\s*:\s*fixed/);
    expect(shell).toMatch(/\.k-modal-actions[^}]*bottom\s*:\s*0/);
  });

  test('reparenting JS (#k-modal > .k-modal-actions) bascule en position:static', () => {
    // Après reparenting, la CTA est dans le flex de #k-modal — position statique.
    expect(shell).toMatch(/#k-modal\s*>\s*\.k-modal-actions\s*\{[^}]*position\s*:\s*static/);
  });
});
