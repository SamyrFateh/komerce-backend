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

Le **premier raccordement implémenté** est une tranche volontairement réduite :
`POST /api/admin/workspaces/sourcing/sources/:sourceRef/catalog-changes/observe`
(route réservée à un opérateur authentifié avec autorité globale Sourcing)
appelle `services/sourcing-catalog-change-observation.js`, qui valide l'enveloppe
Catalog, puis crée dans une transaction **une Capture et une Observation
immuable de grain `unit`** dans les tables Sourcing existantes.

Cette tranche accepte uniquement une **unité fournisseur exacte** (`product_ref`
et `unit_ref`) et son fait `stock_available` (`OBSERVED` y compris zéro,
ou `UNKNOWN` sans valeur). Elle exige un `event_id` et une source API déjà
enregistrée, active et exactement liée au provider + périmètre de compte.
L'opérateur doit renseigner une source externe vérifiée ; cette route ne
prouve **ni** l'identité/authenticité d'un webhook fournisseur **ni** le
droit de lecture du compte chez ce fournisseur. `FILE`, `MANUAL`, le prix,
le contenu, les changements mixtes et le retrait d'offre sont refusés ici
explicitement, et restent valides comme **types d'enveloppes** pour les
consommateurs ultérieurs.

Un verrou transactionnel par source protège le rejeu du même `event_id` :
même empreinte de l'enveloppe = capture existante sans nouvel insert ;
contenu différent = conflit, sans remplacer l'observation initiale.
`UNKNOWN` n'écrit **pas** de champ numérique stock ; `OBSERVED: 0`
conserve exactement zéro. Les faits sont enregistrés comme un
`CATALOG_CHANGE_DELTA` et non comme un nouveau produit V2 complet.
La résolution de l'identité et toute application au catalogue sont
expressément **non exécutées** dans cette tranche. La Capture porte
`application_status=NOT_EVALUATED`. Aucune table parallèle, migration,
publication, modification de SKU ni manipulation d'une commande engagée.

Le premier consommateur est ainsi un **writer d'observations Sourcing**,
pas un nouveau propriétaire du catalogue : la réception générique de
l'enveloppe reste indépendante de Sourcing, qui archive ici seulement
une observation de source. Un autre GAP devra prouver l'identité canonique
de l'unité, sa fraîcheur et les règles du champ avant toute application.

Après observation et résolution explicite de l'identité/provenance, les
owners métier Catalog évaluent champ par champ l'application éventuelle
sur le catalogue maître. Le transport et l'observation n'en décident jamais.

## Preuve d'identité canonique du delta (lecture seule)

Le service `services/sourcing-catalog-change-unit-resolution-proof.js` reçoit
l'UUID d'une observation déjà persistée par le premier raccordement.
Il **ne modifie ni observation, ni binding, ni entité canonique**. Il refuse
les observations d'une source désactivée, les payloads incomplets ou incohérents,
les faits `UNKNOWN`, les observations déjà liées à une autre entité et les
événements qui ne sont pas un `UNIT_STOCK_DELTA` explicite.

Pour retourner `EXACT_CANONICAL_UNIT`, les preuves préexistantes doivent
former simultanément la même chaîne :

1. `source_id` exact de la Capture, `product_ref` et `unit_ref` exacts
   conservés dans le delta ; la référence source brute doit désigner ce
   produit, sans alias ni fallback fournisseur inter-compte ;
2. `product.source_ref` et `unit.source_ref` de la **même source**
   déjà associés à des entités canoniques actives ;
3. une relation active **Product → Offer → Unit** entre ces entités ;
4. pour le Product et la Unit, au moins une observation source **complète
   antérieure** possédant un binding actif vers l'entité correspondante.

Le delta de stock n'est **jamais** passé au résolveur destiné à un produit
complet V2 ; aucune liaison n'est créée à partir du seul delta.
Zéro observé reste zéro, `UNKNOWN` n'est pas convertible en zéro.
Si la chaîne est absente, inactive ou ambiguë, la sortie refuse la
correspondance au lieu de choisir une unité par nom, ressemblance ou prix.

Cette preuve ne démontre **pas** encore que la Unit canonique correspond
de manière unique à un `product_skus.id`, ni la fraîcheur d'un événement,
l'autorité de la source, les réservations/engagements en cours ou la
décision métier sur le stock affichable. Même avec
`status=EXACT_CANONICAL_UNIT`, les drapeaux `applicable=false`,
`sku_resolution_evaluated=false`, `freshness_evaluated=false` et
`application_status=NOT_EVALUATED` restent obligatoires.
Aucune route publique, publication, commande, opération fournisseur ou
mutation Catalog n'est ajoutée par ce seul contrôle.

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
