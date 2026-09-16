# Catalogue — vérité métier du dashboard

> Décision produit — 2026-09-16

Le dashboard Catalogue expose uniquement quatre statuts métier :

`Sourcé → Prêt à publier → Publié → Visible`

La complexité technique (`normalized`, `scanned`, `LOCAL_ACTIVE`, SOI, adapters,
preflight fournisseur, etc.) reste dans les contrats backend, les logs et les
drill-downs. Elle ne devient pas le vocabulaire principal de pilotage.

## Sourcé

Komerce connaît le candidat source ou le produit relié à cette source. Ce statut ne
promet ni publication ni vente.

## Prêt à publier

La fiche passe le **vrai garde de première publication** (`product-publication-guard`).
Le dashboard ne reconstruit pas une approximation de ce garde.

## Publié

Le produit appartient au catalogue global Komerce (`products.is_active = TRUE`).
Publié ne signifie ni exposé dans un marché ni visible dans une boutique.

## Visible

Visible est une vérité commerciale **par marché**. Un produit n'est Visible que
s'il passe exactement le même prédicat que la boutique publique pour ce marché :

- produit actif et disponible ;
- média public réel ;
- au moins une unité statiquement vendable ;
- aucun SKU actif/en stock exposé comme AVAILABLE avec identité fournisseur
  incomplète ;
- exposition commerciale `ENABLED` sur le marché ;
- prix `LOCAL_ACTIVE` sur ce même marché.

Pour un SKU fournisseur, l'identité statique minimale inclut `supplier_sku`,
`supplier_unit_ref` et une `supplier_order_identity` avec `provider`, `version` et
`payload` non vide.

**Visible ne remplace pas le preflight du checkout.** Stock fournisseur, prix,
fret, disponibilité du provider et autres faits dynamiques sont revalidés au
moment de l'achat. Cette revalidation est une sécurité transactionnelle, pas un
cinquième statut du dashboard.

## Navigation

Catalogue conserve deux rubriques : `Vue catalogue | Produits`.

- Sources → `Opérations > Sourcing` ;
- Raffinerie → détail technique/drill-down ;
- Catalogue pays → `Marchés` ;
- Boutique → conséquence du statut Visible, pas un dashboard parallèle ;
- Analyse → absent tant qu'aucune surface métier distincte ne le justifie.

Invariant d'interface : **une information métier possède un seul endroit de
référence ; un autre écran peut y conduire, mais ne la recalcule pas sous un autre
nom.**
