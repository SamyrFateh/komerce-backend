# Chantier — External Provider Contracts — L0

Date: 2026-09-18  
Status: **L0 INVENTORY / FEATURE-FIRST CLASSIFICATION**  
Runtime behavior change: **NONE**

## 1. Why this chantier exists

Komerce already communicates with multiple external systems: suppliers/marketplaces, payment providers, messaging providers, AI/enrichment services, media services and operational dependencies.

The provider-specific code exists in several business features, but the generic rule learned from the Allegro Golden is broader:

> No Komerce feature should discover the real contract of an external provider in the middle of its own E2E.

The canonical order is already defined by `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`:

```text
Real provider contract
→ Conversation contract
→ P0 Business readiness
→ P1 Raw API
→ P2 Adapter
→ P3 Pipeline
→ P4 Golden E2E
```

This chantier turns that doctrine into a transversal Feature-First authority and applies it to every external API boundary.

## 2. Target service

Proposed service sentence:

> **Prove and publish what Komerce may safely trust from each external provider, independently of the consuming business feature.**

The feature does not perform the business operation itself. Payments still pays, Notifications still sends messages, Purchasing still procures, Catalog still imports/enriches.

The transversal authority answers:

```text
Who is this external provider?
Which environment/account/role was analysed?
What operation is expected?
What does the provider require?
What does Komerce send?
What is actually returned?
How is the external state confirmed?
What canonical fact may the consuming feature trust?
What is UNKNOWN / blocked / forbidden?
What proof stage has really passed?
```

## 3. Feature-First classification

### Candidate

```text
name: external-provider-contracts
type: transversal
kind: technical-transversal
decision: feature-transverse
status: draft → staging after L1
```

### Why it qualifies

- **Multi-consumer:** sourcing/catalog/purchasing, payments, notifications, operations and future logistics/identity integrations all depend on external contracts.
- **Unique authority:** the meaning of KNOWN / DERIVED / UNKNOWN and Conversation/P0..P4 must not diverge per business feature.
- **Own invariants:** missing proof is BLOCKED; accepted request is not confirmation; wrong environment hard-fails; provider-native vocabulary cannot leak as canonical truth without an adapter.
- **Existing generic implementation:** `scripts/provider-contract-proof.js` already implements the generic conversation and P0..P4 gate.
- **Existing universal doctrine:** `DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md` explicitly applies beyond suppliers to payments, messaging, logistics and future APIs.

### Why it is not an integration-adapter feature

Provider-specific adapters remain owned by their consuming business feature:

```text
Stripe adapter       → payments
Meta/AuthKey adapter → notifications
Allegro adapter      → catalog/purchasing
MTN/Orange/KartaPay  → payments
AI enrichment        → catalog
```

`external-provider-contracts` owns the **proof contract and trust authority**, not the external side effect.

## 4. L0 discovery result

The first static inventory is stored in:

`docs/external-providers/EXTERNAL_PROVIDER_INVENTORY.md`

Initial families found:

```text
SUPPLIER / MARKETPLACE
PAYMENT
MESSAGING
AI / ENRICHMENT
MEDIA / EXTERNAL CONTENT
OPERATIONS / OBSERVABILITY
CONFIG-ONLY / LEGACY CANDIDATES
```

Allegro Sandbox is currently the reference provider because its complete path has been proved through P4.

All other providers remain **UNQUALIFIED in the new standard until individually audited**, even when code/tests already exist. Existing implementation is evidence to inspect; it is not automatically a P0..P4 PASS.

## 5. Scope

### In

- generic external-provider analysis template;
- inventory of real outbound/inbound API boundaries;
- provider + environment + account/role identification;
- EXPECTS / REQUIRES / SENDS / RECEIVES / CONFIRMS / EXPOSES;
- KNOWN / DERIVED / UNKNOWN;
- generic P0..P4 proof vocabulary and fail-closed gate;
- proof/evidence status visible to consuming features;
- re-analysis triggers;
- governance preventing unregistered external API dependencies.

### Out

- changing provider-specific business behavior;
- moving Stripe/PayPal/Meta/supplier adapters out of their current business features;
- centralizing credentials/secrets into this feature;
- inventing one universal capability taxonomy for all providers;
- claiming a provider capability based only on endpoint names;
- running destructive or monetary live probes in L0;
- rewriting existing domain E2Es.

## 6. Canonical invariants

1. **Reality before abstraction.**
2. **UNKNOWN never becomes PASS or false by default.**
3. **HTTP/API acceptance is not business confirmation.**
4. **A mutation is confirmed only by a provider-supported read-back/evidence mechanism when the operation requires confirmation.**
5. **Provider-specific vocabulary is translated before the consuming core relies on it.**
6. **Sandbox/staging evidence never proves production.**
7. **Ambiguous evidence blocks; Komerce never guesses.**
8. **Duplicate callbacks/evidence must be replay-safe.**
9. **A provider can be useful with partial capabilities; unsupported capabilities remain explicitly closed.**
10. **A business feature must not discover elementary provider prerequisites during its Golden E2E.**

## 7. Execution plan

### L0 — Inventory and classification — THIS PR

```text
repo scan
→ identify real external boundaries
→ distinguish runtime / staging / config-only
→ identify consuming feature
→ record existing evidence
→ do NOT assign proof PASS without requalification
```

Definition of Done:
- first inventory committed;
- scope/exclusions explicit;
- Feature-First target classification documented;
- no runtime behavior changed.

### L1 — Register the transversal feature

Only after L0 approval:

- create `features/external-provider-contracts.feature.js`;
- add it to `APP_FEATURE_REGISTRY.md`;
- move/retag ownership of the generic proof engine currently under `@domain purchasing`;
- keep all provider-specific adapters in their existing domain feature;
- run Feature-First/governance gates.

Key existing ownership mismatch to resolve:

```text
scripts/provider-contract-proof.js
@domain purchasing
but doctrine + implementation are generic across external providers
```

### L2 — Make the inventory reproducible

Add a read-only scanner that inventories external boundaries from code:

- literal external HTTP(S) hosts;
- known SDK clients (Stripe, Sentry, etc.);
- provider base URLs from environment-backed adapters;
- inbound provider webhook routes;
- provider identifiers in connector/adapter registries.

The scanner must classify, not mutate.

Target output:

```text
provider
family
consumer feature
outbound / inbound
runtime / staging / test
source files
registered?
analysis document?
highest proved stage?
```

CI should eventually detect a **new unregistered external boundary**.

### L3 — Provider contract cards

Create one analysis card per real provider using:

`docs/external-providers/EXTERNAL_PROVIDER_ANALYSIS_TEMPLATE.md`

Priority waves:

```text
WAVE A — money / customer commitment
Stripe
PayPal
KartaPay
MTN MoMo
Orange Money

WAVE B — messaging / identity side effects
Meta WhatsApp
AuthKey
Brevo

WAVE C — supplier/source
AliExpress
CJ
Noon
Allegro already reference-complete

WAVE D — enrichment / media / operational
Anthropic
OpenAI
ImageKit
QRServer
Sentry
staging public content APIs
```

### L4 — Normalize proof stages

For each provider operation:

```text
Conversation
→ P0
→ P1
→ P2
→ P3
→ P4 when a real Golden is appropriate
```

Not every provider needs a mutating P4 immediately. The card must say what is and is not proved.

### L5 — Enforcement

After enough providers have been requalified:

- consumers reference provider proof/capability truth instead of private assumptions;
- unknown required capability hard-stops;
- new external integrations require an inventory entry + contract card before business pipeline activation;
- a Golden can prove composition, never discover missing P0/P1 prerequisites.

### L6 — Drift / requalification

Re-analyse on:

- provider API/business contract change;
- new endpoint/scope/account role;
- environment change;
- new Komerce capability requirement;
- new provider exposing a genuinely missing canonical concept.

## 8. Safety rule for this chantier

The audit is read-only until a provider-specific proof plan explicitly authorizes a mutation.

```text
READ DOC
→ READ CODE
→ READ-ONLY PROBE where safe
→ characterize
→ only then mutate in a dedicated provider proof
```

Payment, procurement and customer messaging operations must never be triggered simply to fill the inventory.

## 9. End state

A new external provider should enter Komerce like this:

```text
Provider discovered
→ registered in inventory
→ real contract decoded
→ capabilities/limitations recorded
→ Conversation complete
→ P0/P1 proved independently
→ domain adapter P2
→ domain composition P3
→ Golden P4 when appropriate
→ consuming feature trusts only the canonical exposed facts
```

The result is not one giant integration framework. It is one **trust discipline and proof authority** shared by every Komerce feature that crosses the system boundary.
