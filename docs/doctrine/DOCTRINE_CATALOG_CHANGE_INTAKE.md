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

## Preuve d'identité exacte du SKU (lecture seule)

`services/sourcing-catalog-change-sku-identity-proof.js` poursuit la preuve
d'identité de la Canonical Unit d'un delta de stock, **sans la modifier**.
Le statut `EXACT_CATALOG_SKU_IDENTITY` n'est émis que si une seule unité
`product_skus` active, provenant d'une promotion fournisseur explicite,
correspond simultanément au `supplier_unit_ref` exact, au provider de sa
`supplier_order_identity`, au produit catalogue issu d'un import de cette
**même source**, et au Canonical Product déjà résolu par un binding actif.
Ce produit doit utiliser `inventory_model='SKU'`.

Un produit catalogue importé depuis plusieurs Source IDs rend la propriété
du SKU ambiguë : même fournisseur, autre compte/tenant, autre fournisseur
ou unité portant accidentellement la même référence textuelle ne doivent
jamais attribuer le stock au premier candidat trouvé. Absence de
correspondance, plusieurs SKU, source concurrente, SKU inactif ou modèle
d'inventaire legacy bloquent explicitement la preuve. Les correspondances
approximatives par titre, variant_combo et prix sont interdites.

La sortie reste **uniquement un constat d'identité** avec
`application_status='NOT_EVALUATED'` et `applicable=false` : ni la
fraîcheur du fait, ni son autorité contractuelle chez le fournisseur, ni les
réservations et engagements Komerce, ni la cohérence exhaustive de la
Supplier Order Identity ne sont prouvées par cette lecture. Le stock affiché
du SKU, les commandes existantes, la visibilité boutique et les captures
restent inchangés. Un futur owner Catalog devra vérifier ces conditions et
décider champ par champ du traitement du fait ; le service d'identité n'a
aucune API de mutation.

## Mission 1 — statut de revue du synchroniseur de stock

Le décideur `services/catalog-stock-sync-decision.js` et l'application
`services/catalog-stock-sync-application.js` sont **expérimentaux et non
raccordés à une route ou à un déclenchement automatique**. Ils ne sont pas
autorisés à piloter le stock boutique en production avant validation des
invariants suivants :

- une preuve effective, propre au fournisseur, compte, environnement, unité
  et opération `stock_read` (autorisation, implémentation et preuve, et non
  seule présence de la source dans Sourcing) ;
- une règle de réconciliation démontrée entre stock absolu fournisseur,
  mouvements relatifs issus des paiements/annulations, engagements non encore
  notifiés au fournisseur et quantité vendable Komerce. L'état
  `purchase_orders.status='confirmed'` ne prouve pas, à lui seul, que
  l'observation externe tient compte de cet engagement ;
- une stratégie de fraîcheur tenant compte de l'ordre des transactions
  locales réellement validées et des snapshots externes : comparer
  `product_skus.updated_at` au `observed_at` émis par la source n'est
  pas une preuve générale de réconciliation.

Le décideur refuse désormais un `observed_at` **situé dans le futur**
(`BLOCKED/FUTURE_OBSERVATION`). Cela élimine un contournement temporel
simple mais ne résout pas les trois conditions métier ci-dessus.

Un `NO_CHANGE` idempotent est un résultat normal, pas une exception
transport avec code HTTP 200. Une relecture incohérente après écriture
doit provoquer un rollback, jamais un commit avec
`read_after_write_verified=false`.

L'existence de tests synthétiques ou d'une CI verte ne vaut pas preuve
d'aptitude à une application automatique en production. Le premier
raccordement opérationnel reste subordonné à une revue indépendante de
l'autorité de la source et du modèle de réconciliation des engagements.

**Barrière d'exécution actuelle :** aucun résolveur d'autorité de stock
provider-scoped ni aucune réconciliation du snapshot avec les mouvements
Komerce ne sont encore implémentés en runtime. Sans eux, le décideur
retourne `REVIEW_REQUIRED/STOCK_AUTHORITY_NOT_PROVEN` et aucune écriture
de stock n'est permise. Les callbacks de preuves synthétiques ne sont
acceptés que dans la base PostgreSQL CI isolée
(`GITHUB_ACTIONS=true`, `NODE_ENV=test`, crons désactivés et URL de
`komerce_test` exacte) ; fournir ces callbacks en dehors de ce cadre
retourne `BLOCKED/SYNTHETIC_PROOF_NOT_ALLOWED`. La PR démontre un
**prototype de décideur et d'applicateur**, pas encore une synchronisation
de stock fournisseur opérationnelle. Une future tranche doit prouver la
provenance et la fraîcheur réelle des lectures externes, les engagements
liés au snapshot, puis raccorder un owner Catalog explicite à cette autorité
avant toute activation ou écriture de stock en production.

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
