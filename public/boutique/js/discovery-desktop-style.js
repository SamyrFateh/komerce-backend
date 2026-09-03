/**
 * @komerce-arch-lite
 * @role          discovery-desktop-style-loader
 * @domain        catalog
 * @layer         ui-runtime
 * @owner         public/boutique/js/discovery-rail.js
 * @purpose       Charger le bundle desktop One Card sans injecter de règles CSS depuis JavaScript.
 * @impact-areas  discovery-rail, product-discovery, desktop
 * @version       2026-09
 */
'use strict';

const STYLE_ID = 'k-discovery-desktop-v2-style';
const STYLE_HREF = '/boutique/css/dist/discovery-desktop-v2.css?v=3';

export function ensureDiscoveryDesktopV2Stylesheet() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 900px)').matches) {
    return null;
  }

  const existing = document.getElementById(STYLE_ID);
  if (existing) return existing;

  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.media = '(min-width: 900px)';
  link.dataset.discoveryDesktopV2 = 'true';
  document.head.appendChild(link);
  return link;
}

ensureDiscoveryDesktopV2Stylesheet();
