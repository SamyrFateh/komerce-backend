'use strict';

jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: jest.fn((url) => url),
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
}));

const { state, dom } = require('../../js/b-store.js');
const { buildCarouselSlides } = require('../../js/b-modal-product.js');

function resetDom() {
  document.body.innerHTML = '';
  dom.modalCarouselTrack = document.createElement('div');
  dom.modalDots = document.createElement('div');
  dom.modal = document.createElement('div');
  dom.modal.id = 'k-modal';

  const wrap = document.createElement('div');
  wrap.className = 'k-modal-img-wrap';
  wrap.appendChild(dom.modalCarouselTrack);
  wrap.appendChild(dom.modalDots);
  dom.modal.appendChild(wrap);
  document.body.appendChild(dom.modal);

  state.carouselIndex = 0;
  state.carouselCount = 1;
  return wrap;
}

function rgbaGrid(width, height, isDark) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = isDark(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = dark ? 20 : 255;
      data[offset + 1] = dark ? 30 : 255;
      data[offset + 2] = dark ? 40 : 255;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function renderLoadedSingle({ width, height, pixels, context = true, throws = false }) {
  const wrap = resetDom();
  const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');
  if (!context) {
    getContext.mockReturnValue(null);
  } else {
    getContext.mockReturnValue({
      drawImage: jest.fn(),
      getImageData: throws
        ? jest.fn(() => { throw new Error('canvas blocked'); })
        : jest.fn(() => ({ data: pixels })),
    });
  }

  buildCarouselSlides({ name: 'MDM-9', image_url: '/fixture.png' });
  const img = dom.modalCarouselTrack.querySelector('.k-modal-slide');
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  Object.defineProperty(img, 'complete', { configurable: true, value: true });
  img.dispatchEvent(new Event('load'));

  return { wrap, img, getContext };
}

describe('b-modal-product — MDM-9 subject scale', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('zooms a centered non-white subject while preserving a safety margin', () => {
    const pixels = rgbaGrid(4, 4, (x, y) => x >= 1 && x <= 2 && y >= 1 && y <= 2);
    const { wrap } = renderLoadedSingle({ width: 4, height: 4, pixels });

    expect(wrap.dataset.galleryMode).toBe('single');
    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('1.760');
  });

  test('caps the zoom for a very small subject', () => {
    const pixels = rgbaGrid(20, 20, (x, y) => x >= 9 && x <= 10 && y >= 9 && y <= 10);
    const { wrap } = renderLoadedSingle({ width: 20, height: 20, pixels });

    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('2.500');
  });

  test('never zooms an image whose useful subject already fills the frame', () => {
    const pixels = rgbaGrid(4, 4, () => true);
    const { wrap } = renderLoadedSingle({ width: 4, height: 4, pixels });

    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('1.000');
  });

  test('leaves the fallback scale unset when the image is entirely white', () => {
    const pixels = rgbaGrid(4, 4, () => false);
    const { wrap } = renderLoadedSingle({ width: 4, height: 4, pixels });

    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('');
  });

  test('leaves the fallback scale unset when canvas has no 2D context', () => {
    const pixels = rgbaGrid(4, 4, () => true);
    const { wrap } = renderLoadedSingle({ width: 4, height: 4, pixels, context: false });

    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('');
  });

  test('falls back safely when canvas pixel access throws', () => {
    const pixels = rgbaGrid(4, 4, () => true);
    const { wrap } = renderLoadedSingle({ width: 4, height: 4, pixels, throws: true });

    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('');
  });

  test('does not invoke canvas scaling for a multiple-image gallery', () => {
    const wrap = resetDom();
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');

    buildCarouselSlides({ name: 'Galerie', images: ['/a.png', '/b.png'] });
    dom.modalCarouselTrack.querySelector('.k-modal-slide').dispatchEvent(new Event('load'));

    expect(wrap.dataset.galleryMode).toBe('multiple');
    expect(wrap.style.getPropertyValue('--k-modal-subject-scale')).toBe('');
    expect(getContext).not.toHaveBeenCalled();
  });
});
