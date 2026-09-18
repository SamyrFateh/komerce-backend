# Provider API Analysis — Template

## Purpose

This document is the short, stored qualification record for a sourcing/provider API.

It does **not** replace provider documentation, Komerce doctrine, or Golden proofs.
It records only the provider facts that matter to Komerce:

- what the provider really exposes;
- what Komerce can prove from the API;
- what Komerce can safely use;
- what remains manual, unknown, or blocked;
- which canonical Komerce contracts are satisfied.

The provider contract is always read before implementation.

---

## 1. Provider identity

| Field | Value |
|---|---|
| Provider | |
| Environment(s) analysed | |
| Account role analysed | |
| Official API / contract source | |
| Authentication model | |
| Sandbox available | YES / NO / UNKNOWN |
| Last analysis date | |
| Evidence level | DOC ONLY / RAW API / ADAPTER / PIPELINE / GOLDEN |

---

## 2. Sourcing / catalogue capabilities

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Search catalogue | YES / NO / PARTIAL / UNKNOWN | |
| Read exact product / offer | | |
| Read variants / exact units | | |
| Stable supplier unit reference | | |
| Read native price | | |
| Read native currency | | |
| Read stock / availability | | |
| Read publication / sellability state | | |
| Read shipping capability / quote | | |
| Pagination / bounded reads | | |
| Public catalogue vs account-owned catalogue | | |
| Rate limits / quotas known | | |

---

## 3. Canonical output Komerce can safely build

| Canonical fact | Status | Notes |
|---|---|---|
| Canonical Product candidate | PASS / BLOCKED / UNKNOWN | |
| Offer | | |
| Exact Unit | | |
| Supplier Order Identity | | |
| Native supplier money | | |
| Live stock fact | | |
| Live price fact | | |
| Fulfillment / procurement readiness | | |

Provider-specific values must remain inside the adapter / opaque identity payload.
The Komerce core must never guess missing values.

---

## 4. Procurement capabilities

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Manual procurement possible | YES / NO / UNKNOWN | |
| Buyer order creation API | | |
| Automatic order placement | | |
| Payment API usable by Komerce | | |
| Supplier order external reference | | |
| Supplier order read-back | | |
| Order discovery after manual purchase | | |
| Reconciliation possible | | |
| Cancellation | | |
| Invoice | | |
| Tracking | | |

Do not mark a capability supported because the provider has a broadly named API.
Only mark what has been read or proved.

---

## 5. Provider limitations that affect Komerce

Record only material limitations, for example:

- seller API but no buyer API;
- seller-owned catalogue only;
- missing stock;
- unsupported variants;
- unsupported currency;
- required shipping/policy/business prerequisites;
- sandbox/prod differences;
- manual operator step required;
- missing external confirmation / read-back.

---

## 6. Komerce execution classification

### What Komerce can do now

```text
Sourcing:
Purchasing readiness:
Execution:
Evidence / reconciliation:
```

### What Komerce must NOT claim

```text
...
```

---

## 7. Proof stages

Use the canonical provider proof doctrine:

```text
Conversation contract
→ P0 Business readiness
→ P1 Raw API
→ P2 Adapter
→ P3 Pipeline
→ P4 Golden E2E
```

| Stage | Status | Evidence |
|---|---|---|
| Conversation | PASS / BLOCKED / NOT RUN | |
| P0 Business readiness | | |
| P1 Raw API | | |
| P2 Adapter | | |
| P3 Pipeline | | |
| P4 Golden E2E | | |

Missing proof is BLOCKED, never PASS.

---

## 8. Final provider summary

```text
CATALOGUE:
EXACT UNIT:
LIVE PRICE:
LIVE STOCK:
MANUAL PROCUREMENT:
AUTO ORDER:
ORDER EVIDENCE:
RECONCILIATION:
ENVIRONMENT:
MAIN LIMITATION:
```

### Komerce conclusion

One short paragraph answering:

> What can Komerce safely do with this provider today, and what is still forbidden or unproved?

---

## 9. Re-analysis triggers

Re-run this analysis when:

- the provider API/business contract changes;
- new scopes or endpoints are granted;
- Komerce adds a new provider capability;
- a new Golden exposes a missing concept;
- sandbox and production behaviour diverge;
- a previously UNKNOWN fact becomes observable.
