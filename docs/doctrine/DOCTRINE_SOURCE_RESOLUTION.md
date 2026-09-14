# Doctrine — Source Resolution

> Statut : canonique pour la couche de résolution multi-source.
> Introduite par PR 1B / migration 227.
> Dépendance : `docs/doctrine/DOCTRINE_SOURCE_OBSERVATION.md`.

## 1. Frontière canonique

La chaîne est désormais séparée en cinq responsabilités :

```text
Source
  ↓
Capture
  ↓
Observation immutable
  ↓
Candidate Retrieval
  ↓
Resolution
  ↓
Canonical identity / materialized projection
  ↓
Selection
  ↓
Order / Fulfillment
```

La frontière est stricte :

- **Ingestion** s'arrête lorsqu'une Observation immuable est persistée.
- **Candidate Retrieval** réduit l'espace de comparaison ; il ne décide jamais de l'identité.
- **Resolution** répond uniquement : « est-ce la même chose ? ».
- **Selection** répond plus tard : « quelle offre utiliser maintenant ? ».

**Resolution conserve la concurrence. Selection arbitre la concurrence.**

## 2. Une identité canonique n'est pas une observation

Une Observation décrit ce qui a été vu à un instant donné. Une identité canonique représente ce que Komerce estime être la même entité logique au fil des observations.

Le supertype `sourcing_canonical_entities` porte trois grains :

```text
Product
  ↓
Offer
  ↓
Unit
```

Le graphe est structurel :

- Product n'a pas de parent ;
- Offer appartient à exactement un Product ;
- Unit appartient à exactement une Offer.

Les IDs canoniques sont stables et ne sont jamais recyclés. Un merge ne supprime pas l'ancien ID : il le passe `superseded` et conserve `superseded_by`.

En PR 1B, ces IDs sont **shadow** : ils ne remplacent ni `products.id`, ni `product_skus.id`, ni la Supplier Order Identity.

## 3. Commercial principal ≠ source ≠ émetteur d'identifiant

Trois notions doivent rester séparées :

```text
adapter/provider type
    ex. allegro, cj, manual

source instance
    ex. compte/feed/import concret

commercial principal
    vendeur/fournisseur réel portant l'offre
```

Une marketplace peut émettre un identifiant technique d'offre au nom d'un vendeur. L'identifiant externe est donc namespacé par la Source :

```text
(source_id, ref_kind, ref_value)
```

et non par le commercial principal.

Un même commercial principal peut être observé depuis plusieurs sources via `sourcing_source_principal_refs`.

## 4. Candidate Retrieval ≠ Resolution

Candidate Retrieval peut utiliser :

- GTIN / MPN / source refs ;
- marque + modèle ;
- recherche lexicale ;
- attributs discriminants ;
- hash perceptuel / similarité image ;
- tout nouveau genre universel d'évidence ajouté une seule fois au moteur.

Il répond seulement :

> « Quelles identités valent la peine d'être comparées ? »

Le fait qu'un candidat soit retourné n'est jamais une preuve de match.

## 5. MatchProposal n'est pas une vérité

Un `MatchProposal` matérialise l'évaluation d'une Observation contre une identité candidate.

Il conserve séparément :

```text
support_score
contradiction_score
coverage_score
```

Il n'existe pas de score opaque unique promu silencieusement en vérité.

Le snapshot d'évidence utilisé est conservé afin que la proposition reste explicable même si l'index d'Evidence reconstructible évolue ensuite.

Les propositions sont append-only.

## 6. ResolutionDecision est souveraine

Les décisions autorisées sont :

```text
LINK
DISTINCT
REVIEW_REQUIRED
MERGE
SPLIT
```

Une décision conserve :

- le grain ;
- la proposition éventuelle ;
- l'Observation ou les identités concernées ;
- l'acteur ;
- la justification ;
- le snapshot d'évidence.

Les décisions sont append-only.

Un modèle ou une règle peut proposer. Une décision explicite établit la vérité de résolution.

## 7. Binding est une projection, pas l'audit souverain

`ResolutionBinding` matérialise la liaison courante :

```text
Observation → Canonical Entity
```

Il peut être clôturé puis remplacé à la suite d'une nouvelle décision.

L'historique et la justification restent dans `ResolutionDecision`. Le Binding existe pour les lectures et les FK efficaces, pas pour réécrire l'histoire.

Une Observation ne peut avoir qu'un Binding actif à la fois.

Le grain Observation et le grain Canonical Entity doivent toujours correspondre.

## 8. MUST_LINK / CANNOT_LINK

Une revue humaine ou une décision suffisamment forte doit pouvoir produire une connaissance durable :

```text
MUST_LINK
CANNOT_LINK
```

`CANNOT_LINK` empêche le moteur de reproposer indéfiniment un merge déjà examiné comme faux.

Une paire ne peut pas avoir simultanément deux contraintes actives contradictoires.

La contrainte courante est une projection révocable par une nouvelle décision auditée ; la décision historique n'est jamais supprimée.

## 9. Merge / Split et lifecycle des IDs

Un merge ne réécrit pas les références historiques.

```text
P17 ACTIVE
P82 ACTIVE
   ↓ MERGE
P17 ACTIVE
P82 SUPERSEDED → P17
```

Un split est également une nouvelle décision. Un ancien ID n'est jamais recyclé implicitement : toute réactivation ou création d'identité doit être décidée explicitement.

## 10. MergePolicy est grain-scoped

La politique de projection de champs est distincte du matching d'identité.

Elle est paramétrée par :

```text
grain + field_key
```

Stratégies génériques initiales :

- `prefer_high_confidence` ;
- `latest_observation` ;
- `source_priority` ;
- `require_review` ;
- `preserve_distinct`.

La récence ne compare jamais les offres concurrentes entre fournisseurs.

Exemple correct :

```text
Offer CJ à t1
Offer CJ à t2
→ t2 peut devenir l'état courant de CETTE offre
```

Exemple interdit :

```text
AliExpress 12 €
CJ 10 €
→ « CJ gagne » dans Resolution
```

Les deux offres coexistent. Le choix du meilleur prix, stock, fret, délai ou niveau de confiance appartient exclusivement à **Selection**.

## 11. Commandable identity ≠ execution readiness

Une Unit peut être déterministe et commandable conceptuellement alors que Komerce ne peut pas encore exécuter l'achat.

```text
supplier_unit_ref exact
        ≠
placeOrder autorisé maintenant
```

La capacité `api|human` d'une Source n'est pas la readiness transactionnelle d'une Unit. La readiness appartient au preflight / fulfillment, pas à Resolution.

## 12. Invariant N+1

Ajouter une nouvelle source doit nécessiter seulement :

```text
Source Adapter
capabilities
mapping → Observation
mapping → taxonomie d'Evidence existante
```

et zéro modification spécifique fournisseur de :

- l'API de Candidate Retrieval ;
- l'algorithme de Resolution ;
- les schémas canoniques ;
- les MergePolicies existantes ;
- le futur Selection Engine.

Si une source révèle un nouveau genre **universel** d'évidence ou de retrieval, le moteur peut être enrichi une seule fois de façon générique.

## 13. Test ultime

Le même produit logique injecté par plusieurs voies :

```text
API
CSV
saisie humaine
photo WhatsApp + texte
ERP push
```

peut produire des Observations de qualité différente, mais la Resolution ne doit jamais brancher sur le type de source.

La Raffinerie et le moteur de Resolution ne doivent pas contenir de branche métier `if provider === ...` pour établir l'identité.

## 14. Autorité pendant la migration

PR 1B est uniquement un socle shadow.

Restent autoritatifs :

- `sourcing_candidates` pour le lifecycle sourcing actuel ;
- `products` / `product_skus` pour le catalogue actuel ;
- `supplier_order_identity` pour l'identité fournisseur commandable actuelle.

PR 1B n'ajoute :

- aucun writer runtime ;
- aucun dual-write ;
- aucune lecture production ;
- aucun backfill ;
- aucune sélection d'offre ;
- aucune commande fournisseur.

La bascule d'autorité ne pourra intervenir qu'après shadow mode, preuve de parité, audit et gate explicite.
