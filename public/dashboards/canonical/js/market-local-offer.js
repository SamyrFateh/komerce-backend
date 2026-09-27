/**
 * @komerce-arch
 * @role          market-autonomy-local-offer-delegation-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        authenticated user, server admin context, market-delegation local-offer read model
 * @outputs       local offer exposure controls (services + offres physiques)
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/local-offer/services, /api/market-delegation/markets/:marketCode/local-offer/physical-offers
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, local-offer
 * @version       2026-09
 */
'use strict';

/**
 * Même patron exact que market-team.js et market-network.js (IIFE,
 * helpers el()/request(), montage conditionnel sur .kmc-workspace,
 * MutationObserver de remount, capacité absente = section absente).
 *
 * Capacités vérifiées dans le code serveur avant écriture de ce fichier :
 *   - services/market-delegation-local-offer-service.js : lecture ET
 *     bascule d'exposition (services + offres physiques) exigent toutes
 *     deux la même capacité unique local_offer.manage — pas de capacité
 *     read séparée.
 *   - Cette UI ne CRÉE ni ne modifie le contenu (titre/description) d'un
 *     service ou d'une offre physique — ce sont des ressources fournies
 *     ailleurs (admin/provider global). Le seul levier délégué au market
 *     manager est la bascule commercial_exposure ENABLED/DISABLED sur
 *     son propre Market ID (PUT .../services/:id et .../physical-offers/:id,
 *     champ body.commercial_exposure — vérifié dans routes/market-
 *     delegation-local-offer.js, valeurs réelles ENABLED/DISABLED
 *     confirmées dans services/providers-service.js, pas ENABLED/HIDDEN
 *     malgré le nommage de l'action d'audit LOCAL_SERVICE_HIDDEN qui ne
 *     désigne que le libellé du log, jamais la valeur stockée).
 */
(function bootMarketLocalOffer(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  let mounting = false;

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  async function request(url, options = {}) {
    const response = await global.fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code || null;
      throw error;
    }
    return body;
  }

  function marketFromContext(context) {
    const access = context && context.access || {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets : [];
    const requested = new URL(global.location.href).searchParams.get('market');
    if (requested && allowed.includes(requested.toUpperCase())) return requested.toUpperCase();
    if (access.defaultMarket && allowed.includes(access.defaultMarket)) return access.defaultMarket;
    return allowed[0] || null;
  }

  function pill(value, active = false) {
    return el('span', `kmc-team-pill${active ? ' is-active' : ''}`, value);
  }

  async function resolveMarketCode() {
    const context = await request('/api/admin/dashboard/context');
    return marketFromContext(context);
  }

  function renderOfferItem(offer, marketCode, kind, canManage, refresh) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', offer.title));
    copy.appendChild(el('small', '', offer.description || ''));
    head.appendChild(copy);
    head.appendChild(pill(offer.commercial_exposure === 'ENABLED' ? 'Exposé' : 'Masqué', offer.commercial_exposure === 'ENABLED'));
    card.appendChild(head);

    if (canManage) {
      const nextExposure = offer.commercial_exposure === 'ENABLED' ? 'DISABLED' : 'ENABLED';
      const action = el('button', 'kmc-workspace-action is-secondary', nextExposure === 'ENABLED' ? 'Exposer' : 'Masquer');
      action.type = 'button';
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          const segment = kind === 'service' ? 'services' : 'physical-offers';
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/${segment}/${encodeURIComponent(offer.id)}`, {
            method: 'PUT',
            body: { commercial_exposure: nextExposure },
          });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          action.disabled = false;
        }
      });
      card.appendChild(action);
    }
    return card;
  }

  async function mountLocalOffer() {
    if (mounting || root.querySelector('[data-market-local-offer]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;

      let servicesData = null;
      let servicesError = null;
      try {
        servicesData = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/services`);
      } catch (error) {
        if (error.status === 403) servicesError = 'absent';
        else servicesError = error;
      }

      let offersData = null;
      let offersError = null;
      try {
        offersData = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/local-offer/physical-offers`);
      } catch (error) {
        if (error.status === 403) offersError = 'absent';
        else offersError = error;
      }

      // local_offer.manage est une capacité unique pour les deux read
      // models : soit les deux réussissent, soit les deux 403 ensemble —
      // ce cas double-absent reste géré explicitement (jamais de section
      // vide affichée sans raison).
      if (servicesError === 'absent' && offersError === 'absent') return;

      const section = el('section', 'kmc-section kmc-team-section');
      section.dataset.marketLocalOffer = '';
      section.appendChild(el('h2', 'kmc-section-title', 'Offre locale'));
      section.appendChild(el('p', 'kmc-workspace-note', 'Exposer ou masquer les services et offres physiques déjà fournis, uniquement pour ce Market ID. Le contenu (titre, description) reste géré par le fournisseur.'));

      const refresh = async () => {
        section.remove();
        await mountLocalOffer();
      };

      if (servicesData) {
        const canManage = (servicesData.actor_capabilities || []).includes('local_offer.manage');
        const summary = el('div', 'kmc-team-summary');
        summary.appendChild(pill('Services', true));
        summary.appendChild(pill(`${(servicesData.services || []).filter(s => s.commercial_exposure === 'ENABLED').length} exposés`));
        summary.appendChild(pill(`${(servicesData.services || []).filter(s => s.commercial_exposure !== 'ENABLED').length} masqués`));
        section.appendChild(summary);

        const list = el('div', 'kmc-team-list');
        if (!(servicesData.services || []).length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun service rattaché à ce Market ID.'));
        (servicesData.services || []).forEach(s => list.appendChild(renderOfferItem(s, marketCode, 'service', canManage, refresh)));
        section.appendChild(list);
      } else if (servicesError && servicesError !== 'absent') {
        section.appendChild(el('div', 'kmc-team-empty', `${servicesError.message}${servicesError.code ? ` · ${servicesError.code}` : ''}`));
      }

      if (offersData) {
        const canManage = (offersData.actor_capabilities || []).includes('local_offer.manage');
        const summary = el('div', 'kmc-team-summary');
        summary.appendChild(pill('Offres physiques', true));
        summary.appendChild(pill(`${(offersData.physical_offers || []).filter(o => o.commercial_exposure === 'ENABLED').length} exposées`));
        summary.appendChild(pill(`${(offersData.physical_offers || []).filter(o => o.commercial_exposure !== 'ENABLED').length} masquées`));
        section.appendChild(summary);

        const list = el('div', 'kmc-team-list');
        if (!(offersData.physical_offers || []).length) list.appendChild(el('div', 'kmc-team-empty', 'Aucune offre physique rattachée à ce Market ID.'));
        (offersData.physical_offers || []).forEach(o => list.appendChild(renderOfferItem(o, marketCode, 'physical-offer', canManage, refresh)));
        section.appendChild(list);
      } else if (offersError && offersError !== 'absent') {
        section.appendChild(el('div', 'kmc-team-empty', `${offersError.message}${offersError.code ? ` · ${offersError.code}` : ''}`));
      }

      root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  const observer = new MutationObserver(() => { void mountLocalOffer(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountLocalOffer();
})(window);
