# Komerce Backend — Corrections post-analyse code
> Date : 2026-05-17
> Base : BACKEND_AUDIT.md + BACKEND_GOLIVE_ROADMAP.md + BACKEND_AUDIT_SESSIONS_PLAN.md
> Méthode : lecture directe du code source (core.zip)
> Ce document ne remplace pas les audits — il les corrige et les complète.

---

## 1. Corrections de l'audit initial

### 1.1 console.log — chiffre corrigé
- **Audit disait** : 112 `console.log` dans routes/ et services/
- **Code réel** : 365 (routes/ : 255, services/ : 110)
- **Impact** : lot F1 (logger structuré) est ~3× plus gros que prévu

### 1.2 Doublons `parcels.js` — faux positif
- **Audit disait** : doublon à investiguer entre `routes/parcels.js` et `routes/orders/parcels.js`
- **Code réel** : deux fichiers distincts, chemins différents, responsabilités différentes
  - `routes/parcels.js` → `/api/parcels` — gestion colis (admin/relais)
  - `routes/orders/parcels.js` → `/api/orders/` — vue commande (mark-availability, partial-ship)
- **Action** : **lot A2 fermé — faux positif, rien à faire**

### 1.3 Collisions migrations 060/061 — risque minoré
- **Audit disait** : risque fort, runner pouvant rejouer ou sauter des migrations
- **Code réel** : le runner (`scripts/migrate.js`) appelle `fix-schema.js` qui contient les migrations inline en SQL hardcodé. Les fichiers `migrations/*.sql` ne sont pas lus automatiquement par le runner.
- **Impact** : lot A4 (renommage collisions) reste utile pour la propreté mais n'est pas un risque d'exécution immédiat
- **Nuance** : si un déploiement manuel exécute les fichiers `.sql` directement, la collision existe. À documenter dans A5.

---

## 2. Bonnes nouvelles non anticipées

### 2.1 Webhook Stripe — blindé sur les 3 endpoints
- `routes/payments.js`, `routes/shared-cart.js`, `routes/collective-workspaces.js`
- Les 3 vérifient la signature via `stripe.webhooks.constructEvent`
- Idempotence double : table `stripe_events_processed` (event.id, ON CONFLICT DO NOTHING) + garde dégradée sur `payment_status`
- `express.raw()` correctement positionné avant `express.json()` dans server.js
- **→ AUDIT-D2 peut être coché ✅ sans session dédiée**

### 2.2 Admin auth — 100% couvert
- `routes/admin.js` : `const guard = [authenticate, requireRole(['admin'])]` appliqué à toutes les routes
- Aucune route admin sans authentification détectée
- **→ AUDIT-D1 sera une confirmation rapide, pas une découverte**

### 2.3 Pickup secret — mécanisme solide
- Génération via `crypto.randomBytes` (cryptographiquement sûr)
- Hash SHA256 + sel par commande
- Anti-collision sur les codes actifs
- Rate limit : 3 tentatives → `pickup_secret_blocked_until`
- **→ AUDIT-D4 sera essentiellement positif**

### 2.4 Race conditions collectives — gardées
- `SELECT FOR UPDATE` sur `collective_payment_sessions` ET `collective_workspaces`
- BEGIN/COMMIT/ROLLBACK cohérents
- **→ AUDIT-G3 : zone protégée, focus sur les edge cases**

---

## 3. Nouveaux risques détectés (non dans l'audit initial)

### 3.1 🔴 QR_SECRET — fallback en dur (CORRIGÉ)
- **Trouvé** : `routes/orders/qr.js` ligne 50 — `process.env.QR_SECRET || 'komerce-qr-default-secret-change-in-prod'`
- **Risque** : QR de retrait forgeable si variable non configurée en Railway
- **Correction appliquée** :
  - `QR_SECRET` ajouté dans `REQUIRED_ENV` de `server.js`
  - Fallback supprimé dans `routes/orders/qr.js`

### 3.2 🟠 STRIPE_SECRET_KEY — était en RECOMMENDED seulement (CORRIGÉ)
- **Trouvé** : `STRIPE_SECRET_KEY` dans `RECOMMENDED_ENV` → serveur démarrait sans Stripe configuré
- **Correction appliquée** : promu en `REQUIRED_ENV`

### 3.3 🟠 Secrets webhook Stripe — non vérifiés au démarrage (CORRIGÉ)
- **Trouvé** : `STRIPE_WEBHOOK_SECRET`, `STRIPE_SHARED_CART_WEBHOOK_SECRET`, `STRIPE_COLLECTIVE_WEBHOOK_SECRET` absents de `REQUIRED_ENV`
- **Correction appliquée** : tous 3 ajoutés en `REQUIRED_ENV`

### 3.4 🟡 Pickup rate limit — in-memory seulement
- **Trouvé** : 2 TODO explicites dans `routes/pickup-secret.js` (lignes 336 et 1110) signalant que le rate limit est en RAM
- **Risque** : inefficace en multi-instance (chaque pod a son propre compteur)
- **Non bloquant** tant que Railway tourne sur une instance unique
- **Action** : ajouter un lot "migrer pickup rate-limit vers Redis" dans le bloc F ou post go-live

### 3.5 🟡 META_WA_APP_SECRET — fallback sur chaîne vide
- **Trouvé** : `routes/meta-whatsapp.js` — `process.env.META_WA_APP_SECRET || ''`
- Le code désactive la vérification HMAC si absent (avec warn explicite "DEV uniquement")
- **Correction partielle** : ajouté en `RECOMMENDED_ENV` (warn au démarrage)
- **Non bloquant** si WhatsApp n'est pas actif en prod immédiatement

---

## 4. Modifications appliquées au code

### 4.1 `server.js` — REQUIRED_ENV durci
```diff
- const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
- const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];
+ const REQUIRED_ENV = [
+   'DATABASE_URL',
+   'JWT_SECRET',
+   'STRIPE_SECRET_KEY',
+   'STRIPE_WEBHOOK_SECRET',
+   'STRIPE_SHARED_CART_WEBHOOK_SECRET',
+   'STRIPE_COLLECTIVE_WEBHOOK_SECRET',
+   'QR_SECRET',
+ ];
+ const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'META_WA_APP_SECRET'];
```

### 4.2 `routes/orders/qr.js` — fallback QR_SECRET supprimé
```diff
- const secret = process.env.QR_SECRET || 'komerce-qr-default-secret-change-in-prod';
+ // QR_SECRET est obligatoire (REQUIRED_ENV dans server.js) — pas de fallback.
+ const secret = process.env.QR_SECRET;
```

### 4.3 `routes/orders/order-api-v2.js` — fantôme supprimé (A1)
```bash
git rm routes/orders/order-api-v2.js
```

---

## 5. Mise à jour des lots de la roadmap

| Lot | Statut avant | Statut après | Motif |
|---|---|---|---|
| A1 | ☐ | ✅ | Fantôme supprimé |
| A2 | ☐ | ✅ fermé | Faux positif — deux fichiers distincts |
| AUDIT-D2 | ☐ | ✅ | Webhook blindé, session inutile |
| D0 (nouveau) | — | ✅ | REQUIRED_ENV durci + QR_SECRET corrigé |

---

## 6. Variables Railway à configurer avant go-live

```
STRIPE_SECRET_KEY                    sk_live_...
STRIPE_WEBHOOK_SECRET                whsec_...   (endpoint /api/payments/stripe/webhook)
STRIPE_SHARED_CART_WEBHOOK_SECRET    whsec_...   (endpoint /api/shared-carts/stripe/webhook)
STRIPE_COLLECTIVE_WEBHOOK_SECRET     whsec_...   (endpoint /api/collective-payments/stripe/webhook)
QR_SECRET                            $(openssl rand -hex 32)
```

Si les 3 webhooks Stripe pointent sur le même endpoint côté dashboard Stripe,
les 3 secrets peuvent être identiques. Sinon, créer 3 webhooks distincts.

---

## 7. Nouveau lot à ajouter — PayPal (post go-live)

**Contexte** : architecture confirmée compatible. Le collectif converge vers un paiement
unitaire standard — PayPal s'insère exactement comme Stripe.

**Fichiers à créer** :
- `routes/payments-paypal.js` — create-order, capture, webhook
- `services/paypal-client.js` — wrapper SDK

**Modifications minimales** :
- `order-status-machine.js` — ajouter `'paypal_capture'` comme source valide
- `routes/orders/create.js` — ajouter `'paypal_eur'` dans les payment_mode valides
- `server.js` — ajouter `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` en REQUIRED_ENV

**Frontend** : SDK PayPal JS, bouton Pay in 4 inclus sans surcoût backend.

**Priorité** : post go-live (souhaitable, non bloquant).
