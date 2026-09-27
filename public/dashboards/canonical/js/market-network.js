/**
 * @komerce-arch
 * @role          market-autonomy-network-delegation-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        authenticated user, server admin context, market-delegation network read model
 * @outputs       network roster controls (relais + prestataires), suspend/activate mutations
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/network/relais, /api/market-delegation/markets/:marketCode/network/providers
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, network
 * @version       2026-09
 */
'use strict';

/**
 * Suit exactement le patron déjà établi par market-team.js (même IIFE,
 * mêmes helpers el()/request(), même section montée dans #market-autonomy-root
 * une fois que .kmc-workspace est prêt, même observer de remount, même
 * doctrine "pas de droit reconstruit côté client — 403 = section absente,
 * jamais grisée"). Capacités vérifiées dans le code serveur avant écriture
 * de ce fichier (jamais supposées) :
 *   - GET  network/relais                              → network.read
 *   - POST network/relais                               → network.create
 *   - PUT  network/relais/:id                            → network.update
 *   - POST network/relais/:id/suspend                    → network.suspend
 *   - POST network/relais/:id/activate                   → network.update
 *   - GET/POST/PUT/suspend/activate network/providers     → provider.manage (capacité unique)
 */
(function bootMarketNetwork(global) {
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

  // ── Relais ──────────────────────────────────────────────────────────

  function renderRelaisCreateForm(marketCode, canCreate, refresh) {
    if (!canCreate) return null;
    const card = el('article', 'kmc-team-invite');
    card.appendChild(el('strong', '', 'Ajouter un relais'));
    card.appendChild(el('p', 'kmc-team-help', 'Un relais nouvellement créé est actif immédiatement — vérifiez les coordonnées avant de valider.'));

    const fields = [
      ['name', 'Nom du relais', true],
      ['agent_name', 'Agent responsable', true],
      ['phone', 'Téléphone', true],
      ['address', 'Adresse', true],
      ['island', 'Île / zone', false],
    ];
    const inputs = {};
    const grid = el('div', 'kmc-team-capabilities');
    fields.forEach(([key, label, required]) => {
      const wrap = el('label', 'kmc-team-capability');
      wrap.style.display = 'grid';
      wrap.style.gridTemplateColumns = '1fr';
      const span = el('span', '', label + (required ? ' *' : ''));
      const input = global.document.createElement('input');
      input.type = 'text';
      input.className = 'kmc-team-input';
      input.required = !!required;
      inputs[key] = input;
      wrap.appendChild(span);
      wrap.appendChild(input);
      grid.appendChild(wrap);
    });
    card.appendChild(grid);

    const submit = el('button', 'kmc-workspace-action', 'Créer le relais');
    submit.type = 'button';
    card.appendChild(submit);

    const result = el('div', 'kmc-team-invite-result');
    result.hidden = true;
    card.appendChild(result);

    submit.addEventListener('click', async () => {
      if (!inputs.name.value.trim() || !inputs.agent_name.value.trim() || !inputs.phone.value.trim() || !inputs.address.value.trim()) {
        result.hidden = false;
        result.textContent = 'Nom, agent, téléphone et adresse sont obligatoires.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Création…';
      result.hidden = true;
      try {
        await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais`, {
          method: 'POST',
          body: {
            name: inputs.name.value.trim(),
            agent_name: inputs.agent_name.value.trim(),
            phone: inputs.phone.value.trim(),
            address: inputs.address.value.trim(),
            island: inputs.island.value.trim() || undefined,
          },
        });
        await refresh();
      } catch (error) {
        result.hidden = false;
        result.textContent = `${error.message}${error.code ? ` · ${error.code}` : ''}`;
        submit.disabled = false;
        submit.textContent = 'Créer le relais';
      }
    });

    return card;
  }

  function renderRelaisItem(relais, marketCode, canUpdate, canSuspend, refresh) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', relais.name));
    copy.appendChild(el('small', '', `${relais.agent_name || ''} · ${relais.phone || ''} · ${relais.address || ''}`));
    head.appendChild(copy);
    head.appendChild(pill(relais.is_active ? 'Actif' : 'Suspendu', relais.is_active));
    card.appendChild(head);

    if ((relais.is_active && canSuspend) || (!relais.is_active && canUpdate)) {
      const action = el(
        'button',
        'kmc-workspace-action is-secondary',
        relais.is_active ? 'Suspendre' : 'Réactiver'
      );
      action.type = 'button';
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          const endpoint = relais.is_active ? 'suspend' : 'activate';
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais/${encodeURIComponent(relais.id)}/${endpoint}`, { method: 'POST' });
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

  // ── Prestataires ────────────────────────────────────────────────────

  function renderProviderCreateForm(marketCode, canManage, refresh) {
    if (!canManage) return null;
    const card = el('article', 'kmc-team-invite');
    card.appendChild(el('strong', '', 'Ajouter un prestataire'));

    const row = el('div', 'kmc-team-form-row');
    const name = global.document.createElement('input');
    name.type = 'text';
    name.className = 'kmc-team-input';
    name.placeholder = 'Nom du prestataire';
    const phone = global.document.createElement('input');
    phone.type = 'text';
    phone.className = 'kmc-team-input';
    phone.placeholder = 'Téléphone';
    row.appendChild(name);
    row.appendChild(phone);
    card.appendChild(row);

    const submit = el('button', 'kmc-workspace-action', 'Ajouter');
    submit.type = 'button';
    card.appendChild(submit);

    const result = el('div', 'kmc-team-invite-result');
    result.hidden = true;
    card.appendChild(result);

    submit.addEventListener('click', async () => {
      if (!name.value.trim() || !phone.value.trim()) {
        result.hidden = false;
        result.textContent = 'Nom et téléphone sont obligatoires.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Ajout…';
      result.hidden = true;
      try {
        await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers`, {
          method: 'POST',
          body: { name: name.value.trim(), phone: phone.value.trim() },
        });
        await refresh();
      } catch (error) {
        result.hidden = false;
        result.textContent = `${error.message}${error.code ? ` · ${error.code}` : ''}`;
        submit.disabled = false;
        submit.textContent = 'Ajouter';
      }
    });

    return card;
  }

  const PROVIDER_STATUS_LABEL = Object.freeze({
    pending: 'En attente d’activation',
    active: 'Actif',
    suspended: 'Suspendu',
  });

  function renderProviderItem(provider, marketCode, canManage, refresh) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', provider.name));
    copy.appendChild(el('small', '', provider.phone || ''));
    head.appendChild(copy);
    head.appendChild(pill(PROVIDER_STATUS_LABEL[provider.status] || provider.status, provider.status === 'active'));
    card.appendChild(head);

    if (canManage) {
      const actions = el('div', 'kmc-team-actions');
      if (provider.status !== 'active') {
        const activate = el('button', 'kmc-workspace-action is-secondary', 'Activer');
        activate.type = 'button';
        activate.addEventListener('click', async () => {
          activate.disabled = true;
          try {
            await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers/${encodeURIComponent(provider.id)}/activate`, { method: 'POST' });
            await refresh();
          } catch (error) {
            global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
            activate.disabled = false;
          }
        });
        actions.appendChild(activate);
      }
      if (provider.status !== 'suspended') {
        const suspend = el('button', 'kmc-workspace-action is-secondary', 'Suspendre');
        suspend.type = 'button';
        suspend.addEventListener('click', async () => {
          suspend.disabled = true;
          try {
            await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers/${encodeURIComponent(provider.id)}/suspend`, { method: 'POST' });
            await refresh();
          } catch (error) {
            global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
            suspend.disabled = false;
          }
        });
        actions.appendChild(suspend);
      }
      card.appendChild(actions);
    }
    return card;
  }

  // ── Montage ─────────────────────────────────────────────────────────

  async function mountNetwork() {
    if (mounting || root.querySelector('[data-market-network]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;

      let relaisData = null;
      let relaisError = null;
      try {
        relaisData = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/relais`);
      } catch (error) {
        if (error.status === 403) relaisError = 'absent';
        else relaisError = error;
      }

      let providersData = null;
      let providersError = null;
      try {
        providersData = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/network/providers`);
      } catch (error) {
        if (error.status === 403) providersError = 'absent';
        else providersError = error;
      }

      // Ni relais ni prestataires visibles pour cet acteur : aucune section,
      // jamais une section grisée (doctrine).
      if (relaisError === 'absent' && providersError === 'absent') return;

      const section = el('section', 'kmc-section kmc-team-section');
      section.dataset.marketNetwork = '';
      section.appendChild(el('h2', 'kmc-section-title', 'Réseau local'));
      section.appendChild(el('p', 'kmc-workspace-note', 'Relais et prestataires rattachés à ce Market ID. Un relais suspendu reste dans l’historique mais ne reçoit plus de nouvelles affectations.'));

      const refresh = async () => {
        section.remove();
        await mountNetwork();
      };

      if (relaisData) {
        const canCreate = (relaisData.actor_capabilities || []).includes('network.create');
        const canUpdate = (relaisData.actor_capabilities || []).includes('network.update');
        const canSuspend = (relaisData.actor_capabilities || []).includes('network.suspend');

        const summary = el('div', 'kmc-team-summary');
        summary.appendChild(pill('Relais', true));
        summary.appendChild(pill(`${(relaisData.relais || []).filter(r => r.is_active).length} actifs`));
        summary.appendChild(pill(`${(relaisData.relais || []).filter(r => !r.is_active).length} suspendus`));
        section.appendChild(summary);

        const form = renderRelaisCreateForm(marketCode, canCreate, refresh);
        if (form) section.appendChild(form);

        const list = el('div', 'kmc-team-list');
        if (!(relaisData.relais || []).length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun relais dans ce Market ID.'));
        (relaisData.relais || []).forEach(r => list.appendChild(renderRelaisItem(r, marketCode, canUpdate, canSuspend, refresh)));
        section.appendChild(list);
      } else if (relaisError && relaisError !== 'absent') {
        section.appendChild(el('div', 'kmc-team-empty', `${relaisError.message}${relaisError.code ? ` · ${relaisError.code}` : ''}`));
      }

      if (providersData) {
        const canManage = (providersData.actor_capabilities || []).includes('provider.manage');

        const summary = el('div', 'kmc-team-summary');
        summary.appendChild(pill('Prestataires', true));
        summary.appendChild(pill(`${(providersData.providers || []).filter(p => p.status === 'active').length} actifs`));
        summary.appendChild(pill(`${(providersData.providers || []).filter(p => p.status === 'pending').length} en attente`));
        section.appendChild(summary);

        const form = renderProviderCreateForm(marketCode, canManage, refresh);
        if (form) section.appendChild(form);

        const list = el('div', 'kmc-team-list');
        if (!(providersData.providers || []).length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun prestataire dans ce Market ID.'));
        (providersData.providers || []).forEach(p => list.appendChild(renderProviderItem(p, marketCode, canManage, refresh)));
        section.appendChild(list);
      } else if (providersError && providersError !== 'absent') {
        section.appendChild(el('div', 'kmc-team-empty', `${providersError.message}${providersError.code ? ` · ${providersError.code}` : ''}`));
      }

      root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  const observer = new MutationObserver(() => { void mountNetwork(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountNetwork();
})(window);
