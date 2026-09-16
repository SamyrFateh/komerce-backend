# Allegro Golden live contract proof — 2026-09-16

During the controlled Golden E2E seller-seed run, the live Allegro Sandbox API rejected the first draft attempt with:

`ALLEGRO_HTTP_422[UnsupportedLanguageInAcceptLanguageHeader]`

The request came from Node's fetch boundary without an explicit Allegro-supported `Accept-Language`, allowing the runtime default to reach the provider.

Correction: every authenticated Allegro API request now sends `Accept-Language: pl-PL`, one of Allegro's documented supported BCP-47 values.

This proof concerns only the Sandbox seller setup boundary. It does not claim catalog publication, checkout, payment, supplier purchase, notification or invoice completion.
