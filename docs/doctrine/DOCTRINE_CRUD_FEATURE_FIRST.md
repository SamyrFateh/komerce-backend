# Doctrine CRUD Feature-First — Komerce

> **Version** : 1.0 — 2026-07-10
> **Statut** : doctrine active — **appliquée dès ce commit**
> **Hiérarchie** : complète `FEATURE_DOCTRINE.md` (niveau 0) et `FEATURE_SLICE_DOCTRINE.md` (niveau 5)
> **Déclencheur** : audit post-incident PR563 (REX 2026-07-10) — passage en mode feature-first

---

## Pourquoi cette doctrine existe

Le chantier de dette technique (D-01 à D-16) et l'incident PR563 ont montré que :

1. Du code CRUD ajouté sans rattachement feature explicite **dérive** — il contourne les SSOT (`transitionOrderStatus`, `transitionParcelStatus`, `markPaid`), les invariants métier, et les guards automatiques.
2. Des corrections structurelles (coverage, refacto, alertes) placées **hors du cadre feature** ont produit des effets de bord transverses (incident pool DB, chargement infini boutique).
3. Les gates existantes vérifient la **cohérence** d'une feature déjà déclarée, mais pas que **toute modification CRUD passe effectivement par le cadre feature**.

Cette doctrine comble ce manque : elle pose la règle absolue que **tout ajout, modification ou suppression de CRUD passe par le manifest de la feature propriétaire**, avec toutes les safety gates vertes **avant** le commit.

---

## Règle fondamentale

> **Aucun CRUD (Create, Read, Update, Delete) sur une table métier n'est ajouté, modifié ou supprimé en dehors du périmètre déclaré d'une feature.**
>
> Si le fichier touché n'apparaît dans aucun `features/*.feature.js → files`, le commit est interdit.

Concrètement, pour un développeur ou un agent IA :

```txt
1. Identifier la feature propriétaire  →  features/<nom>.feature.js
2. Vérifier que le fichier touché est dans files.routes / files.services / files.utils
3. Si non → l'ajouter au manifest AVANT de coder
4. Respecter les invariants déclarés de la feature
5. Toutes les gates vertes → commit autorisé
```

---

## Checklist avant commit (obligatoire)

### Étape 1 — Rattachement feature

| Question | Action si NON |
|----------|--------------|
| Le fichier que je touche est-il dans un `features/*.feature.js → files` ? | L'ajouter au manifest de la feature propriétaire |
| La feature propriétaire est-elle `production` ou `staging` ? | Si `draft` : documenter pourquoi dans le commit message |
| Le CRUD que j'ajoute respecte-t-il le `perimeter.in` de la feature ? | Si hors périmètre : c'est peut-être la mauvaise feature |
| Le CRUD viole-t-il un `perimeter.out` ? | Stop — la feature n'a pas le droit de faire ça |

### Étape 2 — Respect des SSOT

| Table | SSOT obligatoire | Interdit |
|-------|-----------------|----------|
| `orders.status` | `transitionOrderStatus()` (order-status-machine.js) | `UPDATE orders SET status = …` direct |
| `orders.payment_status` | `markPaid()` / `markRefunded()` / `markFailed()` (payment-service.js) | `UPDATE orders SET payment_status = …` direct |
| `order_status_history` | `appendOrderHistoryNote()` (order-status-machine.js) | `INSERT INTO order_status_history` direct |
| `parcels.status` | `transitionParcelStatus()` (parcel-operations.js) | `UPDATE parcels SET status = …` direct |
| `wallet` (balance, transactions) | `credit()` / `debit()` (wallet-service.js) | `UPDATE wallets SET balance = …` direct |

Toute nouvelle table avec un champ `status` ou une machine d'état **doit** déclarer son SSOT dans le manifest de la feature (champ `invariants`).

### Étape 3 — Tests

| Règle | Seuil |
|-------|-------|
| Tout nouveau CRUD a au moins un test unitaire | Obligatoire |
| Le test couvre le chemin nominal + le chemin erreur | Obligatoire |
| Le test vérifie que le SSOT est respecté (mock du service, pas du SQL direct) | Obligatoire |
| Coverage du fichier touché ne baisse pas | Vérifié par `--coverage` |

### Étape 4 — Gates automatiques (pre-commit)

Le hook `pre-commit` exécute dans l'ordre :

```txt
N0  feature-registry-check --strict    Tout fichier appartient à une feature
N2  code-quality-gate --strict         use strict, const/let, pas de SQL concat
    enrich-komerce-arch-db-fields      Auto-déclaration @db-read/@db-write
    generate-komerce-arch-graph        Graphe d'architecture
    arch-reconcile --write             Budget de dette
    arch-db-check                      Hygiène headers
    arch-schema-drift-check            Drift SCHEMA.md ↔ DB
    arch-header-sql-check              Sous-déclaration headers ↔ SQL
    arch-doctrine-sanitize-check       Sanitize avant rendu
    audit-backend-arch                 Invariants I-BACK-*
    boutique check:fast                Invariants CSS/HTML/JS boutique
    gen-dashboards-360 --check         Chaîne route→vue→API dashboards
    gen-boutique-360 --check           Couplage BUS + endpoints boutique
    gen-meta-graph --check             Coutures cross-codebase
```

**Toutes ces gates doivent être vertes.** Un `git commit --no-verify` est réservé aux urgences prod documentées (REX obligatoire).

---

## Cycle de vie d'un CRUD feature-first

```txt
1. IDENTIFIER LA FEATURE
   → features/<nom>.feature.js
   → Lire : service, perimeter.in, perimeter.out, authority, invariants

2. DÉCLARER LE FICHIER DANS LE MANIFEST
   → files.routes / files.services / files.utils
   → Si nouvelle migration : files.migrations

3. CODER LE CRUD
   → Utiliser les SSOT (pas de SQL direct sur status)
   → Header @komerce-arch obligatoire
   → @db-read / @db-write déclarés (auto-enrichi)

4. ÉCRIRE LES TESTS
   → Chemin nominal + erreur
   → SSOT respecté (mock service, pas SQL)
   → npx jest <fichier> --coverage

5. VÉRIFIER LOCALEMENT
   → npx jest (backend + boutique + dashboards)
   → node scripts/feature-guard.js --strict
   → bash .git/hooks/pre-commit

6. COMMIT
   → Message : feat(<feature>): <description du CRUD>
   → Pre-commit auto : toutes les gates passent
   → Push → déploiement
```

---

## Règles spéciales

### Nouvelle feature

Si le CRUD n'appartient à aucune feature existante :

1. Créer `features/<nom>.feature.js` avec tous les champs obligatoires (`name`, `type`, `domain`, `status`, `owner`, `service`, `perimeter`, `authority`, `invariants`, `files`)
2. `status: 'draft'` jusqu'à validation fonctionnelle
3. Le `feature-registry-check` l'intègre automatiquement

### Modification transversale (db.js, middleware, bootstrap)

Les fichiers transversaux (`db.js`, `middleware/*.js`, `bootstrap/*.js`) appartiennent à la feature `infrastructure`. Toute modification :

1. Doit être déclarée dans `features/infrastructure.feature.js → files`
2. Ne doit **jamais** contenir de logique métier (REX PR563 : pas de rewrite d'alerts dans db.js)
3. Doit être testée en isolation (pas de dépendance à une feature métier)

### Convention de commit

```txt
feat(<feature>):  ajout/modification CRUD
fix(<feature>):   correction CRUD existant
test(<feature>):  ajout de tests pour un CRUD
refactor(<feature>): refacto interne sans changement de comportement
```

Exemples :
- `feat(orders): ajouter endpoint GET /api/orders/:id/invoice-url`
- `fix(shared-cart): corriger la transition close → settlement`
- `test(wallet-loyalty): couvrir debit FIFO edge-case solde insuffisant`

---

## Ce qui est interdit

| Interdit | Pourquoi | REX |
|----------|----------|-----|
| Modifier `db.js` pour un sujet métier | Un problème d'alerts/logging/observabilité n'est pas un problème de transport SQL | PR563 |
| `UPDATE <table> SET status = …` direct hors SSOT | Contourne la machine d'état et ses validations | D-01, D-02 |
| Ajouter un fichier source non rattaché à un manifest | Le `feature-registry-check` le bloque, mais le contourner avec `--no-verify` laisse un orphelin | Audit 2026-07-10 |
| `git commit --no-verify` sans REX | Bypass toutes les gates — autorisé uniquement en urgence prod, avec REX dans le même commit | Incident pool |
| Ajouter un CRUD qui viole le `perimeter.out` d'une feature | Cross-cutting = bug d'architecture garanti | FEATURE_DOCTRINE §3 |
| Test qui mock le SQL direct au lieu du service SSOT | Le test passe mais ne vérifie pas que le SSOT est utilisé | wallet-service.test.js mock manquant |

---

## Vérification automatique

Les gates existantes couvrent déjà la majorité des règles ci-dessus :

| Règle | Gate qui la vérifie |
|-------|-------------------|
| Fichier rattaché à une feature | `feature-registry-check --strict` (N0) |
| Header @komerce-arch présent | `arch-db-check` |
| @db-read/@db-write cohérents | `arch-header-sql-check` + `enrich-komerce-arch-db-fields` |
| Pas de SQL concat non sûr | `code-quality-gate --strict` (N2) |
| Pas de SQL direct sur payment_status hors owner | `audit-backend-arch` (I-BACK-4) |
| Pas de fetch brut dans les dashboards | `gen-dashboards-360 --check` |
| Pas d'endpoint fantôme | `gen-meta-graph --check` |
| Pas de sanitize manquant | `arch-doctrine-sanitize-check` |
| Slice cohérent | `feature-guard` |

**Manque identifié** : pas de gate automatique qui vérifie que les SSOT `transitionOrderStatus` / `transitionParcelStatus` / `markPaid` sont respectés (l'audit-backend-arch vérifie `payment_status` via I-BACK-4, mais pas les deux autres). C'est un renforcement à planifier.

---

## Annexe — Les 18 features et leurs SSOT

| Feature | Tables clés | SSOT |
|---------|------------|------|
| **orders** | orders.status, order_status_history | `transitionOrderStatus()`, `appendOrderHistoryNote()` |
| **payments** | orders.payment_status | `markPaid()`, `markRefunded()`, `markFailed()` |
| **logistics** | parcels.status | `transitionParcelStatus()` |
| **wallet-loyalty** | wallets, wallet_transactions, wallet_lots | `credit()`, `debit()` |
| **shared-cart** | cart_shares.status | `shared-cart-lifecycle.js` transitions |
| **catalog** | products (lifecycle_status, enrichment) | `product-admin-service.js` |
| **auth** | users, otp_tokens | `auth-middleware.js`, `otp-auth.js` |
| **auth-identity** | user_identities | `identity-service.js` |
| **customs** | customs_shipments | `customs-shipment-service.js` |
| **documents** | invoices, refund_receipts | `invoice-service.js`, `document-service.js` |
| **economic-engine** | charges, finance_config, pricing_* | `pricing-engine.js`, `cost-allocation/` |
| **infrastructure** | (transversal) | Aucun SSOT métier — ne touche que le transport |
| **inventory** | products.stock | `inventory-service.js` |
| **notifications** | (side-effect only) | `notification-service.js` |
| **platform-ops** | admin tables | `system.js` (admin-only) |
| **recommendations** | recommendation_* | `recommendation-engine.js` |
| **refunds** | refunds | `admin-order-refund.js` |
| **dashboard** | (read-only) | Aucune écriture — lecture uniquement |
