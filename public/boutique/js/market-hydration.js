/**
 * @komerce-arch-lite
 * @role          boutique-market-hydration
 * @domain        catalog
 * @layer         ui-adapter
 * @owner         public/boutique/js/market-context.js
 * @purpose       Hydrate les littéraux de marché dans le DOM sans script inline, compatible CSP stricte.
 * @impact-areas  boutique, market, hero, seo
 * @version       2026-08
 */
'use strict';

(function hydrateMarketLiterals() {
  const marketApi = window.KomerceMarket;
  if (!marketApi) return;

  const overrideCode = marketApi.getPreviewOverride?.();
  const market = overrideCode
    ? marketApi.getByCode?.(overrideCode)
    : marketApi.get?.();
  if (!market) return;

  const map = {
    'k-meta-desc':          ['content', market.seo_description],
    'k-og-title':           ['content', market.og_title],
    'k-og-desc':            ['content', market.og_description],
    'k-hero-h1':            ['text',    market.seo_title],
    'k-hero-img-tag':       ['alt',     market.seo_title],
    'k-hero-badge':         ['text',    market.gentile],
    'k-hero-sub':           ['text',    market.delivery_line],
    'k-sc-free-ship-label': ['text',    market.free_ship_label],
    'k-footer-tagline':     ['text',    market.footer_tagline],
  };

  for (const [id, [kind, value]] of Object.entries(map)) {
    const element = document.getElementById(id);
    if (!element || value == null) continue;
    if (kind === 'text') element.textContent = value;
    else element.setAttribute(kind, value);
  }
})();
