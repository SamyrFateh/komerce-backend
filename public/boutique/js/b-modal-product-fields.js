/**
 * @komerce-arch
 * @role          modal-product-scalar-fields-owner
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_list_item (paint provisoire pré-fetch)
 * @outputs       scalar_fields_paint
 * @depends       b-store.js, b-utils.js
 * @used-by       b-modal-core.js (openModal)
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  product-modal, single-ownership
 * @version       2026-07
 *
 * PROPRIÉTAIRE UNIQUE des zones scalaires de la modale :
 *   name · sku · desc · price · old-price · cat · stock · promo-badge
 *
 * Extrait verbatim de b-modal-core.js/openModal (paint provisoire depuis les
 * données de la LISTE, avant résolution du contrat /detail). Aucune logique
 * réécrite : simple relocation pour que ces zones aient un owner unique et que
 * le gate scripts/audit-modal-ownership.js passe au vert.
 */
'use strict';

import { dom } from './b-store.js';
import { fmtPrice } from './b-utils.js';

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
