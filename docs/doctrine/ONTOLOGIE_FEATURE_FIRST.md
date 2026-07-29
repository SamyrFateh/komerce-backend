# Ontologie Feature First — partition exhaustive et proposition d'arbitrage

> **Statut** : `FEATURE OWNERSHIP VERIFIED` · `FEATURE FIRST — NON ENCORE CERTIFIÉ`
> **Date** : 2026-07-29 · **Périmètre** : `monokomerce.zip`, 2 273 entrées d'archive
> **Méthode** : exécution réelle contre le code livré. Aucun chiffre de ce document
> n'est repris d'un rapport existant du dépôt ; tous sont recalculés par un
> extracteur indépendant, dont le périmètre est **volontairement plus large** que
> celui de `feature-registry-check.js` pour ne pas hériter de ses angles morts.
> **Aucune baseline normative n'est produite. Aucun certificat n'est émis.**

---

## 0. Ce que ce document établit, et ce qu'il n'établit pas

Il établit : la partition exhaustive du dépôt, la réconciliation des périmètres,
la réconciliation du graphe de dépendances, une proposition de nature et de
classification pour les 25 manifests, et la liste des éléments qui resteront
hors propriété feature.

Il n'établit pas : de cliquet de référence, de tampon, ni de verdict de
conformité. La suite de contrôles tourne en **mode rapport** — elle mesure, elle
ne fige rien.

---

## 1. L'ontologie proposée

Trois niveaux, chacun **total** (tout élément entre dans une case) et **exclusif**
(un élément n'entre que dans une case).

### Niveau 1 — Nature de l'unité déclarée

Répond aux points 1 et 3 de la décision de gouvernance. Champ `nature`,
obligatoire, vocabulaire fermé.

| `nature` | Définition | Champs requis | Effectif actuel |
|---|---|---|---|
| `feature` | Unité qui rend un service identifiable, possède des fichiers, expose un contrat | `classification` obligatoire | 24 |
| `capability` | Capacité de pilotage — jamais une feature, jamais classée business/support (`PILOTING_CAPABILITY_DOCTRINE` §4) | `classification` **interdit** | 1 |
| `governance-unit` | Unité de gouvernance/plateforme : outillage, registres, CI, config de dépôt | `stewardship` au lieu de `classification` | **0 — case à créer** |

> La case `governance-unit` est le manque structurel de l'ontologie actuelle.
> C'est elle qui absorbera les 199 fichiers aujourd'hui sans propriétaire
> (53 scripts, 84 tests, 47 migrations, 12 registres, 3 contrats de données).
> Sans elle, on ne peut pas atteindre zéro orphelin sans mentir : on serait
> obligé de rattacher `scripts/npm-audit-gate.js` à une feature métier.

### Niveau 2 — Classification (obligatoire si `nature = feature`)

| `classification.axis` | Définition opérante | `classification.kind` admis |
|---|---|---|
| `business` | **Possède de la vérité métier** : au moins une table dont elle contrôle le protocole de mutation, ou un cycle de vie dont elle est seule autorité | `business-feature`, `business-transversal` |
| `support` | **Ne possède aucune vérité métier.** Rend un service technique consommé transversalement | `technical-transversal`, `technical-foundation` |

Le critère discriminant est unique et vérifiable : *cette unité est-elle
l'autorité de mutation d'au moins une donnée métier ?* Si oui → `business`.
Si non → `support`. Les signaux existants (`ownsTables`, `ownsLifecycle`,
`activeService`, `multiConsumer`) restent utiles comme faisceau, mais ils ne
tranchent pas — ils documentent.

### Niveau 3 — Partition de gouvernance des fichiers

Chaque fichier du dépôt entre dans exactement une catégorie (§2). Quatre
statuts de propriété possibles, conformément au point 4 de la décision :

| Statut | Signification |
|---|---|
| `owned` | Déclaré dans le `files:` d'un manifest |
| `inherited` | Possédé par héritage de dossier (ex. tous les `.sql` d'un dossier de migration rattaché) |
| `governance-category` | Rattaché à une catégorie gouvernée sans propriétaire feature |
| `excluded` | Explicitement exclu, **avec justification écrite** |

---

## 2. Partition exhaustive des fichiers

`unzip -l` annonce **2 273 entrées**. Décomposition vérifiée :

```
2 273 entrées d'archive
  −  157 entrées de dossier
  ────────────
  2 116 fichiers réels
```

Partition intégrale, règles évaluées dans l'ordre, première correspondance
retenue. Le contrôle de somme ferme à 2 116 exactement.

| # | Catégorie | Fichiers | Statut cible |
|---|---|---:|---|
| P01 | **Possédé par une feature** | 966 | `owned` |
| P02 | **Ontologie** — les manifests eux-mêmes | 25 | `governance-category` |
| P03 | **Registre de gouvernance** — `governance/**` | 12 | `governance-category` |
| P04 | **Sous-dépôt boutique** — `public/boutique/**` | 553 | `excluded` (gouverné ailleurs) |
| P05 | **Sous-dépôt dashboards** — `public/dashboards/**` | 158 | `excluded` (gouverné ailleurs) |
| P06 | **Actif statique servi** — `public/**` restant | 97 | `governance-category` |
| P07 | **Documentation** — `docs/**` + `*.md` racine | 98 | `governance-category` |
| P08 | **Espace de travail agent** — `.agent/**` | 16 | `excluded` (artefact de process) |
| P09 | **Outillage non rattaché** — `scripts/**` | 53 | ⚠️ **à résorber** |
| P10 | **Test non rattaché** — `tests/**` | 84 | ⚠️ **à résorber** |
| P11 | **Migration non rattachée** — `migrations/**` | 47 | ⚠️ **à résorber** |
| P12 | **Contrat de données non attribué** | 3 | ⚠️ **à résorber** |
| P15 | **Config de dépôt** — racine | 3 | `governance-category` |
| P99 | **Non classé** | 1 | ⚠️ **à résorber** |
| | **TOTAL** | **2 116** | ✅ somme fermée |

### Le détail des cases à résorber

**P12 — 3 contrats de données sans propriétaire** (point explicite de la décision) :

| Fichier | Attribution proposée | Raison |
|---|---|---|
| `schemas/catalog/import-profile.v1.schema.json` | **`catalog`** (`files.schemas`) | Ses 3 voisins du même dossier sont déjà déclarés par `catalog` ; c'est un oubli de déclaration, pas une zone grise |
| `config/import-profiles/komerce-test-dummyjson.v1.json` | **`catalog`** (`files.config`) | Profil d'ingestion concret conforme au schéma ci-dessus |
| `data/catalogue-test-raw/.../komerce-catalogue-brut-sample.json` | **`governance-unit: test-fixtures`** | Jeu de données brut de test, pas un contrat de production — à déplacer sous `tests/fixtures/` |

**P99 — 1 fichier non classé** : `routes/ORPHELINS_FRESH003.md` — un markdown de
travail égaré dans `routes/`. À déplacer vers `docs/` ou supprimer. C'est le seul
élément du dépôt qui ne relève d'aucune règle.

**P09 / P10 / P11 — 184 fichiers d'outillage, de test et de migration.**
Ils ne relèvent d'aucune feature métier ; ils relèvent de la case
`governance-unit` qui n'existe pas encore. Proposition d'unités :

| Unité de gouvernance proposée | Absorbe | Volume |
|---|---|---:|
| `komerce-governance` | Les gates, registres, générateurs de carte, `governance/**` | ~65 |
| `komerce-testkit` | Harnais, fixtures, helpers, tests transverses non rattachables | ~84 |
| `komerce-schema` | Migrations non rattachées à une feature, outils de schéma | ~47 |
| `komerce-agent-ops` | Scripts PowerShell de gouvernance d'agent | ~13 |

---

## 3. Réconciliation des périmètres : 2 273 → 858 → 318

C'est le point qui a le plus besoin d'être écrit noir sur blanc, parce que trois
chiffres différents circulent et décrivent trois choses différentes.

```
2 273  entrées d'archive
  −157  dossiers
────────
2 116  fichiers réels dans le dépôt livré
```

```
1 135  chemins déclarés dans les 25 manifests (tous groupes confondus)
  −169  chemins cross-dépôt, absents de CE dépôt par construction
────────
  966  chemins déclarés ET présents ici          ← P01 de la partition
```

Les 169 absents ne sont **pas** des chemins fantômes : ce sont les déclarations
de carte vers les deux autres dépôts.

| Groupe déclaré | Chemins | Présents ici | Nature |
|---|---:|---:|---|
| `dash` | 101 | 0 | dépôt `dash` |
| `boutique` | 68 | 0 | dépôt `bout` |

```
  966  chemins déclarés et présents
   −68  groupe `docs`     (documentation, pas du code)
   −37  groupe `assets`   (actifs statiques)
    −3  groupe `compositionRoots` (méta-déclaration)
────────
  858  fichiers de code backend sous propriété feature   ← périmètre de l'extracteur
```

```
  318  artefacts runtime auditables pour l'orphelinat
```

Le périmètre 318 est celui sur lequel la question *« existe-t-il du code backend
qui n'appartient à personne ? »* a un sens. Composition :

| Zone | Artefacts |
|---|---:|
| `services/` | 164 |
| `routes/` | 100 |
| `utils/` | 22 |
| `middleware/` | 11 |
| `bootstrap/` | 8 |
| racine (`server.js`, `db.js`, `jest.config.js`…) | 5 |
| `schemas/` `config/` `data/` (contrats `.json`) | 6 |
| `core/`, `validators/` | 2 |
| **Total** | **318** — dont **3 orphelins** |

**Les trois chiffres ne sont donc pas en concurrence** : 2 116 est le dépôt,
858 est ce que les manifests revendiquent en code backend, 318 est la surface
runtime sur laquelle l'orphelinat se mesure. Le lien entre 858 et 318 : 858
inclut les tests (343), les scripts (87), les migrations (75) et `db/` (16) que
les manifests déclarent en plus du runtime.

---

## 4. Réconciliation du graphe : 707 → 274 → 19

707 est le nombre d'**imports** (`require` résolus) qui franchissent une frontière
de feature dans le code runtime. 274 et 19 ne se comparent pas directement : l'un
compte des imports, l'autre des **paires de features**. Le tableau ferme les deux
comptages.

| Classe | Imports | Paires | Statut |
|---|---:|---:|---|
| **A** — déclarée dans `contract.consumes` | 274 | 77 | conforme |
| **B** — câblage par composition root (`bootstrap/api-routes.js`, `bootstrap/crons.js`, `middleware/error-handler.js`) | 13 | 7 | légitime par doctrine |
| **C** — dépendance ambiante vers `infrastructure` | 383 | 23 | à statuer (§4.1) |
| **D** — **non déclarée** | 37 | **19** | ⚠️ à fermer |
| **TOTAL** | **707** | **126** | |

`274 + 13 + 383 + 37 = 707` ✅

### 4.1 — Les 383 imports ambiants ne sont pas un bloc homogène

| Cible | Imports | Nature réelle |
|---|---:|---|
| `db.js` | 169 | **Pool PostgreSQL partagé** |
| `utils/logger.js` | 136 | journalisation |
| `middleware/validate.js` | 15 | validation |
| `validators/index.js` | 15 | schémas de validation |
| `utils/alerts.js` | 15 | émission d'alerte |
| `utils/rules.js` | 14 | **règles métier persistées** |
| `utils/rates.js` | 8 | taux de change |
| `utils/reference.js` | 6 | génération de référence |
| autres | 5 | |

Deux lignes posent une question d'ontologie, pas de câblage :

- **`db.js` (169 imports)** — les 24 features partagent un unique module d'accès
  aux données. Il n'existe aucune frontière de persistance par feature. C'est le
  fait structurant qui rend R3 possible (§9) : la propriété d'une table ne peut
  pas être défendue par le code tant que tout le monde tient le même `pool`.
- **`utils/rules.js` (14 imports)** — écrit `business_rules`. Un utilitaire classé
  `infrastructure` qui mute une table métier. **Une feature `support` ne peut pas
  posséder de la vérité métier** : soit `business_rules` change de propriétaire,
  soit `infrastructure` n'est pas `support`.

### 4.2 — Les 19 paires non déclarées

| Paire | Imports | Lecture |
|---|---:|---|
| `payments → notifications` | 6 | émetteur → transporteur, sain |
| `payments → auth` | 5 | garde de route |
| `platform-ops → auth` | 5 | garde de route |
| `auth-identity → auth` | 2 | garde de route |
| `auth-identity → notifications` | 2 | émetteur → transporteur |
| `notifications → auth` | 2 | garde de route |
| `shared-cart → refunds` | 2 | commande métier |
| `wallet → documents` | 2 | production de reçu |
| `dashboard → decision-signals` | 1 | lecture d'agrégat |
| `economic-engine → logistics` | 1 | lecture de rail transport |
| `loyalty → auth`, `wallet → auth`, `decision-signals → auth`, `loyalty → notifications`, `notifications → decision-signals`, `payments → documents`, `payments → refunds`, `payments → platform-ops` | 1 chacune | |

**14 des 19 paires sont de deux motifs seulement** : `→ auth` (garde de route,
7 paires) et `→ notifications` (émission de message, 4 paires). Aucune n'est une
violation de frontière métier : ce sont des **déclarations manquantes**, pas des
couplages illégitimes. Fermer ces 19 paires est un travail de manifest, sauf pour
`notifications → decision-signals` (§8).

---

## 5. Les 24 features et la capability

`nat.` = nature proposée · `class.` = classification proposée · **gras** = changement par rapport à l'état actuel

| Unité | nat. | class. | kind | Justification |
|---|---|---|---|---|
| `auth` | feature | **support** | `technical-transversal` | 6 middlewares, **0 service, 0 route**. Ne rend aucun service métier ; consommée par 20 features. ⚠️ déclare `users: RW` — à re-scoper (§10-A) |
| `auth-identity` | feature | **business** | `business-feature` | Possède `otp_codes` et le cycle OTP / magic-link / guest-checkout ; 3 routes exposées ; `DOCTRINE_IDENTITE_LEGERE_KOMERCE`. ⚠️ `type: transversal` à corriger en `feature` |
| `catalog` | feature | **business** | `business-feature` | 26 services, 17 tables en écriture, 9 migrations, 18 invariants |
| `customs` | feature | **business** | `business-feature` | Possède la déclaration douanière et son pivot ; 6 tables, 6 migrations |
| `dashboard` | feature | business | `business-transversal` | Déjà classé ✅ |
| `documents` | feature | **business** | `business-transversal` | Possède `transaction_documents` ; produit un artefact **opposable au client**. ⚠️ **cas à arbitrer** (§10-C) |
| `economic-engine` | feature | **business** | `business-feature` | 25 services, 20 tables, 18 migrations — possède le prix |
| `incident-management` | feature | business | `business-transversal` | Déjà classé ✅ |
| `infrastructure` | feature | **support** | `technical-foundation` | ⚠️ **RÉSERVE BLOQUANTE** — déclare 10 tables en écriture dont `finance_config`, `charges`, `economic_snapshots`, `business_rules`, `users` (§10-B) |
| `inventory` | feature | **business** | `business-feature` | Possède `inventory_items` et le dispatch d'article reçu (staging) |
| `logistics` | feature | **business** | `business-feature` | 13 services, 18 routes, 15 tables — possède le colis |
| `loyalty` | feature | business | `business-feature` | Déjà classé ✅ |
| `notifications` | feature | business | `business-transversal` | Déjà classé ✅ |
| `orders` | feature | **business** | `business-feature` | Cœur du domaine : machine de statut, 14 tables, 7 invariants |
| `payments` | feature | **business** | `business-feature` | 12 services, possède `payment_status` (invariant I-BACK-4) |
| `platform-ops` | feature | support | `technical-transversal` | Déjà classé ✅ — réserve déjà écrite par vous : CRUD `modules` non rattaché à `catalog` |
| `purchasing` | feature | business | `business-feature` | Déjà classé ✅ |
| `recommendations` | feature | business | `business-feature` | Déjà classé ✅ |
| `refunds` | feature | **business** | `business-feature` | Possède `refunds` et l'invariant anti-double-remboursement. 0 route : surface **interne**, ce qui n'ôte rien à la propriété |
| `shared-cart` | feature | business | `business-feature` | Déjà classé ✅ |
| `sourcing` | feature | **business** | `business-feature` | Possède `sourcing_candidates` + son cycle. ⚠️ **0 service déclaré, 1 route qui écrit 7 tables** dont 5 appartiennent à `catalog` (§10-D) |
| `unsold-resolution` | feature | business | `business-feature` | Déjà classé ✅ |
| `wallet` | feature | business | `business-feature` | Déjà classé ✅ |
| `wallet-loyalty` | feature | — | `deprecated` | Déjà classé ✅ |
| `decision-signals` | **capability** | **— interdit** | — | `PILOTING_CAPABILITY_DOCTRINE` §4. ⚠️ le manifest n'a **ni `type` ni `nature`** : c'est précisément le point 3 de votre décision. Ajouter `nature: 'capability'` |

**Répartition résultante** : 20 business · 3 support · 1 deprecated · 1 capability.

---

## 6. Ce qui restera hors propriété feature

| Catégorie | Volume | Statut | Justification |
|---|---:|---|---|
| **Ontologie** (`features/*.feature.js`, `capabilities/*.capability.js`) | 25 | `governance-category` | Un manifest ne peut pas se déclarer lui-même sans récursion. Propriétaire institutionnel : la doctrine, pas une feature |
| **Registre de gouvernance** (`governance/**`) | 12 | `governance-category` → `komerce-governance` | Arbitrages transverses (exceptions de dépendance, cliquets, ontologie) : appartiennent à la gouvernance, pas à une feature |
| **Sous-dépôt boutique** (`public/boutique/**`) | 553 | `excluded` | Gouverné par `gen-ownership.js` / `feature-registry-check.js` du dépôt `bout`. Décision déjà actée le 2026-06-26 (Réserve 2) — deux sources de vérité divergeraient |
| **Sous-dépôt dashboards** (`public/dashboards/**`) | 158 | `excluded` | Idem. ⚠️ dette explicite : `dash` n'a pas encore de système d'ownership équivalent |
| **Documentation** (`docs/**`, `*.md`) | 98 | `governance-category` | Gouvernée par `docs-history-lint` et `registry-doc-check`, pas par propriété feature |
| **Actif statique servi** (`public/**` restant) | 97 | `governance-category` | Images, HTML servis — pas de logique, pas de frontière |
| **Espace de travail agent** (`.agent/**`) | 16 | `excluded` | Artefacts de process (ledger, livrables, captures). Ne participent ni au runtime ni aux contrats |
| **Config de dépôt** (`env.example`, `post_merge.sh`, `schema_railway.sql`) | 3 | `governance-category` | `schema_railway.sql` est un **dump généré**, pas une source : le posséder inviterait à l'éditer à la main |

**Total hors propriété feature après résorption : 962 fichiers**, tous
justifiés et catégorisés. Aucun résidu.

---

## 7. Les huit invariants à zéro — état réel et chemin

| Invariant | Aujourd'hui | Cible | Chemin |
|---|---:|---:|---|
| Classification manquante | **13** | 0 | §5 — 13 propositions, 4 cas à arbitrer |
| Nature de manifest implicite | **25** | 0 | Ajouter `nature` aux 25 manifests |
| Artefact orphelin non justifié | **4** | 0 | 3 contrats JSON (§2) + `routes/ORPHELINS_FRESH003.md` |
| Multipropriété | **0** | 0 | ✅ **déjà atteint** — 858 fichiers, aucun possédé deux fois |
| Chemin fantôme | **0** | 0 | ✅ **déjà atteint** sur le backend. Les 169 cross-dépôt à requalifier de `files:` vers `repos:` pour que la distinction soit portée par le schéma, pas par une convention |
| Dépendance inter-feature non déclarée | **19 paires** | 0 | §4.2 — 18 sont des déclarations manquantes, 1 est une inversion réelle |
| Gate défini mais non câblé | **54** | 0 | §7.1 |
| Suite présente mais inexécutable | **6** | 0 | §7.2 |

### 7.1 — 54 gates sur 73 ne gardent aucune porte

19 gates sont câblés (CI ou hooks). 54 ne le sont nulle part. Les plus lourds
de conséquence :

| Gate non câblé | Ce qu'il aurait attrapé |
|---|---|
| `feature:classification` | **Les 13 classifications manquantes** — le gate qui matérialise business/support ne tourne jamais |
| `feature:invariant:check` | Qu'un invariant déclaré n'est plus prouvé par son test |
| `feature:registry-doc` | La divergence registre ↔ disque |
| `gate:touched-tests` | Du code modifié sans signal de test |
| `gate:concept-impact`, `map:check:bail` | La dérive de la carte |
| `business-graph:ratchet-check` | La croissance du couplage |
| `testkit:check` | L'usage hors harnais |
| `predeploy` | L'ensemble, avant mise en production |

Un gate non câblé n'est pas neutre : il **rassure à tort**. C'est le même
mécanisme que l'e2e qui tournait dans le vide.

### 7.2 — 6 specs présentes et inexécutables

`tests/e2e/accessibility|cross-browser|desktop|home|navigation|search.spec.js`
importent `./helpers/boutique.helpers`, qui n'existe pas à ce chemin. Il n'y a
ni `playwright.config.js` ni `@playwright/test` à la racine, et le `testMatch`
de Jest (`**/tests/**/*.test.js`) ne les sélectionne pas. Elles ne peuvent pas
tourner et n'ont jamais tourné.

Leurs homologues vivants sont dans `public/boutique/tests/e2e/` (63 specs,
correctement câblées, harnais complet, garde anti-prod `fail-closed`). Les 6
fichiers racine sont des copies mortes. **À supprimer**, pas à réparer.

---

## 8. R2 — Dossier par coupure candidate

Vous avez demandé de ne supprimer aucune arête au seul motif qu'elle repose sur
un import unique. Voici les sept dossiers.

**Conclusion en tête : aucune des sept ne doit être supprimée.** Cinq sont des
délégations correctes qu'il faut *déclarer*. Une demande une API interne. Une
seule est une véritable inversion de sens.

---

### C-1 · `notifications → decision-signals` — **la seule vraie inversion**

- **Symbole** : `signalService.upsertSignal({...})` — `services/notifications/internals.js:37-38`
- **Besoin fonctionnel** : alimenter le radar de décision à partir de l'issue d'un envoi de notification.
- **Sens architectural attendu** : **inversé**. `decision-signals` est un observateur : il doit *écouter* des faits, pas être *appelé* par l'émetteur. Aujourd'hui `notifications` connaît le radar — un transporteur de message connaît un outil de pilotage.
- **Contrat de remplacement** : `notifications` expose un point d'émission (`contract.internalApi: [{ fn: 'onNotificationOutcome' }]`) et cesse de connaître `decision-signals` ; `decision-signals` déclare `consumes: ['notifications (observation des issues d'envoi)']` et porte l'`upsertSignal`.
- **Effet secondaire** : SCC métier 12 → 9. C'est un effet, pas la raison.

---

### C-2 · `decision-signals → logistics` — **à formaliser, pas à couper**

- **Symbole** : `computeOrderStatusDetail` — `services/radar-queries.js:41`, importé dans un `try/catch` avec **réimplémentation locale de repli** aux lignes 72-95.
- **Besoin fonctionnel** : dériver le détail de statut d'une commande à partir de ses colis, pour le radar.
- **Sens architectural attendu** : **correct**. C'est une lecture pure sur le modèle colis, qui appartient à `logistics`.
- **Ce qui est fautif** : pas la dépendance — le **repli silencieux**. Si `utils/parcels.js` cesse d'exporter la fonction, le radar bascule sur une seconde implémentation sans que rien ne rougisse. Deux vérités de statut coexistent déjà dans le dépôt.
- **Contrat de remplacement** : `logistics.contract.internalApi += { fn: 'computeOrderStatusDetail', file: 'utils/parcels.js' }` ; `decision-signals.contract.consumes += 'logistics (lecture — dérivation du statut colis)'` ; **suppression du fallback local**, remplacé par un échec franc.

---

### C-3 · `wallet → payments` — **ne pas toucher**

- **Symbole** : `markPaid(orderId, { client })` — `services/wallet-service.js:39`, appelé ligne 301.
- **Besoin fonctionnel** : quand le solde wallet couvre la totalité du reste à payer, faire basculer `orders.payment_status`.
- **Sens architectural attendu** : **exemplaire**. Le commentaire `D-02` du fichier l'écrit : *« wallet écrit `wallet_applied_kmf`, `payment-service.markPaid()` owne `payment_status` (invariant I-BACK-4) »*. C'est exactement le modèle de propriété que R3 vise — le non-propriétaire délègue au propriétaire au lieu d'écrire lui-même.
- **Contrat de remplacement** : aucun. Déclarer `payments` dans `wallet.contract.consumes` et formaliser `markPaid` dans `payments.contract.internalApi`. **Couper cette arête pour gagner 2 points de SCC détruirait la meilleure frontière du dépôt.**

---

### C-4 · `customs → economic-engine` — **à déclarer**

- **Symbole** : `require('./cost-allocation')` — `services/customs-shipment-service.js:662` (import paresseux, en fin de clôture d'envoi).
- **Besoin fonctionnel** : à la clôture d'un envoi douane, allouer le coût réel constaté aux lignes de commande (`order_item_real_cost_allocations`).
- **Sens architectural attendu** : **correct**. L'allocation de coût appartient à `economic-engine` ; `customs` la commande au moment où le coût devient connu.
- **Contrat de remplacement** : déclaration dans `consumes` + `economic-engine.contract.internalApi`. À noter : `order_item_real_cost_allocations` est écrite par `customs` **et** `economic-engine` — à traiter en R3.

---

### C-5 · `loyalty → notifications` — **à déclarer**

- **Symbole** : `notifSvc` — `services/loyalty-service.js:166` (import paresseux).
- **Besoin fonctionnel** : prévenir le client d'un changement de palier de fidélité.
- **Sens architectural attendu** : **correct et déjà majoritaire** — identique à `orders → notifications`, tranché `KEEP_AS_COMMAND_DEPENDENCY` au lot O7.2.
- **Contrat de remplacement** : déclaration dans `consumes`. Rien d'autre.

---

### C-6 · `orders → customs` — **à déclarer**

- **Symboles** : `isCustomsDeclaredForOrder` (`services/order-status-machine.js:275`) et `resolveFrozenClassification` (`routes/orders/create.js:461`).
- **Besoin fonctionnel** : bloquer une transition de statut tant que la douane n'est pas déclarée ; figer la classification douanière au moment de la création de commande.
- **Sens architectural attendu** : **correct**. `orders` lit la vérité douane pour garder son propre invariant. La direction inverse (`customs` pilotant le statut de commande) serait la faute.
- **Contrat de remplacement** : déclaration + `customs.contract.internalApi` sur les deux fonctions. `resolveFrozenClassification` mérite une attention particulière : elle **fige** une valeur, donc son contrat doit préciser l'instant de gel.

---

### C-7 · `refunds → wallet` — **à déclarer**

- **Symboles** : `walletService` — `utils/refunds.js:35` et `services/refund-service.js:36`.
- **Besoin fonctionnel** : rembourser un client en crédit wallet.
- **Sens architectural attendu** : **correct**. `refunds` décide le remboursement, `wallet` exécute le crédit et garde son idempotence.
- **Contrat de remplacement** : déclaration dans `consumes`. Point de vigilance : `utils/refunds.js` est un *utilitaire* qui commande un service métier — à promouvoir en service.

---

### Synthèse R2

| Coupure | Verdict | Gain SCC | Action |
|---|---|---|---|
| C-1 `notifications → decision-signals` | **Inverser** | 12 → 9 | Émission au lieu d'appel |
| C-2 `decision-signals → logistics` | **Formaliser** | 12 → 9 | API interne + retrait du repli |
| C-3 `wallet → payments` | **Conserver** | — | Déclarer seulement |
| C-4 `customs → economic-engine` | **Conserver** | — | Déclarer seulement |
| C-5 `loyalty → notifications` | **Conserver** | — | Déclarer seulement |
| C-6 `orders → customs` | **Conserver** | — | Déclarer seulement |
| C-7 `refunds → wallet` | **Conserver** | — | Déclarer + promouvoir l'util |

La composante fortement connexe métier passerait de **12 à 9** par les deux
seules actions justifiées architecturalement. Les 3 points restants viendraient
d'un travail de fond sur `orders ↔ logistics ↔ payments`, qui n'est pas un
problème de déclaration.

---

## 9. R3 — Modèle de propriété des données

Le but n'est pas qu'un seul fichier écrive physiquement, mais qu'**une seule
feature possède la donnée et contrôle son protocole de mutation**. Trois rôles :

| Rôle | Définition | Obligation |
|---|---|---|
| `owner` | **Une seule** feature. Définit le schéma, les invariants, et le protocole de mutation | Expose une API interne pour toute mutation faite par un tiers |
| `authorized-writer` | Feature autorisée à muter, **via l'API interne du propriétaire** ou par exception nominative sur colonnes | Déclare `via:` et `columns:` |
| `technical-writer` | Écriture ne portant aucune décision métier : DDL de démarrage, migration, backfill, purge planifiée, simulateur | Déclare `reason:` ; interdit de porter une règle |

### Schéma de manifest proposé

```js
db: {
  owns: ['wallets', 'wallet_transactions', 'wallet_credit_lots'],
  writes: [
    { table: 'orders',
      as: 'authorized-writer',
      columns: ['wallet_applied_kmf'],
      via: 'écriture directe — colonne propriété wallet',
      note: 'payment_status délégué à payments.markPaid (invariant I-BACK-4)' },
  ],
  reads: ['users', 'refunds'],
}
```

### Application à `orders`, la table la plus disputée (10 features écrivaines)

| Feature | Rôle proposé | Justification |
|---|---|---|
| `orders` | **`owner`** | Possède `order-status-machine.js`, seule autorité du cycle de vie (confirmé au lot O7.1 : *WRITER ≠ LIFECYCLE OWNER*) |
| `payments` | `authorized-writer` | `payment_status` — propriété explicite, invariant I-BACK-4 |
| `wallet` | `authorized-writer` | `wallet_applied_kmf` uniquement ; délègue `payment_status` à `payments` |
| `logistics`, `shared-cart`, `purchasing`, `customs`, `inventory` | `authorized-writer` | À qualifier colonne par colonne, puis à faire transiter par `transitionOrderStatus()` |
| `dashboard` | `authorized-writer` | Opérations admin — à restreindre nominativement |
| `platform-ops` | **`technical-writer`** | Simulateur : mutation par design de simulation, aucune autorité métier (rationale déjà écrite dans le manifest) |

### L'obstacle structurel à nommer

**169 fichiers importent `db.js` directement.** Tant que chaque feature tient
le même `pool` et écrit son SQL en ligne, le rôle `owner` est une déclaration
d'intention que rien ne défend. Le modèle à trois rôles est la bonne cible ;
sa mise en œuvre suppose au minimum que les mutations de table possédée passent
par un module de la feature propriétaire — sinon le gate ne pourra vérifier
qu'une déclaration, jamais un comportement.

Point de méthode important : les 39 tables multi-écrivaines sont **surestimées**.
Le champ `db.tables` a été généré en parsant les appels `.query()` de **tous** les
fichiers déclarés, y compris `scripts/` et `bootstrap/startup-migrations.js`.
`infrastructure` apparaît ainsi écrivaine de `finance_config`, `charges`,
`economic_snapshots` — alors que ces écritures viennent de la création de schéma
au démarrage et de scripts de correction. Avant tout cliquet sur R3, il faut
**re-générer `db.tables` sur le seul périmètre runtime** : le chiffre réel sera
sensiblement inférieur à 39.

---

## 10. Cas à arbitrer avant implémentation

### A · Qui possède `users` ?

`auth` (support proposé), `auth-identity`, `dashboard`, `infrastructure` et
`loyalty` déclarent `users` en écriture. Si `auth` est `support`, elle ne peut
pas posséder `users`. **Proposition** : `owner = auth-identity` ;
`auth` devient `technical-writer` (révocation de jeton) ; `loyalty` et
`dashboard` deviennent `authorized-writer` sur colonnes nommées.

### B · `infrastructure` est-elle classable `support` ?

Elle déclare 10 tables en écriture, dont `business_rules` (via `utils/rules.js`),
`finance_config`, `charges`, `economic_snapshots`. Trois issues :
1. Re-scoper : ces écritures partent vers `economic-engine`, `logistics`, `auth-identity` → `infrastructure` devient `support` pur.
2. Scinder : `infrastructure` (support) + une feature business qui porte les règles.
3. Assumer : `infrastructure` est classée `business-transversal` — ce que je déconseille, elle porte aussi `scripts/`, `ci/`, `assets/`.

**Recommandation : issue 1**, après re-génération de `db.tables` sur le périmètre runtime (§9).

### C · `documents` est-elle business ou support ?

Elle ne décide aucun événement métier — elle rend un artefact à partir de la
vérité des autres. Mais elle possède `transaction_documents`, et une facture est
**opposable au client**. Argument business : la propriété d'un document
transactionnel est un engagement, pas un rendu. Argument support : c'est un
moteur de gabarit. **Proposition : `business-transversal`**, par symétrie avec
`notifications` (même profil : effet externe, consommée symétriquement, ne
décide jamais l'événement).

### D · `sourcing` écrit-elle légitimement 5 tables de `catalog` ?

`sourcing` déclare **0 service** et **1 route** (`routes/sourcing-scanner.js`)
qui écrit `products`, `catalog_media`, `product_variants`, `product_skus`,
`product_sku_media` — cinq tables du domaine `catalog`. Soit `sourcing` promeut
un candidat via une API interne de `catalog`, soit la frontière entre les deux
n'existe pas. **À trancher avant classification** : le verdict change le rôle de
`sourcing` sur ces cinq tables.

---

## 11. Livrables techniques joints

| Fichier | Rôle |
|---|---|
| `tests/governance/feature-first/lib/feature-graph.js` | Extracteur de faits. Ne juge rien : lit le disque et produit le graphe. Zéro dépendance |
| `tests/governance/feature-first/lib/checks.js` | 22 contrôles positifs en 6 blocs (Ontologie, Couverture, Frontières, Interface, Preuve, Données) |
| `scripts/feature-first-conformance.js` | Runner pur node. `--facts` (graphe brut), `--json`, `--strict`. **Tourne en mode rapport : aucun cliquet normatif** |

La suite a été **déplacée de `tests/e2e/` vers `tests/governance/feature-first/`**
conformément à votre décision : ce sont des tests de conformité architecturale,
pas des E2E. Les identifiants sont passés de `E2E-FF-*` à `FF-*`. Le fichier
`baseline.json` généré lors de la passe précédente a été **supprimé**.

Mesure actuelle, sans cliquet : **15 PASS · 7 constats ouverts** sur 22 contrats.
Les 7 constats sont exactement les invariants du §7 restant à ramener à zéro.
