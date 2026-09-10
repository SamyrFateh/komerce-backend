/**
 * @komerce-arch-lite
 * @role          boutique-market-hydration
 * @domain        catalog
 * @layer         ui-adapter
 * @owner         public/boutique/js/market-context.js
 * @purpose       Hydrate les littéraux de marché dans le DOM sans script inline, compatible CSP stricte.
 * @impact-areas  boutique, market, hero, seo, checkout
 * @version       2026-09
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

  if (document.body) document.body.dataset.marketCode = market.code;

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

  // Le checkout historique reste structuré autour du vocabulaire insulaire KM.
  // Tant que la résolution native multi-marché du picker n'est pas devenue
  // autoritative, ce boundary de présentation remplace uniquement les
  // littéraux visibles pour les previews non-KM. Aucune sélection de relais,
  // aucun market_id ni aucune autorisation ne sont fabriqués ici : ces valeurs
  // proviennent toujours de /api/relais, désormais filtré par marché.
  if (market.code === 'KM') return;

  const relayZone = String(market.relay_default_zone || '').trim();
  const groupLabel = String(market.relay_group_label || 'Zone').trim();

  function replaceText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function hydrateRelayCheckout() {
    const summarySub = document.querySelector('#ck-relais-summary .ck-step-header-sub:not(.ck-relais-map-link)');
    if (summarySub && relayZone) {
      replaceText(summarySub, relayZone + ' · ' + market.name);
    }

    const overlay = document.querySelector('.ck-relais-overlay');
    if (!overlay) return;

    overlay.querySelectorAll('.ck-relais-step').forEach(step => {
      if (!/Île|Ile/.test(step.textContent || '')) return;
      const number = step.querySelector('.ck-relais-step-n')?.textContent || '1';
      step.innerHTML = '';
      const badge = document.createElement('span');
      badge.className = 'ck-relais-step-n';
      badge.textContent = number;
      step.append(badge, document.createTextNode(' ' + groupLabel));
    });

    if (relayZone) {
      overlay.querySelectorAll('.ck-relais-iles button').forEach(button => {
        if ((button.textContent || '').trim() === 'Comores') replaceText(button, relayZone);
      });

      const cta = overlay.querySelector('.ck-relais-sheet-cta');
      if (cta && /Valider\s+Comores/.test(cta.textContent || '')) {
        replaceText(cta, 'Valider ' + relayZone);
      }
    }

    const cap = overlay.querySelector('.ck-relais-auto-cap');
    if (cap) replaceText(cap, 'Point de retrait sélectionné automatiquement.');
  }

  hydrateRelayCheckout();

  const checkoutRoot = document.getElementById('k-order-modal') || document.body;
  if (!checkoutRoot || typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(hydrateRelayCheckout);
  observer.observe(checkoutRoot, { childList: true, subtree: true });
})();
