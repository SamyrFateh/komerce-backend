# Komerce Independent Business Auditor — R&D v0.1

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
