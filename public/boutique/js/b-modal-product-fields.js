/**
 * @komerce-arch
 * @role          modal-product-scalar-fields-owner
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_list_item (paint provisoire pré-fetch), product_detail_v1 + modal_selection_state (paint final)
 * @outputs       scalar_fields_paint
 * @depends       b-store.js, b-utils.js, b-modal-buybox-shared.js
 * @used-by       b-modal-core.js (openModal), b-modal-desktop-product.js, b-modal-mobile-product.js
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  product-modal, single-ownership
 * @version       2026-07 — Chantier déduplication (§3) : paintDetailFields
 *
 * PROPRIÉTAIRE UNIQUE des zones scalaires de la modale :
 *   name · sku · price · old-price · cat · promo-badge (paint final, §3)
 *   + desc · stock (paint provisoire seulement — restent divergentes au paint
 *     final, cf. paintDetailFields ci-dessous, rendues par chaque renderer).
 *
 * paintProvisionalFields() : extrait de b-modal-core.js/openModal (paint
 * provisoire depuis la LISTE, avant résolution du contrat /detail).
 * paintDetailFields() : extrait de renderIdentity()/renderPriceAndReference()
 * desktop (vérifié ligne à ligne contre le mobile avant convergence — détail
 * dans le commentaire de la fonction plus bas et dans b-modal-mobile-product.js).
 */
'use strict';

import { dom } from './b-store.js';
import { fmtPrice } from './b-utils.js';
import { getCurrentPrice } from './b-modal-buybox-shared.js';

export function paintProvisionalFields(product) {
  dom.modalName.textContent = product.name;
  if (dom.modalSku) {
    if (product.sku) {
      dom.modalSku.textContent = 'Réf. ' + product.sku;
      dom.modalSku.hidden = false;
    } else {
      dom.modalSku.textContent = '';
      dom.modalSku.hidden = true;
    }
  }
  dom.modalDesc.textContent = product.description || '';
  dom.modalDesc.classList.remove('is-expanded'); // reset truncation on each open
  dom.modalDesc.onclick = function () { dom.modalDesc.classList.toggle('is-expanded'); };
  dom.modalPrice.textContent = fmtPrice(product.price_kmf);

  // PDC-6 : old price vient exclusivement du contrat détail ; le paint
  // provisoire le laisse masqué.
  dom.modalOldPrice.classList.add('u-hidden');
  if (product.promo_pct) {
    dom.modalPromoBadge.textContent = `-${product.promo_pct}%`;
    dom.modalPromoBadge.classList.add('show');
    // F1 — prix coral sur mobile (classe lue par modal.css §1)
    dom.modal && dom.modal.classList.add('k-modal--has-promo');
  } else {
    dom.modalPromoBadge.classList.remove('show');
    dom.modal && dom.modal.classList.remove('k-modal--has-promo');
  }

  dom.modalCat.textContent = `${product.emoji || ''} ${product.category || ''}`;

  // PDC-6 : la disponibilité vient exclusivement du contrat détail ; on vide
  // juste l'affichage précédent par hygiène, sans réinterpréter la donnée liste.
  if (dom.modalStock) {
    dom.modalStock.textContent = '';
    dom.modalStock.className = 'k-modal-stock';
  }
}

/**
 * Paint FINAL (post-fetch /detail) des 6 zones scalaires identiques entre
 * desktop et mobile : name, sku, price, old-price, cat, promo-badge.
 * Référence : desktop renderIdentity()/renderPriceAndReference() (vérifié
 * ligne à ligne contre le renderIdentity() mobile avant convergence). N'écrit
 * jamais desc ni stock : ces deux zones divergent réellement entre les deux
 * compositions (desc : mobile l'efface, MDM-7 ; stock : texte desktop vs pill
 * mobile) et restent la responsabilité de chaque renderer.
 *
 * Note comportementale : le desktop gardait `price != null ? fmtPrice(price)
 * : ''` (repli vide si prix absent) ; le mobile appelait `fmtPrice(price)`
 * sans ce garde, ce qui aurait affiché "0 KMF" pour un prix null. Cette
 * fonction adopte le garde desktop pour les deux compositions — correctif
 * mineur d'un cas limite pré-existant côté mobile (le prix est quasi
 * toujours présent en pratique), pas un changement de comportement nominal.
 */
export function paintDetailFields(detail, selection) {
  if (dom.modalName) dom.modalName.textContent = detail.product.name;

  const unit = (detail.sellable_units || [])
    .find((u) => u.sku_id === selection.selected_sku_id) || null;
  if (dom.modalSku) {
    const reference = unit?.sku || detail.product.reference;
    dom.modalSku.textContent = reference ? `Réf. ${reference}` : '';
    dom.modalSku.hidden = !reference;
  }

  const price = getCurrentPrice(detail, selection);
  if (dom.modalPrice) dom.modalPrice.textContent = price != null ? fmtPrice(price) : '';

  if (dom.modalOldPrice) {
    const oldPrice = detail.pricing.old_price_kmf;
    dom.modalOldPrice.textContent = oldPrice != null ? fmtPrice(oldPrice) : '';
    dom.modalOldPrice.classList.toggle('u-hidden', oldPrice == null);
  }

  const promo = Number(detail.pricing.promo_pct || 0);
  if (dom.modalPromoBadge) {
    dom.modalPromoBadge.textContent = promo > 0 ? `-${promo}%` : '';
    dom.modalPromoBadge.classList.toggle('show', promo > 0);
  }
  dom.modal?.classList.toggle('k-modal--has-promo', promo > 0);

  // Series — ligne 2 meta hero (spec M6, contrat v1 product.series). Fallback
  // silencieux : si series absent, on n'affiche pas la catégorie brute.
  if (dom.modalCat) {
    const series = detail.product.series || null;
    dom.modalCat.textContent = series || '';
    dom.modalCat.hidden = !series;
  }
}
