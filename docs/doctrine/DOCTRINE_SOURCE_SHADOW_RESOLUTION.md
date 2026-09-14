# Doctrine — Shadow Resolution v1

> Statut : migration shadow. Complète `DOCTRINE_SOURCE_RESOLUTION.md` sans modifier l'autorité de production.

## But

PR 3 transforme les Observations immuables en une preuve exploitable de résolution multi-source :

```text
Observation
  ↓
Evidence rebuildable
  ↓
Candidate Retrieval
  ↓
MatchProposal
  ↓
ResolutionDecision
  ↓
Canonical Product / Offer / Unit shadow
```

Candidate Retrieval maximise le rappel. Resolution reste la seule couche qui décide si deux observations décrivent la même identité.

## Evidence v1

Le moteur ne connaît aucun fournisseur. Il extrait uniquement des catégories universelles :

- référence source, toujours namespacée par l'instance de Source ;
- identifiants déterministes `gtin` et `mpn` ;
- marque, modèle, `brand_model`, nom produit et catégorie ;
- signature d'options d'une Unit.

Prix, stock, fret, délai, devise et readiness transactionnelle sont exclus de l'identité.

## Routage conservateur

Une proposition n'est jamais une vérité. Les routes automatiques v1 sont bornées :

- exact `source_ref` dans la même Source, sans contradiction déterministe : `LINK` ;
- GTIN exact entre Sources, sans contradiction : `LINK` ;
- Offer déjà connue sous le même Canonical Product et la même Source : `LINK` ;
- plusieurs candidats forts ou preuve insuffisante : `REVIEW_REQUIRED` ;
- aucun candidat : allocation d'un nouvel ID canonique puis `LINK` audité.

MPN + marque ou similarité lexicale peuvent rappeler un candidat mais ne suffisent pas seuls à lier automatiquement en v1.

## Hiérarchie

Product est résolu avant Offer, Offer avant Unit. Un enfant sans parent canonique résolu est différé ; aucune identité enfant n'est fabriquée hors hiérarchie.

Les offres concurrentes de Sources différentes restent distinctes. La résolution ne choisit jamais un meilleur prix ou un meilleur fournisseur.

## Audit et rejouabilité

Chaque exécution versionne séparément :

- l'extracteur d'Evidence ;
- le matcher ;
- le resolver.

`MatchProposal` conserve support / contradiction / coverage et un snapshot d'évidence. `ResolutionDecision` reste l'audit souverain. `ResolutionBinding` n'est que la projection courante.

Une nouvelle version du resolver peut réexaminer les cas `REVIEW_REQUIRED` sans réécrire les décisions historiques.

## Autorité

Pendant PR 3 :

- `sourcing_candidates` reste l'autorité du lifecycle sourcing existant ;
- `products` / `product_skus` restent le catalogue canonique de production ;
- Supplier Order Identity reste l'identité commandable ;
- aucune Selection, publication, exposition ou commande fournisseur ne lit la résolution shadow.

La bascule d'autorité exige une preuve de parité séparée.