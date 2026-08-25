/**
 * @komerce-arch
 * @role          canonical-client-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, client_phone
 * @outputs       canonical_client_360
 * @depends       primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, canonical_admin_no_legacy_imports, client_account_facets_global_only
 * @impact-areas  admin-dashboard, clients, commerce, shared-cart, auth-passkey, notifications
 * @version       2026-08
 */

'use strict';

(function initClient360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalClient360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createClient360() {
  const ENDPOINT_PREFIX = '/api/admin/entities/clients/';

  function phoneFromPath(pathname) {
    const match = String(pathname || '').match(/^\/admin\/clients\/([^/]+)$/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return null; }
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  }

  function formatKmf(value) {
    return `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function marketLabel(scope) {
    const markets = scope && Array.isArray(scope.markets) ? scope.markets : [];
    if (!markets.length) return scope && scope.mode === 'global' ? 'Global' : 'Périmètre autorisé';
    return markets.map(row => row.code || row.name).filter(Boolean).join(' · ');
  }

  function createHeader(doc, payload) {
    const client = payload.client || {};
    const header = doc.createElement('header');
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'CLIENT 360'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', client.name || client.phone || 'Client'));
    header.appendChild(text(
      doc,
      'p',
      'kmc-entity-subtitle',
      [client.phone, client.country, marketLabel(payload.scope)].filter(Boolean).join(' · ')
    ));

    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [
      ['/admin/commerce', '← Commerce'],
      ['/admin/pilotage', 'Pilotage'],
      ['/admin/operations', 'Opérations'],
    ].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
    return header;
  }

  function metricItems(payload) {
    const summary = payload.summary || {};
    const finance = payload.finance || {};
    const client = payload.client || {};
    const security = payload.security || {};
    const passkeys = security.passkeys || {};

    return [
      { key: 'orders', label: 'Commandes valides', value: formatNumber(summary.orders_valid) },
      { key: 'ltv', label: 'Valeur client', value: formatKmf(finance.ltv_kmf) },
      { key: 'basket', label: 'Panier moyen', value: formatKmf(finance.average_basket_kmf) },
      {
        key: 'silence',
        label: 'Dernière commande',
        value: client.days_since_last_order == null ? '—' : `${formatNumber(client.days_since_last_order)} j`,
        tone: Number(client.days_since_last_order) > 90 ? 'warning' : 'neutral',
      },
      { key: 'markets', label: 'Marchés visibles', value: formatNumber(summary.markets) },
      security.visibility === 'global'
        ? { key: 'passkeys', label: 'Passkeys actifs', value: formatNumber(passkeys.active_count), tone: Number(passkeys.active_count) > 0 ? 'positive' : 'neutral' }
        : { key: 'security', label: 'Sécurité compte', value: 'Central uniquement', tone: 'neutral' },
    ];
  }

  function renderTableSection(rootNode, ui, options) {
    const section = ui.Section.create({ title: options.title, description: options.description });
    rootNode.appendChild(section.element);
    ui.DataTable.render(section.slot, {
      columns: options.columns,
      rows: options.rows,
      emptyText: options.emptyText,
    });
  }

  function renderPayload(rootNode, ui, doc, payload) {
    const client = payload.client || {};
    const scope = payload.scope || {};
    const security = payload.security || { visibility: 'restricted' };

    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload) });

    renderTableSection(rootNode, ui, {
      title: 'Identité & périmètre',
      description: scope.mode === 'global'
        ? 'Vue centrale consolidée du client.'
        : 'Seules les activités rattachées aux marchés autorisés sont visibles.',
      columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Nom', valeur: client.name },
        { champ: 'Téléphone', valeur: client.phone },
        { champ: 'Email', valeur: client.email },
        { champ: 'Pays', valeur: client.country },
        { champ: 'Périmètre', valeur: marketLabel(scope) },
        { champ: 'Première commande', valeur: formatDate(client.first_order_at) },
        { champ: 'Dernière commande', valeur: formatDate(client.last_order_at) },
      ],
      emptyText: 'Aucune identité client disponible.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Commandes',
      description: 'Historique commercial visible dans le périmètre autorisé. La référence ouvre Order 360.',
      columns: [
        { key: 'reference', label: 'Commande' },
        { key: 'market', label: 'Marché' },
        { key: 'status', label: 'Statut' },
        { key: 'payment', label: 'Paiement' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'relais', label: 'Relais' },
        { key: 'date', label: 'Créée' },
      ],
      rows: (payload.orders || []).map(row => ({
        reference: row.reference,
        market: row.market && row.market.code,
        status: row.status,
        payment: row.payment_status,
        total: formatKmf(row.total_kmf),
        relais: row.relais && row.relais.name,
        date: formatDate(row.created_at),
      })),
      emptyText: 'Aucune commande visible.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Produits les plus achetés',
      description: 'Agrégats préparés côté serveur sur les commandes visibles.',
      columns: [
        { key: 'produit', label: 'Produit' },
        { key: 'categorie', label: 'Catégorie' },
        { key: 'quantite', label: 'Qté', align: 'right' },
        { key: 'commandes', label: 'Commandes', align: 'right' },
        { key: 'ca', label: 'Valeur', align: 'right' },
      ],
      rows: (payload.top_products || []).map(row => ({
        produit: row.name,
        categorie: row.category,
        quantite: formatNumber(row.quantity),
        commandes: formatNumber(row.orders_count),
        ca: formatKmf(row.revenue_kmf),
      })),
      emptyText: 'Aucun produit acheté dans le périmètre.',
    });

    if (scope.mode === 'global') {
      renderTableSection(rootNode, ui, {
        title: 'Listes partagées',
        description: 'Facette compte globale : non exposée aux opérateurs pays.',
        columns: [
          { key: 'titre', label: 'Liste' },
          { key: 'status', label: 'Statut' },
          { key: 'progress', label: 'Achetés', align: 'right' },
          { key: 'date', label: 'Créée' },
        ],
        rows: (payload.shared_lists || []).map(row => ({
          titre: row.title,
          status: row.status,
          progress: `${formatNumber(row.claimed_count)}/${formatNumber(row.items_count)}`,
          date: formatDate(row.created_at),
        })),
        emptyText: 'Aucune liste partagée.',
      });
    }

    const alerts = doc.createElement('section');
    rootNode.appendChild(alerts);
    ui.AlertPanel.render(alerts, {
      title: 'Notifications client',
      emptyText: 'Aucune notification client dans le périmètre.',
      items: (payload.notifications || []).map(row => ({
        level: row.severity === 'urgent' && row.status === 'open' ? 'critical' : (row.status === 'open' ? 'warning' : 'info'),
        title: [row.title, row.order_reference].filter(Boolean).join(' · '),
        message: [row.message, row.status, formatDate(row.created_at)].filter(Boolean).join(' · '),
      })),
    });

    if (security.visibility === 'global') {
      const account = security.account || {};
      const passkeys = security.passkeys || {};
      renderTableSection(rootNode, ui, {
        title: 'Compte & authentification',
        description: 'Visible uniquement avec autorité centrale globale explicite.',
        columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
        rows: [
          { champ: 'Rôle', valeur: account.role },
          { champ: 'Préférence devise', valeur: account.currency_pref },
          { champ: 'Dernière connexion', valeur: formatDate(account.last_login_at) },
          { champ: 'Passkeys actifs', valeur: formatNumber(passkeys.active_count) },
          { champ: 'Passkeys révoqués', valeur: formatNumber(passkeys.revoked_count) },
          { champ: 'Dernier usage passkey', valeur: formatDate(passkeys.last_used_at) },
        ],
        emptyText: 'Aucune information d’authentification.',
      });
    } else {
      renderTableSection(rootNode, ui, {
        title: 'Compte & authentification',
        description: 'Cette facette n’appartient pas au périmètre d’un opérateur pays.',
        columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
        rows: [{ champ: 'Visibilité', valeur: 'Réservée au central Komerce' }],
        emptyText: 'Sécurité compte restreinte.',
      });
    }

    renderTableSection(rootNode, ui, {
      title: 'Timeline',
      description: 'Chronologie unifiée produite côté serveur à partir des facettes autorisées.',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'type', label: 'Type' },
        { key: 'titre', label: 'Événement' },
        { key: 'detail', label: 'Détail' },
      ],
      rows: (payload.timeline || []).map(row => ({
        date: formatDate(row.occurred_at),
        type: row.type,
        titre: row.title,
        detail: row.detail,
      })),
      emptyText: 'Aucun événement visible.',
    });
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  async function mount(options) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const phone = options.phone || phoneFromPath(options.pathname || '');

    if (!rootNode) throw new Error('canonical_client_360_root_missing');
    if (!ui || !ui.UIState || !ui.DataTable || !ui.Section || !ui.MetricStrip || !ui.AlertPanel) {
      throw new Error('canonical_client_360_primitives_missing');
    }
    if (!phone) throw new Error('canonical_client_360_phone_missing');

    ui.UIState.render(rootNode, 'loading', 'Chargement du client…');
    try {
      const endpoint = ENDPOINT_PREFIX + encodeURIComponent(phone);
      const payload = await jsonRequest(fetchFn, endpoint);
      renderPayload(rootNode, ui, doc, payload);
      return Object.freeze({ payload, endpoint, phone });
    } catch (error) {
      ui.UIState.render(rootNode, 'error', error.message);
      throw error;
    }
  }

  return Object.freeze({
    ENDPOINT_PREFIX,
    phoneFromPath,
    formatNumber,
    formatKmf,
    formatDate,
    marketLabel,
    metricItems,
    renderPayload,
    jsonRequest,
    mount,
  });
});
