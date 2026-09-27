# Payment provider transaction probes — P1 bounded Sandbox contracts

This package separates **authentication proof** from the first transaction contract.

## PayPal

The bounded P1 operation is:

```
OAuth Sandbox
  -> POST /v2/checkout/orders
  -> GET /v2/checkout/orders/{id}
```

The probe creates one **EUR 1.00 Sandbox Order** with `PayPal-Request-Id`, then immediately reads the exact provider object back and verifies its ID, Komerce reference, amount and currency. It **does not approve or capture** the order and therefore is not a payment proof.

Official PayPal documentation requires payer approval before server-side capture for the normal multi-step flow and documents `PayPal-Request-Id` as the idempotency key. This probe deliberately stops before payer approval and capture.

Run from a non-production runtime containing PayPal Sandbox credentials:

```bash
node scripts/paypal-sandbox-order-contract-proof.js
```

**Exception strictement locale pour la preuve isolée Railway :** le service existant peut être déployé dans un environnement Railway appelé `production` alors que `PAYPAL_ENV=sandbox` et que ses identifiants pointent exclusivement vers le compte PayPal Sandbox. Le script refuse alors l'exécution **par défaut** (`RUNTIME_PRODUCTION_REFUSED`). Une autorisation explicite, limitée au **processus ponctuel**, est possible via `KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX=1`. La sonde utilise malgré tout exclusivement `https://api-m.sandbox.paypal.com`; elle refuse `PAYPAL_ENV=production` avant tout appel, n'importe aucun module DB/commande du backend, et ne peut appeler ni capture ni remboursement. Ne pas enregistrer cet opt-in dans les variables Railway et ne jamais le réutiliser dans le serveur.

Depuis un PowerShell déjà connecté à Railway CLI, lancer exactement **une fois** la commande suivante (il faut une instance déployée du commit contenant ce script) :

```powershell
railway ssh -p 1c5c37ab-557b-41b1-885a-8b3ead573795 -s komerce-backend -e production -- env KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX=1 node scripts/paypal-sandbox-order-contract-proof.js
```

Cette commande ne modifie aucune variable Railway persistante. L'opt-in n'est transmis qu'au processus isolé. Si le runtime est déjà non-production, l'opt-in n'est pas nécessaire.

Expected terminal output is one secret-free JSON object. Conserver le rapport réel avant toute autre opération ; l'échec n'autorise pas à créer une nouvelle Order à répétition.

**Résultat réel rapporté le 23 septembre 2026 :** le probe PayPal a obtenu une création HTTP 201 et une relecture exacte HTTP 200 avec état `CREATED`, `PASS` et `capture_attempted=false`. [Rapport expurgé archivé](../../_archive/external-provider-proofs/PAYPAL_SANDBOX_ORDER_P1_2026-09-23.md). **Ne pas relancer automatiquement cette opération** : la preuve P1 create/readback est acquise pour cette exécution et n'autorise pas la capture.

## MTN MoMo Collections

The bounded P1 operation is:

```
OAuth Sandbox
  -> POST /collection/v1_0/requesttopay
  -> HTTP 202 Accepted
  -> GET /collection/v1_0/requesttopay/{referenceId}
```

MTN documents RequestToPay as asynchronous: HTTP 202 means accepted for processing, not paid. The provider can later report PENDING, SUCCESSFUL or FAILED. A callback, when configured, is sent once with no retry, so exact status GET remains the canonical confirmation path.

The legacy `scripts/mtn-momo-sandbox-probe.js` hardcodes a test MSISDN and contains an assertion about undocumented Sandbox-number behavior that has not been re-established from the current official documentation. **Do not use it for new external evidence.**

The replacement fails closed unless the operator explicitly supplies a verified Sandbox test number:

```bash
MTN_PROOF_SANDBOX_MSISDN=<verified-test-number> \
node scripts/mtn-momo-requesttopay-contract-proof.js
```

It uses the existing MTN Sandbox credentials and endpoint variables, creates one Sandbox RequestToPay for the MTN-documented synthetic transport `1000 EUR`, and reads the exact reference back. It never writes a Komerce order or database record.

## Qualification

A PASS from either probe is **operation-scoped P1 evidence only**. It does not promote the provider globally and does not prove P2 adapter, P3 pipeline, P4 Golden E2E, production entitlement, settlement, refund, buyer UX, or accounting reconciliation.
