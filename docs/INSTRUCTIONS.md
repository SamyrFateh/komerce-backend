# Patch server.js — 2 modifications minimales

## Modification 1 : raw body pour le webhook Stripe collective

Trouve cette ligne (vers la ligne 130) :
```js
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
```

**Ajoute juste après** :
```js
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));
```

## Modification 2 : require + mount + cron

Trouve ce bloc (vers la ligne 263-267) :
```js
// ═══ Panier Partagé MVP (Niveau 1) ═══
app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);
app.use('/api/shared-carts',       sharedCart.router);
app.use('/api/admin/shared-carts', sharedCart.adminRouter);
```

**Ajoute juste après** :
```js
// ═══ Panier Événement Collectif V1 (capture atomique 100%) ═══
const collectiveWS = require('./routes/collective-workspaces');
const collectivePaymentOrchestrator = require('./services/collective-payment-orchestrator');
app.post('/api/collective-payments/stripe/webhook', collectiveWS.stripeWebhookHandler);
app.use('/api/collective-workspaces', collectiveWS.router);
app.use('/api/collective-payments',   collectiveWS.paymentsRouter);
if (process.env.NODE_ENV !== 'test') {
  const intervalMs = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 30 * 1000;
  collectivePaymentOrchestrator.startExpirationCron(intervalMs);
}
```

## Validation

```bash
node --check server.js
```

C'est tout. Aucune autre ligne à modifier dans server.js.
