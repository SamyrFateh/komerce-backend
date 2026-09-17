# Allegro shipping capability — P2 adapter proof

This note records the P2 boundary used by the Allegro Sandbox shipping contract.

Provider-specific facts remain inside `allegro-shipping-capability-adapter.js`:

- `managed_by_allegro`
- `is_fulfillment`
- Allegro shipping-rate detail shape

The adapter exposes only the canonical `ShippingCapability` contract:

- `provider`
- `environment`
- `provider_ref`
- `delivery_kind`
- `dispatch_country`
- `management_mode`
- `fulfillment_mode`
- `bindable_to_standard_offer`

Decision-relevant provider facts are fail-closed. Missing management, fulfillment, delivery kind or dispatch country never defaults to a seller capability.

The live P2 proof is read-only: it reads the already-confirmed shipping rate, adapts it, validates the canonical shape and requires `bindable_to_standard_offer=true`. It does not create a shipping rate, offer, order or payment.
