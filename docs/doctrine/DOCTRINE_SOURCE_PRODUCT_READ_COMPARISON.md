# Doctrine — Parallel Product Read Comparison

> Statut : gate read-only entre la projection Product canonique shadow et l'autorité catalogue historique.
> Dépendance : `DOCTRINE_SOURCE_PRODUCT_PROJECTION_TRIAL.md`.

## 1. But

Une projection canonique qui produit un JSON crédible n'est pas encore une preuve de cutover. Avant toute bascule de lecture, Komerce doit comparer la nouvelle lecture Product avec les autorités historiques réellement reliées au même flux de sourcing.

Le rail est strictement :

```text
Observation Product
   ↓
ResolutionBinding
   ↓
Canonical Product projection (shadow)
   ↓
linkage historique via import_id + supplier_product_id
   ├─ sourcing_candidate
   └─ products si le candidat a déjà été promu
   ↓
comparaison read-only
```

## 2. Linkage, jamais deviné

Le lien entre une Observation et son candidat historique est reconstruit uniquement à partir de faits persistés :

- `sourcing_captures.stats.import_id` ;
- `sourcing_observations.source_ref` ;
- `sourcing_candidates.import_id` ;
- `sourcing_candidates.supplier_product_id`.

Aucun matching lexical, aucun SKU deviné et aucun rapprochement par nom n'est autorisé pour fabriquer une parité historique.

Le lien catalogue existe seulement lorsque le candidat porte un `product_id` réel.

## 3. Absence de produit historique

`catalog_product_links = 0` n'est pas un échec de la projection. C'est un **BLOCKED** honnête pour le gate de cutover : il n'existe simplement encore aucun `products` relié sur lequel mesurer la parité.

Le système ne doit alors ni inventer une ligne `products`, ni traiter `sourcing_candidates` comme si elle était l'autorité catalogue finale.

## 4. Champs comparables

Le trial compare seulement des champs dont la sémantique reste compatible entre projection Product et brouillon catalogue historique :

- `product_name` ↔ `products.name_source` (fallback `name`) ;
- `description` ↔ `products.description_source` ;
- `source_locale` ↔ `products.source_locale` ;
- `weight_kg` ↔ `products.weight_kg`.

`products.category` n'est pas comparé à `supplier_category` : l'un est une décision/mapping Komerce, l'autre un fait source. Les confondre créerait une fausse parité.

Aucun prix, coût, stock, devise ou autre fait économique n'entre dans cette comparaison Product.

## 5. Conflits multi-source

La projection canonique V1 est `consensus_only` :

- `CONSENSUS` + même valeur historique → `PARITY` ;
- `CONSENSUS` + autre valeur → `MISMATCH` ;
- `CONFLICT_PRESERVED` + valeur historique appartenant au jeu des valeurs sources → `SOURCE_VARIANT_ACCEPTED` ;
- `CONFLICT_PRESERVED` + valeur historique extérieure au jeu → `MISMATCH_OUTSIDE_CONFLICT_SET` ;
- `ABSENT` → `NO_CANONICAL_VALUE`.

Un ancien produit peut donc légitimement refléter une seule Source lorsque la nouvelle projection préserve explicitement un conflit. La comparaison ne transforme pas ce conflit en choix canonique.

## 6. Verdicts

Le rapport `canonical-product-read-comparison-v1` retourne :

### BLOCKED

Aucun `product_id` historique relié. Le rail Source/Observation/Resolution peut être sain, mais la parité catalogue n'est pas encore mesurable.

### FAIL

Au moins l'un de ces invariants est violé :

- une Observation Product canonique ne retrouve pas son `sourcing_candidate` historique alors que son capture/import doit le permettre ;
- un produit catalogue historiquement relié contient une valeur incompatible avec le consensus ou extérieure à un conflit préservé.

### PASS

- linkage candidat complet ;
- au moins un vrai produit catalogue relié ;
- au moins une comparaison exécutée ;
- zéro mismatch.

`PASS` rend `ready_for_catalog_product_read_cutover_trial=true`.

## 7. Ce que PASS n'autorise toujours pas

Même après PASS :

- aucune route publique n'est basculée automatiquement ;
- aucun Product économique n'est créé dans la projection ;
- aucune Offer n'est sélectionnée ;
- aucune publication Market n'est faite ;
- aucune commande fournisseur n'est ouverte.

Le chantier suivant doit être un cutover contrôlé et réversible, séparé.

## 8. Autorité

Cette couche est `shadow_read_only`. `products` / `product_skus` restent l'autorité historique jusqu'à une décision explicite de cutover.
