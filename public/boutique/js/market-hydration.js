/**
 * @komerce-arch-lite
 * @role          boutique-market-hydration
 * @domain        catalog
 * @layer         ui-adapter
 * @owner         public/boutique/js/market-context.js
 * @purpose       Hydrate les littéraux de marché dans le DOM et propager
 *                explicitement le MarketContext de preview aux lectures relais.
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

  /*
   * Preview market -> relay API boundary.
   *
   * Le checkout historique appelle encore `/api/relais` sans query string.
   * La route sait filtrer par `?market=`, mais compter sur Referer pour porter
   * le contexte de navigation est trop fragile et a déjà produit une fuite
   * visuelle KM dans `?market=CM`.
   *
   * Ce bridge est strictement limité aux deux lectures publiques relais,
   * same-origin, et uniquement lorsqu'un `?market=` de preview valide existe.
   * Il ne fabrique aucun market_id, n'autorise rien et ne touche jamais aux
   * mutations : l'autorité transactionnelle reste le `relais_id` résolu serveur.
   */
  function installRelayPreviewScope() {
    if (!overrideCode || typeof window.fetch !== 'function') return;
    if (window.fetch.__komerceRelayPreviewScoped === true) return;

    const nativeFetch = window.fetch.bind(window);

    function scopedFetch(input, init) {
      const raw = typeof input === 'string'
        ? input
        : (typeof URL !== 'undefined' && input instanceof URL ? input.href : null);

      if (!raw) return nativeFetch(input, init);

      try {
        const url = new URL(raw, window.location.origin);
        const relayRead = url.pathname === '/api/relais'
          || url.pathname === '/api/relais/public';

        if (!relayRead || url.origin !== window.location.origin) {
          return nativeFetch(input, init);
        }

        url.searchParams.set('market', market.code);
        const next = /^https?:\/\//i.test(raw)
          ? url.href
          : url.pathname + url.search + url.hash;
        return nativeFetch(next, init);
      } catch (_) {
        return nativeFetch(input, init);
      }
    }

    Object.defineProperty(scopedFetch, '__komerceRelayPreviewScoped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    window.fetch = scopedFetch;
  }

  installRelayPreviewScope();

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

  // KM garde le picker insulaire historique tel quel.
  if (market.code === 'KM') return;

  const relayZone = String(market.relay_default_zone || '').trim();
  const groupLabel = String(market.relay_group_label || 'Zone').trim();

  function replaceText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function inferSummaryZone(summary) {
    if (!summary) return null;
    const label = String(
      summary.querySelector('.ck-step-header-label')?.textContent || ''
    ).toLocaleLowerCase('fr');

    const candidates = market.code === 'CM'
      ? ['Yaoundé', 'Douala']
      : market.code === 'CG'
        ? ['Brazzaville', 'Pointe-Noire']
        : [];

    return candidates.find(city => label.includes(city.toLocaleLowerCase('fr')))
      || relayZone
      || null;
  }

  function hydrateRelayCheckout() {
    const summary = document.querySelector('#ck-relais-summary');
    const summarySub = summary?.querySelector(
      '.ck-step-header-sub:not(.ck-relais-map-link)'
    );

    if (summarySub) {
      const currentGroup = String(summarySub.textContent || '')
        .split('·')[0]
        .trim();
      const staleKmGroup = ['Ndzouani', 'Ngazidja', 'Mwali'].includes(currentGroup);

      // Ne jamais maquiller un vrai relais KM en relais CM/CG : si un vieux
      // résultat est encore présent, on demande simplement son actualisation.
      if (staleKmGroup) {
        replaceText(summarySub, 'Point de retrait à actualiser · ' + market.name);
      } else {
        const selectedZone = inferSummaryZone(summary);
        if (selectedZone) replaceText(summarySub, selectedZone + ' · ' + market.name);
      }
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
