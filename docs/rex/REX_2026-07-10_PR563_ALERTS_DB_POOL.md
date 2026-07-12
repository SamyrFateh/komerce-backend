# REX — Incident PR563 alerts-compat / DB pool

Date : 2026-07-10  
Projet : Komerce backend / boutique  
Périmètre : `db.js`, alertes legacy, pool PostgreSQL, boutique mobile

## 1. Résumé exécutif

Une correction de compatibilité des alertes legacy a été placée au niveau du cœur DB (`db.js`). Cette correction interceptait les appels `pool.query`, `pool.connect` et `client.query` afin de réécrire les anciens `INSERT INTO alerts (level, source, message, payload)` vers le schéma Railway réel.

Cette approche a transformé un problème limité d'observabilité en panne transverse : catalogue fragile, relais indisponibles, onglets instables, wallet / tracking / groupe en chargement infini.

Le retour à un `db.js` proche de l'état pré-PR563, avec pool PostgreSQL natif et sans monkey-patch, a fait réapparaître immédiatement la boutique, les relais et les onglets.

## 2. Symptômes observés

- `/api/health`, `/api/relais`, `/api/products`, `/api/categories` pendaient ou répondaient très lentement.
- Les routes sans DB répondaient vite.
- La boutique mobile affichait des erreurs ou des chargements infinis : catalogue, relais checkout, wallet, tracking, groupe.
- `pg_stat_activity` montrait environ 20 connexions venant du backend, `state=idle`, `wait_event=ClientRead`.
- `pg_blocking_pids` retournait 0 ligne : aucun lock SQL PostgreSQL.
- Après suppression des connexions zombies et rollback ciblé `db.js`, les routes DB ont répondu de nouveau en 200.

## 3. Cause racine

La cause fonctionnelle était la correction alerts-compat centralisée dans `db.js`.

Le mécanisme introduit par PR563 touchait des primitives trop basses et trop critiques :

- `pool.query`
- `pool.connect`
- `client.query`
- `db.query`
- `db.getClient`
- `db.connect`

Un problème d'alertes ne devait pas modifier la mécanique du pool PostgreSQL. Les alertes sont un sujet métier / observabilité, pas un sujet transport SQL.

## 4. Ce qui a bien fonctionné

- Diagnostic par couches : route sans DB vs route avec DB.
- Vérification PostgreSQL : `pg_stat_activity` + `pg_blocking_pids`.
- Isolation du changement central : PR563 / `db.js`.
- Rollback ciblé plutôt que rollback sauvage de toute la branche.
- Ajout de protections frontend : timeout central, états erreur, bouton Réessayer, checkout relais non confirmable si relais non chargé.

## 5. Ce qui a mal fonctionné

- Une correction métier a été placée dans `db.js`.
- Le monkey-patch du pool n'a pas été traité comme changement critique bloquant.
- Les tests validaient surtout la compatibilité alerts, pas la stabilité du pool sous charge.
- Les fichiers générés de cartographie ont produit du bruit dans le hotfix.
- Le frontend masquait initialement les pannes API par des loaders infinis, compliquant le diagnostic.

## 6. Règles d'architecture à graver

### R1 — Interdiction de monkey-patcher le pool DB pour un sujet métier

`db.js` ne doit pas être utilisé pour corriger un contrat métier ou une compatibilité de schéma applicatif.

### R2 — `db.js` doit rester minimal

Responsabilités autorisées :

- créer le pool PostgreSQL ;
- exporter `query`, `getClient`, `connect`, `pool` ;
- healthcheck ;
- monitoring minimal du pool ;
- options techniques du client PostgreSQL.

Responsabilités interdites :

- réécriture SQL métier ;
- interception globale des requêtes ;
- wrapper transactionnel générique ;
- patch de `pool.connect` ;
- patch de `client.query` ;
- logique d'alertes ou de compatibilité applicative.

### R3 — Toute PR touchant `db.js` est critique

Une PR modifiant `db.js`, `pool.connect`, `client.query`, `client.release`, ou la logique transactionnelle doit exiger :

- test `20 getClient/release` successifs ;
- test `BEGIN/ROLLBACK/release` ;
- vérification que `db.pool.connect` reste natif si aucun besoin infra explicite ;
- test `/api/health` après déploiement ;
- contrôle `pg_stat_activity` ;
- justification explicite dans la PR.

### R4 — Les alertes doivent passer par un helper métier

La correction durable des alertes doit être explicite :

```js
createAlert(dbOrClient, {
  type,
  entityType,
  entityId,
  severity,
  title,
  description,
  payload,
});
```

Les services doivent appeler ce helper, pas écrire des `INSERT INTO alerts` legacy ni déléguer la correction à `db.js`.

### R5 — Une panne API ne doit jamais laisser une vue en chargement infini

Chaque vue boutique doit finir par l'un de ces états :

- données affichées ;
- état vide ;
- gate d'authentification ;
- erreur lisible + Réessayer.

## 7. Fichiers impactés et décision

### À conserver

- `db.js` rollback ciblé pré-PR563 : pool natif.
- Timeout central `K.request`.
- State machine relais checkout.
- États erreur + Réessayer wallet/tracking/groupe.
- `query_timeout` / `keepAlive` si présents dans la configuration native du pool.
- Tests anti-loader infini.

### À éviter / ne pas réintroduire

- `rewriteLegacyAlertInsert` branché dans `db.js`.
- `wrapClient`.
- `patchedConnect`.
- `patchedQuery`.
- Réassignation de `pool.connect`.
- Réassignation de `client.query`.
- Augmentation de `DB_POOL_MAX` pour masquer une fuite.

## 8. Plan durable alertes

1. Créer `utils/alerts.js` avec `createAlert(...)`.
2. Remplacer progressivement les anciens `INSERT INTO alerts (level, source, message, payload)` dans les services.
3. Prioriser les flux critiques :
   - `services/admin-order-refund.js`
   - `services/confirm-pickup-cash-payment.js`
   - `services/payment-cash-confirm.js`
   - `services/payment-stripe.js`
   - `services/payment-paypal.js`
   - `services/catalog-approval.js`
   - `services/scan-operations.js`
   - `utils/parcelSync.js`
4. Ajouter des tests par service.
5. Supprimer ou archiver `utils/alerts-compat.js` quand tous les appelants legacy sont migrés.

## 9. Commandes de validation incident

```powershell
curl.exe --max-time 10 -i https://komerce.co/api/health
curl.exe --max-time 10 -i https://komerce.co/api/relais
curl.exe --max-time 10 -i https://komerce.co/api/categories
curl.exe --max-time 10 -i https://komerce.co/api/products
```

```sql
SELECT
  state,
  wait_event_type,
  wait_event,
  count(*)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
GROUP BY state, wait_event_type, wait_event
ORDER BY count(*) DESC;
```

## 10. Synthèse

Une correction d'alertes legacy a été placée dans le cœur DB, ce qui a transformé un problème limité d'observabilité en panne transverse boutique/API. Le retour à un pool PostgreSQL natif a immédiatement rétabli catalogue, relais et onglets. La correction durable consiste à sortir définitivement les alertes de `db.js` et à les traiter via un helper métier explicite.
