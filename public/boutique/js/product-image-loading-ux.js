/**
 * @komerce-arch-lite
 * @role          boutique-product-image-loading-ux
 * @domain        boutique
 * @layer         ui-behavior
 * @owner         public/boutique/js/render/render-product-card.js
 * @purpose       Keep product-card media visually occupied until lazy images are actually ready.
 * @impact-areas  catalog, product-discovery, image-loading
 * @version       2026-09
 */
'use strict';

function isManagedProductImage(target) {
  return Boolean(
    target &&
    target.tagName === 'IMG' &&
    target.dataset?.kProductImage === '1'
  );
}

function mediaHost(image) {
  return image?.closest?.('.k-card-img-wrap, .k-sug-card-img') || null;
}

export function markProductImageReady(image) {
  if (!isManagedProductImage(image)) return false;
  const host = mediaHost(image);
  if (!host) return false;
  host.classList.add('is-image-ready');
  return true;
}

function inspectLoadedImages(root = document) {
  root.querySelectorAll?.('img[data-k-product-image="1"]').forEach((image) => {
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      markProductImageReady(image);
    }
  });
}

export function installProductImageLoadingUX() {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (!root || root.dataset.kProductImageLoadingBound === '1') return false;
  root.dataset.kProductImageLoadingBound = '1';

  document.addEventListener('load', (event) => {
    if (isManagedProductImage(event.target)) markProductImageReady(event.target);
  }, true);

  // Dynamic cards normally emit load after insertion. The observer only covers
  // the cache-fast edge case where an image can already be complete when its
  // card enters the DOM.
  const observer = typeof MutationObserver !== 'undefined'
    ? new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (node.nodeType !== 1) continue;
            if (isManagedProductImage(node)) {
              if (node.complete && node.naturalWidth > 0 && node.naturalHeight > 0) {
                markProductImageReady(node);
              }
              continue;
            }
            inspectLoadedImages(node);
          }
        }
      })
    : null;

  observer?.observe(document.body || root, { childList: true, subtree: true });
  inspectLoadedImages();
  return true;
}

installProductImageLoadingUX();
