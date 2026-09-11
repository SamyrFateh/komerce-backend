/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_central_admin, catalog_workspace_projection
 * @outputs       canonical_catalog_workspace_dom, authorized_catalog_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_catalog_not_market_scoped, product_360_explains, curated_catalog_not_crud
 * @impact-areas  admin-dashboard, catalog
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
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · CATALOGUE CURATÉ'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Curater le catalogue Komerce'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Catalogue maître global · sélection courte · sources traçables · première publication validée humainement'));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const commerce = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Commerce');
    commerce.href = '/admin/commerce';
    nav.appendChild(commerce);
    const sourcing = text(doc, 'a', 'kmc-workspace-nav-link', 'Alimenter via Sourcing');
    sourcing.href = '/admin/sourcing';
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
      { key: 'published', label: 'Sélection publiée', value: formatNumber(curation.published_products ?? summary.active_products), tone: 'neutral' },
      { key: 'cap', label: 'Cap catalogue', value: formatNumber(curation.catalog_cap_mvp), tone: curation.at_cap ? 'warning' : 'neutral' },
      { key: 'approval', label: 'À curater', value: formatNumber(summary.approval_pending), tone: summary.approval_pending ? 'warning' : 'neutral' },
      { key: 'review', label: 'À relire', value: formatNumber(summary.needs_review), tone: summary.needs_review ? 'warning' : 'neutral' },
      { key: 'categories', label: 'Catégories actives', value: formatNumber(summary.categories), tone: 'neutral' },
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

  function renderCurationPolicy(rootNode, ui, doc, payload) {
    const curation = payload.curation || {};
    const slot = createSection(
      rootNode,
      ui,
      'Politique de curation',
      'La raffinerie propose ; le catalogue global sélectionne. Les marchés ne dupliquent jamais la fiche produit et leur pricing reste hors de ce Workspace.'
    );
    const published = formatNumber(curation.published_products);
    const cap = formatNumber(curation.catalog_cap_mvp);
    const remaining = formatNumber(curation.remaining_slots);
    const fill = formatNumber(curation.fill_pct);
    const message = curation.at_cap
      ? `Cap atteint : ${published}/${cap} produits publiés. Toute nouvelle entrée doit remplacer une référence sortie de la sélection.`
      : `${published}/${cap} produits publiés · ${remaining} places restantes · ${fill} % du cap utilisé.`;
    const tone = curation.at_cap ? 'is-critical' : 'is-positive';
    slot.appendChild(text(doc, 'div', `kmc-workspace-feedback ${tone}`, message));
    slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Entrée : Sourcing / connecteurs / manuel → préparation FR → validation humaine → sélection publiée. Product 360 reste le drill-down explicatif.'));
  }

  function renderApproval(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'File de curation', 'Aucun candidat ne rejoint la sélection publiée sans décision humaine. La provenance reste visible au moment de décider.');
    const rows = payload.approval || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun candidat en attente de curation.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Catégorie</th><th>Réf. KMF</th><th>Confiance</th><th>Provenance</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.category));
      tr.appendChild(td(doc, formatKmf(row.price_kmf)));
      tr.appendChild(td(doc, confidence(row.enrichment_confidence)));
      tr.appendChild(td(doc, formatSource(row.content_source)));
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
  }

  function renderProducts(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Sélection publiée', 'Le catalogue curaté montre les références retenues. Les prix pays ne se règlent pas ici ; Product 360 explique la fiche et son lignage.');
    const rows = (payload.products || []).filter(row => row.is_active);
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit dans la sélection publiée.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Catégorie</th><th>Provenance</th><th>Réf. KMF</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.subcategory ? `${row.category} · ${row.subcategory}` : row.category));
      tr.appendChild(td(doc, formatSource(row.content_source)));
      tr.appendChild(td(doc, formatKmf(row.price_kmf)));
      tr.appendChild(td(doc, row.needs_review ? 'À relire' : 'Publiée'));
      const actions = doc.createElement('td');

      const detail = text(doc, 'a', 'kmc-workspace-nav-link', 'Product 360');
      detail.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      actions.appendChild(detail);

      const deactivate = makeButton(doc, 'Sortir de la sélection', 'deactivate-product', true);
      deactivate.addEventListener('click', () => {
        if (!context.confirm(`Sortir ${row.product_ref} de la sélection publiée ?`)) return;
        runAction(context, deactivate, {
          url: `${ENDPOINT}/products/${encodeURIComponent(row.product_ref)}/deactivate`,
          successMessage: `${row.product_ref} retiré de la sélection publiée.`,
        });
      });
      actions.appendChild(deactivate);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
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
    renderCurationPolicy(rootNode, ui, doc, payload);
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
    };
    context.reload = async () => {
      try {
        const payload = await jsonRequest(fetchFn, ENDPOINT);
        renderPayload(rootNode, ui, doc, payload, context);
        return payload;
      } catch (error) {
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · CATALOGUE CURATÉ'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Accès Catalogue indisponible'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', error.message));
        rootNode.appendChild(panel);
        throw error;
      }
    };
    return context.reload();
  }

  return Object.freeze({ ENDPOINT, metricItems, mount });
});