# Doctrine — External Provider Contract Proofs


## Feature ownership

The transversal Feature-First authority for this doctrine is `external-provider-contracts`.

It owns the generic trust/proof vocabulary — Conversation, KNOWN / DERIVED / UNKNOWN and P0..P4 — but **does not own provider-specific adapters or business side effects**. Stripe remains owned by Payments, Meta/AuthKey by Notifications, supplier adapters by their catalog/purchasing boundaries, and future provider clients by their consuming domain feature.

## Purpose

Komerce must never use a full Golden E2E to discover whether the elementary contract of an external provider is valid.

Every external boundary is proved independently before it is composed into the next layer. This applies to marketplaces, suppliers, payment providers, messaging providers, logistics providers and any future external API.

The mandatory order is:

```text
Real provider contract
  -> Conversation contract
  -> P0 Business readiness
  -> P1 Raw API proof
  -> P2 Adapter proof
  -> P3 Pipeline proof
  -> P4 Golden E2E
```

A downstream stage MUST NOT run while the conversation or an upstream stage is unproved or blocked.

## Reality before abstraction

The provider contract is the source of truth. Komerce does not invent a generic model and force providers into it.

The abstraction is extracted from real contracts:

```text
provider A real contract
provider B real contract
provider C real contract
        -> common invariants
        -> canonical Komerce abstraction
```

When a new provider arrives, its real contract challenges the abstraction. A syntax or protocol difference belongs in the adapter. A capability difference belongs in the capability model. A genuinely new business concept may justify evolving the canonical model.

Adding a provider-specific branch to the core is not an acceptable substitute for understanding the contract.

## Conversation contract

Before testing an operation, Komerce MUST be able to describe the complete information exchange between both sides.

The canonical phases are:

```text
EXPECTS
  what Komerce needs from the operation

REQUIRES
  what the provider requires to perform it

SENDS
  what Komerce can send to the provider

RECEIVES
  what the provider returns

CONFIRMS
  what can be verified or read back as real provider state

EXPOSES
  what Komerce can safely expose to the next canonical layer
```

The conversation proves information completeness, not business success. For example, observing that an account has zero eligible seller-managed shipping rates is a KNOWN fact: the conversation may be complete while P0 is BLOCKED.

### Fact states

Every fact in the conversation has one of three states:

```text
KNOWN
  explicitly observed or defined by the real provider contract

DERIVED
  computed by Komerce from known facts; evidence is mandatory

UNKNOWN
  required information is missing, not exposed, or not yet read
```

Absence is never silently converted to `false`.

```text
field absent -> UNKNOWN
explicit false -> KNOWN
calculated readiness -> DERIVED
```

Any UNKNOWN fact or missing conversation phase blocks the conversation. No stage assertion may pass while the conversation is blocked.

## Output completeness invariant

A successful operation is insufficient if it cannot provide the information required by the next boundary.

Each contract MUST therefore prove both:

1. its own operation;
2. the completeness of the canonical output it exposes downstream.

Example:

```text
HTTP 201
  != contract PASS

HTTP 201
+ provider object id
+ readable provider state
+ canonical capability facts
+ downstream-required references
  -> contract can PASS
```

This prevents a late E2E failure caused by an earlier layer that technically succeeded but exposed incomplete information.

## Canonical stages

### P0 — BUSINESS_READINESS

Prove that the provider account and business contract permit the intended operation.

Examples: account role, sandbox entitlement, seller/buyer capability, required policies, shipping configuration, payment capability, marketplace eligibility, mandatory legal data.

This stage is about what the provider allows, not about Komerce code.

### P1 — RAW_API

Prove the operation directly against the provider API with the smallest possible request, independently of the Komerce orchestration pipeline.

The proof records only bounded, sanitized facts needed to decide conformance. It must expose provider status/error codes without leaking credentials, free-text secrets or personal data.

A raw probe should be independently executable and should not mutate state unless the tested contract itself is a mutation. Mutating probes must be explicit, sandbox-only when available, idempotent where possible, and cleanly distinguish setup from proof.

For a mutating operation, acceptance and confirmation are distinct:

```text
request accepted
  -> provider response
  -> read-back / observable provider state
  -> canonical confirmation
```

### P2 — ADAPTER

Prove that the Komerce provider adapter maps the already-proven provider contract correctly:

```text
canonical input -> provider request
provider response/read-back -> canonical result
```

The adapter test must not compensate for an unknown or unproved external contract.

### P3 — PIPELINE

Prove that the relevant Komerce pipeline composes the proven adapter correctly: sourcing, canonicalization, sellable unit, supplier order identity, purchasing preflight, reconciliation, or another bounded flow.

The pipeline must consume only the canonical output exposed by the previous contract, not provider-specific implementation details.

### P4 — GOLDEN_E2E

Only after the conversation and P0, P1, P2 and P3 are PASS may the real Golden path execute.

The Golden proves composition and real side effects. It is not a discovery mechanism for elementary provider prerequisites.

## Fail-closed rule

Provider readiness is monotonic:

```text
CONVERSATION BLOCKED -> stop
P0 BLOCKED           -> stop
P1 BLOCKED           -> stop
P2 BLOCKED           -> stop
P3 BLOCKED           -> stop
P4 allowed only when conversation + P0..P3 PASS
```

A missing proof is BLOCKED, never PASS.

Each block must identify the smallest missing or failed fact so the investigation stays local.

## Evidence requirements

A proof must answer:

1. What does Komerce expect?
2. What does the provider require?
3. What bounded request or observation is made?
4. What bounded fact is received?
5. How is the real state confirmed?
6. What canonical information is exposed downstream?
7. Why do those facts mean PASS or BLOCKED?

A generic `PASS` without evidence is insufficient for a live external contract.

Evidence may be a sanitized probe result, a unit/contract assertion, a provider object identifier, a response status, a canonical state transition, or another deterministic fact. Credentials, payment instruments, buyer personal data and raw provider free text must not be persisted merely to satisfy proof reporting.

## Golden setup rule

Golden setup must perform all read-only prerequisite probes before creating or mutating provider objects.

For example, a sandbox seller draft MUST NOT be created if the account cannot satisfy the shipping, policy or capability contract needed to activate it. This prevents repeated creation of unusable test data and avoids using the Golden as trial-and-error discovery.

## Provider onboarding rule

A new provider is not `PURCHASABLE` merely because an adapter exists.

The minimum onboarding sequence is:

```text
1. Read the complete real business workflow and official API contract.
2. Describe EXPECTS / REQUIRES / SENDS / RECEIVES / CONFIRMS / EXPOSES.
3. Mark every required fact KNOWN / DERIVED / UNKNOWN.
4. Stop if the conversation is incomplete.
5. Implement independent raw probes.
6. Obtain P0/P1 proof.
7. Implement and prove the adapter (P2).
8. Prove pipeline composition (P3).
9. Run the Golden (P4).
```

Provider-specific details belong in the provider probe/adapter. The conversation shape and proof stages remain stable.

## Abstraction acceptance test

A provider abstraction is validated only when a materially different provider can satisfy the same canonical conversation without teaching the core its private vocabulary.

```text
new provider
  -> real contract understood
  -> adapter translates provider language
  -> same canonical EXPOSES contract
  -> core unchanged
```

If the core needs `if (provider === ...)` to understand ordinary provider semantics, the abstraction must be challenged before adding the special case.

## Implementation

`scripts/provider-contract-proof.js` is the shared fail-closed conversation and stage gate.

Provider-specific probes construct bounded conversation facts and stage checks. `assertThrough()` first requires a complete conversation, then enforces P0..Pn in order.

Allegro Sandbox is the first enforced implementation of this doctrine.
