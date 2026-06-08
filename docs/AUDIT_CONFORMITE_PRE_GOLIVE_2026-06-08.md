# Audit de conformité pré-Golive — Komerce

> **Date** : 2026-06-08
> **Périmètre** : Backend (v10.6.1) · public/dashboards/admin · boutique (frontend)
> **Référence** : audit FRESH-* du 2026-06-07 (chat « Analyse intégrale du code backend et frontend »)
> **Doctrine** : I-01 (machine d'état), I-02 (hub paiement unique), I-07 (idempotence webhooks)

---

## Synthèse exécutive

| Bloc | Findings | ✅ Résolus | ⚠️ Partiels | ❌ Non traités |
|---|---|---|---|---|
| **Bloc critique go-live (FRESH-001 → FRESH-111)** | 7 | **6** | 1 | 0 |
| **Bloc post-go-live H+1 (FRESH-100 → FRESH-106)** | 7 | **5** | 1 | 1 |
| **Bloc dette technique** | 19 | partiel | — | — |

**Verdict global** : **GO conditionnel**. Les fondations critiques sont solides — la machine d'état (I-01), le hub paiement unique (I-02) et l'idempotence Stripe (I-07) sont rigoureusement respectés. Trois points résiduels avant Golive sérénité (détail §3).

---

## 1. Findings critiques — vérification une par une

### ✅ FRESH-001 — Mojibake fichiers JS/MD

**Statut** : RÉSOLU sur le périmètre JS/MD.

Vérifications faites :
- `grep -rn "Ã©|Ã¨|Ã®|Ã´|Ã»" --include="*.js" --include="*.md"` → **0 occurrence**.
- `.gitattributes` présent avec `* text=auto eol=lf` et règles spécifiques `*.js text eol=lf`.

**Reliquat identifié** : `db/schema.sql` conserve un mojibake massif sur les `COMMENT ON` (≈ 200 occurrences : `expÃ©dier`, `rÃ©elle`, `Ã‰vénement`, etc.). Sans impact runtime (commentaires SQL) mais à corriger si re-dump prod. Voir aussi `bootstrap/html-routes.js:105` (`Ã‰vénement`).

**Recommandation** : passe sed dédiée sur schema.sql avant le freeze final, ou accepter et noter dans STATUS.md (impact zéro).

---

### ⚠️ FRESH-003 — Routes orphelines `routes/routes_orders_*.js`

**Statut** : **NON ARBITRÉ** — les 3 fichiers sont toujours présents et toujours non montés.

État actuel :
| Fichier orphelin | Lignes | Monté ? | Apport vs version active |
|---|---|---|---|
| `routes/routes_orders_cancel.js` | 243 | ❌ | JOIN `recipients` (phone_payer, phone_beneficiary) |
| `routes/routes_orders_parcels.js` | 748 | ❌ | Utilise `notifyParcelScan` pour WID AuthKey (ordershipped / orderdelivered) |
| `routes/routes_orders_status.js` | 167 | ❌ | JOIN `recipients` idem cancel |

Le doc `routes/ORPHELINS_FRESH003.md` propose 3 options (A/B/C) — aucune n'a été tranchée.

**Risque pré-Golive** : les améliorations sur les notifications de scan (WID AuthKey vs SMS texte libre) ne sont **pas appliquées** car la version active (`routes/orders/parcels.js`) utilise toujours l'ancienne logique `PARCEL_SMS[status]`. Côté UX diaspora, ça change le ton et la délivrabilité des notifs de tracking.

**Recommandation** : exécuter **Option B (swap)** avant Golive — c'est 30 minutes et ça active les notifs WID propres :
```bash
# Swap parcels (apport WID significatif)
git mv routes/orders/parcels.js routes/orders/parcels.js.legacy
git mv routes/routes_orders_parcels.js routes/orders/parcels.js
# Cancel et status : choix selon usage recipients
```

---

### ✅ FRESH-010 — REQUIRED_ENV manquant

**Statut** : RÉSOLU. `bootstrap/env.js` contient bien :
```js
const requiredEnv = [
  'DATABASE_URL', 'JWT_SECRET', 'ADMIN_PASSWORD',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'QR_SECRET',
];
```
Plus le garde-fou bonus FRESH-111 (refus de boot prod si `OTP_TEST_MODE=true` ou `BOUTIQUE_TEST_OTP_BYPASS=true`).

---

### ✅ FRESH-101 — RECONCILIATION_PROD.sql

**Statut** : RÉSOLU. `RECONCILIATION_PROD.sql` présent à la racine (8 Ko, daté du 2026-06-08). Référencé correctement par le runner de migrations.

---

### ✅ FRESH-102 — Tests `confirmPaymentCycle`

**Statut** : RÉSOLU. `tests/unit/confirm-payment-cycle.test.js` créé (158 lignes, 9 tests). Couvre exactement les 6 cas exigés :

| Cas | Test | Statut |
|---|---|---|
| 1. `success:true` nominal | « Chemin heureux : stock suffisant » | ✅ |
| 2. `noop:true` déjà confirmed | « retourne noop=true si confirmed→pending renvoie noop » | ✅ |
| 3. `success:false` machine rejette | « retourne success=false si confirmed→pending échoue » | ✅ |
| 4. `stockBlocked:true` insufficientItems[] | « stockBlocked=true si stock insuffisant (produit simple) » | ✅ |
| 5. `dbClient` manquant → throw | « lève si dbClient est absent » | ✅ |
| 6. `orderId` manquant → throw | « lève si orderId est absent » | ✅ |

Plus 3 cas bonus : stockBlocked variante, confirmed→ordered non-fatal, produits sans stock (NULL) ignorés.

---

### ✅ FRESH-111 — Garde-fou `otp-test-mode` en prod

**Statut** : RÉSOLU.

1. Assertion synchrone au démarrage présente dans `bootstrap/env.js:37-43` — refuse explicitement le boot prod si bypass actif.
2. Test unitaire `tests/unit/otp-test-mode.test.js` présent.

---

### ✅ FRESH-109 — STATUS.md synchronisé

**Statut** : RÉSOLU. `docs/chantier/STATUS.md` (58 Ko) est daté du 2026-06-08 et liste les chantiers récents (N4, Z4, A-BE blocs, services et migrations récentes).

---

## 2. Findings post-go-live H+1 semaine

### ✅ FRESH-100 — Stripe Charges API → `latest_charge`

**Statut** : RÉSOLU. `routes/payments.js:286-294` utilise correctement `intent.latest_charge` (l'attribut `intent.charges` est déprécié depuis 2023).

```js
// FRESH-100 : intent.charges déprécié par Stripe (2023) → latest_charge
const charge = intent.latest_charge && typeof intent.latest_charge === 'object'
  ? intent.latest_charge : null;
```

---

### ⚠️ FRESH-104 — XSS admin moderne

**Statut** : PARTIELLEMENT RÉSOLU.

`public/dashboards/admin/js/views/ProductsView.js` corrigé (L539, L604 — passage à `textContent`).

**Mais** 12 autres `innerHTML` directs avec `${err.message}` subsistent dans :
- `HubRelaisView.js:576, 848`
- `CostingView.js:230, 273, 320`
- `InventoryView.js:284`
- `CategoriesView.js:308`
- 5 autres dans `PilotageView.js`, `TransitaireView.js`, etc.

**Niveau de risque** : modéré. Pour qu'un attaquant exploite, il faut qu'il puisse contrôler le contenu d'une erreur API serveur — peu probable mais pas impossible (ex : message Postgres avec valeur utilisateur). Le périmètre est admin (un seul utilisateur, MFA prévu).

**Recommandation** : ajouter un helper global `esc()` dans `public/dashboards/admin/js/utils.js` et faire un grep&replace systématique. ~20 minutes, ~30 sites.

---

### ✅ FRESH-105 — Décision admin-legacy

**Statut** : RÉSOLU. `bootstrap/html-routes.js:83-92` redirige 301 `/control-tower.html → /admin/pilotage` par défaut, avec escape hatch `ADMIN_LEGACY_ENABLED=1` documenté + header `X-Deprecated`.

---

### ✅ FRESH-107 / ✅ FRESH-108 — Migration 076 ENUM + dedup

**Statut** : RÉSOLU. `migrations/076_sourcing_candidates_unique.sql` contient :
- Bloc `DO $$` défensif qui détecte et dédoublonne **avant** la création de l'index unique
- `RAISE NOTICE` informatif (combien de doublons trouvés)
- Convention ENUM stricte (074 n'a pas d'usage immédiat, conforme)

---

### ❌ FRESH-106 — Test e2e checkout complet (Stripe test cards)

**Statut** : NON RÉSOLU.

Tests Playwright présents :
- F1 (modal produit), F2 (ajout panier), F3 (renderCheckout → formulaire → bouton payer), F4 (close modal), F5 (panier partagé), F5b (offline cache)

**Manque** : un test qui va jusqu'à la **confirmation Stripe** (carte test `4242 4242 4242 4242`) et vérifie l'état final de la commande (`payment_status=paid`, `status=confirmed`, code retrait généré, SMS envoyé).

**Niveau de risque** : moyen. Le webhook Stripe est testé unitairement (`payments-webhook.test.js`) mais le flow end-to-end (front → backend → Stripe → webhook) n'a pas de garde-fou automatisé. Une régression du formulaire de paiement ou du `client_secret` passerait inaperçue.

**Recommandation** : ajout d'un test Playwright qui :
1. Crée une commande via l'API
2. Récupère le `client_secret` via `/api/payments/stripe/intent`
3. Soumet via Stripe Elements en sandbox (carte `4242...`)
4. Trigger le webhook de test via `stripe trigger payment_intent.succeeded`
5. Vérifie l'état DB final

Peut être post-go-live H+1, mais à planifier.

---

### ⚠️ FRESH-103 — Tests services hot

**Statut** : 2/5 résolus.
| Service | Test ? |
|---|---|
| `services/notification-service.js` | ✅ `tests/unit/notification-service.test.js` présent |
| `services/authkey-client.js` | ✅ `tests/unit/authkey-client.test.js` présent |
| `services/routing.js` | ❌ |
| `services/shared-cart-engine.js` | ❌ (seul guard testé) |
| `services/scan-engine.js` | ✅ `tests/unit/scan-engine.test.js` présent |

**Reliquat** : `routing.js` et `shared-cart-engine.js` non couverts. Vu la criticité (le panier partagé brasse de l'argent diaspora) — au moins un test smoke sur l'orchestration du panier partagé est recommandé.

---

## 3. Action items avant Golive

Par ordre de priorité décroissante :

### 🟥 P0 — Bloquant Golive sérénité
1. **FRESH-003** — Arbitrer les 3 routes orphelines. Recommandation : swap `routes_orders_parcels.js` (gain WID notif scan). 30 min.

### 🟧 P1 — H-24h
2. **FRESH-104** — Helper `esc()` global admin + grep&replace innerHTML. 20 min.
3. **FRESH-001 reliquat** — Passe sed sur `db/schema.sql` pour purger le mojibake résiduel des COMMENT (zero risque, pure hygiène). 10 min.

### 🟨 P2 — Post-Golive H+1 semaine
4. **FRESH-106** — Test Playwright Stripe sandbox end-to-end.
5. **FRESH-103** — Tests smoke `routing.js` + `shared-cart-engine.js`.

---

## 4. Ce qui marche bien (à ne pas casser)

Le code livré est **mature** sur plusieurs axes critiques :

### 4.1 Doctrine I-02 (hub paiement unique) — RIGOUREUSEMENT RESPECTÉE
`confirmPaymentCycle()` est l'unique chemin de confirmation paiement et est utilisé par les 4 consommateurs critiques :
- `routes/payments.js` (Stripe webhook L220, cash relais L506)
- `routes/cash.js` L134
- `routes/orders/create.js` L393 (wallet 100%)
- `services/shared-cart-engine.js`

Aucun `UPDATE orders SET status` direct détecté dans les routes (grep clean).

### 4.2 Idempotence Stripe (I-07) — IMPECCABLE
`routes/payments.js:150-158` consulte `stripe_events_processed` **dès l'entrée** du webhook, avant tout traitement métier. Plus la garde dégradée si la table est indisponible. C'est exactement ce que prescrit la doctrine.

### 4.3 Machine d'état (I-01) — RESPECTÉE
`services/order-status-machine.js` :
- 9 imports dans le code (audité)
- 0 `UPDATE orders SET status` direct hors de ce fichier
- COALESCE sur les timestamps (jamais d'écrasement)
- Forward-only pour scan/system (idempotent)

### 4.4 Migrations défensives
- 076 : dedup avant index unique
- 074 : convention ENUM stricte (ADD VALUE seul, pas d'usage immédiat)
- 060/061 collisions résolues (renommages + tracking)

---

## 5. Conclusion

**Le projet est mûr pour le Golive**, avec une réserve sur 3 finitions (P0 + 2 P1, ≈ 1 heure de travail). La discipline architecturale est en place et les invariants critiques sont défendus par le code lui-même (state machine, hub paiement, idempotence).

Le prochain chantier annoncé — **PayPal pour la diaspora France** — est compatible avec l'architecture actuelle sans refacto :
- ENUM `payment_mode` extensible par ADD VALUE
- `confirmPaymentCycle({ source: 'paypal_capture' })` réutilisable tel quel après ajout du source à l'autorisation dans `order-status-machine.js`
- `paypal_events_processed` jumeau de `stripe_events_processed` pour I-07

Voir `docs/PAYPAL_IMPLEMENTATION_GUIDE.md` pour la mise en œuvre détaillée.

---

*Audit produit le 2026-06-08. Méthode : grep + lecture ciblée + croisement avec les findings FRESH-* du 2026-06-07.*
