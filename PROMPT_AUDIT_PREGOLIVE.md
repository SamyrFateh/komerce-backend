# AUDIT PRÉ-GOLIVE EXHAUSTIF — KOMERCE

## Contexte projet

Tu auditons **Komerce**, une plateforme e-commerce pour la diaspora comorienne (France → Comores). Stack :
- **Backend** : Node.js 20 + Express 4 + PostgreSQL + Pino (logs structurés) + Helmet + Redis (rate limit)
- **Paiements** : Stripe (EUR carte) + Cash relais + Wallet + Shared cart + **PayPal en cours d'intégration** (migration 079)
- **Frontend** : 2 surfaces — `boutique/` (HTML/JS vanilla ES modules, mobile-first PWA) + `public/dashboards/admin/` (vanilla JS non-module, IIFE pattern)
- **Déploiement** : Railway, base de référence `main`

## Doctrine architecturale (à connaître AVANT d'auditer)

**Invariants critiques** (codifiés dans `docs/ZONE_IMPACT.md`) :
- **I-01** — Toute transition de statut commande passe par `services/order-status-machine.js`. AUCUN `UPDATE orders SET status` direct ailleurs. Aucune exception.
- **I-02** — Toute confirmation de paiement passe par `services/order-payment-confirmation.js::confirmPaymentCycle()`. Sources autorisées : `stripe_webhook`, `cash_confirm`, `wallet_full_payment`, `shared_cart_full_payment`, `paypal_capture` (migration 079).
- **I-07** — Tout webhook (Stripe, PayPal) doit être idempotent via une table `*_events_processed` consultée **avant** tout traitement métier, et le webhook doit être monté avec `express.raw()` AVANT `express.json` dans `server.js`.

**Hub paiement unique** : `confirmPaymentCycle` est appelé depuis 4 sites — `routes/payments.js` (webhook Stripe + cash relais), `routes/cash.js`, `routes/orders/create.js` (wallet 100%), `services/shared-cart-engine.js`, et maintenant `routes/payments-paypal.js`.

**Machine d'état (rang croissant)** : `pending(0) → confirmed(1) → ordered(2) → preparation(3) → shipped(4) → in_transit(5) → available(6) → collected(7)`. Plus `cancelled` et `refunded` comme terminaux. Forward-only pour `scan`/`system`, COALESCE sur tous les timestamps (jamais d'écrasement).

## Ta mission

Audit pré-Golive **exhaustif** du backend ET des 2 frontends. Tu cherches **tout ce qui peut casser en production** :
1. Vulnérabilités sécurité (auth/authz/injection/XSS/CSRF/secrets fuités)
2. Violations des invariants I-01/I-02/I-07
3. Races conditions, atomicité de transaction, idempotence
4. Schéma DB : contraintes manquantes, FK orphelines, indexes manquants sur colonnes filtrées, NULL où il ne faut pas
5. Bugs logiques métier (pricing, stock, refunds, wallet, panier partagé)
6. Observabilité défaillante (catch silencieux, console.log au lieu de logger structuré)
7. Tests manquants sur les chemins critiques
8. Dette de migrations (collisions, ENUM mal géré, schémas incohérents avec le code)
9. Frontend : XSS (innerHTML non échappé), localStorage de tokens sensibles, race conditions UI, fuites mémoire (listeners non détachés)
10. Build & ops : .env.example incomplet, REQUIRED_ENV insuffisant, plan de rollback, healthchecks

## Méthode imposée (5 passes, ne pas en sauter une)

### Passe 1 — Anatomie statique (1h)
Génère :
- Volumétrie (lignes par dossier, top 20 god-files >800 lignes)
- Doublons fantômes (deux fichiers traitant la même route, deux versions d'un service)
- Collisions migrations (mêmes numéros sur des objets différents)
- Routes orphelines (fichier `routes/*.js` non monté dans `bootstrap/api-routes.js` ni `server.js`)
- TODO/FIXME/XXX comptés et listés avec contexte 3 lignes
- console.log/console.error dans le code prod (devraient être pino)
- Queries SQL non paramétrées (template string dans `db.query`)
- Mojibake (`grep -rn "Ã©|Ã¨|Ã®|Ã´|â€"`)

### Passe 2 — Sécurité ligne par ligne
Pour chaque route :
- `authenticate` présent ? `requireRole` adapté ?
- Body validé via Joi ? Tous les champs déclarés ?
- Ownership vérifié sur les ressources (user_id, guest_token) ?
- Données sensibles dans la réponse publique (`cash_ref_code`, `pickup_code`, `paypal_capture_id`, secrets tokens) ?
- Rate limiting appliqué ?
- Webhooks : signature vérifiée AVANT tout traitement DB ?

Pour le frontend :
- `innerHTML` avec interpolation de données serveur sans `esc()` ?
- Tokens JWT en localStorage (XSS vulnerable) ou cookies httpOnly ?
- Liens `target="_blank"` sans `rel="noopener"` ?
- Formulaires avec mots de passe en GET ?

### Passe 3 — Flow paiement end-to-end (vital)
Trace **3 flows complets** :
1. **Stripe checkout** : POST /api/orders → POST /api/payments/stripe/intent → confirmCardPayment front → webhook stripe → `confirmPaymentCycle` → stock décrémenté → code retrait généré → SMS
2. **Cash relais** : POST /api/orders → POST /api/cash/confirm (agent relais auth) → `confirmPaymentCycle` (rollback si stockBlocked) → SMS
3. **PayPal capture** : POST /api/payments/paypal/create-order → SDK PayPal popup → POST /api/payments/paypal/capture/:id → `confirmPaymentCycle({ source: 'paypal_capture' })` → race condition avec le webhook fallback

Pour CHAQUE flow, vérifie :
- Atomicité des transactions DB (BEGIN/COMMIT/ROLLBACK propres)
- Idempotence (que se passe-t-il si l'event arrive 2× ?)
- Cas dégénérés : montant manipulé côté client, ordre déjà payé, stock disparu entre check et UPDATE
- Compensation : argent encaissé mais flow downstream qui plante → alerte créée ? réconciliation possible ?

### Passe 4 — Schéma DB vs code
- Liste les ENUM (`SELECT typname FROM pg_type WHERE typtype='e'`) et croise avec les usages côté code (`ORDER_STATUSES`, `payment_mode`, etc.)
- FK : pour chaque table avec `*_id`, vérifie la FK en DB (`information_schema.referential_constraints`)
- Indexes : pour chaque colonne dans un `WHERE` ou `ORDER BY` fréquent, indexée ?
- Contraintes business : check constraints (`amount > 0`, `total_eur >= 0`) présentes ?
- Triggers : listés dans le code mais existent en DB ?

### Passe 5 — Tests & observabilité
- Couverture par service (compte `*.test.js` vs services hot)
- Tests des chemins de sortie de `confirmPaymentCycle` (success/noop/rejected/stockBlocked/throw)
- Tests d'idempotence (webhook rejoué = pas de double processing)
- Tests de transitions invalides (essayer `ordered → pending` doit échouer)
- Healthcheck `/api/health` : couvre DB + Redis + Stripe + PayPal ?
- Logs structurés : présence de `req.id`, `order_id`, `user_id` dans les logs critiques ?
- Plan de rollback documenté ?

## Format de sortie attendu

Crée un fichier `AUDIT_PREGOLIVE_<DATE>.md` avec cette structure stricte :

```markdown
# Audit Pré-Golive Komerce — <DATE>

## Synthèse (verdict GO / GO conditionnel / NO-GO)

| Bloc | Findings | 🔴 Bloquants | 🟠 Importants | 🟡 Améliorations |
|---|---|---|---|---|
| Sécurité | N | n | n | n |
| Paiements | N | n | n | n |
| Schéma DB | N | n | n | n |
| Frontend | N | n | n | n |
| Tests | N | n | n | n |
| Ops | N | n | n | n |

Verdict : **<GO|GO conditionnel|NO-GO>** car <raison principale>.

## Findings détaillés

Pour CHAQUE finding, format :

### NEW-001 — <titre court>
- **Sévérité** : 🔴 Bloquant | 🟠 Important | 🟡 Amélioration
- **Bloc** : Sécurité | Paiements | Schéma DB | Frontend | Tests | Ops
- **Fichiers** : `chemin/exact.js:L123-L145`
- **Défaut** : <description précise du problème observé dans le code, avec citation des lignes>
- **Risque concret** : <ce qui peut arriver en prod, avec scénario>
- **Correction proposée** : <patch précis, code si possible>
- **Effort estimé** : <minutes ou heures>
- **Bloque le Golive ?** : Oui / Non / Souhaitable

## Recommandations Golive

1. Bloc P0 (à faire AVANT le push)
2. Bloc P1 (H-24h)
3. Bloc P2 (post-Golive H+1 semaine)

## Ce qui marche bien (à ne pas casser)
<rappel des bonnes pratiques en place pour éviter les régressions>
```

## Règles de la session

1. **Ne mens jamais sur un finding**. Si tu ne peux pas vérifier (pas accès à la DB live, pas accès aux logs prod), dis-le explicitement : "non vérifié — nécessite accès à X".
2. **Cite les lignes exactes** avec format `chemin/fichier.js:L123` ou `fichier.js:L123-L145` pour les blocs.
3. **Pas de finding vague**. "Le code est compliqué" n'est pas un finding. "Le service `pricing-engine.js` fait 1483 lignes avec 47 exports, dont 12 ne sont jamais appelés (vérifié via grep) — risque de dette future, pas un bloquant" est un finding.
4. **Distinguer dette technique et bloquant Golive**. Un god-file qui marche n'est pas un bloquant. Une race condition sur le paiement EST un bloquant.
5. **Croiser avec les findings FRESH-* précédents** s'ils sont dans `docs/audit/` ou `docs/chantier/STATUS.md` — ne pas re-soulever des findings déjà traités.
6. **Pas de refacto-mania**. Tu signales, tu ne refactorises pas. Le client décidera de l'ordre.
7. **Tracer ce qui a été lu**. À la fin du rapport, section "Méthodologie" listant chaque fichier lu intégralement ou partiellement, avec ligne max.

## Périmètre exact à auditer

**Backend** :
- `server.js`, `db.js`, tous les fichiers de `bootstrap/`, `middleware/`, `routes/`, `services/`, `utils/`, `validators/`
- `migrations/*.sql` (collisions, conventions ENUM, dedup)
- `db/schema.sql` (FK, indexes, contraintes, triggers)
- `package.json` (dépendances vulnérables ? `npm audit`)
- `tests/unit/`, `tests/integration/` (couverture des paths critiques)
- `.env.example` vs `bootstrap/env.js` `requiredEnv`

**Frontend boutique** (`boutique/`) :
- `js/b-*.js` (tous, ≈40 fichiers)
- `index.html` (CSP, scripts inline, attributs `target/rel`)
- `tests/boutique.spec.js` (Playwright)
- `sw.js` (cache busting, clone before respondWith)

**Frontend admin** (`public/dashboards/admin/`) :
- `js/app.js`, `js/api-client.js`, `js/views/*.js`, `js/components/*.js`
- `index.html` (ordre de chargement, CSP)
- XSS sur les 13 vues (innerHTML avec interpolation)

**Hors périmètre** :
- `docs/_archive/`, `docs/_logs/` (historique, pas du code prod)
- Fichiers `.legacy.js`, `.bak`, `.old`
- `node_modules/`

## Démarrage

Commence par lire **dans cet ordre obligatoire** :
1. `docs/chantier/STATUS.md` (état du chantier, audits précédents traités)
2. `docs/CARTOGRAPHY_360.md` (quoi existe)
3. `docs/ZONE_IMPACT.md` (les 10 invariants à protéger)
4. `docs/SCHEMA.md` (état de la base — confronté à `db/schema.sql`)
5. `docs/CONTRACTS.md` (contrats des services critiques)

Ensuite produis ta passe 1 (volumétrie + fantômes + grep stats) en premier livrable, et ATTENDS validation avant de continuer avec la passe 2. Ça évite que tu partes 4h sur une mauvaise piste.

## Sortie

Un seul fichier `AUDIT_PREGOLIVE_<DATE>.md` à la racine de `docs/audit/`. Pas de modification de code, pas de PR. **Juste le rapport**.
