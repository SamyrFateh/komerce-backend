'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/modal-desktop-scroll-owner.test.js
 *
 * Oracle RÉF-2026-07f — scroll owner unique desktop (supersede l'invariant
 * "double scroll" — cf. addendum de supersession daté 2026-07-25 dans ce
 * même fichier).
 *
 * Constat utilisateur : deux scrollbars visibles côte à côte sur la modale
 * desktop (.k-modal-main ET .k-modal-details scrollaient indépendamment),
 * la colonne détails scrollant en interne alors que la colonne image
 * laissait de l'espace visible en dessous d'elle. Contredit
 * PRODUCT_MODAL_REFERENCE_CANONICAL.md §9 : « un seul conteneur scrollable
 * par composition ».
 *
 * DÉCISION A — T-018-bis (audit desktop finition, 2026-07) : le dernier
 * test de ce fichier verrouillait littéralement `align-self:center` sur
 * .k-modal-img-wrap. Ce centrage recréait un vide artificiel au-dessus du
 * média dès qu'un récit produit long (fixture Stress) allongeait la ligne
 * de grille — 142px de vide constatés. La note qui avait introduit `center`
 * confondait position:sticky (comportement au SCROLL, retiré) et align-self
 * (alignement VERTICAL dans la grille, sans lien avec le sticky). L'oracle
 * a donc été mis à jour pour verrouiller `align-self:start` à la place :
 * ce fichier ET le bloc de règle owner (modal-media.css,
 * @media(min-width:900px) .k-modal-img-wrap) sont les deux points où cette
 * décision est consignée. Preuve : mesure Playwright live (top média = top
 * récit = 108px, diff:0 sur Stress), capture
 * desktop-stress-hero-alignment.png.
 *
 * .k-modal-product-zone et .k-modal-details ont chacun PLUSIEURS règles
 * desktop légitimes à différents breakpoints (900px, 1024px) portant des
 * propriétés différentes (min-height, align-self, grid-column...). Ce test
 * ne réécrit pas ces règles : il cible spécifiquement le bloc RÉF-2026-07f
 * (repéré par son commentaire, unique dans le fichier) pour vérifier que le
 * clamp dur (height/max-height fixe + overflow:hidden côté zone,
 * overflow-y:auto + max-height:100% côté details) a bien disparu de LÀ, et
 * vérifie sur l'ensemble des règles desktop qu'aucune n'a réintroduit ce
 * clamp ailleurs.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '../..');
const SHELL_CSS = path.join(ROOT, 'css/modal-shell.css');
const MEDIA_CSS = path.join(ROOT, 'css/modal-media.css');

const shell = fs.readFileSync(SHELL_CSS, 'utf8');
const media = fs.readFileSync(MEDIA_CSS, 'utf8');

const markerIdx = shell.indexOf('RÉF-2026-07f');
if (markerIdx === -1) {
  throw new Error('Marqueur RÉF-2026-07f introuvable dans modal-shell.css — le commentaire a-t-il été renommé/retiré ?');
}
// Le bloc RÉF-2026-07f couvre le commentaire + les 3 règles qu'il documente
// (.k-modal-product-zone, .k-modal-product-zone .k-modal-img-wrap,
// .k-modal-product-zone .k-modal-details) jusqu'à la règle .k-modal-actions
// qui suit (repère de fin stable, présent juste après dans le fichier).
const blockEndIdx = shell.indexOf('.k-modal-product-zone .k-modal-actions', markerIdx);
const ref07fBlock  = shell.slice(markerIdx, blockEndIdx);

describe('scroll owner unique desktop — oracle RÉF-2026-07f', () => {

  test('.k-modal-main reste l\'unique scroll owner desktop', () => {
    const mainRule = shell.match(/#k-modal \.k-modal-main\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(mainRule).toMatch(/overflow-y\s*:\s*auto/);
  });

  test('le bloc RÉF-2026-07f ne clampe plus .k-modal-product-zone (pas de height fixe, pas de overflow:hidden)', () => {
    const zoneRule = ref07fBlock.match(/#k-modal \.k-modal-product-zone\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(zoneRule).not.toMatch(/(?<![-\w])height\s*:/);
    expect(zoneRule).not.toMatch(/overflow\s*:\s*hidden/);
    expect(zoneRule).toMatch(/align-items\s*:\s*start/);
  });

  test('le bloc RÉF-2026-07f retire le scroll propre de .k-modal-details (plus de double scroll owner)', () => {
    const detailsRule = ref07fBlock.match(/#k-modal \.k-modal-product-zone \.k-modal-details\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(detailsRule).not.toMatch(/overflow-y\s*:\s*auto/);
    expect(detailsRule).not.toMatch(/(?<![-\w])height\s*:\s*100%/);
    expect(detailsRule).not.toMatch(/max-height\s*:\s*100%/);
  });

  test('aucune règle desktop de .k-modal-product-zone/.k-modal-details ne réintroduit le clamp dur ailleurs dans le fichier', () => {
    // Balaie TOUTES les occurrences desktop (≥900px) des deux sélecteurs et
    // vérifie qu'aucune ne combine à la fois une hauteur fixe/dvh ET un
    // overflow:hidden ou overflow-y:auto — signature du bug à double scroll.
    const desktopMarkerIdx = shell.indexOf('DESKTOP ≥900px');
    const desktopSplitIdx  = shell.indexOf('@media (min-width: 900px)', desktopMarkerIdx);
    const desktopSection   = shell.slice(desktopSplitIdx);
    const zoneRules = [...desktopSection.matchAll(/#k-modal \.k-modal-product-zone\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const detailsRules = [...desktopSection.matchAll(/#k-modal \.k-modal-product-zone \.k-modal-details\s*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const rule of zoneRules) {
      const hasHardHeight = /(?<![-\w])(?:height|max-height)\s*:\s*calc\(100dvh/.test(rule);
      const hasOverflowHidden = /overflow\s*:\s*hidden/.test(rule);
      expect(hasHardHeight && hasOverflowHidden).toBe(false);
    }
    for (const rule of detailsRules) {
      expect(rule).not.toMatch(/overflow-y\s*:\s*auto/);
    }
  });

  test('l\'image reste bornée indépendamment de la ligne de grille (modal-media.css, D6/T-018)', () => {
    const imgRule = media.match(/#k-modal \.k-modal-product-zone \.k-modal-img-wrap\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(imgRule).toMatch(/aspect-ratio\s*:\s*4\s*\/\s*3/);
    expect(imgRule).toMatch(/min-height\s*:\s*360px/);
    expect(imgRule).toMatch(/max-height\s*:\s*500px/);
    expect(imgRule).toMatch(/align-self\s*:\s*start/);
  });
});
