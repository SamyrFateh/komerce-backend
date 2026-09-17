# Doctrine — External Provider Contract Proofs

## Purpose

Komerce must never use a full Golden E2E to discover whether the elementary contract of an external provider is valid.

Every external boundary is proved independently before it is composed into the next layer. This applies to marketplaces, suppliers, payment providers, messaging providers, logistics providers and any future external API.

The mandatory order is:

```text
Business contract
  -> Raw API probe
  -> Adapter proof
  -> Pipeline proof
  -> Golden E2E
```

A downstream stage MUST NOT run while an upstream stage is unproved or blocked.

## Canonical stages

### P0 — BUSINESS_READINESS

Prove that the provider account and business contract permit the intended operation.

Examples: account role, sandbox entitlement, seller/buyer capability, required policies, shipping configuration, payment capability, marketplace eligibility, mandatory legal data.

This stage is about what the provider allows, not about Komerce code.

### P1 — RAW_API

Prove the operation directly against the provider API with the smallest possible request, independently of the Komerce orchestration pipeline.

The proof records only bounded, sanitized facts needed to decide conformance. It must expose provider status/error codes without leaking credentials, free-text secrets or personal data.

A raw probe should be independently executable and should not mutate state unless the tested contract itself is a mutation. Mutating probes must be explicit, sandbox-only when available, idempotent where possible, and cleanly distinguish setup from proof.

### P2 — ADAPTER

Prove that the Komerce provider adapter maps the already-proven provider contract correctly:

```text
canonical input -> provider request
provider response -> canonical result
```

The adapter test must not compensate for an unknown or unproved external contract.

### P3 — PIPELINE

Prove that the relevant Komerce pipeline composes the proven adapter correctly: sourcing, canonicalization, sellable unit, supplier order identity, purchasing preflight, reconciliation, or another bounded flow.

### P4 — GOLDEN_E2E

Only after P0, P1, P2 and P3 are PASS may the real Golden path execute.

The Golden proves composition and real side effects. It is not a discovery mechanism for elementary provider prerequisites.

## Fail-closed rule

Provider readiness is monotonic:

```text
P0 BLOCKED -> stop
P1 BLOCKED -> stop
P2 BLOCKED -> stop
P3 BLOCKED -> stop
P4 allowed only when P0..P3 PASS
```

A missing proof is BLOCKED, never PASS.

Each block must identify the smallest failed contract check so the investigation stays local.

Example:

```text
Provider: ALLEGRO
Environment: SANDBOX

P0 BUSINESS_READINESS  BLOCKED
  SELLER_MANAGED_SHIPPING_RATE  FAIL
P1 RAW_API             not reached
P2 ADAPTER             not reached
P3 PIPELINE            not reached
P4 GOLDEN_E2E          forbidden
```

## Evidence requirements

A proof must answer four questions:

1. What contract requirement was tested?
2. What bounded input/request was sent or observed?
3. What bounded fact was returned?
4. Why does that fact mean PASS or BLOCKED?

A generic `PASS` without evidence is insufficient for a live external contract.

Evidence may be a sanitized probe result, a unit/contract assertion, a provider object identifier, a response status, a canonical state transition, or another deterministic fact. Credentials, payment instruments, buyer personal data and raw provider free text must not be persisted merely to satisfy proof reporting.

## Golden setup rule

Golden setup must perform all read-only prerequisite probes before creating or mutating provider objects.

For example, a sandbox seller draft MUST NOT be created if the account cannot satisfy the shipping, policy or capability contract needed to activate it. This prevents repeated creation of unusable test data and avoids using the Golden as trial-and-error discovery.

## Provider onboarding rule

A new provider is not `PURCHASABLE` merely because an adapter exists.

The minimum onboarding sequence is:

```text
1. Read the complete business workflow and official API contract.
2. Enumerate required capabilities and prerequisites.
3. Implement independent raw probes for those capabilities.
4. Obtain P0/P1 proof.
5. Implement and prove the adapter (P2).
6. Prove pipeline composition (P3).
7. Run the Golden (P4).
```

The same method applies to future unknown providers. Provider-specific details belong in the probe/adapter; the proof stages remain stable.

## Implementation

`scripts/provider-contract-proof.js` is the shared fail-closed stage gate. Provider-specific probes construct the checks. Golden runners call `assertThrough()` before crossing into later stages.

Allegro Sandbox is the first enforced implementation of this doctrine.
