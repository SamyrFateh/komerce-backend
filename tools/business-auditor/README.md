# Komerce Independent Business Auditor — R&D v0.5

**Goal:** detect independently reproducible contradictions between business rules,
persisted facts and process invariants. A green Golden is not certification.

## Architecture

This tooling directory imports **no business service, db.js, route or writer**.
It does not invent a second economic decision engine or FX calculation.

- **rules.js:** declarative, versioned rule registry (owner, P1–P7 seam, issue).
- **engine.js:** read-only, bounded SQL evidence runner with verified PostgreSQL
  REPEATABLE READ READ ONLY snapshot and unconditional ROLLBACK.
- **cli.js:** independent process; invokes the existing code-only lexical
  scanner as a subprocess, plus explicit optional SQL integrity checks.
- **engine.test.js / cli.test.js:** negative, nominal, rollback and security tests.
- **R&D CI:** PostgreSQL 16 disposable database and JSON/Markdown evidence.

This is an autonomous **tooling component**, not yet a distributed package or
separate GitHub repository. The lexical phase still delegates to the existing
static scanner within the Komerce repository.

## Safe invocation

**Default offline, no database connection:**

    npm run audit:logic:full

**Explicit local throwaway PostgreSQL only:**

    NODE_ENV=test KOMERCE_DISABLE_CRONS=true \
      DATABASE_URL='postgresql://testuser:password@127.0.0.1:5432/komerce_test' \
      npm run audit:logic:full -- --mode all --out /tmp/business-audit --sample-limit 20

Choose '--mode data' for SQL checks only; '--mode code' for static code only.
Use '--base COMMIT' for a meaningful changed/new code suspicion comparison.
Without an explicit base the static scan compares HEAD to itself, so new
suspicions are **not** quantified.

The tool refuses production, staging, Railway and non-local connection targets.
It cannot apply fixes or execute mutation tests, and does not import the
application DB pool. Evidence output: business-audit.json and business-audit.md.

## Calibrated SQL checks

| ID | Seam | Invariant signal | Linked issue |
| --- | --- | --- | --- |
| KBA-001 | P3→P6 | Allocation cost.order_id differs from its item.order_id | #3064 |
| KBA-002 | P4→P6 | Freight/customs allocated to parcel without purchased item | #3065 |
| KBA-003 | P4→P6 | Freight/customs parcel absent from shipping declaration | #3065 |
| KBA-004 | P5→P6 | Cash collection present on Stripe order | #3068 |
| KBA-005 | P6→P1 | Price ACTIVATE event without actor | #3071 |
| KBA-006 | P7→P5 | READY settlement on an unactivated DRAFT assignment | #3072 |
| KBA-007 | P4→P2 | Collected scan at a different relay (exceptions possible) | #3062 |

Each rule reads up to sample-limit + 1 references. Results are **lower bounds**
when truncated; do not mislabel samples as exhaustive counts. Every signal is
DATA_INTEGRITY_SIGNAL, NOT a confirmed business bug. Owner review must distinguish
valid legacy cases, exceptional transfers and errors.

## Evidence-based calibration

The existing two PostgreSQL Goldens deliberately inject actual integrity
contradictions **within rolled-back test transactions**. Both workflows now
run these SQL rules on the temporarily inconsistent facts, covering every
registered detector. The test must fail if a rule fails to find its known
bad row. A normal read-only scan of the clean DB must not create any mutation.

The standalone CI also runs the complete static scan and independent SQL
queries on a disposable PostgreSQL DB, and archives JSON/Markdown reports.

## Explicit limits / future gates

- 7 concrete data rules and 13 owner-adapter boundaries are NOT all business
  code or all business invariants.
- Real staging / production read-only audits need a separate authorized
  credential, approved scope, and schema/market/privacy review.
- The external-tool packaging and automatic incremental scanning are future
  work. Correct any discovered bugs in the domain owner, not here.
- Golden synthetic transactions are calibration, not customer/PSP/bank proof.


## V0.2 — first code-wide triage and independent code-pattern detector

The first independent CI static run found **22 lexical suspicions across 1,486
tracked JS/TS files**. They are now represented one by one in a conservative,
reviewed source-path ledger:

- static-triage.js maps each scanner rule to an owner and the independent
  business test needed;
- triage-ledger.js distinguishes runtime candidates from testing, seeding,
  simulation and canonical-owner activities. The ledger is *source review*,
  never a declaration that the code is correct, incorrect or reachable;
- unknown new findings stay UNREVIEWED rather than silently suppressed;
- code-detectors.js independently detects one concrete control-flow risk:
  conflict-ignored parcel INSERT followed by success counter increment, without
  checking affected rows. It analyses actual code files only, not service
  runtime; SQL row-count and concurrency remain to be demonstrated;
- issue #2949 already contains a service-mock reproduction for auto-parcel
  (rowCount=0 with items_assigned=1). The detector records that limited
  previous evidence instead of rediscovering it as an unqualified new bug.

The JSON report now includes code.triage, code.reviewSummary and
code.independentCodeSignals; Markdown includes a reviewer-oriented action
matrix. The scanner is **not** licensed to change application code or claim
that production data contains any specific anomaly.

This is still an incremental discovery tool, **not** complete formal
verification of all business code.


## V0.3 — dependable reviewer provenance and payment-key evidence

**Verified GitHub Actions proof:** https://github.com/SamyrFateh/komerce-backend/actions/runs/40544895889

- **34/34 tests** in the standalone auditor job, with local disposable PostgreSQL.
- **1,489 source files** scanned and **23 lexical findings**, including two
  deliberate scanner-test signals, not production writers. All 23 have
  owner/scope classifications and **23/23 exact Git blob fingerprints matched**.
- **13 investigation candidates** remain after source classification.
  These are not 13 confirmed bugs.
- Two independent code detector families emit **5 precise code signals**:
  - KBA-C01: two count-after-ignored-conflict sites in auto-parcel plus one in
    parcelOptimizationService. Issue #2949 reproduced auto-parcel under mocked
    rowCount; physical PostgreSQL concurrency has not been certified.
  - KBA-C02: wallet admin credit uses a time-derived request identity;
    paypal-client has a time-derived refund fallback **with a durable
    providerRequestKey override**. Caller reachability, real retry and PSP
    result must be verified separately.
- **7 SQL data rules** ran in REPEATABLE READ READ ONLY on disposable clean PG;
  0 signals in that DB says nothing about real staging/production data.
- A previously reviewed source file that changes receives
  SOURCE_CHANGED_REVIEW_STALE, and R&D CI must fail instead of silently
  preserving that review as current.
- No Komerce business-service fix, no online PSP call, no SQL writes, no PR,
  merge or deployment.

**Next gates:** authoritative invariant inventory beyond seven SQL checks,
owner arbitration of 13 candidates, authorization for real read-only data
audit, physical conflict/retry reproduction, and extraction to a separate
distribution when justified.


## V0.4 — physical PostgreSQL owner counterexamples (not just mock or regex)

**Verified double Golden:** https://github.com/SamyrFateh/komerce-backend/actions/runs/40548294957

- **177/177 pure tests**, two disposable PostgreSQL 16 Golden PO variants
  (grouped and historical), no A/B asymmetry, 13/13 owner seams read with
  zero owner-read errors.
- **KBA-C01 actual service + real SQL**: auto-parcel.distributeOrder() first
  confirms already_assigned on the normal path. A *controlled stale
  existence preflight* then forces an attempt to assign the same order item.
  Real PostgreSQL applies unique_order_item_per_parcel, reports
  rowCount=0, while the actual service returns items_assigned=1.
  Count before/after: **0 new rows**. The enclosing PG transaction is
  rolled back and prior parcel status/membership is verified. This confirms
  count drift **under this instrumented preflight scenario**, not an
  uninstrumented concurrency race or production corruption.
  Existing issue: https://github.com/SamyrFateh/komerce-backend/issues/2949
- **KBA-C02 actual wallet owner + real SQL**: wallet-service.credit()
  with one persistent idempotency key returns one credit then duplicate=true
  on replay; two different timestamp-style keys from the admin route pattern
  create two different credit ledger rows. The transaction is rolled back;
  no wallet receipts or external PSP calls occur. This confirms sensitivity
  to request identity, **not** an observed unintended HTTP replay or double
  credit in production.
  Owner arbitration: https://github.com/SamyrFateh/komerce-backend/issues/3079
- Independent classification contract in physical-probes.js and negative
  tests rejects missing rowCount, missing rollback restoration, an absent
  stable-key duplicate, or missing wallet ledger evidence.
- The **two-path comparator** rejects absent physical evidence on both
  Golden variants. The independent tool still does not import or execute
  Komerce writers itself: those writes only happen in disposable, rolled-back
  Golden transactions run by isolated GitHub Actions jobs.

**Open questions:** genuine physical concurrency schedule, real HTTP admin
request retry contract (must permit two consciously distinct gifts), PayPal
legacy refund caller reachability and sandbox replay, and independent code
scanner coverage beyond the current finite detector families.

main, Railway staging/production, Stripe and PayPal remain unchanged.


## V0.5 — connected PayPal refund replay observation, zero real PSP calls

**Complete findings and owner-prioritized corrections:** [RESEARCH_SYNTHESIS_2026-10-27.md](./RESEARCH_SYNTHESIS_2026-10-27.md)

- paypal-refund-boundary.js independently reads the active refund API route,
  payment-paypal.refundPaypalOrder, paypal-client.refundCapture and the
  currently dormant refund-intent-ledger. It never imports runtime owners.
  The active legacy refund route does not supply a durable
  providerRequestKey. The client fallback uses a new timestamp-based
  PayPal-Request-Id on each attempt.
- tests/unit/auditor-paypal-refund-execution.test.js invokes the **real**
  legacy owner and client but replaces global.fetch completely. Under an
  ambiguous mocked provider timeout, two identical refund attempts produce
  two distinct outgoing request IDs; the durable-key control sends the same
  ID twice. Invalid provider keys fail before any HTTP.
- This is a **repeat identity risk at a provider boundary**, not a
  confirmed refund of actual money, no proof of two PayPal executions and
  no confirmed production incident. Owner arbitration:
  https://github.com/SamyrFateh/komerce-backend/issues/3080
- The independent JSON/Markdown report includes the exact call-chain state,
  with explicit productionDuplicateRefundConfirmed=false. This is code and
  transport-mock evidence; no PSP credentials or API calls were used.
- CI proof with full standalone chain:
  https://github.com/SamyrFateh/komerce-backend/actions/runs/40552611778
  (41/41 pure + 3/3 Jest mocked-network tests, 1,493 files,
  23 static suspicions, 7 SQL rules read-only, 0 SQL signals in clean PG).

Nothing has been merged to main; staging, production and real payment flows
have not been modified.
