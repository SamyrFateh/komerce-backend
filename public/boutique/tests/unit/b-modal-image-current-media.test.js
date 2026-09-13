'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression PDP : après navigation vers l'image N, "Voir en grand" / tap
 * mobile doit ouvrir cette même image N. Le fullscreen canonique lit les slides
 * réellement rendus et intercepte le tap court avant le fullscreen legacy du core.
 */

describe('PDP fullscreen media identity', () => {
  let state, dom, setupImageUX;

  function mountGallery(count = 4) {
    dom.modal = document.createElement('section');
    dom.modal.id = 'k-modal';
    const slides = Array.from({ length: count }, (_, i) =>
      `<img class="k-modal-slide" src="https://cdn.test/image-${i}.jpg">`
    ).join('');
    dom.modal.innerHTML = `
      <div class="k-modal-img-wrap">
        <div class="k-modal-carousel">
          <div class="k-modal-carousel-track">${slides}</div>
        </div>
        <div class="k-modal-counter"></div>
        <div class="k-modal-dots"></div>
      </div>
    `;
    document.body.appendChild(dom.modal);
  }

  function touch(type, x, y) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'touches', {
      configurable: true,
      value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
    });
    Object.defineProperty(e, 'changedTouches', {
      configurable: true,
      value: [{ clientX: x, clientY: y }],
    });
    return e;
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    ({ state, dom } = require('../../js/b-store.js'));
    ({ setupImageUX } = require('../../js/b-modal-image-ux.js'));
    state.carouselIndex = 0;
    state.modalProductDetail = { product: { id: 'pdp-test' } };
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('desktop : image 3/4 puis Voir en grand ouvre bien image 3/4', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    mountGallery(4);
    state.carouselIndex = 2;

    setupImageUX();
    document.querySelector('.k-modal-view-full').click();

    const fs = document.querySelector('.k-modal-fullscreen');
    const track = fs.querySelector('.k-modal-fullscreen-track');
    const images = fs.querySelectorAll('.k-modal-fullscreen-slide img');
    const counter = fs.querySelector('.k-modal-fullscreen-counter').textContent;

    expect(fs.classList.contains('is-open')).toBe(true);
    expect(track.style.transform).toBe('translateX(-200%)');
    expect(counter).toContain('3');
    expect(counter).toContain('4');
    expect(images[2].src).toContain('image-2.jpg');
  });

  test('mobile : tap court sur image 2/4 ouvre image 2/4 et ne remonte pas au fullscreen legacy', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    mountGallery(4);
    state.carouselIndex = 1;

    const imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    const carousel = dom.modal.querySelector('.k-modal-carousel');
    const legacyTouchEnd = jest.fn();
    imgWrap.addEventListener('touchend', legacyTouchEnd);

    setupImageUX();
    carousel.dispatchEvent(touch('touchstart', 120, 200));
    carousel.dispatchEvent(touch('touchend', 122, 202));

    const fs = document.querySelector('.k-modal-fullscreen');
    expect(legacyTouchEnd).not.toHaveBeenCalled();
    expect(fs.classList.contains('is-open')).toBe(true);
    expect(fs.querySelector('.k-modal-fullscreen-track').style.transform).toBe('translateX(-100%)');
    expect(fs.querySelector('.k-modal-fullscreen-counter').textContent).toContain('2');
    expect(fs.querySelectorAll('.k-modal-fullscreen-slide img')[1].src).toContain('image-1.jpg');
  });
});
