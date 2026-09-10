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
   * Le checkout historique appelle encore `/api/relais` sans query string et
   * regroupe les relais via le champ legacy `island`. Hors KM, la vérité
   * géographique est désormais `zone` (migration 200 a rendu `island`
   * nullable/non applicable). Ce bridge fait donc deux choses strictement
   * présentationnelles :
   *   1) porte explicitement ?market=<code> sur les lectures relais ;
   *   2) adapte `zone -> island` uniquement dans la réponse JS consommée par
   *      l'ancien picker, sans jamais réécrire la donnée serveur.
   *
   * Le filtrage `market_code` est un garde-fou supplémentaire : même en cas de
   * cache/réponse incohérente, un relais KM ne peut plus être rendu dans CM/CG.
   * L'autorité transactionnelle reste le relais_id vérifié côté serveur.
   */
  function relayReadUrl(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      if (url.pathname !== '/api/relais' && url.pathname !== '/api/relais/public') return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function scopeRelayPath(raw) {
    const url = relayReadUrl(raw);
    if (!url || !overrideCode) return raw;
    url.searchParams.set('market', market.code);
    return /^https?:\/\//i.test(raw)
      ? url.href
      : url.pathname + url.search + url.hash;
  }

  function adaptRelayRow(row) {
    if (!row || typeof row !== 'object') return row;
    const rowMarket = String(row.market_code || '').trim().toUpperCase();
    if (rowMarket && rowMarket !== market.code) return null;

    // KM reste intégralement inchangé. Pour les marchés non insulaires, le
    // picker legacy lit `island` alors que la donnée canonique est `zone`.
    if (market.code === 'KM') return row;
    const group = String(row.zone || row.island || market.relay_default_zone || '').trim();
    return group ? { ...row, island: group } : row;
  }

  function adaptRelayPayload(payload) {
    if (Array.isArray(payload)) {
      return payload.map(adaptRelayRow).filter(Boolean);
    }
    if (!payload || typeof payload !== 'object') return payload;

    if (Array.isArray(payload.relais)) {
      return {
        ...payload,
        relais: payload.relais.map(adaptRelayRow).filter(Boolean),
      };
    }
    if (Array.isArray(payload.data)) {
      return {
        ...payload,
        data: payload.data.map(adaptRelayRow).filter(Boolean),
      };
    }
    return payload;
  }

  function installRelayPreviewFetchScope() {
    if (!overrideCode || typeof window.fetch !== 'function') return;
    if (window.fetch.__komerceRelayPreviewScoped === true) return;

    const nativeFetch = window.fetch.bind(window);

    function scopedFetch(input, init) {
      const raw = typeof input === 'string'
        ? input
        : (typeof URL !== 'undefined' && input instanceof URL ? input.href : null);

      if (!raw) return nativeFetch(input, init);
      const next = scopeRelayPath(raw);
      return nativeFetch(next, init);
    }

    Object.defineProperty(scopedFetch, '__komerceRelayPreviewScoped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    window.fetch = scopedFetch;
  }

  function installRelayPreviewRequestScope() {
    if (!overrideCode || !window.K || typeof window.K.request !== 'function') return false;
    if (window.K.request.__komerceRelayPreviewScoped === true) return true;

    const nativeRequest = window.K.request.bind(window.K);
    async function scopedRequest(path, method, body, retries, options) {
      const relayRead = Boolean(relayReadUrl(path));
      const nextPath = relayRead ? scopeRelayPath(path) : path;
      const payload = await nativeRequest(nextPath, method, body, retries, options);
      return relayRead ? adaptRelayPayload(payload) : payload;
    }

    Object.defineProperty(scopedRequest, '__komerceRelayPreviewScoped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    window.K.request = scopedRequest;
    return true;
  }

  installRelayPreviewFetchScope();

  // market-hydration est volontairement chargé avant komerce-api.js. Le fetch
  // scope agit immédiatement ; le scope K.request est installé dès que K existe
  // afin d'adapter aussi la projection `zone -> island` du picker legacy.
  if (!installRelayPreviewRequestScope()) {
    setTimeout(installRelayPreviewRequestScope, 0);
    window.addEventListener('DOMContentLoaded', installRelayPreviewRequestScope, { once: true });
  }

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
      const alreadyStale = currentGroup === 'Point de retrait à actualiser';

      // Une réponse cross-market est filtrée avant le rendu. Cette branche reste
      // un fail-visible de défense si un vieux DOM KM était déjà présent.
      if (staleKmGroup || alreadyStale) {
        replaceText(summarySub, 'Point de retrait à actualiser · ' + market.name);
      } else {
        const selectedGroup = currentGroup && currentGroup !== 'Comores'
          ? currentGroup
          : relayZone;
        if (selectedGroup) replaceText(summarySub, selectedGroup + ' · ' + market.name);
      }
    }

    const overlay = document.querySelector('.ck-relais-overlay');
    if (!overlay) return;

    overlay.querySelectorAll('.ck-relais-step').forEach(step => {
      if (!/île|ile/i.test(step.textContent || '')) return;
      const number = step.querySelector('.ck-relais-step-n')?.textContent || '1';
      step.innerHTML = '';
      const badge = document.createElement('span');
      badge.className = 'ck-relais-step-n';
      badge.textContent = number;
      step.append(badge, document.createTextNode(' ' + groupLabel));
    });

    if (relayZone) {
      overlay.querySelectorAll('.ck-relais-iles button').forEach(button => {
        const text = (button.textContent || '').trim();
        if (text === 'Comores' || text === market.name) replaceText(button, relayZone);
      });

      const cta = overlay.querySelector('.ck-relais-sheet-cta');
      if (cta && /Valider\s+Comores/i.test(cta.textContent || '')) {
        replaceText(cta, 'Valider ' + relayZone);
      }
    }

    const cap = overlay.querySelector('.ck-relais-auto-cap');
    if (cap) replaceText(cap, 'Point de retrait sélectionné automatiquement.');
  }

  hydrateRelayCheckout();

  if (typeof MutationObserver !== 'function') return;

  const checkoutRoot = document.getElementById('k-order-modal') || document.body;
  if (checkoutRoot) {
    const checkoutObserver = new MutationObserver(hydrateRelayCheckout);
    checkoutObserver.observe(checkoutRoot, { childList: true, subtree: true });
  }

  if (document.body && checkoutRoot !== document.body) {
    const overlayObserver = new MutationObserver(mutations => {
      const relayOverlayAdded = mutations.some(mutation =>
        Array.from(mutation.addedNodes || []).some(node =>
          node?.nodeType === 1
          && (node.matches?.('.ck-relais-overlay') || node.querySelector?.('.ck-relais-overlay'))
        )
      );
      if (relayOverlayAdded) hydrateRelayCheckout();
    });
    overlayObserver.observe(document.body, { childList: true });
  }
})();
