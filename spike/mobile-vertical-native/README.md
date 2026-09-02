# Spike — Mobile Vertical Native vs Pager Temu

> **STATUT : SPIKE ISOLÉ. Ne pas merger dans `main`. Ne modifie aucun fichier de production.**

## Objet

Comparer, sur une composition Boutique réelle (hero + catégories + Près de vous +
produits + un 2ᵉ bloc transversal), deux architectures mobiles :

- **A — Pager Temu** (baseline actuelle) : cage `position:fixed`, une page par
  catégorie, scroll vertical interne à chaque page, swipe horizontal pleine page.
- **B — Vertical natif** : un seul scroll owner (document), rail catégories
  `sticky`, catégories en sections successives, `scrollIntoView` + swipe sur le
  rail catégories, IntersectionObserver pour la catégorie active.

## Isolation

- Tout vit sous `spike/mobile-vertical-native/`.
- **Aucun** fichier de `public/boutique/` n'est modifié.
- Le harness est une page HTML standalone qui reproduit le DOM réel de la home
  et monte l'un OU l'autre shell selon le flag `?shell=`.
- Données mockées structurellement identiques aux cartes réelles
  (product / physical_offer / service + un bloc merchandising fictif).
- **Pas** de duplication métier : le spike teste le shell/scroll/navigation,
  pas le catalogue, pas les modales de prod, pas les services.

## Utilisation

Ouvrir `harness.html` dans un navigateur :

- `harness.html?shell=pager` → shell A (reproduction Temu simplifiée)
- `harness.html?shell=vertical` → shell B (vertical natif)
- défaut : `vertical`

Un bandeau haut affiche le shell actif + les métriques live
(scroll owner, catégorie active, position mémorisée).

## Ce que le spike mesure (voir METRICS.md après exécution)

- nombre de scroll owners
- nombre de mécanismes de synchronisation
- traitements spéciaux modale/catalogue
- classes structurelles nécessaires
- dépendances au shell dans les autres modules
- code réellement supprimable si B gagne
- invariants utilisateur : retour position, catégorie active au scroll,
  changement catégorie, pas de scroll horizontal parasite

## Ce que le spike NE fait PAS

- ne supprime pas `b-pager.js`, `b-scroll-owner.js`, ni les CSS Temu
- ne touche pas aux gates
- ne modifie aucune règle de gouvernance
- ne change pas le comportement par défaut de la Boutique de prod
