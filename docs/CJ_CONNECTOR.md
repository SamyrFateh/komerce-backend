# CJdropshipping connector

Komerce can ingest CJdropshipping products through the canonical supplier-import dispatch.

## Runtime contract

- `source_type=api`
- `supplier_id=cj`
- official CJ API v2 `product/listV2`
- authentication through `CJ-Access-Token`
- secret bootstrap with `CJ_API_KEY` or direct `CJ_ACCESS_TOKEN`
- raw supplier lineage is preserved in `raw_payload.cj`
- supplier English is marked `source_locale=en`; publication still goes through the Komerce refinery/editorial approval rules.

## Secrets

Set **one** of these server-side only:

- `CJ_API_KEY` — recommended; the connector exchanges it for an access token and caches the token in-process.
- `CJ_ACCESS_TOKEN` — optional pre-issued token.

Never place CJ credentials in frontend code, URLs, repository files, logs, or request payloads.

## Supported filters

The canonical dispatch forwards only supported search filters:

- `keyword`
- `page`
- `size` / `page_size` (1..100)
- `category_id`
- `country_code`
- `start_warehouse_inventory`
- `verified_warehouse`

The connector requests CJ `enable_description` and `enable_category` features and returns normalized supplier-product V2 contracts.

## Showcase image bootstrap

For the fast Showcase visual bootstrap, use CJ product imagery only for CJ-sourced products and retain CJ supplier lineage. Do not treat CJ images as a generic stock-photo library detached from the corresponding supplier products.
