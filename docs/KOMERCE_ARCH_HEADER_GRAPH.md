# Komerce Architecture Header Graph

Version: 2026-06 (artefact deterministe â€” fonction pure des headers)

This graph is generated from `@komerce-arch` and `@komerce-arch-lite` headers. Do not edit it by hand; update headers, then regenerate.

## Totals

- Scanned code files: 826
- Files with full headers: 764
- Files with lite headers: 62
- Files with any headers: 826
- Files without headers: 0
- Files with misplaced headers (shebang/code before block): 0
- Lite headers without owner: 0
- Graph nodes: 2104
- Edges: 10517
- DB tables: 244
- Doctrines: 823
- Impact areas: 211
- Unresolved code edges: 996
- Tables multi-Ã©crivains directs (>=2): 99
- Avertissements db-write / db-write-via en chevauchement: 13

## Domains

- account: 2
- admin-dashboard: 39
- auth: 14
- auth-identity: 12
- auth-passkey: 7
- bootstrap: 2
- boutique: 24
- business-rules: 1
- catalog: 140
- checkout: 4
- customs: 8
- dashboard: 34
- decision-signals: 14
- documents: 16
- economic-engine: 69
- external-provider-contracts: 1
- finance: 3
- incident-management: 5
- infrastructure: 25
- inventory: 2
- local-stock: 4
- logistics: 71
- loyalty: 3
- market: 10
- market-autonomy: 4
- market-control-plane: 5
- market-delegation: 39
- markets: 1
- notification: 22
- operations: 11
- orders: 42
- payment: 30
- payments: 1
- platform-ops: 2
- providers-services: 7
- purchasing: 53
- recommendations: 6
- refunds: 12
- settlement: 2
- shared: 1
- shared-cart: 25
- shared-cart-modal: 7
- sourcing: 37
- supplier-connectivity: 4
- tracking: 1
- unsold-resolution: 1
- wallet: 3

## Layers

- adapter: 6
- api-client: 2
- bootstrap: 7
- composition-root: 1
- controller: 1
- cron: 1
- data-service: 1
- domain-helper: 1
- domain-logic: 1
- entrypoint: 1
- external-adapter: 2
- infrastructure: 1
- machine: 1
- manual-test: 1
- middleware: 27
- presenter: 1
- route: 139
- route-manifest: 1
- schema: 1
- service: 503
- service-policy: 1
- state: 1
- state-store: 1
- ui-adapter: 1
- ui-behavior: 1
- ui-bootstrap: 4
- ui-boundary: 2
- ui-component: 41
- ui-controller: 3
- ui-enhancer: 3
- ui-helper: 1
- ui-infrastructure: 1
- ui-page: 5
- ui-renderer: 11
- ui-runtime: 2
- ui-service: 5
- ui-state: 1
- util: 32
- util-ui: 1
- utility: 2
- validators: 1
- view-model: 7

## Critical And High Files

- bootstrap/api-routes.js â€” api-route-manifest (infrastructure, critical, full)
- bootstrap/crons.js â€” operational-crons (infrastructure, critical, full)
- public/boutique/js/b-cart.js â€” boutique-cart-and-side-cart (boutique, critical, full)
- public/boutique/js/b-checkout.js â€” boutique-checkout-orchestrator (checkout, critical, full)
- public/boutique/js/b-mobile-money.js â€” boutique-mobile-money-client (payment, critical, full)
- public/boutique/js/b-share-cart.js â€” shared-list-creation-from-boutique (shared-cart, critical, full)
- public/boutique/js/b-store.js â€” boutique-shared-state (boutique, critical, full)
- public/boutique/js/boutique.js â€” boutique-ui-orchestrator (boutique, critical, full)
- public/boutique/js/group/group-checkout-adapter.js â€” shared-list-checkout-adapter (shared-cart, critical, full)
- public/boutique/js/group/group-side-cart.js â€” shared-list-canonical-cart-projection (shared-cart, critical, full)
- public/boutique/js/group/shared-cart-surface-api.js â€” shared-cart-surface-public-api (shared-cart, critical, full)
- routes/admin/delete-order-cascade.js â€” orders-delete-order-cascade (orders, critical, full)
- routes/admin/orders.js â€” orders-orders (orders, critical, full)
- routes/cash.js â€” payment-cash (payment, critical, full)
- routes/inventory-api.js â€” inventory-inventory-api (inventory, critical, full)
- routes/market-delegation-cash-control.js â€” market-cash-control-policy-api (market-delegation, critical, full)
- routes/market-delegation-structure-event.js â€” market-delegation-structure-event-api (market-delegation, critical, full)
- routes/order-api-v2.js â€” orders-order-api-v2 (orders, critical, full)
- routes/orders.js â€” orders-http-facade (orders, critical, full)
- routes/orders/cancel.js â€” orders-cancel (orders, critical, full)
- routes/orders/create.js â€” orders-create (orders, critical, full)
- routes/orders/detail.js â€” orders-detail (orders, critical, full)
- routes/orders/list.js â€” orders-list (orders, critical, full)
- routes/orders/parcels.js â€” orders-parcels (orders, critical, full)
- routes/orders/qr.js â€” orders-qr (orders, critical, full)
- routes/orders/status.js â€” orders-status (orders, critical, full)
- routes/payments-mobile-money.js â€” route-payment-mobile-money (payment, critical, full)
- routes/payments-paypal.js â€” route-payment-paypal (payment, critical, full)
- routes/payments.js â€” payment-http-facade (payment, critical, full)
- routes/pickup-pay-cash.js â€” payment-pickup-pay-cash (payment, critical, full)
- routes/shared-cart.js â€” shared-cart-http-facade (shared-cart, critical, full)
- server.js â€” api-server-entrypoint (bootstrap, critical, full)
- services/admin-order-refund.js â€” orders-admin-order-refund (orders, critical, full)
- services/cancel-order-purchase-orders.js â€” orders-cancel-order-purchase-orders-boundary (orders, critical, full)
- services/cart-share-service.js â€” shared-cart-orders-boundary (shared-cart, critical, full)
- services/cash-confirmation-control-service.js â€” cash-confirmation-control-service (payment, critical, full)
- services/cash-custody-service.js â€” payment-cash-custody-service (payment, critical, full)
- services/cash-operations.js â€” payment-cash-operations (payment, critical, full)
- services/cash-reminder-service.js â€” payment-cash-reminder-service (payment, critical, full)
- services/catalog-field-sync-application.js â€” catalog-field-sync-application (catalog, critical, full)
- services/catalog-field-sync-decision.js â€” catalog-field-sync-decision (catalog, critical, full)
- services/catalog-product-quality-service.js â€” catalog-product-quality-hold-service (catalog, critical, full)
- services/catalog-stock-sync-application.js â€” catalog-stock-sync-application (catalog, critical, full)
- services/catalog-stock-sync-decision.js â€” catalog-stock-sync-decision (catalog, critical, full)
- services/confirm-pickup-cash-payment.js â€” payment-confirm-pickup-cash-payment (payment, critical, full)
- services/dispute-mutation-service.js â€” orders-dispute-mutation-boundary (orders, critical, full)
- services/financial-journal-projectors.js â€” financial-journal-projectors (finance, critical, full)
- services/financial-journal-reporting.js â€” financial-journal-reporting (finance, critical, full)
- services/financial-journal.js â€” financial-journal (finance, critical, full)
- services/fx-authority.js â€” fx-authority (market, critical, full)
- services/fx-chain-service.js â€” fx-chain-service (market, critical, full)
- services/fx-observation-service.js â€” fx-observation-service (market, critical, full)
- services/fx-public-reference-feed.js â€” official-fx-reference-ingestion (market, critical, full)
- services/hub-authorization-service.js â€” hub-authorization-service (purchasing, critical, full)
- services/hub-bag-box-service.js â€” hub-bag-box (logistics, critical, full)
- services/hub-operations.js â€” hub-operations (logistics, critical, full)
- services/hub-physical-identity.js â€” hub-physical-identity (logistics, critical, full)
- services/inventory-service.js â€” inventory-inventory-service (inventory, critical, full)
- services/item-refund-psp-orchestrator.js â€” e7-sandbox-item-refund-orchestrator (refunds, critical, full)
- services/item-refund-reservation-service.js â€” item-refund-reservation (refunds, critical, full)
- services/local-cash-refund-handoff.js â€” fable-cash-refund-custody-handoff (refunds, critical, full)
- services/local-item-refund-reservation.js â€” verified-local-item-refund-reservation (refunds, critical, full)
- services/local-relay-receipt-service.js â€” logistics-local-relay-receipt (logistics, critical, full)
- services/market-cash-control-policy-service.js â€” market-cash-control-policy-service (market-delegation, critical, full)
- services/market-delegation-structure-event-service.js â€” market-delegation-structure-event-service (market-delegation, critical, full)
- services/market-delivery-proof-service.js â€” market-delivery-proof-service (market-control-plane, critical, full)
- services/market-local-price-activation-service.js â€” market-local-price-activation-orchestrator (market-autonomy, critical, full)
- services/market-local-price-resolution-service.js â€” market-active-local-price-buyer-boundary (market-autonomy, critical, full)
- services/market-local-price-state-transition.js â€” market-local-price-active-state-transition (market-autonomy, critical, full)
- services/market-payment-collection-gate.js â€” market-payment-collection-gate (payments, critical, full)
- services/market-transport-sale-rate-command.js â€” market-transport-sale-rate-command (logistics, critical, full)
- services/market-transport-sale-rates.js â€” market-transport-sale-rates (logistics, critical, full)
- services/market-transport-tariff-gate.js â€” market-transport-tariff-gate (logistics, critical, full)
- services/mobile-money/kartapay-km.js â€” mobile-money-provider-adapter (payment, critical, full)
- services/mobile-money/mtn-momo-cg.js â€” mobile-money-provider-adapter (payment, critical, full)
- services/mobile-money/orange-money-cm.js â€” mobile-money-provider-adapter (payment, critical, full)
- services/order-checkout-idempotency.js â€” order-checkout-idempotency (orders, critical, full)
- services/order-checkout-item-resolution.js â€” orders-checkout-item-resolution (orders, critical, full)
- services/order-checkout-persistence.js â€” orders-checkout-persistence (orders, critical, full)
- services/order-checkout-service.js â€” orders-checkout-orchestrator (orders, critical, full)
- services/order-cost-snapshot.js â€” orders-order-cost-snapshot (orders, critical, full)
- services/order-fx-snapshot.js â€” order-fx-snapshot (orders, critical, full)
- services/order-item-refund-settlement.js â€” order-item-verified-refund-projection (orders, critical, full)
- services/order-mutation-service.js â€” orders-cross-feature-mutation-boundary (orders, critical, full)
- services/order-payment-confirmation.js â€” payment-to-stock-single-entry (orders, critical, full)
- services/order-physical-coverage-service.js â€” order-physical-coverage-service (logistics, critical, full)
- services/order-status-machine.js â€” order-status-state-machine (orders, critical, full)
- services/outbox-producer.js â€” outbox-producer (infrastructure, critical, full)
- services/outbox-worker.js â€” outbox-worker (infrastructure, critical, full)
- services/parcel-item-mutation-service.js â€” logistics-parcel-item-mutation-service (logistics, critical, full)
- services/payment-cash-confirm.js â€” cash-payment-confirmation-service (payment, critical, full)
- services/payment-mobile-money.js â€” payment-mobile-money (payment, critical, full)
- services/payment-paypal-events.js â€” payment-payment-paypal-events (payment, critical, full)
- services/payment-paypal.js â€” payment-paypal (payment, critical, full)
- services/payment-service.js â€” orders-payment-status-mutation-boundary (orders, critical, full)
- services/payment-status-validator.js â€” payment-status-transition-validator (payment, critical, full)
- services/payment-stripe.js â€” stripe-payment-service (payment, critical, full)
- services/paypal-client.js â€” payment-paypal-client (payment, critical, full)
- services/paypal-refund-authority.js â€” durable-paypal-admin-refund-authority (refunds, critical, full)
- services/pickup-collection-recorder.js â€” pickup-collection-recorder (logistics, critical, full)
- services/pickup-secret-access-service.js â€” pickup-secret-access-service (logistics, critical, full)
- services/pickup-secret-issuer.js â€” pickup-secret-issuer (logistics, critical, full)
- services/pickup-secret-rotation-service.js â€” pickup-secret-partial-rotation (logistics, critical, full)
- services/product-stock-service.js â€” catalog-product-stock-service (catalog, critical, full)
- services/provider-credential-service.js â€” provider-credential-service (sourcing, critical, full)
- services/purchasing-cancel-service.js â€” purchasing-cancel-service (purchasing, critical, full)
- services/purchasing-completion-service.js â€” purchasing-order-completion-service (purchasing, critical, full)
- services/purchasing-engagement-service.js â€” purchasing-engagement-service (purchasing, critical, full)
- services/qr-collection-core.js â€” qr-collection-core (orders, critical, full)
- services/refund-evidence-verifier.js â€” external-refund-evidence-verifier (refunds, critical, full)
- services/refund-intent-ledger.js â€” durable-refund-intent-reservation (refunds, critical, full)
- services/refund-intent-reconciliation.js â€” durable-refund-evidence-reconciliation (refunds, critical, full)
- services/relay-product-return-intake-service.js â€” relay-product-return-intake-service (logistics, critical, full)
- services/relay-return-compensation-service.js â€” relay-return-compensation-service (orders, critical, full)
- services/relay-return-request-service.js â€” orders-product-return-request-service (orders, critical, full)
- services/repair-ordered-purchasing.js â€” orders-repair-ordered-purchasing (purchasing, critical, full)
- services/repair-ordered-without-purchase-orders.js â€” orders-repair-ordered-without-purchase-orders (purchasing, critical, full)
- services/sav-ledger-refund.js â€” sav-ledger-refund (refunds, critical, full)
- services/scan-write-service.js â€” logistics-scan-write-service (logistics, critical, full)
- services/shared-cart-creation.js â€” shared-cart-creation (shared-cart, critical, full)
- services/shared-cart-engine.js â€” shared-cart-state-machine (shared-cart, critical, full)
- services/shared-cart-internals.js â€” shared-cart-internals (shared-cart, critical, full)
- services/shared-cart-lifecycle.js â€” shared-cart-lifecycle (shared-cart, critical, full)
- services/shared-cart-reads.js â€” shared-cart-reads (shared-cart, critical, full)
- services/stripe-refund-authority.js â€” durable-stripe-business-refund-orchestrator (refunds, critical, full)
- services/suppliers/cj-supplier-payment-runtime.js â€” cj-supplier-payment-runtime (purchasing, critical, full)
- services/user-mutation-service.js â€” auth-identity-user-mutation-boundary (auth-identity, critical, full)
- utils/orderParcelLinkRules.js â€” orders-order-parcel-link-rules (orders, critical, full)
- bootstrap/feature-wiring.js â€” feature-boundary-composition-root (bootstrap, high, full)
- middleware/auth-guest.js â€” auth-auth-guest (auth, high, full)
- middleware/auth.js â€” auth-auth (auth, high, full)
- middleware/csrf-origin.js â€” auth-csrf-origin-guard (auth, high, full)
- middleware/deny-transitaire-hub.js â€” deny-transitaire-hub-scope (market-delegation, higm«ëŒ+Š×®º+º$zzb¥æ‚ÂgVÆÂ¢ÒÖ–FFÆWv&Rö–çFW&æÂ×7FF–2ÖwV&Bæ§2(	B–çFW&æÂ×7FF–2×F‚ÖwV&B‡ÆFf÷&ÒÖ÷2Â†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&V6WGFRÖ—6öÆF–öâÖwV&Bæ§2(	B—6öÆFVB×&V6WGFR×w&—FRÖf—&WvÆÂ†–æg&7G'V7GW&RÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖ6FÆörÖvÆö&ÂÖWF†÷&—G’æ§2(	B6FÆörÖvÆö&ÂÖWF†÷&—¦F–öâÖwV&B†6FÆörÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖF6†&ö&BÖvÆö&ÂÖWF†÷&—G’æ§2(	BF6†&ö&BÖvÆö&ÂÖWF†÷&—¦F–öâÖwV&B†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖFV6—6–öâ×6–væÂÖvÆö&ÂÖWF†÷&—G’æ§2(	BFV6—6–öâ×6–væÂÖvÆö&ÂÖWF†÷&—¦F–öâÖwV&B†FV6—6–öâ×6–væÇ2Â†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖÖ&¶WBÖFVÆVvFVBÖ6&–Æ—G’æ§2(	BÖ&¶WBÖFVÆVvFVBÖ6&–Æ—G’Ö'&–FvR†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖÖ&¶WBÖFVÆVvFVB×&öÆRæ§2(	BÖ&¶WBÖFVÆVvF–öâ×'VçF–ÖR×&öÆRÖ'&–FvR†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖÖ&¶WBÖW†V7WF–öâÖ6&–Æ—G’æ§2(	BÖ&¶WBÖW†V7WF–öâÖ6&–Æ—G’Ö'&–FvR†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖÖ&¶WB×66÷Ræ§2(	BÖ&¶WB×66÷RÖWF†÷&—¦F–öâÖwV&B†Ö&¶WBÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&RÖæöâ×&öGV7F–öâæ§2(	B'VçF–ÖRÖVçf—&öæÖVçBÖwV&B†–æg&7G'V7GW&RÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&R×&–6–ærÖvÆö&ÂÖWF†÷&—G’æ§2(	B&–6–ærÖvÆö&ÂÖWF†÷&—¦F–öâÖwV&B†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&R×&V6VçBÖWF‚æ§2(	BWF‚×&V6VçB×&ööbÖwV&B†WF‚Â†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷&WV—&R×6÷W&6–ærÖvÆö&ÂÖWF†÷&—G’æ§2(	B6÷W&6–ærÖvÆö&ÂÖWF†÷&—¦F–öâÖwV&B‡6÷W&6–ærÂ†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷6ögBÖWF‚æ§2(	BWF‚×6ögBÖWF‚†WF‚Â†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷WÆöBÖ‡V"æ§2(	BÖ–FFÆWv&R×WÆöBÖ‡V"†Æöv—7F–72Â†–v‚ÂgVÆÂ¢ÒÖ–FFÆWv&R÷fW&–g’ÖWF†¶W’×vV&†öö²æ§2(	BWF‚×fW&–g’ÖWF†¶W’×vV&†öö²†WF‚Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö6'B×7FWW"ÖwV&Bæ§2(	B&÷WF—VRÖ6'B×7FWW"ÖWfVçBÖwV&B†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö6FÆörÖFW6·F÷ÖVæ†æ6W'2æ§2(	BFW6·F÷Ö6FÆörÖVæ†æ6W"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2(	B&÷WF—VRÖ6FÆör×&VæFW&W"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö6†V6¶÷WB×&VæFW"æ§2(	B6†V6¶÷WBÖFöÒ×&VæFW&W"†6†V6¶÷WBÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö–FVçF—G’æ§2(	B&÷WF—VRÖ6Æ–VçBÖ–FVçF—G’†WF‚Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ'W–&÷‚×6†&VBæ§2(	B&öGV7BÖÖöFÂÖ'W–&÷‚×6†&VBÖÆöv–2†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2(	B&öGV7BÖÖöFÂÖ÷&6†W7G&F÷"‡6†&VBÖ6'BÖÖöFÂÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖFW6·F÷×&öGV7Bæ§2(	BFW6·F÷×&öGV7BÖÖöFÂ×&VæFW&W"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖÖö&–ÆR×&öGV7Bæ§2(	BÖö&–ÆR×&öGV7BÖÖöFÂ×&VæFW&W"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×&öGV7BÖFWF–ÂÖ&ö÷G7G&æ§2(	B&öGV7BÖFWF–ÂÖÖöFÂÖ÷&6†W7G&F÷"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×&öGV7BÖf–VÆG2æ§2(	BÖöFÂ×&öGV7B×66Æ"Öf–VÆG2Ö÷væW"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×&öGV7Bæ§2(	B&öGV7BÖÖöFÂÖ6öçFVçB×&VæFW&W"‡6†&VBÖ6'BÖÖöFÂÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×7VvvW7F–öç2æ§2(	B&öGV7BÖÖöFÂ×7VvvW7F–öç2‡&V6öÖÖVæFF–öç2Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Öæbæ§2(	B&÷WF—VRÖæb†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"Öæ÷F–f–6F–öç2æ§2(	B6Æ–VçBÖæ÷F–f–6F–öâÖ&ææW"†æ÷F–f–6F–öâÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×vW"æ§2(	BÖö&–ÆRÖ6FVv÷'’×vW"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×76¶W’ÖVç&öÆÆÖVçBæ§2(	B&÷WF—VR×76¶W’ÖVç&öÆÆÖVçB†WF‚×76¶W’Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×76¶W’ÖÆöv–âæ§2(	B&÷WF—VR×76¶W’ÖÆöv–â†WF‚×76¶W’Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×76¶W’×6V7W&—G’æ§2(	B&÷WF—VR×76¶W’×6V7W&—G’†WF‚×76¶W’Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×76¶W’×7FW×Wæ§2(	B&÷WF—VR×76¶W’×7FW×W†WF‚×76¶W’Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×†öæRæ§2(	B†öæRÖæ÷&ÖÆ—¦F–öâ×V’†WF‚Â†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×67&öÆÂÖ÷væW"æ§2(	B&÷WF—VR×67&öÆÂÖ÷væW"†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×7V&6Bæ§2(	B&÷WF—VR×7V&6FVv÷'’Öæf–vF–öâ†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×G&6¶–æræ§2(	B÷&FW"×G&6¶–ær×f–Wr‡G&6¶–ærÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×WF–Ç2æ§2(	B&÷WF—VR×V’×WF–Æ—F–W2†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö6'B×V&Æ–2Ö’æ§2(	B÷&FW'2Ö6'B×V&Æ–2Ö’†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö6öçG&öÆÆW'2ö†öÖRÖ6öçG&öÆÆW"æ§2(	B&÷WF—VRÖ†öÖRÖæf–vF–öâÖ6öçG&öÆÆW"†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2öw&÷Wöw&÷WÖ’æ§2(	B6†&VBÖ6'BÖg&öçBÖ’‡6†&VBÖ6'BÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2öw&÷Wöw&÷WÖÆ–'&'’×&VÖ÷fRæ§2(	B6†&VBÖ6'BÖÆ–'&'’×&VÖ÷fÂ×V’‡6†&VBÖ6'BÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2öw&÷Wöw&÷WÖÆ—7BÖÆ&VÇ2æ§2(	B6†&VBÖÆ—7BÖF—7Æ’ÖÆ&VÇ2‡6†&VBÖ6'BÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2öw&÷W÷6†&VBÖ6'BÖÆ–'&'’Ö’æ§2(	B6†&VBÖ6'BÖÆ–'&'’×V&Æ–2Ö’‡6†&VBÖ6'BÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö¶öÖW&6RÖ’æ§2(	B&÷WF—VRÖ’Ö6Æ–VçB†&÷WF—VRÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2÷&öGV7B×7F÷&Ræ§2(	B&÷WF—VR×&öGV7B×7F÷&R†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2÷6†÷×66†VÖæ§2(	B&÷WF—VR×F†öæö×’×66†VÖ†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2÷f–WrÖÖöFVÇ2öÖöFÂÖ6'B×&öGV7BÖÖöFVÂæ§2(	BÖöFÂÖ6'B×&öGV7B×6æ6†÷BÖÖöFVÂ†6FÆörÂ†–v‚ÂgVÆÂ¢ÒV&Æ–2ö&÷WF—VRö§2÷f–WrÖÖöFVÇ2öÖöFÂ×6VÆV7F–öâÖÖöFVÂæ§2(	B&öGV7BÖÖöFÂ×6VÆV7F–öâÖÖöFVÂ†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ7F–öâÖ6VçFW"æ§2(	B6æöæ–6ÂÖ7F–öâÖ6VçFW"×&÷WFR†FV6—6–öâ×6–væÇ2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ&÷WF—VRÖ6FVv÷&–W2æ§2(	B&÷WF—VR×F†öæö×’ÖFÖ–âÖ’†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ6FÆör×v÷&·76Ræ§2(	B6æöæ–6ÂÖ6FÆör×v÷&·76R×&÷WFR†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ6Æ–VçBÓ3cæ§2(	B6æöæ–6ÂÖ6Æ–VçBÓ3c×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ6Æ–VçBÖ–æFW‚æ§2(	B6æöæ–6ÂÖ6Æ–VçBÖ–æFW‚×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§2(	BV6öæöÖ–2ÖVæv–æRÖFÖ–âÖ6÷7BÖ6ö×öæVçG2†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ6÷7F–æræ§2(	BV6öæöÖ–2ÖVæv–æRÖFÖ–âÖ6÷7F–ær†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ7W7Fö×2Ö6FVv÷&–W2æ§2(	BF6†&ö&BÖFÖ–âÖ7W7Fö×2Ö6FVv÷&–W2†7W7Fö×2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ7W7Fö×2×6†—ÖVçG2æ§2(	BF6†&ö&BÖFÖ–âÖ7W7Fö×2×6†—ÖVçG2†7W7Fö×2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖF6†&ö&BÖWfVçG2æ§2(	BF6†&ö&B×÷7BÖ6öÖÖ—BÖWfVçB×7G&VÒ†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖF6†&ö&BÖÖ&¶WBæ§2(	BF6†&ö&BÖÖ&¶WB×66÷VB×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖF6†&ö&Bæ§2(	BF6†&ö&BÖFÖ–âÖF6†&ö&B†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖf–ææ6RÖ66÷VçF–ær×v÷&·76Ræ§2(	B6æöæ–6ÂÖf–ææ6RÖ66÷VçF–ær×v÷&·76R×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§2(	BV6öæöÖ–2ÖVæv–æRÖFÖ–âÖf–ææ6RÖ6öæf–r†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§2(	BÆ÷–ÇG’ÖFÖ–â×&Wv&G2†Æ÷–ÇG’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖÖ&¶WB×–ÖVçBÖ66÷VçG2æ§2(	BFÖ–âÖÖ&¶WB×–ÖVçBÖ66÷VçG2Ö’‡–ÖVçBÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖÖ&¶WB×6WGFÆVÖVçBæ§2(	BFÖ–âÖÖ&¶WB×6WGFÆVÖVçBÖ’‡6WGFÆVÖVçBÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§2(	B6æöæ–6ÂÖ÷W&F–öç2×v÷&·76R×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âÖ÷&FW"Ó3cæ§2(	B6æöæ–6ÂÖ÷&FW"Ó3c×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§2(	BV6öæöÖ–2ÖVæv–æRÖFÖ–â×&–6–ærÖ6ö×öæVçG2†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&–6–ærÖÖG&–6W2æ§2(	BV6öæöÖ–2ÖVæv–æRÖFÖ–â×&–6–ærÖÖG&–6W2†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§2(	B6æöæ–6Â×&–6–ær×v÷&·76R×&÷WFR†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&öGV7BÓ3cæ§2(	B6æöæ–6Â×&öGV7BÓ3c×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&÷f–FW'2Ö6&–Æ—F–W2æ§2(	B6æöæ–6Â×&÷f–FW'2Ö6&–Æ—F–W2×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&F"æ§2(	BF6†&ö&BÖFÖ–â×&F"†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§2(	BF6†&ö&BÖFÖ–â×&—6²×&÷f—6–öç2†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×'VÆW2æ§2(	B'W6–æW72×'VÆW2ÖFÖ–â×'VÆW2†'W6–æW72×'VÆW2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§2(	B6æöæ–6Â×6†—–ærÖ7W7Fö×2×v÷&·76R×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§2(	B6æöæ–6Â×6÷W&6–ær×v÷&·76RÖ’‡6÷W&6–ærÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â×7WÆ–W"Ó3cæ§2(	B6æöæ–6Â×7WÆ–W"Ó3c×&÷WFR†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âæ§2(	BF6†&ö&BÖFÖ–â†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âö6FÆörÖ&÷fÂæ§2(	B6FÆörÖ&÷fÂ×&÷WFW2†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âö7W7Fö×2æ§2(	BF6†&ö&BÖ7W7Fö×2†7W7Fö×2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âöF6†&ö&Bæ§2(	BF6†&ö&BÖF6†&ö&B†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–âö–æFW‚æ§2(	BF6†&ö&BÖ–æFW‚†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â÷'FæW'2æ§2(	BF6†&ö&B×'FæW'2†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â÷7—7FVÒæ§2(	BF6†&ö&B×7—7FVÒ†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFÖ–â÷W6W'2æ§2(	BF6†&ö&B×W6W'2†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2övVçBÖ7F–öâÖ6VçFW"æ§2(	BvVçBÖ7F–öâÖ6VçFW"×&÷WFW2†FV6—6–öâ×6–væÇ2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öWF‚×76¶W’æ§2(	BWF‚×76¶W’ÖVæGö–çG2†WF‚×76¶W’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öWF‚×7FW×WÖ÷Gæ§2(	BWF‚×7FW×WÖ÷GÖVæGö–çG2†WF‚Ö–FVçF—G’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öWF‚æ§2(	BWF‚ÖWF‚†WF‚Ö–FVçF—G’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2ö&÷WF—VR×7VvvW7F–öç2æ§2(	B&÷WF—VR×7VvvW7F–öç2Ö‡GGÖf6FR‡&V6öÖÖVæFF–öç2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2ö6FÆör×&öGV7BÖFWF–Âæ§2(	B6FÆör×&öGV7BÖFWF–ÂÖ‡GG†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2ö6Æ–VçBÖWF‚æ§2(	BWF‚Ö6Æ–VçBÖWF‚†WF‚Ö–FVçF—G’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2ö6Æ–VçBÖæ÷F–f–6F–öç2æ§2(	BWF†VçF–6FVBÖ6Æ–VçBÖæ÷F–f–6F–öç2†æ÷F–f–6F–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2ö6Æ–VçB×G&6¶–æræ§2(	BÆöv—7F–72Ö6Æ–VçB×G&6¶–ær†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&BÖ6Æ–VçG2æ§2(	BF6†&ö&BÖF6†&ö&BÖ6Æ–VçG2†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&BÖf–ææ6Ræ§2(	BV6öæöÖ–2ÖVæv–æRÖF6†&ö&BÖf–ææ6R†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&BÖ‡V"æ§2(	BF6†&ö&BÖF6†&ö&BÖ‡V"†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&BÖ÷2æ§2(	BF6†&ö&BÖF6†&ö&BÖ÷2†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&B×6†&VBæ§2(	BF6†&ö&BÖF6†&ö&B×6†&VB†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öF6†&ö&Bæ§2(	BF6†&ö&BÖF6†&ö&B†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öFö7VÖVçG2æ§2(	BWF†VçF–6FVBÖ6Æ–VçBÖFö7VÖVçG2†Fö7VÖVçG2Â†–v‚ÂgVÆÂ¢Ò&÷WFW2öV6öæöÖ–2æ§2(	BV6öæöÖ–2×&÷WFW"†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öf–ææ6Ræ§2(	BV6öæöÖ–2ÖVæv–æRÖf–ææ6R†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2ö‡V"ÖF6†&ö&Bæ§2(	BF6†&ö&BÖ‡V"ÖF6†&ö&B†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2ö–çFVw&F–öç2ÖÆ–W‡&W72æ§2(	BÆ–W‡&W72ÖöWF‚Ö–çFVw&F–öâ×&÷WFR†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6FÆöræ§2(	BÖ&¶WBÖFVÆVvF–öâÖ6FÆörÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6Æ–VçBÖ66Ræ§2(	BÖ&¶WBÖFVÆVvF–öâÖ6Æ–VçBÖ66RÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6Æ–VçBæ§2(	BÖ&¶WBÖFVÆVvF–öâÖ6Æ–VçBÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6÷7B×7FFVÖVçBæ§2(	BÖ&¶WBÖFVÆVvF–öâÖ6÷7B×7FFVÖVçBÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ7W7Fö×2æ§2(	BÖ&¶WBÖFVÆVvF–öâÖ7W7Fö×2Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"æ§2(	BÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§2(	BÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×–ÖVçBÖ66÷VçG2æ§2(	BÖ&¶WBÖFVÆVvF–öâ×–ÖVçBÖ66÷VçG2Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×W&f÷&Öæ6Ræ§2(	BÖ&¶WBÖFVÆVvF–öâ×W&f÷&Öæ6RÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§2(	BÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×6WGFÆVÖVçBæ§2(	BÖ&¶WBÖFVÆVvF–öâ×6WGFÆVÖVçBÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§2(	BÖ&¶WBÖFVÆVvF–öâ×FVÒÖ’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2öÖ&¶WBÖÆö6Â×7Fö6²æ§2(	BÖ&¶WBÖÆö6Â×7Fö6²Ö’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2ö÷Gæ§2(	B6Æ–VçBÖ÷G×6W76–öâ†WF‚Ö–FVçF—G’Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖ’×c"æ§2(	BÆöv—7F–72×&6VÂÖ’×c"†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖ’×c"ö†VÇW'2æ§2(	BÆöv—7F–72Ö†VÇW'2†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖ’×c"ö–æFW‚æ§2(	BÆöv—7F–72Ö–æFW‚†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖ’×c"÷&VBæ§2(	BÆöv—7F–72×&VB†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖ’×c"÷66ç2æ§2(	BÆöv—7F–72×66ç2†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÂÖÆ&VÂæ§2(	BÆöv—7F–72×&6VÂÖÆ&VÂ†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&6VÇ2æ§2(	BÆöv—7F–72×&6VÇ2†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&–6–ær×7G&FVw’æ§2(	BV6öæöÖ–2ÖVæv–æR×&–6–ær×7G&FVw’†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&–6–æræ§2(	BV6öæöÖ–2ÖVæv–æR×&–6–ær†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&öGV7G2æ§2(	B&öGV7G2Ö‡GGÖf6FR†6FÆörÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§2(	BF6†&ö&B×&VÆ’ÖF6†&ö&B†F6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2÷6†&VBÖ6'B×6fVBæ§2(	B6†&VBÖ6'B×6fVBÖ66W72Ö‡GG‡6†&VBÖ6'BÂ†–v‚ÂgVÆÂ¢Ò&÷WFW2÷G&6¶–æræ§2(	BÆöv—7F–72×G&6¶–ær†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§2(	BÆöv—7F–72×G&ç6—BÖF6†&ö&B†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò&÷WFW2÷vÆÆWBæ§2(	BvÆÆWBÖ‡GGÖf6FR‡vÆÆWBÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö7F–öâÖ6VçFW"ÖvVçB×66÷Ræ§2(	B7F–öâÖ6VçFW"ÖvVçB×66÷R×6W'f–6R†FV6—6–öâ×6–væÇ2Â†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö7F–öâÖ6VçFW"×v÷&·76Ræ§2(	B6æöæ–6ÂÖ7F–öâÖ6VçFW"×v÷&·76R×6W'f–6R†FV6—6–öâ×6–væÇ2Â†–v‚ÂgVÆÂ¢Ò6W'f–6W2öÇ’×&–6–ær×WFFW2æ§2(	BV6öæöÖ–2ÖVæv–æRÖÇ’×&–6–ær×WFFW2†V6öæöÖ–2ÖVæv–æRÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2öWF†¶W’Ö6Æ–VçBæ§2(	BWF†¶W’×v†G6ÖFFW"†æ÷F–f–6F–öâÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2öWFò×&6VÂæ§2(	BÆöv—7F–72ÖWFò×&6VÂ†Æöv—7F–72Â†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö&÷WF—VR×F†öæö×’ÖFÖ–âæ§2(	B&÷WF—VR×F†öæö×’ÖFÖ–â×6W'f–6R†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6æöæ–6Â×&VfW&Væ6R×&W6öÇfW"æ§2(	B6æöæ–6Â×&VfW&Væ6R×&W6öÇfW"†FÖ–âÖF6†&ö&BÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6&–Æ—G’×&Vv—7G'’æ§2(	BÖ&¶WBÖFVÆVvF–öâÖ6&–Æ—G’×&Vv—7G'’†Ö&¶WBÖFVÆVvF–öâÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö66‚ÖFW÷6—B×6W'f–6Ræ§2(	B–ÖVçBÖ66‚ÖFW÷6—B×6W'f–6R‡–ÖVçBÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö66‚Ö÷&FW"×&÷fVææ6R×&VFöæÇ’æ§2(	B–ÖVçBÖ66‚Ö÷&FW"×&÷fVææ6R×&VFW"‡–ÖVçBÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ&÷fÂæ§2(	B6FÆörÖ&÷fÂ×VWVR†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ6æF–FFR×&öGV7B×6W'f–6Ræ§2(	B6FÆörÖ6æF–FFR×&öGV7BÖ÷væW"†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ6W'F–f–6F–öâÖvFRÖ"æ§2(	B6FÆörÖ6W'F–f–6F–öâÖvFRÖ"†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ6W'F–f–6F–öâæ§2(	B6FÆörÖ6W'F–f–6F–öâ†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ6†ævRÖ–çF¶Ræ§2(	B6FÆörÖ6†ævRÖ–çF¶RÖ6öçG&7B†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖ6öÖÖW&6–ÂÖ76÷'FÖVçBæ§2(	B6FÆörÖ6öÖÖW&6–ÂÖ76÷'FÖVçB×&ö¦V7F–öâ†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖVÆ–v–&–Æ—G’æ§2(	B6FÆörÖVÆ–v–&–Æ—G’†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖVç&–6†ÖVçBæ§2(	B6FÆörÖVç&–6†ÖVçB†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖg"×VÆ—G’æ§2(	B6FÆörÖg&Væ6‚×VÆ—G’Ö6öçG&7B†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖÖ&¶WBÖW‡÷7W&R×6W'f–6Ræ§2(	B6FÆörÖÖ&¶WBÖW‡÷7W&R×6W'f–6R†6FÆörÂ†–v‚ÂgVÆÂ¢Ò6W'f–6W2ö6FÆörÖÖVF–×&V6÷fW'’æ§2(	BW‡Æ–6—FÇ’ÖWF†÷&—¦VBÖ6æöæ–6ÂÖÖVF–×&V6÷fW'’†6FÆörÂ†–v†Ú±î¸Â¸­yêë¢°k¢G§¦*^, full)
- services/catalog-overrides.js â€” catalog-field-overrides (catalog, high, full)
- services/catalog-product-detail.js â€” catalog-product-detail-contract (catalog, high, full)
- services/catalog-product-mutation-service.js â€” catalog-product-mutation-service (catalog, high, full)
- services/catalog-product-read-cutover-trial.js â€” catalog-product-read-cutover-trial (sourcing, high, full)
- services/catalog-product-route-canary.js â€” catalog-product-route-canary-compatibility (catalog, high, full)
- services/catalog-product-source-read-service.js â€” catalog-product-source-read-authority (catalog, high, full)
- services/catalog-promotion.js â€” catalog-promotion-orchestrator (catalog, high, full)
- services/catalog-promotion/axes.js â€” catalog-promotion-axes-mapping (catalog, high, full)
- services/catalog-promotion/content.js â€” catalog-promotion-content-mapping (catalog, high, full)
- services/catalog-promotion/editorial-identity.js â€” catalog-draft-editorial-identity (catalog, high, full)
- services/catalog-promotion/sku-media.js â€” catalog-promotion-sku-media-linking (catalog, high, full)
- services/catalog-promotion/sku.js â€” catalog-promotion-sku-reconciliation (catalog, high, full)
- services/catalog-public-view.js â€” catalog-public-view (catalog, high, full)
- services/catalog-publication-decision-audit.js â€” catalog-publication-decision-audit (catalog, high, full)
- services/catalog-registry.js â€” catalog-global-registry-read (catalog, high, full)
- services/catalog-taxonomy-audit.js â€” catalog-taxonomy-audit-boundary (catalog, high, full)
- services/catalog-unified-registry.js â€” unified-catalog-operator-read (catalog, high, full)
- services/catalog-workspace.js â€” canonical-catalog-workspace-service (catalog, high, full)
- services/central-authority.js â€” central-authority-single-lookup (market-control-plane, high, full)
- services/client-360.js â€” canonical-client-360-service (admin-dashboard, high, full)
- services/client-index.js â€” canonical-client-index-service (admin-dashboard, high, full)
- services/client-notification-service.js â€” client-notification-service (notification, high, full)
- services/cost-allocation/allocate.js â€” economic-engine-cost-allocation-allocate (economic-engine, high, full)
- services/cost-allocation/canonical-margin-writer.js â€” economic-engine-canonical-margin-writer (economic-engine, high, full)
- services/cost-allocation/cost-expectation.js â€” economic-engine-cost-expectation (economic-engine, high, full)
- services/cost-allocation/cost-types.js â€” economic-engine-cost-type-classification (economic-engine, high, full)
- services/cost-allocation/index.js â€” economic-engine-cost-allocation (economic-engine, high, full)
- services/cost-allocation/manual-cost-entry-service.js â€” manual-cost-entry (economic-engine, high, full)
- services/cost-component-admin-service.js â€” economic-engine-cost-component-admin-service (economic-engine, high, full)
- services/cost-component-market-service.js â€” economic-engine-market-cost-component-service (economic-engine, high, full)
- services/credential-action-store.js â€” credential-action-token-persistence (auth-identity, high, full)
- services/credential-invitation-email.js â€” credential-invitation-delivery (auth-identity, high, full)
- services/credential-link-token.js â€” credential-link-crypto (auth-identity, high, full)
- services/customer-handoff-reconciliation.js â€” customer-handoff-reconciliation (logistics, high, full)
- services/customs-classification.js â€” customs-classification (customs, high, full)
- services/customs-dynamic-category-classifier.js â€” customs-dynamic-category-classifier (customs, high, full)
- services/customs-shipment-fee-service.js â€” customs-shipment-fee-service (customs, high, full)
- services/dashboard-admin-context.js â€” canonical-admin-context-resolver (admin-dashboard, high, full)
- services/dashboard-cache.js â€” dashboard-dashboard-cache (dashboard, high, full)
- services/dashboard-clients-queries.js â€” dashboard-dashboard-clients-queries (dashboard, high, full)
- services/dashboard-commerce.js â€” canonical-commerce-dashboard-service (admin-dashboard, high, full)
- services/dashboard-finance-canonical.js â€” canonical-finance-dashboard-service (admin-dashboard, high, full)
- services/dashboard-finance-metrics.js â€” economic-engine-dashboard-finance-metrics (economic-engine, high, full)
- services/dashboard-invalidation-bus.js â€” dashboard-post-commit-invalidation-bus (dashboard, high, full)
- services/dashboard-metrics/_helpers.js â€” dashboard-metrics-helpers (dashboard, high, full)
- services/dashboard-metrics/control-tower.js â€” dashboard-metrics-control-tower (dashboard, high, full)
- services/dashboard-metrics/costing.js â€” dashboard-metrics-costing (dashboard, high, full)
- services/dashboard-metrics/index.js â€” dashboard-dashboard-metrics (dashboard, high, full)
- services/dashboard-metrics/logistics.js â€” dashboard-metrics-logistics (dashboard, high, full)
- services/dashboard-metrics/market-currency.js â€” dashboard-market-currency-projection (dashboard, high, full)
- services/dashboard-operations.js â€” canonical-operations-dashboard-service (admin-dashboard, high, full)
- services/dashboard-ops-queries.js â€” dashboard-dashboard-ops-queries (dashboard, high, full)
- services/dashboard-orders.js â€” dashboard-orders-service (admin-dashboard, high, full)
- services/dashboard-pilotage-market.js â€” dashboard-pilotage-market-aggregate (admin-dashboard, high, full)
- services/documents/customs-invoice.js â€” customs-invoice (documents, high, full)
- services/documents/pdf-renderer.js â€” private-document-pdf-renderer (documents, high, full)
- services/economic-config.js â€” economic-config-canonical-bridge (economic-engine, high, full)
- services/economic-engine-queries.js â€” economic-engine-calculation-service (economic-engine, high, full)
- services/economic-price-audit-service.js â€” economic-engine-product-price-audit (economic-engine, high, full)
- services/external-provider-onboarding-contracts.js â€” external-provider-onboarding-contracts (external-provider-contracts, high, full)
- services/finance-accounting-workspace.js â€” canonical-finance-accounting-workspace-service (admin-dashboard, high, full)
- services/finance-metrics/annulations.js â€” economic-engine-annulations-parcels (economic-engine, high, full)
- services/finance-metrics/customs-unknown.js â€” economic-engine-customs-unknown-predicate (economic-engine, high, full)
- services/finance-metrics/finance-summary.js â€” economic-engine-finance-summary (economic-engine, high, full)
- services/finance-metrics/index.js â€” economic-engine-dashboard-finance-metrics (economic-engine, high, full)
- services/finance-metrics/payments.js â€” economic-engine-payments-detail (economic-engine, high, full)
- services/finance-metrics/sales-analysis.js â€” economic-engine-sales-analysis (economic-engine, high, full)
- services/fx-engine-rates.js â€” fx-engine-rates (market, high, full)
- services/hub-administration-board.js â€” hub-administration-board-reader (purchasing, high, full)
- services/hub-box-shipment-service.js â€” hub-box-shipment (logistics, high, full)
- services/hub-dashboard-queries.js â€” dashboard-hub-dashboard-queries (dashboard, high, full)
- services/hub-inbound-reconciliation.js â€” hub-inbound-reconciliation (logistics, high, full)
- services/hub-physical-codes.js â€” hub-physical-codes (logistics, high, full)
- services/hub-procurement-dossier.js â€” hub-procurement-dossier (logistics, high, full)
- services/hub-receive-idempotency.js â€” hub-receive-idempotency (logistics, high, full)
- services/hub-reference.js â€” hub-reference (logistics, high, full)
- services/import-lot-registry.js â€” import-lot-registry-projection (admin-dashboard, high, full)
- services/import-runtime-runs.js â€” import-runtime-run-projection (sourcing, high, full)
- services/incident-escalation.js â€” incident-sla-escalation (incident-management, high, full)
- services/incident-governance.js â€” incident-management-governance-mapping (incident-management, high, full)
- services/incident-write-service.js â€” incident-management-write-boundary (incident-management, high, full)
- services/international-n1-reconciliation.js â€” international-shipment-costs-owner (economic-engine, high, full)
- services/international-shipment-journey.js â€” international-shipment-journey-owner (logistics, high, full)
- services/local-mobile-refund-handoff.js â€” verified-manual-mobile-refund-handoff (refunds, high, full)
- services/local-stock-checkout-preview.js â€” local-stock-checkout-preview (local-stock, high, full)
- services/local-stock-decision-projection.js â€” local-stock-decision-projection (local-stock, high, full)
- services/local-stock-service.js â€” local-stock-local-stock-service (local-stock, high, full)
- services/logistics-control-chain-projection.js â€” logistics-control-chain-projection (admin-dashboard, high, full)
- services/manual-scan-confirmation.js â€” manual-scan-confirmation (dashboard, high, full)
- services/market-business-day.js â€” market-business-day-authority (admin-dashboard, high, full)
- services/market-commercial-price-service.js â€” market-commercial-price-decision-owner (market-autonomy, high, full)
- services/market-cost-attribution-service.js â€” economic-engine-market-cost-attribution (economic-engine, high, full)
- services/market-delegation-catalog-service.js â€” market-delegation-catalog-service (market-delegation, high, full)
- services/market-delegation-client-case-service.js â€” market-delegation-client-case-service (market-delegation, high, full)
- services/market-delegation-cost-statement-service.js â€” market-delegation-cost-statement-service (market-delegation, high, full)
- services/market-delegation-customs-service.js â€” market-delegation-customs-service (market-delegation, high, full)
- services/market-delegation-local-offer-service.js â€” market-delegation-local-offer-service (market-delegation, high, full)
- services/market-delegation-local-stock-service.js â€” market-delegation-local-stock-service (market-delegation, high, full)
- services/market-delegation-network-service.js â€” market-delegation-network-service (market-delegation, high, full)
- services/market-delegation-performance-service.js â€” market-delegation-performance-service (market-delegation, high, full)
- services/market-delegation-provider-service.js â€” market-delegation-provider-service (market-delegation, high, full)
- services/market-delegation-service.js â€” market-delegation-write-service (market-delegation, high, full)
- services/market-delegation-settlement-service.js â€” market-delegation-settlement-orchestration (market-delegation, high, full)
- services/market-delegation-team-service.js â€” market-delegation-team-service (market-delegation, high, full)
- services/market-lifecycle-service.js â€” market-lifecycle-writer (market, high, full)
- services/market-operation-guard.js â€” market-operation-guard (markets, high, full)
- services/market-operator-provisioning.js â€” market-operator-provisioning (market-delegation, high, full)
- services/market-payment-account-service.js â€” market-payment-account-owner (payment, high, full)
- services/market-payment-provider-config-service.js â€” market-payment-provider-config-writer (payment, high, full)
- services/market-provisioning-service.js â€” market-provisioning-orchestrator (market-control-plane, high, full)
- services/market-ready-to-sell-projection.js â€” market-ready-to-sell-projection (market-delegation, high, full)
- services/market-scope-admin-service.js â€” market-operator-scope-admin-boundary (market, high, full)
- services/market-scope-projector.js â€” market-delegation-scope-projector (market-delegation, high, full)
- services/market-settlement-service.js â€” market-settlement-lifecycle-owner (settlement, high, full)
- services/mobile-money-reconciliation.js â€” mobile-money-reconciliation (payment, high, full)
- services/mobile-money/registry.js â€” mobile-money-provider-registry (payment, high, full)
- services/notification-service.js â€” customer-notification-orchestrator (notification, high, full)
- services/notifications/internals.js â€” notification-internals (notification, high, full)
- services/notifications/notification-service.js â€” customer-notification-orchestrator (notification, high, full)
- services/notifications/order.js â€” notification-order (notification, high, full)
- services/notifications/otp-auth.js â€” notification-otp-auth (notification, high, full)
- services/notifications/parcel.js â€” notification-parcel (notification, high, full)
- services/operations-relay-projection.js â€” dashboard-operations-relay-projection (admin-dashboard, high, full)
- services/operations-workspace.js â€” canonical-operations-workspace-service (admin-dashboard, high, full)
- services/order-360.js â€” canonical-order-360-service (admin-dashboard, high, full)
- services/order-financial-closure-reconciliation.js â€” order-financial-closure-reconciliation (orders, high, full)
- services/order-item-availability-service.js â€” orders-order-item-availability (orders, high, full)
- services/order-service.js â€” order-domain-helpers (orders, high, full)
- services/otp-test-mode.js â€” auth-otp-test-mode (auth-identity, high, full)
- services/parcel-auto-create-service.js â€” logistics-parcel-auto-create-service (logistics, high, full)
- services/parcel-guards.js â€” logistics-parcel-guards (logistics, high, full)
- services/parcel-mutation-service.js â€” logistics-parcel-mutation-boundary (logistics, high, full)
- services/parcel-operations.js â€” logistics-parcel-operations (logistics, high, full)
- services/parcel-order-membership.js â€” logistics-parcel-order-membership (logistics, high, full)
- services/parcel-security.js â€” logistics-parcel-security (logistics, high, full)
- services/parcel-service.js â€” logistics-parcel-service (logistics, high, full)
- services/parcel-shipment-handover.js â€” international-handover-customer-parcel-status (logistics, high, full)
- services/parcel-transition-guard.js â€” incident-management-transition-guard (incident-management, high, full)
- services/parcelOptimizationService.js â€” logistics-parcel-optimization-service (logistics, high, full)
- services/partner-admin-service.js â€” partner-admin-service (dashboard, high, full)
- services/pickup-agent-lockout.js â€” pickup-agent-lockout (logistics, high, full)
- services/pickup-authorization-service.js â€” pickup-authorization-service (auth-identity, high, full)
- services/pickup-code-helpers.js â€” pickup-code-helpers (logistics, high, full)
- services/pickup-collection-service.js â€” pickup-collection-service (logistics, high, full)
- services/pickup-exceptional-collection-service.js â€” pickup-exceptional-collection-service (logistics, high, full)
- services/pickup-secret-customer-rotation-service.js â€” pickup-secret-customer-rotam«ëŒ+Š×®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^ervices/catalog-promotion/axes.js â€” catalog-promotion-axes-mapping (catalog, high, full)
- services/catalog-promotion/content.js â€” catalog-promotion-content-mapping (catalog, high, full)
- services/catalog-promotion/editorial-identity.js â€” catalog-draft-editorial-identity (catalog, high, full)
- services/catalog-promotion/sku-media.js â€” catalog-promotion-sku-media-linking (catalog, high, full)
- services/catalog-promotion/sku.js â€” catalog-promotion-sku-reconciliation (catalog, high, full)
- services/catalog-public-view.js â€” catalog-public-view (catalog, high, full)
- services/catalog-publication-decision-audit.js â€” catalog-publication-decision-audit (catalog, high, full)
- services/catalog-registry.js â€” catalog-global-registry-read (catalog, high, full)
- services/catalog-taxonomy-audit.js â€” catalog-taxonomy-audit-boundary (catalog, high, full)
- services/catalog-unified-registry.js â€” unified-catalog-operator-read (catalog, high, full)
- services/catalog-workspace.js â€” canonical-catalog-workspace-service (catalog, high, full)
- services/central-authority.js â€” central-authority-single-lookup (market-control-plane, high, full)
- services/client-360.js â€” canonical-client-360-service (admin-dashboard, high, full)
- services/client-index.js â€” canonical-client-index-service (admin-dashboard, high, full)
- services/client-notification-service.js â€” client-notification-service (notification, high, full)
- services/cost-allocation/allocate.js â€” economic-engine-cost-allocation-allocate (economic-engine, high, full)
- services/cost-allocation/canonical-margin-writer.js â€” economic-engine-canonical-margin-writer (economic-engine, high, full)
- services/cost-allocation/cost-expectation.js â€” economic-engine-cost-expectation (economic-engine, high, full)
- services/cost-allocation/cost-types.js â€” economic-engine-cost-type-classification (economic-engine, high, full)
- services/cost-allocation/index.js â€” economic-engine-cost-allocation (economic-engine, high, full)
- services/cost-allocation/manual-cost-entry-service.js â€” manual-cost-entry (economic-engine, high, full)
- services/cost-component-admin-service.js â€” economic-engine-cost-component-admin-service (economic-engine, high, full)
- services/cost-component-market-service.js â€” economic-engine-market-cost-component-service (economic-engine, high, full)
- services/credential-action-store.js â€” credential-action-token-persistence (auth-identity, high, full)
- services/credential-invitation-email.js â€” credential-invitation-delivery (auth-identity, high, full)
- services/credential-link-token.js â€” credential-link-crypto (auth-identity, high, full)
- services/customer-handoff-reconciliation.js â€” customer-handoff-reconciliation (logistics, high, full)
- services/customs-classification.js â€” customs-classification (customs, high, full)
- services/customs-dynamic-category-classifier.js â€” customs-dynamic-category-classifier (customs, high, full)
- services/customs-shipment-fee-service.js â€” customs-shipment-fee-service (customs, high, full)
- services/dashboard-admin-context.js â€” canonical-admin-context-resolver (admin-dashboard, high, full)
- services/dashboard-cache.js â€” dashboard-dashboard-cache (dashboard, high, full)
- services/dashboard-clients-queries.js â€” dashboard-dashboard-clients-queries (dashboard, high, full)
- services/dashboard-commerce.js â€” canonical-commerce-dashboard-service (admin-dashboard, high, full)
- services/dashboard-finance-canonical.js â€” canonical-finance-dashboard-service (admin-dashboard, high, full)
- services/dashboard-finance-metrics.js â€” economic-engine-dashboard-finance-metrics (economic-engine, high, full)
- services/dashboard-invalidation-bus.js â€” dashboard-post-commit-invalidation-bus (dashboard, high, full)
- services/dashboard-metrics/_helpers.js â€” dashboard-metrics-helpers (dashboard, high, full)
- services/dashboard-metrics/control-tower.js â€” dashboard-metrics-control-tower (dashboard, high, full)
- services/dashboard-metrics/costing.js â€” dashboard-metrics-costing (dashboard, high, full)
- services/dashboard-metrics/index.js â€” dashboard-dashboard-metrics (dashboard, high, full)
- services/dashboard-metrics/logistics.js â€” dashboard-metrics-logistics (dashboard, high, full)
- services/dashboard-metrics/market-currency.js â€” dashboard-market-currency-projection (dashboard, high, full)
- services/dashboard-operations.js â€” canonical-operations-dashboard-service (admin-dashboard, high, full)
- services/dashboard-ops-queries.js â€” dashboard-dashboard-ops-queries (dashboard, high, full)
- services/dashboard-orders.js â€” dashboard-orders-service (admin-dashboard, high, full)
- services/dashboard-pilotage-market.js â€” dashboard-pilotage-market-aggregate (admin-dashboard, high, full)
- services/documents/customs-invoice.js â€” customs-invoice (documents, high, full)
- services/documents/pdf-renderer.js â€” private-document-pdf-renderer (documents, high, full)
- services/economic-config.js â€” economic-config-canonical-bridge (economic-engine, high, full)
- services/economic-engine-queries.js â€” economic-engine-calculation-service (economic-engine, high, full)
- services/economic-price-audit-service.js â€” economic-engine-product-price-audit (economic-engine, high, full)
- services/external-provider-onboarding-contracts.js â€” external-provider-onboarding-contracts (external-provider-contracts, high, full)
- services/finance-accounting-workspace.js â€” canonical-finance-accounting-workspace-service (admin-dashboard, high, full)
- services/finance-metrics/annulations.js â€” economic-engine-annulations-parcels (economic-engine, high, full)
- services/finance-metrics/customs-unknown.js â€” economic-engine-customs-unknown-predicate (economic-engine, high, full)
- services/finance-metrics/finance-summary.js â€” economic-engine-finance-summary (economic-engine, high, full)
- services/finance-metrics/index.js â€” economic-engine-dashboard-finance-metrics (economic-engine, high, full)
- services/finance-metrics/payments.js â€” economic-engine-payments-detail (economic-engine, high, full)
- services/finance-metrics/sales-analysis.js â€” economic-engine-sales-analysis (economic-engine, high, full)
- services/fx-engine-rates.js â€” fx-engine-rates (market, high, full)
- services/hub-administration-board.js â€” hub-administration-board-reader (purchasing, high, full)
- services/hub-box-shipment-service.js â€” hub-box-shipment (logistics, high, full)
- services/hub-dashboard-queries.js â€” dashboard-hub-dashboard-queries (dashboard, high, full)
- services/hub-inbound-reconciliation.js â€” hub-inbound-reconciliation (logistics, high, full)
- services/hub-physical-codes.js â€” hub-physical-codes (logistics, high, full)
- services/hub-procurement-dossier.js â€” hub-procurement-dossier (logistics, high, full)
- services/hub-receive-idempotency.js â€” hub-receive-idempotency (logistics, high, full)
- services/hub-reference.js â€” hub-reference (logistics, high, full)
- services/import-lot-registry.js â€” import-lot-registry-projection (admin-dashboard, high, full)
- services/import-runtime-runs.js â€” import-runtime-run-projection (sourcing, high, full)
- services/incident-escalation.js â€” incident-sla-escalation (incident-management, high, full)
- services/incident-governance.js â€” incident-management-governance-mapping (incident-management, high, full)
- services/incident-write-service.js â€” incident-management-write-boundary (incident-management, high, full)
- services/international-n1-reconciliation.js â€” international-shipment-costs-owner (economic-engine, high, full)
- services/international-shipment-journey.js â€” international-shipment-journey-owner (logistics, high, full)
- services/local-mobile-refund-handoff.js â€” verified-manual-mobile-refund-handoff (refunds, high, full)
- services/local-stock-checkout-preview.js â€” local-stock-checkout-preview (local-stock, high, full)
- services/local-stock-decision-projection.js â€” local-stock-decision-projection (local-stock, high, full)
- services/local-stock-service.js â€” local-stock-local-stock-service (local-stock, high, full)
- services/logistics-control-chain-projection.js â€” logistics-control-chain-projection (admin-dashboard, high, full)
- services/manual-scan-confirmation.js â€” manual-scan-confirmation (dashboard, high, full)
- services/market-business-day.js â€” market-business-day-authority (admin-dashboard, high, full)
- services/market-commercial-price-service.js â€” market-commercial-price-decision-owner (market-autonomy, high, full)
- services/market-cost-attribution-service.js â€” economic-engine-market-cost-attribution (economic-engine, high, full)
- services/market-delegation-catalog-service.js â€” market-delegation-catalog-service (market-delegation, high, full)
- services/market-delegation-client-case-service.js â€” market-delegation-client-case-service (market-delegation, high, full)
- services/market-delegation-cost-statement-service.js â€” market-delegation-cost-statement-service (market-delegation, high, full)
- services/market-delegation-customs-service.js â€” market-delegation-customs-service (market-delegation, high, full)
- services/market-delegation-local-offer-service.js â€” market-delegation-local-offer-service (market-delegation, high, full)
- services/market-delegation-local-stock-service.js â€” market-delegation-local-stock-service (market-delegation, high, full)
- services/market-delegation-network-service.js â€” market-delegation-network-service (market-delegation, high, full)
- services/market-delegation-performance-service.js â€” market-delegation-performance-service (market-delegation, high, full)
- services/market-delegation-provider-service.js â€” market-delegation-provider-service (market-delegation, high, full)
- services/market-delegation-service.js â€” market-delegation-write-service (market-delegation, high, full)
- services/market-delegation-settlement-service.js â€” market-delegation-settlement-orchestration (market-delegation, high, full)
- services/market-delegation-team-service.js â€” market-delegation-team-service (market-delegation, high, full)
- services/market-lifecycle-service.js â€” market-lifecycle-writer (market, high, full)
- services/market-operation-guard.js â€” market-operation-guard (markets, high, full)
- services/market-operator-provisioning.js â€” market-operator-provisioning (market-delegation, high, full)
- services/market-payment-account-service.js â€” market-payment-account-owner (payment, high, full)
- services/market-payment-provider-config-service.js â€” market-payment-provider-config-writer (payment, high, full)
- services/market-provisioning-service.js â€” market-provisioning-orchestrator (market-control-plane, high, full)
- services/market-ready-to-sell-projection.js â€” market-ready-to-sell-projection (market-delegation, high, full)
- services/market-scope-admin-service.js â€” market-operator-scope-admin-boundary (market, high, full)
- services/market-scope-projector.js â€” market-delegation-scope-projector (market-delegation, high, full)
- services/market-settlement-service.js â€” market-settlement-lifecycle-owner (settlement, high, full)
- services/mobile-money-reconciliation.js â€” mobile-money-reconciliation (payment, high, full)
- services/mobile-money/registry.js â€” mobile-money-provider-registry (payment, high, full)
- services/notification-service.js â€” customer-notification-orchestrator (notification, high, full)
- services/notifications/internals.js â€” notification-internals (notification, high, full)
- services/notifications/notification-service.js â€” customer-notification-orchestrator (notification, high, full)
- services/notifications/order.js â€” notification-order (notification, high, full)
- services/notifications/otp-auth.js â€” notification-otp-auth (notification, high, full)
- services/notifications/parcel.js â€” notification-parcel (notification, high, full)
- services/operations-relay-projection.js â€” dashboard-operations-relay-projection (admin-dashboard, high, full)
- services/operations-workspace.js â€” canonical-operations-workspace-service (admin-dashboard, high, full)
- services/order-360.js â€” canonical-order-360-service (admin-dashboard, high, full)
- services/order-financial-closure-reconciliation.js â€” order-financial-closure-reconciliation (orders, high, full)
- services/order-item-availability-service.js â€” orders-order-item-availability (orders, high, full)
- services/order-service.js â€” order-domain-helpers (orders, high, full)
- services/otp-test-mode.js â€” auth-otp-test-mode (auth-identity, high, full)
- services/parcel-auto-create-service.js â€” logistics-parcel-auto-create-service (logistics, high, full)
- services/parcel-guards.js â€” logistics-parcel-guards (logistics, high, full)
- services/parcel-mutation-service.js â€” logistics-parcel-mutation-boundary (logistics, high, full)
- services/parcel-operations.js â€” logistics-parcel-operations (logistics, high, full)
- services/parcel-order-membership.js â€” logistics-parcel-order-membership (logistics, high, full)
- services/parcel-security.js â€” logistics-parcel-security (logistics, high, full)
- services/parcel-service.js â€” logistics-parcel-service (logistics, high, full)
- services/parcel-shipment-handover.js â€” international-handover-customer-parcel-status (logistics, high, full)
- services/parcel-transition-guard.js â€” incident-management-transition-guard (incident-management, high, full)
- services/parcelOptimizationService.js â€” logistics-parcel-optimization-service (logistics, high, full)
- services/partner-admin-service.js â€” partner-admin-service (dashboard, high, full)
- services/pickup-agent-lockout.js â€” pickup-agent-lockout (logistics, high, full)
- services/pickup-authorization-service.js â€” pickup-authorization-service (auth-identity, high, full)
- services/pickup-code-helpers.js â€” pickup-code-helpers (logistics, high, full)
- services/pickup-collection-service.js â€” pickup-collection-service (logistics, high, full)
- services/pickup-exceptional-collection-service.js â€” pickup-exceptional-collection-service (logistics, high, full)
- services/pickup-secret-customer-rotation-service.js â€” pickup-secret-customer-rotation (logistics, high, full)
- services/pickup-secret-service.js â€” pickup-secret-service (logistics, high, full)
- services/pipeline-certification-gate-c.js â€” e2e-certification-gate-c (catalog, high, full)
- services/pipeline-certification-scenario-core.js â€” pipeline-certification-scenario-core (catalog, high, full)
- services/pricing-apply.js â€” economic-engine-pricing-apply (economic-engine, high, full)
- services/pricing-cdr.js â€” economic-engine-pricing-cdr (economic-engine, high, full)
- services/pricing-cost-explainability.js â€” economic-engine-pricing-cost-explainability (economic-engine, high, full)
- services/pricing-dashboard.js â€” economic-engine-pricing-dashboard (economic-engine, high, fual-money.js â€” purchasing-canonical-supplier-money (purchasing, high, full)
- services/purchasing-grouped-service.js â€” purchasing-grouped-service (purchasing, high, full)
- services/purchasing-order-detail.js â€” purchasing-order-detail-reader (purchasing, high, full)
- services/radar-alerts/cash-reconciliation-signals.js â€” radar-cash-reconciliation-signals (decision-signals, high, full)
- services/refinery-fr-recheck.js â€” refinery-active-editorial-recheck (catalog, high, full)
- services/relais-mutation-service.js â€” logistics-relais-mutation-service (logistics, high, full)
- services/relay-collect-amount.js â€” dashboard-relay-collect-amount (dashboard, high, full)
- services/relay-dashboard-queries.js â€” dashboard-relay-dashboard-queries (dashboard, high, full)
- services/relay-parcel-item-reconciliation.js â€” relay-parcel-item-reconciliation (logistics, high, full)
- services/relay-shipment-receipt.js â€” relay-shipment-receipt-owner (logistics, high, full)
- services/sav-replacement-order.js â€” sav-replacement-order (orders, high, full)
- services/shared-cart-library.js â€” shared-cart-library-service (shared-cart, high, full)
- services/shared-cart-queries.js â€” shared-cart-db-query-service (shared-cart, high, full)
- services/shared-cart-user-cleanup.js â€” shared-cart-user-cleanup-boundary (shared-cart, high, full)
- services/shipping-customs-workspace.js â€” canonical-shipping-customs-workspace-service (admin-dashboard, high, full)
- services/signal-admin-service.js â€” decision-signal-admin-service (decision-signals, high, full)
- services/simulation-scope-service.js â€” simulation-scope (economic-engine, high, full)
- services/sourcing-candidate-actions.js â€” sourcing-candidate-action-service (sourcing, high, full)
- services/sourcing-candidate-import-service.js â€” sourcing-candidate-import-owner (sourcing, high, full)
- services/sourcing-canonical-commercial-projection-core.js â€” sourcing-canonical-commercial-projection-core (sourcing, high, full)
- services/sourcing-canonical-offer-projection.js â€” sourcing-canonical-offer-projection (sourcing, high, full)
- services/sourcing-canonical-offer-unit-comparison.js â€” sourcing-canonical-offer-unit-comparison (sourcing, high, full)
- services/sourcing-canonical-product-projection.js â€” sourcing-canonical-product-projection-trial (sourcing, high, full)
- services/sourcing-canonical-unit-product-sku-resolution.js â€” sourcing-canonical-unit-product-sku-resolution (sourcing, high, full)
- services/sourcing-canonical-unit-projection.js â€” sourcing-canonical-unit-projection (sourcing, high, full)
- services/sourcing-catalog-change-observation.js â€” sourcing-catalog-change-observation (sourcing, high, full)
- services/sourcing-catalog-change-sku-identity-proof.js â€” sourcing-catalog-change-sku-identity-proof (sourcing, high, full)
- services/sourcing-catalog-change-unit-resolution-proof.js â€” sourcing-catalog-change-unit-resolution-proof (sourcing, high, full)
- services/sourcing-catalog-product-linkage.js â€” sourcing-catalog-product-linkage (sourcing, high, full)
- services/sourcing-certification-gate-a-fixture-harness.js â€” sourcing-gate-a-fixture-harness (sourcing, high, full)
- services/sourcing-certification-gate-a.js â€” sourcing-certification-gate-a (sourcing, high, full)
- services/sourcing-certification.js â€” sourcing-certification (sourcing, high, full)
- services/sourcing-golden-e2e-service.js â€” sourcing-golden-e2e-read-model (sourcing, high, full)
- services/sourcing-integrity-service.js â€” sourcing-integrity-health-service (sourcing, high, full)
- services/sourcing-observation-shadow-service.js â€” sourcing-observation-shadow-owner (sourcing, high, full)
- services/sourcing-product-read-comparison.js â€” sourcing-product-read-comparison (sourcing, high, full)
- services/sourcing-provider-control-policy.js â€” sourcing-provider-control-policy (sourcing, high, full)
- services/sourcing-shadow-proof-service.js â€” sourcing-shadow-proof (sourcing, high, full)
- services/sourcing-shadow-quantity-trial.js â€” sourcing-shadow-quantity-trial (sourcing, high, full)
- services/sourcing-shadow-resolution-service.js â€” sourcing-shadow-resolution-owner (sourcing, high, full)
- services/sourcing-source-autopilot.js â€” sourcing-source-autopilot (sourcing, high, full)
- services/sourcing-source-registry.js â€” sourcing-source-registry (sourcing, high, full)
- services/sourcing-workspace.js â€” canonical-sourcing-workspace-service (sourcing, high, full)
- services/supplier-360.js â€” canonical-supplier-360-service (admin-dashboard, high, full)
- services/supplier-catalog-scanner.js â€” catalog-supplier-catalog-scanner (catalog, high, full)
- services/supplier-execution-certification.js â€” supplier-execution-certification (purchasing, high, full)
- services/supplier-execution-persistence.js â€” supplier-execution-persistence (purchasing, high, full)
- services/supplier-payment-orchestrator.js â€” supplier-payment-orchestrator (purchasing, high, full)
- services/supplier-payment-proof-persistence.js â€” supplier-payment-proof-persistence (purchasing, high, full)
- services/supplier-payment-review.js â€” supplier-payment-review-reader (purchasing, high, full)
- services/supplier-payment-settlement-service.js â€” supplier-payment-settlement-service (purchasing, high, full)
- services/supplier-payment-state.js â€” supplier-payment-state (purchasing, high, full)
- services/supplier-real-debit-verification.js â€” supplier-real-debit-verification (purchasing, high, full)
- services/supplier-shortage-service.js â€” supplier-shortage-refund-trigger (purchasing, high, full)
- services/supplier-source-resolution.js â€” supplier-source-resolution (purchasing, high, full)
- services/suppliers/aliexpress-discovery.js â€” aliexpress-source-discovery (sourcing, high, full)
- services/suppliers/aliexpress-fulfillment-adapter.js â€” aliexpress-fulfillment-adapter (purchasing, high, full)
- services/suppliers/aliexpress-fulfillment-reader.js â€” aliexpress-provider-fulfillment-reader (purchasing, high, full)
- services/suppliers/aliexpress-oauth.js â€” aliexpress-oauth-session-manager (catalog, high, full)
- services/suppliers/aliexpress-purchase-preflight.js â€” aliexpress-purchase-preflight (purchasing, high, full)
- services/suppliers/allegro-fulfillment-adapter.js â€” allegro-sandbox-fulfillment-adapter (purchasing, high, full)
- services/suppliers/allegro-fulfillment-reader.js â€” allegro-provider-fulfillment-reader (purchasing, high, full)
- services/suppliers/allegro-purchase-reconciliation.js â€” allegro-sandbox-purchase-reconciliation (purchasing, high, full)
- services/suppliers/allegro-sandbox-client.js â€” allegro-sandbox-client (catalog, high, full)
- services/suppliers/allegro-shipping-capability-adapter.js â€” allegro-shipping-capability-adapter (purchasing, high, full)
- services/suppliers/canonical-unit-cutover-comparison.js â€” canonical-unit-purchasing-cutover-comparison (purchasing, high, full)
- services/suppliers/canonical-unit-purchasing-gate.js â€” canonical-unit-purchasing-hard-stop-gate (purchasing, high, full)
- services/suppliers/central-hub-supplier.js â€” central-hub-supplier-identity (purchasing, high, full)
- services/suppliers/cj-billing-history-reconciliation.js â€” cj-billing-history-reconciliation (purchasing, high, full)
- services/suppliers/cj-fulfillment-adapter.js â€” cj-fulfillment-adapter (purchasing, high, full)
- services/suppliers/cj-fulfillment-reader.js â€” cj-provider-fulfillment-reader (purchasing, high, full)
- services/suppliers/cj-payment-recovery.js â€” cj-payment-recovery (purchasing, high, full)
- services/suppliers/cj-purchasing-contract.js â€” cj-purchasing-contract (purchasing, high, full)
- services/suppliers/connectors/allegro-connector.js â€” allegro-sandbox-source-connector (catalog, high, full)
- services/suppliers/connectors/ebay-connector.js â€” ebay-sandbox-browse-connector (catalog, high, full)
- services/suppliers/discovery-semantic-relevance.js â€” supplier-discovery-semantic-relevance (catalog, high, full)
- services/suppliers/e2e-isolated-runtime.js â€” isolated-e2e-runtime-guard (catalog, high, full)
- services/suppliers/json-source-pipeline.js â€” json-source-pipeline (catalog, high, full)
- services/suppliers/managed-file-contract.js â€” managed-catalog-file-contract (catalog, high, full)
- services/suppliers/media-normalizer.js â€” catalog-media-normalizer (catalog, high, full)
- services/suppliers/normalized-product.js â€” catalog-normalized-product (catalog, high, full)
- services/suppliers/pipeline-constants.js â€” catalog-pipeline-constants (catalog, high, full)
- services/suppliers/procurement-execution-boundary.js â€” procurement-execution-boundary (purchasing, high, full)
- services/suppliers/promotion-classifier.js â€” catalog-promotion-classifier (catalog, high, full)
- services/suppliers/provider-authority.js â€” provider-authority (supplier-connectivity, high, full)
- services/suppliers/provider-capability-certifications.js â€” provider-capability-certification-projector (supplier-connectivity, high, full)
- services/suppliers/purchase-order-confirmation-boundary.js â€” purchase-order-confirmation-boundary (purchasing, high, full)
- services/suppliers/purchasing-capability-execution-plan.js â€” purchasing-capability-execution-plan (purchasing, high, full)
- services/suppliers/shipping-capability-contract.js â€” shipping-capability-contract (purchasing, high, full)
- services/suppliers/source-product-normalizer.js â€” catalog-source-product-normalizer (catalog, high, full)
- services/suppliers/supplier-fulfillment-adapter-contract.js â€” supplier-fulfillment-adapter-contract (supplier-connectivity, high, full)
- services/suppliers/supplier-fulfillment-persistence.js â€” supplier-fulfillment-persistence (purchasing, high, full)
- services/suppliers/supplier-fulfillment-readiness.js â€” supplier-fulfillment-readiness (purchasing, high, full)
- services/suppliers/supplier-fulfillment-reconciliation.js â€” supplier-fulfillment-reconciliation (purchasing, high, full)
- services/suppliers/supplier-fulfillment-runtime.js â€” supplier-fulfillment-runtime (purchasing, high, full)
- services/suppliers/supplier-order-identity.js â€” supplier-order-identity (supplier-connectivity, high, full)
- services/suppliers/supplier-reconciliation-contract.js â€” supplier-reconciliation-contract (purchasing, high, full)
- services/target-identity.js â€” target-identity (infrastructure, high, full)
- services/transport-cost-allocation.js â€” transport-cost-allocation-contract (economic-engine, high, full)
- services/transport-pricing.js â€” transport-pricing-quote (economic-engine, high, full)
- services/transport-rails.js â€” transport-rail-registry (logistics, high, full)
- services/wallet-service.js â€” wallet-wallet-service (wallet, high, full)
- services/webauthn-management-service.js â€” auth-passkey-management (auth-passkey, high, full)
- services/webauthn-service.js â€” auth-passkey-webauthn (auth-passkey, high, full)
- services/whatsapp-meta.js â€” meta-whatsapp-adapter (notification, high, full)
- utils/alerts.js â€” alerts-persistence-boundary (notification, high, full)
- utils/auth-cookie.js â€” auth-cookie-policy (auth, high, full)
- utils/auth-session-policy.js â€” auth-session-policy (auth, high, full)
- utils/auth-session.js â€” auth-session-proof (auth, high, full)
- utils/auth-token-policy.js â€” auth-token-policy (auth, high, full)
- utils/certification-accounting.js â€” certification-batch-accounting (infrastructure, high, full)
- utils/credential-session-guard.js â€” credential-session-version-guard (auth-identity, high, full)
- utils/documents/customs-invoice-html.js â€” customs-invoice-html (documents, high, full)
- utils/name-normalize.js â€” name-normalize (shared, high, full)
- utils/non-prod-phone-guard.js â€” non-prod-phone-guard (notification, high, full)
- utils/parcels.js â€” logistics-parcels (logistics, high, full)
- utils/parcelSync.js â€” logistics-parcel-sync (logistics, high, full)
- utils/pricing-cache.js â€” economic-engine-pricing-cache (economic-engine, high, full)
- utils/relay-commission.js â€” relay-commission-resolver (economic-engine, high, full)
- validators/index.js â€” request-validatiom«ëŒ+Š×®º+º$zzb¥æâ×66†VÖ2†–æg&7G'V7GW&RÂ†–v‚ÂgVÆÂ ¢22Æ—FRvw&VvFVBf–ÆW0 ¢ÒV&Æ–2ö&÷WF—VRö§2öçF’Öf÷V2æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö†öÖR×&VÖ—VÒ×cæ§2†&÷WF—VRÖçF’Öf÷V2¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö&÷WF—VR×v÷r×7G–ÆRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö&÷WF—VRæ§2†&÷WF—VR×&öGV7BÖ–ÖvRÖfÆÆ&6²×öÆ—6‚¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö6'B×&öGV7BÖ÷Vâ×7G–ÆRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†6FÆörÖ"Ö6'B×&öGV7BÖ÷Vâ×7G–ÆR¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖFW6·F÷ÖvÆö&ÂÖ6'BÖ66W72æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ"ÖFW6·F÷ÖvÆö&ÂÖ6'BÖ66W72¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖFW6·F÷×6–FV&"æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ"ÖFW6·F÷×6–FV&"¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖFW6·F÷×Ww&FRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ"ÖFW6·F÷×Ww&FR¢ÒV&Æ–2ö&÷WF—VRö§2ö"Öw&VWF–æræ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ"Öw&VWF–ær¢ÒV&Æ–2ö&÷WF—VRö§2ö"Ö†öÖR×&VÖ—VÒ×cæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ"Ö†öÖR×&VÖ—VÒ×c¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖ&¶WB×&–6RÖf÷&ÖBæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"×WF–Ç2æ§2†Ö&¶WBÖÆö6Â×&–6RÖf÷&ÖB¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6'Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†&÷WF—VRÖ"ÖÖöFÂÖ6'B¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖF—66÷fW'’ÖFWF–Âæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’×&–Âæ§2†6FÆörÖÖöFÂÖF—66÷fW'’ÖFWF–Â¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖæbæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†&÷WF—VRÖ"ÖÖöFÂÖæb¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×6ö6–Â×&ööbæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†&÷WF—VRÖ"ÖÖöFÂ×6ö6–Â×&ööb¢ÒV&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†&÷WF—VRÖ"ÖÖöFÂ¢ÒV&Æ–2ö&÷WF—VRö§2ö"×—Âæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6†V6¶÷WBæ§2‡–ÖVçBÖ"×—Â¢ÒV&Æ–2ö&÷WF—VRö§2ö"×GÖ7W&F–öâ×7VvvW7F–öç2æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂ×7VvvW7F–öç2æ§2‡&V6öÖÖVæFF–öç2Ö"×GÖ7W&F–öâ×7VvvW7F–öç2¢ÒV&Æ–2ö&÷WF—VRö§2ö"×&öGV7BÖ÷VâÖ6öçG&7Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"ÖÖöFÂÖ6÷&Ræ§2†6FÆörÖ"×&öGV7BÖ÷VâÖ6öçG&7B¢ÒV&Æ–2ö&÷WF—VRö§2ö"×6†&R×†öæRÖwV&Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"×6†&RÖ6'Bæ§2†&÷WF—VRÖ"×6†&R×†öæRÖwV&B¢ÒV&Æ–2ö&÷WF—VRö§2ö6&BÖ6öæf–ræ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VRÖ6&BÖ6öæf–r¢ÒV&Æ–2ö&÷WF—VRö§2ö6'B×&öGV7B×7VÖÖ'’æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6'Bæ§2†6'B×&öGV7B×7VÖÖ'’¢ÒV&Æ–2ö&÷WF—VRö§2ö6†V6¶÷WBÖFW6·F÷×7G–ÆRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6†V6¶÷WBæ§2†6†V6¶÷WBÖFW6·F÷×7G–ÆRÖÆöFW"¢ÒV&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö7F–öç2æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö7F–öç2æ§2†6FÆörÖF—66÷fW'’Ö7F–öç2¢ÒV&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö’æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö’æ§2†&÷WF—VRÖF—66÷fW'’Ö’¢ÒV&Æ–2ö&÷WF—VRö§2öF—66÷fW'’ÖFW6·F÷×7G–ÆRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’×&–Âæ§2†F—66÷fW'’ÖFW6·F÷×7G–ÆRÖÆöFW"¢ÒV&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö–çV—'’æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’Ö–çV—'’æ§2‡&÷f–FW'2×6W'f–6W2ÖF—66÷fW'’Ö–çV—'’¢ÒV&Æ–2ö&÷WF—VRö§2öF—66÷fW'’×&–Âæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’×&–Âæ§2†6FÆörÖF—66÷fW'’×&–Â¢ÒV&Æ–2ö&÷WF—VRö§2öw&÷Wöw&÷W×7FFRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"×6†&RÖ6'Bæ§2‡6†&VBÖ6'BÖw&÷W×7FFR¢ÒV&Æ–2ö&÷WF—VRö§2ö†W&òÖ&ö÷G7G&æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö†öÖR×&VÖ—VÒ×cæ§2†&÷WF—VRÖ†W&òÖ&ö÷G7G&¢ÒV&Æ–2ö&÷WF—VRö§2öÆö6Â×7Fö6²Ö&FvRÖÖ÷VçBæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öÆö6Â×7Fö6²Ö&FvRÖÖ÷VçBæ§2†&÷WF—VRÖÆö6Â×7Fö6²Ö&FvRÖÖ÷VçB¢ÒV&Æ–2ö&÷WF—VRö§2öÆö6Â×7Fö6²Ö&FvRæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öÆö6Â×7Fö6²Ö&FvRæ§2†&÷WF—VRÖÆö6Â×7Fö6²Ö&FvR¢ÒV&Æ–2ö&÷WF—VRö§2öÖ–âæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö&÷WF—VRæ§2†&÷WF—VRÖÖ–â¢ÒV&Æ–2ö&÷WF—VRö§2öÖ&¶WBÖ6öçFW‡Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öÖ&¶WBÖ6öçFW‡Bæ§2†&÷WF—VRÖÖ&¶WBÖ6öçFW‡B¢ÒV&Æ–2ö&÷WF—VRö§2öÖ&¶WBÖ‡–G&F–öâæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öÖ&¶WBÖ6öçFW‡Bæ§2†&÷WF—VRÖÖ&¶WBÖ‡–G&F–öâ¢ÒV&Æ–2ö&÷WF—VRö§2÷&VÆöBÖ772×7væ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö–æFW‚æ‡FÖÂ‡&VÆöBÖ772×7v¢ÒV&Æ–2ö&÷WF—VRö§2÷&öGV7BÖ–ÖvRÖÆöF–ær×W‚æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2÷&VæFW"÷&VæFW"×&öGV7BÖ6&Bæ§2†&÷WF—VR×&öGV7BÖ–ÖvRÖÆöF–ær×W‚¢ÒV&Æ–2ö&÷WF—VRö§2÷&÷f–FW'2×6W'f–6W2Ö’æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2÷&÷f–FW'2×6W'f–6W2Ö’æ§2‡&÷f–FW'2×6W'f–6W2Ö’¢ÒV&Æ–2ö&÷WF—VRö§2÷&VæFW"ö6FVv÷'’×6†VÆb×f—7VÇ2æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2÷&VæFW"÷&VæFW"Ö6FVv÷&–W2æ§2†6FVv÷'’×6†VÆb×f—7VÂ×&Vv—7G'’¢ÒV&Æ–2ö&÷WF—VRö§2÷&VæFW"÷&VæFW"Ö6FVv÷&–W2æ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†&÷WF—VR×&VæFW"Ö6FVv÷&–W2¢ÒV&Æ–2ö&÷WF—VRö§2÷&VæFW"÷&VæFW"ÖF—66÷fW'’×&–Âæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2öF—66÷fW'’×&–Âæ§2†6FÆör×&VæFW"ÖF—66÷fW'’×&–Â¢ÒV&Æ–2ö&÷WF—VRö§2÷&VæFW"÷&VæFW"×&öGV7BÖ6&Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†6FÆör×&VæFW"×&öGV7BÖ6&B¢ÒV&Æ–2ö&÷WF—VRö§2÷F†öæö×’ÖæòÖ†&F6öFRçFW7Bæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†6FÆör×F†öæö×’ÖæòÖ†&F6öFR×FW7B¢ÒV&Æ–2ö&÷WF—VRö§2÷f–WrÖÖöFVÇ2÷&öGV7BÖ6&BÖÖöFVÂæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†6FÆör×&öGV7BÖ6&BÖÖöFVÂ¢ÒV&Æ–2ö&÷WF—VRö§2÷f–WrÖÖöFVÇ2÷&öGV7BÖ6&B×f–WrÖÖöFVÂæ§2Óâ÷væW"V&Æ–2ö&÷WF—VRö§2ö"Ö6FÆöræ§2†6FÆör×&öGV7BÖ6&B×f–WrÖÖöFVÂ¢Ò6W'f–6W2ö6FÆörÖÖVF–×f—7VÂÖg"×&ööbæ§2Óâ÷væW"6FÆör†6FÆörÖÖVF–×f—7VÂÖg"×&ööb¢Ò6W'f–6W2ö6FÆör×&Vf–æW'’Ö6öÖ&–æVB×&ööbæ§2Óâ÷væW"6FÆör†6FÆör×&Vf–æW'’Ö6öÖ&–æVB×&ööb¢Ò6W'f–6W2ö6FÆör×f—7VÂÖg"ÖWf–FVæ6R×&VBæ§2Óâ÷væW"6FÆör†6FÆör×f—7VÂÖg"ÖWf–FVæ6R×&VB¢Ò6W'f–6W2ö6FÆör×f—7VÂÖg"Ö‡VÖâ×&Wf–Wr×w&—FRæ§2Óâ÷væW"6FÆör†6FÆör×f—7VÂÖg"Ö‡VÖâ×&Wf–Wr×w&—FR¢Ò6W'f–6W2ö6VçG&ÂÖ‡V"ÖöâÖ÷&FW"æ§2Óâ÷væW"&6¶VæBÖ6÷&R†6VçG&ÂÖ‡V"ÖöâÖ÷&FW"ÖVÆ–v–&–Æ—G’¢Ò6W'f–6W2ö6öÖÖW&6–ÂÖ6FVv÷'’Öw&VVÖVçBæ§2Óâ÷væW"&6¶VæBÖ6÷&R†g&÷¦VâÖ6öÖÖW&6–ÂÖö&¦V7B×7WÆ–W"Ö6FVv÷'’Öw&VVÖVçB¢Ò6W'f–6W2ö6öÖÖW&6–Â×F†öæö×’×6VÖçF–72æ§2Óâ÷væW"&6¶VæBÖ6÷&R†6öÖÖW&6–Â×F†öæö×’×6VÖçF–2Ö–çFVçB¢Ò6W'f–6W2öF6†&ö&B×&7CÖ÷&FW'2æ§2Óâ÷væW"&6¶VæBÖ6÷&R‡&7CÖ÷&FW'2×&VFöæÇ’×&ö¦V7F–öâ¢Ò6W'f–6W2ösbÖ‡V"×&V6—RÖ6Æ÷7W&Ræ§2Óâ÷væW"&6¶VæBÖ6÷&R†sbÖ‡V"×&V6—RÖ6Æ÷7W&R¢Ò6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§2Óâ÷væW"&6¶VæBÖ6÷&R†sb×&V6—R×òÖ6æ6VÂ×6W'f–6R¢Ò6W'f–6W2ösb×7Fv–ærÖ'W–W"Ö–FVçF—G’ÖwV&Bæ§2Óâ÷væW"&6¶VæBÖ6÷&R†sb×7Fv–ærÖ'W–W"Ö–FVçF—G’ÖwV&B¢Ò6W'f–6W2ö‡V"×cÖf—‡GW&RÖ6†V6¶÷WBÖwV&Bæ§2Óâ÷væW"&6¶VæBÖ6÷&R†‡V"×cÖf—‡GW&RÖ6†V6¶÷WBÖwV&B¢Ò6W'f–6W2ö‡V"×cÖf—‡GW&R×–ÖVçBæ§2Óâ÷væW"&6¶VæBÖ6÷&R†‡V"×cÖf—‡GW&R×–ÖVçB¢Ò6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×&VBÖWF†÷&—G’æ§2Óâ÷væW"&6¶VæBÖ6÷&R†Ö&¶WB×66÷VB×&VBÖ6&–Æ—G’ÖfÆÆ&6²¢Ò6W'f–6W2ö÷&FW"×&VBÖWF†÷&—¦F–öâæ§2Óâ÷væW"&6¶VæBÖ6÷&R†÷&FW"×&VBÖWF†÷&—¦F–öâ¢Ò6W'f–6W2÷&÷f–FW'2Ö–çV—'’×6W'f–6Ræ§2Óâ÷væW"6W'f–6W2÷&÷f–FW'2×6W'f–6Ræ§2‡&÷f–FW'2×6W'f–6W2Ö6öçFW‡GVÂÖ–çV—'’¢Ò6W'f–6W2÷&÷f–FW'2Ö–çFW&7F–öâ×öÆ–7’æ§2Óâ÷væW"6W'f–6W2÷&÷f–FW'2×6W'f–6Ræ§2‡&÷f–FW'2×6W'f–6W2Ö–çFW&7F–öâ×öÆ–7’¢Ò6W'f–6W2÷&7CÖ6†V6¶÷WB×&VfW&Væ6RÖwV&Bæ§2Óâ÷væW"&6¶VæBÖ6÷&R‡&7CÖ6†V6¶÷WB×&VfW&Væ6RÖwV&B¢Ò6W'f–6W2÷6–×VÆF–öâ×f—6–&–Æ—G’æ§2Óâ÷væW"&6¶VæBÖ6÷&R†Æ—fR×6–×VÆF–öâ×f—6–&–Æ—G’ ¢22D"w&—FRVFvW0 ¢Òu$•DR6W'f–6W2öFÖ–âÖ÷&FW"×&VgVæBæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2ö66‚Ö÷W&F–öç2æ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2öæ÷F–f–6F–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2öæ÷F–f–6F–öç2öæ÷F–f–6F–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2ö÷&FW"×–ÖVçBÖ6öæf—&ÖF–öâæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–ÖVçBÖ66‚Ö6öæf—&Òæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–ÖVçBÖÖö&–ÆRÖÖöæW’æ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–ÖVçB×—Âæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–ÖVçB×7G&—Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–6·WÖWF†÷&—¦F–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷–6·WÖW†6WF–öæÂÖ6öÆÆV7F–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷&öGV7B×V&Æ–6F–öâÖwV&Bæ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷W&6†6–ærÖ6æ6VÂ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷W&6†6–ærÖ6ö×ÆWF–öâ×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷W&6†6–ærÖVævvVÖVçB×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷W&6†6–ær×G&–vvW"×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷&W—"Ö÷&FW&VB×v—F†÷WB×W&6†6RÖ÷&FW'2æ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷66âÖ÷W&F–öç2æ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2÷7WÆ–W"×6†÷'FvR×6W'f–6Ræ§2ÓâÆW'G0¢Òu$•DRWF–Ç2öÆW'G2æ§2ÓâÆW'G0¢Òu$•DRWF–Ç2÷&6VÅ7–æ2æ§2ÓâÆW'G0¢Òu$•DR6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2Óâ76–væÖVçEö6&–Æ—G•ö6V–Æ–æp¢Òu$•DR6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2Óâ76–væÖVçEöÖVÖ&W'6†—0¢Òu$•DR6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§2Óâ76–væÖVçEöÖVÖ&W'6†—0¢Òu$•DR&÷WFW2öFÖ–â÷7—7FVÒæ§2Óâ&6¶WEö—FV×0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Óâ&6¶WEö—FV×0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Óâ&6¶WEö—FV×0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'B×W6W"Ö6ÆVçWæ§2Óâ&6¶WEö—FV×0¢Òu$•DR&÷WFW2öFÖ–â÷7—7FVÒæ§2Óâ&6¶WG0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Óâ&6¶WG0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Óâ&6¶WG0¢Òu$•DR6W'f–6W2÷6†&VBÖ6'B×W6W"Ö6ÆVçWæ§2Óâ&6¶WG0¢Òu$•DR6W'f–6W2ö&÷WF—VR×F†öæö×’ÖFÖ–âæ§2Óâ&÷WF—VUö6FVv÷&–W0¢Òu$•DR6W'f–6W2ö&÷WF—VR×F†öæö×’ÖFÖ–âæ§2Óâ&÷WF—VU÷7V&6FVv÷&–W0¢Òu$•DR&÷WFW2öFÖ–â×'VÆW2æ§2Óâ'W6–æW75÷'VÆW5ö†—7F÷'¢Òu$•DRWF–Ç2÷'VÆW2æ§2Óâ'W6–æW75÷'VÆW5ö†—7F÷'¢Òu$•DR&÷WFW2öFÖ–â×'VÆW2æ§2Óâ'W6–æW75÷'VÆW0¢Òu$•DRWF–Ç2÷'VÆW2æ§2Óâ'W6–æW75÷'VÆW0¢Òu$•DR&÷WFW2ö6'&–W'2æ§2Óâ6'&–W'0¢Òu$•DR&÷WFW2÷6†&W2æ§2Óâ6'E÷6†&W0¢Òu$•DR6W'f–6W2ö6'B×6†&R×6W'f–6Ræ§2Óâ6'E÷6†&W0¢Òu$•DR6W'f–6W2ö66‚Ö÷W&F–öç2æ§2Óâ66…ö6öÆÆV7F–öç0¢Òu$•DR6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2Óâ66…ö6öÆÆV7F–öç0¢Òu$•DR6W'f–6W2÷–ÖVçBÖ66‚Ö6öæf—&Òæ§2Óâ66…ö6öÆÆV7F–öç0¢Òu$•DR6W'f–6W2ö66‚Ö6öæf—&ÖF–öâÖ6öçG&öÂ×6W'f–6Ræ§2Óâ66…ö6öæf—&ÖF–öåö6öçG&öÇ0¢Òu$•DR6W'f–6W2ö66‚Ö÷W&F–öç2æ§2Óâ66…ö6öæf—&ÖF–öåö6öçG&öÇ0¢Òu$•DR6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2Óâ66…ö6öæf—&ÖF–öåö6öçG&öÇ0¢Òu$•DR6W'f–6W2÷–ÖVçBÖ66‚Ö6öæf—&Òæ§2Óâ66…ö6öæf—&ÖF–öåö6öçG&öÇ0¢Òu$•DR6W'f–6W2ö66‚Ö7W7FöG’×6W'f–6Ræ§2Óâ66…ö7W7FöG•öÆ÷76W0¢Òu$•DR6W'f–6W2ö66‚Ö7W7FöG’×6W'f–6Ræ§2Óâ66…ö7W7FöG•÷&V6V—G0¢Òu$•DR&÷WFW2ö66‚æ§2Óâ66…öFW÷6—G0¢Òu$•DR6W'f–6W2ö66‚ÖFW÷6—B×6W'f–6Ræ§2Óâ66…öFW÷6—G0¢Òu$•DR6W'f–6W2ö6FÆörÖVç&–6†ÖVçBæ§2Óâ6FÆöuöVç&–6†ÖVçE÷'Vç0¢Òu$•DR6W'f–6W2ö6FÆörÖ÷fW'&–FW2æ§2Óâ6FÆöuöf–VÆEö÷fW'&–FW0¢Òu$•DR6W'f–6W2÷&öGV7BÖFÖ–â×6W'f–6Ræ§2Óâ6FÆöuöf–VÆEö÷fW'&–FW0¢Òu$•DR6W'f–6W2÷&Vf–æW'’Ög"×&V6†V6²æ§2Óâ6FÆöuöf–VÆEö÷fW'&–FW0¢Òu$•DR6W'f–6W2ö6FÆörÖf–VÆB×7–æ2ÖÆ–6F–öâæ§2Óâ6FÆöuöf–VÆE÷7–æ5÷7FFP¢Òu$•DR6W'f–6W2ö6FÆörÖÖVF–×&V6÷fW'’æ§2Óâ6FÆöuöÖVF–÷&V6÷fW'•öVF—@¢Òu$•DR6W'f–6W2ö6FÆör×f—7VÂÖg"Ö‡VÖâ×&Wf–Wr×w&—FRæ§2Óâ6FÆöuöÖVF–÷f—7VÅög%÷&Wf–Ww0¢Òu$•DR6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2Óâ6FÆöuöÖVF–¢Òu$•DR6W'f–6W2ö6FÆör×&öÖ÷F–öâæ§2Óâ6FÆöuöÖVF–¢Òu$•DR6W'f–6W2ö6FÆör×f—7VÂÖg"Ö‡VÖâ×&Wf–Wr×w&—FRæ§2Óâ6FÆöuöÖVF–¢Òu$•DR6W'f–6W2ö6FÆör×v÷&·76Ræ§2Óâ6FÆöuöÖVF–¢Òu$•DR6W'f–6W2ö6FÆör×&öGV7B×VÆ—G’×6W'f–6Ræ§2Óâ6FÆöu÷&öGV7E÷VÆ—G•öæ÷FW0¢Òu$•DR6W'f–6W2ö6FÆör×&öGV7B×VÆ—G’×6W'f–6Ræ§2Óâ6FÆöu÷&öGV7E÷6ÆUö†öÆG0¢Òu$•DR6W'f–6W2ö6FÆör×V&Æ–6F–öâÖFV6—6–öâÖVF—Bæ§2Óâ6FÆöu÷V&Æ–6F–öåöFV6—6–öåöVF—@¢Òu$•DR6W'f–6W2ö6FÆör×7Fö6²×7–æ2ÖÆ–6F–öâæ§2Óâ6FÆöu÷7Fö6µ÷7–æ5÷7FFP¢Òu$•DR6W'f–6W2ö6FÆör×F†öæö×’ÖVF—Bæ§2Óâ6FÆöu÷F†öæö×•öVF—@¢Òu$•DR&ö÷G7G&÷7F'GWÖÖ–w&F–öç2æ§2Óâ6†&vW0¢Òu$•DR6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§2Óâ6†&vW0¢Òu$•DR6W'f–6W2öÖ&¶WB×7G'V7GW&RÖ6†&vR×&VfW&Væ6Ræ§2Óâ6†&vW0¢Òu$•DR&÷WFW2ö6Æ–VçBÖæ÷F–f–6F–öç2æ§2Óâ6Æ–VçEöæ÷F–f–6F–öç0¢Òu$•DR6W'f–6W2ö6Æ–VçBÖæ÷F–f–6F–öâ×6W'f–6Ræ§2Óâ6Æ–VçEöæ÷F–f–6F–öç0¢Òu$•DR6W'f–6W2÷&–6–ær×7G&FVw’×6W'f–6Ræ§2Óâ6ö×WF—F÷%÷&–6W0¢Òu$•DR&÷WFW2÷&–6–æræ§2Óâ6÷7Eö&Væ6†Ö&·0¢Òu$•DR6W'f–6W2ö6÷7BÖ6ö×öæVçBÖFÖ–â×6W'f–6Ræ§2Óâ6÷7Eö6ö×öæVçEöWfVçG0¢Òu$•DR6W'f–6W2ö6÷7BÖ6ö×öæVçBÖÖ&¶WB×6W'f–6Ræ§2Óâ6÷7Eö6ö×öæVçEöÖ&¶WEö÷fW'&–FUöWfVçG0¢Òu$•DR6W'f–6W2ö6÷7BÖ6ö×öæVçBÖÖ&¶WB×6W'f–6Ræ§2Óâ6÷7Eö6ö×öæVçEöÖ&¶WEö÷fW'&–FW0¢Òu$•DR6W'f–6W2ö6÷7BÖ6ö×öæVçBÖFÖ–â×6W'f–6Ræ§2Óâ6÷7Eö6ö×öæVçG0¢Òu$•DR6W'f–6W2ö7&VFVçF–ÂÖ7F–öâ×7F÷&Ræ§2Óâ7&VFVçF–Åö7F–öå÷Fö¶Vç0¢Òu$•DR&÷WFW2öFÖ–âÖ7W7Fö×2Ö6FVv÷&–W2æ§2Óâ7W7Fö×5ö6FVv÷&–W0¢Òu$•DR&÷WFW2ö÷&FW'2÷7FGW2æ§2Óâ7W7Fö×5ö†—7F÷'¢Òu$•DR6W'f–6W2ö7W7Fö×2×6†—ÖVçBÖfVR×6W'f–6Ræ§2Óâ7W7Fö×5÷6†—ÖVçEöfVW0¢Òu$•DR6W'f–6W2÷6†—–ærÖ7W7Fö×2×v÷&·76Ræ§2Óâ7W7Fö×5÷6†—ÖVçEö†öÆG0¢Òu$•DR&÷WFW2öFÖ–âÖ7W7Fö×2×6†—ÖVçG2æ§2Óâ7W7Fö×5÷6†—ÖVçE÷&6VÅöWfVçG0¢Òu$•DR6W'f–6W2ö7W7Fö×2×6†—ÖVçB×6W'f–6Ræ§2Óâ7W7Fö×5÷6†—ÖVçE÷&6VÅöWfVçG0¢Òu$•DR&÷WFW2öFÖ–âÖ7W7Fö×2×6†—ÖVçG2æ§2Óâ7W7Fö×5÷6†—ÖVçE÷&6VÇ0¢Òu$•DR6W'f–6W2ö7W7Fö×2×6†—ÖVçB×6W'f–6Ræ§2Óâ7W7Fö×5÷6†—ÖVçE÷&6VÇ0¢Òu$•DR&÷WFW2öFÖ–âÖ7W7Fö×2×6†—ÖVçG2æ§2Óâ7W7Fö×5÷6†—ÖVçG0¢Òu$•DR6W'f–6W2ö7W7Fö×2×6†—ÖVçB×6W'f–6Ræ§2Óâ7W7Fö×5÷6†—ÖVçG0¢Òu$•DR&÷WFW2öFÖ–âöFVÆWFRÖ÷&FW"Ö666FRæ§2ÓâF—7WFW0¢Òu$•DR6W'f–6W2öF—7WFRÖ×WFF–öâ×6W'f–6Ræ§2ÓâF—7WFW0¢Òu$•DR6W'f–6W2÷&–6–ær×&—6²×W&–öBæ§2ÓâV6öæöÖ–5÷&—6µö6÷7EöWfVçG0¢Òu$•DR6W'f–6W2÷&–6–ær×&—6²×W&–öBæ§2ÓâV6öæöÖ–5÷&—6µ÷vFW&Ö&µöWfVçG0¢Òu$•DR&ö÷G7G&ö7&öç2æ§2ÓâV6öæöÖ–5÷6æ6†÷G0¢Òu$•DR6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§2ÓâV6öæöÖ–5÷6æ6†÷G0¢Òu$•DR6W'f–6W2÷&–6–ær×W&–öB×7G'V7GW&Ræ§2ÓâV6öæöÖ–5÷7G'V7GW&Uö6÷7EöWfVçG0¢Òu$•DR&÷WFW2öÖöGVÆW2æ§2Óâf'&–70¢Òu$•DR&ö÷G7G&÷7F'GWÖÖ–w&F–öç2æ§2Óâf–ææ6Uö6öæf–p¢Òu$•DR&÷WFW2öFÖ–âÖ6÷7F–æræ§2Óâf–ææ6Uö6öæf–p¢Òu$•DR&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§2Óâf–ææ6Uö6öæf–p¢Òu$•DR6W'f–6W2öV6öæöÖ–2Ö6öæf–ræ§2Óâf–ææ6Uö6öæf–p¢Òu$•DR6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§2Óâf–ææ6Uö6öæf–p¢Òu$•DR&ö÷G7G&ö7&öç2æ§2Óâf–ææ6–ÅöÖ÷fVÖVçEöFö7VÖVçG0¢Òu$•DR6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂ×&ö¦V7F÷'2æ§2Óâf–ææ6–ÅöÖ÷fVÖVçEöFö7VÖVçG0¢Òu$•DR6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂæ§2Óâf–ææ6–ÅöÖ÷fVÖVçEöFö7VÖVçG0¢Òu$•DR&ö÷G7G&ö7&öç2æ§2Óâf–ææ6–ÅöÖ÷fVÖVçG0¢Òu$•DR6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂ×&ö¦V7F÷'2æ§2Óâf–ææ6–ÅöÖ÷fVÖVçG0¢Òu$•DR6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂæ§2Óâf–ææ6–ÅöÖ÷fVÖVçG0¢Òu$•DR&ö÷G7G&ö7&öç2æ§2Óâg…÷V&Æ–5÷&VfW&Væ6U÷V÷FW0¢Òu$•DR6W'f–6W2ög‚×V&Æ–2×&VfW&Væ6RÖfVVBæ§2Óâg…÷V&Æ–5÷&VfW&Væ6U÷V÷FW0¢Òu$•DR&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§2Óâg…÷&FUöö'6W'fF–öç0¢Òu$•DR6W'f–6W2ög‚Öö'6W'fF–öâ×6W'f–6Ræ§2Óâg…÷&FUöö'6W'fF–öç0¢Òu$•DR&÷WFW2öÖöGVÆW2æ§2Óâv&ÖVçEöÖöFVÇ0¢Òu$•DR6W'f–6W2ö‡V"ÖWF†÷&—¦F–öâ×6W'f–6Ræ§2Óâ‡V%öWF†÷&—¦F–öåöw&çG0¢Òu$•DR6W'f–6W2÷W6W"Ö×WFF–öâ×6W'f–6Ræ§2Óâ‡V%öWF†÷&—¦F–öåöw&çG0¢Òu$•DR6W'f–6W2ö‡V"Ö&rÖ&÷‚×6W'f–6Ræ§2Óâ‡V%ö&÷…ö&w0 ¢22D"w&—FRÕf–VFvW2†L:–Ì:–vF–öâL:–6Æ,:–R ¢Òu$•DR6W'f–6W2ö6FÆörÖ&÷fÂæ§2ÓâÆW'G2‡f–ÆW'G2×W'6—7FVæ6RÖ&÷VæF'’¢Òu$•DR6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§2ÓâÆW'G2‡f–ÆW'G2×W'6—7FVæ6RÖ&÷VæF'’¢Òu$•DR6W'f–6W2÷–6·WÖW†6WF–öæÂÖ6öÆÆV7F–öâ×6W'f–6Ræ§2ÓâÆW'G2‡f––6·WÖ6öÆÆV7F–öâ×6W'f–6R¢Òu$•DR6W'f–6W2÷–6·W×6V7&WB×6W'f–6Ræ§2ÓâÆW'G2‡f––6·WÖ6öÆÆV7F–öâ×6W'f–6R¢Òu$•DR6W'f–6W2÷–6·W×6V7&WB×6W'f–6Ræ§2ÓâÆW'G2‡f––6·WÖW†6WF–öæÂÖ6öÆÆV7F–öâ×6W'f–6R¢Òu$•DVÚ±î¸Â¸­yêë¢°k¢G§¦*^ routes/admin-market-control-plane.js -> assignment_capability_ceiling (via market-provisioning-service)
- WRITE services/market-provisioning-service.js -> assignment_capability_ceiling (via market-delegation-service)
- WRITE routes/admin-market-control-plane.js -> assignment_memberships (via market-provisioning-service)
- WRITE routes/admin/users.js -> assignment_memberships (via market-operator-provisioning)
- WRITE routes/market-delegation-team.js -> assignment_memberships (via market-delegation-team-service)
- WRITE services/market-delegation-team-service.js -> assignment_memberships (via market-delegation-service)
- WRITE services/market-operator-provisioning.js -> assignment_memberships (via market-delegation-service)
- WRITE services/market-provisioning-service.js -> assignment_memberships (via market-delegation-team-service)
- WRITE services/finance-accounting-workspace.js -> cash_deposits (via cash-deposit-service)
- WRITE services/catalog-media-recovery.js -> catalog_media (via catalog-promotion)
- WRITE services/sourcing-candidate-actions.js -> catalog_media (via catalog-promotion)
- WRITE services/sourcing-source-autopilot.js -> catalog_media (via sourcing-candidate-actions)
- WRITE services/sourcing-workspace.js -> catalog_media (via sourcing-candidate-actions)
- WRITE services/catalog-approval.js -> catalog_publication_decision_audit (via catalog-publication-decision-audit)
- WRITE routes/admin-customs-shipments.js -> customs_shipment_fees (via customs-shipment-fee-service)
- WRITE services/shipping-customs-workspace.js -> customs_shipment_parcels (via customs-shipment-service)
- WRITE services/international-shipment-journey.js -> customs_shipments (via customs-shipment-service)
- WRITE services/order-status-machine.js -> customs_shipments (via customs-shipment-service)
- WRITE services/shipping-customs-workspace.js -> customs_shipments (via customs-shipment-service)
- WRITE routes/relay-dashboard.js -> disputes; catalog-product-quality-service catalog_product_quality_notes; relay-product-return-intake-service relay_product_return_receipts (via dispute-mutation-service)
- WRITE routes/market-delegation-client-case.js -> disputes (via dispute-mutation-service)
- WRITE services/market-delegation-client-case-service.js -> disputes (via dispute-mutation-service)
- WRITE services/relay-return-request-service.js -> disputes (via dispute-mutation-service)
- WRITE routes/market-delegation-structure-event.js -> economic_structure_cost_events (via pricing-period-structure)
- WRITE services/market-delegation-structure-event-service.js -> economic_structure_cost_events (via pricing-period-structure)
- WRITE services/market-structure-charge-reference.js -> economic_structure_cost_events (via pricing-period-structure)
- WRITE services/g6-hub-recipe-closure.js -> hub_custody_events (via hub-physical-identity)
- WRITE services/hub-operations.js -> hub_custody_events (via hub-physical-identity)
- WRITE services/hub-operations.js -> hub_physical_unit_placements (via hub-physical-identity)
- WRITE services/g6-hub-recipe-closure.js -> hub_physical_units (via hub-physical-identity)
- WRITE services/hub-operations.js -> hub_physical_units (via hub-physical-identity)
- WRITE services/hub-operations.js -> hub_purchase_allocations (via hub-physical-identity)
- WRITE services/sourcing-candidate-actions.js -> import_runtime_runs (via import-runtime-runs)
- WRITE services/sourcing-source-autopilot.js -> import_runtime_runs (via sourcing-candidate-actions)
- WRITE services/suppliers/catalog-import-orchestrator.js -> import_runtime_runs (via import-runtime-runs)
- WRITE routes/admin/system.js -> incidents (via incident-write-service)
- WRITE routes/admin/users.js -> incidents (via incident-write-service)
- WRITE routes/ops-api.js -> incidents (via incident-write-service)
- WRITE services/alert-engine.js -> incidents (via incident-write-service)
- WRITE services/hub-operations.js -> incidents (via hub-physical-identity)
- WRITE services/hub-physical-identity.js -> incidents (via incident-write-service)
- WRITE services/operations-workspace.js -> incidents (via scan-engine)
- WRITE services/reconciliation-service.js -> incidents (via incident-write-service)
- WRITE services/scan-engine.js -> incidents (via incident-write-service)
- WRITE services/shipping-customs-workspace.js -> incidents (via scan-engine)
- WRITE routes/providers-services.js -> inquiries (via providers-inquiry-service)
- WRITE services/operations-workspace.js -> inventory_items (via inventory-service)
- WRITE routes/admin/documents.js -> invoices (via document-reconciliation)
- WRITE services/documents/document-reconciliation.js -> invoices (via invoice-service)
- WRITE services/payment-mobile-money.js -> invoices (via order-payment-confirmation)
- WRITE routes/market-local-stock.js -> local_stock (via market-delegation-local-stock-service)
- WRITE services/market-delegation-local-stock-service.js -> local_stock (via local-stock-service)
- WRITE routes/admin-market-control-plane.js -> market_cash_control_policies (via market-provisioning-service)
- WRITE routes/market-delegation-cash-control.js -> market_cash_control_policies (via market-cash-control-policy-service)
- WRITE services/market-provisioning-service.js -> market_cash_control_policies (via market-cash-control-policy-service)
- WRITE routes/market-delegation-cash-control.js -> market_cash_destinations (via cash-custody-service)
- WRITE routes/admin-action-center.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/admin-market-control-plane.js -> market_delegation_audit (via market-delivery-proof-service)
- WRITE routes/admin-market-control-plane.js -> market_delegation_audit (via market-transport-sale-rate-command)
- WRITE routes/admin-market-control-plane.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/admin-pricing-workspace.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-cash-control.js -> market_delegation_audit (via market-cash-control-policy-service)
- WRITE routes/market-delegation-catalog.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-client-case.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-client.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-local-offer.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-network.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-provider.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-settlement.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-structure-event.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/market-delegation-team.js -> market_delegation_audit (via market-delegation-team-service)
- WRITE routes/market-local-stock.js -> market_delegation_audit (via market-delegation-local-stock-service)
- WRITE services/cash-custody-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/finance-accounting-workspace.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-cash-control-policy-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-catalog-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-client-case-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-local-offer-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-local-stock-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-network-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-provider-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-settlement-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-structure-event-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delegation-team-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-delivery-proof-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-operator-provisioning.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-payment-account-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE services/market-provisioning-service.js -> market_delegation_audit (via market-delegation-service)
- WRITE routes/admin-market-control-plane.js -> market_delivery_attestations (via market-delivery-proof-service)
- WRITE routes/admin-market-control-plane.js -> market_operating_assignments (via market-provisioning-service)
- WRITE routes/admin/users.js -> market_operating_assignments (via market-operator-provisioning)
- WRITE services/market-operator-provisioning.js -> market_operating_assignments (via market-delegation-service)
- WRITE services/market-provisioning-service.js -> market_operating_assignments (via market-delegation-service)
- WRITE routes/admin-market-payment-accounts.js -> market_payment_accounts (via market-payment-account-service)
- WRITE routes/admin-market-control-plane.js -> market_payment_providers (via market-provisioning-service)
- WRITE services/market-provisioning-service.js -> market_payment_providers (via market-payment-provider-config-service)
- WRITE routes/admin-market-settlement.js -> market_settlement_events (via market-settlement-service)
- WRITE routes/market-delegation-settlement.js -> market_settlement_events (via market-settlement-service)
- WRITE services/market-delegation-settlement-service.js -> market_settlement_events (via market-settlement-service)
- WRITE routes/admin-market-settlement.js -> market_settlements (via market-settlement-service)
- WRITE routes/market-delegation-settlement.js -> market_settlements (via market-settlement-service)
- WRITE services/market-delegation-settlement-service.js -> market_settlements (via market-settlement-service)
- WRITE routes/market-delegation-team.js -> market_team_invitations (via market-delegation-team-service)
- WRITE services/market-provisioning-service.js -> market_team_invitations (via market-delegation-team-service)
- WRITE routes/admin-market-control-plane.js -> market_transport_sale_rates (via market-transport-sale-rate-command)
- WRITE routes/admin-market-control-plane.js -> markets (via market-provisioning-service)
- WRITE routes/admin-market-control-plane.js -> markets (via market-lifecycle-service)
- WRITE services/market-provisioning-service.js -> markets (via market-lifecycle-service)
- WRITE routes/admin-market-control-plane.js -> membership_capabilities (via market-provisioning-service)
- WRITE routes/admin/users.js -> membership_capabilities (via market-operator-provisioning)
- WRITE routes/market-delegation-team.js -> membership_capabilities (via market-delegation-team-service)
- WRITE services/market-delegation-team-service.js -> membership_capabilities (via market-delegation-service)
- WRITE services/market-operator-provisioning.js -> membership_capabilities (via market-delegation-service)
- WRITE services/market-provisioning-service.js -> membership_capabilities (via market-delegation-team-service)
- WRITE routes/admin/users.js -> operator_market_scopes (revocations) (via market-scope-admin-service)

## Multi-Writer Tables (>=2 Ã©crivains directs, hors dÃ©lÃ©gations)

- orders: 36 Ã©crivains directs â€” routes/admin-customs-shipments.js, routes/admin/delete-order-cascade.js, routes/admin/system.js, routes/orders/cancel.js, routes/orders/qr.js, routes/orders/status.js, routes/parcels.js, routes/tracking.js, services/admin-order-refund.js, services/cash-reminder-service.js, services/cost-allocation/canonical-margin-writer.js, services/customs-shipment-service.js, services/hub-v1-fixture-payment.js, services/inventory-service.js, services/order-checkout-persistence.js, services/order-checkout-service.js, services/order-cost-snapshot.js, services/order-mutation-service.js, services/order-status-machine.js, services/parcel-auto-create-service.js, services/parcelOptimizationService.js, services/payment-cash-confirm.js, services/payment-paypal.js, services/payment-service.js, services/payment-stripe.js, services/paypal-refund-authority.js, services/pickup-secret-access-service.js, services/pickup-secret-service.js, services/purchasing-admin-service.js, services/qr-collection-core.js, services/routing.js, services/sav-replacement-order.js, services/scan-operations.js, services/simulation-scope-service.js, services/stripe-refund-authority.js, services/verify-qr-collection.js
- alerts: 24 Ã©crivains directs â€” services/admin-order-refund.js, services/cash-operations.js, services/confirm-pickup-cash-payment.js, services/g6-recipe-po-cancel-service.js, services/notification-service.js, services/notifications/notification-service.js, services/order-payment-confirmation.js, services/payment-cash-confirm.js, services/payment-mobile-money.js, services/payment-paypal.js, services/payment-stripe.js, services/pickup-authorization-service.js, services/pickup-collection-service.js, services/pickup-exceptional-collection-service.js, services/product-publication-guard.js, services/purchasing-cancel-service.js, services/purchasing-completion-service.js, services/purchasing-engagement-service.js, services/purchasing-trigger-service.js, services/repair-ordered-without-purchase-orders.js, services/scan-operations.js, services/supplier-shortage-service.js, utils/alerts.js, utils/parcelSync.js
- parcels: 17 Ã©crivains directs â€” routes/admin-customs-shipments.js, routes/admin/system.js, routes/carriers.js, routes/parcels.js, routes/transitaire-api.js, services/auto-parcel.js, services/local-relay-receipt-service.js, services/parcel-auto-create-service.js, services/parcel-mutation-service.js, services/parcel-operations.js, services/parcel-security.js, services/parcelOptimizationService.js, services/purchasing-completion-service.js, services/scan-engine.js, services/simulator/cleanup.js, services/simulator/state-advancer.js, utils/parcelSync.js
- parcel_items: 13 Ã©crivains directs â€” routes/admin/system.js, routes/parcels.js, services/auto-parcel.js, services/local-relay-receipt-service.js, services/parcel-auto-create-service.js, services/parcel-item-mutation-service.js, services/parcel-operations.js, services/parcelOptimizationService.js, services/purchasing-completion-service.js, services/relay-parcel-item-reconciliation.js, services/scan-engine.js, services/simulator/cleanupm«ëŒ+Š×®º+º$zzb¥âæ§2Â6W'f–6W2÷6–×VÆF÷"÷7FFRÖGfæ6W"æ§0¢Ò&öGV7G3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â6W'f–6W2ö6FÆörÖ&÷fÂæ§2Â6W'f–6W2ö6FÆörÖ6æF–FFR×&öGV7B×6W'f–6Ræ§2Â6W'f–6W2ö6FÆörÖVç&–6†ÖVçBæ§2Â6W'f–6W2ö6FÆörÖf–VÆB×7–æ2ÖÆ–6F–öâæ§2Â6W'f–6W2ö6FÆörÖ÷fW'&–FW2æ§2Â6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2Â6W'f–6W2ö6FÆör×v÷&·76Ræ§2Â6W'f–6W2ö‡V"Ö÷W&F–öç2æ§2Â6W'f–6W2÷&öGV7BÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷&öGV7B×6·R×6W'f–6Ræ§2Â6W'f–6W2÷&öGV7B×7Fö6²×6W'f–6Ræ§2Â6W'f–6W2÷&Vf–æW'’Ög"×&V6†V6²æ§0¢Ò66ç3¢":–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–âöFVÆWFRÖ÷&FW"Ö666FRæ§2Â&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§2Â6W'f–6W2öÆö6Â×&VÆ’×&V6V—B×6W'f–6Ræ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×&V6÷&FW"æ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×6W'f–6Ræ§2Â6W'f–6W2÷&VÆ’×&6VÂÖ—FVÒ×&V6öæ6–Æ–F–öâæ§2Â6W'f–6W2÷66âÖ÷W&F–öç2æ§2Â6W'f–6W2÷66â×w&—FR×6W'f–6Ræ§2Â6W'f–6W2÷6–×VÆF÷"ö6ÆVçWæ§2Â6W'f–6W2÷6–×VÆF÷"÷7FFRÖGfæ6W"æ§2Â6W'f–6W2÷fW&–g’×"Ö6öÆÆV7F–öâæ§2ÂWF–Ç2÷&6VÅ7–æ2æ§0¢Ò÷&FW%÷7FGW5ö†—7F÷'“¢:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–âöFVÆWFRÖ÷&FW"Ö666FRæ§2Â&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFÖ–â÷W6W'2æ§2Â&÷WFW2ö÷&FW'2ö6æ6VÂæ§2Â6W'f–6W2ö‡V"×cÖf—‡GW&R×–ÖVçBæ§2Â6W'f–6W2ö÷&FW"Ö6†V6¶÷WB×W'6—7FVæ6Ræ§2Â6W'f–6W2ö÷&FW"Ö6†V6¶÷WB×6W'f–6Ræ§2Â6W'f–6W2ö÷&FW"×7FGW2ÖÖ6†–æRæ§2Â6W'f–6W2÷—Â×&VgVæBÖWF†÷&—G’æ§2Â6W'f–6W2÷7G&—R×&VgVæBÖWF†÷&—G’æ§0¢Òæ÷F–f–6F–öåöÆös¢’:–7&—f–ç2F—&V7G2(	B6W'f–6W2öæ÷F–f–6F–öâ×6W'f–6Ræ§2Â6W'f–6W2öæ÷F–f–6F–öç2ö–çFW&æÇ2æ§2Â6W'f–6W2öæ÷F–f–6F–öç2öÆ÷–ÇG’æ§2Â6W'f–6W2öæ÷F–f–6F–öç2öÖ—62æ§2Â6W'f–6W2öæ÷F–f–6F–öç2öæ÷F–f–6F–öâ×6W'f–6Ræ§2Â6W'f–6W2öæ÷F–f–6F–öç2ö÷&FW"æ§2Â6W'f–6W2öæ÷F–f–6F–öç2ö÷GÖWF‚æ§2Â6W'f–6W2öæ÷F–f–6F–öç2÷&6VÂæ§2Â6W'f–6W2÷6–×VÆF÷"÷7FFRÖGfæ6W"æ§0¢Ò÷&FW%ö—FV×3¢’:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–âöFVÆWFRÖ÷&FW"Ö666FRæ§2Â&÷WFW2öFÖ–â÷7—7FVÒæ§2Â6W'f–6W2ö÷&FW"Ö6†V6¶÷WB×W'6—7FVæ6Ræ§2Â6W'f–6W2ö÷&FW"Ö6†V6¶÷WB×6W'f–6Ræ§2Â6W'f–6W2ö÷&FW"Ö—FVÒÖf–Æ&–Æ—G’×6W'f–6Ræ§2Â6W'f–6W2ö÷&FW"Ö—FVÒ×&VgVæB×6WGFÆVÖVçBæ§2Â6W'f–6W2ö÷&FW"×7FGW2ÖÖ6†–æRæ§2Â6W'f–6W2÷6b×&WÆ6VÖVçBÖ÷&FW"æ§2Â6W'f–6W2÷66âÖVæv–æRæ§0¢Ò7WÆ–W%öW†V7WF–öåöWfVçG3¢’:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷7WÆ–W"ÖW†V7WF–öâ×W'6—7FVæ6Ræ§2Â6W'f–6W2÷7WÆ–W"×–ÖVçBÖ÷&6†W7G&F÷"æ§2Â6W'f–6W2÷7WÆ–W"×–ÖVçB×&ööb×W'6—7FVæ6Ræ§2Â6W'f–6W2÷7WÆ–W"×–ÖVçB×7FFRæ§2Â6W'f–6W2÷7WÆ–W'2ö6¢Ö&–ÆÆ–ærÖ†—7F÷'’×&V6öæ6–Æ–F–öâæ§2Â6W'f–6W2÷7WÆ–W'2ö6¢×–ÖVçB×&V6÷fW'’æ§2Â6W'f–6W2÷7WÆ–W'2ö6¢×7WÆ–W"×–ÖVçB×'VçF–ÖRæ§2Â6W'f–6W2÷7WÆ–W'2÷7WÆ–W"ÖgVÆf–ÆÆÖVçB×W'6—7FVæ6Ræ§2Â6W'f–6W2÷7WÆ–W'2÷7WÆ–W"ÖgVÆf–ÆÆÖVçB×'VçF–ÖRæ§0¢Ò–æ6–FVçG3¢r:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö–æ6–FVçBÖW66ÆF–öâæ§2Â6W'f–6W2ö–æ6–FVçB×6W'f–6Ræ§2Â6W'f–6W2ö–æ6–FVçB×w&—FR×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖ6ö×ÆWF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖVævvVÖVçB×6W'f–6Ræ§2Â6W'f–6W2÷&VÆ’×6†—ÖVçB×&V6V—Bæ§2Â6W'f–6W2÷7WÆ–W"×6†÷'FvR×6W'f–6Ræ§0¢Ò–6·W÷&–çE÷Fö¶Vç3¢r:–7&—f–ç2F—&V7G2(	B&ö÷G7G&ö7&öç2æ§2Â&÷WFW2÷–6·W×6V7&WBæ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×&V6÷&FW"æ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WBÖ66W72×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WBÖ7W7FöÖW"×&÷FF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WB×&÷FF–öâ×6W'f–6Ræ§0¢Ò–6·W÷&WfVÅö6öFW3¢r:–7&—f–ç2F—&V7G2(	B&ö÷G7G&ö7&öç2æ§2Â&÷WFW2÷–6·W×6V7&WBæ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×&V6÷&FW"æ§2Â6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WBÖ66W72×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WBÖ7W7FöÖW"×&÷FF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷–6·W×6V7&WB×&÷FF–öâ×6W'f–6Ræ§0¢ÒW&6†6UöÆ–æW3¢r:–7&—f–ç2F—&V7G2(	B6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6RÖÆ–æR×6æ6†÷Bæ§2Â6W'f–6W2÷W&6†6–ærÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖ6æ6VÂ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖVævvVÖVçB×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖw&÷WVB×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ær×G&–vvW"×6W'f–6Ræ§0¢Ò&VgVæEöW†V7WF–öåö–çFVçG3¢r:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö—FVÒ×&VgVæB×7Ö÷&6†W7G&F÷"æ§2Â6W'f–6W2ö—FVÒ×&VgVæB×&W6W'fF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷—Â×&VgVæBÖWF†÷&—G’æ§2Â6W'f–6W2÷&VgVæBÖ–çFVçBÖÆVFvW"æ§2Â6W'f–6W2÷&VgVæBÖ–çFVçB×&V6öæ6–Æ–F–öâæ§2Â6W'f–6W2÷6bÖÆVFvW"×&VgVæBæ§2Â6W'f–6W2÷7G&—R×&VgVæBÖWF†÷&—G’æ§0¢Ò&6VÅöWfVçG3¢b:–7&—f–ç2F—&V7G2(	B6W'f–6W2öÆö6Â×&VÆ’×&V6V—B×6W'f–6Ræ§2Â6W'f–6W2÷&6VÂÖ—FVÒÖ×WFF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷&6VÂ×6V7W&—G’æ§2Â6W'f–6W2÷&6VÂ×6†—ÖVçBÖ†æF÷fW"æ§2Â6W'f–6W2÷&VÆ’×&6VÂÖ—FVÒ×&V6öæ6–Æ–F–öâæ§2ÂWF–Ç2÷&6VÅ7–æ2æ§0¢ÒW&6†6Uö÷&FW'3¢b:–7&—f–ç2F—&V7G2(	B6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖ6æ6VÂ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖ6ö×ÆWF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖVævvVÖVçB×6W'f–6Ræ§2Â6W'f–6W2÷W&6†6–ærÖw&÷WVB×6W'f–6Ræ§0¢Ò66åöWfVçG3¢b:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFÖ–â÷W6W'2æ§2Â&÷WFW2÷G&ç6—F—&RÖ’æ§2Â6W'f–6W2ö‡V"Ö÷W&F–öç2æ§2Â6W'f–6W2÷&6VÂÖWFòÖ7&VFR×6W'f–6Ræ§2Â6W'f–6W2÷66âÖVæv–æRæ§0¢Ò6†&VEö6'EöWfVçG3¢b:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6'B×6†&R×6W'f–6Ræ§2Â6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Â6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Â6W'f–6W2÷6†&VBÖ6'BÖ–çFW&æÇ2æ§2Â6W'f–6W2÷6†&VBÖ6'BÖÆ–fV7–6ÆRæ§2Â6W'f–6W2÷6†&VBÖ6'B×VW&–W2æ§0¢Ò6–væÇ3¢b:–7&—f–ç2F—&V7G2(	B&ö÷G7G&ö7&öç2æ§2Â&÷WFW2övVçBÖ7F–öâÖ6VçFW"æ§2Â6W'f–6W2ö7F–öâÖ6VçFW"ÖvVçB×66÷Ræ§2Â6W'f–6W2ö÷&FW"Öf–ææ6–ÂÖ6Æ÷7W&R×6–væÂæ§2Â6W'f–6W2÷6–væÂÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷6–væÂ×6W'f–6Ræ§0¢Ò7WÆ–W%öW†V7WF–öå÷–ÖVçG3¢b:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷7WÆ–W"×–ÖVçBÖ÷&6†W7G&F÷"æ§2Â6W'f–6W2÷7WÆ–W"×–ÖVçB×&ööb×W'6—7FVæ6Ræ§2Â6W'f–6W2÷7WÆ–W"×–ÖVçB×7FFRæ§2Â6W'f–6W2÷7WÆ–W'2ö6¢Ö&–ÆÆ–ærÖ†—7F÷'’×&V6öæ6–Æ–F–öâæ§2Â6W'f–6W2÷7WÆ–W'2ö6¢×–ÖVçB×&V6÷fW'’æ§2Â6W'f–6W2÷7WÆ–W'2ö6¢×7WÆ–W"×–ÖVçB×'VçF–ÖRæ§0¢ÒG&ç67F–öåöFö7VÖVçG3¢b:–7&—f–ç2F—&V7G2(	B&÷WFW2öFö7VÖVçG2æ§2Â6W'f–6W2öFö7VÖVçG2ö7W7Fö×2Ö–çfö–6Ræ§2Â6W'f–6W2öFö7VÖVçG2öFö7VÖVçB×6W'f–6Ræ§2Â6W'f–6W2öFö7VÖVçG2÷–6·W×&ööbæ§2Â6W'f–6W2öFö7VÖVçG2÷&VgVæB×&V6V—Bæ§2Â6W'f–6W2öFö7VÖVçG2÷vÆÆWB×&V6V—Bæ§0¢Òf–ææ6Uö6öæf–s¢R:–7&—f–ç2F—&V7G2(	B&ö÷G7G&÷7F'GWÖÖ–w&F–öç2æ§2Â&÷WFW2öFÖ–âÖ6÷7F–æræ§2Â&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§2Â6W'f–6W2öV6öæöÖ–2Ö6öæf–ræ§2Â6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§0¢Ò–çfö–6W3¢R:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFö7VÖVçG2æ§2Â&÷WFW2ö–çfö–6W2æ§2Â6W'f–6W2ö–çfö–6R×6W'f–6Ræ§2Â6W'f–6W2ö÷&FW"×–ÖVçBÖ6öæf—&ÖF–öâæ§0¢ÒÖ&¶WEöFVÆVvF–öåöVF—C¢R:–7&—f–ç2F—&V7G2(	BÖ–FFÆWv&R÷&WV—&RÖÖ&¶WBÖFVÆVvFVBÖ6&–Æ—G’æ§2ÂÖ–FFÆWv&R÷&WV—&RÖÖ&¶WBÖW†V7WF–öâÖ6&–Æ—G’æ§2Â6W'f–6W2ö66‚ÖFW÷6—B×6W'f–6Ræ§2Â6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2Â6W'f–6W2öÖ&¶WB×G&ç7÷'B×6ÆR×&FRÖ6öÖÖæBæ§0¢Ò÷&FW%ö—FVÕ÷&VÅö6÷7EöÆÆö6F–öç3¢R:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6÷7BÖÆÆö6F–öâöÆÆö6FRæ§2Â6W'f–6W2ö6÷7BÖÆÆö6F–öâö–æFW‚æ§2Â6W'f–6W2ö6÷7BÖÆÆö6F–öâöÖçVÂÖ6÷7BÖVçG'’×6W'f–6Ræ§2Â6W'f–6W2ö7W7Fö×2×6†—ÖVçB×6W'f–6Ræ§2Â6W'f–6W2÷G&ç7÷'BÖ6÷7BÖÆÆö6F–öâæ§0¢Ò6†&VEö6'G3¢R:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6'B×6†&R×6W'f–6Ræ§2Â6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Â6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Â6W'f–6W2÷6†&VBÖ6'BÖÆ–fV7–6ÆRæ§2Â6W'f–6W2÷6†&VBÖ6'B×VW&–W2æ§0¢Ò6÷W&6–æu÷6÷W&6W3¢R:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷&÷f–FW"Ö7&VFVçF–Â×6W'f–6Ræ§2Â6W'f–6W2÷6÷W&6–ærÖö'6W'fF–öâ×6†F÷r×6W'f–6Ræ§2Â6W'f–6W2÷6÷W&6–ær×&÷f–FW"Ö6öçG&öÂ×öÆ–7’æ§2Â6W'f–6W2÷6÷W&6–ær×6÷W&6RÖWF÷–Æ÷Bæ§2Â6W'f–6W2÷6÷W&6–ær×6÷W&6R×&Vv—7G'’æ§0¢ÒW6W'3¢R:–7&—f–ç2F—&V7G2(	B&ö÷G7G&÷7F'GWÖÖ–w&F–öç2æ§2Â&÷WFW2öWF‚æ§2Â&÷WFW2ö6Æ–VçBÖWF‚æ§2Â&÷WFW2ö÷Gæ§2Â6W'f–6W2÷W6W"Ö×WFF–öâ×6W'f–6Ræ§0¢Ò&6¶WEö—FV×3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Â6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Â6W'f–6W2÷6†&VBÖ6'B×W6W"Ö6ÆVçWæ§0¢Ò&6¶WG3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â6W'f–6W2÷6†&VBÖ6'BÖ7&VF–öâæ§2Â6W'f–6W2÷6†&VBÖ6'BÖVæv–æRæ§2Â6W'f–6W2÷6†&VBÖ6'B×W6W"Ö6ÆVçWæ§0¢Ò66…ö6öæf—&ÖF–öåö6öçG&öÇ3¢B:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö66‚Ö6öæf—&ÖF–öâÖ6öçG&öÂ×6W'f–6Ræ§2Â6W'f–6W2ö66‚Ö÷W&F–öç2æ§2Â6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2Â6W'f–6W2÷–ÖVçBÖ66‚Ö6öæf—&Òæ§0¢Ò6FÆöuöÖVF–¢B:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2Â6W'f–6W2ö6FÆör×&öÖ÷F–öâæ§2Â6W'f–6W2ö6FÆör×f—7VÂÖg"Ö‡VÖâ×&Wf–Wr×w&—FRæ§2Â6W'f–6W2ö6FÆör×v÷&·76Ræ§0¢Ò&öGV7E÷6·W3¢B:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6FÆör×&öÖ÷F–öâæ§2Â6W'f–6W2ö6FÆör×7Fö6²×7–æ2ÖÆ–6F–öâæ§2Â6W'f–6W2÷&öGV7B×6·R×6W'f–6Ræ§2Â6W'f–6W2÷&öGV7B×7Fö6²×6W'f–6Ræ§0¢Ò&öGV7E÷f&–çG3¢B:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2Â6W'f–6W2ö6FÆör×&öÖ÷F–öâæ§2Â6W'f–6W2÷&öGV7B×7Fö6²×6W'f–6Ræ§2Â6W'f–6W2÷&öGV7B×f&–çB×6W'f–6Ræ§0¢Ò&VgVæG3¢B:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö—FVÒ×&VgVæB×7Ö÷&6†W7G&F÷"æ§2Â6W'f–6W2÷—Â×&VgVæBÖWF†÷&—G’æ§2Â6W'f–6W2÷&VgVæB×6W'f–6Ræ§2Â6W'f–6W2÷7G&—R×&VgVæBÖWF†÷&—G’æ§0¢Ò6÷W&6–æuö6æF–FFW3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2÷6÷W&6–ær×66ææW"æ§2Â6W'f–6W2÷6÷W&6–ærÖ6æF–FFRÖ7F–öç2æ§2Â6W'f–6W2÷6÷W&6–ærÖ6æF–FFRÖ–×÷'B×6W'f–6Ræ§2Â6W'f–6W2÷7WÆ–W'2ö6FÆörÖ–×÷'BÖ§6öâæ§0¢Ò7WÆ–W%ööWF…ö6öææV7F–öç3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2ö–çFVw&F–öç2ÖÆ–W‡&W72æ§2Â6W'f–6W2÷7WÆ–W'2öÆ–W‡&W72ÖöWF‚æ§2Â6W'f–6W2÷7WÆ–W'2öÆÆVw&ò×6æF&÷‚Ö6Æ–VçBæ§2Â6W'f–6W2÷7WÆ–W'2ö6öææV7F÷'2öÆ–W‡&W72Ö6öææV7FVBÖ6öææV7F÷"æ§0¢ÒvÆÆWE÷G&ç67F–öç3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFÖ–â÷W6W'2æ§2Â&÷WFW2÷vÆÆWBæ§2Â6W'f–6W2÷vÆÆWB×6W'f–6Ræ§0¢ÒvÆÆWG3¢B:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFÖ–â÷W6W'2æ§2Â&÷WFW2÷vÆÆWBæ§2Â6W'f–6W2÷vÆÆWB×6W'f–6Ræ§0¢Ò66…ö6öÆÆV7F–öç3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö66‚Ö÷W&F–öç2æ§2Â6W'f–6W2ö6öæf—&Ò×–6·WÖ66‚×–ÖVçBæ§2Â6W'f–6W2÷–ÖVçBÖ66‚Ö6öæf—&Òæ§0¢Ò6FÆöuöf–VÆEö÷fW'&–FW3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö6FÆörÖ÷fW'&–FW2æ§2Â6W'f–6W2÷&öGV7BÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷&Vf–æW'’Ög"×&V6†V6²æ§0¢Ò6†&vW3¢2:–7&—f–ç2F—&V7G2(	B&ö÷G7G&÷7F'GWÖÖ–w&F–öç2æ§2Â6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§2Â6W'f–6W2öÖ&¶WB×7G'V7GW&RÖ6†&vR×&VfW&Væ6Ræ§0¢Òf–ææ6–ÅöÖ÷fVÖVçEöFö7VÖVçG3¢2:–7&—f–ç2F—&V7G2(	B&ö÷G7G&ö7&öç2æ§2Â6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂ×&ö¦V7F÷'2æ§2Â6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂæ§0¢Òf–ææ6–ÅöÖ÷fVÖVçG3¢2:–7&—f–ç2F—&V7G2(	B&ö÷G7G&ö7&öç2æ§2Â6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂ×&ö¦V7F÷'2æ§2Â6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂæ§0¢Ò–çFW&æF–öæÅ÷6†—ÖVçEöWfVçG3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2ö‡V"Ö&÷‚×6†—ÖVçB×6W'f–6Ræ§2Â6W'f–6W2ö–çFW&æF–öæÂ×6†—ÖVçBÖ¦÷W&æW’æ§2Â6W'f–6W2÷&VÆ’×6†—ÖVçB×&V6V—Bæ§0¢Ò÷&FW%ö6öÖÖVçG3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2ö‡V"ÖF6†&ö&Bæ§2Â&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§2Â6W'f–6W2ö÷W&F–öç2×v÷&·76Ræ§0¢Ò÷Gö6öFW3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öWF‚×7FW×WÖ÷Gæ§2Â&÷WFW2ö÷Gæ§2Â6W'f–6W2ösb×7Fv–ærÖ'W–W"Ö–FVçF—G’ÖwV&Bæ§0¢Ò&–6Uö†—7F÷'“¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2öV6öæöÖ–2×&–6RÖVF—B×6W'f–6Ræ§2Â6W'f–6W2÷&–6–ærÖÇ’æ§2Â6W'f–6W2÷&–6–ær×7G&FVw’×6W'f–6Ræ§0¢Ò&VÆ—3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â6W'f–6W2÷&VÆ—2Ö×WFF–öâ×6W'f–6Ræ§2Â6W'f–6W2÷&÷WF–æræ§0¢Ò6×5öÆös¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–âöFVÆWFRÖ÷&FW"Ö666FRæ§2Â&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2öFÖ–â÷W6W'2æ§0¢Ò6÷W&6–æuö6GW&W3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷6÷W&6–ærÖ6FÆörÖ6†ævRÖö'6W'fF–öâæ§2Â6W'f–6W2÷6÷W&6–ærÖö'6W'fF–öâ×6†F÷r×6W'f–6Ræ§2Â6W'f–6W2÷6÷W&6–ær×6÷W&6RÖWF÷–Æ÷Bæ§0¢Ò6÷W&6–æu÷&÷f–FW%ö6öçG&öÅöWfVçG3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷&÷f–FW"Ö7&VFVçF–Â×6W'f–6Ræ§2Â6W'f–6W2÷6÷W&6–ær×&÷f–FW"Ö6öçG&öÂ×öÆ–7’æ§2Â6W'f–6W2÷6÷W&6–ær×6÷W&6R×&Vv—7G'’æ§0¢Ò7WÆ–W%öW†V7WF–öå÷–ÖVçE÷&öög3¢2:–7&—f–ç2F—&V7G2(	B6W'f–6W2÷7WÆ–W"×–ÖVçB×&ööb×W'6—7FVæ6Ræ§2Â6W'f–6W2÷7WÆ–W'2ö6¢Ö&–ÆÆ–ærÖ†—7F÷'’×&V6öæ6–Æ–F–öâæ§2Â6W'f–6W2÷7WÆ–W'2ö6¢×7WÆ–W"×–ÖVçB×'VçF–ÖRæ§0¢Ò7WÆ–W'3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2÷W&6†6–æræ§2Â6W'f–6W2÷W&6†6–ærÖFÖ–â×6W'f–6Ræ§2Â6W'f–6W2÷7WÆ–W'2ö6VçG&ÂÖ‡V"×7WÆ–W"æ§0¢ÒvÆÆWEö6öç7V×F–öç3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2÷vÆÆWBæ§2Â6W'f–6W2÷vÆÆWB×6W'f–6Ræ§0¢ÒvÆÆWEö7&VF—EöÆ÷G3¢2:–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â÷7—7FVÒæ§2Â&÷WFW2÷vÆÆWBæ§2Â6W'f–6W2÷vÆÆWB×6W'f–6Ræ§0¢Ò76–væÖVçEöÖVÖ&W'6†—3¢":–7&—f–ç2F—&V7G2(	B6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2Â6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§0¢Ò'W6–æW75÷'VÆW3¢":–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â×'VÆW2æ§2ÂWF–Ç2÷'VÆW2æ§0¢Ò'W6–æW75÷'VÆW5ö†—7F÷'“¢":–7&—f–ç2F—&V7G2(	B&÷WFW2öFÖ–â×'VÆW2æ§2ÂWF–Ç2÷'VÆW2æ§0 ¢22D"w&—FRòw&—FRÕf–÷fW&Æv&æ–æw0 ¢Ò&÷WFW2÷6÷W&6–ær×66ææW"æ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ6÷W&6–æuö6æF–FFW0¢Ò6W'f–6W2ö7W7Fö×2×6†—ÖVçB×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ÷&FW%ö—FVÕ÷&VÅö6÷7EöÆÆö6F–öç0¢Ò6W'f–6W2ösb×&V6—R×òÖ6æ6VÂ×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–ÓâÆW'G0¢Ò6W'f–6W2öÆö6Â×&VÆ’×&V6V—B×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ&6VÇ2Â&6VÅö—FV×2Â&6VÅöWfVçG0¢Ò6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ76–væÖVçEöÖVÖ&W'6†—0¢Ò6W'f–6W2ö÷&FW"Öf–ææ6–ÂÖ6Æ÷7W&R×6–væÂæ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ6–væÇ0¢Ò6W'f–6W2÷–6·WÖ6öÆÆV7F–öâ×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ–6·W÷&–çE÷Fö¶Vç2Â–6·W÷&WfVÅö6öFW2Â66ç0¢Ò6W'f–6W2÷–6·WÖW†6WF–öæÂÖ6öÆÆV7F–öâ×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–ÓâÆW'G0¢Ò6W'f–6W2÷–6·W×6V7&WBÖ66W72×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ÷&FW'0¢Ò6W'f–6W2÷–6·W×6V7&WB×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ÷&FW'0¢Ò6W'f–6W2÷&öGV7BÖFÖ–â×6W'f–6Ræ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ&öGV7G0¢Ò6W'f–6W2÷6–×VÆF÷"÷7FFRÖGfæ6W"æ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ&6VÇ0¢Ò6W'f–6W2÷6÷W&6–ær×6÷W&6RÖWF÷–Æ÷Bæ§3¢F&ÆR‡2’L:–6Æ,:–R‡2’:Æfö—2VâF"×w&—FRF—&V7BWBF"×w&—FR×f–Óâ6÷W&6–æu÷6÷W&6W2Â6÷W&6–æuö6GW&W0 ¢22Vç&W6öÇfVB6öFRVFvW0 ¢ÒW6W3¢‡6VRf–ÆW2çFW7G2–âfVGW&W2÷W&6†6–æræfVGW&Ræ§2(	Bæ÷B–WBÓâ6W'f–6W2÷7WÆ–W'2÷W&6†6–ær×fÆ–FF÷'2æ§2‚‡6VRf–ÆW2çFW7G2–âfVGW&W2÷W&6†6–æræfVGW&Ræ§2(	Bæ÷B–WB¢ÒW6W3¢66÷VçF–ærv÷&·76RÓâ6W'f–6W2öf–ææ6–ÂÖ¦÷W&æÂ×&W÷'F–æræ§2†66÷VçF–ærv÷&·76R¢ÒW6W3¢FÖ–âÖF6†&ö&BÓâ&÷WFW2öFÖ–âÖ&÷WF—VRÖ6FVv÷&–W2æ§2†FÖ–âÖF6†&ö&B¢ÒW6W3¢FÖ–âÖF6†&ö&G2Óâ&÷WFW2öV6öæöÖ–2æ§2†FÖ–âÖF6†&ö&G2¢ÒW6W3¢FÖ–âÖF6†&ö&G2Óâ6W'f–6W2öV6öæöÖ–2ÖVæv–æR×VW&–W2æ§2†FÖ–âÖF6†&ö&G2¢ÒW6W3¢FÖ–âÖfÆ÷w2Óâ6W'f–6W2ö÷&FW"×7FGW2ÖÖ6†–æRæ§2†FÖ–âÖfÆ÷w2¢ÒW6W3¢Æ”W‡&W72æB4¢F—66÷fW'’÷7G&W72—VÆ–æW2Óâ6W'f–6W2÷7WÆ–W'2öF—66÷fW'’×6VÖçF–2×&VÆWfæ6Ræ§2„Æ”W‡&W72æB4¢F—66÷fW'’÷7G&W72—VÆ–æW2¢ÒW6W3¢ÆÂÖ&÷WF—VRÖ§2ÖÖöGVÆW2ÓâV&Æ–2ö&÷WF—VRö§2ö"×7F÷&Ræ§2†ÆÂÖ&÷WF—VRÖ§2ÖÖöGVÆW2¢ÒW6W3¢ÆÂÖ&÷WF—VRÖ§2ÖÖöGVÆW2ÓâV&Æ–2ö&÷WF—VRö§2ö"×WF–Ç2æ§