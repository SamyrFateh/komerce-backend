# KOMERCE — Sourcing & Catalog Pipeline Certification

Status: canonical certification contract  
Scope: supplier acquisition through safe catalog draft/publication boundary  
Doctrine: supplier-independent, deterministic core, live providers are observations not CI truth

## 1. Purpose

Komerce must remain correct when supplier data is incomplete, duplicated, reordered, changed or temporarily unavailable. Certification proves the behaviour of the pipeline; it does not certify that an external supplier is always available.

The pipeline has two mirrored certification domains:

```
SOURCE
  -> discovery/API
  -> supplier adapter
  -> NormalizedSupplierProduct V2
  -> identity / dedup / checkpoint
  -> sourcing candidate
  = SOURCING CERTIFIED

sourcing candidate
  -> normalization
  -> eligibility
  -> semantic/category resolution
  -> variants/SKUs
  -> catalog decision
  -> inactive/draft publication boundary
  = CATALOG CERTIFIED

SOURCING CERTIFIED + CATALOG CERTIFIED + cross-boundary invariants
  = E2E CERTIFIED
```

## 2. Non-negotiable invariants

1. No supplier-specific payload may leak past the adapter as business truth.
2. Raw supplier payload and normalized V2 snapshot remain traceable separately.
3. Replaying the same supplier product is idempotent: no duplicate product/candidate/SKU.
4. Supplier ordering and pagination ordering must not change the final business result.
5. An interrupted import can resume without duplication or silent loss.
6. A malformed product is isolated; its reason is explicit and auditable.
7. External timeout, 429, 5xx or auth failure cannot corrupt already accepted state.
8. Product disappearance/reappearance is explicit and reversible; never inferred from a partial snapshot.
9. Category resolution is deterministic and explainable; unresolved data never silently becomes a valid category.
10. Invalid/incomplete data can never cross the safe draft/inactive publication boundary.
11. Variant/SKU identity remains stable across supplier updates unless source identity actually changes.
12. Every terminal decision is explicit: ACCEPT, WATCH, EXCLUDED or RETRY (or the canonical persisted equivalent).
13. Core certification must run without network access, paid AI or live supplier availability.
14. Live CJ/AliExpress checks are smoke observations and must not turn a PR red for an external outage.
15. A new supplier is integrated by an adapter + contract certification; it must not require supplier-specific refinery logic.

## 3. Provider contract matrix — CJ vs AliExpress

The certification suite must generate this matrix from stored raw payloads and normalized snapshots, without recalling providers.

| Canonical concern | CJ evidence | AliExpress evidence | V2 rule | Certification |
| --- | --- | --- | --- | --- |
| supplier identity | measure | measure | mandatory | exact |
| supplier product id | measure | measure | mandatory | exact + stable |
| product name | measure | measure | mandatory | non-empty |
| description | measure | measure | optional/core | type-safe |
| supplier category | measure | measure | optional/core | traceable |
| price/currency | measure | measure | core when sellable | valid pair |
| variants/SKUs | measure | measure | extension/core collection | stable identity |
| stock/availability | measure | measure | optional | no invented stock |
| media | measure | measure | core collection | valid URL when present |
| specifications | measure | measure | optional collection | type-safe |
| dimensions/weight | measure | measure | optional | sane units/ranges |
| source timestamps | measure | measure | optional | traceable |
| raw payload | yes | yes | mandatory evidence | lossless persistence |
| normalized V2 snapshot | yes | yes | mandatory evidence | schema version = 2 |

The resulting report must classify every field as:
- **V2 CORE REQUIRED**
- **V2 CORE OPTIONAL**
- **SUPPLIER EXTENSION**
- **UNUSED SOURCE DATA**
- **LOSS / INVESTIGATE**

No field is promoted to CORE merely because one provider exposes it.

## 4. Sourcing torture fixtures

All fixtures are deterministic and local.

| Failure injection | Expected invariant |
| --- | --- |
| duplicate product on same page | one canonical candidate |
| duplicate across pages | one canonical candidate |
| pages reordered | identical final state |
| repeated page/cursor | detected; no infinite loop |
| empty intermediate page | explicit stop/retry semantics |
| partial response | no false full-snapshot archival |
| timeout | RETRY; accepted state unchanged |
| HTTP 429 | retry/backoff signal; no corruption |
| HTTP 5xx | RETRY; no corruption |
| expired/invalid auth | explicit provider error; no writes beyond safe boundary |
| field changes type | isolated invalid item with reason |
| supplier SKU changes attributes | deterministic update |
| product disappears in full snapshot | archive according to canonical rule |
| product disappears in partial snapshot | do not archive |
| archived product returns | deterministic reactivation/update |
| crash after checkpoint | resume without duplicate/loss |
| two concurrent imports | idempotent final identity |
| unknown extra source fields | preserved in raw; core unaffected |

## 5. Catalog/refinery torture fixtures

| Failure injection | Expected invariant |
| --- | --- |
| missing/invalid price | WATCH/EXCLUDED according to canonical rule; never publish |
| unknown currency | explicit decision; never invent conversion |
| duplicate SKU | deterministic collision handling |
| missing primary media | explicit decision; no broken publish |
| malformed media URL | isolated/auditable |
| absurd dimensions/weight | explicit validation result |
| missing category | deterministic resolver/fallback or WATCH |
| ambiguous category | explainable evidence; no silent guess |
| taxonomy change | deterministic remap with audit evidence |
| contradictory attributes | explicit decision |
| zero variants | canonical product rule applied |
| duplicate variants | stable dedup |
| product update after prior acceptance | idempotent update, no duplicate |
| eligibility exclusion | EXCLUDED before unsafe promotion |
| malformed description/specs | safe normalization |
| interrupted refinery batch | resumable without duplicate/loss |

## 6. Cross-boundary E2E scenarios

At minimum, one CJ fixture and one AliExpress fixture must traverse the entire local pipeline. Each is then replayed with:
- identical payload;
- reordered payload;
- one legitimate update;
- one malformed update;
- interruption + resume;
- disappearance + return.

Assertions: stable supplier identity, stable canonical identity, no duplicate candidate/product/SKU, preserved provenance, explainable decisions, and zero accidental active publication.

## 7. CI gates

### Gate A — SOURCING_CERTIFIED
Network-free fixtures. Adapter contract, V2 schema, pagination, identity, dedup, checkpoint/resume, snapshot semantics and failure injection.

### Gate B — CATALOG_CERTIFIED
Network-free fixtures. Normalization, eligibility, category resolution, variants/SKUs, decisions, draft/inactive boundary and failure injection.

### Gate C — E2E_CERTIFIED
Network-free CJ + Ali fixtures through both domains with replay/update/resume assertions.

### Live supplier smoke
Scheduled/manual. May report DEGRADED_PROVIDER or CONTRACT_DRIFT. External availability alone is not a merge failure. A confirmed contract drift opens/fails the dedicated compatibility signal, not an unrelated PR gate.

## 8. Certification evidence

Every run emits a machine-readable report containing:
- certification version and commit SHA;
- fixture/scenario id;
- provider;
- expected decision;
- actual decision;
- invariant assertions;
- failure reason;
- provenance evidence;
- counts before/after;
- PASS/FAIL.

The provider comparison additionally emits field presence/type statistics from stored CJ and AliExpress evidence.

## 9. Definition of done

The supplier/catalog core is certified only when:
- Gate A, B and C are green on a clean checkout without supplier network access;
- every failure fixture has an explicit expected outcome;
- CJ/AliExpress stored evidence produces a reviewed V2 field classification;
- replay and resume are proven idempotent;
- no torture fixture can accidentally create an active/published product;
- live smoke checks are operationally separate from deterministic PR certification;
- adding a third provider requires an adapter and certification fixtures, not refinery branching.

After this point, changes to adapters, V2, sourcing identity, category resolution, variants/SKUs or publication boundaries must preserve these gates.
