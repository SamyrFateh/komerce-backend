# Audit Pré-Golive Komerce — 2026-06-22

> Périmètre : `backend/` (361 JS · 91 512 lignes) · `boutique/` (70 JS · 22 429 lignes) · `dash/` (79 JS · 37 159 lignes)
> Base : commit `71e7efc` · branche `main`
> Méthode : 5 passes exhaustives selon `PROMPT_AUDIT_PREGOLIVE.md`
> Lectures préalables : `STATUS.md`, `ZONE_IMPACT.md`, `SCHEMA.md`, `CONTRACTS.md`, `AGENTS.md`, `docs/README.md`

---

## Synthèse (verdict GO conditionnel)

| Bloc | Findings | 🔴 Bloquants | 🟠 Importants | 🟡 Améliorations |
|---|---|---|---|---|
| Sécurité | 7 | 2 | 3 | 2 |
| Paiements | 3 | 1 | 1 | 1 |
| Schéma DB | 3 | 1 | 1 | 1 |
| Frontend | 3 | 0 | 2 | 1 |
| Tests | 3 | 0 | 2 | 1 |
| Ops | 3 | 0 | 1 | 2 |
| **Total** | **22** | **4** | **10** | **8** |

Verdict : **GO conditionnel** — les 4 bloquants sont corrigeables en ≤ 1 jour-homme. Aucun défaut structurel de conception. Les chemins critiques (paiement, stock, wallet, panier partagé) sont solides. La gouvernance outillée (arch:gate, Security 360, schema drift, 52 tests verts) est remarquablement avancée pour ce stade de projet.

---

## Passe 1 — Anatomie statique

### Volumétrie

| Zone | Fichiers | Lignes | God-files (>800L) |
|---|---:|---:|---|
| routes/ | 97 | ~17 800 | shared-cart.js (989), admin-dashboard.js (805) |
| services/ | 109 | ~27 400 | shared-cart-engine.js (1264), dashboard-metrics.js (1079), dashboard-finance-metrics.js (1064), collective-workspace-engine.js (983), notification-service.js (960), scan-engine.js (959), cost-allocation.js (914), radar-queries.js (857) |
| middleware/ | 10 | ~1 670 | auth.js (330+, 10 handlers inline — voir NEW-006) |
| tests/ | 68 | ~14 200 | — |
| boutique/js/ (hors dist) | 70 | ~22 400 | — |
| dash/ | 79 | ~37 100 | — |
| migrations/ | 78 SQL | — | — |

### Doublons fantômes

Aucun doublon de route détecté.

### Collisions migrations

4 numéros dupliqués : `014` (parcels_final_cleanup / transaction_documents), `072` (boutique_category_images / jwt_revocation + variantes a/b), `073` (pickup_verify_attempts / shared_cart_cash_contributions + variantes a/b), `074` (add_v4_status_values / invoice_public_token). Voir **NEW-009**.

### Routes orphelines

3 fichiers ont un header `@used-by bootstrap/api-routes.js` mais ne sont montés nulle part :

| Fichier | Statut réel |
|---|---|
| `routes/admin-collective-repairs.js` | Code tombstone collective — jamais monté |
| `routes/pickup-pay-cash.js` | Logique migrée dans `middleware/auth.js:handleSafePickupCash` |
| `routes/alerts.js` | Remplacé par `routes/admin/dashboard.js:GET /alerts` |

Divergence header↔réalité. Les 6 fichiers `dashboard-clients/finance/hub/ops/shared.js` + `shared-cart-from-order.js` sont importés indirectement (via `dashboard.js` et `shared-cart.js`), pas orphelins.

### Hygiène code

| Métrique | Résultat |
|---|---|
| `console.log/error/warn` en prod | 0 (10 occurrences dans fallbacks logger — correct) |
| TODO/FIXME | 2 (upload stockage objet #387, OTP lot 4) |
| `eval()` / `new Function()` | 0 |
| Mojibake | 0 |
| SQL non-paramétré (interpolation `${}`) | 6 occurrences (voir **NEW-005**) |

---

## Findings détaillés

### NEW-001 — 73 `catch { res.status(500) }` court-circuitent l'error-handler global (RÉSOLU)

- **Sévérité** : ~~🔴 Bloquant~~ → ✅ Résolu
- **Bloc** : Sécurité
- **Fichiers** : 22 fichiers de routes — top contributeurs : `routes/ops-api.js` (12), `routes/shared-cart.js` (8), `routes/shares.js` (4), `routes/admin-dashboard.js` (4)
- **Résolution** : Même périmètre que GOV-01, clôturé le 2026-06-22 — 69/73 remplacés par `next(err)`, 4 cas spéciaux maintenus délibérément (logique de statut déjà testée avant retour, cf. note GOV-01).
- **Bloque le Golive ?** : Non — clos.
- **Réf STATUS.md** : GOV-01 clôturé.

---

### NEW-002 — Nodemailer 8.0.5 — faille CRLF injection (high)

- **Sévérité** : 🔴 Bloquant
- **Bloc** : Sécurité
- **Fichiers** : `package.json:L16`, `package-lock.json` (nodemailer@8.0.5)
- **Défaut** : `npm audit` remonte au moins une faille high sur Nodemailer (injection CRLF dans les en-têtes email). Aucune porte CI `npm audit --audit-level=high`.
- **Risque concret** : Un attaquant qui contrôle une adresse email ou un nom de destinataire peut injecter des en-têtes SMTP arbitraires (BCC, Subject, corps additionnel). Vecteur : champs `recipient_email`, `support_email`, ou noms utilisateur dans les templates email.
- **Correction proposée** : `npm audit fix` ou pin nodemailer à la version patchée + job CI `npm audit --audit-level=high` (mode observe puis bloquant).
- **Effort estimé** : 30 min
- **Bloque le Golive ?** : Oui — faille high ouverte sur un vecteur accessible
- **Réf STATUS.md** : GOV-03 confirmé

---

### NEW-003 — `shared_cart_commitments` : vérification DB live (RÉSOLU 2026-06-23)

- **Sévérité** : ~~🔴 Bloquant~~ → ✅ Résolu
- **Bloc** : Schéma DB
- **Fichiers** : `services/shared-cart-commitment-service.js:L148-284` (SELECT/INSERT/UPDATE actifs)
- **Vérification effectuée** : `SELECT table_name FROM information_schema.tables WHERE table_name IN ('shared_cart_commitments', 'stripe_events_processed')` exécuté en DB live — **les deux tables existent**. Confirmé également par le dump `docs/db/railway-live-schema.sql` (DDL `CREATE TABLE public.shared_cart_commitments`, PK, FKs et index présents).
- **Conclusion** : ce n'était pas une fiction DB. Le flow commitment (panier partagé V4.1) n'est pas cassé en production. Le doute venait d'un STATUS.md pas à jour, pas d'un défaut réel.
- **Bloque le Golive ?** : Non — clos.
- **Réf STATUS.md** : GOV-05 clôturé.

---

### NEW-004 — 45 routes UNPROTECTED sans justification documentée

- **Sévérité** : 🔴 Bloquant
- **Bloc** : Sécurité
- **Fichiers** : Matrice Security 360 baseline
- **Défaut** : Security 360 recense 45 routes UNPROTECTED. L'analyse de code confirme que `boutique-suggestions.js` est la seule route-fichier entièrement sans auth (légitime — surface publique boutique). Les 44 autres routes UNPROTECTED doivent être individuellement justifiées (publique légitime documentée) ou corrigées. Les 141 routes role-protégées ne sont couvertes que par analyse statique, pas par sonde runtime.
- **Risque concret** : (a) Une route UNPROTECTED sur un endpoint de mutation permet une action non autorisée. (b) Sans sonde multi-rôles, un `agent_relais` pourrait accéder à des endpoints `agent_hub` si le middleware est mal configuré (risque IDOR latéral).
- **Correction proposée** : Audit IDOR route par route + matrice rôle×route verte CI + documentation des routes publiques légitimes.
- **Effort estimé** : 4-6h
- **Bloque le Golive ?** : Oui — surface d'attaque authz non fermée
- **Réf STATUS.md** : GOV-02 confirmé

---

### NEW-005 — 6 interpolations SQL hors paramètre ($1/$2)

- **Sévérité** : 🟠 Important
- **Bloc** : Sécurité
- **Fichiers** :
  - `routes/parcels.js:L103` — `${where}` (WHERE dynamique construit par le serveur)
  - `routes/admin/system.js:L100,L306` — `${tbl}` (nom de table depuis une liste hardcodée)
  - `routes/admin-costing.js:L642` — `${updates.join(', ')}` (SET dynamique construit par le serveur)
  - `services/parcel-security.js:L233` — `${col.name} ${col.type}` (ALTER TABLE, valeurs hardcodées)
  - `services/dashboard-metrics.js:L241` — `${prevQuery.where}` (WHERE construit par le serveur)
- **Défaut** : Ces 6 requêtes interpolent des variables dans le template SQL au lieu d'utiliser `$1`/`$2`. Aucune n'interpole directement de l'input utilisateur — les valeurs sont construites côté serveur à partir de listes hardcodées ou de builders internes.
- **Risque concret** : Risque d'injection SQL indirect si un futur développeur modifie le builder `where` ou `updates` pour inclure de l'input utilisateur sans le paramétrer. Le `backend:audit` signale déjà ces cas (7 warnings connus).
- **Correction proposée** : Pour `parcels.js` et `dashboard-metrics.js`, migrer le WHERE builder vers des paramètres nommés. Pour `admin/system.js`, valider `tbl` contre une whitelist explicite (déjà fait implicitement mais pas vérifié par le linter).
- **Effort estimé** : 2h
- **Bloque le Golive ?** : Non — pas d'input utilisateur direct, mais souhaitable

---

### NEW-006 — `auth.js` god-middleware : 10 handlers métier dans authenticate()

- **Sévérité** : 🟠 Important
- **Bloc** : Sécurité
- **Fichiers** : `middleware/auth.js:L56-L290` — 10 fonctions `is*Request()` + 10 `handle*()`
- **Défaut** : Le middleware `authenticate()` contient 10 regex de route-matching et 10 handlers métier complets (pickup cash, QR verify, Stripe intent, PO receive, collective repairs x2, admin refund, pricing apply x2). Après l'authentification JWT, le middleware intercepte ces requêtes **avant que le routeur Express ne les voie** et exécute la logique métier inline.
- **Risque concret** : (a) Si une URL change, le regex ne match plus → la requête tombe dans le routeur standard et s'exécute avec un comportement potentiellement différent (double execution ou handler manquant). (b) Impossible de tester ces handlers isolément. (c) Le routeur Express standard est contourné pour ces 10 endpoints — les middlewares de route (validation Joi, rate-limit spécifique) ne s'appliquent pas.
- **Correction proposée** : Extraire les 10 handlers dans leurs fichiers de route respectifs. Le middleware `authenticate()` ne devrait faire que : extraire token → vérifier JWT → charger user → `next()`.
- **Effort estimé** : 3-4h
- **Bloque le Golive ?** : Non — fonctionne correctement, dette architecturale

---

### NEW-007 — `payment-paypal.js:L588` : violation I-01 documentée mais non gatée

- **Sévérité** : 🟠 Important
- **Bloc** : Paiements
- **Fichiers** : `services/payment-paypal.js:L588`
- **Défaut** : `UPDATE orders SET status = 'refunded' WHERE id = $1` — contourne `order-status-machine.js` (invariant I-01). Le commentaire (L580-587) documente la décision : `order-status-machine` n'autorise `refunded` que depuis `cancelled`, mais ici le refund PayPal est déjà exécuté côté PayPal.
- **Risque concret** : (a) Pas de trace dans `order_status_history` (invariant I-04 violé en même temps). (b) Pas de restauration de stock (invariant I-06). (c) Le monitoring ne capture pas cette transition non-standard.
- **Correction proposée** : (a) Court terme : ajouter un INSERT dans `order_status_history` à côté du UPDATE, et un log structuré explicite. (b) Moyen terme : étendre `VALID_TRANSITIONS` dans `order-status-machine.js` pour autoriser `* → refunded` via source `paypal_refund`, et migrer vers `transitionOrderStatus()`.
- **Effort estimé** : 1h (court terme) / 3h (moyen terme)
- **Bloque le Golive ?** : Non — le refund fonctionne, mais la trace d'audit est incomplète

---

### NEW-008 — `stripe_events_log` : fiction DB probablement résolue

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Schéma DB
- **Fichiers** : `services/shared-cart-queries.js:L57,L71`
- **Défaut** : Le STATUS.md mentionne la fiction `stripe_events_log` avec `SELECT id` erroné. Le code actuel utilise correctement `stripe_events_processed` et `stripe_event_id` (L57 : `SELECT stripe_event_id FROM stripe_events_processed`). La fiction semble **résolue dans le code**.
- **Risque concret** : Aucun si la table live s'appelle bien `stripe_events_processed`.
- **Correction proposée** : Vérifier en DB live, puis retirer de `arch-debt-budget.json#knownDriftAllowlist`.
- **Effort estimé** : 15 min
- **Bloque le Golive ?** : Non — non vérifié, nécessite accès DB live
- **Réf STATUS.md** : GOV-05 (#1) — probablement résoluble

---

### NEW-009 — 4 collisions de numéros de migration

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Schéma DB
- **Fichiers** : `migrations/014_*.sql` (×2), `migrations/072_*.sql` (×3), `migrations/073_*.sql` (×3), `migrations/074_*.sql` (×2)
- **Défaut** : 4 numéros de migration partagés par des fichiers différents. Risque d'ordre d'application non-déterministe si un runner de migration auto-détecte par préfixe numérique.
- **Risque concret** : Faible — `deploy-all.sql` gère l'ordre manuellement. Mais la convention est cassée.
- **Correction proposée** : Renommer les doublons avec des suffixes explicites (ex: `014a_`, `014b_`) ou un schéma de numérotation sans collision.
- **Effort estimé** : 30 min
- **Bloque le Golive ?** : Non

---

### NEW-010 — `unsafe-inline` dans CSP scriptSrc

- **Sévérité** : 🟠 Important
- **Bloc** : Sécurité
- **Fichiers** : `bootstrap/security.js:L53`
- **Défaut** : `'unsafe-inline'` est dans `scriptSrc`. Le commentaire FRESH-030 reconnaît le problème et indique la cible (fichiers externes ou nonce CSP), mais la migration n'est pas faite.
- **Risque concret** : Un XSS reflété (par ex. via une page d'erreur mal échappée ou un contenu utilisateur injecté dans le HTML) peut exécuter du JS inline malgré Helmet. La surface est réduite par le `sanitize()` boutique et le masquage des erreurs, mais le filet CSP est troué.
- **Correction proposée** : (a) Court terme : auditer les scripts inline restants dans `boutique/index.html` et `dash/index.html`. (b) Moyen terme : migrer vers un nonce CSP généré par le serveur.
- **Effort estimé** : 4-6h
- **Bloque le Golive ?** : Non — mitigé par d'autres couches, mais souhaitable

---

### NEW-011 — Healthcheck ne couvre pas Redis, Stripe, PayPal

- **Sévérité** : 🟠 Important
- **Bloc** : Ops
- **Fichiers** : `routes/health.js:L42-48`
- **Défaut** : Le healthcheck `/api/health` ne vérifie que la connexion DB (`SELECT 1`). Redis (rate limiting), Stripe (paiements carte), PayPal (paiements diaspora) ne sont pas sondés.
- **Risque concret** : Une panne Redis/Stripe/PayPal n'est pas détectée par le healthcheck — Railway ne redémarre pas le conteneur, les alertes monitoring manquent la dégradation.
- **Correction proposée** : Ajouter des sondes Redis PING, Stripe `/v1/charges?limit=0` (ou token validation), PayPal token endpoint, avec timeout + fallback gracieux.
- **Effort estimé** : 2h
- **Bloque le Golive ?** : Non — mais souhaitable H-24h

---

### NEW-012 — 442/468 réponses OpenAPI `UNKNOWN`

- **Sévérité** : 🟠 Important
- **Bloc** : Tests
- **Fichiers** : Contrat OpenAPI généré par `scripts/contract-generate.js`
- **Défaut** : 442 des 468 opérations du contrat OpenAPI ont un schéma de réponse `UNKNOWN`. Schemathesis ne peut valider que les 26 réponses documentées.
- **Risque concret** : Régressions de schéma de réponse non détectées. Un champ renommé ou supprimé dans un service ne casse aucun test.
- **Correction proposée** : Brûler les UNKNOWN par priorité blast-radius : admin + paiement + commandes d'abord.
- **Effort estimé** : Itératif (2-3h par lot de 20 réponses)
- **Bloque le Golive ?** : Non — mitigé par les 52 tests unitaires
- **Réf STATUS.md** : GOV-04 confirmé

---

### NEW-013 — Tests E2E API absents malgré infra prête

- **Sévérité** : 🟠 Important
- **Bloc** : Tests
- **Fichiers** : `tests/integration/test-harness/seed-helpers.js`, `tests/integration/*.test.js`
- **Défaut** : L'infrastructure E2E est en place (harness, seed-helpers, Postgres jetable, `ci-probe-token.js`). Mais les 5 parcours critiques (checkout cash, checkout Stripe webhook, checkout PayPal, panier partagé V4 cycle complet, admin commande bout en bout) ne sont pas couverts en intégration bout en bout.
- **Risque concret** : Les tests unitaires mockent les dépendances — une incompatibilité de contrat entre deux services ne sera détectée qu'en production.
- **Correction proposée** : 5 tests E2E minimum sur les parcours critiques.
- **Effort estimé** : 6-8h
- **Bloque le Golive ?** : Non — mitigé par les 52 tests unitaires et les tests d'intégration existants
- **Réf STATUS.md** : GOV-06 confirmé

---

### NEW-014 — `shared-cart.js:L337` expose le message d'erreur de signature Stripe

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Sécurité
- **Fichiers** : `routes/shared-cart.js:L337`
- **Défaut** : `return res.status(400).send(\`Webhook signature invalid: ${err.message}\`)` — le message d'erreur de la lib Stripe est renvoyé au client.
- **Risque concret** : Pas de fuite de secret (le message ne contient pas la clé), mais contraire au principe de masquage des erreurs internes.
- **Correction proposée** : Remplacer par `res.status(400).send('Webhook signature invalid')`.
- **Effort estimé** : 5 min
- **Bloque le Golive ?** : Non

---

### NEW-015 — `ops-api.js` expose `err.message` brut dans 12 réponses 500

- **Sévérité** : 🟠 Important
- **Bloc** : Sécurité
- **Fichiers** : `routes/ops-api.js:L128,L162,L239,L359,L381,L456,L484,L506,L554,L581,L607,L638`
- **Défaut** : 12 catch blocs renvoient `{ error: err.message }` directement au client. Les routes sont protégées admin/agent_hub/agent_relais, mais les messages d'erreur internes (stack PostgreSQL, messages de service, chemins de fichiers) sont exposés.
- **Risque concret** : Information disclosure pour un utilisateur authentifié — messages PostgreSQL, noms de tables/colonnes, chemins internes.
- **Correction proposée** : Sous-ensemble de NEW-001 — remplacer par `next(err)`.
- **Effort estimé** : Inclus dans NEW-001
- **Bloque le Golive ?** : Non — résolu (couvert par NEW-001/GOV-01, clos)

---

### NEW-016 — 3 routes orphelines avec header `@used-by` divergent

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Ops
- **Fichiers** : `routes/admin-collective-repairs.js`, `routes/pickup-pay-cash.js`, `routes/alerts.js`
- **Défaut** : Ces 3 fichiers déclarent `@used-by bootstrap/api-routes.js` dans leur header mais ne sont montés nulle part. Le code est soit tombstone (collective), soit migré (pickup-pay-cash → auth.js, alerts → admin/dashboard.js).
- **Risque concret** : Aucun fonctionnel — confusion pour un développeur qui lirait les headers.
- **Correction proposée** : Supprimer les fichiers ou corriger le header `@used-by` vers `@used-by none (orphan)`.
- **Effort estimé** : 15 min
- **Bloque le Golive ?** : Non

---

### NEW-017 — Boutique : déséquilibre addEventListener/removeEventListener (327/29)

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Frontend
- **Fichiers** : `boutique/js/b-*.js` (70 fichiers)
- **Défaut** : 327 `addEventListener` pour 29 `removeEventListener`. Les listeners sur des éléments DOM remplacés par `innerHTML` ne sont pas retirés explicitement.
- **Risque concret** : Faible — la boutique fonctionne principalement en mode page-load unique avec un modal overlay. Les éléments remplacés par innerHTML perdent naturellement leurs listeners (GC du DOM). Risque de fuite mémoire uniquement sur navigation intensive avec listeners capturant des closures lourdes.
- **Correction proposée** : Post-golive — identifier les listeners sur des éléments dynamiques et ajouter un cleanup.
- **Effort estimé** : 4-6h
- **Bloque le Golive ?** : Non

---

### NEW-018 — Boutique : innerHTML avec données serveur sans sanitize dans certains cas

- **Sévérité** : 🟠 Important
- **Bloc** : Frontend
- **Fichiers** : `boutique/js/b-cart-core.js:L46`, `boutique/js/b-catalog.js` (searchDrop), `dash/dashboards/admin/js/views/ProductsView.js:L416`
- **Défaut** : La fonction `sanitize()` de `b-utils.js` est correctement implémentée (DOM textContent escape) et utilisée dans les vues critiques (tracking, checkout). Mais certains innerHTML interpolent des données serveur (noms de produits, messages) sans passer par `sanitize()`. Côté dashboard, `ProductsView` interpole des noms de produits directement dans innerHTML.
- **Risque concret** : Si un admin crée un produit avec un nom contenant `<script>...`, ce nom serait exécuté dans le dashboard d'un autre admin. Le risque est atténué (surface admin authentifiée, contenu contrôlé), mais c'est un vecteur XSS stored.
- **Correction proposée** : Audit systématique des innerHTML avec données serveur. Appliquer `sanitize()` ou son équivalent dashboard sur chaque interpolation de donnée serveur.
- **Effort estimé** : 3h
- **Bloque le Golive ?** : Non — surface réduite (admin only), souhaitable

---

### NEW-019 — `invoice-service.js` sans fichier test

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Tests
- **Fichiers** : `services/invoice-service.js` (0 test file)
- **Défaut** : Le service de facture n'a aucun fichier test dédié. STATUS.md recommande déjà un test métier (facture quantité > 1).
- **Risque concret** : Régression possible sur le calcul `unit_price * quantity` corrigé par FACT-01.
- **Correction proposée** : 1 test unitaire minimum couvrant le calcul ligne et le rendu PDF.
- **Effort estimé** : 1h
- **Bloque le Golive ?** : Non

---

### NEW-020 — Dashboard : pas de sanitization HTML

- **Sévérité** : 🟠 Important
- **Bloc** : Frontend
- **Fichiers** : `dash/dashboards/admin/js/views/*.js` (25+ fichiers), `dash/dashboards/admin/js/components/*.js`
- **Défaut** : Le dashboard admin n'a pas de fonction `sanitize()` équivalente à celle de la boutique. Les données serveur (noms de produits, références, noms d'utilisateurs) sont interpolées dans innerHTML sans échappement.
- **Risque concret** : XSS stored si un nom de produit ou d'utilisateur contient du HTML malicieux. Surface atténuée (admin authentifié seulement) mais réelle.
- **Correction proposée** : Ajouter une fonction `esc()` dans le dashboard et l'appliquer à toutes les interpolations de données serveur.
- **Effort estimé** : 3h
- **Bloque le Golive ?** : Non — surface admin, souhaitable H+1 semaine

---

### NEW-021 — `TODO #387` : upload fichiers en filesystem local

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Ops
- **Fichiers** : `middleware/upload.js:L30`
- **Défaut** : Les uploads sont stockés sur le filesystem local du conteneur Railway. Commentaire : « TODO #387 : Migrer vers un stockage objet persistant avant la prod. »
- **Risque concret** : Les fichiers uploadés sont perdus à chaque redéploiement Railway. Si des uploads critiques (photos produit, documents) passent par cette route, ils disparaissent.
- **Correction proposée** : Migrer vers S3/R2/GCS. En attendant, vérifier que les images produit sont stockées ailleurs (URL externe ?) et que ce middleware n'est utilisé que pour des uploads temporaires.
- **Effort estimé** : 4-8h
- **Bloque le Golive ?** : Non — si les images produit sont en URL externe

---

### NEW-022 — PayPal refund : pas de trace `order_status_history`

- **Sévérité** : 🟡 Amélioration
- **Bloc** : Paiements
- **Fichiers** : `services/payment-paypal.js:L588-591`
- **Défaut** : Le `UPDATE orders SET status = 'refunded'` direct (NEW-007) ne crée pas de ligne dans `order_status_history`. L'historique de transition est incomplet pour les remboursements PayPal.
- **Risque concret** : Impossible de retracer la chronologie complète d'une commande remboursée via PayPal dans l'admin. Réconciliation comptable plus difficile.
- **Correction proposée** : Ajouter un INSERT `order_status_history` avec source `paypal_refund` à côté du UPDATE.
- **Effort estimé** : 30 min
- **Bloque le Golive ?** : Non — le remboursement fonctionne, la trace est dans les logs PayPal

---

## Passe 3 — Flows paiement end-to-end

### Flow 1 : Stripe checkout

```
POST /api/orders → order créée (status=pending, payment_mode=stripe_eur)
→ POST /api/payments/stripe/intent → PaymentIntent créé
→ confirmCardPayment (front Stripe.js)
→ webhook POST /api/payments/stripe/webhook
  → express.raw (I-07 ✅)
  → constructEvent + signature (sécurité ✅)
  → idempotence stripe_events_processed (I-07 ✅)
  → handleStripeSucceeded → confirmPaymentCycle (I-02 ✅)
    → SELECT orders FOR UPDATE (atomicité ✅)
    → stock décrément FOR UPDATE (atomicité ✅)
    → Si stockBlocked → COMMIT + alerte (compensation ✅)
    → Si ok → pickup code généré → COMMIT
  → post-COMMIT : fidélité + notification + purchasing (hooks non-bloquants ✅)
```

**Verdict** : Flow solide. Idempotence, atomicité, compensation sont en place.

### Flow 2 : Cash relais

```
POST /api/orders → order créée (status=pending, payment_mode=cash_relais, cash_ref_code généré)
→ POST /api/payments/cash/confirm (agent_relais authentifié + requireRole)
  → validation Joi (cashConfirm ✅)
  → BEGIN
  → SELECT orders WHERE cash_ref_code + payment_status=pending (ownership ✅)
  → cross-relais guard agent_relais vs order.relais_id (IDOR protection ✅)
  → confirmPaymentCycle (I-02 ✅)
  → Si stockBlocked → ROLLBACK (cash pas encore pris → safe ✅)
  → Si ok → COMMIT
  → post-COMMIT : fidélité + notification + purchasing
```

**Verdict** : Flow solide. Le guard cross-relais est un bon ajout IDOR. Le ROLLBACK sur stockBlocked est correct (l'argent cash n'a pas encore été encaissé à ce stade — l'agent doit rendre le cash).

### Flow 3 : PayPal capture

```
POST /api/payments/paypal/create-order → PayPal order créée
→ SDK PayPal popup (front)
→ POST /api/payments/paypal/capture/:id
  → idempotence : order.payment_status === 'paid' → noop ✅
  → paypal.captureOrder (capture côté PayPal)
  → anti-tampering montant (tolérance 0.01€ ✅)
  → Si mismatch → alerte critical + 400 (compensation ✅)
  → BEGIN
  → confirmPaymentCycle source='paypal_capture' (I-02 ✅)
  → Si noop (race webhook) → COALESCE des champs PayPal + COMMIT ✅
  → Si stockBlocked → COMMIT + alerte (paiement déjà pris ✅)
  → Si ok → pickup code + COMMIT
  → post-COMMIT : fidélité + notification + purchasing
```

```
POST /api/payments/paypal/webhook (fallback)
  → express.raw (I-07 ✅)
  → verifyWebhookSignature (sécurité ✅)
  → idempotence paypal_events_processed (I-07 ✅)
  → même flow que capture
```

**Verdict** : Flow solide. La race condition capture/webhook est gérée par l'idempotence `paypal_events_processed` + le noop de `confirmPaymentCycle` quand `payment_status` est déjà `paid`. L'anti-tampering montant est un bon ajout.

---

## Recommandations Golive

### Bloc P0 — AVANT le push (≤ 1 jour)

1. ~~**NEW-001** : remplacer les 73 `catch { res.status(500) }` par `next(err)`~~ — ✅ déjà résolu via GOV-01 (69/73, 4 cas spéciaux maintenus)
2. **NEW-002** : `npm audit fix` Nodemailer + job CI — 30 min
3. ~~**NEW-003** : vérifier `shared_cart_commitments` en DB live~~ — ✅ résolu 2026-06-23, table confirmée
4. **NEW-004** : documenter les 45 routes UNPROTECTED (justification ou correction) — 4-6h

### Bloc P1 — H-24h

5. **NEW-007/022** : ajouter INSERT `order_status_history` pour le refund PayPal — 30 min
6. **NEW-011** : sondes Redis/Stripe/PayPal dans le healthcheck — 2h
7. **NEW-014** : masquer `err.message` dans le webhook shared-cart — 5 min
8. **NEW-010** : auditer les scripts inline pour migrer `unsafe-inline` — 4h

### Bloc P2 — post-Golive H+1 semaine

9. **NEW-006** : extraire les 10 handlers de `auth.js` vers leurs routes — 3-4h
10. **NEW-012** : brûler les UNKNOWN du contrat OpenAPI (admin+paiement+commandes) — itératif
11. **NEW-013** : 5 tests E2E sur parcours critiques — 6-8h
12. **NEW-018/020** : sanitization dashboard + audit innerHTML boutique — 6h
13. **NEW-005** : migrer les 6 interpolations SQL vers des paramètres — 2h
14. **NEW-017** : cleanup listeners boutique — 4-6h

---

## Ce qui marche bien (à ne pas casser)

1. **Transactions et atomicité** : 77 usages `FOR UPDATE` dans services/routes. Les 4 flows paiement passent tous par `confirmPaymentCycle` avec locking explicite. Le wallet implémente un FIFO FIFO par lots avec double `FOR UPDATE`.
2. **Idempotence** : `stripe_events_processed` + `paypal_events_processed` vérifiés avant traitement. Wallet avec `idempotency_key`. Création commande avec guards métier.
3. **Error-handler global** : classification fine (validation, auth, DB constraint, `22P02 → 400`, network → 502), masquage messages prod, tracking monitoring, requestId propagé.
4. **Auth** : JWT HS256 + jti révocable + httpOnly cookie. Token extraction cookie-first, Bearer-fallback. `requireRole()` correct.
5. **Webhook security** : Stripe `constructEvent()`, PayPal `verifyWebhookSignature()`, Authkey `timingSafeEqual`. Les 3 en `express.raw` AVANT `express.json`.
6. **Panier partagé** : montant plafonné côté serveur à `remaining_kmf` (`Math.min(requestedAmount, remainingNow)` L229 `routes/shared-cart.js`).
7. **Wallet** : CHECK constraint DB `balance_kmf >= 0`, `FOR UPDATE` sur wallet + lots, FIFO, contrepassation (jamais de suppression).
8. **Gouvernance outillée** : `backend:audit` (0 violation), Security 360 (cliquet), schema drift (EXIT 0), `arch:gate` (bloquant CI), 52/52 tests verts.
9. **Observabilité** : 0 `console.log` en prod, 100% Pino, logs structurés avec `order_id`, `user_id`, `requestId`.
10. **Machine d'état commande** : forward-only pour scan/system, `COALESCE` sur timestamps, trace dans `order_status_history`.

---

## Méthodologie — fichiers lus

| Fichier | Lignes lues |
|---|---|
| `AGENTS.md` | intégral (173L) |
| `docs/README.md` | intégral (158L) |
| `docs/chantier/STATUS.md` | intégral (474L) |
| `docs/ZONE_IMPACT.md` | L1-120 |
| `docs/CONTRACTS.md` | L1-100 |
| `docs/SCHEMA.md` | L1-60 + grep CHECK |
| `PROMPT_AUDIT_PREGOLIVE.md` | intégral (186L) |
| `server.js` | grep + L80-90 (webhook mounting) |
| `bootstrap/api-routes.js` | L1-100 |
| `bootstrap/security.js` | intégral (~95L) |
| `bootstrap/env.js` | L1-80 |
| `middleware/auth.js` | intégral (~330L) |
| `middleware/error-handler.js` | intégral (~130L) |
| `routes/payments.js` | L80-140 (webhook) |
| `routes/shared-cart.js` | grep + L210-250 (contribution cap) + L330-340 (webhook) |
| `routes/ops-api.js` | L1-30 + grep err.message |
| `routes/health.js` | grep redis/stripe/paypal/db |
| `routes/boutique-suggestions.js` | L1-60 |
| `services/payment-paypal.js` | L100-170 (capture) + L580-600 (refund) + L290-310 (webhook) |
| `services/payment-cash-confirm.js` | L50-130 |
| `services/order-payment-confirmation.js` | grep + L35-50 (contract) + L141-215 (stock) |
| `services/shared-cart-engine.js` | grep BEGIN/COMMIT/FOR UPDATE |
| `services/wallet-service.js` | L49-100 (schema) + L170-250 (debit) |
| `services/shared-cart-queries.js` | L57-71 (stripe_events) |
| `services/shared-cart-commitment-service.js` | L148-284 (queries) |
| `validators/index.js` | grep payment_mode |
| `package.json` | intégral |
| `scripts/arch-debt-budget.json` | intégral |
| `boutique/js/b-utils.js` | L60-80 (sanitize) |
| `boutique/js/b-tracking.js` | grep innerHTML |
| `boutique/js/b-checkout-render.js` | grep innerHTML |
| `boutique/js/b-cart-core.js` | grep innerHTML |
| `dash/login.html` | grep fetch/token/cookie |
| `dash/js/auth-guard.js` | L1-10 |
| Tous les fichiers : grep systématique (console.log, TODO, SQL injection, FOR UPDATE, innerHTML, sanitize, addEventListener, eval, mojibake, etc.) |
