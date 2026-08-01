/**
 * @komerce-arch
 * @role          boutique-test-modal-redirect
 * @domain        boutique
 * @layer         ui-bootstrap
 * @criticality   low
 * @inputs        legacy-test-modal-url
 * @outputs       canonical-group-view-redirect
 * @depends       browser-location-api
 * @used-by       public/boutique/test-modal-view-model.html
 * @doctrine      csp_no_inline_script, legacy_entry_redirect_only
 * @impact-areas  boutique-test-entry
 * @version       2026-08
 */
'use strict';
/* global location */

location.replace('/boutique/?tab=group');
