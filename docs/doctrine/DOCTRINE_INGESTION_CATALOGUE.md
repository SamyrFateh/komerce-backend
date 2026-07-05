# Doctrine d'Ingestion du Catalogue Komerce

> **Version** : 1.0 — 2026-07-04
> **Statut** : document fondamental — complète DOCTRINE_CATALOGUE.md (la raffinerie) en verrouillant sa porte d'entrée
> **Code porteur** : `services/suppliers/normalized-product.js`, `services/suppliers/connectors/*`, `services/suppliers/catalog-import-orchestrator.js`, `services/supplier-catalog-scanner.js`
> **Audit source** : audit ingestion 2026-07-04 — verdict 🟠 ORANGE, 14/14 cas fournisseurs sales exécutés avec succès contre le code actuel
> **Contrainte fondatrice** : le fondateur n'arbitre que le haut niveau. Il ne relit jamais une donnée fournisseur. Tout ce qui exige de « réfléchir produit par produit » est un échec de cette doctrine.

---

## 1. Phrase de vérité

> **Le catalogue n'a pas besoin d'être intelligent. Il doit être incapable
> d'avaler de la donnée sale sans le dire. La raffinerie ne reçoit jamais
> une donnée « probablement propre » : elle reçoit une donnée
> contractuellement propre, ou rien — et quand c'est « rien », la raison
> est écrite, comptée, et visible.**

Corollaire opérationnel : entre la boutique (ce que le client doit voir pour
décider) et les sources fournisseurs (diverses, variées, surprenantes),
l'intelligence est **silencieuse mais jamais muette**. Silencieuse : elle ne
demande rien à l'humain. Jamais muette : chaque donnée écartée, devinée ou
douteuse laisse une trace lisible et, au-delà d'un seuil, une alerte.

## 2. Les deux moteurs non négociables

La boutique repose sur deux moteurs. Ni l'un ni l'autre n'a le droit d'être
« à peu près » :

| Moteur | Rôle | Exigence non négociable |
|---|---|---|
| **Moteur économique** | prix, marges, rails, densité de valeur | déjà gouverné (pricing-engine, doctrines V/Q) |
| **Moteur catalogue** | ingestion → raffinerie → publication | **fiabilité** (rien de faux n'entre), **lisibilité** (toute décision machine est explicable en une phrase), **alerting** (le sale déclenche, jamais ne s'accumule), **performance** (un import de 500 lignes reste une opération d'une minute) |

Cette doctrine gouverne le second moteur, côté entrée.

## 3. État honnête au 2026-07-04 — ce que le code fait vraiment

Un audit exécuté (pas seulement lu) a prouvé que le contrat pivot
`NormalizedSupplierProduct` est aujourd'hui **une convention JSDoc, pas un
contrat**. Les cas suivants passent le code actuel — c'est le point de
départ assumé, pas une honte cachée :

| Donnée fournisseur sale | Comportement actuel prouvé | Gravité |
|---|---|---|
| Virgule dans un titre (`"Casque, Bluetooth Pro",5000`) | produit **accepté** avec nom tronqué `Casque` et prix perdu | P0 |
| Devise absente | `AED` **inventé silencieusement** (csv + manuel + scanner) | P0 |
| Devise inconnue (GBP) via `PUT /candidates/:id` | montant **traité comme du KMF** (÷~550 sur la valeur réelle) | P0 |
| Candidat exclu douane (`state='rejected'`) | **importable au catalogue en 1 clic** (`POST /candidates/:id/import-product`) | P0 |
| Colonne inconnue mais vitale (`hazmat_class`, `battery_type`) | **détruite avant l'éligibilité** ; `raw_payload` ne contient que les colonnes mappées et n'est jamais persisté | P0 |
| Stock `-50` | accepté, `-50` en base | P1 |
| Stock `many` / `12 units backorder` | `null` silencieux / `12` | P1 |
| Poids `25000` kg | accepté, marqué `source:'supplier', confidence:'high'` | P1 |
| Prix absent | scanné avec coût 0 → marge « saine » → décision `TEST` | P1 |
| Doublon SKU intra-fichier | dernière ligne écrase, zéro avertissement | P1 |
| Champ inattendu (`is_admin:true`) | accepté par le validateur | P1 |
| Colonnes dupliquées (`price,price`) | première gagne, silencieux | P2 |
| Titre 500 caractères, URL image invalide | acceptés sans borne | P2 |

Ce qui tient déjà (et ne doit pas régresser) : la **frontière publique
boutique est whitelistée** (`catalog-public-view.js` — un champ de cuisine
est invisible par défaut), l'**éligibilité douane est au bon étage** (avant
le pricing, exclusion absolue non régressable), les **connecteurs API sont
honnêtement inactifs** (ils lèvent une erreur, n'inventent rien), le **guard
de publication** refuse prix ≤ 0 au dernier moment, et les tests unitaires
sont bloquants en CI.

## 4. Les invariants d'ingestion (ING-I)

Toute PR touchant l'ingestion se juge contre ces invariants. Ils sont
vérifiés par la gate `npm run gate:catalog-contract` (chantier ING-4).

- **ING-I1 — Contrat, pas convention.** Tout objet sortant d'un connecteur
  valide le schéma versionné
  `schemas/catalog/normalized-supplier-product.v1.schema.json`
  (`additionalProperties:false`, bornes réalistes, `raw_payload` requis,
  `currency` requise). Un connecteur qui contourne le schéma n'existe pas.
- **ING-I2 — Jamais inventer, jamais deviner en silence.** Aucune valeur
  par défaut fabriquée (devise, prix, stock). Une donnée manquante est soit
  un rejet motivé, soit une estimation **marquée** (`data_sources`,
  `confidence`) qui dégrade la décision en aval. `convertToKMF` lève une
  erreur sur devise inconnue — il ne « fait au mieux » jamais.
- **ING-I3 — Le brut ne se perd jamais.** `raw_payload` = la donnée source
  intégrale (toutes colonnes, y compris inconnues), persistée en
  `sourcing_candidates.raw_payload`. C'est la matière première de la
  rejouabilité (DOCTRINE_CATALOGUE §5) et de l'éligibilité (une colonne
  `hazmat_class` doit pouvoir matcher une exclusion).
- **ING-I4 — Le sale déclenche, il ne s'accumule pas.** Chaque ligne
  rejetée porte sa raison. Un import dont le taux d'invalides dépasse
  `CATALOG_IMPORT_MAX_INVALID_PCT` est refusé en bloc (le fichier est
  malade, pas les lignes). Le résultat d'import affiche toujours :
  acceptés / rejetés / raisons agrégées.
- **ING-I5 — Une exclusion absolue est terminale partout.** Aucune route,
  aucun clic, aucun ré-import ne peut transformer un candidat
  `rejected`/`EXCLUDED` en produit. Le blocage vit dans le code de la
  route d'import, pas dans la discipline de l'admin.
- **ING-I6 — Pas de décision sourcing sur du vide.** Prix d'achat manquant
  → décision `WATCH` forcée avec raison explicite. Jamais `TEST` sur un
  coût de zéro.
- **ING-I7 — Les tests attaquent, ils ne documentent pas.** Le corpus de
  fixtures sales (`tests/fixtures/catalog/`) est la définition exécutable
  de « prêt à tout ». Chaque incident fournisseur réel devient une fixture
  — le réel calibre, comme partout. Un test qui verrouille un comportement
  dangereux (« colonne inconnue → ignorée silencieusement ») est un bug de
  test.
- **ING-I8 — La frontière publique reste whitelistée.** Aucun endpoint
  boutique ne sort une ligne brute. Toute nouvelle colonne est invisible
  par défaut ; la rendre publique est un acte explicite dans
  `PUBLIC_PRODUCT_FIELDS`.

## 5. Rôles — qui fait quoi

| Acteur | Fait | Ne fait jamais |
|---|---|---|
| **Connecteurs** | encaissent n'importe quelle source (CSV tordu, formulaire, API future) et sortent du contrat v1 ou du rejet motivé | inventer une valeur, tronquer en silence, laisser passer un champ hors contrat |
| **Scanner / raffinerie** | enrichit, estime **en le marquant**, décide avec des raisons lisibles | travailler sur une donnée non contractuelle, décider sur du vide |
| **Gate CI** | rejoue le corpus sale à chaque PR, échoue au premier sale accepté | être contournable ou informative |
| **Fondateur** | arbitre les seuils (`business_rules`), approuve/rejette des fiches finies, lit les alertes agrégées | relire une ligne fournisseur, réfléchir produit par produit |

## 6. Clés business_rules

| Clé | Défaut | Rôle |
|---|---|---|
| `CATALOG_IMPORT_MAX_INVALID_PCT` | 30 | Au-delà de ce taux d'invalides, l'import entier est refusé (fichier malade) |
| `CATALOG_MAX_WEIGHT_KG` | 500 | Borne haute contrat (au-delà : rejet, pas une devinette) |
| `CATALOG_MAX_UNIT_PRICE_KMF` | à calibrer | Borne haute prix unitaire (cohérente avec plafond assurance, DOCTRINE_CATALOGUE §9) |
| `CATALOG_NAME_MAX_LEN` | 300 | Borne titre (anti keyword-stuffing structurel) |

Les seuils sont l'espace d'arbitrage du fondateur. Le code applique, ne
choisit pas.

## 7. Ce que cette doctrine interdit

- Ne jamais ajouter un défaut silencieux (`|| 'AED'`, `|| 0`, `|| 'autre'`
  sans marquage `data_sources`) dans un connecteur ou le scanner.
- Ne jamais faire passer `invalid` d'un statut bloquant à informatif.
- Ne jamais merger un connecteur (présent ou futur — API, scraping,
  fichier exotique) sans le brancher au schéma v1 **et** au corpus de
  fixtures sales.
- Ne jamais réduire le corpus de fixtures : il grandit à chaque incident
  réel, il ne rétrécit jamais.
- Ne jamais exposer un champ de cuisine sans passage explicite par
  `PUBLIC_PRODUCT_FIELDS`.
- Ne jamais permettre l'import d'un candidat en état terminal `rejected`.

## 8. Définition de « terminé »

L'ingestion est considérée verrouillée quand :

1. `npm run gate:catalog-contract` existe, tourne en CI, et répond par un
   code de sortie à la question : *« un fournisseur sale peut-il polluer la
   raffinerie ? »* ;
2. les 13 cas du §3 sont soit rejetés avec raison, soit acceptés avec
   marquage dégradant la confiance — plus aucun ne passe en silence ;
3. le fondateur peut lire, sur chaque import, une seule ligne de synthèse :
   `N acceptés · M rejetés (raisons) · alerte si fichier malade` — et rien
   d'autre ne lui est demandé.

À partir de là, la raffinerie peut accélérer (K-3 → K-5 de
DOCTRINE_CATALOGUE) : elle raffinera du propre, vraiment.

## 9. Séquencement

Voir `CHANTIERS_INGESTION_CATALOGUE.md` — cinq chantiers ING-1 → ING-5,
chacun de la taille d'une session, ING-5 (les trois verrous) exécutable
immédiatement et indépendamment.
