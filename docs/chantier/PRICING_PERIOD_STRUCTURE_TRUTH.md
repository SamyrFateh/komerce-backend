# Pricing — vérité N3 économique de période

> Statut : lot technique après adoption de `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md` V1.3.
> Objet : matérialiser le réel de structure avant toute mutualisation ou couverture marché.

## 1. Finding de départ

Le code historique calcule N3 à partir de `charges` puis le divise par `finance_config.objectif_commandes_mois` et `avg_articles_per_order` pour obtenir une quote-part CDR article.

Cette mécanique reste utile comme **référence / simulation**, mais elle ne constitue pas une vérité de période :

- `charges.amount_kmf` est une configuration de charge ;
- plusieurs seeds portent explicitement des estimations initiales ;
- `objectif_commandes_mois` est un objectif commercial ;
- aucune preuve externe de facture, contrat ou charge économique constatée n'est attachée à la ligne `charges` ;
- la table `charges` ne porte pas la frontière groupe / marché.

Conclusion : il est interdit de brancher directement `charges` sur le futur ratio de couverture.

## 2. Décision de ce lot

Créer une couche séparée :

```text
charges = configuration / catalogue de structure

economic_structure_cost_events = faits économiques de période append-only
```

Aucun writer automatique ne copie `charges.amount_kmf` dans la table de faits.

## 3. N3 est un mécanisme large, pas une liste de cas particuliers

N3 couvre toute charge de structure économiquement rattachable à une période, notamment :

- Railway et plateforme technique ;
- Cloudinary / SaaS fixe / abonnements ;
- Hub physique fixe : loyer, personnel, capacité réservée ;
- **relais fixes périodiques** : forfait mensuel de présence, loyer du point, minimum garanti, personnel fixe local, abonnement ou autre coût non causé par une transaction précise ;
- personnel et fonctions support ;
- comptabilité, banque fixe, administration ;
- tout futur poste de structure qui ne relève ni de N1 ni de N2.

Le moteur ne porte **aucun enum fermé de familles N3**. La famille et le nom viennent du catalogue `charges` et sont snapshotés sur le fait économique afin qu'une modification ultérieure du catalogue ne réécrive jamais l'histoire.

Une charge relais n'est donc pas automatiquement variable :

```text
commission relais par commande / retrait réellement causée par le flux → N1/N2 selon doctrine existante
forfait relais mensuel / loyer / minimum garanti / personnel fixe → N3 de période
```

La frontière est la causalité économique, jamais le mot « relais ».

## 4. Deux périmètres seulement dans ce lot

### GROUP

Coût réel de structure partagé au niveau groupe : Railway, plateforme commune, Hub fixe mutualisable, fonctions groupe, etc.

`market_id = NULL`.

Le coût reste dans un pool groupe **non alloué**.

### MARKET_DIRECT

Coût réel de structure directement attribuable à un marché sans clé de prorata : contrat local, loyer local dédié, **forfait fixe d'un relais du marché**, charge pays exclusivement causée par ce marché, etc.

`market_id` obligatoire.

Ce lot ne transforme jamais un coût GROUP en MARKET_DIRECT.

## 5. Périodicité souple, vérité temporelle unique

Mensuel, hebdomadaire, trimestriel, annuel ou ponctuel ne nécessitent pas cinq moteurs différents.

La récurrence portée par `charges.recurrence_period` est **snapshotée pour explication**, mais ne décide jamais du montant réel reconnu.

La vérité économique est toujours :

```text
montant du fait + economic_from + economic_to
```

Exemple : un forfait relais de 30 000 KMF couvrant septembre est enregistré sur `[2026-09-01, 2026-10-01)`. Une interrogation sur la moitié de septembre reconnaît mécaniquement la moitié du fait. Une assurance annuelle est répartie sur sa période économique réelle, indépendamment de sa date de paiement.

Ainsi N3 reste flexible sans multiplier les conventions de calcul.

## 6. Corrections append-only

La vérité historique n'est jamais éditée.

- `ACCRUAL` : fait positif initial ;
- `ADJUSTMENT` : correction positive ou négative ;
- `REVERSAL` : annulation négative ;
- ADJUSTMENT / REVERSAL référencent obligatoirement `adjusts_event_id` ;
- une correction conserve l'identité snapshotée du fait corrigé même si la ligne `charges` a été renommée ou reclassée depuis ;
- UPDATE et DELETE sont bloqués par trigger DB.

## 7. Monnaie et preuve

Chaque fait conserve :

- `charge_id` de référence ;
- famille, nom et récurrence snapshotés ;
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

## 8. Lecture sur une fenêtre

Un événement couvrant une période plus large que la fenêtre demandée est reconnu au prorata exact de son chevauchement temporel.

Ce prorata n'est pas une clé de mutualisation : il rattache simplement un coût de période à la portion de période interrogée.

La lecture publie aussi `by_family_kmf`, afin de rendre visible la composition de N3 — par exemple plateforme, Hub, relais fixe et support — sans donner à ces familles une autorité de calcul supplémentaire.

## 9. Fail-closed marché

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

## 10. Hors périmètre

Ce lot ne :

- change pas `computePrices` ;
- change pas le CDR historique ;
- modifie pas `charges` ;
- ajoute pas `market_id` à `charges` ;
- décide pas d'une clé de mutualisation ;
- calcule pas le ratio de couverture ;
- crée pas de refacturation partenaire ;
- expose pas encore de route admin de saisie.

## 11. Séquencement

```text
N2/N3 snapshot
→ maturité/watermark
→ dispositions gouvernées
→ doctrine V1.3
→ CE LOT : vérité N3 de période large et flexible
→ allocation GROUP vers marchés
→ couverture marché
→ ancrage marché
→ migration contrôlée de la décision de prix
```
