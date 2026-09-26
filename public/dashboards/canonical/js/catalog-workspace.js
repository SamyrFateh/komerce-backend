/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_central_admin, catalog_workspace_projection, live_source_flow_projection
 * @outputs       canonical_catalog_workspace_dom, authorized_catalog_action_requests, live_source_controls
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_catalog_not_market_scoped, product_360_explains, curated_catalog_not_crud, sourcing_keeps_source_mutation_authority
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
  const SOURCING_ENDPOINT = '/api/admin/workspaces/sourcing';

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
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Catalogue'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Sources → Raffinerie → Boutique · pilotez le peuplement sans manipuler les imports un par un'));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const commerce = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Commerce');
    commerce.href = '/admin/commerce';
    nav.appendChild(commerce);
    const sourcing = text(doc, 'a', 'kmc-workspace-nav-link', 'Sourcing avancé');
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

  function renderLiveSources(rootNode, ui, doc, payload, context) {
    const live = payload.live || {};
    const sources = live.sources || [];
    const slot = createSection(
      rootNode,
      ui,
      'Sources catalogue · LIVE',
      'ON signifie : la source est aspirée automatiquement et alimente la Raffinerie. La mutation reste gouvernée par Sourcing.'
    );

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const add = makeButton(doc, 'Ajouter une source', 'show-source-catalog', true);
    bar.appendChild(add);
    slot.appendChild(bar);

    const discovery = doc.createElement('div');
    discovery.hidden = true;
    discovery.setAttribute('data-source-discovery', '');
    const discoveryRows = live.source_catalog || [];
    if (discoveryRows.length) {
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table';
      table.innerHTML = '<thead><tr><th>Source</th><th>Type</th><th>Connecteur</th><th>Autopilot</th><th>Besoin</th></tr></thead>';
      const tbody = doc.createElement('tbody');
      discoveryRows.forEach(row => {
        const tr = doc.createElement('tr');
        tr.appendChild(td(doc, row.label));
        tr.appendChild(td(doc, row.kind));
        tr.appendChild(td(doc, row.connector_ready ? 'Prêt' : 'À connecter'));
        tr.appendChild(td(doc, row.automation_available ? 'Disponible' : 'À raccorder'));
        tr.appendChild(td(doc, row.reason || (row.automation_available ? 'Aucun blocage détecté' : 'Contrat de connectivité à définir')));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const wrap = doc.createElement('div');
      wrap.className = 'kmc-workspace-table-wrap';
      wrap.appendChild(table);
      discovery.appendChild(wrap);
    } else {
      discovery.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune source déclarée.'));
    }
    slot.appendChild(discovery);

    add.addEventListener('click', () => {
      discovery.hidden = !discovery.hidden;
      add.textContent = discovery.hidden ? 'Ajouter une source' : 'Masquer les sources';
    });

    if (!sources.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune source récurrente enregistrée.'));
      return;
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Source</th><th>Connectivité</th><th>Autopilot</th><th>Dernier passage</th><th>Capturés</th><th>FR prêts</th><th>Catalogue</th><th>Boutique</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    sources.forEach(source => {
      const tr = doc.createElement('tr');
      const pipeline = source.pipeline || {};
      tr.appendChild(td(doc, source.label || source.supplier_name || source.adapter_type));
      tr.appendChild(td(doc, source.connector_ready ? '● Prêt' : `Bloqué · ${source.connector_reason || 'connecteur indisponible'}`));
      tr.appendChild(td(doc, source.autopilot_enabled ? 'ON' : 'OFF'));
      tr.appendChild(td(doc, formatRelativeTime(source.last_capture_at)));
      tr.appendChild(td(doc, formatNumber(pipeline.captured)));
      tr.appendChild(td(doc, formatNumber(pipeline.fr_ready)));
      tr.appendChild(td(doc, formatNumber(pipeline.catalog)));
      tr.appendChild(td(doc, formatNumber(pipeline.boutique)));

      const actions = doc.createElement('td');
      const active = Boolean(source.autopilot_enabled);
      const toggle = makeButton(doc, active ? 'Désactiver' : 'Activer', 'toggle-source', !active);
      if (!active && (!source.connector_ready || !source.runtime_enabled)) {
        toggle.disabled = true;
        toggle.title = !source.runtime_enabled ? 'Autopilot désactivé sur ce runtime' : (source.connector_reason || 'Connecteur non prêt');
      }
      toggle.addEventListener('click', () => runAction(context, toggle, {
        url: `${SOURCING_ENDPOINT}/sources/${encodeURIComponent(source.source_ref)}/${active ? 'deactivate' : 'activate'}`,
        runningMessage: `${active ? 'Arrêt' : 'Démarrage'} de ${source.label || source.supplier_name}…`,
        successMessage: `${source.label || source.supplier_name} ${active ? 'désactivée' : 'activée'} pour le peuplement automatique.`,
      }));
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

  function renderRefinery(rootNode, ui, doc, payload) {
    const live = payload.live || {};
    const pipeline = live.pipeline || {};
    const slot = createSection(
      rootNode,
      ui,
      'La Raffinerie en temps réel',
      'Les compteurs sont issus des états réellement persistés. Les étapes encore non automatisées restent visibles au lieu d’être simulées.'
    );
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    slot.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: [
      { key: 'captured', label: 'Capturés', value: formatNumber(pipeline.captured), tone: 'neutral' },
      { key: 'normalized', label: 'Normalisés', value: formatNumber(pipeline.normalized), tone: 'neutral' },
      { key: 'qualified', label: 'Qualifiés', value: formatNumber(pipeline.qualified), tone: 'neutral' },
      { key: 'fr', label: 'FR prêts', value: formatNumber(pipeline.fr_ready), tone: 'neutral' },
      { key: 'curation', label: 'Curation', value: formatNumber(pipeline.curation), tone: pipeline.curation ? 'warning' : 'neutral' },
      { key: 'catalog', label: 'Catalogue', value: formatNumber(pipeline.catalog), tone: 'neutral' },
      { key: 'boutique', label: 'Boutique effective', value: formatNumber(pipeline.boutique), tone: 'neutral' },
    ] });

    const sources = live.sources || [];
    if (!sources.length) return;
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Source</th><th>Capturés</th><th>Normalisés</th><th>Qualifiés</th><th>FR prêts</th><th>Curation</th><th>Catalogue</th><th>Boutique</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    sources.forEach(source => {
      const row = source.pipeline || {};
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, source.supplier_name || source.label));
      tr.appendChild(td(doc, formatNumber(row.captured)));
      tr.appendChild(td(doc, formatNumber(row.normalized)));
      tr.appendChild(td(doc, formatNumber(row.qualified)));
      tr.appendChild(td(doc, formatNumber(row.fr_ready)));
      tr.appendChild(td(doc, formatNumber(row.curation)));
      tr.appendChild(td(doc, formatNumber(row.catalog)));
      tr.appendChild(td(doc, formatNumber(row.boutique)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderIncoming(rootNode, ui, doc, payload) {
    const rows = payload.live?.incoming || [];
    const slot = createSection(
      rootNode,
      ui,
      'En train d’arriver · LIVE',
      'Dernières références qui circulent dans la Raffinerie, avec leur vraie prochaine étape.'
    );
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit en circulation.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Produit</th><th>Source</th><th>Prix achat</th><th>Stock</th><th>État</th><th>Prochaine étape</th><th>Mise à jour</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_name));
      tr.appendChild(td(doc, row.supplier_name));
      const purchase = row.purchase_price_kmf != null
        ? formatKmf(row.purchase_price_kmf)
        : (row.purchase_price == null ? '—' : `${row.purchase_price} ${row.currency || ''}`);
      tr.appendChild(td(doc, purchase));
      tr.appendChild(td(doc, row.stock_available == null ? '—' : formatNumber(row.stock_available)));
      tr.appendChild(td(doc, stageLabel(row.stage)));
      tr.appendChild(td(doc, row.next_step));
      tr.appendChild(td(doc, formatRelativeTime(row.updated_at)));
      const actions = doc.createElement('td');
      if (row.product_ref) {
        const detail = text(doc, 'a', 'kmc-workspace-nav-link', 'Voir');
        detail.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
        actions.appendChild(detail);
      } else {
        actions.appendChild(text(doc, 'span', 'kmc-workspace-subtitle', row.candidate_ref || '—'));
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
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
    slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Entrée : sources automatiques / manuel → préparation FR → validation humaine → sélection publiée. Product 360 reste le drill-down explicatif.'));
  }

  function renderApproval(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'File de curation', 'Aucun candidat ne rejoint la sélection publiée sans décision humaine. La provenance reste visible au moment de décider.');
    const rows = payload.approval || [];
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
    renderLiveSources(rootNode, ui, doc, payload, context);
    renderRefinery(rootNode, ui, doc, payload);
    renderIncoming(rootNode, ui, doc, payload);
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
      liveTimer: null,
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
    const initial = await context.reload();
    const refreshSeconds = Math.max(5, Math.min(Number(initial?.live?.refresh_hint_seconds) || 10, 60));
    context.liveTimer = setInterval(() => {
      if (!doc.contains(rootNode)) {
        clearInterval(context.liveTimer);
        return;
      }
      context.reload().catch(() => {});
    }, refreshSeconds * 1000);
    return initial;
  }

  return Object.freeze({ ENDPOINT, SOURCING_ENDPOINT, metricItems, stageLabel, mount });
});