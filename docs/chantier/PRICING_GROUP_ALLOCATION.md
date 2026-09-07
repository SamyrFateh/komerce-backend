# Chantier — Allocation gouvernée des pools N3 GROUP vers les marchés

> **Date** : 2026-09-07  
> **Statut** : implémentation du moteur d'allocation, avant gate de couverture  
> **Doctrine** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`, `DOCTRINE_REFACTURATION_RAILWAY.md`, `DOCTRINE_MUTUALISATION_HUB.md`

## Objet

Transformer un pool N3 `GROUP` déjà prouvé par `economic_structure_cost_events` en quotes-parts par `market_id`, sans inventer de clé de répartition et sans transformer la structure en coût article.

La chaîne devient :

```text
N3 réel de période GROUP
→ politique d'allocation explicite
→ assiette observée / fallback gouverné
→ conservation exacte du pool
→ quote-part N3 par marché
```

## Invariants

1. **Aucune politique implicite.** Le moteur ne choisit jamais entre mutualisation proportionnelle et socle + marginal.
2. **Politique datée et versionnée.** `version`, `source`, `evidence_ref`, `effective_from` et éventuellement `effective_to` sont obligatoires.
3. **Même fenêtre économique.** Une politique doit couvrir intégralement `[from,to)` ; sinon elle n'autorise rien.
4. **Une politique par charge GROUP.** Si une charge du pool n'a pas de politique couvrante, le total N3 du marché reste `NOT_DECISIONAL`.
5. **Aucune somme partielle promue en vérité.** Les allocations partielles peuvent être exposées pour diagnostic, jamais comme `market_n3_total_kmf` décisionnel.
6. **Conservation exacte.** L'arrondi utilise une distribution déterministe des centimes :

```text
Σ allocations marchés = pool GROUP reconnu sur la fenêtre
```

7. **`markets.is_active` n'est pas un diviseur économique.**
8. **Pas de coût article.** La quote-part GROUP reste N3 de période.

## Politiques supportées dans ce lot

### `PROPORTIONAL`

Répartition du pool selon l'assiette choisie.

### `BASE_PLUS_MARGINAL`

Une fraction explicite `base_pool_ratio` du pool est répartie également entre les marchés éligibles ; le reliquat est réparti selon l'assiette observée.

Le moteur n'invente jamais la valeur du socle : `base_pool_ratio` appartient à la politique de groupe.

## Assiettes supportées

### `PAID_ORDER_COUNT`

Première assiette réellement matérialisable sans inventer une mesure :

- `orders.market_id` ;
- `orders.created_at` dans la fenêtre canonique ;
- `payment_status = 'paid'` ;
- commandes annulées/remboursées exclues.

Deux modes d'éligibilité :

- `POSITIVE_BASIS` : seuls les marchés ayant une activité positive entrent dans l'assiette ;
- `EXPLICIT_MARKETS` : le périmètre des marchés est fourni par la politique gouvernée, puis l'activité observée sert au marginal.

### `EQUAL_ELIGIBLE`

Fallback volontaire uniquement :

- exige `EXPLICIT_MARKETS` ;
- exige `confidence = low` ;
- uniquement avec `PROPORTIONAL` ;
- ne devient jamais une preuve d'usage réel.

## États fail-closed

Le moteur refuse de produire un total N3 marché décisionnel si :

- la politique manque ;
- plusieurs politiques couvrent la même charge et la même fenêtre ;
- le marché explicite n'existe pas ;
- l'assiette est vide ou nulle ;
- le pool devient négatif ;
- la conservation échoue.

Dans ces cas :

```text
market_shared_n3_kmf = null
market_n3_total_kmf = null
market_n3_decisional = false
```

## Matérialisation actuelle

Ce lot matérialise **le moteur et son contrat**, sans créer encore de table de politiques ni de journal d'allocation.

Les politiques sont fournies comme données externes versionnées au service. Ce choix est volontaire : il permet de valider la sémantique et les invariants avant de figer le modèle de persistance.

La prochaine étape, avant le gate de couverture, est de matérialiser si nécessaire :

- le registre append-only des politiques d'allocation ;
- le snapshot des runs d'allocation utilisés pour une décision ;
- les assiettes physiques supplémentaires lorsqu'elles deviennent réellement mesurables (`m3_jours`, opérations Hub, usage plateforme direct, etc.).

Aucune de ces futures assiettes ne sera remplacée par un proxy silencieux.

## Non-objectifs de ce lot

- pas de refacturation partenaire ;
- pas de modification de `computePrices` ;
- pas de ratio `COVERED / UNCOVERED` ;
- pas de reclassification N1/N2/N3 ;
- pas de `market_id` ajouté à `charges` ;
- pas de nouveau coût par SKU.
