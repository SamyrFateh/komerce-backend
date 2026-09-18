# External Provider Contract Analysis — Template

## Purpose

This is the standard Komerce qualification record for **any external system reached through an API or provider protocol**.

It applies to supplier/marketplace, payment, messaging, logistics, identity/KYC, media, AI/enrichment and future external providers.

It does **not** replace provider documentation, domain doctrine or Golden proofs. It records only what Komerce has actually established:

- what the external provider really exposes;
- what it requires from Komerce;
- what Komerce sends and receives;
- how a claimed result can be confirmed from real provider state;
- what canonical facts can safely cross back into Komerce;
- what remains UNKNOWN, manual, limited or forbidden;
- the current proof level P0 → P4.

The provider contract is read and proved before a domain pipeline relies on it.

---

## 1. Provider identity

| Field | Value |
|---|---|
| Provider | |
| Provider family | supplier / payment / messaging / logistics / identity / media / AI / other |
| Consuming Komerce feature(s) | |
| Environment(s) analysed | |
| Account / role analysed | |
| Official contract source | |
| Authentication model | |
| Sandbox / staging available | YES / NO / UNKNOWN |
| Last analysis date | |
| Highest proof level | DOC ONLY / P0 / P1 / P2 / P3 / P4 |

---

## 2. Complete conversation contract

Every operation analysed must answer all six phases.

| Phase | What must be recorded |
|---|---|
| EXPECTS | What Komerce needs the operation to achieve |
| REQUIRES | Preconditions, account rights, policies, credentials, provider-side setup |
| SENDS | Bounded request / facts sent by Komerce |
| RECEIVES | Bounded provider response |
| CONFIRMS | How Komerce reads back or otherwise proves real external state |
| EXPOSES | Canonical facts safe for the consuming Komerce feature |

Fact states:

```text
KNOWN   = explicitly observed or defined by the real provider contract
DERIVED = computed by Komerce from known facts; evidence required
UNKNOWN = missing / not exposed / not yet proved
```

UNKNOWN never silently becomes false or success.

---

## 3. Generic capability profile

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Read operation(s) | YES / NO / PARTIAL / UNKNOWN | |
| Write / mutation operation(s) | | |
| Stable external reference | | |
| Read-back / confirmation | | |
| Async callback / webhook | | |
| Idempotency mechanism | | |
| Pagination / bounded reads | | |
| Retry semantics known | | |
| Rate limits / quotas known | | |
| Environment isolation | | |
| Error contract understood | | |
| Sensitive / personal data involved | | |

A broadly named endpoint is not evidence of a capability. Record only what has been read or proved.

---

## 4. Domain-specific capability profile

Keep only the relevant profile(s). Add a new profile only when a real provider forces a new domain concept.

### Supplier / marketplace

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Search catalogue | | |
| Read exact product / offer | | |
| Variants / exact units | | |
| Native price + currency | | |
| Stock / availability | | |
| Sellability / publication state | | |
| Shipping / quote | | |
| Manual procurement | | |
| Automatic order placement | | |
| Supplier order reference | | |
| Order read-back / discovery | | |
| Reconciliation | | |
| Cancellation / invoice / tracking | | |

### Payment

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Create payment / authorization | | |
| Capture / confirmation | | |
| Webhook | | |
| Server-side read-back | | |
| Refund | | |
| Partial refund | | |
| Dispute / chargeback | | |
| Provider transaction reference | | |

### Messaging

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Send message / template | | |
| Provider message reference | | |
| Delivery receipt | | |
| Read receipt | | |
| Inbound webhook | | |
| Retry / duplicate behavior | | |

### Logistics

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Quote / serviceability | | |
| Shipment creation | | |
| Label | | |
| Pickup | | |
| Tracking events | | |
| Proof of delivery | | |
| Cancellation | | |

### Identity / KYC

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Verification request | | |
| Stable verification reference | | |
| Result / status read-back | | |
| Expiration / freshness | | |
| Webhook | | |

### Media / AI / enrichment

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Input contract | | |
| Output contract | | |
| Deterministic validation by Komerce | | |
| External artifact / response reference | | |
| Retry / timeout | | |
| Degraded mode if provider unavailable | | |

---

## 5. Canonical Komerce output

Describe only the facts that the consuming Komerce feature is allowed to trust.

```text
External provider language
        ↓ adapter
Canonical Komerce facts
        ↓
Domain feature
```

| Canonical fact | Status | Evidence |
|---|---|---|
| | PASS / BLOCKED / UNKNOWN | |

Provider-private vocabulary stays inside the adapter/evidence boundary unless the canonical model explicitly owns it.

---

## 6. Limitations and forbidden assumptions

Record material limitations only.

Examples:

- seller API but no buyer API;
- accepted request without read-back confirmation;
- webhook proves receipt but not final business state;
- sandbox behavior not proven in production;
- no stock fact;
- no stable external id;
- no delivery receipt;
- manual operator step required;
- rate limit unknown;
- provider returns ambiguous status.

### What Komerce can safely do now

```text
...
```

### What Komerce must NOT claim

```text
...
```

---

## 7. Failure and recovery semantics

| Situation | Required Komerce behavior |
|---|---|
| Required fact UNKNOWN | BLOCK |
| Provider rejects request | domain-specific failure, never fabricate success |
| Request accepted but state unconfirmed | PENDING / unconfirmed, not success |
| Ambiguous external match | BLOCK / human escalation |
| Duplicate callback / evidence | idempotent replay |
| Different external reference already bound | hard fail |
| Wrong environment | hard fail |
| Provider unavailable | explicit degraded / blocked behavior defined by consuming feature |

---

## 8. Proof stages

Canonical doctrine:

```text
Real provider contract
→ Conversation contract
→ P0 Business readiness
→ P1 Raw API proof
→ P2 Adapter proof
→ P3 Pipeline proof
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

## 9. Final summary

```text
PROVIDER:
FAMILY:
CONSUMERS:
ENVIRONMENT:
READ:
WRITE:
CONFIRMATION / READ-BACK:
WEBHOOK / ASYNC:
IDEMPOTENCE:
HIGHEST PROOF:
MAIN LIMITATION:
```

### Komerce conclusion

Answer in one paragraph:

> What can Komerce safely rely on from this provider today, and what remains forbidden or unproved?

---

## 10. Re-analysis triggers

Re-run the analysis when:

- the provider business/API contract changes;
- a new endpoint, permission or provider account role is introduced;
- Komerce needs a new capability;
- sandbox/staging and production behavior diverge;
- a previously UNKNOWN fact becomes observable;
- a Golden exposes a missing canonical concept;
- a second materially different provider challenges the current abstraction.
