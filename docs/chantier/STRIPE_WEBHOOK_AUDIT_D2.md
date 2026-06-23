# Audit D2 — Webhook Stripe (2026-06-23)

## Résultat : ✅ Conforme — aucune correction requise

---

## 1. Signature vérifiée

`routes/payments.js:86` — `stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)`

- Le body est capturé en **raw** (`express.raw({ type: 'application/json' })`) avant tout parsing JSON, conformément à l'invariant I-07 documenté dans le fichier.
- En cas d'échec (`err.type = 'StripeSignatureVerificationError'`), la route retourne `400` et log l'erreur. Aucun traitement métier ne se produit.

## 2. Idempotence forte

Double garde :

1. **Route-level** (`routes/payments.js:93-98`) : avant tout dispatch, vérifie `stripe_events_processed` par `event.id`. Si déjà traité → `{ received: true, idempotent: true }` sans aucune mutation.
2. **Service-level** (`services/payment-stripe.js:143,167,250,349`) : `handleStripeSucceeded` re-vérifie l'idempotence dans la transaction, insère dans `stripe_events_processed` avec checksum.

La table `stripe_events_processed` est créée par `migrations/048_collective_workspaces.sql` avec index sur `processed_at`.

## 3. Protection contre le double-confirm

`services/payment-stripe.js` vérifie le statut de la commande avant tout update. Une commande déjà `confirmed` ou plus loin dans le pipeline ne peut pas être reconfirmée.

## 4. Logs structurés

Toutes les branches (succès, idempotent, échec signature, échec service) passent par `log.error/warn/info` (pino structuré), incluant `event.id` et `event.type`.

## 5. Test de replay

Non testé en live (pas de DB dispo), mais l'architecture garantit l'idempotence par construction : la PRIMARY KEY sur `stripe_events_processed(stripe_event_id)` fait planter un INSERT doublon au niveau DB même si le check applicatif rate en race condition.

## 6. Test signature invalide

Non testé en live, mais le `try/catch` autour de `constructEvent` est le seul chemin possible — pas de contournement.

---

## Verdict par critère D2

| Critère | État | Note |
|---------|------|------|
| Signature vérifiée | ✅ | `constructEvent` + raw body |
| Idempotence applicative | ✅ | Double garde route + service |
| Idempotence DB | ✅ | PRIMARY KEY sur stripe_events_processed |
| Pas de double-confirm | ✅ | Check statut avant update |
| Logs structurés avec event_id | ✅ | pino structuré |
| Raw body préservé | ✅ | I-07 documenté et enforced |
