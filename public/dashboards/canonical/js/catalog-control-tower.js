/**
 * @komerce-arch
 * @role          canonical-catalog-control-tower-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        catalog_workspace_projection, live_source_flow_projection
 * @outputs       mock_parity_catalog_control_tower_dom
 * @depends       public/dashboards/canonical/js/catalog-workspace.js
 * @used-by       canonical admin catalog workspace
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      catalog_observes_sourcing_authority, source_toggle_remains_sourcing_owned, control_tower_hides_complexity_not_authority
 * @impact-areas  admin-dashboard, catalog, sourcing, boutique
 * @version       2026-09-mock-parity
 */
'use strict';

(function initCatalogControlTower(root, factory) {
  const base = root && root.KomerceCanonicalCatalogWorkspace;
  const api = factory(root, base);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCatalogWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogControlTower(root, baseModule) {
  const ENDPOINT = baseModule?.ENDPOINT || '/api/admin/workspaces/catalog';
  const SOURCING_ENDPOINT = baseModule?.SOURCING_ENDPOINT || '/api/admin/workspaces/sourcing';
  const CRON_HINT_MINUTES = 5;

  function node(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  }

  function button(doc, className, value) {
    const el = node(doc, 'button', className, value);
    el.type = 'button';
    return el;
  }

  function link(doc, className, value, href) {
    const el = node(doc, 'a', className, value);
    el.href = href;
    return el;
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number(value));
  }

  function formatRelativeTime(value) {
    if (!value) return 'Jamais';
    const at = new Date(value).getTime();
    if (!Number.isFinite(at)) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (seconds < 60) return `il y a ${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return new Date(value).toLocaleString('fr-FR');
  }

  function nextPassLabel(source) {
    if (!source?.autopilot_enabled) return '—';
    const last = source.last_capture_at ? new Date(source.last_capture_at).getTime() : NaN;
    if (!Number.isFinite(last)) return `dans < ${CRON_HINT_MINUTES} min`;
    const next = last + (CRON_HINT_MINUTES * 60 * 1000);
    const seconds = Math.max(0, Math.ceil((next - Date.now()) / 1000));
    if (seconds < 60) return 'dans < 1 min';
    return `dans ${Math.max(1, Math.ceil(seconds / 60))} min`;
  }

  function parseStats(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
  }

  function safeText(value, fallback = '—') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function stageLabel(stage) {
    return ({
      captured: 'Capturé',
      normalized: 'Normalisé',
      qualified: 'Qualifié',
      fr_ready: 'FR prêt',
      curation: 'Curation',
      catalog: 'Catalogue',
      boutique: 'Boutique',
    })[stage] || safeText(stage);
  }

  function metricItems(summary = {}, curation = {}) {
    return [
      { key: 'published', label: 'Sélection publiée', value: formatNumber(curation.published_products ?? summary.active_products) },
      { key: 'cap', label: 'Cap catalogue', value: formatNumber(curation.catalog_cap_mvp) },
      { key: 'approval', label: 'À curater', value: formatNumber(summary.approval_pending) },
      { key: 'review', label: 'À relire', value: formatNumber(summary.needs_review) },
      { key: 'categories', label: 'Catégories actives', value: formatNumber(summary.categories) },
    ];
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

  function setFeedback(context, message, tone = 'neutral') {
    context.feedback = message || '';
    context.feedbackTone = tone;
    const target = context.root.querySelector?.('[data-ctl-feedback]');
    if (target) {
      target.className = `kmc-ctl-feedback is-${tone}`;
      target.textContent = context.feedback;
    }
  }

  function sourceKey(source = {}) {
    return String(source.adapter_type || source.supplier_name || source.label || '').toLowerCase();
  }

  function brandFor(value) {
    const key = String(value || '').toLowerCase();
    if (key.includes('aliexpress')) return { key: 'aliexpress', short: 'A', label: 'AliExpress' };
    if (key === 'cj' || key.includes('cjdropshipping') || key.includes('cj dropshipping')) return { key: 'cj', short: 'CJ', label: 'CJ Dropshipping' };
    if (key.includes('allegro')) return { key: 'allegro', short: 'a', label: 'Allegro' };
    if (key.includes('amazon')) return { key: 'amazon', short: 'a', label: 'Amazon' };
    if (key.includes('alibaba')) return { key: 'alibaba', short: 'e', label: 'Alibaba' };
    if (key.includes('noon')) return { key: 'noon', short: 'N', label: 'Noon' };
    if (key.includes('shopify')) return { key: 'shopify', short: 'S', label: 'Shopify' };
    if (key.includes('csv') || key.includes('manual') || key.includes('manuel')) return { key: 'manual', short: '▤', label: 'CSV / Fichier manuel' };
    if (key.includes('api')) return { key: 'api', short: '</>', label: 'API personnalisée' };
    return { key: 'generic', short: '•', label: safeText(value, 'Source') };
  }

  function brandIcon(doc, value, size = 'normal') {
    const brand = brandFor(value);
    const icon = node(doc, 'span', `kmc-ctl-brand is-${brand.key} is-${size}`, brand.short);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function statusDot(doc, ok, label) {
    const row = node(doc, 'span', `kmc-ctl-status ${ok ? 'is-ready' : 'is-blocked'}`);
    row.appendChild(node(doc, 'span', 'kmc-ctl-status-dot'));
    row.appendChild(node(doc, 'span', '', label));
    return row;
  }

  function panel(doc, title, description, id) {
    const section = node(doc, 'section', 'kmc-ctl-panel');
    if (id) section.id = id;
    const head = node(doc, 'div', 'kmc-ctl-panel-head');
    const copy = node(doc, 'div');
    copy.appendChild(node(doc, 'h2', 'kmc-ctl-panel-title', title));
    if (description) copy.appendChild(node(doc, 'p', 'kmc-ctl-panel-copy', description));
    head.appendChild(copy);
    section.appendChild(head);
    const body = node(doc, 'div', 'kmc-ctl-panel-body');
    section.appendChild(body);
    return { section, head, body };
  }

  function sidebarLink(doc, symbol, label, href, active = false) {
    const item = link(doc, `kmc-ctl-side-link${active ? ' is-active' : ''}`, '', href);
    item.appendChild(node(doc, 'span', 'kmc-ctl-side-icon', symbol));
    item.appendChild(node(doc, 'span', '', label));
    return item;
  }

  function renderSidebar(doc, payload) {
    const sidebar = node(doc, 'aside', 'kmc-ctl-sidebar');
    const logo = node(doc, 'a', 'kmc-ctl-logo');
    logo.href = '/admin/pilotage';
    logo.appendChild(node(doc, 'span', 'kmc-ctl-logo-mark', 'K'));
    logo.appendChild(node(doc, 'span', 'kmc-ctl-logo-word', 'Komerce'));
    sidebar.appendChild(logo);

    const nav = node(doc, 'nav', 'kmc-ctl-side-nav');
    nav.appendChild(sidebarLink(doc, '⌂', 'Dashboard', '/admin/pilotage'));
    nav.appendChild(sidebarLink(doc, '▣', 'Catalogue', '/admin/workspaces/catalog', true));
    nav.appendChild(sidebarLink(doc, '⌕', 'Sourcing', '/admin/workspaces/sourcing'));
    nav.appendChild(sidebarLink(doc, '♻', 'Raffinerie', '/admin/workspaces/catalog#catalog-refinery'));
    nav.appendChild(sidebarLink(doc, '◇', 'Produits', '/admin/workspaces/catalog?view=advanced'));
    nav.appendChild(sidebarLink(doc, '▤', 'Boutique', '/admin/workspaces/catalog#catalog-boutique'));
    nav.appendChild(sidebarLink(doc, '▥', 'Analyse', '/admin/workspaces/catalog#catalog-summary'));
    nav.appendChild(sidebarLink(doc, '⚙', 'Paramètres', '/admin/settings'));
    sidebar.appendChild(nav);

    const foot = node(doc, 'div', 'kmc-ctl-side-foot');
    foot.appendChild(statusDot(doc, true, 'Système opérationnel'));
    const latest = (payload.live?.sources || [])
      .map(row => row.last_capture_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    foot.appendChild(node(doc, 'span', 'kmc-ctl-side-foot-copy', `Dernière mise à jour\n${formatRelativeTime(latest || new Date().toISOString())}`));
    sidebar.appendChild(foot);
    return sidebar;
  }

  function renderTopbar(doc, context) {
    const topbar = node(doc, 'div', 'kmc-ctl-topbar');
    const search = node(doc, 'label', 'kmc-ctl-search');
    search.appendChild(node(doc, 'span', 'kmc-ctl-search-icon', '⌕'));
    const input = node(doc, 'input', 'kmc-ctl-search-input');
    input.type = 'search';
    input.placeholder = 'Rechercher un produit, une référence, un fournisseur...';
    input.value = context.searchTerm || '';
    input.addEventListener('input', event => {
      context.searchTerm = event.target.value || '';
      filterIncoming(context.root, context.searchTerm);
    });
    search.appendChild(input);
    topbar.appendChild(search);

    const user = node(doc, 'div', 'kmc-ctl-user');
    user.appendChild(node(doc, 'span', 'kmc-ctl-bell', '♧'));
    const initials = safeText(context.user?.name || context.user?.username || 'Admin', 'Admin')
      .split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    user.appendChild(node(doc, 'span', 'kmc-ctl-avatar', initials || 'A'));
    const copy = node(doc, 'span', 'kmc-ctl-user-copy');
    copy.appendChild(node(doc, 'strong', '', safeText(context.user?.name || context.user?.username, 'Admin')));
    copy.appendChild(node(doc, 'small', '', safeText(context.user?.role, 'Administrateur')));
    user.appendChild(copy);
    topbar.appendChild(user);
    return topbar;
  }

  function renderHero(doc, payload, context) {
    const hero = node(doc, 'header', 'kmc-ctl-hero');
    const copy = node(doc, 'div');
    copy.appendChild(node(doc, 'h1', 'kmc-ctl-title', 'Catalogue'));
    copy.appendChild(node(doc, 'p', 'kmc-ctl-route', 'Sources → Raffinerie → Boutique'));
    copy.appendChild(node(doc, 'p', 'kmc-ctl-subtitle', 'Activez vos sources et laissez Komerce peupler automatiquement votre catalogue.'));
    hero.appendChild(copy);

    const actions = node(doc, 'div', 'kmc-ctl-hero-actions');
    const live = node(doc, 'span', 'kmc-ctl-live-pill', '● LIVE');
    actions.appendChild(live);
    const add = button(doc, 'kmc-ctl-primary-button', '＋ Ajouter une source');
    add.addEventListener('click', () => {
      context.drawerOpen = true;
      context.selectedSourceKey ||= sourceOptions(payload)[0]?.key || null;
      renderPayload(context.root, doc, payload, context);
    });
    actions.appendChild(add);
    hero.appendChild(actions);

    const feedback = node(doc, `div`, `kmc-ctl-feedback is-${context.feedbackTone || 'neutral'}`, context.feedback || '');
    feedback.dataset.ctlFeedback = '';
    hero.appendChild(feedback);
    return hero;
  }

  function sourceLastMetrics(source) {
    const stats = parseStats(source.last_capture_stats);
    const pipeline = source.pipeline || {};
    const seen = number(stats.received ?? stats.total ?? stats.accepted ?? pipeline.captured);
    const created = number(stats.created ?? stats.new ?? stats.inserted);
    const updated = number(stats.updated ?? stats.changed ?? stats.accepted);
    const rejected = number(stats.rejected ?? stats.invalid);
    return { seen, created, updated, rejected };
  }

  async function toggleSource(context, source, toggle) {
    const active = Boolean(source.autopilot_enabled);
    toggle.disabled = true;
    try {
      await jsonRequest(context.fetch, `${SOURCING_ENDPOINT}/sources/${encodeURIComponent(source.source_ref)}/${active ? 'deactivate' : 'activate'}`, { method: 'POST' });
      setFeedback(context, `${source.label || source.supplier_name} ${active ? 'désactivée' : 'activée'} pour le peuplement automatique.`, 'positive');
      await context.reload();
    } catch (error) {
      setFeedback(context, error.message, 'critical');
      toggle.disabled = false;
    }
  }

  function renderSourceCard(doc, source, context) {
    const brand = brandFor(source.label || source.supplier_name || source.adapter_type);
    const card = node(doc, `article`, `kmc-ctl-source-card is-${brand.key}`);
    const head = node(doc, 'div', 'kmc-ctl-source-head');
    const identity = node(doc, 'div', 'kmc-ctl-source-identity');
    identity.appendChild(brandIcon(doc, brand.key));
    identity.appendChild(node(doc, 'strong', 'kmc-ctl-source-name', source.label || source.supplier_name || brand.label));
    head.appendChild(identity);

    const active = Boolean(source.autopilot_enabled);
    const toggle = button(doc, `kmc-ctl-switch${active ? ' is-on' : ''}`, '');
    toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${active ? 'Désactiver' : 'Activer'} ${source.label || source.supplier_name}`);
    toggle.appendChild(node(doc, 'span', 'kmc-ctl-switch-knob'));
    const canActivate = source.connector_ready && source.runtime_enabled;
    if (!active && !canActivate) {
      toggle.disabled = true;
      toggle.title = source.connector_reason || 'Connecteur indisponible';
    }
    toggle.addEventListener('click', () => toggleSource(context, source, toggle));
    head.appendChild(toggle);
    card.appendChild(head);

    card.appendChild(statusDot(doc, Boolean(source.connector_ready), source.connector_ready ? 'Prêt' : 'À connecter'));

    const timing = node(doc, 'div', 'kmc-ctl-source-timing');
    const last = node(doc, 'div');
    last.appendChild(node(doc, 'span', '', 'Dernier passage'));
    last.appendChild(node(doc, 'strong', '', formatRelativeTime(source.last_capture_at)));
    timing.appendChild(last);
    const next = node(doc, 'div');
    next.appendChild(node(doc, 'span', '', 'Prochain passage'));
    next.appendChild(node(doc, 'strong', '', nextPassLabel(source)));
    timing.appendChild(next);
    card.appendChild(timing);

    const metrics = sourceLastMetrics(source);
    const stats = node(doc, 'div', 'kmc-ctl-source-stats');
    [
      [metrics.seen, 'vus'],
      [metrics.created, 'nouveaux'],
      [metrics.updated, 'mis à jour'],
      [metrics.rejected, 'rejetés'],
    ].forEach(([value, label]) => {
      const box = node(doc, 'div', 'kmc-ctl-source-stat');
      box.appendChild(node(doc, 'strong', '', formatNumber(value)));
      box.appendChild(node(doc, 'span', '', label));
      stats.appendChild(box);
    });
    card.appendChild(stats);
    return card;
  }

  function renderSourceManualCard(doc, payload) {
    const manual = (payload.live?.source_catalog || []).find(row => ['csv', 'manual'].includes(String(row.kind || row.key).toLowerCase()));
    if (!manual) return null;
    const card = node(doc, 'article', 'kmc-ctl-source-card is-manual is-disabled');
    const head = node(doc, 'div', 'kmc-ctl-source-head');
    const identity = node(doc, 'div', 'kmc-ctl-source-identity');
    identity.appendChild(brandIcon(doc, 'manual'));
    identity.appendChild(node(doc, 'strong', 'kmc-ctl-source-name', 'Source manuelle'));
    head.appendChild(identity);
    const toggle = button(doc, 'kmc-ctl-switch', '');
    toggle.disabled = true;
    toggle.appendChild(node(doc, 'span', 'kmc-ctl-switch-knob'));
    head.appendChild(toggle);
    card.appendChild(head);
    card.appendChild(statusDot(doc, false, 'Désactivée'));
    const timing = node(doc, 'div', 'kmc-ctl-source-timing');
    ['Dernier passage', 'Prochain passage'].forEach(label => {
      const cell = node(doc, 'div');
      cell.appendChild(node(doc, 'span', '', label));
      cell.appendChild(node(doc, 'strong', '', '—'));
      timing.appendChild(cell);
    });
    card.appendChild(timing);
    const stats = node(doc, 'div', 'kmc-ctl-source-stats');
    ['vus', 'nouveaux', 'mis à jour', 'rejetés'].forEach(label => {
      const box = node(doc, 'div', 'kmc-ctl-source-stat');
      box.appendChild(node(doc, 'strong', '', '0'));
      box.appendChild(node(doc, 'span', '', label));
      stats.appendChild(box);
    });
    card.appendChild(stats);
    return card;
  }

  function renderSources(doc, payload, context) {
    const { section, body } = panel(doc, 'Sources catalogue', 'Activez les sources pour alimenter automatiquement le catalogue.', 'catalog-sources');
    const cards = node(doc, 'div', 'kmc-ctl-source-grid');
    (payload.live?.sources || []).forEach(source => cards.appendChild(renderSourceCard(doc, source, context)));
    const manual = renderSourceManualCard(doc, payload);
    if (manual) cards.appendChild(manual);
    body.appendChild(cards);
    return section;
  }

  const STAGES = Object.freeze([
    ['captured', 'CAPTURÉ', '▣', 'blue'],
    ['normalized', 'NORMALISÉ', '⌑', 'violet'],
    ['qualified', 'QUALIFIÉ', '♙', 'green'],
    ['fr_ready', 'FR PRÊT', '▤', 'yellow'],
    ['curation', 'CURATION', '♨', 'orange'],
    ['catalog', 'CATALOGUE', '▣', 'indigo'],
    ['boutique', 'BOUTIQUE', '▤', 'pink'],
  ]);

  function renderPipelineBox(doc, key, label, icon, tone, value) {
    const box = node(doc, 'div', `kmc-ctl-pipe-box is-${tone}`);
    box.appendChild(node(doc, 'span', 'kmc-ctl-pipe-icon', icon));
    box.appendChild(node(doc, 'span', 'kmc-ctl-pipe-label', label));
    box.appendChild(node(doc, 'strong', 'kmc-ctl-pipe-value', formatNumber(value)));
    box.appendChild(node(doc, 'small', '', 'produits'));
    return box;
  }

  function pipelineCell(doc, value, tone) {
    const td = node(doc, 'td');
    td.appendChild(node(doc, 'span', `kmc-ctl-count-pill is-${tone}`, formatNumber(value)));
    return td;
  }

  function renderRefinery(doc, payload) {
    const live = payload.live || {};
    const pipeline = live.pipeline || {};
    const { section, body } = panel(doc, 'La raffinerie en temps réel', 'Du brut fournisseur au produit prêt pour le catalogue.', 'catalog-refinery');
    section.classList.add('is-refinery');

    const flow = node(doc, 'div', 'kmc-ctl-pipeline');
    STAGES.forEach(([key, label, icon, tone], index) => {
      flow.appendChild(renderPipelineBox(doc, key, label, icon, tone, pipeline[key]));
      if (index < STAGES.length - 1) flow.appendChild(node(doc, 'span', 'kmc-ctl-pipe-arrow', '→'));
    });
    body.appendChild(flow);

    const wrap = node(doc, 'div', 'kmc-ctl-mini-table-wrap');
    const table = node(doc, 'table', 'kmc-ctl-mini-table');
    const thead = node(doc, 'thead');
    const hr = node(doc, 'tr');
    ['Source', 'Capturés', 'Normalisés', 'Qualifiés', 'FR prêts', 'Curation', 'Catalogue', 'Boutique'].forEach(label => hr.appendChild(node(doc, 'th', '', label)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = node(doc, 'tbody');
    (live.sources || []).forEach(source => {
      const row = source.pipeline || {};
      const tr = node(doc, 'tr');
      const sourceCell = node(doc, 'td', 'kmc-ctl-source-table-name');
      sourceCell.appendChild(brandIcon(doc, source.label || source.supplier_name, 'tiny'));
      sourceCell.appendChild(node(doc, 'span', '', source.supplier_name || source.label));
      tr.appendChild(sourceCell);
      tr.appendChild(pipelineCell(doc, row.captured, 'green'));
      tr.appendChild(pipelineCell(doc, row.normalized, 'blue'));
      tr.appendChild(pipelineCell(doc, row.qualified, 'teal'));
      tr.appendChild(pipelineCell(doc, row.fr_ready, 'yellow'));
      tr.appendChild(pipelineCell(doc, row.curation, 'orange'));
      tr.appendChild(pipelineCell(doc, row.catalog, 'indigo'));
      tr.appendChild(pipelineCell(doc, row.boutique, 'pink'));
      tbody.appendChild(tr);
    });
    const total = node(doc, 'tr', 'is-total');
    total.appendChild(node(doc, 'td', '', 'Total'));
    total.appendChild(pipelineCell(doc, pipeline.captured, 'green'));
    total.appendChild(pipelineCell(doc, pipeline.normalized, 'blue'));
    total.appendChild(pipelineCell(doc, pipeline.qualified, 'teal'));
    total.appendChild(pipelineCell(doc, pipeline.fr_ready, 'yellow'));
    total.appendChild(pipelineCell(doc, pipeline.curation, 'orange'));
    total.appendChild(pipelineCell(doc, pipeline.catalog, 'indigo'));
    total.appendChild(pipelineCell(doc, pipeline.boutique, 'pink'));
    tbody.appendChild(total);
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    return section;
  }

  function money(row) {
    if (row.purchase_price_kmf != null) return `${formatNumber(row.purchase_price_kmf)} KMF`;
    if (row.purchase_price == null) return '—';
    return `${Number(row.purchase_price).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${row.currency || ''}`.trim();
  }

  function incomingSearchText(row) {
    return [row.product_name, row.product_ref, row.candidate_ref, row.supplier_name, row.supplier_product_id]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function renderIncoming(doc, payload) {
    const { section, head, body } = panel(doc, 'En train d’arriver', 'Suivez les produits qui passent dans la raffinerie.', 'catalog-incoming');
    const live = node(doc, 'span', 'kmc-ctl-inline-live', '● LIVE');
    head.querySelector('.kmc-ctl-panel-title')?.appendChild(live);
    const rows = payload.live?.incoming || [];
    if (!rows.length) {
      body.appendChild(node(doc, 'div', 'kmc-ctl-empty', 'Aucun produit en circulation.'));
      return section;
    }

    const wrap = node(doc, 'div', 'kmc-ctl-incoming-wrap');
    const table = node(doc, 'table', 'kmc-ctl-incoming-table');
    const thead = node(doc, 'thead');
    const hr = node(doc, 'tr');
    ['Produit', 'Source', 'Fournisseur', 'Prix achat', 'Stock', 'État', 'Prochaine étape', 'Actions'].forEach(label => hr.appendChild(node(doc, 'th', '', label)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = node(doc, 'tbody');
    rows.slice(0, 8).forEach(row => {
      const tr = node(doc, 'tr');
      tr.dataset.search = incomingSearchText(row);
      const product = node(doc, 'td');
      const productWrap = node(doc, 'div', 'kmc-ctl-product-cell');
      const media = node(doc, 'span', 'kmc-ctl-product-thumb');
      if (row.image_url) {
        const img = node(doc, 'img');
        img.src = row.image_url;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        media.appendChild(img);
      } else {
        media.textContent = '◇';
      }
      productWrap.appendChild(media);
      const productCopy = node(doc, 'span', 'kmc-ctl-product-copy');
      productCopy.appendChild(node(doc, 'strong', '', safeText(row.product_name)));
      productCopy.appendChild(node(doc, 'small', '', row.product_ref || row.candidate_ref || row.supplier_product_id || '—'));
      productWrap.appendChild(productCopy);
      product.appendChild(productWrap);
      tr.appendChild(product);

      const source = node(doc, 'td');
      const sourceChip = node(doc, 'span', 'kmc-ctl-source-chip');
      sourceChip.appendChild(brandIcon(doc, row.supplier_name, 'tiny'));
      sourceChip.appendChild(node(doc, 'span', '', safeText(row.supplier_name)));
      source.appendChild(sourceChip);
      tr.appendChild(source);
      tr.appendChild(node(doc, 'td', 'kmc-ctl-muted', safeText(row.supplier_product_id)));
      tr.appendChild(node(doc, 'td', 'kmc-ctl-money', money(row)));

      const stock = node(doc, 'td');
      const stockNumber = row.stock_available == null ? null : number(row.stock_available);
      stock.appendChild(node(doc, 'span', `kmc-ctl-stock${stockNumber != null && stockNumber <= 5 ? ' is-low' : ''}`, stockNumber == null ? '—' : `En stock\n(${formatNumber(stockNumber)})`));
      tr.appendChild(stock);

      const state = node(doc, 'td');
      state.appendChild(node(doc, `span`, `kmc-ctl-stage-chip is-${row.stage || 'captured'}`, stageLabel(row.stage)));
      tr.appendChild(state);
      const next = node(doc, 'td');
      next.appendChild(node(doc, 'span', 'kmc-ctl-next-chip', safeText(row.next_step)));
      tr.appendChild(next);
      const action = node(doc, 'td');
      if (row.product_ref) action.appendChild(link(doc, 'kmc-ctl-row-button', 'Voir', `/admin/products/${encodeURIComponent(row.product_ref)}`));
      else action.appendChild(node(doc, 'span', 'kmc-ctl-row-button is-disabled', 'Voir'));
      action.appendChild(node(doc, 'span', 'kmc-ctl-more', '⋮'));
      tr.appendChild(action);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    return section;
  }

  function renderCatalogBoutique(doc, payload) {
    const pipeline = payload.live?.pipeline || {};
    const { section, body } = panel(doc, 'Catalogue & Boutique', 'Le catalogue global est alimenté en continu. La boutique est mise à jour selon la stratégie de prix et d’exposition.', 'catalog-boutique');
    const cards = node(doc, 'div', 'kmc-ctl-bottom-cards');
    [
      ['green', '▣', 'Catalogue global', pipeline.catalog, 'Disponibles dans le catalogue Komerce', '/admin/workspaces/catalog?view=advanced', 'Voir le catalogue →'],
      ['violet', '▤', 'Bientôt en boutique', Math.max(0, number(pipeline.catalog) - number(pipeline.boutique)), 'Attendent exposition marché et prix local', '/admin/workspaces/catalog#catalog-summary', 'Voir le planning →'],
      ['pink', '▤', 'En boutique', pipeline.boutique, 'Déjà visibles sur votre boutique', '/', 'Voir la boutique →'],
    ].forEach(([tone, icon, title, value, helper, href, cta]) => {
      const card = node(doc, 'article', `kmc-ctl-bottom-card is-${tone}`);
      card.appendChild(node(doc, 'span', 'kmc-ctl-bottom-icon', icon));
      const copy = node(doc, 'div');
      copy.appendChild(node(doc, 'strong', '', title));
      copy.appendChild(node(doc, 'span', 'kmc-ctl-bottom-value', `${formatNumber(value)} produits`));
      copy.appendChild(node(doc, 'small', '', helper));
      copy.appendChild(link(doc, 'kmc-ctl-bottom-link', cta, href));
      card.appendChild(copy);
      cards.appendChild(card);
    });
    body.appendChild(cards);
    return section;
  }

  function donutBackground(pipeline) {
    const values = [
      number(pipeline.catalog),
      number(pipeline.curation),
      Math.max(0, number(pipeline.fr_ready) - number(pipeline.catalog)),
      Math.max(0, number(pipeline.qualified) - number(pipeline.fr_ready)),
    ];
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const p1 = values[0] / total * 100;
    const p2 = p1 + values[1] / total * 100;
    const p3 = p2 + values[2] / total * 100;
    return `conic-gradient(#5b7cff 0 ${p1}%, #fb923c ${p1}% ${p2}%, #a3b55b ${p2}% ${p3}%, #db3f8d ${p3}% 100%)`;
  }

  function summaryLegendRow(doc, tone, label, value) {
    const row = node(doc, 'div', 'kmc-ctl-summary-row');
    row.appendChild(node(doc, 'span', `kmc-ctl-summary-dot is-${tone}`));
    row.appendChild(node(doc, 'span', '', label));
    row.appendChild(node(doc, 'strong', '', formatNumber(value)));
    return row;
  }

  function renderSummary(doc, payload) {
    const pipeline = payload.live?.pipeline || {};
    const { section, body } = panel(doc, 'En résumé', 'Flux global du catalogue', 'catalog-summary');
    section.classList.add('kmc-ctl-aside-panel');
    const donut = node(doc, 'div', 'kmc-ctl-donut');
    donut.style.background = donutBackground(pipeline);
    const hole = node(doc, 'div', 'kmc-ctl-donut-hole');
    hole.appendChild(node(doc, 'strong', '', formatNumber(pipeline.boutique)));
    hole.appendChild(node(doc, 'span', '', 'produits\nen boutique'));
    donut.appendChild(hole);
    body.appendChild(donut);

    const legend = node(doc, 'div', 'kmc-ctl-summary-legend');
    legend.appendChild(summaryLegendRow(doc, 'blue', 'Catalogue global', pipeline.catalog));
    legend.appendChild(summaryLegendRow(doc, 'orange', 'En curation', pipeline.curation));
    legend.appendChild(summaryLegendRow(doc, 'green', 'En attente FR', Math.max(0, number(pipeline.fr_ready) - number(pipeline.catalog))));
    legend.appendChild(summaryLegendRow(doc, 'pink', 'En qualif. / rejet', Math.max(0, number(pipeline.qualified) - number(pipeline.fr_ready))));
    body.appendChild(legend);

    const note = node(doc, 'div', 'kmc-ctl-summary-note');
    note.appendChild(node(doc, 'span', 'kmc-ctl-summary-note-icon', 'ϟ'));
    note.appendChild(node(doc, 'span', '', 'Le catalogue s’enrichit automatiquement en continu selon les sources activées.'));
    body.appendChild(note);
    return section;
  }

  function eventTime(source) {
    if (!source.autopilot_enabled) return null;
    const last = source.last_capture_at ? new Date(source.last_capture_at).getTime() : Date.now();
    return new Date(last + CRON_HINT_MINUTES * 60 * 1000);
  }

  function renderEvents(doc, payload) {
    const { section, body } = panel(doc, 'Prochains événements', '', 'catalog-events');
    section.classList.add('kmc-ctl-aside-panel');
    const list = node(doc, 'div', 'kmc-ctl-event-list');
    const active = (payload.live?.sources || []).filter(source => source.autopilot_enabled).slice(0, 4);
    if (!active.length) {
      const empty = node(doc, 'div', 'kmc-ctl-event-empty');
      empty.appendChild(node(doc, 'span', 'kmc-ctl-event-dot is-muted'));
      empty.appendChild(node(doc, 'span', '', 'Aucune source activée. Les prochains passages apparaîtront ici.'));
      list.appendChild(empty);
    } else {
      active.sort((a, b) => eventTime(a) - eventTime(b)).forEach((source, index) => {
        const event = node(doc, 'div', 'kmc-ctl-event');
        event.appendChild(node(doc, 'span', `kmc-ctl-event-dot is-${['blue', 'violet', 'orange'][index % 3]}`));
        const copy = node(doc, 'div');
        const when = eventTime(source);
        const diff = Math.max(0, Math.ceil((when - Date.now()) / 60000));
        copy.appendChild(node(doc, 'small', '', `Dans ${Math.max(1, diff)} min`));
        copy.appendChild(node(doc, 'strong', '', `${source.label || source.supplier_name} — prochain passage`));
        event.appendChild(copy);
        list.appendChild(event);
      });
    }
    body.appendChild(list);
    body.appendChild(link(doc, 'kmc-ctl-events-link', 'Voir tout l’historique →', '/admin/workspaces/sourcing'));
    return section;
  }

  function plannedSourceCatalog(payload) {
    const actual = payload.live?.source_catalog || [];
    const find = (...needles) => actual.find(row => needles.some(needle => `${row.key} ${row.label} ${row.kind}`.toLowerCase().includes(needle)));
    const planned = [
      { key: 'amazon', label: 'Amazon', subtitle: 'Marketplace', kind: 'api' },
      { key: 'alibaba', label: 'Alibaba', subtitle: 'Global trade', kind: 'api' },
      { key: 'noon', label: 'Noon', subtitle: 'Moyen-Orient', kind: 'api', actual: find('noon') },
      { key: 'shopify', label: 'Shopify', subtitle: 'Vendor Feed', kind: 'api' },
      { key: 'csv', label: 'CSV / Fichier manuel', subtitle: 'Fichier ou URL', kind: 'csv', actual: find('csv', 'manuel', 'manual') },
      { key: 'api', label: 'API personnalisée', subtitle: 'Connecteur sur-mesure', kind: 'api' },
    ];
    return planned.map(option => ({
      ...option,
      ...(option.actual || {}),
      key: option.key,
      label: option.label,
      subtitle: option.subtitle,
      planned: !option.actual,
      connector_ready: Boolean(option.actual?.connector_ready),
      automation_available: Boolean(option.actual?.automation_available),
      reason: option.actual?.reason || (option.actual ? null : 'Connecteur à raccorder'),
    }));
  }

  function sourceOptions(payload) {
    return plannedSourceCatalog(payload);
  }

  function renderSourceOption(doc, option, selected, context, payload) {
    const card = button(doc, `kmc-ctl-source-option${selected ? ' is-selected' : ''}`, '');
    card.appendChild(brandIcon(doc, option.key, 'large'));
    card.appendChild(node(doc, 'strong', '', option.label));
    card.appendChild(node(doc, 'small', '', option.subtitle));
    if (selected) card.appendChild(node(doc, 'span', 'kmc-ctl-source-option-check', '✓'));
    card.addEventListener('click', () => {
      context.selectedSourceKey = option.key;
      renderPayload(context.root, doc, payload, context);
    });
    return card;
  }

  function requirement(doc, icon, label, state, tone) {
    const item = node(doc, `div`, `kmc-ctl-requirement is-${tone}`);
    item.appendChild(node(doc, 'span', 'kmc-ctl-requirement-icon', icon));
    const copy = node(doc, 'span');
    copy.appendChild(node(doc, 'strong', '', label));
    copy.appendChild(node(doc, 'small', '', state));
    item.appendChild(copy);
    return item;
  }

  function requirementsFor(option) {
    if (option.key === 'csv') return [
      ['▤', 'Fichier / URL', option.connector_ready ? 'Prêt' : 'Requis', option.connector_ready ? 'green' : 'pink'],
      ['⇄', 'Mapping attributs', 'Requis', 'blue'],
      ['T', 'Traduction FR', 'Automatique', 'violet'],
      ['◷', 'Fréquence de sync', 'À configurer', 'slate'],
    ];
    return [
      ['⌘', 'API Key', option.connector_ready ? 'Configurée' : 'Requise', option.connector_ready ? 'green' : 'pink'],
      ['▣', 'OAuth 2.0', option.key === 'noon' ? 'Requis' : 'Selon fournisseur', 'violet'],
      ['↗', 'Webhook', 'Optionnel', 'blue'],
      ['♻', 'Sandbox', option.key === 'noon' ? 'Recommandé' : 'Selon fournisseur', 'green'],
      ['⇄', 'Mapping attributs', 'Requis', 'blue'],
      ['T', 'Traduction source', 'Automatique', 'violet'],
      ['▤', 'Stock & prix', 'Requis', 'orange'],
      ['◷', 'Fréquence de sync', 'À configurer', 'slate'],
    ];
  }

  function findSourceForOption(payload, option) {
    return (payload.live?.sources || []).find(source => {
      const key = sourceKey(source);
      return key === option.key || key.includes(option.key) || String(source.supplier_name || '').toLowerCase().includes(option.key);
    }) || null;
  }

  function checklistRow(doc, done, label, value) {
    const row = node(doc, 'div', 'kmc-ctl-check-row');
    row.appendChild(node(doc, `span`, `kmc-ctl-check-icon${done ? ' is-done' : ''}`, done ? '✓' : '○'));
    row.appendChild(node(doc, 'span', '', label));
    row.appendChild(node(doc, `span`, `kmc-ctl-check-value${done ? ' is-done' : ''}`, value));
    return row;
  }

  function renderDrawer(doc, payload, context) {
    const shell = node(doc, `div`, `kmc-ctl-drawer-shell${context.drawerOpen ? ' is-open' : ''}`);
    shell.setAttribute('aria-hidden', context.drawerOpen ? 'false' : 'true');
    const scrim = node(doc, 'div', 'kmc-ctl-drawer-scrim');
    scrim.addEventListener('click', () => {
      context.drawerOpen = false;
      renderPayload(context.root, doc, payload, context);
    });
    shell.appendChild(scrim);

    const drawer = node(doc, 'aside', 'kmc-ctl-drawer');
    const head = node(doc, 'div', 'kmc-ctl-drawer-head');
    const copy = node(doc, 'div');
    copy.appendChild(node(doc, 'h2', '', 'Ajouter une source'));
    copy.appendChild(node(doc, 'p', '', 'Connectez une nouvelle source à votre catalogue'));
    head.appendChild(copy);
    const close = button(doc, 'kmc-ctl-drawer-close', '×');
    close.addEventListener('click', () => {
      context.drawerOpen = false;
      renderPayload(context.root, doc, payload, context);
    });
    head.appendChild(close);
    drawer.appendChild(head);

    const options = sourceOptions(payload);
    const selected = options.find(row => row.key === context.selectedSourceKey) || options[0];
    if (selected && !context.selectedSourceKey) context.selectedSourceKey = selected.key;

    const step1 = node(doc, 'section', 'kmc-ctl-drawer-step');
    const title1 = node(doc, 'div', 'kmc-ctl-step-title');
    title1.appendChild(node(doc, 'span', 'kmc-ctl-step-number', '1'));
    const t1copy = node(doc, 'div');
    t1copy.appendChild(node(doc, 'h3', '', 'Choisir une source'));
    t1copy.appendChild(node(doc, 'p', '', 'Sélectionnez le type de source que vous souhaitez connecter.'));
    title1.appendChild(t1copy);
    step1.appendChild(title1);
    const grid = node(doc, 'div', 'kmc-ctl-source-options');
    options.forEach(option => grid.appendChild(renderSourceOption(doc, option, option.key === selected?.key, context, payload)));
    step1.appendChild(grid);
    drawer.appendChild(step1);

    if (selected) {
      const step2 = node(doc, 'section', 'kmc-ctl-drawer-step');
      const title2 = node(doc, 'div', 'kmc-ctl-step-title');
      title2.appendChild(node(doc, 'span', 'kmc-ctl-step-number', '2'));
      const t2copy = node(doc, 'div');
      t2copy.appendChild(node(doc, 'h3', '', 'Connectivité requise'));
      t2copy.appendChild(node(doc, 'p', '', `Voici les éléments nécessaires pour connecter ${selected.label}.`));
      title2.appendChild(t2copy);
      step2.appendChild(title2);

      const selectedCard = node(doc, 'div', 'kmc-ctl-selected-source');
      selectedCard.appendChild(brandIcon(doc, selected.key, 'large'));
      const sourceCopy = node(doc, 'div');
      sourceCopy.appendChild(node(doc, 'strong', '', selected.label));
      sourceCopy.appendChild(node(doc, 'span', '', selected.subtitle));
      sourceCopy.appendChild(node(doc, 'small', '', selected.reason || (selected.connector_ready ? 'Connecteur prêt.' : 'Connexion à préparer.')));
      selectedCard.appendChild(sourceCopy);
      selectedCard.appendChild(link(doc, 'kmc-ctl-doc-link', 'Voir la documentation →', '/admin/workspaces/sourcing'));
      step2.appendChild(selectedCard);

      const reqGrid = node(doc, 'div', 'kmc-ctl-requirement-grid');
      requirementsFor(selected).forEach(args => reqGrid.appendChild(requirement(doc, ...args)));
      step2.appendChild(reqGrid);
      drawer.appendChild(step2);

      const source = findSourceForOption(payload, selected);
      const step3 = node(doc, 'section', 'kmc-ctl-drawer-step');
      const title3 = node(doc, 'div', 'kmc-ctl-step-title');
      title3.appendChild(node(doc, 'span', 'kmc-ctl-step-number', '3'));
      const t3copy = node(doc, 'div');
      t3copy.appendChild(node(doc, 'h3', '', 'Checklist de configuration'));
      t3copy.appendChild(node(doc, 'p', '', 'Suivez les étapes pour une connexion réussie.'));
      title3.appendChild(t3copy);
      step3.appendChild(title3);
      const checklist = node(doc, 'div', 'kmc-ctl-checklist');
      checklist.appendChild(checklistRow(doc, selected.connector_ready, 'Authentification (API Key / OAuth)', selected.connector_ready ? 'Configurée' : 'À configurer'));
      checklist.appendChild(checklistRow(doc, Boolean(source), 'Catalogue produit', source ? 'Disponible' : 'À configurer'));
      checklist.appendChild(checklistRow(doc, Boolean(source?.pipeline?.captured), 'Stock / prix', source?.pipeline?.captured ? 'Observés' : 'À configurer'));
      checklist.appendChild(checklistRow(doc, Boolean(source?.pipeline?.captured), 'Images', source?.pipeline?.captured ? 'Observées' : 'À configurer'));
      checklist.appendChild(checklistRow(doc, Boolean(source), 'Identité fournisseur', source ? 'Disponible' : 'À configurer'));
      checklist.appendChild(checklistRow(doc, true, 'Traduction FR', 'Automatique'));
      checklist.appendChild(checklistRow(doc, Boolean(selected.automation_available), 'Préflight / commandabilité', selected.automation_available ? 'Contrat connu' : 'À configurer'));
      step3.appendChild(checklist);
      drawer.appendChild(step3);

      const actions = node(doc, 'div', 'kmc-ctl-drawer-actions');
      const branch = button(doc, 'kmc-ctl-drawer-primary', source?.autopilot_enabled ? 'Source déjà branchée' : '⌁ Brancher la source');
      branch.disabled = !source || !selected.connector_ready || !selected.automation_available || source.autopilot_enabled;
      if (!branch.disabled) {
        branch.addEventListener('click', async () => {
          context.drawerOpen = false;
          try {
            await jsonRequest(context.fetch, `${SOURCING_ENDPOINT}/sources/${encodeURIComponent(source.source_ref)}/activate`, { method: 'POST' });
            setFeedback(context, `${selected.label} branchée. La Raffinerie démarre automatiquement.`, 'positive');
            await context.reload();
          } catch (error) {
            context.drawerOpen = true;
            setFeedback(context, error.message, 'critical');
            await context.reload();
          }
        });
      }
      actions.appendChild(branch);
      const draft = button(doc, 'kmc-ctl-drawer-secondary', '▣ Enregistrer comme brouillon');
      draft.addEventListener('click', () => {
        try { root?.localStorage?.setItem('komerce.catalog.source-draft', selected.key); } catch (_) {}
        context.drawerOpen = false;
        setFeedback(context, `Brouillon ${selected.label} conservé localement.`, 'neutral');
        renderPayload(context.root, doc, payload, context);
      });
      actions.appendChild(draft);
      if (!source || !selected.connector_ready || !selected.automation_available) {
        actions.appendChild(link(doc, 'kmc-ctl-drawer-config-link', 'Configurer dans Sourcing avancé →', '/admin/workspaces/sourcing'));
      }
      drawer.appendChild(actions);
    }

    shell.appendChild(drawer);
    return shell;
  }

  function filterIncoming(rootNode, term) {
    const needle = String(term || '').trim().toLowerCase();
    rootNode.querySelectorAll?.('.kmc-ctl-incoming-table tbody tr').forEach(row => {
      row.hidden = Boolean(needle) && !String(row.dataset.search || '').includes(needle);
    });
  }

  function renderPayload(rootNode, doc, payload, context) {
    context.payload = payload;
    rootNode.className = 'kmc-catalog-control-tower';
    rootNode.replaceChildren();
    if (doc.body?.classList) doc.body.classList.add('kmc-catalog-live-mode');

    rootNode.appendChild(renderSidebar(doc, payload));

    const stage = node(doc, 'div', 'kmc-ctl-stage');
    stage.appendChild(renderTopbar(doc, context));
    const content = node(doc, 'div', 'kmc-ctl-content');
    content.appendChild(renderHero(doc, payload, context));

    const grid = node(doc, 'div', 'kmc-ctl-layout');
    const main = node(doc, 'main', 'kmc-ctl-main');
    main.appendChild(renderSources(doc, payload, context));
    main.appendChild(renderRefinery(doc, payload));
    main.appendChild(renderIncoming(doc, payload));
    main.appendChild(renderCatalogBoutique(doc, payload));
    grid.appendChild(main);

    const aside = node(doc, 'aside', 'kmc-ctl-aside');
    aside.appendChild(renderSummary(doc, payload));
    aside.appendChild(renderEvents(doc, payload));
    grid.appendChild(aside);
    content.appendChild(grid);
    stage.appendChild(content);
    rootNode.appendChild(stage);
    rootNode.appendChild(renderDrawer(doc, payload, context));
    filterIncoming(rootNode, context.searchTerm);
  }

  function advancedRequested() {
    try {
      return new URLSearchParams(root?.location?.search || '').get('view') === 'advanced';
    } catch (_) {
      return false;
    }
  }

  async function mount(options = {}) {
    if (advancedRequested() && baseModule?.mount) {
      options.document?.body?.classList?.remove('kmc-catalog-live-mode');
      return baseModule.mount(options);
    }

    const rootNode = options.root;
    const doc = options.document;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || typeof fetchFn !== 'function') {
      throw new Error('canonical_catalog_control_tower_dependencies_missing');
    }

    const context = {
      root: rootNode,
      document: doc,
      fetch: fetchFn,
      user: options.user || {},
      reload: null,
      liveTimer: null,
      searchTerm: '',
      drawerOpen: false,
      selectedSourceKey: null,
      feedback: '',
      feedbackTone: 'neutral',
      payload: null,
    };

    context.reload = async () => {
      try {
        const payload = await jsonRequest(fetchFn, ENDPOINT);
        renderPayload(rootNode, doc, payload, context);
        return payload;
      } catch (error) {
        rootNode.className = 'kmc-catalog-control-tower';
        rootNode.replaceChildren();
        const fail = node(doc, 'section', 'kmc-ctl-failure');
        fail.appendChild(node(doc, 'h1', '', 'Catalogue indisponible'));
        fail.appendChild(node(doc, 'p', '', error.message));
        fail.appendChild(link(doc, 'kmc-ctl-primary-button', 'Retour au Dashboard', '/admin/pilotage'));
        rootNode.appendChild(fail);
        throw error;
      }
    };

    const initial = await context.reload();
    const refreshSeconds = Math.max(5, Math.min(number(initial?.live?.refresh_hint_seconds) || 10, 60));
    context.liveTimer = setInterval(() => {
      if (!doc.contains?.(rootNode)) {
        clearInterval(context.liveTimer);
        return;
      }
      context.reload().catch(() => {});
    }, refreshSeconds * 1000);
    return initial;
  }

  return Object.freeze({
    ENDPOINT,
    SOURCING_ENDPOINT,
    metricItems,
    stageLabel,
    mount,
    _base: baseModule,
  });
});
