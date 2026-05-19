# H1 — Plan de refacto progressif de `server.js`

> Date : 2026-05-19  
> Scope : documentation uniquement  
> Branche de référence : `main`  
> Verdict : **planifier avant de coder**

---

## 1. Résumé exécutif

`server.js` est encore un point névralgique trop chargé :

- validation env ;
- configuration Express ;
- CORS / Helmet ;
- webhooks Stripe raw body ;
- middleware globaux ;
- injection auth-guard HTML ;
- static serving ;
- imports et montage de toutes les routes API ;
- routes HTML publiques et SPA fallbacks ;
- crons ;
- init wallet/routing/security ;
- migrations/seeds inline post-boot ;
- listen + graceful shutdown + crash guards.

Le fichier fonctionne et boot correctement sur Railway, donc **il ne faut pas le refactorer en une seule PR**.

H1 doit être une séquence de petites PRs réversibles, chacune avec un périmètre strict et sans déplacer les zones dangereuses trop tôt.

---

## 2. Zones critiques à ne pas casser

### 2.1 Webhooks Stripe raw body

Les trois webhooks Stripe sont montés avant `express.json` :

```js
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
```

Règle H1 : **ne pas déplacer ces lignes dans H1A**.  
Elles ne seront extraites qu'après test dédié prouvant que le body brut reste disponible.

### 2.2 Env fatales

`server.js` bloque actuellement si `DATABASE_URL` ou `JWT_SECRET` manquent :

```js
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
```

Règle H1 : extraction possible vers `bootstrap/env.js`, mais seulement dans une PR isolée avec comportement identique.

### 2.3 Migrations/seeds inline post-boot

Le serveur démarre immédiatement puis lance `fixAdminHash()`, `fixMissingSchema()`, `runAllSeeds()` et une longue série de DDL inline en `setImmediate`.

Règle H1 : ne pas déplacer cette zone dans H1A/H1B.  
Elle doit faire l'objet d'un lot séparé `H1-MIGRATIONS`, après P0 runtime PASS ou décision explicite.

### 2.4 Routes HTML / fallback SPA

Les routes HTML publiques, redirections legacy et fallback `app.get('*')` sont sensibles à l'ordre.

Règle H1 : ne pas mélanger extraction API et extraction HTML dans la même PR.

---

## 3. Découpage cible

Arborescence cible proposée :

```text
bootstrap/
  env.js                 # validateEnv(), constants env
  security.js            # helmet + cors + isAllowedOrigin
  middleware.js          # parsers, cookies, requestId, rate-limit
  stripe-raw-webhooks.js # montage raw body Stripe, plus tard
  api-routes.js          # imports + app.use('/api/...')
  html-routes.js         # routes HTML, short URLs, SPA fallback
  crons.js               # cash/backorder/collective expiration crons
  startup.js             # wallet/routing/security init, listen, shutdown
  schema-background.js   # long bloc migrations/seeds inline, plus tard
```

Le nom exact peut être ajusté, mais la logique doit rester : **une responsabilité par fichier**.

---

## 4. Séquence de PRs recommandée

### H1A — Extraire uniquement le manifest des routes API

Objectif : réduire `server.js` sans toucher aux webhooks, parsers, migrations ni routes HTML.

IN SCOPE :

- créer `bootstrap/api-routes.js` ;
- déplacer les `require('./routes/...')` API ;
- déplacer les `app.use('/api/...')` standards ;
- conserver l'ordre actuel des routes ;
- exposer une fonction `mountApiRoutes(app)`.

OUT OF SCOPE :

- webhooks raw Stripe ;
- `express.json` ;
- routes HTML ;
- static serving ;
- crons ;
- migrations ;
- listen.

Critère de validation :

```text
server.js appelle mountApiRoutes(app)
ordre des routes API inchangé
aucun changement métier
```

---

### H1B — Extraire routes HTML / SPA fallback

Objectif : isoler les routes de pages publiques et fallback.

IN SCOPE :

- créer `bootstrap/html-routes.js` ;
- déplacer `/s/:token`, `/c/:token`, `/mon-compte`, `/cart/shared`, `/account/shared-carts`, `/admin/...`, `/event/...`, `/boutique`, fallback `*` ;
- conserver exactement l'ordre.

OUT OF SCOPE :

- API ;
- webhooks ;
- static serving ;
- auth-guard injection.

Critère de validation :

```text
/api/* continue à retourner JSON 404 si inconnu
boutique fallback inchangé
routes event inchangées
```

---

### H1C — Extraire CORS / Helmet / middleware globaux

Objectif : clarifier le bootstrap sécurité.

IN SCOPE :

- créer `bootstrap/security.js` ;
- créer `bootstrap/middleware.js` ;
- déplacer `isAllowedOrigin`, `corsOptions`, `helmet(...)`, parsers, cookie, requestId, rate-limit.

OUT OF SCOPE :

- webhooks raw Stripe, sauf si test dédié présent ;
- routes ;
- migrations.

Attention : les webhooks raw doivent rester avant `express.json`.

---

### H1D — Extraire crons

Objectif : sortir cash reminders, backorder reminders et collective expiration du fichier principal.

IN SCOPE :

- créer `bootstrap/crons.js` ;
- exposer `startCrons()` ;
- garder le guard `NODE_ENV !== 'test'` pour les crons collectifs ;
- éviter les doubles démarrages.

OUT OF SCOPE :

- changer la fréquence ;
- changer la logique métier ;
- ajouter Redis/queue.

---

### H1E — Extraire env validation

Objectif : isoler les variables obligatoires/recommandées.

IN SCOPE :

- créer `bootstrap/env.js` ;
- conserver strictement le comportement fatal de `DATABASE_URL` et `JWT_SECRET` ;
- conserver warnings pour `ADMIN_PASSWORD` et `STRIPE_SECRET_KEY`.

OUT OF SCOPE :

- ajouter de nouvelles variables fatales ;
- rendre les webhooks Stripe fatals ;
- modifier Railway config.

---

### H1F — Plan séparé pour migrations inline

Objectif : ne pas coder tout de suite, seulement isoler le risque.

IN SCOPE :

- cartographier le bloc post-boot ;
- regrouper les DDL par numéros ;
- identifier doublons avec `scripts/fix-schema.js` et fichiers SQL historiques ;
- proposer `bootstrap/schema-background.js` ou `scripts/runtime-schema-reconcile.js`.

OUT OF SCOPE :

- supprimer les DDL inline ;
- basculer vers un runner SQL ;
- créer `schema_migrations` sans audit DB.

Ce lot doit venir après P0 runtime PASS ou décision explicite.

---

## 5. Tests et vérifications minimales

Avant chaque PR H1 :

```bash
npm test
```

Après chaque PR H1 :

```bash
npm run test:p0
P0_BASE_URL=<url-railway> npm run test:p0
```

À vérifier manuellement selon PR :

- `/health` ;
- `/api/health` ;
- `/api/products` ;
- `/api/orders` auth/unauth ;
- webhooks Stripe non cassés si zone concernée ;
- fallback boutique ;
- page event ;
- page admin shell.

---

## 6. Garde-fous H1

Ne jamais :

- déplacer les webhooks raw sous `express.json` ;
- modifier l'ordre des routes `/api/v2/parcels` vs `/api/v2` ;
- supprimer la redirection `/api/finance` ;
- modifier les crons en même temps que les routes ;
- modifier les migrations inline dans une PR de routes ;
- changer les variables fatales env dans un refacto mécanique ;
- transformer `server.js` en ESM ;
- mélanger H1 avec F1 logger.

---

## 7. Priorité recommandée

Ordre recommandé :

```text
1. H1A — api-routes.js
2. H1B — html-routes.js
3. H1C — security/middleware
4. H1D — crons
5. H1E — env
6. H1F — migrations inline plan séparé
```

La première PR utile est donc :

```text
H1A — extraction manifest routes API uniquement
```

---

## 8. Verdict final H1 plan

```text
H1 plan = ✅ prêt côté documentation
H1 code = non commencé
Risque principal = ordre des middlewares/webhooks/routes
Première PR exécutable = H1A api-routes manifest
```
