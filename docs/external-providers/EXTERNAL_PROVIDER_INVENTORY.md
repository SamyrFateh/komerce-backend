# External Provider Inventory — L0

Date: 2026-09-18  
Source: static repository audit of `main`  
Status: **INITIAL INVENTORY — proof levels must be requalified provider by provider**

## Reading rule

This table does **not** declare a provider safe merely because code exists.

Statuses:

- **REFERENCE P4** — standardized real proof already exists.
- **IMPLEMENTED / REQUALIFY** — integration code exists; its external contract must be rewritten in the common Conversation/P0..P4 format.
- **STAGING / TOOLING** — external dependency used by staging/operator tooling rather than normal production business flow.
- **CONFIG-ONLY / VERIFY** — configuration/documentation found but no active runtime client found in this L0 search.
- **NOT AN API BOUNDARY** — external navigation/link only; excluded unless code later calls an API.


## Reproducible L2 scan

The static inventory can now be recomputed read-only from the repository:

```bash
node scripts/external-provider-boundary-scan.js
node scripts/external-provider-boundary-scan.js --json
```

The scanner performs no network call and no mutation. It reports registered providers, observed files/domains/scopes, registered-but-unobserved providers and unknown literal HTTPS hosts. In L2, unknowns are **observations only**, not CI failures; enforcement belongs to the later L5 ratchet.

## 1. Supplier / marketplace

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **Allegro Sandbox** | catalog, sourcing, purchasing | `services/suppliers/allegro-sandbox-client.js`, connector, fulfillment adapter, reconciliation, Golden proof runners, `docs/allegro-sandbox.md` | **REFERENCE P4** |
| **AliExpress DS** | catalog, sourcing, purchasing | connector, OAuth, purchase preflight, fulfillment adapter, multiple Golden/prepayment scripts/docs | **IMPLEMENTED / REQUALIFY** |
| **CJ** | catalog, sourcing | connector, catalog index, full-catalog/showcase scripts, validation docs | **IMPLEMENTED / REQUALIFY** |
| **Noon** | catalog, sourcing | `noon-connector.js`, dispatch/authority registration, unit tests | **IMPLEMENTED / REQUALIFY**; live/raw proof not assumed |
| Manual/CSV/JSON sources | catalog, sourcing | local ingestion connectors | internal/local source contracts, **not external API providers** |

## 2. Payment

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **Stripe** | payment, orders/refunds | PaymentIntent create/retrieve, real TEST webhook delivery, exact fail-closed Komerce mapping, refunds, idempotence | **P2 PASS candidate** — next P3 DB/API pipeline |
| **PayPal** | payment | `paypal-client.js`, create/capture/refund flow, webhook events, sandbox probe | **IMPLEMENTED / REQUALIFY** |
| **MTN MoMo CG** | payment | provider adapter + sandbox probe + status normalization | **IMPLEMENTED / REQUALIFY** |
| **Orange Money CM** | payment | provider adapter, OAuth, payment/status URLs fail-closed until merchant contract configured | **IMPLEMENTED / REQUALIFY** |
| **KartaPay KM** | payment | staging/prod endpoint separation, webhook secret, status recheck, provider adapter | **IMPLEMENTED / REQUALIFY** |

Money providers are Wave A because an incorrect assumption can create customer financial commitment or false payment state.

## 3. Messaging / outbound communications

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **Meta WhatsApp Business** | notifications, auth/OTP | Graph API message send + inbound webhook route/signature configuration | **IMPLEMENTED / REQUALIFY** |
| **AuthKey WhatsApp** | notifications | outbound REST client + webhook verification + staging phone allowlist | **IMPLEMENTED / REQUALIFY** |
| **Brevo** | notifications/email | REST v3 transactional email sender | **IMPLEMENTED / REQUALIFY** |
| Africa's Talking | none confirmed in runtime | env/docs references only in this L0 search | **CONFIG-ONLY / VERIFY** |
| Twilio WhatsApp | none confirmed in runtime | env/docs references only in this L0 search | **CONFIG-ONLY / VERIFY** |

Config-only entries must be either linked to real code/contracts or removed from the active provider inventory later.

## 4. AI / catalogue enrichment

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **Anthropic** | catalog | `catalog-enrichment.js` calls Messages API; output schema + Komerce validation | **IMPLEMENTED / REQUALIFY** |
| **OpenAI** | catalog | same provider-neutral enrichment service can call Responses API | **IMPLEMENTED / REQUALIFY** |

Important: model output is not canonical truth merely because an API call succeeds. The contract card must document Komerce-side schema validation, confidence/review and degraded behavior.

## 5. Media / external content

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **ImageKit** | catalog/showcase tooling | upload API, canonical showcase media provider setting | **STAGING / TOOLING — REQUALIFY** |
| **Cloudinary** | catalog/showcase tooling | upload endpoint retained as explicit override/legacy path | **STAGING / TOOLING — VERIFY CURRENT NEED** |
| **Wikimedia Commons** | catalog/showcase tooling | Commons API + media downloads for curated staging catalogue | **STAGING / TOOLING** |
| DummyJSON | catalog/showcase tooling | public candidate-source reads | **STAGING / TOOLING** |
| EscuelaJS | catalog/showcase tooling | public candidate-source reads | **STAGING / TOOLING** |
| **QRServer / goQR** | logistics/documents | remote QR image URL used in parcel label / pickup receipt rendering | **IMPLEMENTED / REQUALIFY** |

The generic image-health audit also performs HTTP reads against arbitrary persisted image URLs. That is an external network boundary even when there is no single named provider; it should be documented as a bounded remote-content probe rather than disguised as an internal read.

## 6. Operations / observability

| Provider | Consumers | Evidence found | L0 status |
|---|---|---|---|
| **Sentry** | operations | optional SDK initialization and exception forwarding when `SENTRY_DSN` is configured | **IMPLEMENTED OPTIONAL / REQUALIFY** |

## 7. Explicit exclusions found in L0

These are not registered as API providers from current evidence:

| Item | Why excluded now |
|---|---|
| Google Maps relay links | current code evidence is URL/link generation for user navigation, not a server-side Maps API contract |
| Browser calls to `/api/*` | internal Komerce boundary, not an external provider |
| PostgreSQL/Railway connection | infrastructure connection, not an external business/provider API in this chantier scope |
| GitHub CI actions | repository/CI tooling, not a Komerce runtime provider contract unless application code begins depending on its API |

These exclusions can be revised if a real external API call is found.

## 8. Cross-cutting finding

The repository already contains a generic proof engine:

`scripts/provider-contract-proof.js`

It implements:

```text
EXPECTS / REQUIRES / SENDS / RECEIVES / CONFIRMS / EXPOSES
KNOWN / DERIVED / UNKNOWN
P0 / P1 / P2 / P3 / P4
```

But it is currently tagged:

```text
@domain purchasing
```

while its doctrine explicitly applies to marketplaces, suppliers, payment providers, messaging providers, logistics providers and future external APIs.

This is the first concrete ownership gap for L1.

## 9. Initial risk priority

```text
A — financial commitment / money
    Stripe, PayPal, KartaPay, MTN MoMo, Orange Money

B — customer-visible outbound communication / identity
    Meta WhatsApp, AuthKey, Brevo

C — supplier procurement/source truth
    AliExpress, CJ, Noon
    Allegro already reference P4

D — enrichment/media/operations
    Anthropic, OpenAI, ImageKit, QRServer, Sentry, staging content sources

E — stale/config-only verification
    Africa's Talking, Twilio, legacy Cloudinary paths
```

Priority is about consequence of a wrong contract assumption, not provider importance.

## 10. L0 conclusion

Komerce already has enough external integrations to justify a common trust/proof authority. The next step is **not** to centralize the provider adapters. It is to centralize the rules that say when an external provider fact is known, proved and safe for a business feature to consume.

No provider except the already-proved Allegro Sandbox path is assigned a new P0..P4 PASS by this inventory. Each will be audited against the common template.
