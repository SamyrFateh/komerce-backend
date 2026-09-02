/**
 * dead-code-analysis.js — Analyse INVERSE de dette après Phase 2.
 *
 * Question : quand le shell vertical fonctionne dans la vraie Boutique
 * (sans monter le pager), quels mécanismes deviennent RÉELLEMENT morts ?
 *
 * Méthode : pour chaque mécanisme, on cherche s'il est encore appelé/référencé
 * par du code NON-pager (donc encore vivant même sans pager), ou s'il n'existe
 * QUE pour le pager (donc mort si le pager disparaît).
 *
 * Classes :
 *   DELETE               — n'existe que pour le pager, aucun autre appelant
 *   SIMPLIFY             — l'indirection peut redevenir un appel natif direct
 *   KEEP FOR OTHER FEATURE — utilisé aussi hors pager (desktop, cart, etc.)
 *
 * Aucune suppression : ce script CLASSIFIE, il ne modifie rien.
 * Usage : node spike/mobile-vertical-native/dead-code-analysis.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'public', 'boutique', 'js');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function jsFiles() {
  return fs.readdirSync(JS).filter(f => f.endsWith('.js') && !f.includes('.test.'));
}

// Cherche les appelants d'un symbole hors des fichiers pager eux-mêmes
function callersOutsidePager(symbol) {
  const pagerFiles = new Set(['b-pager.js', 'b-scroll-owner.js']);
  const callers = [];
  for (const f of jsFiles()) {
    if (pagerFiles.has(f)) continue;
    const c = read(path.join(JS, f));
    const re = new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (re.test(c)) callers.push(f);
  }
  return callers;
}

const MECHANISMS = [
  {
    name: 'b-pager.js (module entier : cage, ghost loop, bounce, recalc)',
    symbol: 'setupMobilePager|_setupInfiniteLoop|_setupSectionAutoAdvance',
    verdict: 'DELETE',
    reason: 'Le shell vertical ne monte jamais le pager. Ghost loop, bounce et '
          + 'recalc de cage n\'ont aucun sens sans pages horizontales. Aucun '
          + 'appelant hors b-catalog (qui, en vertical, ne l\'appelle plus).',
  },
  {
    name: 'CSS .k-pager-active + cage fixed + --pager-* vars',
    symbol: 'k-pager-active',
    verdict: 'DELETE',
    reason: 'La cage position:fixed n\'est posée que pour le pager. En vertical, '
          + '#k-page-scroll reste dans le flux document. Les vars --pager-top/-h/-w '
          + 'ne sont lues que par le CSS de cage.',
  },
  {
    name: 'b-modal-core : restauration styles inline pager + scrollLeft grid',
    symbol: '_savedPagerInlineStyles|_savedGridScrollLeft',
    verdict: 'DELETE',
    reason: 'Ces sauvegardes ne servent qu\'à restaurer la cage fixed et le '
          + 'scrollLeft horizontal du grid pager. En vertical, la position est '
          + 'window.scrollY natif — restauré par scrollToPosition standard.',
  },
  {
    name: 'b-scroll-owner : getMobileScrollContainer / getScrollY / scrollToPosition',
    symbol: 'getMobileScrollContainer|getScrollY|scrollToPosition',
    verdict: 'SIMPLIFY',
    reason: 'L\'indirection existe pour router entre cage et window. Sans pager, '
          + 'elle retourne TOUJOURS window. Elle peut redevenir des appels '
          + 'window.scrollY / window.scrollTo directs. Migration mécanique, pas '
          + 'suppression brutale : 11 modules à mettre à jour.',
  },
  {
    name: 'b-scroll-owner : ensureDesktopScrollOwner + guard rAF',
    symbol: 'ensureDesktopScrollOwner',
    verdict: 'DELETE',
    reason: 'Ne sert qu\'à nettoyer la cage pager quand on passe en desktop. '
          + 'Sans cage jamais posée, rien à nettoyer.',
  },
  {
    name: 'b-scroll-owner : clearInlinePagerStyles',
    symbol: 'clearInlinePagerStyles',
    verdict: 'DELETE',
    reason: 'Nettoie les styles inline de la cage. Mort sans cage.',
  },
  {
    name: 'b-scroll-owner : installScrollOwner (wheel redirect desktop)',
    symbol: 'installScrollOwner',
    verdict: 'KEEP FOR OTHER FEATURE',
    reason: 'Le wheel redirect desktop (molette dans #k-page-scroll → document) '
          + 'est indépendant du pager mobile. À conserver (ou déplacer dans un '
          + 'module desktop dédié).',
  },
];

function main() {
  console.log('\n=== ANALYSE INVERSE DE DETTE — Phase 2 ===\n');
  const rows = [];
  for (const m of MECHANISMS) {
    const symbols = m.symbol.split('|');
    let callers = new Set();
    for (const s of symbols) {
      callersOutsidePager(s).forEach(c => callers.add(c));
    }
    callers = [...callers];
    rows.push({ ...m, callers });
    console.log(`[${m.verdict}] ${m.name}`);
    console.log(`   appelants hors pager : ${callers.length ? callers.join(', ') : 'AUCUN'}`);
    console.log(`   → ${m.reason}`);
    console.log('');
  }

  const del = rows.filter(r => r.verdict === 'DELETE').length;
  const simp = rows.filter(r => r.verdict === 'SIMPLIFY').length;
  const keep = rows.filter(r => r.verdict === 'KEEP FOR OTHER FEATURE').length;
  console.log(`Résumé : ${del} DELETE · ${simp} SIMPLIFY · ${keep} KEEP FOR OTHER FEATURE`);
  console.log('\nNote : DELETE/SIMPLIFY ne sont exécutables qu\'APRÈS validation device');
  console.log('du swipe et réécriture des tests lock-impl vers les invariants.\n');

  // Écrire le rapport
  const md = `# Analyse inverse de dette — Phase 2

> Généré par \`dead-code-analysis.js\`. Classification par usage réel, aucune suppression.

Quand le shell vertical fonctionne sans monter le pager, voici ce qui devient
réellement mort (mesuré par recherche d'appelants hors fichiers pager) :

| Mécanisme | Verdict | Appelants hors pager |
|---|---|---|
${rows.map(r => `| ${r.name} | **${r.verdict}** | ${r.callers.length ? r.callers.join(', ') : 'AUCUN'} |`).join('\n')}

## Détail

${rows.map(r => `### ${r.verdict} — ${r.name}\n\n${r.reason}\n`).join('\n')}

## Synthèse

- **${del} mécanismes DELETE** : n'existent que pour le pager, aucun appelant hors pager.
- **${simp} mécanisme SIMPLIFY** : l'indirection scroll redevient des appels natifs (11 modules).
- **${keep} mécanisme KEEP** : le wheel redirect desktop survit (indépendant du pager mobile).

Aucune de ces actions n'est exécutée maintenant. Elles ne le seront qu'après :
1. validation device de la sensation swipe (Phase 1 harness) ;
2. réécriture des tests lock-impl (\`b-pager.test.js\`, \`b-scroll-owner.test.js\`)
   vers les invariants utilisateur ;
3. décision finale REPLACE / KEEP BUT SIMPLIFY.
`;
  fs.writeFileSync(path.join(__dirname, 'DEAD_CODE_ANALYSIS.md'), md);
  console.log('✔ DEAD_CODE_ANALYSIS.md généré');
}

main();
