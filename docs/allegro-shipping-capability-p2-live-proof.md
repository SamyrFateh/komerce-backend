# Allegro Shipping Capability — P2

Provider object proven live in Sandbox on 2026-09-17:

- shipping_rate_ref: `c5a73d48-2eda-42ad-abe1-0b2cf405bf9f`
- type: `PHYSICAL`
- dispatch_country: `PL`
- managed_by_allegro: `false`
- is_fulfillment: `false`

Canonical output required from the adapter:

```json
{
  "provider": "allegro",
  "environment": "sandbox",
  "provider_ref": "c5a73d48-2eda-42ad-abe1-0b2cf405bf9f",
  "delivery_kind": "PHYSICAL",
  "dispatch_country": "PL",
  "management_mode": "SELLER",
  "fulfillment_mode": "SELLER",
  "bindable_to_standard_offer": true
}
```

No Allegro-specific field may cross the canonical boundary. A missing decision-relevant provider fact must fail closed rather than default.
