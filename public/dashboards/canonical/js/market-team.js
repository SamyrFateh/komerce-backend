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
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

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
    'execution.order.mark_ordered': 'Envoyer une commande au sourcing',
    'execution.distribution.run': 'Lancer la répartition',
    'execution.parcel.ship': 'Expédier un colis',
    'execution.inventory.assign': 'Affecter l’inventaire à un colis',
    'execution.parcel.receive': 'Réceptionner un colis au relais',
    'execution.parcel.collect': 'Remettre un colis au client',
    'execution.cash.confirm': 'Confirmer un encaissement terrain',
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
    'execution.order.mark_ordered',
    'execution.distribution.run',
    'execution.parcel.ship',
    'execution.inventory.assign',
    'execution.parcel.receive',
    'execution.parcel.collect',
    'execution.cash.confirm',
  ]);

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
    card.appendChild(presetControls(checklist, available, team.actor_capabilities));
    card.appendChild(checklist);

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
      const current = el('div', 'kmc-team-summary');
      member.capabilities.forEach(cap => current.appendChild(pill(capabilityLabel(cap))));
      card.appendChild(current);
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
        section.dataset.marketTeam = '';
        section.appendChild(el('h2', 'kmc-section-title', 'Équipe & délégation'));
        section.appendChild(el('div', 'kmc-team-empty', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
        root.appendChild(section);
        return;
      }

      const section = el('section', 'kmc-section kmc-team-section');
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

      const memberList = el('div', 'kmc-team-list');
      memberList.appendChild(el('strong', '', 'Membres'));
      if (!(team.members || []).length) memberList.appendChild(el('div', 'kmc-team-empty', 'Aucun membre dans ce mandat.'));
      (team.members || []).forEach(member => memberList.appendChild(renderMember(team, marketCode, member, refresh)));
      section.appendChild(memberList);

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

  const observer = new MutationObserver(() => { void mountTeam(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountTeam();
})(window);
