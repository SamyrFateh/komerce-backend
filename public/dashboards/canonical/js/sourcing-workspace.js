/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_sourcing_operator, sourcing_workspace_projection
 * @outputs       canonical_sourcing_workspace_dom, authorized_sourcing_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_sourcing_not_market_scoped, browser_business_refs_only
 * @impact-areas  admin-dashboard, sourcing, catalog
 * @version       2026-08
 */

'use strict';

(function initSourcingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalSourcingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createSourcingWorkspace() {
  const ENDPOINT = '/api/admin/workspaces/sourcing';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function td(doc, value) {
    const cell = doc.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
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
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · SOURCING'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Sourcer et qualifier le catalogue'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Surface centrale · portefeuille sourcing, candidats, imports et fournisseurs · aucun périmètre pays'));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const catalog = text(doc, 'a', 'kmc-workspace-nav-link', 'Catalogue Workspace →');
    catalog.href = '/admin/workspaces/catalog';
    nav.appendChild(catalog);
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

  function metricItems(summary = {}) {
    return [
      { key: 'candidates', label: 'Candidats', value: formatNumber(summary.candidates_total), tone: 'neutral' },
      { key: 'scanned', label: 'Scannés', value: formatNumber(summary.candidates_scanned), tone: summary.candidates_scanned ? 'warning' : 'neutral' },
      { key: 'watchlist', label: 'Watchlist', value: formatNumber(summary.candidates_watchlist), tone: summary.candidates_watchlist ? 'warning' : 'neutral' },
      { key: 'promoted', label: 'Promus catalogue', value: formatNumber(summary.candidates_promoted), tone: 'neutral' },
      { key: 'suppliers', label: 'Fournisseurs sourcing', value: formatNumber(summary.sourcing_suppliers), tone: 'neutral' },
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

  function wrapTable(doc, table) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  function renderCandidates(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Candidats sourcing',
      'Le candidat reste hors catalogue tant qu’il n’est pas explicitement promu. Les décisions et scans restent côté serveur.'
    );
    const rows = payload.candidates || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun candidat sourcing.'));
      return;
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Fournisseur</th><th>Produit</th><th>Prix achat</th><th>État</th><th>Décision</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');

    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.candidate_ref));
      tr.appendChild(td(doc, row.supplier_name));
      tr.appendChild(td(doc, row.product_name));
      tr.appendChild(td(doc, row.purchase_price_kmf == null ? `${row.purchase_price || '—'} ${row.currency || ''}` : formatKmf(row.purchase_price_kmf)));
      tr.appendChild(td(doc, row.state));
      tr.appendChild(td(doc, row.scan_result?.sourcing_decision || row.promotion_status || '—'));

      const actions = doc.createElement('td');
      if (row.product_ref) {
        const product = text(doc, 'a', 'kmc-workspace-nav-link', 'Product 360');
        product.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
        actions.appendChild(product);
      }

      const edit = makeButton(doc, 'Corriger', 'update-candidate', true);
      edit.addEventListener('click', () => {
        const category = context.prompt(`Catégorie Komerce · ${row.candidate_ref}`, row.komerce_category || '');
        if (category == null) return;
        const weight = context.prompt('Poids estimé kg', row.estimated_weight_kg == null ? '' : String(row.estimated_weight_kg));
        if (weight == null) return;
        const purchase = context.prompt(`Prix achat · ${row.currency || 'AED'}`, row.purchase_price == null ? '' : String(row.purchase_price));
        if (purchase == null) return;
        const currency = context.prompt('Devise (AED/EUR/USD/KMF)', row.currency || 'AED');
        if (currency == null) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/candidates/${encodeURIComponent(row.candidate_ref)}/update`,
          body: {
            ...(category.trim() ? { komerce_category: category.trim() } : {}),
            ...(weight.trim() ? { estimated_weight_kg: Number(weight) } : {}),
            ...(purchase.trim() ? { purchase_price: Number(purchase) } : {}),
            currency: currency.trim().toUpperCase(),
          },
          successMessage: `${row.candidate_ref} corrigé.`,
        });
      });
      actions.appendChild(edit);

      const scan = makeButton(doc, 'Scanner', 'scan-candidate', true);
      scan.addEventListener('click', () => runAction(context, scan, {
        url: `${ENDPOINT}/candidates/${encodeURIComponent(row.candidate_ref)}/scan`,
        successMessage: `${row.candidate_ref} re-scanné.`,
      }));
      actions.appendChild(scan);

      if (!['imported_to_catalog', 'rejected'].includes(row.state)) {
        const watch = makeButton(doc, 'Watchlist', 'watchlist-candidate', true);
        watch.addEventListener('click', () => runAction(context, watch, {
          url: `${ENDPOINT}/candidates/${encodeURIComponent(row.candidate_ref)}/watchlist`,
          successMessage: `${row.candidate_ref} placé en watchlist.`,
        }));
        actions.appendChild(watch);

        const promote = makeButton(doc, 'Promouvoir', 'promote-candidate');
        promote.addEventListener('click', () => {
          if (!context.confirm(`Promouvoir ${row.candidate_ref} vers le catalogue en brouillon ?`)) return;
          runAction(context, promote, {
            url: `${ENDPOINT}/candidates/${encodeURIComponent(row.candidate_ref)}/promote`,
            successMessage: `${row.candidate_ref} promu vers le Catalogue.`,
          });
        });
        actions.appendChild(promote);

        const reject = makeButton(doc, 'Rejeter', 'reject-candidate', true);
        reject.addEventListener('click', () => {
          const reason = context.prompt(`Raison du rejet · ${row.candidate_ref}`);
          if (!reason || !reason.trim()) return;
          runAction(context, reject, {
            url: `${ENDPOINT}/candidates/${encodeURIComponent(row.candidate_ref)}/reject`,
            body: { reason: reason.trim() },
            successMessage: `${row.candidate_ref} rejeté.`,
          });
        });
        actions.appendChild(reject);
      }

      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderImports(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Imports fournisseur',
      'CSV et saisie manuelle passent par les connecteurs et l’orchestrateur existants. Le Workspace ne recode pas la raffinerie.'
    );

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const manual = makeButton(doc, 'Import manuel', 'manual-import');
    const csv = makeButton(doc, 'Import CSV', 'csv-import', true);
    bar.appendChild(manual);
    bar.appendChild(csv);
    slot.appendChild(bar);

    manual.addEventListener('click', () => {
      const supplier = context.prompt('Nom fournisseur');
      if (!supplier) return;
      const raw = context.prompt('Produits JSON (tableau)', '[{"supplier_product_id":"REF-1","product_name":"Produit","purchase_price":100,"currency":"AED"}]');
      if (!raw) return;
      let items;
      try { items = JSON.parse(raw); }
      catch (_) { setFeedback(context.root, 'JSON invalide.', 'critical'); return; }
      if (!Array.isArray(items)) { setFeedback(context.root, 'Le JSON doit être un tableau.', 'critical'); return; }
      runAction(context, manual, {
        url: `${ENDPOINT}/imports`,
        body: { supplier_name: supplier.trim(), source_type: 'manual', items },
        successMessage: `Import ${supplier.trim()} terminé.`,
      });
    });

    csv.addEventListener('click', () => {
      const supplier = context.prompt('Nom fournisseur');
      if (!supplier) return;
      const csvText = context.prompt('Contenu CSV');
      if (!csvText) return;
      runAction(context, csv, {
        url: `${ENDPOINT}/imports`,
        body: { supplier_name: supplier.trim(), source_type: 'csv', csv_text: csvText },
        successMessage: `Import CSV ${supplier.trim()} terminé.`,
      });
    });

    const rows = payload.imports || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun import récent.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Batch</th><th>Fournisseur</th><th>Source</th><th>État</th><th>Candidats</th><th>Promus</th><th>Date</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.import_ref));
      tr.appendChild(td(doc, row.supplier_name));
      tr.appendChild(td(doc, row.source_type));
      tr.appendChild(td(doc, row.status || 'COMPLETED'));
      tr.appendChild(td(doc, row.candidates_count ?? row.total_items));
      tr.appendChild(td(doc, row.imported_count));
      tr.appendChild(td(doc, row.imported_at ? new Date(row.imported_at).toLocaleString('fr-FR') : '—'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderPortfolio(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Portefeuille sourcing', 'Les champs opérationnels sourcing du produit sont modifiés via product_ref ; Product 360 reste la vue explicative.');
    const rows = payload.portfolio?.products || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit dans l’analyse sourcing.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Rail</th><th>Coût</th><th>Poids</th><th>Cycle</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.slice(0, 150).forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.sourcing_rail));
      tr.appendChild(td(doc, formatKmf(row.cost_price_kmf)));
      tr.appendChild(td(doc, row.weight_g == null ? '—' : `${formatNumber(row.weight_g)} g`));
      tr.appendChild(td(doc, row.lifecycle_status));
      const actions = doc.createElement('td');
      const detail = text(doc, 'a', 'kmc-workspace-nav-link', 'Product 360');
      detail.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      actions.appendChild(detail);
      const edit = makeButton(doc, 'Modifier sourcing', 'update-sourcing-product', true);
      edit.addEventListener('click', () => {
        const rail = context.prompt('Rail sourcing (A/B/C/D)', row.sourcing_rail || '');
        if (rail == null) return;
        const cost = context.prompt('Coût achat KMF', row.cost_price_kmf == null ? '' : String(row.cost_price_kmf));
        if (cost == null) return;
        const weight = context.prompt('Poids g', row.weight_g == null ? '' : String(row.weight_g));
        if (weight == null) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/products/${encodeURIComponent(row.product_ref)}/update`,
          body: {
            ...(rail.trim() ? { sourcing_rail: rail.trim().toUpperCase() } : {}),
            ...(cost.trim() ? { cost_price_kmf: Number(cost) } : {}),
            ...(weight.trim() ? { weight_g: Number(weight) } : {}),
          },
          successMessage: `${row.product_ref} mis à jour côté sourcing.`,
        });
      });
      actions.appendChild(edit);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderSuppliers(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Fournisseurs sourcing',
      '4E administre uniquement partner_type=sourcing. Transitaires, relais et équipes Hub restent hors de cette autorité.'
    );
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const create = makeButton(doc, 'Nouveau fournisseur', 'create-supplier');
    bar.appendChild(create);
    slot.appendChild(bar);

    create.addEventListener('click', () => {
      const name = context.prompt('Nom fournisseur');
      if (!name) return;
      const country = context.prompt('Code pays', 'AE');
      if (country == null) return;
      const contact = context.prompt('Contact', '');
      runAction(context, create, {
        url: `${ENDPOINT}/suppliers`,
        body: {
          name: name.trim(),
          ...(country.trim() ? { country_code: country.trim().toUpperCase() } : {}),
          ...(contact && contact.trim() ? { contact_name: contact.trim() } : {}),
        },
        successMessage: `${name.trim()} ajouté aux fournisseurs sourcing.`,
      });
    });

    const rows = payload.suppliers || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun fournisseur sourcing.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Fournisseur</th><th>Pays</th><th>Contact</th><th>Délai</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.partner_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.country_code || row.country_label));
      tr.appendChild(td(doc, row.contact_name || row.contact_phone || row.contact_email));
      tr.appendChild(td(doc, row.lead_time_days == null ? '—' : `${row.lead_time_days} j`));
      tr.appendChild(td(doc, row.is_active ? 'Actif' : 'Inactif'));
      const actions = doc.createElement('td');
      const edit = makeButton(doc, 'Modifier', 'update-supplier', true);
      edit.addEventListener('click', () => {
        const name = context.prompt(`Nom · ${row.partner_ref}`, row.name || '');
        if (name == null) return;
        const delay = context.prompt('Délai fournisseur (jours)', row.lead_time_days == null ? '' : String(row.lead_time_days));
        if (delay == null) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/suppliers/${encodeURIComponent(row.partner_ref)}/update`,
          body: {
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(delay.trim() ? { lead_time_days: Number(delay) } : {}),
          },
          successMessage: `${row.partner_ref} mis à jour.`,
        });
      });
      actions.appendChild(edit);
      const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', 'toggle-supplier', true);
      toggle.addEventListener('click', () => {
        if (!context.confirm(`${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.name} ?`)) return;
        runAction(context, toggle, {
          url: `${ENDPOINT}/suppliers/${encodeURIComponent(row.partner_ref)}/${row.is_active ? 'deactivate' : 'activate'}`,
          successMessage: `${row.partner_ref} mis à jour.`,
        });
      });
      actions.appendChild(toggle);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    renderCandidates(rootNode, ui, doc, payload, context);
    renderImports(rootNode, ui, doc, payload, context);
    renderPortfolio(rootNode, ui, doc, payload, context);
    renderSuppliers(rootNode, ui, doc, payload, context);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_sourcing_workspace_dependencies_missing');
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
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · SOURCING'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Accès Sourcing indisponible'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', error.message));
        rootNode.appendChild(panel);
        throw error;
      }
    };
    return context.reload();
  }

  return Object.freeze({ ENDPOINT, metricItems, mount });
});
