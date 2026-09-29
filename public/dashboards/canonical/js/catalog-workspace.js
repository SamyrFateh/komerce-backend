/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_central_admin, commercial_catalog_projection
 * @outputs       canonical_catalog_workspace_dom, authorized_catalog_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_catalog_not_market_scoped, commercial_catalog_is_union_of_approved_products_from_closed_kirs, product_360_explains, sourcing_keeps_source_mutation_authority
 * @impact-areas  admin-dashboard, catalog, sourcing, boutique
 * @version       2026-09
 */

'use strict';

(function initCatalogWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCatalogWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogWorkspace() {
  const ENDPOINT = '/api/admin/workspaces/catalog';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function confidence(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n * 100)} %` : '—';
  }

  function formatSource(value) {
    const labels = {
      connector_raw: 'Source fournisseur',
      ai_enriched: 'Assisté IA',
      manual: 'Préparation humaine',
    };
    return labels[value] || value || '—';
  }

  function formatRelativeTime(value) {
    if (!value) return 'Jamais';
    const at = new Date(value).getTime();
    if (!Number.isFinite(at)) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return `il y a ${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return new Date(value).toLocaleString('fr-FR');
  }

  function stageLabel(stage) {
    const labels = {
      captured: 'Capturé',
      normalized: 'Normalisé',
      qualified: 'Qualifié',
      fr_ready: 'FR prêt',
      curation: 'Curation',
      catalog: 'Catalogue',
      boutique: 'Boutique',
    };
    return labels[stage] || stage || '—';
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
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
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function makeButton(doc, label, action, secondary = false) {
    const button = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function createHeader(doc) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · CATALOGUE'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Catalogue global'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Assortiment commercial approuvé · uniquement les produits issus de KIR clos et réellement mis en vente'));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const commerce = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Commerce');
    commerce.href = '/admin/commerce';
    nav.appendChild(commerce);
    const cockpit = text(doc, 'a', 'kmc-workspace-nav-link', 'Cockpit des imports');
    cockpit.href = '/admin/import-runtime';
    nav.appendChild(cockpit);
    const sourcing = text(doc, 'a', 'kmc-workspace-nav-link', 'Sourcing');
    sourcing.href = '/admin/workspaces/sourcing';
    nav.appendChild(sourcing);
    header.appendChild(nav);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function createSection(rootNode, ui, title, description) {
    const section = ui.Section.create({ title, description });
    rootNode.appendChild(section.element);
    return section.slot;
  }

  function metricItems(summary = {}, curation = {}) {
    return [
      { key: 'published', label: 'Approuvés vente', value: formatNumber(summary.commercial_approved ?? curation.published_products), tone: 'neutral' },
      { key: 'lots', label: 'KIR clos contributeurs', value: formatNumber(summary.commercial_closed_lots), tone: 'neutral' },
      { key: 'approval', label: 'À curater', value: formatNumber(summary.approval_pending), tone: summary.approval_pending ? 'warning' : 'neutral' },
      { key: 'review', label: 'À relire', value: formatNumber(summary.needs_review), tone: summary.needs_review ? 'warning' : 'neutral' },
      { key: 'markets', label: 'Marchés servis', value: formatNumber(summary.commercial_markets), tone: 'neutral' },
    ];
  }

  async function runAction(context, button, options) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, options.runningMessage || 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, options.url, { method: 'POST', body: options.body || {} });
      setFeedback(context.root, options.successMessage || 'Action appliquée.', 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function td(doc, value) {
    const cell = doc.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function sourcingDecisionLabel(value) {
    return ({
      PRIORITY: 'Prioritaire',
      TEST: 'À tester',
      WATCH: 'À surveiller',
      AVOID: 'À éviter',
      LOSS: 'Perte',
      UNKNOWN: 'Non évalué',
    })[String(value || 'UNKNOWN').toUpperCase()] || String(value || 'Non évalué');
  }

  function sourcingDecisionTone(value) {
    return ({
      PRIORITY: 'is-positive',
      TEST: 'is-positive',
      WATCH: 'is-warning',
      AVOID: 'is-critical',
      LOSS: 'is-critical',
      UNKNOWN: 'is-neutral',
    })[String(value || 'UNKNOWN').toUpperCase()] || 'is-neutral';
  }

  function renderApproval(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'File de curation', 'Le scanner sourcing priorise la revue ; seule une décision humaine ajoute, corrige ou écarte un produit.');
    const rows = payload.approval || [];
    const breakdown = payload.approval_breakdown || {};
    const strategy = payload.approval_strategy || {};
    const page = payload.approval_page || {
      total: rows.length,
      limit: context.approvalLimit,
      offset: context.approvalOffset,
      has_previous: context.approvalOffset > 0,
      has_next: false,
    };
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun candidat en attente de curation.'));
      return;
    }
    const summary = doc.createElement('div');
    summary.className = 'kmc-workspace-section-actions';
    ['PRIORITY', 'TEST', 'WATCH', 'AVOID', 'LOSS', 'UNKNOWN'].forEach(key => {
      const count = Number(breakdown[key]) || 0;
      if (!count && key !== 'UNKNOWN') return;
      summary.appendChild(text(doc, 'span', `kmc-workspace-feedback ${sourcingDecisionTone(key)}`, `${sourcingDecisionLabel(key)} · ${formatNumber(count)}`));
    });
    slot.appendChild(summary);
    if (strategy.value_density_used === false) {
      slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Classement indicatif : signal sourcing + confiance + stock. Densité de valeur non utilisée tant qu’elle n’est pas calibrée.'));
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Catégorie</th><th>Réf. KMF</th><th>Signal sourcing</th><th>Pourquoi</th><th>Provenance</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.category));
      tr.appendChild(td(doc, formatKmf(row.price_kmf)));

      const signalCell = doc.createElement('td');
      signalCell.appendChild(text(doc, 'strong', sourcingDecisionTone(row.sourcing_decision), sourcingDecisionLabel(row.sourcing_decision)));
      const signalMeta = [
        row.sourcing_confidence ? `confiance ${row.sourcing_confidence}` : null,
        row.economic_health_status ? `santé ${row.economic_health_status}` : null,
        row.supplier_stock == null ? null : `stock fournisseur ${formatNumber(row.supplier_stock)}`,
      ].filter(Boolean).join(' · ');
      if (signalMeta) signalCell.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', signalMeta));
      tr.appendChild(signalCell);

      const reasonCell = doc.createElement('td');
      reasonCell.appendChild(text(doc, 'span', '', row.sourcing_reason || 'Aucune raison sourcing persistée.'));
      tr.appendChild(reasonCell);

      tr.appendChild(td(doc, `${formatSource(row.content_source)}${row.supplier_name ? ` · ${row.supplier_name}` : ''}`));
      const actions = doc.createElement('td');

      const approve = makeButton(doc, 'Ajouter à la sélection', 'approve');
      approve.addEventListener('click', () => {
        if (!context.confirm(`Ajouter ${row.product_ref} · ${row.name} à la sélection publiée ?`)) return;
        runAction(context, approve, {
          url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/approve`,
          successMessage: `${row.product_ref} ajouté à la sélection publiée.`,
        });
      });
      actions.appendChild(approve);

      const correct = makeButton(doc, 'Corriger + ajouter', 'override', true);
      correct.addEventListener('click', () => {
        const name = context.prompt('Nom corrigé', row.name || '');
        if (name == null) return;
        const category = context.prompt('Catégorie corrigée', row.category || '');
        if (category == null) return;
        const reason = context.prompt('Raison de la correction', '') || undefined;
        const fields = {};
        if (name.trim() !== String(row.name || '').trim()) fields.name = name.trim();
        if (category.trim() !== String(row.category || '').trim()) fields.category = category.trim();
        if (!Object.keys(fields).length) {
          setFeedback(context.root, 'Aucun champ modifié.', 'critical');
          return;
        }
        runAction(context, correct, {
          url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/override`,
          body: { fields, reason },
          successMessage: `${row.product_ref} corrigé puis ajouté à la sélection.`,
        });
      });
      actions.appendChild(correct);

      const reject = makeButton(doc, 'Écarter', 'reject', true);
      reject.addEventListener('click', () => {
        const reason = context.prompt(`Raison pour écarter ${row.product_ref}`);
        if (!reason || !reason.trim()) return;
        runAction(context, reject, {
          url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/reject`,
          body: { reason: reason.trim() },
          successMessage: `${row.product_ref} écarté de la sélection.`,
        });
      });
      actions.appendChild(reject);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);

    const pager = doc.createElement('div');
    pager.className = 'kmc-workspace-section-actions';
    const start = page.total ? page.offset + 1 : 0;
    const end = Math.min(page.offset + rows.length, page.total);
    pager.appendChild(text(doc, 'span', 'kmc-workspace-subtitle', `${start}–${end} sur ${formatNumber(page.total)} candidat(s)`));

    if (page.has_previous) {
      const previous = makeButton(doc, '← Précédents', 'approval-previous', true);
      previous.addEventListener('click', async () => {
        context.approvalOffset = Math.max(0, page.offset - page.limit);
        await context.reload();
      });
      pager.appendChild(previous);
    }

    if (page.has_next) {
      const next = makeButton(doc, 'Suivants →', 'approval-next', true);
      next.addEventListener('click', async () => {
        context.approvalOffset = page.offset + page.limit;
        await context.reload();
      });
      pager.appendChild(next);
    }
    slot.appendChild(pager);
  }

  function renderProducts(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Catalogue global commercial',
      'Somme des produits approuvés pour la vente issus de KIR clos. Les brouillons, produits en préparation et imports ouverts restent hors de cette vue.'
    );
    const rows = payload.products || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit commercial issu d’un KIR clos pour le moment.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Catégorie</th><th>KIR clos</th><th>Marchés approuvés</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.subcategory ? `${row.category} · ${row.subcategory}` : row.category));
      tr.appendChild(td(doc, (row.source_lots || []).join(', ') || '—'));
      tr.appendChild(td(doc, (row.approved_markets || []).join(', ') || '—'));
      tr.appendChild(td(doc, row.needs_review ? 'À relire' : 'Approuvé vente'));
      const actions = doc.createElement('td');

      const detail = text(doc, 'a', 'kmc-workspace-nav-link', 'Product 360');
      detail.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      actions.appendChild(detail);

      const deactivate = makeButton(doc, 'Sortir du catalogue', 'deactivate-product', true);
      deactivate.addEventListener('click', () => {
        if (!context.confirm(`Sortir ${row.product_ref} du Catalogue global ?`)) return;
        runAction(context, deactivate, {
          url: `${ENDPOINT}/products/${encodeURIComponent(row.product_ref)}/deactivate`,
          successMessage: `${row.product_ref} retiré du Catalogue global.`,
        });
      });
      actions.appendChild(deactivate);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderTaxonomy(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Taxonomie boutique', 'Catégories et sous-catégories restent globales et pilotées en base ; aucun Market ID ne duplique la taxonomie.');
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const create = makeButton(doc, 'Nouvelle catégorie', 'create-category');
    bar.appendChild(create);
    slot.appendChild(bar);
    create.addEventListener('click', () => {
      const key = context.prompt('Clé catégorie stable');
      if (!key) return;
      const label = context.prompt('Label affiché', key);
      if (!label) return;
      runAction(context, create, {
        url: `${ENDPOINT}/categories`,
        body: { key: key.trim(), label: label.trim() },
        successMessage: `Catégorie ${key} créée.`,
      });
    });

    const rows = payload.categories || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune catégorie.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Clé</th><th>Catégorie</th><th>Sous-catégories</th><th>Rail</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.key));
      tr.appendChild(td(doc, row.label));
      tr.appendChild(td(doc, (row.subcategories || []).filter(sub => sub.is_active).map(sub => sub.label).join(', ')));
      tr.appendChild(td(doc, row.show_in_rail ? 'Oui' : 'Non'));
      tr.appendChild(td(doc, row.is_active ? 'Active' : 'Inactive'));
      const actions = doc.createElement('td');

      const edit = makeButton(doc, 'Renommer', 'update-category', true);
      edit.addEventListener('click', () => {
        const label = context.prompt(`Label · ${row.key}`, row.label || row.key);
        if (!label) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/update`,
          body: { label: label.trim() },
          successMessage: `${row.key} mise à jour.`,
        });
      });
      actions.appendChild(edit);

      const sub = makeButton(doc, 'Ajouter sous-catégorie', 'create-subcategory', true);
      sub.addEventListener('click', () => {
        const subKey = context.prompt(`Clé sous-catégorie · ${row.key}`);
        if (!subKey) return;
        const label = context.prompt('Label affiché', subKey);
        if (!label) return;
        runAction(context, sub, {
          url: `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/subcategories`,
          body: { key: subKey.trim(), label: label.trim() },
          successMessage: `${row.key}/${subKey} créée.`,
        });
      });
      actions.appendChild(sub);

      const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', 'toggle-category', true);
      toggle.addEventListener('click', () => {
        if (!context.confirm(`${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.key} ?`)) return;
        runAction(context, toggle, {
          url: row.is_active
            ? `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/deactivate`
            : `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/update`,
          body: row.is_active ? {} : { is_active: true },
          successMessage: `${row.key} mise à jour.`,
        });
      });
      actions.appendChild(toggle);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary, payload.curation) });
    renderApproval(rootNode, ui, doc, payload, context);
    renderProducts(rootNode, ui, doc, payload, context);
    renderTaxonomy(rootNode, ui, doc, payload, context);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_catalog_workspace_dependencies_missing');
    }
    const context = {
      root: rootNode,
      user: options.user || {},
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      reload: null,
      approvalLimit: 50,
      approvalOffset: 0,
    };
    context.reload = async () => {
      try {
        const params = new URLSearchParams({
          approval_limit: String(context.approvalLimit),
          approval_offset: String(context.approvalOffset),
        });
        const payload = await jsonRequest(fetchFn, `${ENDPOINT}?${params.toString()}`);
        renderPayload(rootNode, ui, doc, payload, context);
        return payload;
      } catch (error) {
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · CATALOGUE'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Accès Catalogue indisponible'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', error.message));
        rootNode.appendChild(panel);
        throw error;
      }
    };
    return context.reload();
  }

  return Object.freeze({ ENDPOINT, metricItems, stageLabel, mount });
});