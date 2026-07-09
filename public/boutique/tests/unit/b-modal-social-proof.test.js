'use strict';

/**
 * tests/unit/b-modal-social-proof.test.js
 *
 * Module js/b-modal-social-proof.js (117L) — ligne "preuve sociale"
 * (rang bestseller, vendus, note) dans la modal produit.
 *
 * 0% de couverture réelle avant cette session : seul point de contact,
 * `b-modal-core.test.js`, le mocke intégralement — jamais importé pour
 * de vrai nulle part.
 *
 * b-bus.js et b-store.js réels (state.modalProduct, modalZone via dom.modal).
 * jest.resetModules() par test : `_installed` est un flag module-level qui
 * doit repartir à zéro pour tester l'idempotence de l'abonnement bus.
 */

describe('b-modal-social-proof', () => {
  let bus, state, dom, setupSocialProof;

  function buildModalDom() {
    dom.modal = document.createElement('div');
    dom.modal.innerHTML = '<div class="k-modal-meta"></div>';
    document.body.appendChild(dom.modal);
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    ({ bus } = require('../../js/b-bus.js'));
    ({ state, dom } = require('../../js/b-store.js'));
    ({ setupSocialProof } = require('../../js/b-modal-social-proof.js'));

    buildModalDom();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
  });

  test('pas de dom.modal -> modalZone renvoie null, ne plante pas', () => {
    dom.modal = null;
    state.modalProduct = { rank: 1 };
    expect(() => setupSocialProof()).not.toThrow();
  });

  test('pas de modalProduct -> .k-modal-meta reste vide', () => {
    state.modalProduct = null;
    setupSocialProof();
    expect(document.querySelector('.k-modal-meta').innerHTML).toBe('');
  });

  test('product.rank -> badge "#N Bestseller"', () => {
    state.modalProduct = { rank: 3 };
    setupSocialProof();
    const rankEl = document.querySelector('.k-modal-meta-rank');
    expect(rankEl).not.toBeNull();
    expect(rankEl.textContent).toContain('#3');
    expect(rankEl.textContent).toContain('Bestseller');
  });

  test('pas de rank -> aucun badge bestseller', () => {
    state.modalProduct = { sold_count: 10 };
    setupSocialProof();
    expect(document.querySelector('.k-modal-meta-rank')).toBeNull();
  });

  test('sold_count > 0 -> affiche "N vendus" formaté en fr-FR', () => {
    state.modalProduct = { sold_count: 1432 };
    setupSocialProof();
    const meta = document.querySelector('.k-modal-meta');
    expect(meta.textContent).toContain('1\u202f432');
    expect(meta.textContent).toContain('vendus');
  });

  test('sold_count = 0 -> pas affiché (aucun chiffre inventé)', () => {
    state.modalProduct = { sold_count: 0 };
    setupSocialProof();
    expect(document.querySelector('.k-modal-meta').textContent).toBe('');
  });

  test('rating > 0 sans review_count -> "★ N,N" sans mention avis', () => {
    state.modalProduct = { rating: 4.8 };
    setupSocialProof();
    const meta = document.querySelector('.k-modal-meta');
    expect(meta.textContent).toContain('4,8');
    expect(meta.textContent).not.toContain('avis');
  });

  test('rating + review_count -> inclut le nombre d\'avis, aria-label complet', () => {
    state.modalProduct = { rating: 4.5, review_count: 128 };
    setupSocialProof();
    const ratingEl = document.querySelector('.k-modal-meta span:last-child');
    expect(ratingEl.textContent).toContain('4,5');
    expect(ratingEl.textContent).toContain('128 avis');
    expect(ratingEl.getAttribute('aria-label')).toContain('Note 4,5 sur 5');
    expect(ratingEl.getAttribute('aria-label')).toContain('128 avis');
  });

  test('rating = 0 -> pas affiché', () => {
    state.modalProduct = { rating: 0 };
    setupSocialProof();
    expect(document.querySelector('.k-modal-meta').textContent).toBe('');
  });

  test('les 3 éléments cumulés apparaissent dans l\'ordre rank > vendus > note', () => {
    state.modalProduct = { rank: 2, sold_count: 50, rating: 4.9 };
    setupSocialProof();
    const meta = document.querySelector('.k-modal-meta');
    expect(meta.children.length).toBe(3);
    expect(meta.children[0].className).toBe('k-modal-meta-rank');
  });

  test('ré-injecte au bus "modal:product-changed" (navigation nav-btn sans fermer la modal)', () => {
    state.modalProduct = { rank: 1 };
    setupSocialProof();
    state.modalProduct = { sold_count: 20 };
    bus.emit('modal:product-changed');
    const meta = document.querySelector('.k-modal-meta');
    expect(meta.querySelector('.k-modal-meta-rank')).toBeNull();
    expect(meta.textContent).toContain('vendus');
  });

  test('setupSocialProof() appelé deux fois -> un seul abonnement bus (pas de double injection)', () => {
    state.modalProduct = { rank: 1 };
    setupSocialProof();
    setupSocialProof();
    const metaBefore = document.querySelector('.k-modal-meta').children.length;
    bus.emit('modal:product-changed');
    // Toujours une seule injection à la fois (innerHTML vidé avant réinjection),
    // pas d'accumulation même si setupSocialProof a été appelé 2x.
    expect(document.querySelector('.k-modal-meta').children.length).toBe(metaBefore);
  });
});
