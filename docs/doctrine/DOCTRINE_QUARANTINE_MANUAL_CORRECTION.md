# Doctrine — Quarantine / WATCH manual correction

## Principle

Supplier truth is immutable evidence. Komerce may correct its canonical working facts when a supplier error is manifest, but never by rewriting or deleting the original supplier payload.

Flow:

`raw supplier evidence → invalid/unsafe canonical fact → WATCH/quarantine → explicit human correction → full re-scan/re-certification → eligible candidate`

A manual correction is **not** a certification bypass.

## Invariants

1. `raw_payload` remains supplier evidence and is never edited by the correction workflow.
2. Every correction records actor, timestamp (event row), changed fields and an explicit reason.
3. Corrected fields are marked `manual` in `data_sources`.
4. A later supplier re-import must not silently overwrite a manual override.
5. Promotion remains forbidden while state is `quarantined`.
6. After correction, the candidate must be scanned and certified again through the same production gates.
7. No API or UI may force `certified=true`.
8. Supplier identity must not be invented to repair an unverifiable source identity.

## Editable canonical working facts

The correction authority may cover price/currency, category/subcategory mapping, estimated weight/volume/dimensions, editorial content, media selection, and variant/SKU mapping **only where the production contract has an explicit editable seam and audit trail**.

Existing candidate correction support currently protects manual overrides for:
- purchase price + currency,
- Komerce category,
- estimated weight,
- estimated volume,
- target margin.

Expansion to other fields must add the same provenance, audit, re-import lock and re-certification semantics before the field is considered safely editable.

## Exit rule

WATCH/quarantine is not cleared merely because a human edited a value. The corrected candidate exits only after the normal scan/certification path produces an admissible result.
