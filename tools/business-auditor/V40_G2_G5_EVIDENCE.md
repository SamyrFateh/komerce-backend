# V4 — Physical evidence and semantic-coverage campaign

This is a delivery-enablement increment, **not** a V4.0 release certificate.

## G2: every Feature Card statement is retained

The unified scanner now produces `invariant-semantic-ledger.json` and
`invariant-semantic-ledger.md` in both quick and full modes. Statements are
counted individually, deduplicated without dropping references, and grouped by
business domain. Declared test file paths are recorded but NEVER treated as
executed assertions. Physical cases touching a domain are recorded as
domain-level witnesses only. Without an exact statement-to-independent-oracle
proof, the semantic-certified numerator remains zero.

The denominator is every parsed Feature Card invariant, not eight domains.
G2 remains NO-GO until actual statement-to-oracle evidence is implemented.

## G4/G5: reproducible local campaign

`.github/workflows/auditor-v4-evidence-campaign.yml` runs 12 existing
physical scenarios on PostgreSQL 16 throwaway clones with checked-in
canonical schema, using a frozen source SHA and no live PSP calls.
It archives JSON/Markdown evidence, verifies the retrospective G4 corpus,
and refuses to mislabel 3/3 known bugs as a blind benchmark.

The campaign intentionally checks G5=NO_GO until real G3 autonomous fixture
generation, independent withheld mutation testing, exact invariant coverage,
and release-installation/safety proofs exist.

## Remaining blocking criteria

1. G2: independent evidence mapping for exact critical Feature Card statements.
2. G3: bounded selector → local fixture generation → real owner → oracle,
   including a mutation withheld from generator implementation.
3. G4: external blind population, negative cases, missed defects,
   repeatability/flakiness and resource budget measured.
4. G5: independent main diff, safety and mode smoke tests, frozen SHA and
   operator docs with actual installation verification.

`npm run audit:logic:release:check -- --audit ... --out ... --require-go`
must exit non-zero while any one of these conditions remains unmet.
