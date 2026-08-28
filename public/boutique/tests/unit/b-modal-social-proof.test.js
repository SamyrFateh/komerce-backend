'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
 * jest.resetModules() par test garde l'isolation d'état des modules Boutique.
 */

describe('b-modal-social-proof', () => {
  let state, dom, setupSocialProof;

  function buildModalDom() {
    dom.modal = document.createElement('div');
    dom.modal.innerHTML = '<div class="k-modal-meta"></div>';
    document.body.appendChild(dom.modal);
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

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

  test('ré-injecte quand openModal rappelle setupSocialProof après changement de produit', () => {
    state.modalProduct = { rank: 1 };
    setupSocialProof();
    state.modalProduct = { sold_count: 20 };
    setupSocialProof();
    const meta = document.querySelector('.k-modal-meta');
    expect(meta.querySelector('.k-modal-meta-rank')).toBeNull();
    expect(meta.textContent).toContain('vendus');
  });

  test('setupSocialProof() appelé deux fois ne duplique pas ses nœuds', () => {
    state.modalProduct = { rank: 1 };
    setupSocialProof();
    setupSocialProof();
    expect(document.querySelectorAll('[data-social-proof]').length).toBe(1);
  });

  // Régression — audit desktop finition P1 "stock près du prix" :
  // .k-modal-meta est un conteneur PARTAGÉ (hébergeant aussi #k-modal-cat,
  // owner b-modal-product-fields.js, et #k-modal-stock, owner
  // b-modal-desktop-product.js). Un `meta.innerHTML = ''` aveugle les
  // détruisait à chaque changement de produit -> stock et catégorie
  // disparaissaient purement et simplement du DOM (pas juste vidés de
  // texte), et les futures écritures via dom.modalCat/dom.modalStock
  // visaient alors un nœud détaché, silencieusement.
  test('ne détruit jamais les nœuds étrangers #k-modal-cat / #k-modal-stock au premier rendu', () => {
    const meta = document.querySelector('.k-modal-meta');
    const cat = document.createElement('span');
    cat.id = 'k-modal-cat';
    cat.textContent = 'Atelier Komerce';
    const stock = document.createElement('span');
    stock.id = 'k-modal-stock';
    stock.textContent = '● Plus que 4';
    meta.appendChild(cat);
    meta.appendChild(stock);

    state.modalProduct = { rank: 3, sold_count: 12 };
    setupSocialProof();

    expect(document.getElementById('k-modal-cat')).not.toBeNull();
    expect(document.getElementById('k-modal-cat').textContent).toBe('Atelier Komerce');
    expect(document.getElementById('k-modal-stock')).not.toBeNull();
    expect(document.getElementById('k-modal-stock').textContent).toBe('● Plus que 4');
  });

  test('ne détruit jamais #k-modal-cat / #k-modal-stock sur un changement de produit', () => {
    const meta = document.querySelector('.k-modal-meta');
    const cat = document.createElement('span');
    cat.id = 'k-modal-cat';
    cat.textContent = 'Mode & Beauté';
    const stock = document.createElement('span');
    stock.id = 'k-modal-stock';
    stock.textContent = '● En stock';
    meta.appendChild(cat);
    meta.appendChild(stock);

    state.modalProduct = { rank: 1 };
    setupSocialProof();

    // Simule le renderer desktop qui met ces nœuds à jour entre deux produits
    document.getElementById('k-modal-cat').textContent = 'Mobilier';
    document.getElementById('k-modal-stock').textContent = '● Plus que 2';

    state.modalProduct = { sold_count: 8 };
    setupSocialProof();

    expect(document.getElementById('k-modal-cat')).not.toBeNull();
    expect(document.getElementById('k-modal-cat').textContent).toBe('Mobilier');
    expect(document.getElementById('k-modal-stock')).not.toBeNull();
    expect(document.getElementById('k-modal-stock').textContent).toBe('● Plus que 2');
    // Le social proof, lui, a bien été rejoué (nouveau produit, nouvelle preuve sociale)
    expect(meta.querySelector('.k-modal-meta-rank')).toBeNull();
    expect(meta.textContent).toContain('vendus');
  });

  test('ré-appel de injectSocialProof (via setupSocialProof) retire ses propres nœuds sans laisser de doublons', () => {
    const meta = document.querySelector('.k-modal-meta');
    state.modalProduct = { rank: 1, sold_count: 5, rating: 4.2 };
    setupSocialProof();
    expect(meta.querySelectorAll('[data-social-proof]').length).toBe(3);

    state.modalProduct = { rank: 1, sold_count: 5, rating: 4.2 };
    setupSocialProof();

    // Toujours 3 nœuds marqués, pas 6 : les anciens ont bien été nettoyés,
    // pas juste laissés en place avec de nouveaux ajoutés par-dessus.
    expect(meta.querySelectorAll('[data-social-proof]').length).toBe(3);
  });
});
