# Independent business auditor — main integration scope

This directory is an **opt-in experimental scanner**. Its presence on `main` does not authorize production writes and does not certify the final V4.0 release.

- `npm run audit:logic:unified`: defaults to a source-only quick scan, with no database access.
- `npm run audit:logic:targeted:plan -- --files services/order-status-machine.js --budget 2`: produces a static risk plan. It does not generate or execute an independent business experiment.
- `npm run audit:logic:release:check -- --audit <LOCAL_REPORT_FILE> --out <LOCAL_DIR>`: produces retrospective benchmark scores and a fail-closed release readiness verdict. No GitHub merge is performed.
- Physical and data modes require `NODE_ENV=test`, `KOMERCE_DISABLE_CRONS=true`, and a PostgreSQL URL on `localhost/komerce_test`. Never supply Railway, production or staging URLs.
- V3.5 source census: 478 feature-card declarations, 234 declared test references; declaring a test does **not** certify a rule.
- V3.6 impact plan: selects static candidates under budget; zero novel physical tests generated.
- G4 measured known corpus: 12 curated cases. Perfect accuracy there is **not** evidence of unknown-bug detection.
- G5 V4.0 release: **NO_GO**, until a generated canonical physical experience detects a withheld mutation, semantic coverage is measured and a blind benchmark passes.

Documentation: `tools/business-auditor/V4_DELIVERY_PLAN.md` and `tools/business-auditor/V4_G4_G5_RELEASE_CHECKLIST.md`.

This integration intentionally excludes changes to business services, public API routes, database migrations, credentials, GitHub branch-protection rules, Railway and live payment providers.
