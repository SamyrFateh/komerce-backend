# Doctrine — Multi-source Shadow Proof

> Statut : gate de preuve avant toute bascule de lecture vers la projection canonique Source/Observation/Resolution.
> Dépendances : `DOCTRINE_SOURCE_OBSERVATION.md`, `DOCTRINE_SOURCE_RESOLUTION.md`.

## 1. But

Le shadow mode ne devient pas crédible parce que le code compile. Il doit prouver, sur des observations réelles, que plusieurs Sources indépendantes peuvent converger vers les mêmes identités canoniques sans confondre Resolution et Selection.

La preuve s'applique à toute source : API, CSV, saisie manuelle, ERP, marketplace ou autre adapter. Aucun fournisseur n'a de règle dédiée dans le gate.

## 2. Ce que la preuve mesure

Le rapport `multisource-shadow-proof-v1` expose au minimum :

- Sources effectivement observées et adapters distincts ;
- Captures et Observations Product / Offer / Unit ;
- Bindings actifs ;
- décisions LINK / REVIEW_REQUIRED / DISTINCT / MERGE / SPLIT ;
- nombre de Canonical Product observés depuis au moins deux Sources ;
- nombre maximal de Sources convergeant vers le même Canonical Product ;
- observations non bindées ;
- conflits d'identifiants déterministes à l'intérieur d'une même identité canonique ;
- éventuelle utilisation interdite d'un fait économique comme Evidence d'identité.

## 3. Hard failures

Deux situations rendent la preuve invalide :

1. une même identité canonique Product contient plusieurs valeurs contradictoires pour le même identifiant déterministe (`gtin`, `mpn`, etc.) ;
2. une Evidence d'identité utilise un fait économique tel que prix, stock, coût, fret, délai, marge ou devise.

Ces deux situations signifient que Resolution risque de fusionner des entités pour de mauvaises raisons.

## 4. Warnings

Le rapport reste en WARN, sans prétendre à une preuve multi-source suffisante, lorsque :

- moins de deux Sources ont réellement produit des Captures ;
- aucun Canonical Product n'a encore été observé depuis au moins deux Sources ;
- la file `REVIEW_REQUIRED` n'est pas vide ;
- des Observations Product restent non bindées.

Un WARN n'est pas une erreur d'intégrité. Il signifie simplement que la donnée observée n'est pas encore suffisante pour autoriser un essai de projection canonique.

## 5. Gate de projection Product

`ready_for_product_projection_trial = true` exige simultanément :

```text
aucun hard failure
AND au moins 2 Sources observées
AND au moins 1 Canonical Product multi-source
```

Ce gate n'autorise pas un cutover global. Il autorise seulement le chantier suivant : lecture Product canonique en projection contrôlée / comparaison de parité.

## 6. Ce que ce gate ne prouve pas

Il ne prouve pas :

- que la meilleure Offer est choisie ;
- que le prix final est correct ;
- que le stock fournisseur est frais ;
- que le fret est optimal ;
- qu'une Unit est exécutable maintenant ;
- qu'un `placeOrder` peut être ouvert.

Ces sujets appartiennent à Selection, preflight et Fulfillment.

## 7. N+1

Ajouter une nouvelle source ne doit nécessiter aucune modification du service de preuve. Si une nouvelle source produit les mêmes Observations et Evidence universelles, elle apparaît automatiquement dans le rapport.

Le test réel attendu est donc :

```text
AliExpress ─┐
CJ ─────────┼─> Observation -> Resolution -> Canonical Product
Allegro ────┤
Manual/CSV ─┘
```

sans branche `if provider === ...` dans Candidate Retrieval, Resolution ou le proof gate.

## 8. Autorité

Le rapport est strictement read-only et shadow. Il ne modifie ni :

- `sourcing_candidates` ;
- `products` / `product_skus` ;
- Supplier Order Identity ;
- publication ;
- Selection ;
- commande fournisseur.

Tant que le Product read cutover n'est pas explicitement ouvert par un chantier séparé, les autorités historiques restent inchangées.
