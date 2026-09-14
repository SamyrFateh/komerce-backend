# Doctrine — Canonical Product / Offer / Unit

## Définitions

- **Product** : identité de la chose — « qu'est-ce que c'est ? »
- **Offer** : proposition commerciale d'un principal/fournisseur pour exactement un Product.
- **Unit** : variante fournisseur exacte d'une Offer.

`Resolution = same thing?`  
`Selection = where buy now?`  
`Purchasing = order the selected exact Unit`

Resolution conserve la concurrence. Selection, absente de ce lot, arbitrera plus tard.

## Hiérarchie et cardinalité

Un Product peut avoir plusieurs Offers. Une Offer appartient à exactement un Product. Une Unit appartient à exactement une Offer.

Deux vendeurs ou deux Offers avec des prix/stocks différents ne sont pas un conflit. Deux Offers ne sont jamais fusionnées uniquement parce qu'elles ont le même Product. Deux Units ne sont jamais fusionnées sur un label humain comme « Black / M ».

## Source, adapter et principal

`adapter/provider type != Source instance != commercial principal`.

Toute référence externe conserve le namespace de sa Source : `(source_id, ref_kind, ref_value)`. Une source technique n'est pas nécessairement le vendeur économique.

## Identité et état

L'identité d'une Offer repose sur son Product parent, son principal quand il est résolu et ses références externes namespacées. L'identité d'une Unit repose sur son Offer parent et ses références déterministes fournisseur.

Prix, stock, disponibilité, devise, MOQ, délai et freight sont des états temporels. Leur changement ne crée ni nouveau Product, ni nouvelle Offer, ni nouvelle Unit.

Les Observations sont immuables. La projection courante sélectionne l'Observation la plus récente de la même identité et conserve toute sa provenance.

## Autorité des grains

Product ne porte aucun fait économique fournisseur.

Offer porte les conditions commerciales et leur fraîcheur : principal, référence produit/offre, devise, prix d'achat, stock/disponibilité, MOQ, délai et freight lorsque disponibles.

Unit porte l'identité exacte de variante, ses attributs, refs fournisseur et la candidate Supplier Order Identity.

## Commandabilité

`capability != readiness now`.

Une Unit déterministe peut rester non prête : SOI absente, stock nul, unité inactive, fournisseur indisponible, prix stale ou freight absent. Cette projection ne déclare jamais `ready_now=true`; le preflight Purchasing reste l'autorité de readiness.

## Mode shadow

Ce lot est strictement read-only. Il ne modifie ni Catalog, ni Supplier Order Identity historique, ni Purchasing. Il n'effectue aucune Selection, publication, commande fournisseur ou `placeOrder`.

La comparaison avec `product_skus` est un rapport de parité uniquement. Le legacy reste autoritatif.
