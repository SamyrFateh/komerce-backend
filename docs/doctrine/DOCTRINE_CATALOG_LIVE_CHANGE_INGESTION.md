# Catalogue vivant — contrat d'ingestion des changements (owner Catalog)

## 1. Autorités et objet

Le Catalogue vit **après** son entrée : sa maintenance n'est pas une nouvelle candidature Sourcing.
La frontière d'ingestion de changements est propriétaire de Catalog, indépendante de la découverte
et de l'arbitrage de nouveaux produits. L'owner du canal d'acquisition (API fournisseur, webhook,
change feed, import CSV/JSON, saisie manuelle, autre partenaire) produit un même événement versionné ;
l'owner Catalog reçoit les faits, détermine leur identité et leur conséquence, sans aucune branche
conditionnelle sur le fournisseur.

Flux commun :

```text
PUSH webhook ─┐
PULL exact ───┤   adaptateur de source         Catalogue
PULL feed ────┼──> contrat événement canonique ──> journal immuable / dédoublonnage
CSV/JSON ─────┤                                  ──> validation identité + ordre + complétude
Manuel ───────┘                                  ──> delta par champ / plan selon owner
                                                 ──> décision Catalog/Pricing/Orders
                                                 ──> application atomique autorisée
                                                 ──> lecture de contrôle boutique
```

Un événement n'est **pas** une instruction de publication. Le contrat d'acquisition
`PUSH` signifie « la source nous envoie des données », **pas** « Komerce modifie une
annonce chez une marketplace ». La publication dans la boutique et les écritures
sortantes chez un fournisseur sont deux opérations métier différentes.

## 2. Contrat d'entrée minimal (v1)

Le contrat indépendant du provider porte une `source_id` stable, un `principal_ref`
(compte, tenant ou périmètre fournisseur), le mode de collecte `PUSH | PULL_EXACT |
PULL_FEED | FILE | MANUAL`, un `event_id` idempotent dans ce périmètre, un
`observed_at` issu de la source ou de la capture documentée, une `target`
(`product | offer | unit` + `source_ref` exact) et une liste de changements.

Chaque changement a un `field` canonique et une opération :
- `SET(value)` : valeur explicitement connue ; `0`, `false`, `[]` sont
  des valeurs réelles, jamais des absences.
- `UNKNOWN` : la source **n'a pas établi** la valeur. Ne pas faire de
  remplacement, retrait ou publication par supposition.
- `REMOVE` : suppression explicitement attestée du champ dans le périmètre
  autorisé ; une réponse API paginée ou partielle ne prouve rien.
- `WITHDRAW` : retrait explicite d'une offre ou unité *précisément identifiée*,
  uniquement avec preuve du contrat de cette source ; ne jamais le déduire
  d'une absence dans un échantillon ou d'une erreur d'API.

Les familles évolutives couvrent au minimum : identité, état et assortiment de
l'offre, unités/variantes, stock source, coût source et devise, MOQ/expédition,
titre/description/attributs, images/médias, conformité, délais. Les changements
de prix de **vente** et les promotions relèvent toujours de l'owner économique
et de la décision de marché ; un nouveau coût source ne les recalcule ni ne les
publie silencieusement.

Un PATCH ne mentionne que les faits modifiés ; un SNAPSHOT porte sa complétude
exacte (périmètre, pagination, nombre de lignes, preuve). Omission d'un champ
`!==` UNKNOWN explicite `!==` retrait. Les snapshots partiels ne sont jamais
traités comme suppressions.

## 3. Contrôle avant effet

- Même source, même principal, même référence exacte, identité canonique
  non ambiguë ; un SKU déjà vendu garde sa référence interne. Une nouvelle
  unité est un ajout potentiel contrôlé, pas un remplacement d'un SKU existant.
- Antirejeu : `(source_id, principal_ref, event_id)` + empreinte du contenu ;
  doublon identique = NOOP, même clé avec contenu divergent = CONFLICT.
- Ordre : un événement plus ancien qu'un fait déjà connu n'écrase jamais celui-ci.
  Horodatage égal avec contenu différent = CONFLICT, sauf preuve de version
  monotone source. Un timestamp inconnu = REVIEW, jamais écriture immédiate.
- Un événement porte plusieurs champs indépendants : un changement de média
  n'autorise pas à modifier simultanément le prix ou l'inventaire par effet
  de bord. Les propriétaires de champs et les overrides humains gouvernent
  les applications, avec un audit du refus ou de la mise en revue.
- SOURCE OFF bloque les **nouveaux effets d'acquisition**, sans modifier les
  commandes client déjà payées, leurs obligations Purchasing, ou les données
  historiques. Redémarrer exige une nouvelle preuve de fraîcheur par unité.
- Un stock fournisseur n'est ni une réservation ni `product_skus.stock` :
  ce dernier peut déjà porter des décréments de commandes. Le futur owner
  d'inventaire doit conserver séparément stock source, engagements/réservations,
  provenance et âge ; interdit de faire `UPDATE stock = stock_source` à chaque pull.
- Prix source, prix public, overrides éditoriaux, médias, retrait et visibilité
  ont chacun leur politique ; le retrait ne supprime pas une commande ni son
  historique.

## 4. Découpage en lots et preuves

**A — contrat pur (cette PR)** : normaliser/valider un événement indépendant
de son canal et produire un plan read-only field-by-field avec raison,
ordre et identité. Aucune DB, cron, API, publication ni paiement.

**B — ingestion durable** : journal immuable des événements + unique
antirejeu et curseur par source/principal/target/field ; mapping réutilisable
depuis les Observations canoniques existantes, sans doubler un writer.
Un même adaptateur d'entrée sert un événement PUSH et une réponse PULL.

**C — applications par owner** : Catalog gère contenu/médias/assortiment/état
d'offre ; Pricing gère la décision du prix de vente ; Inventory et Orders
gèrent disponibilité **après engagements existants** ; Purchasing garde le
preflight au moment de l'achat. Chaque application fait un compare-and-swap,
journalise une raison et expose un readback. Aucune autopublication initiale.

**D — Golden isolé** : sur une référence exacte déjà liée, synthétique
`3 → 1 → 0`, coût changé, média modifié, unité retirée explicitement et
erreur/UNKNOWN. Prouver deux canaux alimentant le même contrat, le replay
idempotent, les versions périmées, l'absence de promotion et la lecture de
contrôle côté catalogue dans un DB staging jetable. Puis test provider live
séparé, source OFF, backfill ON et activation bornée sans nouveau service
Railway avant validation.

La validation d'un lot ne remplace jamais celle du suivant.
