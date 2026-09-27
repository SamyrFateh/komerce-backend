# TERMIUM memory for Komerce

## Purpose

Komerce keeps two distinct terminology layers:

1. `catalog_glossary` — curated Komerce authority. If it says a term must be
   translated in a specific way (or preserved with `term_fr='='`), that decision wins.
2. `catalog_terminology_reference` — external sourced evidence. It may contain
   several valid French equivalents for the same English term because domain and
   context matter.

External terminology is therefore **reference material, not an automatic translation rule**.

## Initial source: TERMIUM Plus®

Official dataset:

- Publisher: Public Services and Procurement Canada / Translation Bureau
- Dataset: TERMIUM Plus®, the Government of Canada's terminology and linguistic data bank
- Open-data dataset URL:
  https://open.canada.ca/data/en/dataset/94fc74d6-9b9a-4c2e-9c6c-45a5092453aa
- Licence:
  https://open.canada.ca/en/open-government-licence-canada
- Required attribution used by Komerce:
  **Contains information licensed under the Open Government Licence – Canada.**

The first catalog import uses these subject packages:

- Arts, Recreation and Sports
- Construction
- Electricity
- Electronics and Informatics
- Home Economics and Accommodation Science
- Industries
- Mathematics, Physics and Natural Sciences
- Mechanics and Heat
- Metallurgy
- Telecommunications and Postal Service
- Transportation and Materials Handling

## Why Komerce does not bulk-load all TERMIUM rows

The supplier catalog is the demand signal. The importer builds n-grams from the
real source text of the current product corpus, then retains only TERMIUM English
terms that actually occur in that corpus.

This gives us:

- a much smaller database footprint;
- terminology that is immediately useful;
- clear coverage metrics;
- fewer irrelevant alternatives;
- a repeatable incremental process as new supplier catalogs arrive.

## Import path

```text
official TERMIUM ZIPs
        ↓
CSV rows with EN/FR + subject/domain
        ↓
match against current supplier-source corpus
        ↓
catalog_terminology_reference
        ↓
FR Quality workpack.terminology_hints.references
```

The workpack also contains:

```text
terminology_hints.curated
```

from `catalog_glossary`. Curated hints always have higher authority than external
reference hints.

## Safety and authority

The terminology importer:

- does not modify supplier source truth;
- does not modify price, stock, taxonomy or exposure;
- does not publish products;
- does not turn a TERMIUM equivalent into a Komerce rule automatically;
- preserves source, record identifier, domain and licence;
- runs first against a disposable local PostgreSQL checkpoint.

A recurring correction discovered during FR review should be promoted explicitly
to `catalog_glossary` only after Komerce validates that decision.


## Cold-start translation challenge

The terminology memory is not considered sufficient merely because it covers the
current 974-product corpus. A permanent cold-start challenge verifies the
fallback behavior on supplier products that were never present in the reference
checkpoint.

The challenge:

1. restores the terminology-enriched disposable checkpoint;
2. applies the currently curated Komerce glossary;
3. discovers 100 CJ product IDs that do not exist in that checkpoint;
4. fetches exact read-only product detail for those IDs;
5. builds source-faithful translation workpacks without importing/publishing the
   products;
6. incrementally matches the new corpus against the official TERMIUM datasets;
7. attaches both curated Komerce terms and external TERMIUM references;
8. requires offline French translation and a separate source→FR second-pass
   review to complete the proof.

The important invariant is **not** “every word already exists in the glossary”.
It is:

- every unseen product remains translation-processable from its original source;
- a missing glossary/TERMIUM hit is never treated as permission to invent;
- unresolved ambiguity is surfaced explicitly for review;
- validated recurrent decisions can then be promoted into `catalog_glossary`.

The source phase is accepted only when all selected supplier IDs are unseen,
all translation inputs are complete and hashed, and the catalog safety audit
remains at zero active/exposed/wrong-lifecycle products.

The completed editorial challenge additionally requires:

- 100/100 translation proposals produced;
- 100/100 separate second-pass reviews;
- zero critical invented claims;
- zero silent critical omissions;
- no publication/exposure/order/payment side effect.
