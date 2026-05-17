# D2 — Audit webhooks Stripe / idempotence

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit des trois surfaces Stripe webhook :

- paiement commande classique : `routes/payments.js`
- panier partagé : `routes/shared-cart.js`
- paiement collectif : `routes/collective-workspaces.js` + `services/collective-payment-orchestrator.js`

Aucune modification de code n'a été appliquée dans ce lot.

## Montage raw body

`server.js` monte les trois webhooks Stripe avec `express.raw({ type: 'application/json' })` avant `express.json()` :

```js
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
```

Conclusion : l'invariant I-07 est respecté côté montage.

## Webhook commande classique — `routes/payments.js`

### Garanties constatées

- Signature vérifiée avec `stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)`.
- Table `stripe_events_processed` consultée dès l'entrée.
- Si event déjà vu : retour 200 idempotent, sans side-effect.
- `payment_intent.succeeded` ignore proprement les PaymentIntents sans `metadata.order_id`.
- Garde additionnelle si `payment_status = 'paid'`.
- Traitement principal dans transaction `BEGIN/COMMIT`.
- Cycle paiement centralisé via `confirmPaymentCycle(...)`.
- Stock géré par le cycle central, avec cas `paid_but_stock_blocked` documenté et alerté.
- Event Stripe marqué comme traité dans la transaction nominale.
- `payment_intent.payment_failed` ne modifie que les commandes encore `payment_status = 'pending'`.
- Notifications, SMS et sourcing sont post-commit et non bloquants.

### Risques / limites

- Si `stripe_events_processed` est indisponible, le webhook continue en mode dégradé. Le code réduit le risque via `payment_status`, mais l'idempotence forte est alors affaiblie.
- Les side-effects post-commit ne sont pas rejoués si l'event est marqué traité puis que notification/sourcing échoue. Le code insère une alerte sur erreur sourcing ; c'est acceptable mais à surveiller en ops.
- Les logs restent en `console.*`, sans `request_id` structuré. À traiter dans F1/F7.

## Webhook panier partagé — `routes/shared-cart.js`

### Garanties constatées

- Signature Stripe vérifiée avec `stripe.webhooks.constructEvent`.
- Secret dédié `STRIPE_SHARED_CART_WEBHOOK_SECRET`, avec fallback vers `STRIPE_WEBHOOK_SECRET`.
- Idempotence via `stripe_events_processed` avant traitement.
- `checkout.session.completed` est filtré par `metadata.komerce === 'shared_cart_contribution'`.
- Les contributions non pertinentes sont ignorées et marquées traitées.
- `checkout.session.expired` marque la contribution failed/expired côté engine.

### Risques / limites

- Le fallback vers `STRIPE_WEBHOOK_SECRET` est pratique mais moins strict en production. D5 a déjà documenté que le secret dédié doit être configuré explicitement.
- `markStripeEventProcessed(...)` est appelé après `engine.confirmContributionFromStripe(session)`. Si la contribution est confirmée puis que le marquage d'event échoue, un replay Stripe peut rappeler l'engine. La robustesse dépend donc aussi de l'idempotence interne de `confirmContributionFromStripe`.
- La route n'ouvre pas elle-même une transaction englobant confirmation contribution + marquage event. À confirmer dans l'engine si l'on veut une idempotence transactionnelle stricte.

## Webhook paiement collectif — `routes/collective-workspaces.js` + orchestrator

### Garanties constatées

- Signature Stripe vérifiée avec `stripe.webhooks.constructEvent`.
- Secret dédié `STRIPE_COLLECTIVE_WEBHOOK_SECRET`, avec fallback vers `STRIPE_WEBHOOK_SECRET`.
- Idempotence event via `orchestrator.isStripeEventProcessed(event.id)`.
- Les PaymentIntents collectifs utilisent `capture_method: 'manual'`.
- Création PaymentIntent avec idempotency key Stripe `cpt_<token_id>`.
- Autorisation carte traitée par `onPaymentAuthorized(...)` avec `SELECT ... FOR UPDATE` sur le token.
- Capture de chaque PaymentIntent avec idempotency key `cap_<token_id>`.
- Refund compensatoire best-effort avec idempotency key `refund_<token_id>` en cas d'échec partiel.
- Expiration de session annule les PaymentIntents avec idempotency key `cancel_<token_id>`.

### Risques / limites

- Comme pour shared-cart, fallback vers `STRIPE_WEBHOOK_SECRET` à remplacer en prod par secret dédié explicite.
- Le webhook marque l'event traité après `onPaymentAuthorized(...)`. Si le traitement autorise le token puis que le marquage d'event échoue, le replay retombe sur l'idempotence token (`authorized`/`paid`) ; c'est acceptable mais pas aussi propre qu'un marquage event transactionnel en tête.
- `_createOrderFromSession(...)` insère directement une commande avec `status = 'confirmed'`, puis ajoute manuellement `order_status_history`, puis transitionne vers `ordered` via machine hors transaction. Ce n'est pas une violation aussi nette que `/pay-cash`, car l'historique `confirmed` est inséré, mais ce flow doit être revu dans I-SWEEP pour alignement strict avec `confirmPaymentCycle` / machine.
- Capture atomique et création commande sont déclenchées en `setImmediate`. Le webhook répond rapidement, mais l'opération lourde devient asynchrone process-local. Si le process crash après autorisation 100 % et avant capture, il faut un mécanisme de reprise/cron/repair.

## Conclusion D2

D2 est validé côté audit.

Le socle de sécurité Stripe est globalement solide : raw body, signature, table d'idempotence, guards anti-double paiement, transactions et idempotency keys Stripe existent.

Aucune correction automatique n'a été appliquée, car les points restants touchent à des flows argent et doivent être traités avec tests.

## Points à suivre dans I-SWEEP / TEST-1

1. Rendre les secrets dédiés Stripe obligatoires en prod ou au minimum alertés au runtime.
2. Vérifier transactionnellement `engine.confirmContributionFromStripe(...)` pour shared-cart.
3. Ajouter un repair/retry pour les sessions collectives `ready_to_capture` non capturées après crash.
4. Aligner la création d'ordre collective sur le cycle central de paiement si possible.
5. Ajouter tests replay webhook : même payload deux fois.
6. Ajouter test signature invalide sur les trois webhooks.
7. Ajouter test `payment_failed` reçu après `paid` : ne doit jamais dégrader la commande.
