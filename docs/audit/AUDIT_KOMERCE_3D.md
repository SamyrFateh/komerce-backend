# Audit Komerce — 3 dimensions : Backend · Dashboards · Boutique

> **Date** : 11 juin 2026
> **Périmètre** : archives livrées `Backend.zip` (komerce-backend v10.6.1, 583 fichiers), `Dasboards.zip` (141 fichiers, PWA), `Boutique.zip` (194 fichiers).
> **Méthode** : lecture des documents canoniques (`CARTOGRAPHY_360`, `ZONE_IMPACT`, `SCHEMA`, `STATUS`), de `server.js`, `package.json`, des routes/services, et des points de contact API des deux frontends. Les findings s'appuient sur le code et la doc livrés ; ils ne remplacent pas une exécution réelle ni un dump DB live.
> **Nature** : audit fonctionnel et d'architecture, centré sur les **coutures** entre les trois dimensions. Ce n'est pas un avis juridique ni financier.

---

## 1. Résumé exécutif

Komerce est un système e-commerce **« colis-first »** pour la diaspora comorienne : commande depuis l'Europe (paiement EUR), logistique hub → transit → relais aux Comores, retrait par code/QR, prix affichés en KMF. Le socle est **sérieux et mature** : machine d'état commande unique, hub de paiement unique, idempotence Stripe, wallet immuable, moteur de pricing lisant la DB, et surtout une **culture de documentation rare** (4 documents socle + 10 invariants métier + ADR + audits successifs).

Le risque n'est donc pas dans la qualité unitaire de chaque dimension. **Il est dans les coutures** : les trois projets sont livrés séparément mais conçus pour vivre ensemble en *same-origin*, sans contrat d'API vérifiable, avec un couplage de build dur, et un déséquilibre fort de couverture de tests (backend 26 fichiers de test, boutique 1, dashboards 0). C'est là que se logent les pannes silencieuses en production.

**Verdict** : socle **GO conditionnel** (cohérent avec l'audit interne du 2026-06-08). Pour passer de « ça marche » à « vrai succès durable », l'effort prioritaire n'est pas d'ajouter des fonctionnalités, mais de **solidifier les jointures** : contrat d'API, orchestration de déploiement, tests de bout-en-bout traversant les 3 couches, et hygiène de release.

| Dimension | Maturité fonctionnelle | Maturité technique | Risque principal |
|---|---|---|---|
| Backend | Élevée | Élevée (sauf `server.js`) | `server.js` god-file + DDL runtime |
| Dashboards | Moyenne-élevée | Moyenne | 0 test · cache PWA manuel |
| Boutique | Élevée | Moyenne | Code « zombie » déprécié · 1 seul test E2E |
| **Coutures** | — | **Faible-moyenne** | **Pas de contrat d'API · couplage build · same-origin implicite** |

---

## 2. Vue d'ensemble — l'architecture en 3 dimensions

```
        DIASPORA (EUR)                          COMORES (KMF)
   ┌───────────────────┐                  ┌────────────────────┐
   │   BOUTIQUE         │                  │   DASHBOARDS        │
   │  (storefront SPA)  │                  │  admin · hub ·      │
   │  catalogue, panier │                  │  relais · transit · │
   │  panier partagé,   │                  │  transitaire        │
   │  checkout, suivi   │                  │  (Control Tower)    │
   └─────────┬──────────┘                  └─────────┬──────────┘
             │  fetch /api  (cookies, same-origin)   │
             └──────────────────┬────────────────────┘
                                ▼
                  ┌──────────────────────────────┐
                  │          BACKEND              │
                  │  Express · PostgreSQL · Redis │
                  │  ~80 routes · 93 tables       │
                  │  moteurs : pricing, wallet,   │
                  │  routing, sourcing, coût,     │
                  │  order-status-machine, scans  │
                  │  Stripe / PayPal / cash       │
                  └──────────────────────────────┘
```

**Fait structurant** : les deux frontends appellent l'API en **chemins relatifs** (`/api/...`) avec `credentials: 'include'`. Le client boutique défaut sur `window.location.origin`. Conséquence : **les trois dimensions sont conçues pour être servies depuis la même origine** (le backend sert `public/boutique` et `public/dashboards`). C'est la couture la plus structurante de tout le système (cf. §6).

---

## 3. Dimension 1 — Backend (`komerce-backend` v10.6.1)

### 3.1 Fonctionnalités métier

| Domaine | Capacités | Sources de vérité |
|---|---|---|
| **Catalogue** | Produits, variantes, catégories, modules cérémonie (tissus, modèles, couture, lunettes) | `routes/products.js`, `routes/modules.js`, tables `products`, `product_variants`, `fabrics`, `garment_models` |
| **Commande** | Cycle de vie 11 statuts (`pending → … → collected`), colis-first | `services/order-status-machine.js` |
| **Paiement** | Stripe, PayPal, cash, wallet, panier partagé — **hub unique** | `services/order-payment-confirmation.js`, `routes/payments.js` |
| **Wallet / avoirs** | 1 wallet/user, lots FIFO, transactions immuables, contrepassation | `services/wallet-service.js` |
| **Pricing** | `survival_price`, `minimum_safe_price`, `recommended_price`, `test_market_price`, `health_status`, `sourcing_decision` — lit la DB, pas de coefficient dur | `services/pricing-engine.js` |
| **Sourcing / coût / risque** | Scanner sourcing, allocation des coûts, provisions risque, matrices/composantes pricing | `services/sourcing-*`, `cost-allocation.js`, `routes/admin-*` |
| **Logistique** | Colis = unité autonome, scans terrain, hub Dubai/inventaire, transit, transitaire, transporteurs, relais | `routes/parcel-api-v2`, `services/scan-engine.js`, `routing.js` |
| **Retrait** | Code retrait + QR signé, preuve de collecte | `routes/pickup-secret.js`, `services/parcel-security.js`, `verify-qr-collection.js` |
| **Panier partagé** | Flux boutique-first « payer en groupe », contributions Stripe, finalisation explicite | `services/shared-cart-engine.js`, `routes/shared-cart.js` |
| **Fidélité** | Badges, points | `routes/loyalty.js`, `services/loyalty-service.js` |
| **Douane** | Catégories douane, shipments, cohérence des taux | `routes/admin-customs-*`, ADR-001/004 |
| **Notifications** | OTP, SMS, WhatsApp, e-mail, log applicatif | `services/notification-service.js`, tables `notification_log`, `sms_log` |
| **Simulateur** | Scénarios bout-en-bout pour tester le système | `services/simulator/*` |

### 3.2 Forces

- **Invariants métier explicites et tenus** (I-01 à I-10). L'audit interne du 2026-06-08 confirme que I-01 (machine d'état), I-02 (hub paiement) et I-07 (idempotence Stripe) sont rigoureusement respectés.
- **Idempotence** structurée : `stripe_events_processed`, transitions forward-only, créations wallet idempotentes.
- **Traçabilité** : toute transition laisse une trace dans `order_status_history` ; toute notification dans `notification_log`/`sms_log`.
- **Sécurité de base solide** : `helmet` + CSP, CORS contrôlé, rate-limiting global + spécialisé, JWT 2h, bcrypt, webhooks Stripe en body brut avant `express.json`, `REQUIRED_ENV` qui fait échouer le boot si une variable manque.

### 3.3 Faiblesses (déjà connues du projet, à confirmer prioritaires)

- **`server.js` = god-file (~1200 lignes)** : montage de ~80 routes, ordre critique des middlewares, **92 instructions DDL inline** exécutées au boot (`setImmediate(fixMissingSchema)`), 3 webhooks Stripe. `ZONE_IMPACT` le documente comme le point névralgique. La migration de schéma « runtime ad-hoc » est un anti-pattern à risque (un boot peut muter la prod).
- **Mot de passe admin par défaut** (`Komerce2026!`) codé dans la migration `fixAdminHash()` de `server.js` ; rotation via `ADMIN_PASSWORD` documentée mais **action manuelle non garantie** (`SECURITY_CHECKLIST.md`).
- **Ambiguïté de provider notifications** : `.env.example` cite Africa's Talking **et** Twilio ; la cartographie cite Authkey (webhook WhatsApp entrant **non authentifié**, IP-whitelist seulement *recommandée*) et Meta (`meta-whatsapp.js`). Plusieurs providers selon les époques — **lequel est réellement actif en prod ?** Critique car OTP et panier partagé en dépendent.
- **Dérive de version** : `package.json` 10.6.1, en-tête `server.js` 10.6.1 mais changelog interne mentionnant v11.2 / v12.x, `/api/health` renvoie `npm_package_version`. Hygiène de release à reprendre.

---

## 4. Dimension 2 — Dashboards (Control Tower, PWA)

### 4.1 Fonctionnalités métier

| Surface | Rôle |
|---|---|
| `dashboards/admin/index.html` | Back-office moderne : pilotage, finance, costing, application des prix, radar/alertes, douane, fournisseurs, vue clients |
| `dashboards/admin-legacy/control-tower.html` | Control Tower historique (cohabitation legacy/moderne) |
| `hub/index.html` | Opérations hub : buffer, colis ouverts, propositions de regroupement, scan-assign, stats inventaire |
| `relais/index.html` | Dashboard point relais (retraits, codes) |
| `login.html` | Authentification back-office |

Endpoints consommés (échantillon réel) : `/api/auth/me`, `/api/orders?limit=500`, `/api/hub/inventory/*`, `/api/transitaire/*`, `/api/admin/costing/{orders,products,relais}`, `/api/pricing/apply-price/`, `/api/unsold/stats/summary`, `/api/admin/customs-categories`.

### 4.2 Forces

- **Garde d'authentification propre** (`js/auth-guard.js`) : session cookie via `/api/auth/me`, redirection `/login.html?next=…`, **intercepteur global `fetch`** qui renvoie au login sur 401 hors route de login. Bon réflexe de sécurité côté front.
- **PWA** (manifest + service worker) : utile pour des opérateurs terrain (hub, relais) avec réseau instable, fallback hors-ligne.

### 4.3 Faiblesses

- **Zéro test** sur les dashboards. C'est la couche qui pilote l'argent (finance, application des prix, costing) et la logistique (scan-assign) — l'absence de filet est le risque le plus sous-estimé.
- **Cache PWA versionné à la main** (`sw.js` : `CACHE = 'komerce-v327'`). Si le numéro n'est pas incrémenté à chaque déploiement, des opérateurs travaillent sur une **version périmée** du tableau de bord — incidents difficiles à diagnostiquer.
- **Cohabitation admin moderne / admin-legacy** : deux surfaces back-office, source possible de divergence de comportement et de double maintenance.

---

## 5. Dimension 3 — Boutique (storefront)

### 5.1 Fonctionnalités métier

Catalogue + sous-catégories, fiche produit (modal/PDP) avec social proof et suggestions, panier (mini-cart + modal), checkout **Stripe & PayPal**, **panier partagé « payer en groupe »** avec partage WhatsApp, **identité OTP/WhatsApp** (`/api/auth/otp/{request,verify}`), suivi commande, favoris, accueil premium, salutation fidélité (« Kwezi … »), prix KMF, promesse « retrait relais / livraison incluse aux Comores ».

Architecture front : ~65 modules source `b-*.js` + **bundle esbuild** (`js/dist/`), bus d'événements interne (`b-bus.js`), wrapper API `window.K.request` (`b-utils.js`) qui défaut sur l'origine courante.

### 5.2 Forces

- **Doctrine produit claire et tenue** : *« tout commence, se comprend et revient dans la boutique »*. Le panier partagé est une capacité de la boutique, pas un système parallèle — décision saine, documentée dans `STATUS.md`.
- **Parcours « waouh » soigné** : modales type marketplace, suggestions, identité légère sans friction (OTP WhatsApp, pas d'e-mail tant que ce n'est pas nécessaire).
- **Pipeline CSS/build** outillé (`deploy-css.js`, `audit-boutique-arch.js`).

### 5.3 Faiblesses

- **Code « zombie » du flux collectif déprécié encore présent** : `event-pay.js`, `event-public.js`, `event-manage.js`, `collective-ready-to-order-orchestrator.js`, `b-cart-groups-tab.js`, `b-friendly-group-redirect.js`. Or le backend renvoie `410 collective_workspace_disabled` et `/event/*` redirige vers `/boutique`. Ces fichiers chargés mais branchés sur des routes mortes = **bugs latents et confusion** pour le prochain dev.
- **Couverture de test quasi nulle** : 1 spec Playwright. Pour le tunnel d'achat et le panier partagé (où circule l'argent), c'est insuffisant.
- **Source `b-*.js` + bundle `dist/` côte à côte** : risque de servir un bundle désynchronisé de la source si le build n'est pas systématique au déploiement.

---

## 6. Les coutures entre les 3 dimensions *(le cœur de l'audit)*

C'est ici que se décide le succès ou l'échec opérationnel. Sept coutures identifiées.

### Couture 1 — Same-origin implicite (cookies + CORS)
Les deux frontends appellent `/api` en relatif avec cookies. **Tout repose sur un déploiement same-origin** (frontends servis par le backend depuis `public/`). Déployer la boutique ou les dashboards sur un domaine séparé (CDN, sous-domaine) **casserait silencieusement** la session (cookies cross-site) et exigerait un CORS + une stratégie de token différents. Cette dépendance est **implicite et non documentée comme contrainte de déploiement**.
→ *Risque : élevé. Une « simple » migration d'hébergement front fait tomber l'auth.*

### Couture 2 — Couplage de build dur backend ↔ boutique
`npm start` du backend = `npm run build && node server.js`, et `build` = `node public/boutique/scripts/deploy-css.js`. Les scripts `boutique:audit` / `boutique:arch` vivent **dans** `public/boutique/`. **Dans le zip livré, `public/` est vide** : en l'état, `npm start` échoue. Autrement dit, **le backend ne peut pas démarrer sans que la boutique ait été déposée dans son arborescence**. Trois repos séparés, mais un assemblage obligatoire au déploiement, non outillé ici.
→ *Risque : élevé. Couplage de cycle de vie non géré ⇒ déploiements fragiles et non reproductibles.*

### Couture 3 — Aucun contrat d'API vérifiable
Les frontends codent en dur des chemins **et des noms de champs** : `total_kmf_snapshot`, `contributed_kmf`, `remaining_kmf`, `settlement_open`, `metadata.settlement_open`, etc. Il existe des contrats *documentaires* (`BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md`) mais **rien de machine-vérifiable** (pas d'OpenAPI, pas de types partagés). Un renommage backend casse le front **sans erreur de compilation**, détecté seulement en production.
→ *Risque : élevé et systémique. C'est la dérive de contrat — la cause n°1 de régressions silencieuses dans ce type d'archi.*

### Couture 4 — Deux modèles d'authentification sur une même colonne vertébrale
Dashboards = session cookie + intercepteur 401 → `/login.html`. Boutique = session cookie + **identité invitée + OTP WhatsApp** + auth client. Même backbone `/api/auth`, deux UX et deux cycles de vie de session. La page `/login.html` vit dans le repo dashboards, l'API dans le backend : **la moindre évolution du contrat d'auth doit être coordonnée sur trois repos**.
→ *Risque : moyen. Surface de coordination large, peu visible.*

### Couture 5 — Trois systèmes de « partage » coexistants
`/api/shares` (partage simple), `/api/shared-carts` (panier partagé MVP, le flux actif), et `collective-*` (**déprécié, 410**). Le backend a fait le ménage (tombstones, redirections), **mais la boutique porte encore le code front du flux déprécié** (cf. §5.3). Risque de réactiver par erreur un chemin mort, ou d'afficher un parcours qui finit en 410.
→ *Risque : moyen. Dette de cohérence inter-couches.*

### Couture 6 — La doc backend décrit une boutique qui vit ailleurs
`backend/docs/boutique/*` (architecture, contrats, pipeline CSS, redesign) documente un frontend qui est **un repo séparé**. La doc et le code réel peuvent diverger sans détection. Les `docs/_archive/PATCH_BOUTIQUE_*` montrent que ça arrive déjà.
→ *Risque : moyen. La doc canonique peut mentir sans qu'on le sache.*

### Couture 7 — Cohérence des déploiements (PWA + bundle + version)
Cache PWA dashboards manuel (`v327`), bundle boutique `dist/` à régénérer, version backend dérivante (10.6.1 vs 11.2 vs 12.x). Sans **version unique partagée** et invalidation de cache automatique, un déploiement laisse un mélange de versions client/serveur en circulation.
→ *Risque : moyen. Diagnostics d'incidents rendus très difficiles.*

---

## 7. Matrice des risques

| # | Finding | Dimension | Sévérité | Effort |
|---|---|---|---|---|
| R1 | Pas de contrat d'API vérifiable (dérive silencieuse) | Coutures | 🔴 Critique | Moyen |
| R2 | Couplage build backend↔boutique + `public/` non assemblé | Coutures | 🔴 Critique | Moyen |
| R3 | Same-origin implicite non documenté comme contrainte | Coutures | 🟠 Élevé | Faible |
| R4 | `server.js` god-file + 92 DDL runtime au boot | Backend | 🟠 Élevé | Élevé |
| R5 | Provider notifications ambigu + webhook Authkey non authentifié | Backend | 🟠 Élevé | Moyen |
| R6 | Mot de passe admin par défaut (rotation manuelle) | Backend | 🟠 Élevé | Faible |
| R7 | Code front « zombie » du flux collectif déprécié | Boutique | 🟡 Moyen | Faible |
| R8 | Tests : backend 26 / boutique 1 / dashboards 0 — aucun E2E inter-couches | Coutures | 🟠 Élevé | Élevé |
| R9 | Cache PWA manuel (clients périmés) | Dashboards | 🟡 Moyen | Faible |
| R10 | Dérive de version (pas de source unique) | Coutures | 🟡 Moyen | Faible |
| R11 | Cohabitation admin moderne / legacy | Dashboards | 🟡 Moyen | Moyen |
| R12 | FX EUR↔KMF : source unique + réconciliation à formaliser | Backend | 🟡 Moyen | Moyen |
| R13 | **Uploads images produits sur disque éphémère Railway** (perdus à chaque redéploiement) | Backend | 🔴 Critique | Faible-moyen |
| R14 | Écritures multi-étapes sans transaction (`auto-parcel`, `inventory-service`) → colis vides/incohérents possibles (viole l'esprit I-09) | Backend | 🟠 Élevé | Faible |
| R15 | Dette « ticket #387 » non planifiée : stockage objet, soft-auth `orders/detail`, alerte sync parcel | Backend | 🟠 Élevé | Moyen |

---

## 8. Ce qui manque pour un *vrai succès*

Le projet a déjà ce que beaucoup n'ont pas : une doctrine claire, des invariants tenus, une vraie discipline de doc. Ce qui manque pour passer de « solide » à « durable et scalable » :

### P0 — à traiter avant/juste après go-live
1. **Un contrat d'API partagé et vérifié en CI** (R1). Générer un OpenAPI depuis le backend (ou des types partagés), et faire échouer la CI front si un champ consommé disparaît. C'est le meilleur retour sur investissement de tout le projet.
2. **Une orchestration de déploiement explicite** (R2, R3). Soit un **monorepo** (workspaces : `backend/`, `boutique/`, `dashboards/`) avec un script d'assemblage qui copie les builds front dans `public/` ; soit un **split front/back propre** (front sur CDN, auth par token + CORS). Aujourd'hui le couplage est réel mais non outillé — il faut choisir et l'outiller.
3. **Rotation effective du secret admin + audit des secrets** (R6) avant exposition publique.
4. **Clarifier le provider de notifications réellement actif** et **authentifier/whitelister le webhook Authkey** (R5). OTP et panier partagé en dépendent : une panne silencieuse de SMS = paniers jamais payés.

### P1 — fondations de fiabilité (premiers 90 jours)
5. **Tests E2E traversant les 3 couches** (R8) : *commande passée en boutique → visible en dashboard → colis scanné au hub → suivi mis à jour → retrait relais*. Un seul scénario « golden path » testé en continu attrape 80 % des régressions de couture. Étendre ensuite au panier partagé et à l'annulation/remboursement.
6. **Version unique + invalidation de cache automatique** (R10, R9) : une seule source de version propagée à `/api/health`, au `sw.js` et au bundle ; bump auto au déploiement.
7. **Purge du code front déprécié** (R7) : supprimer `event-*.js`, `collective-ready-to-order-orchestrator.js`, le stub `b-group-cart-flow.js`, et tout lien vers `/event/*` `/workspace/*`.

### P2 — dette structurelle (trimestre suivant)
8. **Refactor `server.js`** (R4, lot `H1` déjà identifié) : sortir les 92 DDL vers un vrai runner de migrations, monter les routes depuis un manifeste, viser < 300 lignes.
9. **Décommissionner l'admin-legacy** (R11) une fois la parité confirmée.
10. **Formaliser la clôture financière** (R12) : source unique du taux EUR↔KMF, processus de réconciliation (`RECONCILIATION_PROD.sql` existe — l'industrialiser), et observabilité financière.

### Transversal — observabilité & confiance
11. **Traçabilité bout-en-bout** : propager le `request-id` (déjà présent backend) depuis les frontends, brancher un suivi d'erreurs (type Sentry) sur boutique **et** dashboards, et de l'alerting/uptime. Aujourd'hui, une erreur côté client est invisible.
12. **Confiance & données** : la PII diaspora (téléphones, identités) est déjà masquée (`maskPhone`) — formaliser rétention/RGPD et le durcissement du webhook entrant non authentifié.

---

## 9. Plan d'action proposé (90 jours)

| Semaine | Chantier | Livrable |
|---|---|---|
| S1–S2 | Contrat d'API (OpenAPI/types) + CI front | Build front qui casse si un champ consommé disparaît |
| S1 | Rotation secret admin + revue secrets + webhook Authkey | Checklist sécurité go-live close |
| S2–S3 | Décision mono-repo vs split + script d'assemblage `public/` | `npm start` reproductible depuis zéro |
| S3 | Clarification provider notifications + healthcheck SMS/WhatsApp | 1 provider documenté + sonde de livraison |
| S4–S6 | E2E « golden path » 3 couches en CI | 1 scénario vert à chaque PR |
| S5 | Version unique + invalidation cache PWA auto | Plus de clients périmés |
| S6 | Purge code front déprécié | Repo boutique sans flux mort |
| S7–S12 | Refactor `server.js` (lot H1) + migrations | `server.js` < 300 lignes, DDL hors boot |
| Continu | Observabilité (Sentry + request-id + uptime) | Erreurs client visibles |

---

## 10. Annexe — points de vérité à ne pas casser

Repris de `ZONE_IMPACT.md` (invariants absolus, à garder en tête pour tout chantier de couture) :

- **I-01** `orders.status` muté uniquement par `order-status-machine.js`.
- **I-02** Tous les paiements confirment seulement `pending → confirmed`, via le hub unique.
- **I-07** Webhooks Stripe en body brut **avant** `express.json`.
- **I-09** Le colis est une unité opérationnelle autonome.
- **I-10** Codes de retrait et preuves de collecte = éléments de confiance.

> Toute intervention sur les coutures (auth, déploiement, contrat d'API) doit vérifier qu'elle ne contourne aucun de ces invariants — en particulier ne pas déplacer les webhooks Stripe ni introduire un second chemin de mutation de statut.

---

## 11. Addendum (11 juin) — scan complémentaire

### 11.1 Trois findings techniques nouveaux

**R13 — 🔴 Les images produits disparaissent à chaque redéploiement.** `middleware/upload.js` stocke les uploads produits sur le filesystem local (`public/uploads/products/`) et le documente lui-même : sur Railway le disque est éphémère — les images *survivent aux restarts mais pas aux redéploiements* (TODO #387 dans le code). Utilisé par `routes/products.js`, donc au cœur du catalogue. **Bloqueur go-live** : migrer vers un stockage objet (R2/S3) ou, en minimal, un volume persistant Railway.

**R14 — 🟠 Écritures multi-étapes sans transaction.** 21 services utilisent correctement des transactions, mais `auto-parcel.js` enchaîne `INSERT parcels` puis `INSERT parcel_items` sans `BEGIN/COMMIT` (un crash entre les deux = colis vide orphelin), et `inventory-service.js` séquence UPDATE items / INSERT parcel_items / UPDATE orders librement. Contredit l'esprit de I-09 (colis = unité autonome). Les services lecture seule (metrics, dashboards) sans transaction sont, eux, normaux.

**R15 — 🟠 Le ticket #387 est la dette « avouée » la plus chaude**, présente à trois endroits du code : stockage uploads (R13), middleware soft-auth manquant sur `routes/orders/detail.js` (accès publics sans `req.user`), alerte absente si la sync parcel échoue (`utils/parcelSync.js`). À planifier comme un lot.

*Mineur : `services/monitoring.js` lance un `setInterval(60s)` au require (effet de bord au chargement, actif aussi en test) — à gater comme le sont proprement les crons de `bootstrap/crons.js`.*

*Signaux positifs du scan : 215 `CREATE INDEX` couvrant les FK chaudes, Node ≥20 verrouillé, très peu de TODO sauvages pour 583 fichiers, 21 services correctement transactionnels.*

### 11.2 Lacunes fonctionnelles métier (vérifiées dans le code)

Le cœur « colis-first » est complet. Ce qui manque relève de la **croissance et de la rétention**, pas des opérations :

| Manque | Dimension | Constat code | Enjeu business |
|---|---|---|---|
| **Flux retour/réclamation client** | Backend + Boutique | Seul chemin : `cancelled → refunded` (admin). Aucune route client de réclamation ; le scénario `damaged` existe dans le simulateur mais sans parcours client | Confiance diaspora : pouvoir signaler un colis abîmé/manquant au retrait (photo au relais) est le SAV n°1 du transfrontalier |
| **Codes promo / parrainage** | Backend + Boutique | Aucun `promo_code`/`coupon` au checkout (le « discount » trouvé = invendus) | Le parrainage est LE levier d'acquisition naturel d'une diaspora qui partage déjà ses paniers sur WhatsApp |
| **Avis clients** | Boutique | Aucune table `reviews` ; le social proof affiché n'est pas alimenté par de vrais avis | Preuve sociale réelle = conversion, surtout pour des acheteurs à distance qui ne voient pas le produit |
| **Alertes stock/réassort** | Pilotage | `alert-engine.js` ne couvre pas la rupture de stock | Une rupture silencieuse sur un produit cérémonie en pleine saison = ventes perdues invisibles |
| **Analytique client (LTV, cohortes, réachat)** | Pilotage | Vue clients opérationnelle présente, pas de vue analytique | Piloter la rétention, pas seulement les flux |
| Recherche produit | Boutique | Présente mais basique (`ILIKE` nom/description) | Suffisante au lancement ; typo-tolérance à prévoir quand le catalogue grossit |
| i18n | Boutique | FR uniquement (`lang="fr"`) | Acceptable pour la diaspora francophone ; à arbitrer (shikomori ? anglais ?) selon l'expansion |

**Lecture d'ensemble** : la maturité est réelle — les manques ne sont pas des trous dans le moteur mais des étages de fusée non encore construits. Ordre conseillé après le go-live : retour/réclamation client (confiance), puis parrainage (croissance), puis avis (conversion), puis analytique (pilotage).
