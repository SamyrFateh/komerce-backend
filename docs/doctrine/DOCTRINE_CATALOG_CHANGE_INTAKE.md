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

Le contrat `services/catalog-provider-capability-contract.js` inventorie
**uniquement les capacités d'observation/réception** utilisables pour alimenter
une enveloppe de changement de catalogue :

- `discovery` : découverte/liste/recherche ;
- `exact_read` : lecture exacte d'un produit, d'une offre ou d'une unité ;
- `change_feed` et `webhook` : réception d'événements (mécanismes de transport) ;
- `stock_read`, `price_read`, `offer_status_read`, `media_read` :
  lecture des faits correspondants, au grain réellement fourni.

La capacité DOCUMENTED n'est jamais marquée opérationnelle tant que
AUTHORIZED + IMPLEMENTED + PROVED ne sont pas acquis pour l'opération, le
compte et l'environnement concernés. L'absence d'une capacité est UNKNOWN,
jamais implicitement false ni PASS.

**Capacités hors contrat Intake** : écriture vers un fournisseur (stock, prix,
contenu), réservation atomique et achat relèvent de contrats d'exécution
fournisseur/Purchasing distincts ; publication et mutations du catalogue
Komerce restent aux owners Catalog / Market Delegation. La réception d'un
`API_PUSH` *vers Komerce* ne constitue ni une permission d'écriture chez le
fournisseur, ni une permission de publier ou de modifier un prix engagé.

### Correspondance avec les couches source Sourcing

`sourcing_source_provides.layer` décrit le **grain observable** d'une source,
pas sa capacité technique, sa permission ou sa preuve contractuelle :

| Couche | Faits dont elle peut porter l'observation | Capacités de lecture à qualifier séparément |
| --- | --- | --- |
| `catalog` | identité et contenu produit, média au niveau produit | `discovery`, `exact_read`, `media_read` |
| `offers` | prix et état d'une offre fournisseur, média au niveau offre | `exact_read`, `price_read`, `offer_status_read`, `media_read` |
| `units` | stock/disponibilité, prix et état à l'unité vendable exacte | `exact_read`, `stock_read`, `price_read`, `offer_status_read` |

`change_feed` et `webhook` désignent le mode de réception : ils ne
déterminent **aucune couche** à eux seuls. Une couche déclarée n'accorde
jamais la capacité correspondante sans preuve au bon grain. Le choix du grain
effectif reste issu du contrat source et des faits observés, sans conversion
automatique de cette table en `PROVED` ou en autorisation.

### Premier consommateur de persistance, distinct de l'Intake

La normalisation `Catalog Change Intake` reste indépendante de Sourcing :
elle peut recevoir `PULL_EXACT`, `CHANGE_FEED`, `WEBHOOK`, `FILE`,
`MANUAL` et `API_PUSH` sans imposer de passage par un moteur de découverte.

Le **premier consommateur à raccorder dans un GAP ultérieur** pour archiver
les faits externes est l'owner d'observations Sourcing, déjà propriétaire de
`sourcing_captures`, `sourcing_observations`,
`sourcing_observation_evidence` et de la provenance. Ce raccordement n'est
pas implémenté par la PR initiale #1700 ni par ce recadrage : aucun nouvel
owner, table parallèle, événement d'achat ou mutation de boutique ici.

Après observation et résolution explicite de l'identité/provenance, les
owners métier Catalog évaluent champ par champ l'application éventuelle
sur le catalogue maître. Le transport et l'observation n'en décident jamais.

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
