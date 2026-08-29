# Boutique — Debt Zero / Modifiabilité

## Objectif

La cible n'est pas seulement « tous les gates verts ». Une modification visuelle doit avoir un chemin de décision court, explicite et vérifiable :

1. identifier le DOM réel ;
2. identifier l'owner canonique ;
3. modifier la source CSS owner ;
4. reconstruire le bundle canonique ;
5. vérifier la règle réellement gagnante ;
6. valider mobile et desktop ;
7. figer le gain dans les guards sans gonfler une allowlist.

## Principe directeur

**1 propriété visuelle = 1 owner identifiable = 1 chemin de modification = résultat prévisible.**

Une baseline est un cliquet anti-régression, pas une preuve d'absence de dette. Les entrées historiques doivent être classifiées en :

- dette réelle à supprimer ;
- override intentionnel à rendre explicite ;
- baseline périmée à réduire ;
- faux positif d'instrumentation à corriger.

## Lots

### B0 — Vérité instrumentée

- `gen-boutique-arch-live.js` consomme directement `scripts/css-bundles.js` ;
- zéro faux CSS orphelin ;
- documentation LIVE testable ;
- doctrine normative alignée sur l'état réel ;
- cartographie des baselines recalculée avant toute modification visuelle.

### B1 — Dette simple

- assets manquants ;
- `!important` ;
- hex/tokens et exceptions réelles ;
- dépendances/audit du workspace Boutique.

### B2 — Cascade

Classifier puis réduire les conflits de `css-guard` par famille fonctionnelle. Aucun « zéro » obtenu en acceptant en masse de nouvelles exceptions.

### B3 — Spécificité

Classifier puis réduire les overrides gagnants par spécificité globale (`html.k-*-premium-v1`, états body/html, etc.).

### B4 — Ownership fonctionnel

Pour chaque famille — hero, catégories/rails, catalogue/cards, modal/PDP, panier/side-cart, checkout, shared-list, identité — converger vers un owner canonique lisible et supprimer les chemins concurrents.

### B5 — Preuve de modifiabilité

Mettre en place une vérification simple permettant de répondre, pour un sélecteur/propriété donné :

- quelle source le définit ;
- dans quel bundle elle est livrée ;
- quelles règles concurrentes existent ;
- laquelle gagne selon contexte/breakpoint/spécificité.

## Non-objectifs

- aucune refonte visuelle arbitraire pendant la reprise ;
- aucune suppression aveugle de règle parce qu'elle apparaît dans une baseline ;
- aucune augmentation d'allowlist pour faire passer un gate ;
- aucun mélange avec le refactoring backend Sonnet.
