# Doctrine — Source Product Projection Trial

> Statut : essai contrôlé de lecture après preuve multi-source shadow.
> Dépendances : `DOCTRINE_SOURCE_RESOLUTION.md`, `DOCTRINE_SOURCE_SHADOW_PROOF.md`.

## 1. But

La preuve multi-source a démontré que plusieurs Sources indépendantes peuvent converger vers une même identité canonique Product. L'étape suivante consiste à vérifier qu'une **projection Product** peut être lue depuis `Observation + ResolutionBinding` sans modifier l'autorité catalogue historique.

Le trial est strictement :

```text
Observation Product immuable
        ↓
ResolutionBinding actif
        ↓
Canonical Product identity
        ↓
projection read-only
```

Aucune route de production ni aucun consumer catalogue n'est basculé par ce chantier.

## 2. Gate d'entrée

Le trial ne peut être considéré valide que si le rapport `multisource-shadow-proof-v1` donne :

```text
ready_for_product_projection_trial = true
```

Cela exige déjà :

- aucune contradiction d'identifiant déterministe ;
- aucune Evidence économique utilisée pour l'identité ;
- au moins deux Sources réellement observées ;
- au moins un Canonical Product observé depuis plusieurs Sources.

## 3. Product ne contient aucun fait économique

La projection Product peut porter des faits descriptifs :

- nom ;
- catégorie source ;
- marque ;
- description ;
- locale ;
- poids et dimensions ;
- médias ;
- axes d'options ;
- highlights ;
- spécifications ;
- sections ;
- matériaux ;
- entretien ;
- avertissements.

Elle ne doit jamais projeter au grain Product :

```text
purchase_price
currency
stock_available
min_order_qty
supplier_delay_days
sellable_units
supplier_order_identity
```

Ces faits appartiennent à Offer / Unit puis à Selection, preflight ou Fulfillment.

## 4. Politique V1 du trial : consensus only

Le premier trial ne choisit pas arbitrairement une Source gagnante.

Pour chaque champ descriptif :

```text
0 valeur          → ABSENT
1 valeur distincte → CONSENSUS
>1 valeurs         → CONFLICT_PRESERVED
```

En cas de conflit :

- `value = null` dans la projection résolue ;
- toutes les valeurs candidates et leur provenance Source restent visibles ;
- aucun `latest wins`, aucune priorité fournisseur et aucun choix économique ne sont appliqués silencieusement.

Une future `MergePolicy` versionnée pourra décider explicitement certains champs. Le trial V1 ne préjuge pas de cette politique.

## 5. Evidence d'identité

La projection expose les Evidence déjà extraites par Resolution afin de rendre l'identité explicable : GTIN, MPN, source refs, marque/modèle, etc.

Ces Evidence ne sont pas recalculées dans la projection. La projection consomme l'état produit par Resolution ; elle ne refait pas le matching.

## 6. Concurrence conservée

Une convergence Product ne fusionne pas les offres commerciales.

```text
Canonical Product P1
   ├─ Offer Source A
   └─ Offer Source B
```

Le trial Product s'arrête avant toute question de meilleur prix, meilleur stock, fret, délai ou fournisseur. **Resolution conserve la concurrence. Selection l'arbitrera plus tard.**

## 7. Critères de succès

Le rapport `canonical-product-projection-trial-report-v1` est PASS si :

- le gate multi-source est ouvert ;
- au moins une projection Product existe ;
- au moins une projection Product est réellement multi-source ;
- aucun champ économique n'a fui au Product ;
- aucun conflit n'a été écrasé silencieusement.

Un PASS autorise seulement le chantier suivant : **comparaison parallèle de lecture Product** avec les autorités historiques. Il n'autorise ni cutover global, ni publication, ni Selection, ni achat fournisseur.

## 8. Autorité

Pendant tout le trial :

- `products` / `product_skus` restent l'autorité catalogue historique ;
- `sourcing_candidates` reste l'autorité lifecycle sourcing historique ;
- la Supplier Order Identity historique reste l'autorité commandable ;
- la projection Source/Observation/Resolution est `shadow_read_only`.
