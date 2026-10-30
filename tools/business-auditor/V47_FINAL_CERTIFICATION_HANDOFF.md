# Komerce auditor — final certification handoff (V4 bounded candidate)

**Production/runtime services:** unchanged. No PSP calls. All proof writes use
disposable localhost PostgreSQL clones.

## 1. Two distinct releases, never silently conflated

| Profile | What can be proven by this repository | What cannot |
|---|---|---|
| **V4 bounded technical candidate** | Twelve reviewed real-owner calibration scenarios, three exact database constraints, six generated inventory scenarios, 11 reproduced preselected faulty mutations across inventory/FX/market/orders, five equivalent-mutation controls, source hash checks, local-only protection | New unknown bugs found autonomously; all 479 invariants; finance PSP concurrency; all markets/routes; human review |
| **V4 independent autonomous scanner** | **NOT CERTIFIED**; requires genuinely externally withheld G4 benchmark and risk-scoped semantic mapping of business-critical invariants, plus G5 reviewer | Cannot claim GO based only on open mutants or known regressions |

The bounded qualification CLI produces **GO_BOUNDED_TECHNICAL_SCOPE** for
machine-verified evidence, followed by **NOT_CERTIFIED_PENDING_INDEPENDENT_REVIEW**.
It does *not* create tags or authorize release. Original `--require-go`
remains NO_GO. Never modify any G4/G5 blocker solely to obtain a green status.

## 2. What the independent reviewer must actually do

1. Freeze the **exact tested 40-character SHA** from
   `bounded-release-candidate.json`, along with the CI run and artifact hashes.
   Confirm repository scope and compare with current main.
2. Inspect the independent oracles and **known** positive/negative controls:
   - G2 stock CHECK and order/relais/market schema constraints are NOT evidence of
     finance/authorization/logistics runtime business rules.
   - G3: one inventory owner, fixed input grid and two fixed mutations.
   - G4: inventory 5 mutants + 2 equivalences; FX/market/orders 6 mutants +
     3 equivalences; all public, non-blind and preselected.
3. Construct a **withheld challenge outside the repository**. Do not share
   mutations, fixtures, or expected truth labels with the scanner authors.
   Require real owner execution on isolated PostgreSQL and independent oracle
   records (or reject untestable domains). Include a healthy control and cases
   with expected defects, and state classes supported/unsupported.
4. Run the frozen candidate without changing its detectors to match the
   withheld test. Record per case: fault class, owner, expected result,
   observed signal, false-positive/false-negative status, SQL clone provenance
   and disposal, and exact SHA. Tool errors count as failures.
5. Give an independent GitHub PR review grounded in the tested SHA, report any
   known production bug exclusions and select one:
   **approve bounded-only**, **request changes**, or **reject certification**.
   No self-attested Boolean in an artifact substitutes for this review.

If blind unknown-defect detection fails, **do not relabel** it PASS. Either fix
the detector and rerun the frozen challenge on the new SHA, or explicitly limit
the certified scope and leave the autonomous scanner uncertified.

## 3. Reproduce

CI: `.github/workflows/auditor-v4-evidence-campaign.yml`, PostgreSQL 16
localhost, `npm ci --ignore-scripts` with locked dependencies. Last step:

```
node tools/business-auditor/v47-bounded-release-evidence.js \
  --audit FULL/unified-audit.json --ledger FULL/invariant-semantic-ledger.json \
  --stock G2/g2-exact-invariant-proof.json \
  --relay G2_RELAY/g2-market-relay-proof.json \
  --g3 G3/g3-generated-experiment.json \
  --inventory G4_INV/g4-adversarial-inventory.json \
  --multi G4_MULTI/g4-multidomain-adversarial.json \
  --diff G5_DIFF/g5-main-diff.json \
  --install G5_INSTALL/g5-install-smoke.json \
  --release RELEASE/g5-release-readiness.json \
  --out RC
```

These names are relative placeholders for the matching CI artifact directories.
No default production DB connection or unattended deployment is permitted.

**End state of this handoff:** one SHA-bound technical candidate, a documented
independent challenge and human review requirement, and explicit full-autonomy
NO_GO until the missing evidence is produced.
