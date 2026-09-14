# Doctrine — Catalog Product Read Cutover Trial

> Statut : essai contrôlé après `canonical-product-read-comparison-v1 = PASS`.
> Dépendances : `DOCTRINE_SOURCE_PRODUCT_PROJECTION_TRIAL.md`, `DOCTRINE_SOURCE_PRODUCT_READ_COMPARISON.md`.

## 1. But

Le Product canonique a désormais démontré qu'il peut être projeté et comparé sans mismatch avec un produit catalogue relié. Le prochain pas n'est pas un cutover public : c'est une **seam de lecture interne, réversible et mesurée**.

Le trial V1 lit simultanément :

```text
Canonical Product projection
        +
legacy products row
        ↓
controlled read seam
        ↓
internal hybrid row
```

Aucune route `/api/products` n'est modifiée dans ce chantier.

## 2. Périmètre V1

Le V1 ne remplace que des champs de cuisine source déjà cachés de la Boutique :

```text
product_name  -> name_source
description   -> description_source
source_locale -> source_locale
```

Un champ n'est remplacé que si la projection canonique vaut `CONSENSUS`.

En cas de :

```text
CONFLICT_PRESERVED -> fallback legacy explicite
ABSENT             -> fallback legacy explicite
```

Aucun conflit n'est résolu silencieusement.

## 3. Champs protégés

Le trial interdit toute modification du contrat public ou de l'économie catalogue. Restent strictement legacy dans ce V1 :

- `name`, `description`, catégories et sous-catégories éditoriales ;
- prix et promotions ;
- stock et disponibilité ;
- médias publics ;
- exposition / activation ;
- variants / inventory model ;
- identifiants et références produit ;
- poids public et dimensions publiques tant qu'une politique dédiée n'est pas validée.

La projection Product ne devient donc jamais une source de prix, stock, Offer, Unit ou Supplier Order Identity.

## 4. Invariant public

Le V1 construit une ligne hybride interne puis compare :

```text
toPublicProduct(legacy)
        ==
toPublicProduct(hybrid)
```

Toute différence est un `FAIL`.

Le trial doit également vérifier que tous les champs protégés sont identiques avant/après seam.

## 5. Linkage

Un produit legacy ne peut participer au trial que si le lien vers le Canonical Product est déjà prouvé par la chaîne existante :

```text
sourcing_candidate.product_id
        ↓
Capture/import provenance
        ↓
Observation Product
        ↓
active ResolutionBinding
        ↓
Canonical Product
```

Aucun matching additionnel n'est autorisé dans le cutover trial.

Si un même `products.id` aboutit à plusieurs Canonical Products actifs, le trial échoue avec ambiguïté ; il ne choisit jamais arbitrairement.

## 6. Verdicts

`PASS` signifie :

- au moins un produit catalogue possède un lien canonique prouvé ;
- aucun lien ambigu n'existe ;
- aucun champ protégé n'a changé ;
- le contrat public reste strictement identique ;
- les conflits et absences canoniques produisent un fallback legacy explicite.

`safe_fallback_proven = true` prouve que la seam peut être traversée sans changer la lecture publique.

`ready_for_route_canary = true` exige en plus qu'au moins un champ source ait réellement été lu depuis un consensus canonique. Sans cela, le système a prouvé le fallback mais pas encore un vrai remplacement de lecture.

## 7. Ce que ce PASS n'autorise pas

Même avec `ready_for_route_canary = true`, ce trial n'autorise pas :

- un cutover global de `/api/products` ;
- la publication d'un produit ;
- la migration d'Offer/Unit ;
- Selection fournisseur ;
- achat fournisseur.

Il autorise seulement un prochain canary de route ou de consumer, explicitement gated et immédiatement réversible.
