# Audit gouvernance feature-first — 2026-07-06

Suite à une demande d'audit sans complaisance de la conformité feature-first
(code + gouvernance), deux catégories de correctifs ont été livrées : des
bugs d'outillage (gates qui ne vérifiaient pas ce qu'ils prétendaient
vérifier) et des corrections de contenu (manifestes désynchronisés du code
réel). Une problématique reste ouverte et nécessite une décision produit/tech
avant merge — voir section finale.

## 1. Ce qui a été livré

### 1.1 Bug critique — `gate:feature-audit` aveugle sur tout le backend

`scripts/feature-audit.js` résolvait les chemins déclarés par les 17
manifestes backend (`features/*.feature.js`) relativement à leur propre
dossier (`features/`) au lieu de la racine du repo. Résultat : `files-exist`
ne trouvait jamais aucun fichier et SKIPait silencieusement toutes les
vérifications de contrat backend — alors même que ce gate est **bloquant**
en CI (`carte-first.yml → gate:feature-audit`, sans `continue-on-error`). Le
gate donnait donc une fausse assurance : vert en apparence, aveugle en
pratique, sur 100 % du backend.

Corrigé : résolution différenciée par couche (`services/routes/migrations/...`
→ racine du repo ; `boutique` → `public/boutique/` ; `dash` → `public/`),
avec garde pour ne pas appliquer cette surcharge aux manifestes boutique
natifs (qui ont eux aussi une couche nommée `boutique`, mais résolue en
relatif à leur propre dossier).

### 1.2 Bug de probe — faux échecs sur tout endpoint `/:id/action`

Une fois le premier bug corrigé, un second est apparu : le checker `interface`
retirait les `:param` du chemin déclaré avant de chercher une correspondance
littérale dans le code, alors que le code Express réel écrit ses routes avec
la même notation littérale (`/:id/approve`). Conséquence : tout endpoint de
la forme `/:id/action` échouait à tort. Corrigé en conservant les `:param`
tels quels dans la sonde de recherche.

### 1.3 Multipropriété — 95 fichiers en collision

5 paires de manifestes (`auth`/`auth-identity`, `notification`/`notifications`,
`payment`/`payments`, `operations`/`platform-ops`, `wallet`/`wallet-loyalty`)
déclaraient les mêmes fichiers en double — signe d'un découpage de feature
resté inachevé. Dans chaque paire, le manifeste au nom spécifique ne
possédait aucun fichier qui lui soit propre (100 % de recouvrement avec le
manifeste large). Les fichiers communs ont été retirés des 5 manifestes
larges pour ne laisser la propriété qu'au manifeste spécifique.
Résultat : 95 → 0 fichier en multipropriété.

### 1.4 Fichiers déclarés manquants — 3 cas réels, tous résolus

- `CORRECTIONS_GOUVERNANCE_2026-07-01.md` : déplacé vers `docs/_archive/`
  (conformité Gate 5), référence mise à jour dans `features/infrastructure.feature.js`.
- `RECONCILIATION_PROD.sql` : le manifeste `infrastructure` pointait vers un
  chemin racine obsolète ; corrigé vers `migrations/_superseded/RECONCILIATION_PROD.sql`,
  son vrai emplacement, et déplacé de la couche `config` vers `migrations`.
- `docs/ops/NOTE_OPS_CALIBRATION_DENSITE_V5.md` : artefact de nommage
  (suffixe `" (1)"` d'un doublon d'upload) — fichier renommé.

### 1.5 Contrats d'interface désynchronisés du code réel — 9 cas nettoyés

Plusieurs manifestes déclaraient des entrées `contract.exposes` invalides par
construction (noms de fonctions internes mêlés à des endpoints HTTP,
annotations descriptives collées au chemin cassant le matching) :

- `auth-identity` : `'middleware requireAuth / requireVerifiedIdentity / softAuth'`
  n'était pas un endpoint et référençait une fonction (`requireAuth`) qui
  n'existe pas dans le code. Retiré d'`exposes`, reformulé dans `invariants`
  avec le vrai nom (`authenticate`, `middleware/auth.js`).
- `documents` : 4 entrées comme `'GET /api/admin/documents (liste + filtres)'`
  avaient leur annotation française collée au chemin, cassant tout matching.
  Nettoyées. Les 4 fonctions de génération (`generatePickupProof` etc.)
  n'existent pas non plus sous ces noms — les vraies exportent `issue` /
  `issueForShipment`. Déplacées vers un champ `internalApi` dédié plutôt que
  de rester dans `exposes` (qui n'a de sens que pour des endpoints HTTP).
- Corrections de nommage pur (le code fait foi) :
  - `customs` : `/api/admin/customs/shipments` → `/api/admin/customs-shipments`
  - `logistics` : `:code` → `:token`
  - `dashboard` : 7 endpoints réécrits en chemins imbriqués réels
    (`/api/dashboard/clients`, `/api/dashboard/ops`, `/api/admin/radar`,
    `/api/admin/rules`, `/api/admin/loyalty/pending`, `/api/admin/risk-provisions`) ;
    `dashboard-shared` retiré d'`exposes` — ce n'est pas une route mais un
    module utilitaire interne (`getEurKmf`, `cached`, `setCache`,
    `loadDashConfig`) importé par les autres dashboards, jamais monté seul.

### Bilan mesuré

| Gate | Avant | Après |
|---|---|---|
| Backend audité par `gate:feature-audit` | 0 feature (SKIP silencieux) | 33 features réellement vérifiées |
| Fichiers en multipropriété | 95 | 0 |
| `files-exist` en échec | invisibles (masqués par le bug 1.1) | 0 |
| `interface` en échec | invisibles, puis 111 après fix 1.1, faux positifs inclus | **9**, tous réels |

## 2. Problématique restante — décision produit/tech nécessaire

Les 9 échecs `interface` restants ne sont plus des bugs d'outillage : ce sont
de vrais écarts entre ce que les manifestes promettent et ce que le code
livre. Ils se répartissent en deux familles distinctes qui appellent des
réponses différentes.

### 2a. Endpoints jamais implémentés (dette produit)

| Feature | Endpoint déclaré | Constat |
|---|---|---|
| `catalog` | `POST /api/admin/products/:id/publish` | Aucune route ne le sert |
| `economic-engine` | `GET /api/pricing/:productId` | Aucune route ne le sert |
| `inventory` | `GET /api/inventory/:productId` | Aucune route ne le sert |
| `customs` | `POST /api/admin/customs/classify` | Aucune route ne le sert |
| `notifications` | `POST /api/notifications/send` | Aucune route ne le sert (seuls `GET /` et `GET /stats` existent) |
| `shared-cart` | `contribute`, `cash/:id/contribute`, `refund-admin/:id` | Aucun `router.post` correspondant trouvé dans `routes/shared-cart.js` |

**Décision à prendre** : soit ces endpoints doivent être développés (dette
produit réelle, potentiellement bloquante si des écrans du dashboard/de la
boutique en dépendent déjà), soit ils documentaient une intention abandonnée
et le contrat doit être retiré.

### 2b. Contrats obsolètes après refonte silencieuse (dette de doc)

| Feature | Contrat déclaré | Réalité du code |
|---|---|---|
| `orders` | `GET /api/invoices/:token` (accès par token) | `GET /api/client/invoices` (accès par session authentifiée) — mécanisme différent |
| `wallet-loyalty` | `GET /wallet/:userId`, `POST /wallet/:userId/credit`, `GET /loyalty/:userId` | API admin redessinée : `POST /admin/credit`, `POST /admin/order-credit/:orderId`, `POST /recalculate/:user_id` — aucune ne prend `:userId` dans l'URL comme documenté |

**Décision à prendre** : confirmer que la nouvelle forme (session, routes
`/admin/...`) est bien la version voulue, puis mettre à jour les manifestes
en conséquence. Risque : si un client externe (app mobile, intégration
partenaire) attend encore l'ancien contrat token-based ou `:userId`-based,
ce n'est pas qu'un problème de documentation.

### 2c. Angle mort du checker lui-même (à trancher séparément)

`dashboard` : `GET /api/hub-dash/dashboard` et `GET /api/relay/dashboard`
échouent encore, mais pour une troisième raison, différente des deux
premières : leur préfixe de montage réel vit dans `bootstrap/api-routes.js`
(`app.use('/api/hub-dash', ...)`, `app.use('/api/relay', ...)`), pas dans le
fichier de route lui-même. Le checker `interface` ne lit que le contenu des
fichiers `routes/` possédés — il ne croise jamais la table de montage du
bootstrap, donc ne peut valider aucun chemin composé à travers plusieurs
fichiers. Ce n'est pas un cas isolé : c'est une limite structurelle qui peut
cacher d'autres faux échecs (ou masquer d'autres vrais trous) ailleurs dans
le registre, pas seulement pour ces deux entrées. Corriger le checker pour
qu'il croise `bootstrap/api-routes.js` est un changement plus invasif que ce
qui a été fait ici et n'a volontairement pas été tenté dans cette passe.

## 3. Ce qui n'a pas été touché (rappel de l'audit initial)

- Gate 2 : 5 manifestes boutique (`auth`, `checkout`, `payment`, `tracking`,
  `wallet`) sans section `tests|verification|contracts`.
- `feature:check` (Feature Slice Guard) : 6 erreurs + 64 avertissements de
  fichiers de production sans test déclaré — actuellement en
  `continue-on-error` en CI avec commentaire assumé ("dette globale connue").
  Décision à prendre : le laisser en reporting, ou le rendre bloquant à
  moyen terme.
