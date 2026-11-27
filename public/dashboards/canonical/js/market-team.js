/**
 * @komerce-arch
 * @role          market-autonomy-team-delegation-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        authenticated user, server admin context, market-delegation team read model
 * @outputs       team delegation controls, invitation link, membership capability mutations
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/team
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, team
 * @version       2026-09
 */
'use strict';

(function bootMarketTeam(global) {
  function createInstance(root, { embedded = false, selectedMarket = null } = {}) {

  const LABELS = Object.freeze({
    'pricing.read': 'Lire les prix',
    'pricing.simulate': 'Simuler les prix',
    'pricing.cost_component.update': 'Modifier les coûts locaux',
    'pricing.cost_component.reset': 'Réinitialiser les coûts locaux',
    'pricing.decide': 'Décider un prix local',
    'pricing.activate': 'Activer un prix local',
    'pricing.policy.set': 'Définir la politique prix',
    'market.observation.record': 'Saisir les observations marché',
    'dashboard.market.read': 'Lire le dashboard pays',
    'operations.read': 'Lire les opérations',
    'hub.supervise': 'Superviser le Hub pour le marché',
    'client.read': 'Lire les clients du marché',
    'team.read': 'Voir l’équipe',
    'team.grant': 'Attribuer des droits',
    'team.revoke': 'Retirer des droits',
    'team.invite': 'Inviter des collaborateurs',
    'network.read': 'Lire le réseau local',
    'provider.manage': 'Gérer les prestataires locaux',
    'market_config.read': 'Lire la configuration pays',
    'finance.read': 'Lire la finance du marché',
    'finance.act': 'Demander un règlement',
    'settlement.receive': 'Confirmer la réception d’un règlement',
    'cash_control.policy.manage': 'Gérer le contrôle des encaissements',
    'execution.distribution.run': 'Lancer la répartition',
    'execution.parcel.ship': 'Expédier un colis',
    'execution.inventory.assign': 'Affecter l’inventaire à un colis',
    'execution.parcel.receive': 'Réceptionner un colis au relais',
    'execution.parcel.collect': 'Remettre un colis au client',
    'execution.cash.confirm': 'Confirmer un encaissement terrain',
    'cash.custody.receive': 'Recevoir des espèces en garde (plafond par personne)',
  });

  const READ_PRESET = Object.freeze([
    'pricing.read',
    'pricing.simulate',
    'dashboard.market.read',
    'operations.read',
    'client.read',
    'network.read',
    'market_config.read',
    'finance.read',
  ]);

  const TERRAIN_PRESET = Object.freeze([
    'operations.read',
    'execution.distribution.run',
    'execution.parcel.ship',
    'execution.inventory.assign',
    'execution.parcel.receive',
    'execution.parcel.collect',
    'execution.cash.confirm',
  ]);

  const MEMBER_PAGE_SIZE = 12;

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
    const contract = global.KomerceAdminContext;
    if (!contract || typeof contract.resolveExplicitMarket !== 'function') {
      throw new Error('CANONICAL_MARKET_CONTEXT_UNAVAILABLE');
    }
    const search = embedded && selectedMarket != null
      ? '?market=' + encodeURIComponent(selectedMarket)
      : global.location.search;
    return contract.resolveExplicitMarket(context, search).marketCode;
  }

  function capabilityLabel(capability) {
    return LABELS[capability] || capability.replaceAll('.', ' · ');
  }

  function pill(value, active = false) {
    return el('span', `kmc-team-pill${active ? ' is-active' : ''}`, value);
  }

  function setChecked(container, capabilities) {
    const wanted = new Set(capabilities || []);
    container.querySelectorAll('input[type="checkbox"][data-capability]').forEach(input => {
      input.checked = wanted.has(input.dataset.capability);
    });
  }

  function selectedCapabilities(container) {
    return [...container.querySelectorAll('input[type="checkbox"][data-capability]:checked')]
      .map(input => input.dataset.capability)
      .filter(Boolean);
  }

  function capabilityChecklist(available, selected = []) {
    const grid = el('div', 'kmc-team-capabilities');
    const selectedSet = new Set(selected);
    available.forEach(capability => {
      const label = el('label', 'kmc-team-capability');
      const input = global.document.createElement('input');
      input.type = 'checkbox';
      input.dataset.capability = capability;
      input.checked = selectedSet.has(capability);
      const copy = el('span');
      copy.appendChild(el('strong', '', capabilityLabel(capability)));
      copy.appendChild(el('small', '', capability));
      label.appendChild(input);
      label.appendChild(copy);
      grid.appendChild(label);
    });
    return grid;
  }

  function presetControls(checklist, available, actorCapabilities = []) {
    const wrap = el('div', 'kmc-team-presets');
    const read = el('button', 'kmc-workspace-action is-secondary', 'Preset lecture');
    read.type = 'button';
    read.addEventListener('click', () => setChecked(checklist, READ_PRESET.filter(cap => available.includes(cap))));
    const terrain = el('button', 'kmc-workspace-action is-secondary', 'Preset terrain');
    terrain.type = 'button';
    terrain.addEventListener('click', () => setChecked(checklist, TERRAIN_PRESET.filter(cap => available.includes(cap))));
    const same = el('button', 'kmc-workspace-action is-secondary', 'Même périmètre que moi');
    same.type = 'button';
    same.addEventListener('click', () => setChecked(checklist, actorCapabilities.filter(cap => available.includes(cap))));
    const none = el('button', 'kmc-workspace-action is-secondary', 'Tout décocher');
    none.type = 'button';
    none.addEventListener('click', () => setChecked(checklist, []));
    wrap.append(read, terrain, same, none);
    return wrap;
  }

  function invitationLink(token) {
    const url = new URL('/dashboards/canonical/team-invite.html', global.location.origin);
    url.searchParams.set('token', token);
    return url.toString();
  }

  function renderInvite(team, marketCode, refresh) {
    if (!team.actor_capabilities.includes('team.invite')) return null;
    const card = el('article', 'kmc-team-invite');
    card.appendChild(el('strong', '', 'Inviter un collaborateur'));
    card.appendChild(el('p', 'kmc-team-help', 'Choisissez uniquement les droits nécessaires. Les actions terrain sont délégables explicitement par team.grant et ne deviennent jamais vos propres droits d’exécution.'));

    const row = el('div', 'kmc-team-form-row');
    const email = global.document.createElement('input');
    email.type = 'email';
    email.className = 'kmc-team-input';
    email.placeholder = 'collaborateur@exemple.com';
    email.autocomplete = 'email';
    row.appendChild(email);
    card.appendChild(row);

    const available = [...(team.actor_grantable_capabilities || team.actor_capabilities)].sort();
    const checklist = capabilityChecklist(available, READ_PRESET.filter(cap => available.includes(cap)));
    const rights = global.document.createElement('details');
    rights.className = 'kmc-team-rights';
    const rightsSummary = global.document.createElement('summary');
    rightsSummary.textContent = `Choisir les droits (${selectedCapabilities(checklist).length} sélectionnés)`;
    rights.appendChild(rightsSummary);
    const rightsBody = el('div', 'kmc-team-member-editor');
    rightsBody.appendChild(presetControls(checklist, available, team.actor_capabilities));
    rightsBody.appendChild(checklist);
    rights.appendChild(rightsBody);
    card.appendChild(rights);

    const submit = el('button', 'kmc-workspace-action', 'Inviter');
    submit.type = 'button';
    row.appendChild(submit);

    const result = el('div', 'kmc-team-invite-result');
    result.hidden = true;
    card.appendChild(result);

    submit.addEventListener('click', async () => {
      const value = email.value.trim();
      if (!value) {
        email.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Invitation…';
      result.hidden = true;
      try {
        const response = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/invitations`, {
          method: 'POST',
          body: { email: value, capabilities: selectedCapabilities(checklist) },
        });
        result.replaceChildren();
        if (response.kind === 'membership') {
          result.appendChild(el('strong', '', 'Collaborateur ajouté immédiatement.'));
          result.appendChild(el('span', 'kmc-team-help', 'Un compte Komerce existait déjà avec cet email.'));
          result.hidden = false;
          await refresh();
          return;
        }

        const link = invitationLink(response.invitation_token);
        result.appendChild(el('strong', '', 'Invitation créée — copiez ce lien maintenant.'));
        result.appendChild(el('span', 'kmc-team-help', 'Pour sécurité, le token brut n’est pas conservé et ce lien ne pourra pas être réaffiché après rechargement.'));
        const linkRow = el('div', 'kmc-team-link-row');
        const linkInput = global.document.createElement('input');
        linkInput.className = 'kmc-team-input';
        linkInput.value = link;
        linkInput.readOnly = true;
        const copy = el('button', 'kmc-workspace-action is-secondary', 'Copier');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try {
            await global.navigator.clipboard.writeText(link);
            copy.textContent = 'Copié ✓';
          } catch (_) {
            linkInput.focus();
            linkInput.select();
          }
        });
        linkRow.append(linkInput, copy);
        result.appendChild(linkRow);
        result.hidden = false;
        email.value = '';
        await refresh({ preserveResult: true });
      } catch (error) {
        result.replaceChildren(el('strong', '', error.message), el('span', 'kmc-team-help', error.code || 'Invitation refusée par le serveur.'));
        result.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Inviter';
      }
    });

    return card;
  }

  function renderMember(team, marketCode, member, refresh) {
    const active = member.status === 'ACTIVE';
    const ownMembership = member.membership_id === team.actor_membership_id;
    const canEdit = active && !ownMembership && team.actor_capabilities.includes('team.grant') && team.actor_capabilities.includes('team.revoke');
    const canRevoke = active && !ownMembership && team.actor_capabilities.includes('team.revoke');
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', member.full_name || member.email || 'Collaborateur'));
    copy.appendChild(el('small', '', member.email || member.phone || '—'));
    const badges = el('div', 'kmc-team-summary');
    badges.appendChild(pill(active ? 'Actif' : 'Révoqué', active));
    if (ownMembership) badges.appendChild(pill('Vous', true));
    badges.appendChild(pill(`${(member.capabilities || []).length} droits`));
    head.append(copy, badges);
    card.appendChild(head);

    if (member.capabilities && member.capabilities.length) {
      const details = global.document.createElement('details');
      details.className = 'kmc-team-rights';
      const summary = global.document.createElement('summary');
      summary.textContent = `Voir les ${member.capabilities.length} droits`;
      details.appendChild(summary);
      const current = el('div', 'kmc-team-summary');
      member.capabilities.forEach(cap => current.appendChild(pill(capabilityLabel(cap))));
      details.appendChild(current);
      card.appendChild(details);
    }

    if (canEdit) {
      const details = global.document.createElement('details');
      const summary = global.document.createElement('summary');
      summary.textContent = 'Modifier les droits';
      details.appendChild(summary);
      const editor = el('div', 'kmc-team-member-editor');
      const available = [...(team.actor_grantable_capabilities || team.actor_capabilities)].sort();
      const checklist = capabilityChecklist(available, member.capabilities || []);
      editor.appendChild(presetControls(checklist, available, team.actor_capabilities));
      editor.appendChild(checklist);
      const save = el('button', 'kmc-workspace-action', 'Enregistrer les droits');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/${encodeURIComponent(member.membership_id)}/capabilities`, {
            method: 'PUT',
            body: { capabilities: selectedCapabilities(checklist) },
          });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
        } finally {
          save.disabled = false;
        }
      });
      editor.appendChild(save);
      details.appendChild(editor);
      card.appendChild(details);
    }

    if (canRevoke) {
      const actions = el('div', 'kmc-team-actions');
      const revoke = el('button', 'kmc-workspace-action is-secondary', 'Retirer de l’équipe');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        if (!global.confirm(`Retirer ${member.full_name || member.email || 'ce collaborateur'} de l’équipe ?`)) return;
        revoke.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/${encodeURIComponent(member.membership_id)}`, { method: 'DELETE' });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          revoke.disabled = false;
        }
      });
      actions.appendChild(revoke);
      card.appendChild(actions);
    }
    return card;
  }

  function renderMemberDirectory(team, marketCode, refresh) {
    const list = el('div', 'kmc-team-list');
    const members = [...(team.members || [])].sort((a, b) => {
      const ownA = a.membership_id === team.actor_membership_id ? 1 : 0;
      const ownB = b.membership_id === team.actor_membership_id ? 1 : 0;
      if (ownA !== ownB) return ownB - ownA;
      const activeA = a.status === 'ACTIVE' ? 1 : 0;
      const activeB = b.status === 'ACTIVE' ? 1 : 0;
      if (activeA !== activeB) return activeB - activeA;
      return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''), 'fr');
    });

    list.appendChild(el('strong', '', 'Membres'));
    if (!members.length) {
      list.appendChild(el('div', 'kmc-team-empty', 'Aucun membre dans ce mandat.'));
      return list;
    }

    let visibleLimit = MEMBER_PAGE_SIZE;
    let query = '';
    const cards = members.map(member => {
      const card = renderMember(team, marketCode, member, refresh);
      card.dataset.memberCard = '';
      card.dataset.memberSearch = `${member.full_name || ''} ${member.email || ''} ${member.phone || ''}`.toLocaleLowerCase('fr');
      list.appendChild(card);
      return card;
    });

    if (members.length > MEMBER_PAGE_SIZE) {
      const controls = el('div', 'kmc-team-directory-controls');
      const search = global.document.createElement('input');
      search.type = 'search';
      search.className = 'kmc-team-input';
      search.placeholder = 'Rechercher un membre';
      search.setAttribute('aria-label', 'Rechercher un membre');
      const status = el('span', 'kmc-team-help');
      status.setAttribute('aria-live', 'polite');
      controls.append(search, status);
      list.insertBefore(controls, cards[0]);

      const more = el('button', 'kmc-workspace-action is-secondary', 'Afficher plus');
      more.type = 'button';
      more.dataset.memberMore = '';
      list.appendChild(more);

      const apply = () => {
        const matching = cards.filter(card => !query || card.dataset.memberSearch.includes(query));
        cards.forEach(card => { card.hidden = true; });
        matching.slice(0, visibleLimit).forEach(card => { card.hidden = false; });
        const shown = Math.min(visibleLimit, matching.length);
        status.textContent = `${shown} sur ${matching.length} membres affichés`;
        more.hidden = shown >= matching.length;
        more.textContent = `Afficher ${Math.min(MEMBER_PAGE_SIZE, matching.length - shown)} de plus`;
      };

      search.addEventListener('input', () => {
        query = search.value.trim().toLocaleLowerCase('fr');
        visibleLimit = MEMBER_PAGE_SIZE;
        apply();
      });
      more.addEventListener('click', () => {
        visibleLimit += MEMBER_PAGE_SIZE;
        apply();
      });
      apply();
    }

    return list;
  }

  function renderPending(team, marketCode, invitation, refresh) {
    const card = el('article', 'kmc-team-pending');
    const head = el('div', 'kmc-team-pending-head');
    const copy = el('div', 'kmc-team-pending-copy');
    copy.appendChild(el('strong', '', invitation.email));
    copy.appendChild(el('small', '', `Expire le ${new Date(invitation.expires_at).toLocaleString('fr-FR')}`));
    head.append(copy, pill(invitation.status, invitation.status === 'PENDING'));
    card.appendChild(head);
    if (invitation.requested_capabilities && invitation.requested_capabilities.length) {
      const caps = el('div', 'kmc-team-summary');
      invitation.requested_capabilities.forEach(cap => caps.appendChild(pill(capabilityLabel(cap))));
      card.appendChild(caps);
    }
    if (invitation.status === 'PENDING' && team.actor_capabilities.includes('team.revoke')) {
      const revoke = el('button', 'kmc-workspace-action is-secondary', 'Annuler l’invitation');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          revoke.disabled = false;
        }
      });
      card.appendChild(revoke);
    }
    return card;
  }

  async function resolveMarketCode() {
    const context = await request('/api/admin/dashboard/context');
    return marketFromContext(context);
  }

  async function mountTeam() {
    if (mounting || root.querySelector('[data-market-team]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;
      let team;
      try {
        team = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/team`);
      } catch (error) {
        if (error.status === 403) return;
        const section = el('section', 'kmc-section kmc-team-section');
        section.id = 'market-team';
        section.dataset.marketTeam = '';
        section.appendChild(el('h2', 'kmc-section-title', 'Équipe & délégation'));
        section.appendChild(el('div', 'kmc-team-empty', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
        root.appendChild(section);
        return;
      }

      const section = el('section', 'kmc-section kmc-team-section');
      section.id = 'market-team';
      section.dataset.marketTeam = '';
      section.appendChild(el('h2', 'kmc-section-title', 'Équipe & délégation'));
      section.appendChild(el('p', 'kmc-workspace-note', 'Le partenaire gère son équipe dans son propre Market ID. Les capacités GROUP restent hors de portée.'));
      const summary = el('div', 'kmc-team-summary');
      summary.appendChild(pill(`${team.market.name || marketCode} · ${marketCode}`, true));
      summary.appendChild(pill(`${(team.members || []).filter(member => member.status === 'ACTIVE').length} membres actifs`));
      summary.appendChild(pill(`${(team.invitations || []).filter(invitation => invitation.status === 'PENDING').length} invitations en attente`));
      section.appendChild(summary);

      const refresh = async options => {
        if (options && options.preserveResult) return;
        section.remove();
        await mountTeam();
      };

      const invite = renderInvite(team, marketCode, refresh);
      if (invite) section.appendChild(invite);

      section.appendChild(renderMemberDirectory(team, marketCode, refresh));

      const pending = (team.invitations || []).filter(invitation => invitation.status === 'PENDING');
      if (pending.length) {
        const pendingList = el('div', 'kmc-team-list');
        pendingList.appendChild(el('strong', '', 'Invitations en attente'));
        pending.forEach(invitation => pendingList.appendChild(renderPending(team, marketCode, invitation, refresh)));
        section.appendChild(pendingList);
      }

      root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  if (!embedded) {
    const observer = new MutationObserver(() => { void mountTeam(); });
    observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
    void mountTeam();
  }
  return Object.freeze({ mount: mountTeam });
  }

  global.KomerceMarketTeam = Object.freeze({
    mount: ({ root, marketCode = null } = {}) => {
      if (!root) throw new Error('market-team_root_missing');
      return createInstance(root, { embedded: true, selectedMarket: marketCode }).mount();
    },
  });
  const standalone = global.document && global.document.getElementById('market-autonomy-root');
  if (standalone) createInstance(standalone);
})(window);
