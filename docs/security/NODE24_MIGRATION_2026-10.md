# Candidate Node.js 24 LTS — security release 21 October 2026

Status: **PREPARATION ONLY — do not merge until compatibility is proven**.

## Why
- Main branch currently has .nvmrc = 20 and package.json engines.node >=20.0.0.
- Node 20 is end-of-life; Node 24.22.1 includes 21 October 2026 security fixes.
- Railway staging service uses RAILPACK, installs Node via mise; build logs do not establish effective version.
- Railway currently follows main and also has komerce.co attached: merging can redeploy publicly.

## Acceptance evidence required before merge
1. Measure actual Node runtime in each live Railway environment (process.version, process.versions.openssl) through an authorized runtime inspection; do not infer from .nvmrc.
2. Node 24 job: npm ci, blocking dependency audit, P0 runtime check; report exact SHA and artifacts.
3. Inventory and migrate active .github/workflows using Node 20 (not only .nvmrc); check frontend subworkspace lockfiles and all CI jobs.
4. Run all critical tests: unit, API, OTP/auth, Stripe/payment, sourcing/refinery/catalog/market, logistics Hub/relais, and Chromium dashboards on isolated staging data, with nominal + refusal evidence.
5. Confirm Railpack actually selects >=24.22.1; pin exact secure version in appropriate Railway/Railpack configuration if .nvmrc is not authoritative. Verify deployment SHA.
6. Verify HTTP errors, logs, and business operations before and after deployment; retain rollback SHA and instructions.
7. Audit transitive dependencies and PHP usage in other services/images (no PHP established for principal backend).
8. Update package.json engines, matching package-lock.json root metadata, and active workflows together once compatibility is demonstrated.
9. Explicit approval prior to merge/deploy; do not modify production data or secrets.

Official release: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
