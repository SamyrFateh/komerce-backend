# CJ real-image showcase — 63 products

One-shot controlled catalogue bootstrap using the existing CJdropshipping connector and Komerce refinery.

## Contract

- 21 families × 3 products = 63 products maximum.
- Supplier remains `CJdropshipping`; supplier product identity and raw lineage remain in sourcing.
- Only CJ products keep CJ media; images are never reused as a detached generic stock-photo library.
- Products are promoted through canonical sourcing/catalog services.
- Client-facing copy is prepared in French through traced overrides, then approved through the canonical approval service.
- Existing Showcase V2 rows are not deleted or rewritten by this script.
- Deterministic negative `sort_order` slots put the 63-product bootstrap ahead of the existing catalogue for visual validation.
- The script is idempotent by deterministic slot and CJ supplier-product identity.

## Runtime guard

Execution requires all of:

- `DATABASE_URL`
- `CJ_API_KEY` or `CJ_ACCESS_TOKEN`
- `KOMERCE_ALLOW_CJ_SHOWCASE_SEED=1`

Run only as an explicit operator action:

```bash
node scripts/cj-real-showcase-seed.js
```

After execution, verify the audit printed by the script and run Boutique desktop/mobile Playwright smoke before considering the visual bootstrap accepted.
