# Doctrine Feature — Komerce

> **Version** : 1.1 — 2026-06
> **Statut** : doctrine active — **sommet de la pyramide**
> **Hiérarchie** : complète `AGENTS.md` — en cas de conflit, `AGENTS.md` fait foi.
> **Registre** : `docs/doctrine/APP_FEATURE_REGISTRY.md`
> **Commande** : `node scripts/feature-registry-check.js`

---

## Pourquoi cette doctrine existe — et pourquoi elle est au sommet

La Pyramide Qualité (`QUALITY_PYRAMID_DOCTRINE.md`, niveaux 1 à 5) répond à une question :
*« ce code est-il correct ? »* — sécurité des dépendances, conventions, tests, architecture,
cohérence du slice.

Elle ne répond pas à une question plus en amont, qui doit être tranchée **avant** d'écrire
la première ligne :

> **De quelle feature métier ce code fait-il partie, quel service rend-elle,
> où s'arrête-t-elle, et qui a autorité pour en décider ?**

Sans réponse à cette question, on peut avoir un code irréprochable niveau 1 à 5 et pourtant :
- une logique métier dupliquée dans deux features qui ne se savent pas voisines ;
- une feature dont le périmètre déclaré (`features/*.feature.js`) est cohérent en interne,
  mais dont on ne sait pas si elle est la seule à exister pour ce service, ou complète ;
- un fichier qui ne correspond à aucune feature et que personne ne revendique.

C'est le rôle de cette doctrine : poser **ce qu'est une feature métier chez Komerce**,
imposer qu'elle soit enregistrée dans un **registre canonique unique**, et garantir que
toute ligne de code backend appartient à une feature déclarée — jamais à un vide.

```
                    ╔══════════════════════════════════╗
        Niveau 0    ║         FEATURE DOCTRINE         ║   ← CE DOCUMENT
                    ║  Qu'est-ce qu'une feature ?      ║     Sommet : gouverne tout en dessous
                    ║  Registre canonique exhaustif    ║
                    ╚════════════════╦═════════════════╝
                                     ▼ encadre
                    ╔══════════════════════════════════╗
        Niveau 5    ║      FEATURE SLICE DOCTRINE       ║   Découpage technique d'une feature
                    ║   (fichiers, migrations, tests)   ║   déjà reconnue par le registre
                    ╚════════════════╦═════════════════╝
                                     ▼ encadre
                    ╔══════════════════════════════════╗
     Niveaux 1-4    ║      QUALITY PYRAMID DOCTRINE     ║   Qualité du code à l'intérieur
                    ║  (deps, lint, tests, architecture)║   d'un slice déjà délimité
                    ╚══════════════════════════════════╝
```

Lecture du schéma : on ne discute pas de la qualité d'un fichier (niveaux 1-4) avant de
savoir à quel slice il appartient (niveau 5) ; on ne discute pas du slice avant de savoir
à quelle **feature métier reconnue** il appartient (niveau 0). L'ordre de lecture d'un
agent ou d'un humain qui intervient est donc : **ce document → le registre → le manifest
de la feature → le code**.

---

## Principe fondamental

> Une feature métier est un **service rendu identifiable**, pas un regroupement
> technique de fichiers qui se ressemblent.

Elle se définit par cinq propriétés, toutes obligatoires, jamais déduites :

| Propriété | Question à laquelle elle répond |
|---|---|
| **Service rendu** | Quel besoin métier, côté utilisateur ou opérateur, cette feature satisfait-elle — en une phrase ? |
| **Périmètre** | Qu'est-ce qui est dedans (fichiers, routes, tables) ? Qu'est-ce qui n'y est explicitement **pas** ? |
| **Interfaces** | Qu'expose-t-elle aux autres features ? Que consomme-t-elle chez elles ? |
| **Autorité** | Qui a le droit de trancher un changement de périmètre sans consultation ? |
| **Invariants** | Quelles règles ne bougent jamais, quelle que soit l'implémentation ? |

Une feature qui n'a pas ces cinq propriétés déclarées **n'existe pas formellement**,
même si son code tourne en production. Le code tournant sans feature déclarée est une
dette de gouvernance, au même titre qu'une route sans test est une dette de qualité.

---

## Le registre canonique — source de vérité unique

`docs/doctrine/APP_FEATURE_REGISTRY.md` est la liste exhaustive et datée de toutes
les features métier du backend Komerce. Chaque ligne du registre pointe vers un manifest
`features/<feature>.feature.js` qui porte le détail technique.

Règles du registre :

1. **Exhaustivité** : toute logique backend qui rend un service métier identifiable a une
   ligne dans le registre. Pas d'exception « petit utilitaire » — s'il rend un service, il
   est dans le registre, même rattaché à une feature existante plutôt qu'isolé.
2. **Unicité d'autorité** : un fichier appartient à une seule feature. Si un fichier sert
   deux features, c'est un signal qu'il doit être scindé ou que les deux features doivent
   fusionner — jamais une raison de le laisser sans propriétaire unique.
3. **Aucun fichier orphelin** : tout fichier de `services/`, `routes/`, `middleware/`,
   `utils/`, `validators/`, `core/` qui n'est ni transverse déclaré (auth, logger, db) ni
   rattaché à une feature du registre est une anomalie à corriger — pas à ignorer.
4. **Statut de vie explicite** : `draft` (en construction, pas encore exposée), `staging`
   (exposée en interne / beta), `production` (service réel), `deprecated` (en cours de
   retrait — ne pas y ajouter de nouvelle logique).
5. **Mise à jour synchrone** : créer, fusionner, scinder ou retirer une feature met à jour
   le registre **et** son manifest dans la même PR. Le registre qui ne reflète pas le code
   réel est pire qu'absent — il fait croire à une cartographie qui n'existe pas.

---

## Schéma de classification — nouvelle feature ou rattachement ?

> Cette section formalise les critères objectifs extraits des 16 features existantes.
> Elle répond à la question que tout développeur ou agent IA doit poser **avant d'écrire
> la première ligne** : est-ce que ce code appartient à une feature existante, ou est-ce
> qu'il justifie la création d'une feature propre ?
>
> Vérifiable par machine : `npm run feature:classification`  
> Strict en CI dès phase 3 : `npm run feature:classification:strict`

---

### Trois concepts distincts — `type`, `kind`, `decision`

| Champ | Valeurs | Rôle |
|---|---|---|
| `type` | `feature` \| `transversal` | Classification binaire historique — conservée pour compatibilité |
| `kind` | voir liste ci-dessous | Classification fine de la nature du manifest — nouvelle, machine-vérifiable |
| `decision` | `feature-autonome` \| `feature-transverse` \| `transversal-technique` \| `aggregation-lecture` \| `rattachement` | Verdict final — ce qui est actionnellement fait avec le code |

**`kind` — valeurs autorisées :**

| Kind | Description | Exemple Komerce |
|---|---|---|
| `business-feature` | Feature métier autonome, possède ses tables, son cycle de vie, son service actif | `shared-cart`, `orders`, `payments` |
| `business-transversal` | Rendu de service actif, consommée par plusieurs features, pas de domaine métier propre | `notifications`, `documents`, `refunds` |
| `technical-transversal` | Infrastructure consommée par toutes, aucune règle métier | `auth`, `operations` |
| `technical-foundation` | Socle technique qui possède le bootstrap, le DDL/migrations techniques et les primitives d’exécution, sans porter de vérité ni de règle métier | `infrastructure` |
| `aggregation-readonly` | Surface admin/pilotage en lecture pure, interdit de muter le domaine d'une autre feature | `dashboard` |
| `integration-adapter` | Adaptateur vers un système externe (Stripe, PayPal, Meta, AuthKey) | partie de `payments`, `notifications` |
| `deprecated` | En cours de retrait — aucune nouvelle logique | (cf. workflow démontage) |

> **`projection` n'est pas un `kind` assignable** au sens du schéma ci-dessus (manifests
> `backend/features/`). Une projection *backend* est un verdict de rattachement : le fichier
> appartient à une feature existante, il n'a pas de manifest propre. Créer un manifest pour
> une projection backend est une micro-feature — voir règle ci-dessous.
> Le dépôt `dash` a un schéma de classification distinct et plus simple — voir
> « Cas particulier — dépôt `dash` » ci-dessous, où `projection` **est** une valeur de
> `type` valide pour ce dépôt.

---

### Cas particulier — dépôt `dash` (kinds dash-repo)

> Ajouté au Lot O2 (2026-07-12, `BUSINESS_FEATURE_ONTOLOGY_O2`) — comble l'`ONTOLOGY_GAP`
> ouvert au Lot O1.5 : `feature-classification-check.js` (`ALLOWED_KINDS`/`ALLOWED_DECISIONS`
> ci-dessus) ne scanne que `backend/features/` et son enum ne prévoit aucune valeur pour un
> shell SPA cross-repo avec manifest propre.

Le dépôt `dash` (`public/features/`, `public/dashboards/features/`) n'a pas de fichiers
backend (`services/`, `routes/`) au sens strict : ses manifests décrivent des arbres
frontend entiers (SPA, infra partagée, legacy). Le schéma `kind`/`decision` ci-dessus,
conçu pour des manifests backend avec tables et cycles de vie, ne s'applique pas
directement. Les manifests `dash` utilisent le champ `type` (historique, valeurs
`feature` | `transversal`) étendu aux valeurs suivantes, réservées à ce dépôt :

| Valeur `type` (dash-repo) | Description | Exemple |
|---|---|---|
| `projection` | Shell SPA en lecture, 0 table propre, 0 cycle de vie propre, 0 service actif indépendant des features qu'il affiche ; les mutations HTTP observées ciblent des routes possédées par des features backend | `admin-dashboard` |
| `frontend-transversal` | Infrastructure frontend partagée hors `admin/` (auth-guard, service worker, composants partagés) — équivalent dash-repo de `technical-transversal` | `platform` |
| `deprecated` | En cours de retrait, remplacé par un autre manifest — même sémantique que le `kind` backend | `legacy-control-tower` |

Ces valeurs ne sont **pas** ajoutées à `ALLOWED_KINDS`/`ALLOWED_DECISIONS` de
`feature-classification-check.js` (qui reste backend-only) : `feature-classification-check.js`
ne couvre pas `public/**`, c'est une dette connue documentée dans
`APP_FEATURE_REGISTRY.md` §« Fichiers actuellement sans feature déclarée ». La colonne
« Classification cible » du registre canonique fait foi pour ces trois manifests en
attendant qu'un gate dédié `dash` existe.

---

### Règle anti-micro-features

Un manifest ne doit pas être créé pour :

- un fichier qui ne fait que lire des tables appartenant à une feature existante (`@db-write: (none)`) ;
- une route admin de consultation sur un domaine déjà géré en écriture ;
- un utilitaire partagé sans état ni cycle de vie propre.

Ces cas sont des **rattachements** : le fichier est ajouté au manifest de la feature hôte et la carte `files` est mise à jour. Le gate `gate:touched-files` le vérifie.

Signal d'alarme : si formuler le `service` rendu nécessite les mots "voir", "lister", "consulter", "diagnostiquer" — c'est presque toujours un rattachement.

---

### Les cinq signaux — bottom-up

Chaque signal est binaire et observable dans le code. L'arbre de décision suit après.

---

#### Signal 1 — Tables propriétaires

> *Est-ce que ce code écrit (INSERT / UPDATE / DELETE) dans des tables qui n'appartiennent
> à aucune feature déclarée ?*

Si oui → **candidat nouvelle feature**.
Si non — toutes les tables écrites appartiennent à une feature existante → **candidat rattachement**.

**Base observable** : `@db-write` dans le header `@komerce-arch` du fichier.
Un fichier qui n'écrit dans aucune table, ou qui écrit uniquement dans des tables déjà
possédées par une feature existante, ne peut pas être une nouvelle feature — il en est
une projection.

Exemples réels :
- `routes/admin/documents.js` — `@db-write: (none)`, `@db-read: transaction_documents`
  (table possédée par `documents`) → **rattachement à `documents`**. ✓
- `services/customs-shipment-service.js` — écrit dans `customs_shipments`,
  `customs_shipment_parcels` (tables absentes du registre à sa création) → **nouvelle
  feature `customs`**. ✓
- `services/cancel-shared-cart-with-refunds.js` — écrit dans `refunds`,
  `shared_cart_contributions`, `transaction_documents` (tables de 3 features existantes)
  → **rattachement à `shared-cart`** (orchestrateur principal du flux). ✓

---

#### Signal 2 — Cycle de vie propre

> *Est-ce que ce code a une state machine, une séquence de statuts, ou un invariant
> d'idempotence qui lui est propre ?*

Si oui → **candidat nouvelle feature**.
Si non — il hérite du cycle de vie d'une feature hôte → **candidat rattachement**.

**Base observable** : présence d'une machine de statut explicite, d'une séquence DB
(`CREATE SEQUENCE`), d'un invariant d'idempotence documenté dans `invariants[]`.

Exemples réels :
- `shared-cart` : 5 statuts (`OPEN → CLOSED → AWAITING_CHOICE → ORDERED / CANCELLED`),
  fenêtre 48h, idempotence webhook Stripe — **6 invariants** → feature autonome. ✓
- `documents` : idempotence `findExistingDocument` par `(type, subject_id)` +
  séquences propres (`refund_receipt_seq`, etc.) → feature autonome. ✓
- `routes/admin/documents.js` : 0 state machine, 0 idempotence propre — il appelle
  `findExistingDocument` de la feature `documents` → **rattachement**. ✓

---

#### Signal 3 — Service rendu autonome

> *Est-ce qu'un utilisateur (client, opérateur, admin) percevrait ce code comme un
> service distinct, ou comme une facette d'un service existant ?*

Si le service rendu est **identifiable indépendamment** → **candidat nouvelle feature**.
Si c'est une **projection, un accès, ou une vue** d'un service existant → **candidat
rattachement**.

**Règle pratique** : formuler le `service` en une phrase. Si la phrase contient
"voir", "lister", "consulter", "diagnostiquer", "auditer" — c'est une projection →
rattachement. Si elle contient "créer", "émettre", "calculer", "déclencher", "gérer" —
c'est un service actif → vérifier les autres signaux.

Exemples réels :
- `documents` : *"Générer un document officiel à partir d'un événement métier confirmé."*
  → verbe actif `générer`, artefact persistant, séquence propre → **feature**. ✓
- `routes/admin/documents.js` : *"Consulter l'état réel de transaction_documents
  (diagnostic + admin)."* → verbe passif `consulter`, aucun artefact créé → **rattachement
  à `documents`**. ✓
- `customs` : *"Classifier, déclarer, et analyser les droits de douane des expéditions."*
  → 3 verbes actifs, tables propres, migration dédiée → **feature**. ✓

---

#### Signal 4 — Frontière de consommation

> *Est-ce que plusieurs features existantes consommeraient ce code de façon symétrique ?*

Si oui → le code est **transversal** : soit il rejoint un domaine transversal existant
(`auth`, `operations`), soit il justifie une nouvelle feature transverse
(`notifications`, `documents`, `refunds`).

Si non — une seule feature en est le consommateur principal → **rattachement** à cette
feature.

**Base observable** : `contract.consumes` des features existantes qui appellent ce code.

Exemples réels :
- `notifications` est consommée par `orders`, `payments`, `shared-cart`, `refunds` de
  façon symétrique → **feature transverse**. ✓
- `documents` est consommée par `orders`, `customs`, `wallet`, `refunds` → idem. ✓
- `services/customs-analytics.js` est consommée uniquement par `customs` →
  **rattachement à `customs`**. ✓

---

#### Signal 5 — Migrations dédiées

> *Est-ce que ce code nécessite de nouvelles tables ou colonnes sans précédent dans le
> schéma ?*

Si oui → **candidat nouvelle feature** (une feature sans migration propre est souvent un
rattachement mal positionné).
Si non → **rattachement**.

**Base observable** : migrations déclarées dans `files.migrations[]`. Une seule feature
dans le projet (à ce jour) ne déclare aucune migration propre tout en étant une feature
à part entière : `refunds` — parce qu'elle écrit dans la table `refunds` créée par la
migration globale, et que son cycle de vie ne nécessite pas de table supplémentaire.
C'est une exception documentée, pas la règle.

---

### Arbre de décision

```
┌─────────────────────────────────────────────────────────────────────┐
│  Ce code écrit-il dans des tables qui n'appartiennent à aucune      │
│  feature déclarée ? (Signal 1)                                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
              OUI                  │                NON
               ▼                   │                 ▼
   ┌───────────────────────┐       │   ┌─────────────────────────────┐
   │  A-t-il un cycle de   │       │   │  Plusieurs features en sont │
   │  vie propre (machine  │       │   │  les consommatrices symé-   │
   │  de statuts, séquence │       │   │  triques ? (Signal 4)       │
   │  idempotence) ?       │       │   └──────────────┬──────────────┘
   │  (Signal 2)           │       │                  │
   └──────────┬────────────┘       │       OUI        │       NON
              │                    │        ▼         │        ▼
     OUI      │      NON           │  ┌──────────┐   │  ┌──────────────┐
      ▼        │       ▼            │  │ FEATURE  │   │  │ RATTACHEMENT │
┌──────────┐  │  ┌──────────────┐  │  │transverse│   │  │ à la feature │
│ FEATURE  │  │  │ RATTACHEMENT │  │  │          │   │  │ propriétaire │
│          │  │  │ — probablement│  │  └──────────┘   │  └──────────────┘
│ Créer un │  │  │ à la feature  │  │                 │
│ manifest │  │  │ qui possède   │  │                 │
│ dédié    │  │  │ ces tables    │  └─────────────────┘
└──────────┘  │  └──────────────┘
              │
              ▼
  ┌────────────────────────────────────────────────────────┐
  │  Le service rendu est-il autonome et actif ? (Signal 3) │
  └──────────────────────┬─────────────────────────────────┘
                         │
              OUI        │        NON
               ▼         │         ▼
         ┌──────────┐    │   ┌──────────────┐
         │ FEATURE  │    │   │ RATTACHEMENT │
         └──────────┘    │   └──────────────┘
                         └──────────────────
```

---

### Cas limite — le fichier hybride

Un fichier est dit **hybride** s'il combine une projection lecture seule (→ rattachement)
avec une mutation qui lui est propre (→ feature). Règle : regarder le `@db-write`.

- Si `@db-write: (none)` → rattachement, même si le fichier est complexe.
- Si `@db-write` pointe vers des tables existantes possédées par une feature → rattachement
  à cette feature, le fichier en est une extension opérationnelle.
- Si `@db-write` pointe vers des tables nouvelles → feature.

Un fichier ne peut pas être à moitié dans une feature et à moitié dans une autre.
Si l'analyse révèle un hybride irréductible, le fichier est **trop couplé** : le scinder
est la bonne réponse, pas l'ignorer.

---

### Tableau récapitulatif — features existantes classifiées

| Feature | Signal 1 (tables propres) | Signal 2 (cycle de vie) | Signal 3 (service actif) | Signal 4 (multi-consommatrices) | Signal 5 (migrations) | Verdict |
|---|---|---|---|---|---|---|
| `shared-cart` | ✅ 6 tables | ✅ 5 statuts, 6 invariants | ✅ | — | ✅ 8 migrations | Feature |
| `orders` | ✅ orders, order_items… | ✅ state machine | ✅ | — | ✅ | Feature |
| `payments` | ✅ stripe/paypal events | ✅ idempotence webhook | ✅ | — | ✅ | Feature |
| `customs` | ✅ customs_shipments… | ✅ workflow déclaration | ✅ | — | ✅ 3 migrations | Feature |
| `documents` | ✅ transaction_documents | ✅ idempotence + séquences | ✅ générer | ✅ 4 features | ✅ | Feature transverse |
| `notifications` | ✅ notification_log | ✅ | ✅ émettre | ✅ toutes | ✅ | Feature transverse |
| `refunds` | ⚠️ table partagée | ✅ idempotence anti-double | ✅ rembourser | ✅ orders/shared-cart/wallet | — | Feature transverse (exception Signal 5) |
| `dashboard` | ❌ lecture seule | ❌ | ⚠️ agréger + opérations admin | ✅ toutes (lecture) | — | Feature `business-transversal` (routes hub/relay écrivent — pas strictement readonly) |
| `routes/admin/documents.js` | ❌ db-write: none | ❌ | ❌ consulter | ❌ | — | **Rattachement** à `documents` |
| `services/customs-analytics.js` | ❌ lecture seule | ❌ | ❌ analyser (passif) | ❌ (customs seul) | — | **Rattachement** à `customs` |

> `dashboard` est un cas sui generis : feature d'agrégation en lecture pure, sans table
> propriétaire, dont la raison d'être est de consolider toutes les autres. Elle existe
> comme feature propre parce qu'elle a un cycle de vie UI indépendant (vues, SPA, rôles
> admin/hub/relais distincts) et des invariants propres ("ne jamais écrire dans le domaine
> d'une autre feature"). Ce n'est pas un template reproductible — c'est une exception
> documentée.

---

### Ratchet — adoption progressive de `classification`

La classification est **optionnelle aujourd'hui, obligatoire demain**. Le script
`feature-classification-check.js` applique le ratchet suivant :

| Phase | Condition | Comportement du script |
|---|---|---|
| **Phase 1** (actuelle) | `classification` absent sur la majorité des manifests | Warning-only — rapport lisible, pas d'exit(1) |
| **Phase 2** | `classification` présent sur un manifest modifié | `--strict` requis localement pour ce manifest |
| **Phase 3** | Backfill terminé par domaine | `--strict` activé par domaine (`map:check`) |
| **Phase 4** | Tous les manifests classifiés | `--strict` global en CI |

La phase 1 est active. Passer en phase 2 = ajouter `classification` dans la même PR que le
premier changement d'un manifest non encore classifié. Ne pas backfiller le repo entier en
une seule PR.

---

### Règle de mise à jour de cette section

Ce schéma est **inductif** : il a été construit à partir des 16 features existantes, pas
déduit a priori. S'il entre en contradiction avec un cas réel futur, c'est le schéma qui
doit évoluer — pas le cas qu'on tord pour lui faire rentrer dans la grille. Toute mise à
jour de cette section suit les mêmes règles que le registre : même PR que le code, trace
dans `STATUS.md`.

---

## Distinguer feature métier et domaine technique transversal

Tous les `@domain` présents dans les headers `@komerce-arch` ne sont pas des features
métier au sens de cette doctrine. Deux catégories existent et ne se gouvernent pas pareil :

| Catégorie | Définition | Gouvernance |
|---|---|---|
| **Feature métier** | Rend un service de bout en bout à un utilisateur ou un opérateur (ex. `orders`, `shared-cart`, `payments`) | Manifest complet (service, périmètre, interfaces, autorité, invariants) |
| **Domaine technique transversal** | Infrastructure consommée par plusieurs features, ne rend pas de service métier en soi (ex. `auth`, `logger`, `db`) | Documenté dans le registre comme **transversal**, périmètre et invariants déclarés, mais pas de notion de service métier autonome |

Le registre déclare explicitement chaque entrée comme `feature` ou `transversal`.
Confondre les deux est l'erreur la plus fréquente : un domaine transversal qui s'étend
silencieusement pour absorber de la logique métier devient un point de couplage caché.

---

## Le manifest — format canonique enrichi

Le format défini par `FEATURE_SLICE_DOCTRINE.md` (périmètre fichiers, contrat, invariants)
reste la base technique. Cette doctrine y ajoute les champs **obligatoires au niveau
métier**, vérifiés par `scripts/feature-registry-check.js` :

```js
module.exports = {
  // ── Identité (déjà requis par FEATURE_SLICE_DOCTRINE) ──
  name: 'orders',
  domain: 'orders',
  status: 'production',
  owner: 'backend-core',
  since: '2025-09',

  // ── Niveau métier (requis par FEATURE_DOCTRINE) ──
  service: 'Faire exister une commande, de la création au statut final, ' +
           'avec un coût figé et une référence lisible.',

  perimeter: {
    in:  [
      'création, annulation, snapshot de coût, machine de statut de la commande',
      'rattachement aux colis et aux achats fournisseurs',
    ],
    out: [
      'paiement lui-même (feature payments)',
      'logique panier partagé (feature shared-cart, qui consomme orders)',
      'remboursement (feature refunds, qui consomme orders en lecture)',
    ],
  },

  authority: 'backend-core — tout changement de statut ou de schéma de commande ' +
             'doit être validé par le propriétaire de order-status-machine.js',

  // ── Déjà requis par FEATURE_SLICE_DOCTRINE ──
  files: { services: [...], routes: [...], migrations: [...], tests: [...] },
  contract: { exposes: [...], consumes: [...] },
  invariants: [...],
};
```

`perimeter.out` est le champ le plus important du document. Une feature qui ne sait pas
dire ce qu'elle **ne fait pas** n'a pas de périmètre — elle a une zone d'influence floue
qui finira par se chevaucher avec sa voisine.

---

## Ce que cette doctrine garantit en pratique

Pour un agent IA ou un développeur qui doit toucher une feature :

1. Ouvrir `docs/doctrine/APP_FEATURE_REGISTRY.md` → trouver la feature concernée.
2. Lire son manifest `features/<feature>.feature.js` → connaître service rendu, périmètre
   exact, interfaces avec le reste, autorité, invariants.
3. Modifier en restant dans `perimeter.in` ; si la modification touche `perimeter.out`,
   c'est un signal d'arrêt — soit la modification est mal placée, soit le périmètre doit
   être renégocié explicitement (mise à jour du registre, pas contournement silencieux).
4. Lancer `node scripts/feature-registry-check.js --strict` avant `node scripts/feature-guard.js --strict` :
   le registre garantit que la feature existe et que ses fichiers sont déclarés ; le guard
   garantit que le slice lui-même est cohérent.

Réagir 100 fois plus vite qu'un concurrent sur un ajustement ne vient pas de coder plus
vite — ça vient de ne jamais se demander *« où est-ce que ça vit, et est-ce que j'ai le
droit de le changer ici »*. Cette question est répondue avant que l'agent ouvre un fichier,
pas pendant qu'il le modifie.

---

## Ordre de gouvernance complet (rappel)

```
0. FEATURE_DOCTRINE.md + APP_FEATURE_REGISTRY.md   ← la feature existe, est unique, a un périmètre
   node scripts/feature-registry-check.js --strict

5. FEATURE_SLICE_DOCTRINE.md + features/<x>.feature.js  ← le slice est cohérent et complet
   node scripts/feature-guard.js --strict

1-4. QUALITY_PYRAMID_DOCTRINE.md                         ← le code à l'intérieur est correct
   npm run audit:gate / quality:gate / test / arch:gate
```

---

## Règle de mise à jour de cette doctrine

Toute nouvelle feature métier identifiée doit recevoir une ligne dans le registre et un
manifest avant son premier merge en `production`. Toute scission, fusion ou dépréciation
de feature met à jour le registre dans la même PR que le code.

Cette doctrine ne change pas avec chaque feature — elle change quand la **définition même**
de ce qu'est une feature chez Komerce évolue. C'est volontairement le document le plus
stable de la pyramide.
