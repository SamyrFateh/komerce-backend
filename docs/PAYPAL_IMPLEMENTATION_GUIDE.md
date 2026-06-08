# Guide de déploiement — Sprint pré-Golive + PayPal

> **Date** : 2026-06-08
> **Périmètre** : fiabilisation FRESH-* + intégration PayPal diaspora France
> **Auteur** : audit + implémentation 2026-06-08

---

## 1. Synthèse du livrable

Ce zip contient **deux blocs indissociables** :

### Bloc A — Fiabilisation pré-Golive
| Finding | Type | Fichiers |
|---|---|---|
| FRESH-003 | Swap routes orphelines | `Backend/routes/orders/{parcels,cancel,status}.js` |
| FRESH-104 | XSS admin — helper esc() + 7 sites patchés | `Backend/public/dashboards/admin/js/utils.js`, `index.html`, 4 views |
| FRESH-001 reliquat | Mojibake `db/schema.sql` purgé (~135 occurrences) | `Backend/db/schema.sql` |

### Bloc B — PayPal (Migration 079)
| Composant | Fichier |
|---|---|
| Migration SQL (ENUM + colonnes + table idempotence) | `Backend/migrations/079_paypal_payment_mode.sql` |
| Wrapper SDK (fetch natif, zéro nouvelle dépendance) | `Backend/services/paypal-client.js` |
| Routes (create-order, capture, webhook, refund) | `Backend/routes/payments-paypal.js` |
| Patch machine d'état (source `paypal_capture`) | `Backend/services/order-status-machine.js` |
| Patch server.js (webhook raw body + config publique) | `Backend/server.js` |
| Patch api-routes.js (mount router) | `Backend/bootstrap/api-routes.js` |
| Patch env.js (REQUIRED en prod) | `Backend/bootstrap/env.js` |
| Patch .env.example | `Backend/.env.example` |
| Tests unitaires wrapper | `Backend/tests/unit/paypal-client.test.js` |
| Tests unitaires webhook | `Backend/tests/unit/paypal-webhook.test.js` |
| Module front bouton PayPal | `boutique/js/b-paypal.js` |
| Patch checkout (4 patches) | `boutique/js/b-checkout.js` |
| CSS bouton PayPal | `boutique/css/paypal.css` |

---

## 2. Procédure de déploiement (ordre impératif)

### Étape 1 — Récupérer les credentials PayPal (avant tout)

**Sans cette étape, l'app refusera de démarrer en prod** (politique REQUIRED).

1. Aller sur https://developer.paypal.com/dashboard/applications/live
2. Créer une app "Komerce Production" → noter `client_id` + `client_secret`
3. Créer un webhook : Dashboard > Webhooks > Add Webhook
   - URL : `https://<TON-DOMAINE>/api/payments/paypal/webhook`
   - Events à souscrire :
     - `PAYMENT.CAPTURE.COMPLETED`
     - `PAYMENT.CAPTURE.DENIED`
     - `PAYMENT.CAPTURE.REFUNDED`
     - `PAYMENT.CAPTURE.REVERSED`
     - `CUSTOMER.DISPUTE.CREATED`
     - `CUSTOMER.DISPUTE.UPDATED`
   - Noter `Webhook ID`
4. Configurer sur Railway (Settings > Variables) :
   ```
   PAYPAL_CLIENT_ID=AS...
   PAYPAL_CLIENT_SECRET=EL...
   PAYPAL_WEBHOOK_ID=8XX...
   PAYPAL_ENV=production
   ```

### Étape 2 — Backup DB

```bash
pg_dump $DATABASE_URL > backup_pre_079_$(date +%Y%m%d_%H%M%S).sql
```

### Étape 3 — Appliquer la migration 079

```bash
# En staging d'abord (sur réplique exacte du schéma prod)
psql $STAGING_DATABASE_URL -f migrations/079_paypal_payment_mode.sql

# Vérifier la sortie attendue :
# NOTICE:  Migration 079 : payment_mode += paypal_eur
# ALTER TABLE / CREATE INDEX / CREATE TABLE
# COMMIT
```

⚠️ **Important** : la migration est en **2 transactions séparées** (limitation PostgreSQL — un `ADD VALUE` sur ENUM ne peut pas coexister avec son utilisation dans la même transaction). Si la transaction 1 réussit et la 2 échoue : ENUM ajouté mais colonnes manquantes → relancer la migration (idempotente via `IF NOT EXISTS`).

### Étape 4 — Déployer le code (Railway auto via git push)

L'ordre des fichiers à pousser n'a pas d'importance — Railway redéploie tout en bloc.

**Vérifier avant le push** :
- [ ] `Backend/bootstrap/env.js` contient `PAYPAL_CLIENT_ID` dans `requiredEnv`
- [ ] `Backend/server.js` ligne 71 contient le mount `paypal/webhook` AVANT `express.json` ligne 73
- [ ] `Backend/routes/payments-paypal.js` existe et exporte un router
- [ ] `Backend/services/order-status-machine.js` contient `paypal_capture` aux 2 listes

**Smoke test** après redémarrage Railway :
```bash
# Health
curl https://<DOMAINE>/api/health  # → status:'ok'

# Config publique expose paypal_client_id ?
curl https://<DOMAINE>/api/public/config | jq .paypal_client_id  # → "AS..."

# Webhook endpoint répond (sans signature → 401 attendu)
curl -X POST https://<DOMAINE>/api/payments/paypal/webhook \
  -H "Content-Type: application/json" \
  -d '{"id":"test","event_type":"TEST"}'
# → 401 Invalid signature (CORRECT — preuve que la signature est exigée)
```

### Étape 5 — Tester en sandbox (avant Pay Live)

PayPal recommande de tester EN SANDBOX avant la production. Procédure :
1. `PAYPAL_ENV=sandbox` + credentials sandbox sur un environnement staging
2. Créer une commande EUR depuis la boutique
3. Cliquer "PayPal" → utiliser un buyer sandbox (https://developer.paypal.com/dashboard/accounts)
4. Vérifier dans la DB :
   ```sql
   SELECT id, reference, payment_status, payment_mode, paypal_capture_id, paypal_pay_in_4_used
   FROM orders WHERE reference = 'K-XXXX';
   -- Attendu : payment_status='paid', payment_mode='paypal_eur', capture_id renseigné
   ```
5. Vérifier l'idempotence :
   ```sql
   SELECT event_type, status FROM paypal_events_processed
   WHERE processed_at > NOW() - INTERVAL '5 minutes' ORDER BY processed_at DESC;
   ```

### Étape 6 — Tests automatisés

```bash
cd Backend
npm test -- tests/unit/paypal-client.test.js   # ✅ 19 tests
npm test -- tests/unit/paypal-webhook.test.js  # ✅ 10 tests
```

### Étape 7 — Activation progressive

Une fois sandbox validé :
1. Changer `PAYPAL_ENV=production` sur Railway
2. Mettre les credentials Live (CLIENT_ID/SECRET/WEBHOOK_ID Live)
3. **Redémarrer le service** (Railway le fait automatiquement après changement variable)
4. La chip PayPal apparaît automatiquement dans la boutique (détection via `/api/public/config`)

---

## 3. Validations post-déploiement

### 3.1 Côté backend

```bash
# Logs Railway
railway logs --service backend | grep -i paypal

# Doit afficher au démarrage :
# [INFO] [env] OK (PAYPAL_CLIENT_ID, _SECRET, _WEBHOOK_ID présents)
```

### 3.2 Première commande PayPal en production

Procédure manuelle recommandée pour le premier paiement réel :
1. Faire une commande "test" à petit montant (10-15 EUR) avec ton propre compte PayPal
2. Vérifier l'arrivée du paiement dans https://www.paypal.com/business
3. Vérifier les colonnes DB :
   ```sql
   SELECT reference, payment_status, paypal_capture_id, paypal_payer_email
   FROM orders ORDER BY created_at DESC LIMIT 1;
   ```
4. Tester un refund admin :
   ```bash
   curl -X POST https://<DOMAINE>/api/payments/paypal/refund/<ORDER_ID> \
     -H "Authorization: Bearer <ADMIN_JWT>" \
     -H "Content-Type: application/json" \
     -d '{"reason":"test refund"}'
   ```

### 3.3 Détection Pay-in-4 effectif

Une fois quelques commandes diaspora France passées :
```sql
SELECT
  COUNT(*) FILTER (WHERE paypal_pay_in_4_used) AS pay_in_4_count,
  COUNT(*)                                     AS paypal_total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE paypal_pay_in_4_used) / NULLIF(COUNT(*), 0), 1)
    AS pay_in_4_pct
FROM orders
WHERE payment_mode = 'paypal_eur'
  AND payment_status = 'paid';
```

---

## 4. Plan de rollback

Si quelque chose part de travers, le rollback est sûr :

### Rollback code
```bash
git revert HEAD  # ou checkout sur le tag précédent
git push  # Railway redéploie
```

### Rollback DB (rare — la migration 079 est additive)
La migration 079 N'EFFACE RIEN. Pour la "rollback" :
```sql
-- ENUM : impossible de retirer un valeur sans recréer le type
-- (acceptable : 'paypal_eur' restera dans l'ENUM mais inutilisé)

-- Colonnes : peuvent être laissées (additives)
-- OU forcer le retrait :
ALTER TABLE orders DROP COLUMN IF EXISTS paypal_order_id;
ALTER TABLE orders DROP COLUMN IF EXISTS paypal_capture_id;
ALTER TABLE orders DROP COLUMN IF EXISTS paypal_payer_email;
ALTER TABLE orders DROP COLUMN IF EXISTS paypal_payer_id;
ALTER TABLE orders DROP COLUMN IF EXISTS paypal_pay_in_4_used;

-- Table idempotence : conserver pour traçabilité historique
-- (pas de raison de la supprimer)
```

### Rollback env vars
Si tu as activé `PAYPAL_*` en REQUIRED et que tu veux désactiver temporairement :
1. Soit garder les vars (sandbox suffit)
2. Soit modifier `bootstrap/env.js` pour passer PayPal en `recommendedEnv`

---

## 5. Suppression des fichiers FRESH-003 (à faire à la main)

Après déploiement, supprimer les 3 fichiers orphelins du repo source :

```bash
cd Backend
git rm routes/routes_orders_cancel.js
git rm routes/routes_orders_parcels.js
git rm routes/routes_orders_status.js
git rm routes/ORPHELINS_FRESH003.md
git commit -m "FRESH-003: suppression fichiers orphelins après swap vers routes/orders/"
```

**Vérification post-suppression** :
```bash
grep -r "routes_orders_" Backend/ 2>/dev/null || echo "OK — aucune référence"
```

---

## 6. Checklist Golive sérénité

Avant d'annoncer le Golive officiel à l'équipe :

- [ ] Migration 079 appliquée en prod (vérifier `\d orders` dans psql → colonnes paypal_*)
- [ ] Variables Railway PAYPAL_* configurées avec credentials Live
- [ ] PAYPAL_ENV=production
- [ ] Smoke tests OK (cf §2 étape 4)
- [ ] Première commande PayPal réelle réussie (cf §3.2)
- [ ] Refund admin testé et confirmé sur le dashboard PayPal Business
- [ ] Webhook reçoit bien les events (vérifier `SELECT COUNT(*) FROM paypal_events_processed` après 1h d'activité)
- [ ] Tests Jest verts : `npm test -- paypal`
- [ ] FRESH-003 : 3 fichiers orphelins supprimés du repo
- [ ] FRESH-104 : `utils.js` chargé en console (ouvre F12 → `window.esc` doit exister)
- [ ] STATUS.md mis à jour avec le déploiement 079
- [ ] Un message diaspora France de communication : "PayPal disponible !"

---

## 7. Points d'attention spécifiques

### 7.1 PayPal Pay-in-4 : éligibilité

Pay-in-4 est **automatiquement proposé** par PayPal côté SDK quand :
- Montant entre 30€ et 1500€
- Acheteur résidant en France (vérifié côté PayPal)
- Acheteur a un compte PayPal en France

**Aucun code spécifique à écrire** — le paramètre `enable-funding=paylater` dans l'URL du SDK déclenche tout. La colonne `paypal_pay_in_4_used` se remplit automatiquement via `extractCaptureInfo()` qui détecte `payment_source.paylater`.

### 7.2 Frais marchand

| Mode | Frais marchand | Quand |
|---|---|---|
| Stripe | 1.5% + 0.25€ | Carte EU |
| PayPal | 2.99% + 0.35€ | PayPal, Pay-in-4 inclus sans surcoût |

À piloter dans le finance_config pour ajuster les marges si la part PayPal monte significativement.

### 7.3 Litiges PayPal

Les disputes arrivent via webhook `CUSTOMER.DISPUTE.CREATED`. Une alerte critique est insérée dans `alerts` table → à intégrer dans l'admin pour visibilité opérationnelle.

Délais standards :
- Dispute "merchandise" : 180 jours
- Dispute "unauthorized" : 60 jours

### 7.4 Reconciliation comptable

Mensuellement, croiser :
```sql
SELECT
  DATE_TRUNC('month', created_at) AS month,
  payment_mode,
  COUNT(*) AS orders,
  SUM(total_eur) AS total_eur
FROM orders
WHERE payment_status = 'paid'
  AND payment_mode IN ('stripe_eur', 'paypal_eur')
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

Versus le rapport PayPal Business mensuel téléchargeable.

---

## 8. Que faire si...

| Symptôme | Action |
|---|---|
| Boot Railway en échec : "FATAL: PAYPAL_CLIENT_ID manquant" | Vérifier variables d'env Railway, redémarrer |
| Boot OK mais bouton PayPal ne s'affiche pas | F12 → vérifier `/api/public/config` retourne `paypal_client_id` non vide |
| Bouton PayPal s'affiche mais clic → "Erreur création paiement" | Logs backend : chercher `[PAYPAL] create-order failed`, vérifier credentials |
| Capture OK mais order reste `pending` en DB | Logs : `[PAYPAL] cycle rejected` → vérifier transitions order-status-machine |
| Webhook ne reçoit rien | PayPal Dashboard > Webhooks > Test webhook → vérifier URL + events souscrits |
| Refund échoue avec 422 | Capture probablement <24h ancienne — attendre ou utiliser dispute |

---

*Document généré le 2026-06-08 — Audit & implémentation PayPal pour Komerce go-live diaspora.*
