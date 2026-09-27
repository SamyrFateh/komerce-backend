# Rapport de capacité — Abstraction Catalogue

**Version : 2026-09-25**  
**Statut de l'abstraction : ACCEPTED pour ingestion/promotion contrôlée ; live sync fournisseur = fail-closed par provider**  
**But :** décrire clairement ce que le Catalogue Komerce sait faire, ce qu'il refuse et les conditions d'intégration d'une nouvelle source ou d'un nouveau flux de changement.

## 1. Rôle de l'abstraction

Le Catalogue est l'autorité du produit Komerce. Il reçoit des faits fournisseur, les qualifie, crée des candidats et peut promouvoir un candidat en **draft inactif**, mais aucun fournisseur ne peut décider directement du prix Market, de la publication ou de l'exposition Boutique.

Chaîne principale :

`Normalized Supplier Product V2 → catalog-import-orchestrator → eligibility → Raffinerie → sourcing_candidate → promotion → product draft inactif + SKU/médias → décision Catalog/Market → exposition éventuelle`

Chaîne des changements d'un catalogue vivant :

`Provider event/read → Catalog Change Intake → observation immutable → identité exacte → décision par champ → application contrôlée ou REVIEW_REQUIRED`

## 2. Vocabulaire de statut

| Statut | Signification |
| --- | --- |
| `VALIDATED` | capacité du core prouvée et réutilisable |
| `PROVIDER_GATE` | moteur prêt, mais autorité réelle à prouver pour chaque provider/compte/environnement |
| `DECISION_ONLY` | le core sait qualifier le changement mais n'applique volontairement aucune mutation automatique |
| `NOT_IMPLEMENTED` | contrat d'entrée possible, mais aucun décideur/applicateur spécifique n'existe encore |
| `OUT_OF_SCOPE` | responsabilité d'un autre domaine |

## 3. Capacités d'ingestion et de création catalogue

| Capacité | Statut | Ce que Komerce sait faire |
| --- | --- | --- |
| Recevoir un produit fournisseur normalisé | `VALIDATED` | accepter V2 issu de CJ, AliExpress ou d'un futur adapter sans logique provider dans la Raffinerie |
| Conserver source brute + projection normalisée | `VALIDATED` | auditer ce qui vient réellement du fournisseur sans confondre source et vérité Catalogue |
| Vérifier l'éligibilité avant pricing | `VALIDATED` | exclure/refuser explicitement les cas douane/légaux connus avant promotion |
| Raffiner un candidat | `VALIDATED` | produire TEST/WATCH/EXCLUDED à partir des données disponibles sans inventer marché ou stock |
| Préserver UNKNOWN | `VALIDATED` | absence de donnée ≠ zéro, rupture ou suppression |
| Créer un draft catalogue | `VALIDATED` | créer un produit `lifecycle_status=candidate` et inactif |
| Promouvoir variantes/SKU/médias | `VALIDATED` | projeter option axes, unités vendables, médias et Supplier Order Identity de façon idempotente |
| Préserver les overrides manuels | `VALIDATED` | ne pas écraser silencieusement une correction manuelle par un replay fournisseur |
| Rejouer une promotion | `VALIDATED` | réconcilier de façon idempotente plutôt que dupliquer les SKU/médias |
| Publier automatiquement après import | `OUT_OF_SCOPE` / interdit | aucune source fournisseur n'obtient ce droit par ingestion |

## 4. Capacités du catalogue vivant

Le contrat commun `Catalog Change Intake` accepte des observations par `PULL_EXACT`, `CHANGE_FEED`, `WEBHOOK`, `FILE`, `MANUAL` ou `API_PUSH`. Le transport n'accorde jamais l'autorité de modifier le catalogue.

| Champ observé | Statut core | Mutation possible par le moteur | Condition réelle avant activation fournisseur |
| --- | --- | --- | --- |
| `stock_available` | `VALIDATED` en CI isolée | oui, écriture absolue contrôlée sur `product_skus.stock` | `PROVIDER_GATE` : preuve d'autorité stock + identité exacte + fraîcheur + réconciliation engagements |
| `title` | `VALIDATED` en CI isolée | oui, sous protection override manuel | `PROVIDER_GATE` |
| `description` | `VALIDATED` en CI isolée | oui, sous protection override manuel | `PROVIDER_GATE` |
| `media` | `VALIDATED` en CI isolée | oui, avec validation des URLs et read-after-write | `PROVIDER_GATE` |
| `purchase_price` + `currency` | `VALIDATED` en CI isolée | oui vers l'état de sync fournisseur du SKU, **pas** vers le prix de vente | `PROVIDER_GATE` |
| `offer_status` | `DECISION_ONLY` | non | revue explicite nécessaire |
| `is_active` | `DECISION_ONLY` | non | publication/lifecycle reste sous autorité Catalog |
| `option_axes` | `DECISION_ONLY` | non | risque identité SKU → revue |
| `sellable_units` | `DECISION_ONLY` | non | risque identité SKU → revue |
| `attributes` | `NOT_IMPLEMENTED` pour application delta | non | futur chantier si nécessaire |

## 5. Garde-fous du live sync

Le moteur de changement de catalogue est volontairement **fail-closed**. Tant qu'un provider réel n'a pas une preuve scoped `provider + account/environment + operation + unit`, le résultat reste `REVIEW_REQUIRED` ou bloqué.

Les invariants suivants sont déjà présents :

- une identité produit/SKU doit être exacte avant toute application ;
- un événement futur ou plus ancien qu'une observation déjà appliquée ne peut pas écraser l'état courant ;
- un SKU modifié localement après l'observation provoque une revue ;
- un engagement Komerce non réconcilié bloque un remplacement absolu du stock ;
- le replay de la même observation est idempotent ;
- chaque écriture contrôlée est relue avant COMMIT ;
- une incohérence read-after-write provoque un rollback ;
- le prix d'achat fournisseur ne peut pas modifier silencieusement le prix de vente Market.

## 6. Frontières d'autorité

| Décision | Owner |
| --- | --- |
| Créer/mettre à jour un candidat fournisseur | Sourcing/Catalog ingestion |
| Promouvoir en draft inactif | Catalog |
| Prix de vente Market | Economic Engine / Market |
| Exposition produit x marché | Market Delegation |
| Publication/activation finale | Catalog approval / Market |
| Stock physique local réellement détenu | Local Stock |
| Choix du fournisseur à acheter | Selection / Purchasing |
| Hub, consolidation, routing | Logistics / Hub |
| Paiement et commande fournisseur | Purchasing |

## 7. Contrat minimal d'intégration d'un nouveau fournisseur

Pour être **Catalog-ingestion-ready**, un provider doit :

- produire un `Normalized Supplier Product V2` valide ;
- conserver les identités produit et SKU fournisseur ;
- conserver prix + devise source sans conversion implicite ;
- représenter le stock manquant comme UNKNOWN ;
- conserver médias, variantes et propriétés sans perte silencieuse ;
- entrer par `catalog-import-orchestrator`, jamais par un `INSERT products` direct ;
- passer eligibility + Raffinerie ;
- promouvoir uniquement vers un produit inactif ;
- ne jamais décider seul du prix Market ni de l'exposition.

Pour être **Catalog-live-sync-ready**, il doit en plus :

- déclarer précisément ses capacités de lecture ;
- être `documented + authorized + implemented + proved` pour l'opération concernée ;
- fournir une identité exacte au grain du champ observé ;
- fournir un `observed_at` exploitable et une provenance auditée ;
- accepter le comportement fail-closed si l'autorité ou la réconciliation manque ;
- ne jamais transformer un `UNKNOWN` en valeur.

## 8. Ce qui peut commencer maintenant

Le peuplement contrôlé du catalogue **n'a pas besoin d'attendre l'activation du live sync fournisseur**.

Le chemin autorisé pour la phase suivante est :

`produit réel → V2 → Raffinerie → candidat → promotion draft inactive → revue/curation → décision Market → exposition staging → E2E utilisateur`

Le live sync automatique fournisseur peut rester désactivé pendant cette phase. Son absence ne remet pas en cause l'intégrité du catalogue initial, car les changements fournisseurs restent fail-closed et ne peuvent pas écraser la Boutique.

## 9. Critères de refus d'intégration

Une intégration doit être refusée si elle :

- écrit directement dans `products`, `product_skus` ou la visibilité Boutique depuis le connecteur ;
- fabrique un prix de vente à partir du prix fournisseur ;
- publie parce qu'un fournisseur marque un produit actif ;
- traite l'absence de stock comme zéro ;
- désactive un SKU sur simple absence dans un pull partiel ;
- écrase un override manuel ;
- applique un changement sans identité exacte, fraîcheur et preuve d'autorité ;
- mélange stock fournisseur et stock local Komerce.

## 10. Verdict d'acceptation

### Verdict core

`CATALOG_CORE_ABSTRACTION = ACCEPTED`

### Verdict peuplement / E2E utilisateur

`CATALOG_POPULATION_AND_USER_E2E = READY`

### Verdict synchronisation automatique fournisseur

`CATALOG_LIVE_PROVIDER_SYNC = PROVIDER_GATE / FAIL_CLOSED`

L'abstraction Catalogue est donc considérée **fermée pour l'ingestion, la Raffinerie, la promotion draft et la préparation du peuplement réel**.

Le dernier travail lié au live sync n'est plus un chantier d'architecture : c'est une **preuve d'intégration par provider et par capacité**. Un provider qui ne prouve pas son autorité reste simplement sans mutation automatique, sans bloquer le catalogue ni les tests utilisateurs.