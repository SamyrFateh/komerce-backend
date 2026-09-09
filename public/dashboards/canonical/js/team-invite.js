/**
 * @komerce-arch
 * @role          market-team-invitation-acceptance-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        invitation token from URL, authenticated identity, server delegation context
 * @outputs       explicit invitation acceptance, delegated portal entrypoint
 * @depends       /api/auth/me, /api/market-delegation/team/invitations/:token/accept, /api/admin/dashboard/context
 * @used-by       /dashboards/canonical/team-invite.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invitation_acceptance_is_explicit, server_context_is_authority, token_removed_after_acceptance
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, team
 * @version       2026-09
 */
'use strict';

(function bootTeamInvite(global) {
  const root = global.document && global.document.getElementById('market-team-invite-root');
  if (!root) return;

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function replaceBody(...nodes) {
    root.replaceChildren();
    root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · ÉQUIPE PAYS'));
    nodes.forEach(node => root.appendChild(node));
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

  function currentPath() {
    return global.location.pathname + global.location.search + global.location.hash;
  }

  function loginHref() {
    return '/login.html?next=' + encodeURIComponent(currentPath());
  }

  function tokenFromUrl() {
    return new URL(global.location.href).searchParams.get('token') || '';
  }

  function marketFromContext(context) {
    const access = context && context.access || {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets : [];
    if (access.defaultMarket && allowed.includes(access.defaultMarket)) return access.defaultMarket;
    return allowed[0] || null;
  }

  function marketAutonomyHref(marketCode) {
    const url = new URL('/dashboards/canonical/market-autonomy.html', global.location.origin);
    if (marketCode) url.searchParams.set('market', marketCode);
    return url.pathname + url.search;
  }

  async function readSession() {
    const response = await global.fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function renderLoginRequired() {
    const title = el('h1', '', 'Connectez-vous pour accepter l’invitation');
    const copy = el('p', 'kmc-team-help', 'Le lien sera conservé pendant la connexion. Utilisez le compte dont l’adresse e-mail a été invitée.');
    const login = el('a', 'kmc-workspace-action', 'Se connecter');
    login.href = loginHref();
    replaceBody(title, copy, login);
  }

  function renderInvalid(message, code) {
    const title = el('h1', '', 'Invitation indisponible');
    const copy = el('p', 'kmc-team-help', `${message || 'Cette invitation ne peut pas être utilisée.'}${code ? ` · ${code}` : ''}`);
    const home = el('a', 'kmc-workspace-action is-secondary', 'Retour à Komerce');
    home.href = '/';
    replaceBody(title, copy, home);
  }

  function renderReady(user, token) {
    const title = el('h1', '', 'Rejoindre l’équipe pays');
    const identity = el('p', 'kmc-team-help', `Compte connecté : ${user.email || user.full_name || user.id || 'identité vérifiée'}.`);
    const note = el('p', 'kmc-team-help', 'En acceptant, vous recevez uniquement les capacités prévues par l’invitation et encore autorisées par le mandat au moment du clic.');
    const accept = el('button', 'kmc-workspace-action', 'Accepter l’invitation');
    accept.type = 'button';
    const status = el('div', 'kmc-team-invite-result');
    status.hidden = true;

    accept.addEventListener('click', async () => {
      accept.disabled = true;
      accept.textContent = 'Acceptation…';
      status.hidden = true;
      try {
        await request(`/api/market-delegation/team/invitations/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          body: {},
        });

        global.history.replaceState({}, '', '/dashboards/canonical/team-invite.html?accepted=1');

        let context = null;
        try {
          context = await request('/api/admin/dashboard/context');
        } catch (_) {
          // L’acceptation est déjà acquise ; le lien /admin revalidera le contexte.
        }
        const marketCode = marketFromContext(context);
        const open = el('a', 'kmc-workspace-action', 'Ouvrir mon espace pays');
        open.href = marketAutonomyHref(marketCode);
        const portal = el('a', 'kmc-workspace-action is-secondary', 'Ouvrir le portail Komerce');
        portal.href = '/admin';
        replaceBody(
          el('h1', '', 'Invitation acceptée ✓'),
          el('p', 'kmc-team-help', marketCode
            ? `Votre accès ${marketCode} est maintenant actif.`
            : 'Votre accès équipe est maintenant actif.'),
          open,
          portal
        );
      } catch (error) {
        status.replaceChildren(
          el('strong', '', error.message),
          el('span', 'kmc-team-help', error.code || 'Acceptation refusée par le serveur.')
        );
        status.hidden = false;
        accept.disabled = false;
        accept.textContent = 'Accepter l’invitation';
      }
    });

    replaceBody(title, identity, note, accept, status);
  }

  async function boot() {
    const token = tokenFromUrl();
    if (!token || token.length < 20) {
      if (new URL(global.location.href).searchParams.get('accepted') === '1') {
        replaceBody(
          el('h1', '', 'Invitation déjà traitée'),
          el('p', 'kmc-team-help', 'Ouvrez votre espace pays depuis le portail Komerce.'),
          Object.assign(el('a', 'kmc-workspace-action', 'Ouvrir le portail Komerce'), { href: '/admin' })
        );
        return;
      }
      renderInvalid('Lien d’invitation incomplet.', 'TEAM_INVITATION_INVALID');
      return;
    }

    try {
      const user = await readSession();
      if (!user) {
        renderLoginRequired();
        return;
      }
      renderReady(user, token);
    } catch (error) {
      renderInvalid(error.message, error.code);
    }
  }

  void boot();
})(window);
