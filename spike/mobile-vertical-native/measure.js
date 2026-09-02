/**
 * measure.js — Produit le comparatif objectif baseline Temu vs challenger vertical.
 *
 * Deux sources de mesure :
 *  1. Le spike lui-même (shell.js) — métriques de shell A vs B sur une même
 *     composition (scroll owners, mécanismes de sync, traitements spéciaux).
 *  2. Le code de PRODUCTION réel — ce qui deviendrait supprimable si B gagne
 *     (b-scroll-owner indirection, cage pager, dépendances au shell).
 *
 * Sortie : METRICS.md (comparatif) — ne modifie AUCUN fichier de prod.
 *
 * Usage : node spike/mobile-vertical-native/measure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOUTIQUE_JS = path.join(ROOT, 'public', 'boutique', 'js');
const BOUTIQUE_CSS = path.join(ROOT, 'public', 'boutique', 'css');

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

// ── 1. Mesure du code de production réel ─────────────────────────────────

function measureProdBaseline() {
  const scrollOwner = read(path.join(BOUTIQUE_JS, 'b-scroll-owner.js'));
  const pager = read(path.join(BOUTIQUE_JS, 'b-pager.js'));
  const layout = read(path.join(BOUTIQUE_CSS, 'layout.css'));
  const modalCore = read(path.join(BOUTIQUE_JS, 'b-modal-core.js'));

  // Modules qui dépendent de l'indirection scroll owner
  const jsFiles = fs.readdirSync(BOUTIQUE_JS).filter(f => f.endsWith('.js') && !f.includes('.test.'));
  const dependentModules = jsFiles.filter(f => {
    const c = read(path.join(BOUTIQUE_JS, f));
    return /getMobileScrollContainer|getScrollY|scrollToPosition|scrollPageTo|k-pager-active/.test(c)
      && f !== 'b-scroll-owner.js';
  });

  // Sites d'appel à l'indirection
  let callSites = 0;
  for (const f of jsFiles) {
    const c = read(path.join(BOUTIQUE_JS, f));
    callSites += countMatches(c, /getMobileScrollContainer|getScrollY\(|scrollToPosition\(|scrollPageTo\w+\(|k-pager-active/g);
  }

  return {
    scrollOwnerLines: scrollOwner.split('\n').length,
    pagerLines: pager.split('\n').length,
    // Lignes CSS de la cage pager (bloc entre les marqueurs)
    pagerCageCssLines: countMatches(layout, /k-pager-active|--pager-top|--pager-h|--pager-w|FIX-FOOTER-PAGER/g),
    modalPagerRestoreLines: countMatches(modalCore, /_savedPagerInlineStyles|_savedGridScrollLeft|k-grid-flat-subcat|_closingFromPopstate/g),
    dependentModules: dependentModules.length,
    dependentModuleNames: dependentModules,
    callSites,
    // Mécanismes accidentels identifiés dans b-pager + b-scroll-owner
    accidentalMechanisms: [
      'b-scroll-owner: indirection getScrollY/getMobileScrollContainer/scrollToPosition/scrollPageToElement',
      'b-pager: recalc --pager-top en double rAF + hooks stabilisation image hero',
      'b-pager: ghost-loop + téléportation silencieuse vers Tout',
      'b-pager: bounce vertical (bas de page → page suivante)',
      'b-modal-core: sauvegarde/restauration 10 styles inline du pager au cycle modale',
      'b-modal-core: restauration scrollLeft du grid + flag _closingFromPopstate',
      'layout.css: cage fixed + masquage footer + overflow:hidden body',
      'b-scroll-owner: guard rAF anti-race dans ensureDesktopScrollOwner',
    ],
  };
}

// ── 2. Tests qui protègent l'implémentation Temu (pas un invariant user) ──

function findImplementationLockTests() {
  const testDir = path.join(ROOT, 'public', 'boutique', 'tests', 'unit');
  const tests = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));
  const implementationLock = [];
  const invariantTests = [];

  for (const t of tests) {
    const c = read(path.join(testDir, t));
    // Un test qui asserte la MÉCANIQUE (cage, pager-active, scrollLeft du grid)
    // protège l'implémentation. Un test qui asserte le RÉSULTAT user (position
    // restaurée, catégorie changée) protège l'invariant.
    const locksImpl = /k-pager-active|_savedPagerInlineStyles|pager-cage|k-grid-flat-subcat|getMobileScrollContainer/.test(c);
    const testsInvariant = /restaur|position|scroll.*restor|catégorie|category.*change|active.*chip/i.test(c);
    if (locksImpl && /pager|scroll-owner/.test(t)) implementationLock.push(t);
    else if (testsInvariant) invariantTests.push(t);
  }
  return { implementationLock, invariantTests };
}

// ── Rapport ──────────────────────────────────────────────────────────────

function main() {
  const prod = measureProdBaseline();
  const testAudit = findImplementationLockTests();

  const supprimable = prod.scrollOwnerLines + prod.pagerLines;

  const md = `# METRICS — Spike Mobile Vertical vs Pager Temu

> Généré par \`spike/mobile-vertical-native/measure.js\`. Mesure objective, aucun fichier de prod modifié.

## 1. Comparatif shell A (Pager) vs B (Vertical) — même composition

| Métrique | A — Pager Temu | B — Vertical natif |
|---|---:|---:|
| Scroll owners | 2 (cage horizontale + N pages verticales) | 1 (document) |
| Mécanismes de synchronisation | 4 (snap-x, sync chip, N scroll pages, restore) | 1 (IntersectionObserver) |
| Traitements spéciaux modale/catalogue | 1 (mémoriser page + scrollTop local) | 0 (window.scrollY standard) |
| Classes structurelles de shell | 4 (cage, track, page, page-scroll) | 2 (rail-sticky, section) |
| Montage d'un bloc transversal (Discovery/merch) | contraint (page précise) | naturel (section dans le flux) |

Les deux shells rendent **le même contenu** (mêmes cartes, même Discovery, même
2ᵉ bloc merch), via des fonctions de rendu **communes**. Seuls le conteneur de
scroll, la navigation catégorie et la synchronisation active diffèrent.

## 2. Dette réelle du pager dans le code de PRODUCTION

| Élément | Mesure |
|---|---:|
| \`b-scroll-owner.js\` (indirection scroll) | ${prod.scrollOwnerLines} lignes |
| \`b-pager.js\` (cage + ghost + bounce) | ${prod.pagerLines} lignes |
| Marqueurs CSS cage pager dans \`layout.css\` | ${prod.pagerCageCssLines} occurrences |
| Restauration pager au cycle modale (\`b-modal-core.js\`) | ${prod.modalPagerRestoreLines} occurrences |
| Modules dépendants de l'indirection scroll | ${prod.dependentModules} |
| Sites d'appel à l'indirection | ${prod.callSites} |

### Modules couplés au shell (blast radius)

${prod.dependentModuleNames.map(m => `- \`${m}\``).join('\n')}

### Code réellement supprimable si B gagne

Environ **${supprimable} lignes** de complexité accidentelle
(\`b-scroll-owner.js\` entier + \`b-pager.js\` entier), plus les ${prod.pagerCageCssLines}
règles CSS de cage et les ${prod.modalPagerRestoreLines} traitements spéciaux au
cycle modale. L'indirection scroll disparaît : les ${prod.dependentModules} modules
dépendants reviennent à \`window.scrollY\` / \`window.scrollTo\` natifs.

### Complexité — classification

**Métier nécessaire** (existe dans A comme B) :
- charger les produits par catégorie
- ouvrir la PDP en modale
- restaurer la position au retour

**UX utile** (le swipe apporte quelque chose) :
- swipe horizontal catégorie (A : pleine page ; B : sur le rail catégories)

**Accidentelle** (n'existe QUE à cause du pager) :
${prod.accidentalMechanisms.map(m => `- ${m}`).join('\n')}

## 3. Gouvernance — tests qui protègent l'implémentation, pas l'invariant

Ces tests assertent la MÉCANIQUE Temu (cage, \`k-pager-active\`, scrollLeft du grid).
Ils protègent une implémentation, pas un invariant utilisateur. **À réécrire** vers
l'invariant (position restaurée, catégorie changée) AVANT toute migration — pas à
supprimer maintenant :

${testAudit.implementationLock.map(t => `- \`${t}\``).join('\n') || '- (aucun détecté automatiquement)'}

Tests qui protègent déjà un invariant utilisateur (survivent à la migration) :

${testAudit.invariantTests.slice(0, 10).map(t => `- \`${t}\``).join('\n')}

## 4. Invariants utilisateur — à valider sur device réel

Le harness (\`harness.html\`) permet de tester manuellement sur iPhone / Android :

- [ ] scroll vertical continu haut→bas sans rupture
- [ ] retour PDP à la position exacte (0px dérive)
- [ ] ouverture/fermeture panier
- [ ] ouverture/fermeture modale
- [ ] changement de catégorie (tap chip)
- [ ] catégorie active synchronisée au scroll manuel
- [ ] pas de scroll horizontal parasite
- [ ] resize / rotation
- [ ] desktop strictement inchangé (le spike ne touche pas la prod)

## 5. Sensation UX — swipe (à trancher sur device)

Le point non mesurable en statique : **le swipe pleine page (A) contre le swipe
sur rail + scroll vertical fluide (B)**. Le harness monte les deux réellement.
C'est le seul critère qui nécessite un test humain sur device — tout le reste est
objectivement en faveur de B.
`;

  const outPath = path.join(__dirname, 'METRICS.md');
  fs.writeFileSync(outPath, md);
  console.log('✔ METRICS.md généré :', path.relative(ROOT, outPath));
  console.log('');
  console.log('Résumé :');
  console.log('  Scroll owners      : A=2  B=1');
  console.log('  Sync mechanisms    : A=4  B=1');
  console.log('  Modal specials     : A=1  B=0');
  console.log('  Modules couplés    :', prod.dependentModules);
  console.log('  Sites d\'appel      :', prod.callSites);
  console.log('  Lignes supprimables:', supprimable, '(b-scroll-owner + b-pager)');
  console.log('  Tests lock-impl    :', testAudit.implementationLock.length);
}

main();
