# CJ real-showcase runbook

1. Merge the guarded bootstrap only after required GitHub checks are green.
2. Confirm `CJ_API_KEY` exists server-side on Railway.
3. Set `KOMERCE_ALLOW_CJ_SHOWCASE_SEED=1` only for the explicit operator run.
4. Execute `node scripts/cj-real-showcase-seed.js` once.
5. Require the script post-audit to report 63 active, available products with HTTPS supplier media and zero `needs_review`.
6. Remove or reset the one-shot runtime flag after the run.
7. Run Boutique desktop/mobile smoke and inspect product imagery before accepting the bootstrap.
