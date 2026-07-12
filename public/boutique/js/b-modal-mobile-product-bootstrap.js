/**
 * @komerce-arch
 * @role          mobile-product-detail-bootstrap-compat
 * @domain        catalog
 * @layer         compatibility
 * @criticality   low
 * @inputs        modal_lifecycle
 * @outputs       product_detail_modal_setup_alias
 * @depends       b-modal-product-detail-bootstrap.js
 * @used-by       tests and transitional imports until PDC-6
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  product-modal, compatibility
 * @version       2026-07
 */

'use strict';

// PDC-5 : le fetch détail et la création de l'état de sélection sont désormais
// communs à mobile et desktop. Cet alias évite une rupture d'import pendant la
// transition ; PDC-6 supprimera le nom historique mobile-only.
export {
  setupProductDetailModal as setupMobileProductDetail,
} from './b-modal-product-detail-bootstrap.js';
