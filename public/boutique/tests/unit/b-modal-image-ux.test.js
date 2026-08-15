'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-modal-image-ux.test.js
 *
 * Module js/b-modal-image-ux.js â€” compteur 1/N, bouton "Voir en grand",
 * lightbox plein Ã©cran, swipe, Escape et sync carousel.
 *
 * PDC-4 ajoute une diffÃ©rence intentionnelle : une fiche dÃ©tail mobile enrichie
 * montre le compteur dÃ¨s 2 mÃ©dias, alors que le parcours legacy conserve son
 * seuil historique > 5 images.
 */

describe('b-modal-image-ux', () => {
  let bus, state, dom, setupImageUX;

  function buildModalDom(imgCount) {
    dom.modal = document.createElement('div');
    let slidesHtml = '';
    for (let i = 0; i < imgCount; i++) {
      slidesHtml += `<img class="k-modal-slide" src="https://res.cloudinary.com/x/image/upload/f_auto,q_auto,w_800/img${i}.jpg">`;
    }
    dom.modal.innerHTML =
      '<div class="k-modal-carousel">' +
        '<div class="k-modal-carousel-track">' + slidesHtml + '</div>' +
      '</div>' +
      '<div class="k-modal-counter"></div>' +
      '<div class="k-modal-dots"></div>' +
      '<div class="k-modal-img-wrap"></div>';
    document.body.appendChild(dom.modal);

    const fsWrap = document.createElement('div');
    fsWrap.className = 'k-modal-fullscreen';
    fsWrap.innerHTML =
      '<div class="k-modal-fullscreen-track"></div>' +
      '<div class="k-modal-fullscreen-counter"></div>' +
      '<button class="k-modal-fullscreen-close"></button>';
    document.body.appendChild(fsWrap);
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    ({ bus } = require('../../js/b-bus.js'));
    ({ state, dom } = require('../../js/b-store.js'));
    ({ setupImageUX } = require('../../js/b-modal-image-ux.js'));

    state.carouselIndex = 0;
    state.modalProductDetail = null;
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
  });

  describe('compteur 1/N', () => {
    test('<= 5 images legacy -> compteur masquÃ©, dots rÃ©affichÃ©s', () => {
      buildModalDom(3);
      setupImageUX();
      expect(document.querySelector('.k-modal-counter').classList.contains('is-visible')).toBe(false);
      expect(document.querySelector('.k-modal-dots').style.display).toBe('');
    });

    test('fiche dÃ©tail mobile enrichie -> compteur visible dÃ¨s 2 mÃ©dias', () => {
      buildModalDom(2);
      state.modalProductDetail = { product: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });

      setupImageUX();

      const counter = document.querySelector('.k-modal-counter');
      expect(counter.classList.contains('is-visible')).toBe(true);
      expect(counter.textContent).toContain('1');
      expect(counter.textContent).toContain('2');
      expect(document.querySelector('.k-modal-dots').style.display).toBe('none');
    });

    test('fiche dÃ©tail desktop conserve le seuil historique du compteur', () => {
      buildModalDom(2);
      state.modalProductDetail = { product: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });

      setupImageUX();

      expect(document.querySelector('.k-modal-counter').classList.contains('is-visible')).toBe(false);
      expect(document.querySelector('.k-modal-dots').style.display).toBe('');
    });

    test('> 5 images -> compteur "1/N" visible, dots masquÃ©s', () => {
      buildModalDom(8);
      setupImageUX();
      const counter = document.querySelector('.k-modal-counter');
      expect(counter.classList.contains('is-visible')).toBe(true);
      expect(counter.textContent).toContain('1');
      expect(counter.textContent).toContain('8');
      expect(document.querySelector('.k-modal-dots').style.display).toBe('none');
    });

    test('pas de .k-modal-counter dans le DOM -> ne plante pas', () => {
      dom.modal = document.createElement('div');
      dom.modal.innerHTML = '<div class="k-modal-carousel"><div class="k-modal-carousel-track"></div></div>';
      document.body.appendChild(dom.modal);
      expect(() => setupImageUX()).not.toThrow();
    });
  });

  describe('bouton "Voir en grand"', () => {
    test('injectÃ© dans .k-modal-img-wrap', () => {
      buildModalDom(3);
      setupImageUX();
      const btn = document.querySelector('.k-modal-view-full');
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('aria-label')).toBe('Voir en grand');
    });

    test('mobile -> le hero suffit, aucun bouton Voir en grand injectÃ©', () => {
      buildModalDom(3);
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });

      setupImageUX();

      expect(document.querySelector('.k-modal-view-full')).toBeNull();
    });

    test('rÃ©-ouverture (2e appel) -> pas de doublon du bouton', () => {
      buildModalDom(3);
      setupImageUX();
      setupImageUX();
      expect(document.querySelectorAll('.k-modal-view-full').length).toBe(1);
    });

    test('clic sur le bouton -> ouvre la lightbox fullscreen', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(true);
    });
  });

  describe('lightbox fullscreen', () => {
    test('affiche les slides en haute rÃ©solution (w_800 -> w_1600)', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      const imgs = document.querySelectorAll('.k-modal-fullscreen-slide img');
      expect(imgs.length).toBe(3);
      expect(imgs[0].src).toContain('w_1600');
      expect(imgs[0].src).not.toContain('w_800');
    });

    test('compteur fullscreen affiche 1/N Ã  l\'ouverture', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      expect(document.querySelector('.k-modal-fullscreen-counter').textContent).toContain('1');
      expect(document.querySelector('.k-modal-fullscreen-counter').textContent).toContain('3');
    });

    test('bouton close -> ferme la lightbox et restaure overflow', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      document.querySelector('.k-modal-fullscreen-close').click();
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
      expect(document.body.style.overflow).toBe('');
    });

    test('clic sur le fond (pas sur l\'image) -> ferme', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      const fs = document.querySelector('.k-modal-fullscreen');
      fs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(fs.classList.contains('is-open')).toBe(false);
    });

    test('swipe horizontal > 44px change de slide', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      const fs = document.querySelector('.k-modal-fullscreen');
      const start = new Event('touchstart');
      start.touches = [{ clientX: 200 }];
      fs.dispatchEvent(start);
      const end = new Event('touchend');
      end.changedTouches = [{ clientX: 100 }];
      fs.dispatchEvent(end);
      expect(document.querySelector('.k-modal-fullscreen-counter').textContent).toContain('2');
    });

    test('swipe < 44px -> ignorÃ© (pas de changement de slide)', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      const fs = document.querySelector('.k-modal-fullscreen');
      const start = new Event('touchstart');
      start.touches = [{ clientX: 200 }];
      fs.dispatchEvent(start);
      const end = new Event('touchend');
      end.changedTouches = [{ clientX: 190 }];
      fs.dispatchEvent(end);
      expect(document.querySelector('.k-modal-fullscreen-counter').textContent).toContain('1');
    });

    test('Escape ferme la lightbox si ouverte', () => {
      buildModalDom(3);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
    });

    test('aucune image -> le clic ne fait rien (pas de lightbox vide)', () => {
      buildModalDom(0);
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
    });

    test('handlers fullscreen (Escape, swipe) installÃ©s une seule fois mÃªme aprÃ¨s 2 setupImageUX()', () => {
      buildModalDom(3);
      setupImageUX();
      setupImageUX();
      document.querySelector('.k-modal-view-full').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
    });
  });

  describe('tap sur l\'image principale (mobile uniquement)', () => {
    test('mobile (<=899px) -> tap ouvre la lightbox', () => {
      buildModalDom(3);
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });
      setupImageUX();
      document.querySelector('.k-modal-carousel').click();
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(true);
    });

    test('desktop (>899px) -> tap n\'ouvre rien', () => {
      buildModalDom(3);
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });
      setupImageUX();
      document.querySelector('.k-modal-carousel').click();
      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
    });

    test('desktop, mÃ©dia unique sans variantes -> clic ouvre la lightbox', () => {
      buildModalDom(1);
      state.modalSelection = { selection_supported: false };
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });
      setupImageUX();

      document.querySelector('.k-modal-carousel').click();

      const fs = document.querySelector('.k-modal-fullscreen');
      expect(fs).not.toBeNull();
      expect(fs.classList.contains('is-open')).toBe(true);
      expect(fs.getAttribute('role')).toBe('dialog');
      expect(fs.querySelector('.k-modal-fullscreen-slide img').src).toContain('w_1600');
    });

    test('desktop, mÃ©dia unique avec variantes -> clic ne dÃ©tourne pas le configurateur', () => {
      buildModalDom(1);
      dom.modal.classList.add('k-modal--has-variants');
      state.modalSelection = { selection_supported: true };
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });
      setupImageUX();

      document.querySelector('.k-modal-carousel').click();

      expect(document.querySelector('.k-modal-fullscreen').classList.contains('is-open')).toBe(false);
    });
  });

  describe('sync carousel:changed', () => {
    test('bus.emit("carousel:changed", idx) met Ã  jour le compteur (>5 images)', () => {
      buildModalDom(8);
      setupImageUX();
      bus.emit('carousel:changed', 4);
      expect(document.querySelector('.k-modal-counter').textContent).toContain('5');
    });
  });
});
