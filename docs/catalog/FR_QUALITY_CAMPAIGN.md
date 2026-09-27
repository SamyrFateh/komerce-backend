# FR Quality campaign — source → reviewed French → inactive catalog draft

## Objective

The FR Quality campaign closes the editorial leg of the Raffinerie for the real
CJ catalog corpus without adding a runtime paid-LLM dependency.

The canonical path is:

```text
supplier source truth
  → canonical sourcing / Raffinerie
  → exact catalog candidate + SKU/SOI/media
  → TERMIUM reference memory + curated catalog_glossary
  → offline French translation/rewrite
  → separate source→FR second-pass review
  → source_hash + output_hash binding
  → dry-run static gates
  → atomic catalog_field_overrides apply
  → content_source=manual / needs_review=false
  → readiness audit
  → inactive reusable checkpoint
  → human publication review
```

## Important boundary

**Catalog entry completion is not publication.**

The campaign may finish the French content of every inactive catalog candidate,
but it must not:

- set `products.is_active=true`;
- create `product_market_exposure`;
- change price/stock/market decisions;
- create orders, payments or reservations;
- bypass the human first-publication approval gate.

The post-campaign editorial authority is therefore:

`READY_FOR_HUMAN_PUBLICATION_REVIEW`.

## Campaign bundle

Repository campaign root:

```text
ops/catalog-fr-quality/campaigns/cj-974-2026-09/
  translations/
    batch-001.json
    ...
    batch-025.json
  reviews/
    batch-001.json
    ...
    batch-025.json
```

Translations and reviews are deliberately separate artifacts. Each translation
binds to the source through `source_hash`; each review binds to both
`source_hash` and the exact proposal `output_hash`.

## Final campaign gate

Before a full apply, `scripts/catalog-fr-quality-campaign-audit.js` requires
the campaign to cover the complete inactive CJ catalog target.

For the current campaign the expected target is **974 products**.

The full workflow refuses to start the transaction unless:

- translations = 974;
- reviews = 974;
- every target product has one translation and one review;
- there are no extra product refs;
- the FR static gates accept every proposal;
- every review hash matches exactly.

The final apply is one all-or-nothing transaction. One reject or one write error
means no partial campaign commit.

## Workflow

`.github/workflows/isolated-catalog-fr-quality-campaign.yml`

Two supported scopes:

- `batch-001` (and future `batch-NNN`) for narrow proof while building the
  campaign;
- `all` for the final 974-product atomic apply.

The workflow restores only a disposable local PostgreSQL checkpoint, applies the
French bundle, runs the Raffinerie readiness audit, saves a new reusable
checkpoint and performs the final no-publication safety audit.

## Completion criteria

The editorial entry phase is complete only when:

1. campaign coverage is 974/974;
2. FR Quality dry-run accepts 974/974;
3. transaction applies 974/974;
4. all 974 target products are `content_source='manual'` and
   `needs_review=false`;
5. source truth remains present and unchanged;
6. lifecycle remains `candidate`;
7. active = 0;
8. exposed = 0;
9. readiness audit identifies any remaining **non-editorial** blockers
   (taxonomy/SKU/media/etc.) explicitly.

Those remaining non-editorial blockers are then fixed in their own authority
rather than being hidden inside translation.
