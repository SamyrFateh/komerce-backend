# Komerce — Panier Événement Collectif V1 — Guide de test

## 🎯 Vue d'ensemble

Implémentation V1 stricte du Panier Événement Collectif avec **capture atomique 100%** (zéro remboursement).

**Coexiste** avec le système `shared_carts` existant (qui reste actif et ne change pas).

```
ZONE 1 — Workspace (illimité dans le temps)
   conception → contributions = intentions libres, modifiable
ZONE 2 — Session de paiement (24-72h)
   open → tokens individuels, Stripe pre-auth manual capture
ZONE 3 — Commande (Komerce standard)
   confirmed → ordered → preparation → ... (flux existant)
```

## 📦 Fichiers livrés

| Fichier | Rôle |
|---|---|
| `migrations/048_collective_workspaces.sql` | 7 tables (workspace, items, contributions, sessions, tokens, events, idempotence Stripe) |
| `services/collective-workspace-engine.js` | Logique métier pure (BDD only) |
| `services/collective-payment-orchestrator.js` | Stripe + cron expiration + création commande |
| `routes/collective-workspaces.js` | Express routes |
| `server.js` (patché) | 2 lignes ajoutées (raw webhook + mount + cron) |

## 🔧 Variables d'environnement

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_COLLECTIVE_WEBHOOK_SECRET=whsec_...   # spécifique à ce webhook
# OU réutilise STRIPE_WEBHOOK_SECRET si même endpoint
EUR_KMF_RATE=492                              # taux de conversion (fallback)
```

## 🚀 Déploiement

```bash
# 1. Migration BDD
psql $DATABASE_URL -f migrations/048_collective_workspaces.sql

# 2. Push code
git add migrations/048_collective_workspaces.sql \
        services/collective-workspace-engine.js \
        services/collective-payment-orchestrator.js \
        routes/collective-workspaces.js \
        server.js
git commit -m "feat(collective): Panier Événement Collectif V1 (capture atomique 100%)"
git push

# 3. Configurer le webhook Stripe
#    URL : https://<ton-domaine>/api/collective-payments/stripe/webhook
#    Events :
#      - payment_intent.amount_capturable_updated
#      - payment_intent.requires_capture
#      - payment_intent.canceled
#      - payment_intent.payment_failed
```

## 🧪 Tests manuels (curl)

Remplace `BASE` par ton URL Railway et `RELAIS_ID` par un UUID de relais valide.

```bash
BASE=https://komerce-backend-production.up.railway.app
RELAIS_ID=00000000-0000-0000-0000-000000000000  # à remplacer
PRODUCT_ID_1=11111111-1111-1111-1111-111111111111  # à remplacer
PRODUCT_ID_2=22222222-2222-2222-2222-222222222222  # à remplacer
```

### 1️⃣ Créer un workspace

```bash
curl -X POST $BASE/api/collective-workspaces \
  -H "Content-Type: application/json" \
  -d '{
    "event_name": "Mariage Fatima septembre",
    "event_note": "Trousseau et bijoux",
    "creator_name": "Fatima",
    "creator_phone": "+269XXXXXXX",
    "creator_email": "fatima@example.com",
    "recipient_name": "Fatima",
    "recipient_phone": "+269XXXXXXX",
    "relais_id": "'$RELAIS_ID'"
  }'
```

→ Réponse :
```json
{
  "workspace_id": "uuid",
  "creator_token": "WC-...",
  "public_token": "WS-...",
  "public_url_path": "/k/WS-..."
}
```

**Garde precieusement `creator_token` et `public_token`.** Ils ne seront plus jamais affichés.

### 2️⃣ Ajouter des articles (créateur)

```bash
CREATOR_TOKEN=WC-...

curl -X PATCH $BASE/api/collective-workspaces/$CREATOR_TOKEN/items \
  -H "Content-Type: application/json" \
  -d '{"action":"add","product_id":"'$PRODUCT_ID_1'","quantity":2}'

curl -X PATCH $BASE/api/collective-workspaces/$CREATOR_TOKEN/items \
  -H "Content-Type: application/json" \
  -d '{"action":"add","product_id":"'$PRODUCT_ID_2'","quantity":1}'
```

### 3️⃣ Voir le workspace (vue publique pour les contributeurs)

```bash
PUBLIC_TOKEN=WS-...

curl $BASE/api/collective-workspaces/public/$PUBLIC_TOKEN
```

### 4️⃣ Ajouter des intentions (contributeurs, anonyme)

```bash
# Tonton ajoute son intention
curl -X POST $BASE/api/collective-workspaces/public/$PUBLIC_TOKEN/contributions \
  -H "Content-Type: application/json" \
  -d '{"contributor_name":"Tonton Marseille","intended_amount_kmf":50000,"contributor_email":"tonton@example.com"}'

# Cousine ajoute son intention
curl -X POST $BASE/api/collective-workspaces/public/$PUBLIC_TOKEN/contributions \
  -H "Content-Type: application/json" \
  -d '{"contributor_name":"Cousine Lyon","intended_amount_kmf":30000,"contributor_email":"cousine@example.com"}'
```

### 5️⃣ Review avant finalisation (recalcul serveur)

```bash
curl -X POST $BASE/api/collective-workspaces/$CREATOR_TOKEN/finalization-review
```

→ Renvoie : total recalculé, gap (sous/sur-financé), articles indisponibles, can_finalize.

### 6️⃣ Finaliser → génère les tokens individuels

```bash
curl -X POST $BASE/api/collective-workspaces/$CREATOR_TOKEN/finalize \
  -H "Content-Type: application/json" \
  -d '{"duration_hours": 48}'
```

→ Réponse :
```json
{
  "workspace_id": "...",
  "session_id": "...",
  "total_kmf": 80000,
  "expires_at": "2026-04-27T22:00:00Z",
  "tokens": [
    {"contributor_name": "Tonton Marseille", "amount_kmf": 50000, "payment_token": "PT-...", "payment_url_path": "/api/collective-payments/PT-..."},
    {"contributor_name": "Cousine Lyon", "amount_kmf": 30000, "payment_token": "PT-...", "payment_url_path": "/api/collective-payments/PT-..."}
  ]
}
```

**Le créateur transmet chaque token au contributeur correspondant** (WhatsApp, SMS, email).

### 7️⃣ Contributeur lit son token

```bash
TOKEN=PT-...
curl $BASE/api/collective-payments/$TOKEN
```

### 8️⃣ Contributeur initie le paiement (Stripe)

```bash
curl -X POST $BASE/api/collective-payments/$TOKEN/pay-card
```

→ Renvoie `client_secret` à utiliser côté frontend avec Stripe.js (stripe.confirmCardPayment).

### 9️⃣ Reprise après expiration

Si la session expire sans 100%, le workspace passe en `session_ended`. Pour reprendre :

```bash
curl -X POST $BASE/api/collective-workspaces/$CREATOR_TOKEN/resume
```

→ Le workspace repasse en `conception`, les contributions reviennent en `intention`, on peut tout relancer.

## 🔁 Flux Stripe complet (côté frontend)

```javascript
// 1. Récupérer le client_secret depuis le backend
const r = await fetch('/api/collective-payments/' + token + '/pay-card', { method: 'POST' });
const { client_secret } = await r.json();

// 2. Confirmer le paiement avec Stripe.js
const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
const result = await stripe.confirmCardPayment(client_secret, {
  payment_method: { card: cardElement }
});

// 3. Stripe autorise la carte → webhook backend reçu → token authorized
//    Si tous les tokens sont authorized → capture atomique → commande créée
```

## 🔍 Vérification BDD

```sql
-- Voir les workspaces actifs
SELECT id, event_name, status, created_at FROM collective_workspaces ORDER BY created_at DESC LIMIT 10;

-- Voir une session et ses tokens
SELECT s.id, s.status, s.total_to_pay_kmf, s.amount_secured_kmf, s.expires_at,
       COUNT(t.id) as tokens_count,
       COUNT(t.id) FILTER (WHERE t.status = 'authorized') as authorized_count,
       COUNT(t.id) FILTER (WHERE t.status = 'paid') as paid_count
FROM collective_payment_sessions s
LEFT JOIN collective_payment_tokens t ON t.session_id = s.id
GROUP BY s.id ORDER BY s.created_at DESC LIMIT 5;

-- Audit trail d'un workspace
SELECT event_type, actor_type, created_at, payload
FROM collective_workspace_events
WHERE workspace_id = '...'
ORDER BY created_at;
```

## 📋 Statuts (rappel)

| Enum | Valeurs |
|---|---|
| `collective_workspace_status` | conception → payment_pending → order_created / session_ended / archived |
| `collective_session_status` | open → ready_to_capture → paid / ended / failed |
| `collective_token_status` | active → authorized → paid / expired / cancelled / failed |
| `collective_contribution_status` | intention → converted / cancelled |

## ⚠️ Limitations V1 acceptées

- **Pas de cash contributeur** (cash réservé au créateur, géré par cash_relais existant le cas échéant)
- **Pas de modification de panier pendant session** (verrouillage strict)
- **Pas de wishlist publique, pas de chat interne, pas de gamification**
- **Pas de notifications automatiques** (le créateur partage les tokens manuellement)
- **Une seule devise utilisateur** : EUR pour les contributeurs (EUR/KMF via taux serveur)

## 🚧 À implémenter ensuite (V1.1)

- Frontend public : page `/k/:publicToken` pour la vue contributeur
- Frontend créateur : page `/k/c/:creatorToken` pour le tableau de bord
- Notifications WhatsApp/SMS automatiques (optionnel — V1 = manuel)
- Page de paiement Stripe Elements pour les contributeurs
- Test end-to-end avec carte de test 4242 4242 4242 4242
