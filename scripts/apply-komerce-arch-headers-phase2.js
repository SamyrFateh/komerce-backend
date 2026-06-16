'use strict';

/**
 * Applies @komerce-arch headers to second-wave Komerce files.
 *
 * Idempotent: files that already contain @komerce-arch are skipped.
 * Documentation-only: the script only prepends comments and does not alter code behavior.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const HEADERS = {
  'public/boutique/js/b-modal-core.js': `/**
 * @komerce-arch
 * @role          product-modal-orchestrator
 * @domain        boutique
 * @layer         ui-component
 * @criticality   high
 * @inputs        product_id, product_data, cart_state, modal_events
 * @outputs       product_detail_modal, add_to_cart_path, suggestions_slot, modal_lifecycle
 * @depends       b-store.js, b-cart.js, b-cart-core.js, b-modal-product.js, b-modal-suggestions.js, b-modal-nav.js, b-modal-cart.js, b-modal-image-ux.js, routes/products.js
 * @used-by       b-modal.js, b-catalog.js, b-subcat.js, b-cart.js
 * @doctrine      participant_peut_verifier, boutique_preuve_confiance, modal_produit_sans_chevauchement
 * @impact-areas  product-discovery, participant-flow, creator-flow, modal-layout, cart, suggestions
 * @version       2026-06
 */`,

  'public/boutique/js/b-modal-desktop-enhancers.js': `/**
 * @komerce-arch
 * @role          desktop-product-modal-enhancer
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   high
 * @inputs        modal_state, product_view_model, desktop_viewport, bus_events
 * @outputs       desktop_modal_layout, contract_classes, enhanced_actions
 * @depends       b-bus.js, b-catalog.js, b-modal.js, b-scroll-owner.js, view-models/modal-view-model.js
 * @used-by       boutique.js, b-modal-core.js
 * @doctrine      modal_produit_sans_chevauchement, desktop_premium, participant_peut_verifier
 * @impact-areas  modal-desktop, product-discovery, side-cart-layout, responsive-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-modal-product.js': `/**
 * @komerce-arch
 * @role          product-modal-content-renderer
 * @domain        boutique
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product, variant_state, media_state
 * @outputs       modal_product_content, carousel_state, product_detail_sections
 * @depends       b-store.js, b-utils.js, b-bus.js
 * @used-by       b-modal-core.js
 * @doctrine      boutique_preuve_confiance, fiche_produit_lisible, modal_produit_sans_chevauchement
 * @impact-areas  product-modal, product-discovery, participant-verification, media-carousel
 * @version       2026-06
 */`,

  'public/boutique/js/b-pager.js': `/**
 * @komerce-arch
 * @role          mobile-category-pager
 * @domain        catalog
 * @layer         ui-state
 * @criticality   high
 * @inputs        category_sections, scroll_state, viewport, modal_events
 * @outputs       horizontal_pager_state, active_chip_sync, section_auto_advance
 * @depends       b-bus.js, b-scroll-owner.js, b-store.js
 * @used-by       b-catalog.js, b-subcat.js, b-nav.js
 * @doctrine      navigation_sans_friction, categorie_souscategorie_switch_fluide, mobile_desktop_coherence
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership, product-grid
 * @version       2026-06
 */`,

  'public/boutique/js/b-catalog-desktop-enhancers.js': `/**
 * @komerce-arch
 * @role          desktop-catalog-enhancer
 * @domain        catalog
 * @layer         ui-enhancer
 * @criticality   high
 * @inputs        catalog_state, desktop_viewport, view_events
 * @outputs       desktop_sidebar_sync, merch_cards, promo_strip, category_focus
 * @depends       b-bus.js, b-catalog.js, b-scroll-owner.js, controllers/home-controller.js, shop-schema.js
 * @used-by       boutique.js
 * @doctrine      boutique_canal_decouverte, desktop_premium, navigation_sans_friction
 * @impact-areas  desktop-catalog, category-navigation, home-layout, side-cart-layout
 * @version       2026-06
 */`,

  'public/boutique/js/view-models/modal-view-model.js': `/**
 * @komerce-arch
 * @role          product-modal-view-model
 * @domain        boutique
 * @layer         view-model
 * @criticality   high
 * @inputs        product, cart_context, media_context, viewport
 * @outputs       modal_classes, display_sections, action_visibility
 * @depends       b-utils.js
 * @used-by       b-modal-desktop-enhancers.js, b-modal-core.js
 * @doctrine      fiche_produit_lisible, modal_contract_stable, desktop_premium
 * @impact-areas  product-modal, layout-contract, product-discovery
 * @version       2026-06
 */`,

  'public/boutique/js/event-manage.js': `/**
 * @komerce-arch
 * @role          collective-workspace-manager
 * @domain        collective-workspace
 * @layer         ui-page
 * @criticality   medium
 * @inputs        workspace_id, auth_context, workspace_mutations
 * @outputs       workspace_admin_view, participant_links, management_actions
 * @depends       routes/collective-workspaces.js
 * @used-by       event-management-pages
 * @doctrine      workspace_partage_lisible, lien_public_controle, action_createur_tracee
 * @impact-areas  collective-workspaces, event-flow, creator-management
 * @version       2026-06
 */`,

  'public/boutique/js/event-public.js': `/**
 * @komerce-arch
 * @role          collective-workspace-public-view
 * @domain        collective-workspace
 * @layer         ui-page
 * @criticality   medium
 * @inputs        public_workspace_token, visitor_context
 * @outputs       public_workspace_view, participant_actions
 * @depends       routes/collective-workspaces.js
 * @used-by       public_event_links
 * @doctrine      consultation_publique_sans_friction, lien_public_controle
 * @impact-areas  event-flow, participant-flow, public-sharing
 * @version       2026-06
 */`,

  'public/boutique/js/b-mini-cart.js': `/**
 * @komerce-arch
 * @role          mini-cart-summary
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        cart_state, cart_update_events
 * @outputs       compact_cart_summary, quick_cart_feedback
 * @depends       b-cart-core.js, b-store.js, b-utils.js
 * @used-by       boutique.js, cart-surfaces
 * @doctrine      side_cart_non_intrusif, panier_visible_sans_friction
 * @impact-areas  cart, side-cart, checkout-entry, responsive-layout
 * @version       2026-06
 */`,

  'public/boutique/js/group/group-render-creator.js': `/**
 * @komerce-arch
 * @role          shared-cart-creator-renderer
 * @domain        shared-cart
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        group_state, creator_permissions, contributions, cart_items
 * @outputs       creator_actions, articles_panel, progress_view, cart_switcher
 * @depends       group/group-helpers.js, group/group-state.js, b-utils.js
 * @used-by       b-group-view.js
 * @doctrine      createur_decide_gap, estimations_indicatives, participant_lecture_seule
 * @impact-areas  creator-flow, shared-cart-dashboard, participant-summary, gap-resolution
 * @version       2026-06
 */`,

  'public/boutique/js/b-tracking.js': `/**
 * @komerce-arch
 * @role          order-tracking-view
 * @domain        tracking
 * @layer         ui-page
 * @criticality   high
 * @inputs        order_reference, phone, otp_code, client_session
 * @outputs       tracking_view, order_history, timeline, otp_state
 * @depends       b-phone.js, b-utils.js, b-cart-core.js, routes/otp.js, routes/orders.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      otp_une_fois, suivi_client_simple, reference_commande_lisible
 * @impact-areas  tracking, auth, orders, participant-flow, customer-support
 * @version       2026-06
 */`,

  'public/boutique/js/komerce-api.js': `/**
 * @komerce-arch
 * @role          boutique-api-client
 * @domain        boutique
 * @layer         api-client
 * @criticality   high
 * @inputs        api_requests, credentials, payloads
 * @outputs       normalized_api_responses, api_errors
 * @depends       backend_api
 * @used-by       boutique.js, public/boutique/index.html, feature_modules
 * @doctrine      api_frontend_unique, credentials_preserved, errors_lisibles
 * @impact-areas  all-boutique-api, checkout, catalog, tracking, shared-cart
 * @version       2026-06
 */`,

  'public/boutique/js/b-checkout-render.js': `/**
 * @komerce-arch
 * @role          checkout-dom-renderer
 * @domain        checkout
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        order_data, identity, relay_options, payment_state
 * @outputs       checkout_form_dom, identity_recap, success_dom, confirm_button_state
 * @depends       b-utils.js
 * @used-by       b-checkout.js, b-share-cart.js
 * @doctrine      checkout_sans_friction, otp_une_fois, rendu_sans_logique_metier
 * @impact-areas  checkout, otp, relais, payment-ui, order-success
 * @version       2026-06
 */`,

  'public/boutique/js/b-phone.js': `/**
 * @komerce-arch
 * @role          phone-normalization-ui
 * @domain        auth
 * @layer         util-ui
 * @criticality   high
 * @inputs        country_code, local_digits, phone_input
 * @outputs       normalized_phone, e164_phone, validation_state, phone_dom
 * @depends       none
 * @used-by       b-checkout.js, b-identity.js, b-tracking.js, b-share-cart.js
 * @doctrine      phone_normalization, format_local_lisible, otp_une_fois
 * @impact-areas  otp, checkout, tracking, shared-cart-access, identity
 * @version       2026-06
 */`,

  'public/boutique/js/shop-schema.js': `/**
 * @komerce-arch
 * @role          boutique-taxonomy-schema
 * @domain        catalog
 * @layer         schema
 * @criticality   high
 * @inputs        category_keys, db_categories, subcategory_config
 * @outputs       normalized_categories, section_order, icons, subcategories
 * @depends       none
 * @used-by       b-catalog.js, b-subcat.js, b-cart.js, b-desktop-sidebar.js, renderers
 * @doctrine      taxonomy_source_unique, categories_sans_hardcode_metier, navigation_sans_friction
 * @impact-areas  catalog, category-navigation, product-grid, admin-category-config
 * @version       2026-06
 */`,

  'public/boutique/js/b-identity.js': `/**
 * @komerce-arch
 * @role          boutique-client-identity
 * @domain        auth
 * @layer         ui-service
 * @criticality   high
 * @inputs        phone, name, otp_code, session_cookie
 * @outputs       client_identity, otp_modal_state, authenticated_session
 * @depends       b-phone.js, b-utils.js, routes/otp.js
 * @used-by       b-checkout.js, b-share-cart.js, b-group-view.js
 * @doctrine      otp_une_fois, session_client_legere, premiere_commande_sans_friction
 * @impact-areas  checkout, shared-cart, tracking, auth, participant-flow
 * @version       2026-06
 */`,

  'public/boutique/js/controllers/home-controller.js': `/**
 * @komerce-arch
 * @role          boutique-home-navigation-controller
 * @domain        catalog
 * @layer         controller
 * @criticality   high
 * @inputs        category_clicks, chip_state, viewport, render_callbacks
 * @outputs       active_category, centered_chip, subcategory_rail, home_refresh
 * @depends       b-store.js, shop-schema.js
 * @used-by       b-catalog.js, b-catalog-desktop-enhancers.js
 * @doctrine      navigation_sans_friction, categorie_souscategorie_switch_fluide, desktop_mobile_coherence
 * @impact-areas  home-navigation, category-rail, product-discovery, desktop-catalog
 * @version       2026-06
 */`,

  'public/boutique/js/b-cart-pill.js': `/**
 * @komerce-arch
 * @role          floating-cart-pill
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        cart_state, scroll_state, viewport
 * @outputs       floating_cart_cta, cart_feedback, quick_checkout_entry
 * @depends       b-bus.js, b-cart-core.js, b-scroll-owner.js, b-store.js, b-utils.js
 * @used-by       boutique.js
 * @doctrine      panier_visible_sans_friction, side_cart_non_intrusif, checkout_entry_visible
 * @impact-areas  cart, checkout-entry, mobile-layout, desktop-layout
 * @version       2026-06
 */`,

  'public/boutique/js/b-store.js': `/**
 * @komerce-arch
 * @role          boutique-shared-state
 * @domain        boutique
 * @layer         state
 * @criticality   critical
 * @inputs        dom_refs, persisted_cart, products, session_context
 * @outputs       shared_state, dom_registry, constants, scroll_context
 * @depends       localStorage, sessionStorage, DOM
 * @used-by       all-boutique-js-modules
 * @doctrine      state_partage_explicite, panier_local_source_unique, dom_refs_centralisees
 * @impact-areas  all-boutique, cart, checkout, catalog, modal, shared-cart, tracking
 * @version       2026-06
 */`,

  'public/boutique/js/b-modal-suggestions.js': `/**
 * @komerce-arch
 * @role          product-modal-suggestions
 * @domain        recommendations
 * @layer         ui-component
 * @criticality   high
 * @inputs        current_product, catalog_state, navigation_context
 * @outputs       suggestion_rail, related_products, discovery_paths
 * @depends       b-store.js, b-utils.js, shop-schema.js
 * @used-by       b-modal-core.js
 * @doctrine      suggestions_decouverte_non_intrusives, boutique_canal_decouverte, no_hardcoded_taxonomy
 * @impact-areas  product-discovery, modal, personalization, catalog-navigation
 * @version       2026-06
 */`,

  'public/boutique/js/b-modal-approche-c-hybrid.js': `/**
 * @komerce-arch
 * @role          hybrid-product-modal-flow
 * @domain        boutique
 * @layer         ui-experiment
 * @criticality   medium
 * @inputs        modal_context, product_state, cart_actions
 * @outputs       hybrid_modal_actions, share_entry, cart_entry
 * @depends       b-cart.js, b-share-cart.js, b-modal-core.js
 * @used-by       modal-surfaces
 * @doctrine      modal_produit_sans_chevauchement, partager_geste_natif, checkout_sans_friction
 * @impact-areas  product-modal, cart, shared-cart-creation, checkout-entry
 * @version       2026-06
 */`,

  'public/boutique/js/b-modal-image-ux.js': `/**
 * @komerce-arch
 * @role          product-modal-image-ux
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   medium
 * @inputs        product_images, modal_media_state, pointer_events
 * @outputs       image_zoom_state, carousel_interactions, media_focus
 * @depends       b-store.js
 * @used-by       b-modal-core.js
 * @doctrine      image_produit_inspectable, modal_produit_sans_chevauchement
 * @impact-areas  product-modal, media-carousel, product-discovery
 * @version       2026-06
 */`,

  'public/boutique/js/b-utils.js': `/**
 * @komerce-arch
 * @role          boutique-ui-utilities
 * @domain        boutique
 * @layer         util
 * @criticality   high
 * @inputs        raw_values, api_paths, product_media, currency_values
 * @outputs       sanitized_html, formatted_values, optimized_images, api_results
 * @depends       fetch, Intl
 * @used-by       all-boutique-js-modules
 * @doctrine      sanitize_before_render, api_errors_lisibles, prix_lisible
 * @impact-areas  all-boutique, security, catalog, checkout, modal, tracking
 * @version       2026-06
 */`,

  'public/boutique/js/product-store.js': `/**
 * @komerce-arch
 * @role          boutique-product-store
 * @domain        catalog
 * @layer         state-store
 * @criticality   high
 * @inputs        raw_products, cache_state, availability_flags
 * @outputs       normalized_products, cached_products, promo_products
 * @depends       localStorage, shop-schema.js
 * @used-by       b-catalog.js, boutique.js, suggestion-modules
 * @doctrine      product_source_unique, catalogue_cache_fallback, produit_reference_stable
 * @impact-areas  catalog, product-discovery, suggestions, offline-fallback
 * @version       2026-06
 */`,

  'public/boutique/js/b-group-banner.js': `/**
 * @komerce-arch
 * @role          shared-cart-status-banner
 * @domain        shared-cart
 * @layer         ui-component
 * @criticality   medium
 * @inputs        shared_cart_state, expiry, contribution_state
 * @outputs       banner_visibility, banner_content, group_shortcut
 * @depends       b-store.js, b-utils.js
 * @used-by       b-share-cart.js, b-group-view.js, boutique.js
 * @doctrine      suivi_panier_visible, panier_ouvert_ferme, participant_peut_verifier
 * @impact-areas  shared-cart, participant-flow, creator-flow, navigation
 * @version       2026-06
 */`,

  'public/boutique/js/event-pay.js': `/**
 * @komerce-arch
 * @role          collective-workspace-payment
 * @domain        collective-workspace
 * @layer         ui-page
 * @criticality   medium
 * @inputs        payment_token, participant_identity, amount
 * @outputs       payment_attempt, confirmation_state, error_state
 * @depends       routes/collective-workspaces.js, payment-api
 * @used-by       public_event_payment_links
 * @doctrine      paiement_seul_acte_engageant, lien_public_controle
 * @impact-areas  collective-workspaces, payments, participant-flow
 * @version       2026-06
 */`,

  'public/boutique/js/b-scroll-owner.js': `/**
 * @komerce-arch
 * @role          boutique-scroll-owner
 * @domain        boutique
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        viewport, page_scroll, modal_state, desktop_state
 * @outputs       scroll_positions, ownership_guards, layout_resets
 * @depends       DOM
 * @used-by       b-catalog.js, b-subcat.js, b-nav.js, b-cart.js, modal-modules, desktop-enhancers
 * @doctrine      scroll_owner_unique, mobile_desktop_coherence, modal_produit_sans_chevauchement
 * @impact-areas  responsive-layout, modal, category-navigation, side-cart-layout
 * @version       2026-06
 */`,

  'public/boutique/js/render/render-home-sections.js': `/**
 * @komerce-arch
 * @role          home-sections-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   medium
 * @inputs        product_sections, category_order, render_card_callback
 * @outputs       home_section_html, category_blocks, see_all_actions
 * @depends       shop-schema.js, render/render-product-card.js
 * @used-by       b-catalog.js
 * @doctrine      boutique_canal_decouverte, rendu_sans_logique_metier, taxonomy_source_unique
 * @impact-areas  home, catalog, product-grid, category-navigation
 * @version       2026-06
 */`,

  'public/boutique/js/b-favs.js': `/**
 * @komerce-arch
 * @role          favorites-view
 * @domain        boutique
 * @layer         ui-page
 * @criticality   medium
 * @inputs        favorites_state, product_store
 * @outputs       favorites_grid, favorite_actions
 * @depends       b-store.js, b-cart-core.js, b-catalog.js
 * @used-by       b-nav.js, boutique.js
 * @doctrine      favoris_locaux_simples, boutique_canal_decouverte
 * @impact-areas  favorites, product-discovery, cart-entry, navigation
 * @version       2026-06
 */`,

  'public/boutique/js/group/group-api.js': `/**
 * @komerce-arch
 * @role          shared-cart-front-api
 * @domain        shared-cart
 * @layer         api-client
 * @criticality   high
 * @inputs        share_token, contribution_payload, creator_action
 * @outputs       shared_cart_data, payment_links, action_results
 * @depends       routes/shared-cart.js, fetch
 * @used-by       b-group-view.js
 * @doctrine      backend_source_verite, paiement_seul_acte_engageant, participant_peut_verifier
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout, payments
 * @version       2026-06
 */`,

  'public/boutique/js/group/group-helpers.js': `/**
 * @komerce-arch
 * @role          shared-cart-front-helpers
 * @domain        shared-cart
 * @layer         util-ui
 * @criticality   medium
 * @inputs        shared_cart_data, personalized_params, amounts
 * @outputs       formatted_progress, parsed_params, display_helpers
 * @depends       b-utils.js
 * @used-by       b-group-view.js, group-render-creator.js, b-nav.js
 * @doctrine      estimations_indicatives, montant_lisible, lien_personnalise_lisible
 * @impact-areas  shared-cart, participant-flow, creator-flow, personalized-links
 * @version       2026-06
 */`
};

function applyHeader(relativePath, header) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, status: 'missing' };
  }

  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes('@komerce-arch')) {
    return { file: relativePath, status: 'skipped-existing' };
  }

  fs.writeFileSync(filePath, `${header}\n\n${src}`, 'utf8');
  return { file: relativePath, status: 'updated' };
}

function main() {
  const results = Object.entries(HEADERS).map(([file, header]) => applyHeader(file, header));
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  for (const result of results) {
    console.log(`${result.status.padEnd(16)} ${result.file}`);
  }
  console.log('\nSummary:', counts);
}

main();
