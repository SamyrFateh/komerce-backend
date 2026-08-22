/**
 * @komerce-arch
 * @role          canonical-demo-order-flow
 * @domain        admin-dashboard
 * @layer         ui-module
 * @criticality   medium
 * @inputs        canonical_admin_session, real_order_apis
 * @outputs       staging_order_flow_cockpit
 * @depends       none
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard, demo, orders
 * @version       2026-08
 */

'use strict';

(function initDemoOrderFlow(root, factory) {
  const api = factory();
  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en staging. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur. */
  if (root) root.KomerceDemoOrderFlow = api;
})(globalThis, function createDemoOrderFlow() {
  const STATUS_FLOW = Object.freeze([
    'pending', 'confirmed', 'ordered', 'preparation',
    'shipped', 'in_transit', 'available', 'collected',
  ]);

  const STATUS_LABELS = Object.freeze({
    pending: 'En attente',
    confirmed: 'Confirmée',
    ordered: 'Achat validé',
    preparation: 'Préparation hub',
    shipped: 'Expédiée',
    in_transit: 'Arrivée pays',
    available: 'Disponible relais',
    collected: 'Retirée',
    cancelled: 'Annulée',
    refunded: 'Remboursée',
  });

  function nextStatusFor(status) {
    const index = STATUS_FLOW.indexOf(status);
    return index >= 0 && index < STATUS_FLOW.length - 1 ? STATUS_FLOW[index + 1] : null;
  }

  function advanceGuard(order) {
    const nextStatus = nextStatusFor(order && order.status);
    if (!nextStatus) return { allowed: false, nextStatus: null, reason: 'Parcours terminé ou statut hors séquence.' };
    if (order.status === 'pending' && order.payment_status !== 'paid') {
      return { allowed: false, nextStatus, reason: 'Confirmer d’abord le paiement dans le parcours d’achat.' };
    }
    return { allowed: true, nextStatus, reason: null };
  }

  function node(doc, tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  async function jsonRequest(fetchFn, url, options) {
    const response = await fetchFn(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(value));
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} KMF`;
  }

  function mount(options) {
    const doc = options.document;
    const fetchFn = options.fetch;
    const rootNode = options.root;
    const user = options.user || {};
    let selectedId = null;
    let currentTrace = null;

    rootNode.textContent = '';
    rootNode.className = 'demo-flow';

    const header = node(doc, 'header', 'demo-flow__header');
    const heading = node(doc, 'div', 'demo-flow__heading');
    heading.append(
      node(doc, 'p', 'canonical-eyebrow', 'KOMERCE · COCKPIT TEST'),
      node(doc, 'h1', '', 'Démo parcours commande'),
      node(doc, 'p', 'demo-flow__intro', `Session ${user.first_name || user.name || user.email || user.role || 'admin'} · données réelles de staging`)
    );
    header.append(heading, node(doc, 'span', 'demo-flow__env', 'STAGING'));

    const toolbar = node(doc, 'section', 'demo-flow__toolbar');
    const selectLabel = node(doc, 'label', 'demo-flow__field');
    selectLabel.append(node(doc, 'span', '', 'Commande test'));
    const select = node(doc, 'select', 'demo-flow__select');
    select.setAttribute('aria-label', 'Commande test');
    selectLabel.append(select);
    const refreshOrders = node(doc, 'button', 'demo-flow__button demo-flow__button--secondary', 'Rafraîchir les commandes');
    refreshOrders.type = 'button';
    toolbar.append(selectLabel, refreshOrders);

    const statusBox = node(doc, 'div', 'demo-flow__status');
    statusBox.setAttribute('role', 'status');
    const content = node(doc, 'div', 'demo-flow__content');
    rootNode.append(header, toolbar, statusBox, content);

    function setStatus(message, tone) {
      statusBox.textContent = message;
      statusBox.className = `demo-flow__status${tone ? ` is-${tone}` : ''}`;
    }

    function renderEmptyList(container, message) {
      container.append(node(doc, 'p', 'demo-flow__empty', message));
    }

    function renderTrace(trace) {
      currentTrace = trace;
      content.textContent = '';
      const order = trace.order;
      const guard = advanceGuard(order);

      const summary = node(doc, 'section', 'demo-flow__summary');
      const summaryMain = node(doc, 'div', 'demo-flow__summary-main');
      summaryMain.append(
        node(doc, 'p', 'demo-flow__reference', order.reference),
        node(doc, 'h2', '', STATUS_LABELS[order.status] || order.status),
        node(doc, 'p', 'demo-flow__meta', `${order.customer_name || 'Client'} · ${formatMoney(order.total_kmf)} · ${order.market_code || 'Marché non renseigné'}`)
      );
      const actions = node(doc, 'div', 'demo-flow__actions');
      const advance = node(doc, 'button', 'demo-flow__button demo-flow__button--primary', guard.nextStatus ? `Passer à « ${STATUS_LABELS[guard.nextStatus]} »` : 'Parcours terminé');
      advance.type = 'button';
      advance.disabled = !guard.allowed;
      const refreshTrace = node(doc, 'button', 'demo-flow__button demo-flow__button--secondary', 'Actualiser la trace');
      refreshTrace.type = 'button';
      actions.append(advance, refreshTrace);
      if (guard.reason) actions.append(node(doc, 'p', 'demo-flow__hint', guard.reason));
      summary.append(summaryMain, actions);

      const progress = node(doc, 'ol', 'demo-flow__progress');
      const currentIndex = STATUS_FLOW.indexOf(order.status);
      STATUS_FLOW.forEach((status, index) => {
        const item = node(doc, 'li', 'demo-flow__step', STATUS_LABELS[status]);
        if (index < currentIndex) item.classList.add('is-done');
        if (index === currentIndex) item.classList.add('is-current');
        progress.append(item);
      });

      const grids = node(doc, 'div', 'demo-flow__grid');
      const notifications = panel('Notifications client', trace.notifications, item => {
        const row = node(doc, 'article', 'demo-flow__row');
        row.append(node(doc, 'strong', '', item.title), node(doc, 'p', '', item.message));
        row.append(node(doc, 'small', '', `${item.status} · ${formatDate(item.created_at)}`));
        return row;
      }, 'Aucune notification émise pour cette étape.');

      const documentItems = [
        ...trace.invoices.map(item => ({ ...item, kind: 'invoice' })),
        ...trace.documents.map(item => ({ ...item, kind: 'document' })),
      ];
      const documents = panel('Documents générés', documentItems, item => {
        const row = node(doc, 'article', 'demo-flow__row');
        const title = item.kind === 'invoice' ? `Facture ${item.invoice_number}` : `${item.document_type} · ${item.reference}`;
        row.append(node(doc, 'strong', '', title));
        row.append(node(doc, 'small', '', `${item.status || item.payment_status} · ${formatDate(item.issued_at || item.created_at)}`));
        return row;
      }, 'Aucun document généré pour cette commande.');

      const history = panel('Historique des statuts', trace.history, item => {
        const row = node(doc, 'article', 'demo-flow__row demo-flow__row--history');
        row.append(node(doc, 'strong', '', STATUS_LABELS[item.status] || item.status));
        row.append(node(doc, 'small', '', `${formatDate(item.created_at)}${item.changed_by_name ? ` · ${item.changed_by_name}` : ''}`));
        if (item.note) row.append(node(doc, 'p', '', item.note));
        return row;
      }, 'Aucun changement de statut enregistré.');

      function panel(title, items, renderItem, emptyMessage) {
        const section = node(doc, 'section', 'demo-flow__panel');
        section.append(node(doc, 'h3', '', title));
        const list = node(doc, 'div', 'demo-flow__list');
        if (!items.length) renderEmptyList(list, emptyMessage);
        else items.forEach(item => list.append(renderItem(item)));
        section.append(list);
        return section;
      }

      const invoiceActions = node(doc, 'section', 'demo-flow__invoice-actions');
      invoiceActions.append(node(doc, 'h3', '', 'Facture de test'));
      if (order.payment_status === 'paid') {
        const view = node(doc, 'a', 'demo-flow__link', 'Voir / générer la facture');
        view.href = `/api/invoices/${order.id}`;
        view.target = '_blank';
        view.rel = 'noopener';
        const download = node(doc, 'a', 'demo-flow__link', 'Télécharger le PDF');
        download.href = `/api/invoices/${order.id}/download`;
        invoiceActions.append(view, download);
      } else {
        invoiceActions.append(node(doc, 'p', 'demo-flow__empty', 'Disponible après paiement confirmé.'));
      }

      grids.append(notifications, documents, history);
      content.append(summary, progress, invoiceActions, grids);

      refreshTrace.addEventListener('click', () => loadTrace(selectedId));
      advance.addEventListener('click', async () => {
        const check = advanceGuard(currentTrace.order);
        if (!check.allowed) return;
        advance.disabled = true;
        setStatus(`Transition vers « ${STATUS_LABELS[check.nextStatus]} »…`);
        try {
          await jsonRequest(fetchFn, `/api/orders/${selectedId}/status`, {
            method: 'PATCH', credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: check.nextStatus, note: 'Avancement depuis le cockpit Démo / Staging' }),
          });
          await loadTrace(selectedId);
          setStatus(`Statut avancé vers « ${STATUS_LABELS[check.nextStatus]} ».`, 'success');
          if (check.nextStatus === 'collected') setTimeout(() => loadTrace(selectedId), 900);
        } catch (error) {
          setStatus(error.message, 'error');
          advance.disabled = false;
        }
      });
    }

    async function loadTrace(orderId) {
      if (!orderId) return;
      selectedId = orderId;
      setStatus('Chargement de la trace réelle…');
      try {
        const trace = await jsonRequest(fetchFn, `/api/admin/demo/orders/${orderId}/timeline`, {
          method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
        });
        renderTrace(trace);
        setStatus('Trace synchronisée.', 'success');
      } catch (error) {
        content.textContent = '';
        setStatus(error.message, 'error');
      }
    }

    async function loadOrders() {
      refreshOrders.disabled = true;
      setStatus('Chargement des commandes de staging…');
      try {
        const result = await jsonRequest(fetchFn, '/api/admin/orders?limit=30', {
          method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
        });
        select.textContent = '';
        if (!result.orders.length) {
          const option = node(doc, 'option', '', 'Aucune commande disponible');
          option.value = '';
          select.append(option);
          content.textContent = '';
          setStatus('Créez une commande test depuis la boutique.', 'error');
          return;
        }
        result.orders.forEach(order => {
          const option = node(doc, 'option', '', `${order.reference} · ${STATUS_LABELS[order.status] || order.status} · ${order.market_code || '—'}`);
          option.value = order.id;
          select.append(option);
        });
        const nextId = result.orders.some(order => order.id === selectedId) ? selectedId : result.orders[0].id;
        select.value = nextId;
        await loadTrace(nextId);
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        refreshOrders.disabled = false;
      }
    }

    select.addEventListener('change', () => loadTrace(select.value));
    refreshOrders.addEventListener('click', loadOrders);
    loadOrders();

    return Object.freeze({ loadOrders, loadTrace });
  }

  return Object.freeze({ STATUS_FLOW, STATUS_LABELS, nextStatusFor, advanceGuard, jsonRequest, mount });
});
