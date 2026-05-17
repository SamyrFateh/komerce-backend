# D5 — Audit `.env.example` vs runtime

> Date : 2026-05-17
> Scope : audit + documentation env uniquement

## Résumé

Audit de `.env.example`, `server.js`, `package.json` et usages `process.env.*` critiques.

Aucune validation pre-start n'a été réactivée dans ce lot afin de ne pas recasser le boot Railway.

## État runtime constaté

### Démarrage

`package.json` démarre avec :

```json
"start": "npm run build && node server.js"
```

Donc le script `scripts/validate-required-env.js`, créé lors de D0, n'est pas dans le chemin de démarrage actuel.

### Validation actuelle dans `server.js`

`server.js` bloque uniquement sur :

- `DATABASE_URL`
- `JWT_SECRET`

`server.js` avertit seulement sur :

- `ADMIN_PASSWORD`
- `STRIPE_SECRET_KEY`

## Variables présentes dans `.env.example`

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `QR_SECRET`
- `AT_API_KEY`
- `AT_USERNAME`
- `AT_SENDER_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `RATE_EUR_KMF`
- `RATE_AED_KMF`
- `FRONTEND_URL`

## Variables runtime critiques ou utiles absentes de `.env.example`

### Sécurité / admin

- `ADMIN_PASSWORD`
- `ALLOWED_ORIGINS`
- `DB_SSL_REJECT_UNAUTHORIZED`
- `DB_POOL_MAX`
- `DB_STATEMENT_TIMEOUT`

### Stripe / paiements

- `STRIPE_SHARED_CART_WEBHOOK_SECRET`
- `STRIPE_COLLECTIVE_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`

Notes : les endpoints raw body existent pour les webhooks Stripe standard, shared cart et collective payment. Les secrets dédiés doivent être documentés même si le boot ne doit pas bloquer tant que Railway n'est pas complété.

### WhatsApp / AuthKey / Meta

- `AUTHKEY_API_KEY`
- `AUTHKEY_COUNTRY_CODE`
- `WID_ORDER_CREATED`
- `WID_PAYMENT_CONFIRMED`
- `WID_ORDER_SHIPPED`
- `WID_ORDER_DELIVERED`
- `WID_ORDER_CANCELLED`
- `WID_ABANDONED_CART`
- `META_WA_GRAPH_VERSION`
- `META_WA_TOKEN`
- `META_WA_PHONE_NUMBER_ID`
- `META_WA_VERIFY_TOKEN`
- `META_WA_APP_SECRET`

### Email / URLs applicatives

- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `APP_URL`

### Rate limiting / multi-instance

- `REDIS_URL`

## Écarts importants

### 1. QR_SECRET documenté mais pas garanti au boot

`.env.example` contient `QR_SECRET`, mais `server.js` ne le rend pas obligatoire.

D4 a déjà identifié que l'absence de `QR_SECRET` au runtime dégrade la sécurité QR.

Action recommandée : rendre `QR_SECRET` obligatoire dans `server.js` après vérification Railway, ou ajouter un guard runtime localisé dans la route de génération QR.

### 2. Secrets Stripe spécialisés non documentés dans `.env.example`

Les secrets shared cart et collective payment doivent apparaître dans `.env.example`, même si la validation stricte est différée.

Action recommandée : compléter `.env.example` sans réactiver la validation pre-start.

### 3. Meta webhook a un verify token par défaut

`META_WA_VERIFY_TOKEN` a un défaut applicatif. Pratique en dev, mais à configurer explicitement en prod.

### 4. WhatsApp/AuthKey est actif dans les services mais absent de `.env.example`

Le service AuthKey lit plusieurs variables et WID de templates. Elles doivent être documentées pour éviter des notifications silencieusement inopérantes.

### 5. Brevo absent de `.env.example`

`utils/email.js` lit `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` et `APP_URL`.

## Conclusion D5

D5 est validé côté audit.

Le correctif sûr consiste à compléter `.env.example` avec les variables manquantes, sans modifier `server.js` ni `package.json` dans ce lot.

## Recommandation de suite

- Ajouter les variables manquantes dans `.env.example` avec valeurs placeholders.
- Garder toute validation stricte pour un lot dédié, après vérification des variables Railway.
