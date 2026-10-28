# Business auditor V1.0 — research contract

## Mission

Detect **existing business invariant violations**, not just lexical risks. Maintain source and ownership lineage from V0.6/V0.7, calibrate positive/negative detector behavior with V0.8, then assert an independent expected outcome against the actual owner path in a disposable test. V0.9 consolidates the same-run evidence.

## One-command operator entry

- `npm run audit:business:v1` — default static offline inventory and prioritized review queue. Writes `/tmp/komerce-business-auditor-v10/v10-static-review.json`. No DB connection, services loaded, network provider, or business writer.
- `npm run audit:business:v1 -- --mode ci --evidence-dir /tmp/komerce-independent-business-audit` — restricted to GitHub Actions, `NODE_ENV=test`, `KOMERCE_DISABLE_CRONS=true`, and matching SHA/run reports. Writes `v10-bug-hunt.json` and `v10-bug-hunt.md`.
- CI pipeline is `.github/workflows/research-independent-business-auditor.yml`, using PostgreSQL 16 disposable service, seven temporary SQL detector fixtures (which are **not** production-code execution), plus a real owner Jest probe under fake HTTP/DB.

## Truth and verdict hierarchy

1. `STATIC_HYPOTHESIS_NOT_VERIFIED_AUTHORITY`: writer source, schema, Feature Card and possible route import — not authorized, not executed, not a bug.
2. `CONTROLLED_TEST_INVARIANT_SATISFIED`: real owner test observed the independent expectation, and nominal/adversarial controls passed. This is narrow coverage, never global certification.
3. `REPRODUCED_CONTROLLED_TEST_INVARIANT_VIOLATION`: real owner test observed a contradiction to an independently defined feature invariant; corroborated by the exact same-run Jest and observer artifacts. It proves an isolated test behavior, not a customer/production incident.
4. Production impact requires **different and stronger** independent evidence. V1.0 does not assign this verdict.

The result is **not** locked to a golden master. Fixing the code so that a retry reuses its request key changes the verdict to satisfied, without changing the oracle.

## First extensible oracle — RC-9 PayPal

- Source of independent expectation: `features/refunds.feature.js` and `features/payments.feature.js`.
- Owner: `services/payment-paypal.js` (actual implementation imported by Jest).
- Positive control: `services/paypal-client.js` with durable provider key yields identical outgoing headers.
- Adversarial probe: twice invoke the same logical refund owner with simulated ambiguous timeouts, capture outgoing header identity.
- Evidence: `tests/unit/auditor-v10-paypal-owner-probe.test.js` writes `v10-paypal-observation.json` (only equality booleans, no credentials/actual headers). Jest emits `v10-owner-jest.json`. V1.0 checks the exact test title, paths, successful execution, expected controls and SHA/run provenance.

To extend V1.0, add an independent feature-sourced oracle to `v10-oracles.js`, a hermetic owner probe producing an observation contract and a matching same-run test report, then calibrate both a passing and violating observation in `v10-engine.test.js`. Never copy expected values from the code being evaluated.

## Explicit gaps and merge policy

- Existing V0.7 snapshot: **843 candidate fragments**, grouped into **421** static qualification cases; **209** require owner review. No claim that these are 209 bugs.
- The seven SQL rules have had controlled physical detector calibration, not verification of all their real writers.
- The first V1.0 runtime oracle currently covers only the PayPal refund owner. Risk already tracked under [issue #3080](https://github.com/SamyrFateh/komerce-backend/issues/3080).
- No real PayPal/Stripe service, production database, or staging writes. No automatic correction of financial code. No automatic merge to `main`.
- R&D gate success means **scanner infrastructure operates as specified**, not that the entire Komerce business is certified.
