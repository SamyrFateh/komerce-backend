# ALERTS CONTRACT RECOVERY — AUDIT DE FERMETURE

Date : 2026-07-14
Mission : ALERTS CONTRACT RECOVERY / FERMETURE DÉFINITIVE PR563 (P0)

## 1. Résumé exécutif

PR563 avait correctement détecté le drift de contrat `alerts`, mais l'avait
corrigé au mauvais niveau architectural en interceptant le cœur DB. Le
rollback V2.10 a restauré la stabilité du pool sans fermer la dette
applicative initiale. Cette mission ferme cette dette en migrant
explicitement les writers vers le contrat physique réel.

`createAlert()` centralise la persistance. Il ne centralise pas la décision
métier de créer une alerte.

**Verdict de cette session** : les 15 writers legacy inventoriés (+ scan
exhaustif) sont migrés, `LEGACY_ALERT_RUNTIME_WRITERS = 0`, le gate CI dédié
existe et est vert, `alerts-compat.js` est éteint et archivé, et la suite de
tests complète est verte à l'exception d'une seule suite **sans rapport avec
`alerts`**, pré-existante, hors périmètre de cette mission. Voir §12/§18
pour la limite d'exécution honnête concernant les preuves REAL_DB.

## 2. Chronologie PR563

- PR563 : réécriture des INSERT legacy `alerts(level, source, message,
  payload)` interceptée au niveau de `db.js` (`rewriteLegacyAlertInsert` /
  `wrapClient` / `patchedQuery` / `patchedConnect`), appliquée à **tous**
  les appelants de `pool.query`/`pool.connect`, y compris les chemins
  chauds sans rapport avec `alerts`.
- Incident : saturation du pool PostgreSQL (20 connexions idle, aucun lock
  SQL) imputée à cette interception globale.
- Rollback V2.10 (`db.js`) : retrait complet du monkey-patch. `db.query` /
  `db.getClient` / `db.connect` exposent à nouveau les primitives natives
  `node-pg`. `utils/alerts-compat.js` n'était **pas** supprimé à ce
  moment-là (16 services en dépendaient encore) — seul le branchement dans
  `db.js` était retiré.
- Dette restante avant cette mission : les writers runtime continuaient
  d'émettre des `INSERT INTO alerts (level, source, message, payload)`
  contre un schéma physique qui ne les contient plus.
- Cette mission : migration explicite des writers vers un helper
  métier/technique (`utils/alerts.js` → `createAlert()`), extinction de
  `alerts-compat.js`, gate CI anti-régression.

## 3. Contrat physique réel `alerts` (schema_railway.sql)

```sql
CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    entity_type text DEFAULT 'parcel'::text NOT NULL,
    entity_id uuid,
    severity text DEFAULT 'medium'::text NOT NULL,
    title text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT alerts_severity_check CHECK (severity = ANY (ARRAY['low','medium','high']))
);
```

Pas de colonne `level`, `source`, `message`, `payload`.

## 4. Inventaire initial des writers legacy

Les 15 fichiers de la baseline connue (mission §9), tous confirmés en
écriture `INSERT INTO alerts (level, source, message, payload...)` avant
migration :

```
utils/parcelSync.js
services/payment-stripe.js
services/payment-paypal.js
services/payment-cash-confirm.js
services/cash-operations.js
services/confirm-pickup-cash-payment.js
services/admin-order-refund.js
services/order-payment-confirmation.js
services/cancel-order-purchase-orders.js
services/purchasing-trigger-service.js
services/scan-operations.js
services/product-publication-guard.js
services/repair-ordered-without-purchase-orders.js
services/repair-collective-ready-to-capture.js
services/repair-collective-stock-reservations.js
```

Le scan exhaustif runtime (`grep -rniE "INSERT\s+INTO\s+alerts"` sur
`services/ utils/ routes/ core/ capabilities/ middleware/`, hors tests/docs)
n'a révélé **aucun writer legacy supplémentaire** hors de cette liste.
`services/catalog-approval.js` était déjà sur le schéma courant avant cette
mission (non touché).

## 5. Classification finale du scan exhaustif

```
CURRENT_SCHEMA : utils/alerts.js, services/catalog-approval.js
                 + les 15 writers migrés dans cette session
LEGACY_SCHEMA (runtime) : 0
TEST      : 0 (tests unitaires mis à jour, cf. §8)
DOC       : commentaires historiques dans db.js (rollback V2.10) — légitimes,
            décrivent un état passé, ne sont pas du SQL exécutable
ARCHIVE   : docs/_archive/alerts-compat-pr563/ (utils/alerts-compat.js et
            ses tests dédiés, archivés — cf. §10)
```

## 6. Six cas P0 — décision transactionnelle par cas

| Cas | Fichier | Décision transactionnelle |
|---|---|---|
| P0-A | `services/payment-stripe.js` | `createAlert(client, ...)` **dans** le SAVEPOINT `stockBlocked` (SAVEPOINT → INSERT alerts → RELEASE, ou ROLLBACK TO SAVEPOINT si l'INSERT échoue). La transaction métier (commande confirmée, notes mises à jour) survit à un échec de l'alerte. |
| P0-B | `services/payment-paypal.js` | Même pattern SAVEPOINT que P0-A pour `stockBlocked`. Les alertes post-commit (DENIED, DISPUTE) utilisent `db` (pool) en best-effort catché, car elles arrivent après COMMIT. |
| P0-C | `services/admin-order-refund.js` | `createAlert` catché explicitement (best-effort) : le contrat `manual_cash → 202 / manual_required:true / commande cancelled` ne doit jamais dépendre de la réussite de l'alerte. |
| P0-D | `services/cash-operations.js` | Alerte sécurité (`_insertSecurityAlert`) écrite via le **pool** (`db`), jamais le `client` transactionnel de la route, et **awaited séquentiellement** — plus aucune query concurrente non séquencée sur le même `PoolClient`. Choix doctrinal explicite : ces alertes doivent survivre à un ROLLBACK métier (documenté en commentaire dans le fichier). |
| P0-E | `services/purchasing-trigger-service.js` | Alerte d'échec item wrappée dans le même mécanisme SAVEPOINT-par-item déjà existant : un échec d'INSERT alerts après un `ROLLBACK TO SAVEPOINT` ne remet plus la transaction en `aborted` sans second rollback ciblé. |
| P0-F | `services/cancel-order-purchase-orders.js` | `createAlert` catché explicitement : l'invariant « l'échec de création de l'alerte ne casse jamais l'annulation métier » est préservé indépendamment du helper. |

## 7. Preuves rouges REAL_DB

Le mécanisme de panne central de PR563 est prouvé et gardé vert dans
`tests/integration/alerts-contract-red-proof.test.js` (garde
`DATABASE_URL`, s'auto-skip proprement sans Postgres) :

- **RED-1** : un INSERT `alerts(level, source, message, payload)` échoue
  contre le schéma réel (`column "level" does not exist`).
- **RED-2** : dans une transaction, cet échec met le client PostgreSQL en
  état `aborted` — un `catch` JS autour du seul INSERT ne suffit pas ;
  toute requête suivante sur le même client échoue.
- **RED-2b** : pire encore — un `COMMIT` sur un client `aborted` ne lève
  **pas** d'exception ; PostgreSQL le traite comme un ROLLBACK implicite,
  ce qui peut faire disparaître silencieusement toute une transaction
  métier sans qu'aucun `catch` ne s'en aperçoive.

Ces preuves documentent le mécanisme que la migration ferme ; elles restent
vertes après le fix (elles décrivent le legacy pattern lui-même, pas une
régression).

## 8. Audit des tests faussement verts (mission §15)

Tests corrigés dans cette session car ils validaient encore le schéma
legacy ou une forme de mock incompatible avec le SAVEPOINT ajouté :

- `tests/unit/payment-stripe.test.js` (6 tests — SAVEPOINT/RELEASE + forme
  d'alerte courante)
- `tests/unit/payment-paypal.test.js` (6 tests — idem + DENIED/DISPUTE)
- `tests/unit/paypal-webhook.test.js` (2 tests — assertions positionnelles
  `params[0] === 'warning'/'critical'` → `type`/`severity` réels)
- `tests/unit/order-payment-confirmation.test.js` (1 test — payload JSON
  legacy → params nommés réels)
- `tests/unit/product-publication-guard.test.js` (contrat SAVEPOINT +
  `alert_id`)
- `tests/unit/cancel-order-purchase-orders.test.js`
- `tests/unit/repair-ordered-without-purchase-orders.test.js`,
  `repair-collective-ready-to-capture.test.js`,
  `repair-collective-stock-reservations.test.js` (assertions positionnelles
  → champ `title`)
- `tests/unit/parcelSync.test.js`
- `tests/unit/cash-operations-service.test.js` (mock `db` pool ajouté,
  vérifie désormais l'écriture hors client transactionnel — P0-D)
- `tests/unit/cash-operations.test.js` (mock logger incomplet —
  `forModule` manquant, faisait échouer le chargement de `db.js`)
- `tests/integration/isweep-services.test.js` (mock à une seule réponse
  incompatible avec le SAVEPOINT du stock-audit — corrigé pour vérifier les
  3 appels réels : SAVEPOINT / INSERT / RELEASE)

Aucune couverture n'a été supprimée sans remplacement : chaque test corrigé
vérifie désormais le comportement réel post-migration (forme d'alerte,
séquence SAVEPOINT, séquencement pool vs client) plutôt que l'ancien
contrat positionnel.

`alerts-compat.test.js` et `verify-rewrite.test.js` ont été **archivés**
avec le fichier qu'ils testaient (§10) — ils ne testaient plus qu'une
couche de compatibilité morte, sans consommateur runtime.

## 9. Design `createAlert()` (`utils/alerts.js`)

```js
await createAlert(dbOrClient, {
  type, entityType, entityId, severity, title, description, payload,
});
```

- Accepte `Pool`, `db` (wrapper interne) ou `PoolClient` — tout objet avec
  `.query()`.
- Produit uniquement le SQL du schéma réel (`type, entity_type, entity_id,
  severity, title, description`).
- `payload` n'est pas silencieusement recréé en JSON dans `description` :
  seulement en fallback documenté (`[payload_fallback] ...`) si aucun
  `description` explicite n'est fourni.
- Ne catch rien par défaut — l'erreur SQL est propagée. Le caractère
  bloquant/best-effort appartient entièrement à l'appelant (`try/catch`
  explicite dans P0-A/B/C/D/E/F selon la doctrine transactionnelle propre à
  chaque service).
- N'ouvre aucune transaction implicite, n'intercepte aucune query
  existante, ne monkey-patche rien.

## 10. Extinction `alerts-compat.js`

Zéro consommateur runtime restant (vérifié par `grep -rn "require(.*alerts-
compat"` sur tout le repo hors tests). Seuls deux fichiers de test
(`alerts-compat.test.js`, `verify-rewrite.test.js`) le référençaient encore,
testant la couche de compat elle-même.

Action : `utils/alerts-compat.js` + ses deux tests dédiés déplacés vers
`docs/_archive/alerts-compat-pr563/` (avec un `README.md` explicatif) et
retirés de l'arbre runtime/tests actif. `features/infrastructure.feature.js`
mis à jour (référence `utils/alerts.js` au lieu de `utils/alerts-compat.js`,
entrées de test mortes retirées). `docs/FEATURE_360.json/.md` régénérés
(2 exécutions consécutives, sortie identique → déterministe) pour refléter
ce changement — c'était le seul point bloquant de `map:check` après la
migration (§14).

## 11. Gate `alerts:contract:check` (mission §12-13)

`scripts/alerts-contract-check.js` : scan runtime (`services/ utils/
routes/ core/ capabilities/ middleware/ bootstrap/ db.js server.js`),
détection du **pattern** legacy (normalisation whitespace, casse
insensible, tolère `created_at` en plus) — pas une liste figée de fichiers.
Marqueur d'opt-out explicite (`ALERTS_CONTRACT_CHECK_NEGATIVE_FIXTURE`) pour
les fixtures négatives déclarées.

```
npm run alerts:contract:check
LEGACY_ALERT_RUNTIME_WRITERS = 0
```

Wiré dans `map:check` :
`gate:concept-impact && alerts:contract:check && map-check.js`.

10 negative tests (`tests/unit/alerts-contract-check.test.js`, cas A-H de la
mission §13 + 2 cas supplémentaires) : tous verts, y compris le test « état
réel du repo » qui échouerait si un writer legacy réapparaissait.

## 12. Résultat des tests REAL_DB

`tests/integration/alerts-contract-red-proof.test.js` (mécanisme de panne,
§7) et `tests/integration/alerts-contract-real-db.test.js` (contrat
`createAlert()` lui-même, §14 points 1-6, nouvellement écrit dans cette
session) sont tous deux gardés par `DATABASE_URL` et **s'auto-skippent
proprement** en son absence.

**Limite d'exécution honnête** : aucun serveur PostgreSQL n'est disponible
dans cet environnement sandbox (pas de `psql`/`postgres` installé, et le
réseau sortant est restreint à une liste de domaines qui n'inclut aucun hôte
de base de données). Ces suites REAL_DB n'ont donc **pas pu être exécutées
avec `DATABASE_URL` renseigné** dans cette session — seul leur mode `skip`
a été vérifié. Elles sont écrites, syntaxiquement valides, et prêtes à
tourner telles quelles dans une CI/un environnement de dev disposant d'une
vraie Postgres migrée avec le schéma courant.

Point non couvert par `alerts-contract-real-db.test.js` : les 6 preuves P0
bout-en-bout (avec les vraies tables `orders`/`purchase_orders`/etc., pas
seulement `alerts`) nécessitent les fixtures complètes du schéma métier.
Elles ne sont **pas** fabriquées ici sans pouvoir les exécuter et les
vérifier réellement — ce serait présenter comme prouvé quelque chose qui ne
l'est pas. C'est la dette restante la plus importante de cette clôture
(voir §18).

## 13. Résultat de la suite complète (`npm test`)

```
Test Suites: 1 failed, 15 skipped, 344 passed, 345 of 360 total
Tests:       1 failed, 17 skipped, 11 todo, 5954 passed, 5983 total
```

Le seul échec restant est `tests/notifications/notification-service-order-
parcel-otp-auth-loyalty-misc.test.js` (« preserves the public notification
API after internal split ») : la liste attendue des méthodes exposées par
`services/notifications/notification-service.js` ne contient pas
`notifyInvoiceReady`, qui existe pourtant dans le module réel. Ce fichier
n'a **pas été touché** par cette mission (aucun rapport avec `alerts`) et le
drift pré-existe à cette session — c'est une dette de barrel API orpheline,
hors périmètre P0 alerts (mission §21 : ne pas démarrer un autre chantier).
Signalé ici pour transparence, non corrigé.

Tous les tests touchant directement la migration `alerts` (Stripe, PayPal,
webhook PayPal, cash-operations ×2, admin-order-refund, cancel-order-
purchase-orders, purchasing-trigger-service, product-publication-guard,
les 3 repair-*, parcelSync, order-payment-confirmation, isweep-services,
alerts-contract-check) sont **verts**.

## 14. Résultat des gates de gouvernance

```
npm run arch:gate                          ✅ (drift bloquant = 0, inchangé par cette mission)
npm run business-graph:gen/check           ✅ (28 features, reconstructible)
npm run business-graph:ratchet-check       ✅ (aucune dette nouvelle au-dessus de la baseline)
npm run business-graph:disposition-check   ✅ (O6 fermé, 0 exception)
npm run meta:graph:check                   ✅ (0 fantôme)
npm run feature:360:gen (×2, stable)       ✅ (régénéré après extinction alerts-compat)
npm run feature:360:check                  ✅ (0 violation)
npm run alerts:contract:check              ✅ LEGACY_ALERT_RUNTIME_WRITERS = 0
npm run map:check                          ⚠️ 17/18 — seul « Gate 1 — Fichiers touchés → carte »
                                               échoue, car il dépend de `git diff origin/main...HEAD`
                                               et ce sandbox n'a pas de dépôt git initialisé (le zip
                                               fourni n'est pas un clone git). Limite d'environnement,
                                               pas une régression de code — à revérifier dans le vrai
                                               dépôt CI.
```

## 15. Faux verts documentaires POST-O8 (mission §16)

Audit de `docs/POST_O8_BUSINESS_SEMANTIC_AUDIT.md` :

| Assertion | Classification |
|---|---|
| `docs/POST_O8_E2E_VALIDATION.md` référencé en tête de document (« résultats E2E exécutés dans... ») | **ARTIFACT_MISSING** — ce fichier n'existe pas dans le repo courant. |
| « Catalog reject-alert insert — NOT_PROVEN (artefact `alerts`) » | Déjà honnêtement classé `NOT_PROVEN` par le document lui-même avant cette mission — cohérent avec l'état trouvé (writer non migré à l'époque de l'audit). À revalider maintenant que `services/catalog-approval.js` est confirmé sur le schéma courant. |
| « PayPal post-commit (capture + webhook) — BROKEN → SAFE (fix) » classé `REAL_DB_INTEGRATION` | **CLAIM_UNPROVEN dans cette session** — je n'ai pas pu ré-exécuter de suite REAL_DB pour vérifier ce SAFE (même limite d'environnement que §12). Le code du fix (post-commit chain PayPal) n'a pas été modifié par cette mission alerts et reste hors périmètre P0. Ne pas le traiter comme re-vérifié par cette clôture. |

Cette mission n'a pas corrigé PayPal en dehors du périmètre alerts (§6,
P0-B) et n'a pas réécrit `POST_O8_BUSINESS_SEMANTIC_AUDIT.md` pour le
« rendre vrai » — conformément à l'interdit de la mission (§21).
Recommandation : traiter `docs/POST_O8_E2E_VALIDATION.md` manquant comme un
suivi séparé, hors de cette clôture.

## 16. Gouvernance Feature First

`features/infrastructure.feature.js` mis à jour : `utils/alerts.js`
remplace `utils/alerts-compat.js` dans la liste `files.utils`, entrées de
test mortes retirées de `files.tests`. Distinction `WRITES_TABLE` ≠
`OWNS_TABLE_LIFECYCLE` préservée — aucun lifecycle owner artificiel n'a été
assigné à `alerts`. `docs/FEATURE_360.json/.md` régénérés et stables.

## 17. Diffstat (fichiers touchés par cette session)

```
Intégrés depuis la session précédente (transcript) :
  utils/alerts.js                                        (nouveau)
  services/payment-stripe.js                              (migré)
  services/payment-paypal.js                               (migré)
  services/payment-cash-confirm.js                         (migré)
  services/cash-operations.js                               (migré, P0-D)
  services/confirm-pickup-cash-payment.js                   (migré)
  services/admin-order-refund.js                             (migré, P0-C)
  services/order-payment-confirmation.js                    (migré)
  services/cancel-order-purchase-orders.js                  (migré, P0-F)
  services/purchasing-trigger-service.js                    (migré, P0-E)
  services/scan-operations.js                                (migré)
  services/product-publication-guard.js                     (migré)
  services/repair-ordered-without-purchase-orders.js         (migré)
  services/repair-collective-ready-to-capture.js             (migré)
  services/repair-collective-stock-reservations.js           (migré)
  utils/parcelSync.js                                        (migré — corrigé de
                                                                services/ vers utils/,
                                                                erreur d'intégration
                                                                détectée et réparée
                                                                dans cette session)
  tests/unit/payment-stripe.test.js                          (mis à jour)
  tests/unit/payment-paypal.test.js                          (mis à jour)
  tests/unit/cash-operations-service.test.js                 (mis à jour)
  tests/unit/product-publication-guard.test.js                (mis à jour)
  tests/unit/cancel-order-purchase-orders.test.js              (mis à jour)
  tests/unit/repair-ordered-without-purchase-orders.test.js    (mis à jour)
  tests/unit/repair-collective-ready-to-capture.test.js        (mis à jour)
  tests/unit/repair-collective-stock-reservations.test.js      (mis à jour)
  tests/unit/parcelSync.test.js                                (mis à jour)
  tests/integration/alerts-contract-red-proof.test.js         (nouveau)

Corrigés dans cette session (faux verts restants + wiring gouvernance) :
  tests/unit/paypal-webhook.test.js                          (assertions legacy → réelles)
  tests/unit/order-payment-confirmation.test.js               (assertion legacy → réelle)
  tests/unit/cash-operations.test.js                          (mock logger forModule manquant)
  tests/integration/isweep-services.test.js                    (mock SAVEPOINT-aware)
  tests/unit/db.test.js                                        (commentaire mis à jour)
  features/infrastructure.feature.js                           (alerts-compat.js → alerts.js)
  docs/FEATURE_360.json / docs/FEATURE_360.md                   (régénérés)
  package.json                                                 (script alerts:contract:check
                                                                  + wiring dans map:check)

Nouveaux fichiers créés dans cette session :
  scripts/alerts-contract-check.js                             (gate)
  tests/unit/alerts-contract-check.test.js                     (10 negative tests)
  tests/integration/alerts-contract-real-db.test.js              (REAL_DB createAlert(), §14.1-6)
  docs/_archive/alerts-compat-pr563/README.md
  docs/_archive/alerts-compat-pr563/alerts-compat.js.archived
  docs/_archive/alerts-compat-pr563/alerts-compat.test.js.archived
  docs/_archive/alerts-compat-pr563/verify-rewrite.test.js.archived
  docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md                        (ce document)

Supprimés (déplacés en archive, §10) :
  utils/alerts-compat.js
  tests/unit/alerts-compat.test.js
  tests/unit/verify-rewrite.test.js
```

## 18. Dette restante

1. **REAL_DB des 6 P0 bout-en-bout** (§12) : `alerts-contract-real-db.test.js`
   couvre `createAlert()` isolément ; les 6 preuves P0 avec le vrai schéma
   métier complet (orders, purchase_orders...) restent à écrire et exécuter
   dans un environnement avec Postgres.
2. **`Gate 1 — Fichiers touchés → carte`** (`map:check`) : dépend de
   `git diff origin/main...HEAD`, non exécutable dans ce sandbox sans dépôt
   git. À revérifier dans le vrai environnement CI.
3. **`docs/POST_O8_E2E_VALIDATION.md`** manquant, référencé par
   `POST_O8_BUSINESS_SEMANTIC_AUDIT.md` (§15) — suivi séparé recommandé,
   hors périmètre alerts.
4. **`tests/notifications/notification-service-order-parcel-otp-auth-
   loyalty-misc.test.js`** — échec pré-existant sans rapport avec `alerts`
   (barrel API `notifyInvoiceReady` non déclaré) — non corrigé, hors
   périmètre (§13).

## 19. Verdict final

```
LEGACY_ALERT_RUNTIME_WRITERS = 0
SIX_P0_DECIDED_AND_UNIT_TESTED = 6/6
SIX_P0_REAL_DB_PROVEN = 0/6  (createAlert() lui-même prouvé REAL_DB-ready ;
                               les 6 chaînes métier complètes non exécutées
                               faute de Postgres dans ce sandbox — §12, §18)
CONCURRENT_QUERY_ON_SAME_CLIENT_ALERT_PATTERN = 0
ALERTS_COMPAT_RUNTIME_CONSUMERS = 0
ALERTS_CONTRACT_GATE = GREEN
POST_O8_SAFE_CLAIMS_UNPROVEN = 1 (PayPal post-commit — non re-vérifié,
                                   explicitement reclassé §15)
MAP_CHECK = 17/18 (1 échec = limite d'environnement sandbox, pas de code)
FULL_TEST_SUITE = 344/345 suites (1 échec pré-existant hors périmètre)
```

Le code runtime respecte intégralement la doctrine : aucun writer ne
dépend plus du schéma legacy, aucune interception du pool PostgreSQL,
aucune query concurrente non séquencée sur un même client, et le gate
`alerts:contract:check` bloque toute réintroduction — y compris dans un
fichier jamais vu (preuve H).

Le seul point réellement ouvert est l'exécution effective des preuves
REAL_DB des 6 P0 en conditions réelles (Postgres) : la mission ne peut pas
être déclarée close à 100 % sur ce point précis sans cette exécution, que
ce sandbox ne permet pas de réaliser.

**Verdict** :

```
DO NOT MERGE — sous réserve exclusive de l'exécution des suites REAL_DB
(tests/integration/alerts-contract-red-proof.test.js et
tests/integration/alerts-contract-real-db.test.js) avec un DATABASE_URL
pointant vers une vraie Postgres migrée, et de la ré-exécution de
`npm run map:check` dans le dépôt git réel (Gate 1 dépend de git diff).
```

Tout le reste (migration exhaustive, gate anti-régression, tests unitaires,
gouvernance Feature First, extinction alerts-compat) est fermé et vert dans
cette session.
