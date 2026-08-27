/**
 * @komerce-arch
 * @role          canonical-action-center-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_action_center_operator, canonical_action_center_projection
 * @outputs       canonical_action_center_dom, authorized_signal_lifecycle_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      action_center_handles_derived_signals_only, global_until_signal_market_authority_exists, browser_signal_ref_only, canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard, decision-signals
 * @version       2026-08
 */

'use strict';

(function initActionCenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalActionCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createActionCenter() {
  const ENDPOINT = '/api/admin/action-center';

  const FAMILY_LABELS = Object.freeze({
    ops: 'Opérations',
    eco: 'Économie',
    sourcing: 'Sourcing',
    disputes: 'Incidents & litiges',
    other: 'Autres signaux',
  });

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
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

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-action-center-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function header(doc) {
    const node = doc.createElement('header');
    node.className = 'kmc-workspace-header';

    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'ACTION CENTER · CANONICAL'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Décider sur les signaux, pas sur des écrans'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Surface centrale · signaux dérivés · acquitter, reporter ou résoudre sans modifier la donnée métier source'));
    node.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const pilotage = text(doc, 'a', 'kmc-workspace-nav-link', 'Pilotage →');
    pilotage.href = '/admin/pilotage';
    nav.appendChild(pilotage);
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', 'Opérations →');
    operations.href = '/admin/operations';
    nav.appendChild(operations);
    node.appendChild(nav);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.dataset.actionCenterFeedback = '';
    feedback.setAttribute('role', 'status');
    node.appendChild(feedback);
    return node;
  }

  function metricItems(summary = {}) {
    return [
      { key: 'urgent', label: 'Urgent / critique', value: Number(summary.urgent || 0), tone: summary.urgent ? 'critical' : 'neutral' },
      { key: 'warning', label: 'Avertissements', value: Number(summary.warning || 0), tone: summary.warning ? 'warning' : 'neutral' },
      { key: 'info', label: 'Informations', value: Number(summary.info || 0), tone: 'neutral' },
      { key: 'total', label: 'Signaux actifs', value: Number(summary.total_active || 0), tone: 'neutral' },
    ];
  }

  function actionButton(doc, label, action, signalRef, secondary = true) {
    const button = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    button.type = 'button';
    button.dataset.actionCenterAction = action;
    button.dataset.signalRef = signalRef;
    return button;
  }

  function severityLabel(severity) {
    return ({ urgent: 'Urgent', critical: 'Critique', warning: 'Attention', info: 'Info' })[severity] || severity || '—';
  }

  function renderSignal(doc, row) {
    const card = doc.createElement('article');
    card.className = 'kmc-workspace-detail';
    card.dataset.signalRef = row.signal_ref;

    const titleLine = doc.createElement('div');
    titleLine.className = 'kmc-workspace-detail-title';
    titleLine.appendChild(text(doc, 'strong', '', row.title));
    titleLine.appendChild(text(doc, 'span', 'kmc-workspace-note', `${severityLabel(row.severity)} · ${row.signal_ref}`));
    card.appendChild(titleLine);

    if (row.summary) card.appendChild(text(doc, 'p', 'kmc-workspace-note', row.summary));
    if (row.recommendation) card.appendChild(text(doc, 'p', 'kmc-workspace-note', `Recommandation · ${row.recommendation}`));

    const context = doc.createElement('div');
    context.className = 'kmc-workspace-nav';
    context.appendChild(text(doc, 'span', 'kmc-workspace-note', `Type · ${row.signal_type} · propriétaire · ${row.owner_role || '—'} · statut · ${row.status}`));
    if (row.entity && row.entity.href) {
      const link = text(doc, 'a', 'kmc-workspace-nav-link', `Voir ${row.entity.label || row.entity.ref || row.entity.type}`);
      link.href = row.entity.href;
      context.appendChild(link);
    }
    card.appendChild(context);

    const actions = doc.createElement('div');
    actions.className = 'kmc-workspace-nav';
    const allowed = new Set(row.actions || []);
    if (allowed.has('acknowledge')) actions.appendChild(actionButton(doc, 'Vu', 'acknowledge', row.signal_ref));
    if (allowed.has('snooze')) actions.appendChild(actionButton(doc, 'Reporter 24 h', 'snooze', row.signal_ref));
    if (allowed.has('resolve')) actions.appendChild(actionButton(doc, 'Résolu', 'resolve', row.signal_ref, false));
    card.appendChild(actions);
    return card;
  }

  function renderFamilies(rootNode, ui, doc, payload) {
    const grouped = new Map();
    (payload.signals || []).forEach(signal => {
      const family = signal.family || 'other';
      if (!grouped.has(family)) grouped.set(family, []);
      grouped.get(family).push(signal);
    });

    const order = ['ops', 'eco', 'sourcing', 'disputes', 'other'];
    let rendered = 0;
    order.forEach(family => {
      const rows = grouped.get(family) || [];
      if (!rows.length) return;
      rendered += rows.length;
      const section = ui.Section.create({
        title: `${FAMILY_LABELS[family] || family} · ${rows.length}`,
        description: 'Le Centre d’actions change uniquement le cycle de vie du signal. Le traitement métier se fait dans la surface de drill-down autorisée.',
      });
      rows.forEach(row => section.slot.appendChild(renderSignal(doc, row)));
      rootNode.appendChild(section.element);
    });

    if (!rendered) {
      const section = ui.Section.create({ title: 'Aucun signal actif', description: 'Aucune décision n’est actuellement requise.' });
      section.slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Tout est en ordre pour les signaux actifs.'));
      rootNode.appendChild(section.element);
    }
  }

  async function runAction(context, button, path, body, successMessage) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, path, { method: 'POST', body: body || {} });
      setFeedback(context.root, successMessage, 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function bind(rootNode, context) {
    rootNode.addEventListener('click', async event => {
      const button = event.target.closest('[data-action-center-action]');
      if (!button) return;
      const action = button.dataset.actionCenterAction;
      const signalRef = button.dataset.signalRef;

      if (action === 'generate') {
        await runAction(context, button, `${ENDPOINT}/generate`, {}, 'Signaux régénérés.');
        return;
      }
      if (!signalRef) return;
      if (action === 'acknowledge') {
        await runAction(context, button, `${ENDPOINT}/signals/${encodeURIComponent(signalRef)}/acknowledge`, {}, 'Signal acquitté.');
      }
      if (action === 'snooze') {
        await runAction(context, button, `${ENDPOINT}/signals/${encodeURIComponent(signalRef)}/snooze`, { hours: 24 }, 'Signal reporté de 24 h.');
      }
      if (action === 'resolve') {
        await runAction(context, button, `${ENDPOINT}/signals/${encodeURIComponent(signalRef)}/resolve`, {}, 'Signal résolu.');
      }
    });
  }

  async function mount(options) {
    const context = {
      root: options.root,
      user: options.user,
      document: options.document,
      fetch: options.fetch,
      ui: options.ui,
      reload: null,
    };

    async function load() {
      const payload = await jsonRequest(context.fetch, ENDPOINT);
      const rootNode = context.root;
      rootNode.replaceChildren();
      rootNode.appendChild(header(context.document));
      rootNode.appendChild(context.ui.KpiStrip.create(metricItems(payload.summary)).element);

      const controls = context.ui.Section.create({
        title: 'Actualiser le constat',
        description: payload.scope && payload.scope.market_note ? payload.scope.market_note : 'Les signaux sont calculés côté serveur.',
      });
      const generate = actionButton(context.document, 'Régénérer les signaux', 'generate', '', false);
      controls.slot.appendChild(generate);
      rootNode.appendChild(controls.element);

      renderFamilies(rootNode, context.ui, context.document, payload);
      bind(rootNode, context);
      return payload;
    }

    context.reload = load;
    return load();
  }

  return { ENDPOINT, mount, jsonRequest, metricItems, severityLabel };
});
