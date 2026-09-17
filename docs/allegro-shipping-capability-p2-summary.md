# Allegro Shipping Capability P2 Summary

P2 proves that a provider-specific Allegro shipping rate can be translated into a provider-agnostic Komerce shipping capability without leaking Allegro field names into core contracts.

Fail closed on missing decision facts; preserve provider_ref exactly; expose only canonical fields; require bindable_to_standard_offer=true for the previously proven seller PHYSICAL PL non-Fulfillment rate.
