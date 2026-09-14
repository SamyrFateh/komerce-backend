# Doctrine Source / Capture / Observation / Evidence

## Statut

PR 1A pose uniquement le socle d'observation du sourcing. Il ne remplace aucun chemin de production.

- `sourcing_candidates` reste l'autorite du lifecycle candidat.
- `product_skus` + Supplier Order Identity restent l'autorite de l'identite fournisseur commandable.
- aucune table PR 1A n'est lue ou ecrite par un chemin runtime de production.
- la Resolution multi-source et la Selection sont explicitement hors perimetre de PR 1A.

## Frontiere canonique

```text
Source
  -> Capture
    -> Observation
      -> Evidence
```

### Source

Une Source est une instance concrete d'acquisition : compte, feed, canal, import ou integration.

Elle est distincte :

- du type d'adapter (`allegro`, `cj`, `manual`, `csv`, etc.) ;
- du principal commercial qui portera une offre ;
- de la readiness d'achat a l'instant T.

Les capabilities sont orthogonales :

- `acquisition`: `pull | push` ;
- `continuity`: `recurring | one_shot` ;
- `provides`: sous-ensemble de `catalog | offers | units` ;
- execution supportee : sous-ensemble de `human | api`.

Invariant : `api` supporte implique `units` disponible. L'inverse n'est pas requis : une unite peut etre deterministe alors que Komerce n'execute encore aucune commande contre elle.

La Source ne persiste aucune valeur d'authentification. `credential_ref` est uniquement un pointeur vers une couche d'infrastructure externe.

### Capture

Une Capture est un run ou lot d'acquisition d'une Source.

Exemples :

- une reponse API ;
- un fichier CSV ;
- une soumission manuelle ;
- un push ERP.

La Capture porte le lifecycle operationnel du run (`running`, `complete`, `partial`, `failed`). Elle n'est pas une verite produit.

Une Source recurrente produit de nouvelles Captures. On ne rafraichit jamais une Observation existante.

### Observation

Une Observation est l'etat observe d'une seule entite resolvable, a un grain donne (`product`, `offer`, `unit`), a un instant donne.

Invariants :

1. l'Observation est immuable ;
2. une re-observation produit une nouvelle ligne ;
3. `source_ref` est nullable et n'est jamais fabrique pour imiter une identite source ;
4. `principal_ref` est un fait brut de la source, pas encore un principal commercial canonique ;
5. `parent_observation_id` exprime uniquement une relation structurelle intra-Capture fournie par la source ; ce n'est jamais un binding canonique ;
6. `normalized` conserve des valeurs metier simples ; la provenance reste orthogonale dans `field_provenance` ;
7. `raw_fragment` est un snapshot structure fidele de l'entite observee, pas une promesse d'identite octet-pour-octet du transport d'origine.

L'Observation ne duplique pas `source_id` : sa Source est unique via sa Capture.

### Evidence

L'Evidence est derivee de `normalized` et sert au futur Candidate Retrieval / Resolution Engine.

Elle n'est pas autoritative et doit etre reconstructible lorsqu'un extracteur evolue.

Chaque evidence est namespaced par :

```text
evidence_type + evidence_key + value + extractor_version
```

Exemples :

- `deterministic_id / gtin / 123...` ;
- `deterministic_id / mpn / ABC-42` ;
- `lexical / brand_model / ...` ;
- `perceptual / phash / ...`.

Une meme evidence ne peut pas etre dupliquee pour une meme Observation et une meme version d'extracteur, afin d'eviter de gonfler artificiellement un futur score de resolution.

Ce qui aura reellement servi a une decision d'identite sera snapshotte plus tard dans la couche Resolution ; l'index d'Evidence PR 1A reste recalculable.

## Frontieres explicites

PR 1A ne fait aucune de ces operations :

- comparer deux Observations ;
- decider qu'elles representent le meme produit/offre/unite ;
- creer un produit canonique ;
- choisir une offre fournisseur ;
- publier un produit ;
- calculer une readiness d'achat ;
- creer une Supplier Order Identity ;
- passer une commande fournisseur.

La premiere operation qui compare plusieurs Observations appartient a la future couche **Resolution**.

La future couche **Selection** restera separee : Resolution repond « est-ce la meme chose ? », Selection repond « chez qui acheter maintenant ? ».

## Migration progressive

PR 1A est un socle inerte. La suite prevue est additive :

1. PR 1A — Source / Capture / Observation / Evidence ;
2. PR 1B — identites canoniques + decisions/bindings/constraints de Resolution ;
3. PR 2 — shadow ingestion `NormalizedSupplierProduct V2 -> Capture/Observations` ;
4. PR 3 — Candidate Retrieval + Resolution en shadow et test N+1 ;
5. bascules d'autorite seulement apres parite prouvee.

Aucun retrait de l'ancien chemin n'est autorise avant la preuve shadow.
