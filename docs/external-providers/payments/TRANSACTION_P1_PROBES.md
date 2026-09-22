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

Run only from a non-production runtime containing PayPal Sandbox credentials:

```bash
node scripts/paypal-sandbox-order-contract-proof.js
```

Expected terminal output is one secret-free JSON object.

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
