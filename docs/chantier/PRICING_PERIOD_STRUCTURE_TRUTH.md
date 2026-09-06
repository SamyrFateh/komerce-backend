# Pricing — vérité N3 économique de période

> Statut : lot technique après adoption de `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3.
> Objet : matérialiser le réel de structure avant toute mutualisation ou couverture marché.

## 1. Finding de départ

Le code historique calcule N3 à partir de `charges` puis le divise par `finance_config.objectif_commandes_mois` et `avg_articles_per_order` pour obtenir une quote-part CDR article.

Cette mécanique reste utile comme **référence / simulation**, mais elle ne constitue pas une vérité de période :

- `charges.amount_kmf` est une configuration de charge ;
- plusieurs seeds portent explicitement des estimations initiales ;
- `objectif_commandes_mois` est un objectif commercial ;
- aucune preuve externe de facture, contrat ou décaissement économique n'est attachée à la ligne `charges` ;
- la table `charges` ne porte pas la frontière groupe / marché.

Conclusion : il est interdit de brancher directement `charges` sur le futur ratio de couverture.

## 2. Décision de ce lot

Créer une couche séparée :

```text
charges = configuration / catalogue de structure

economic_structure_cost_events = faits économiques de période append-only
```

Aucun writer automatique ne copie `charges.amount_kmf` dans la table de faits.

## 3. Deux périmètres seulement dans ce lot

### GROUP

Coût réel de structure partagé au niveau groupe : Railway, plateforme commune, Hub fixe mutualisable, etc.

`market_id = NULL`.

Le coût reste dans un pool groupe **non alloué**.

### MARKET_DIRECT

Coût réel de structure directement attribuable à un marché sans clé de prorata : contrat local, loyer local dédié, charge pays exclusivement causée par ce marché, etc.

`market_id` obligatoire.

Ce lot ne transforme jamais un coût GROUP en MARKET_DIRECT.

## 4. Corrections append-only

La vérité historique n'est jamais éditée.

- `ACCRUAL` : fait positif initial ;
- `ADJUSTMENT` : correction positive ou négative ;
- `REVERSAL` : annulation négative ;
- ADJUSTMENT / REVERSAL référencent obligatoirement `adjusts_event_id` ;
- UPDATE et DELETE sont bloqués par trigger DB.

## 5. Monnaie et preuve

Chaque fait conserve :

- montant d'origine ;
- devise ;
- taux vers KMF ;
- source du taux ;
- montant KMF ;
- type de source ;
- `evidence_ref` ;
- auteur ;
- période économique `[economic_from, economic_to)`.

L'application vérifie la cohérence `amount_original × fx_rate_to_kmf ≈ amount_kmf`.

## 6. Lecture sur une fenêtre

Un événement couvrant une période plus large que la fenêtre demandée est reconnu au prorata exact de son chevauchement temporel.

Ce prorata n'est pas une clé de mutualisation : il rattache simplement un coût de période à la portion de période interrogée.

## 7. Fail-closed marché

Pour un marché :

```text
N3 direct marché = somme des MARKET_DIRECT reconnus
pool groupe = somme des GROUP reconnus
```

Si `pool groupe != 0` :

```text
status = NOT_DECISIONAL_SHARED_ALLOCATION_PENDING
market_n3_decisional = false
```

Aucune division égale, aucune règle `markets.is_active`, aucun poids, aucune commande cible et aucun fallback implicite ne sont utilisés.

La prochaine étape sera un moteur de mutualisation gouverné qui respecte l'invariant :

```text
Σ allocations marchés = pool groupe de la même fenêtre
```

## 8. Hors périmètre

Ce lot ne :

- change pas `computePrices` ;
- change pas le CDR historique ;
- modifie pas `charges` ;
- ajoute pas `market_id` à `charges` ;
- décide pas d'une clé de mutualisation ;
- calcule pas le ratio de couverture ;
- crée pas de refacturation partenaire ;
- expose pas encore de route admin de saisie.

## 9. Séquencement

```text
N2/N3 snapshot
→ maturité/watermark
→ dispositions gouvernées
→ doctrine V1.3
→ CE LOT : vérité N3 de période
→ allocation GROUP vers marchés
→ couverture marché
→ ancrage marché
→ migration contrôlée de la décision de prix
```
