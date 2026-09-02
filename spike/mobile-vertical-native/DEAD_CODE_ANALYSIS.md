# Analyse inverse de dette — Phase 2

> Généré par `dead-code-analysis.js`. Classification par usage réel, aucune suppression.

Quand le shell vertical fonctionne sans monter le pager, voici ce qui devient
réellement mort (mesuré par recherche d'appelants hors fichiers pager) :

| Mécanisme | Verdict | Appelants hors pager |
|---|---|---|
| b-pager.js (module entier : cage, ghost loop, bounce, recalc) | **DELETE** | b-catalog.js, b-nav.js, b-subcat.js, boutique.js |
| CSS .k-pager-active + cage fixed + --pager-* vars | **DELETE** | b-cart.js, b-catalog.js, b-modal-core.js, b-nav.js, hero-bootstrap.js, spike-vertical-shell.js |
| b-modal-core : restauration styles inline pager + scrollLeft grid | **DELETE** | b-modal-core.js |
| b-scroll-owner : getMobileScrollContainer / getScrollY / scrollToPosition | **SIMPLIFY** | b-catalog.js, b-cart.js, b-catalog-desktop-enhancers.js, b-checkout.js, b-desktop-upgrade.js, b-modal-core.js, hero-bootstrap.js, spike-vertical-shell.js |
| b-scroll-owner : ensureDesktopScrollOwner + guard rAF | **DELETE** | b-catalog.js |
| b-scroll-owner : clearInlinePagerStyles | **DELETE** | b-catalog.js |
| b-scroll-owner : installScrollOwner (wheel redirect desktop) | **KEEP FOR OTHER FEATURE** | boutique.js |

## Détail

### DELETE — b-pager.js (module entier : cage, ghost loop, bounce, recalc)

Le shell vertical ne monte jamais le pager. Ghost loop, bounce et recalc de cage n'ont aucun sens sans pages horizontales. Aucun appelant hors b-catalog (qui, en vertical, ne l'appelle plus).

### DELETE — CSS .k-pager-active + cage fixed + --pager-* vars

La cage position:fixed n'est posée que pour le pager. En vertical, #k-page-scroll reste dans le flux document. Les vars --pager-top/-h/-w ne sont lues que par le CSS de cage.

### DELETE — b-modal-core : restauration styles inline pager + scrollLeft grid

Ces sauvegardes ne servent qu'à restaurer la cage fixed et le scrollLeft horizontal du grid pager. En vertical, la position est window.scrollY natif — restauré par scrollToPosition standard.

### SIMPLIFY — b-scroll-owner : getMobileScrollContainer / getScrollY / scrollToPosition

L'indirection existe pour router entre cage et window. Sans pager, elle retourne TOUJOURS window. Elle peut redevenir des appels window.scrollY / window.scrollTo directs. Migration mécanique, pas suppression brutale : 11 modules à mettre à jour.

### DELETE — b-scroll-owner : ensureDesktopScrollOwner + guard rAF

Ne sert qu'à nettoyer la cage pager quand on passe en desktop. Sans cage jamais posée, rien à nettoyer.

### DELETE — b-scroll-owner : clearInlinePagerStyles

Nettoie les styles inline de la cage. Mort sans cage.

### KEEP FOR OTHER FEATURE — b-scroll-owner : installScrollOwner (wheel redirect desktop)

Le wheel redirect desktop (molette dans #k-page-scroll → document) est indépendant du pager mobile. À conserver (ou déplacer dans un module desktop dédié).


## Synthèse

- **5 mécanismes DELETE** : n'existent que pour le pager, aucun appelant hors pager.
- **1 mécanisme SIMPLIFY** : l'indirection scroll redevient des appels natifs (11 modules).
- **1 mécanisme KEEP** : le wheel redirect desktop survit (indépendant du pager mobile).

Aucune de ces actions n'est exécutée maintenant. Elles ne le seront qu'après :
1. validation device de la sensation swipe (Phase 1 harness) ;
2. réécriture des tests lock-impl (`b-pager.test.js`, `b-scroll-owner.test.js`)
   vers les invariants utilisateur ;
3. décision finale REPLACE / KEEP BUT SIMPLIFY.
