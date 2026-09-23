# Doctrine — Catalog Change Intake

## Principe

Un catalogue vivant ne dépend pas de Sourcing pour recevoir ses changements.

Sourcing peut découvrir, qualifier et surveiller une source. Catalog reste
l'autorité du catalogue maître et doit accepter des changements source par un
contrat unique, quelle que soit leur origine :

- lecture exacte API (PULL_EXACT) ;
- flux incrémental (CHANGE_FEED) ;
- webhook/callback (WEBHOOK) ;
- fichier (FILE) ;
- saisie ou correction explicite (MANUAL) ;
- push API autorisé vers Komerce (API_PUSH).

Le transport n'accorde aucune autorité supplémentaire. Une donnée reçue est
d'abord un **fait source**, pas une mutation boutique.

## Contrat d'entrée

services/catalog-change-intake.js normalise une enveloppe versionnée avec :

- identité de source : provider, portée compte/tenant, source_ref ;
- méthode d'observation ;
- event_id éventuel pour déduplication future ;
- observed_at explicite et timezone-aware ;
- sujet : product_ref et/ou unit_ref ;
- faits typés : stock, prix natif, devise, état offre, activation, médias,
  attributs, axes/options, sellable_units, titre, description ;
- statut de chaque fait : OBSERVED, UNKNOWN, ou retrait explicitement
  confirmé pour les seuls faits de lifecycle.

UNKNOWN ne transporte jamais de valeur. Zéro observé reste zéro. Une absence
n'est jamais une rupture ou un retrait.

La sortie porte toujours authority=catalog_change_intake_only et
application_status=NOT_EVALUATED. Le service n'écrit donc aucun SKU, produit,
prix, média ou visibilité.

## Séparation des responsabilités

Le futur application owner de Catalog décidera champ par champ :

- **stock/disponibilité** : tenir compte de l'identité exacte, de la fraîcheur,
  des engagements/réservations Komerce et du modèle d'inventaire ;
- **prix fournisseur** : mise à jour du coût/source ; jamais réécriture
  automatique du prix de vente sans décision de l'owner économique ;
- **médias/contenu/attributs** : rejouabilité source et respect des overrides
  manuels ;
- **lifecycle/retrait** : preuve explicite selon le contrat provider, jamais
  absence dans un pull partiel ;
- **publication/exposition** : owner Catalog / Market Delegation, pas le
  connecteur provider.

Les commandes et paiements déjà engagés ne sont jamais réécrits à partir d'un
événement de catalogue.

## Contrat de capacités provider

Chaque intégration devra distinguer :

1. DOCUMENTED : l'API provider prétend offrir la capacité ;
2. AUTHORIZED : le compte/token utilisé par Komerce est autorisé ;
3. IMPLEMENTED : notre adapter l'implémente ;
4. PROVED : un test réel ou Sandbox a prouvé le comportement attendu.

Capacités à inventorier indépendamment :

- discovery/list/search ;
- exact read par product/offer/unit ;
- stock exact ou disponibilité bornée à une quantité ;
- prix ;
- état offre / retrait ;
- changement incrémental / event feed ;
- webhook/callback ;
- update stock ;
- update prix ;
- update contenu/média/attributs ;
- activation/désactivation/publication ;
- réservation atomique éventuelle ;
- ordre/achat/fulfillment.

Une capacité DOCUMENTED n'est jamais marquée opérationnelle tant que
AUTHORIZED + IMPLEMENTED + PROVED ne sont pas acquis pour le compte concerné.

## Conséquence architecture

Provider / fichier / opérateur
  -> Adapter transport/provider
  -> Catalog Change Intake
  -> validation + déduplication + provenance
  -> owner Catalog du champ concerné
  -> mutation canonique éventuelle
  -> projection boutique
  -> preuve de lecture après écriture

Sourcing peut alimenter ce pipeline mais n'en est pas l'autorité.
