'use strict';

/**
 * @feature catalog, modal-product
 * Régression UI — les prix mobiles longs ne doivent plus être rognés et la promo
 * ne doit plus changer la géométrie du montant.
 *
 * MDM canonical (2026-07) : modal-product-price-normalization.css a été vidé
 * (tactical guard superseded) — la géométrie mobile canonique vit désormais
 * dans modal-mobile-canonical.css. Ce fichier de test cible donc la nouvelle
 * source de vérité, sans changer l'intention métier des assertions.
 */

const fs = require('fs');
const path = require('path');
const { BUNDLES } = require('../../scripts/css-bundles');

const legacyCssPath = path.join(__dirname, '../../css/modal-product-price-normalization.css');
const legacyCss = fs.readFileSync(legacyCssPath, 'utf8');

const cssPath = path.join(__dirname, '../../css/modal-mobile-canonical.css');
const css = fs.readFileSync(cssPath, 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return match ? match[1] : '';
}

describe('modal-product — normalisation du prix mobile', () => {
  test('la couche canonique est réellement incluse dans components.css après les styles modal historiques', () => {
    const components = BUNDLES.find((bundle) => bundle.out === 'components.css');
    const priceLayer = components.files.indexOf('modal-product-price-normalization');
    const canonicalLayer = components.files.indexOf('modal-mobile-canonical');
    const modalLayer = components.files.indexOf('modal-product-lot4-hybrid');
    const cartLayer = components.files.indexOf('cart');

    expect(modalLayer).toBeGreaterThan(-1);
    expect(priceLayer).toBeGreaterThan(modalLayer);
    expect(canonicalLayer).toBeGreaterThan(priceLayer);
    expect(canonicalLayer).toBeLessThan(cartLayer);
  });

  test('le fichier tactique historique est bien vidé (superseded), pas supprimé', () => {
    // Retenu vide pour éviter un 404 sur les <link> existants ; la géométrie
    // réelle vit désormais dans modal-mobile-canonical.css.
    expect(legacyCss).not.toMatch(/overflow:\s*visible/);
    expect(legacyCss).not.toMatch(/line-height:\s*1\.15/);
    expect(legacyCss.length).toBeLessThan(1000);
  });

  test('la ligne de prix mobile peut respirer sans rogner les montants longs', () => {
    const block = rule('#k-modal .k-modal-price-row');
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/flex-wrap:\s*nowrap/);
    expect(block).toMatch(/align-items:\s*baseline/);
  });

  test('le prix garde une hauteur de ligne sûre et reste sur une seule unité lisible', () => {
    const block = rule('#k-modal .k-modal-price');
    expect(block).toMatch(/line-height:\s*1\.15/);
    expect(block).toMatch(/white-space:\s*nowrap/);
    expect(block).toMatch(/font-size:\s*20px/);
  });

  test('promo et hors promo ont la même géométrie (plus de clamp premium ad hoc)', () => {
    const base = rule('#k-modal .k-modal-price');
    const promo = rule('#k-modal.k-modal--has-promo .k-modal-price');
    expect(promo).toMatch(/font-size:\s*20px/);

    // La géométrie (taille) est désormais identique entre promo et non-promo —
    // seule la couleur/poids change. Plus de surcharge clamp() par le mode
    // premium-v1 (tactical guard retiré, voir doctrine du fichier).
    const baseSize = base.match(/font-size:\s*(\d+px)/)?.[1];
    const promoSize = promo.match(/font-size:\s*(\d+px)/)?.[1];
    expect(promoSize).toBe(baseSize);
    expect(css).not.toMatch(/k-mobile-premium-v1/);
  });

  test('le média mobile réserve une hauteur fixe et prévisible (48vh, plancher 180px)', () => {
    const block = rule('#k-modal .k-modal-img-wrap');
    expect(block).toMatch(/min-height:\s*180px/);
    expect(block).toMatch(/max-height:\s*48vh/);
    expect(block).toMatch(/height:\s*48vh/);
  });
});
