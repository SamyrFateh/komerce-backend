/**
 * @komerce-arch
 * @role          canonical-import-decision-cockpit
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        /api/admin/workspaces/sourcing/import-cockpit
 * @outputs       decision_first_lot_registry, lot_drill_down_navigation
 * @depends       none
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      situation_then_decision_then_exception_then_drilldown, dashboard_never_recomputes_business_truth, technical_pipeline_hidden_unless_requested, one_card_one_complete_page
 * @impact-areas  admin-dashboard, sourcing, catalog, market-delegation, pricing
 * @version       2026-09-v3-decision-cockpit
 */
'use strict';

(function initCanonicalImportCockpit(global) {
  const POLL_MS = 10000;
  const VIEWS = new Set(['overview', 'catalogue', 'commercial', 'exceptions', 'history', 'registry', 'closure']);
  let timer = null;
  let mountedRoot = null;
  let lastPayload = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit',
    });
  }

  function params() {
    const query = new URLSearchParams(global.location.search);
    const run = query.get('run') || null;
    const requestedView = query.get('view') || 'overview';
    return { run, view: VIEWS.has(requestedView) ? requestedView : 'overview' };
  }

  async function api(path, options = {}) {
    const res = await global.fetch(path, {
      method: options.method || 'GET',
      credentials:'include',
      headers:{
        Accept:'application/json',
        ...(options.body == null ? {} : { 'Content-Type':'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok) {
      const error = new Error(body?.error || `HTTP ${res.status}`);
      error.code = body?.code || null;
      throw error;
    }
    return body;
  }

  function businessLabel(status) {
    return ({
      RUNNING:'Import en cours',
      ACTION_REQUIRED:'Décisions attendues',
      BLOCKED:'À débloquer',
      CLOSED:'Clos',
      ARCHIVED:'Archivé',
      UNKNOWN:'État indisponible',
    })[status] || status || 'État indisponible';
  }

  function businessTone(status) {
    return ({
      RUNNING:'live',
      ACTION_REQUIRED:'warning',
      BLOCKED:'critical',
      CLOSED:'positive',
      ARCHIVED:'neutral',
      UNKNOWN:'neutral',
    })[status] || 'neutral';
  }

  function urlFor(runRef, view = 'overview') {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    if (view && view !== 'overview') q.set('view', view);
    return '/admin/import-runtime' + (q.toString() ? '?' + q.toString() : '');
  }

  function withReturnTo(path, returnTo, label = 'Retour au lot') {
    const separator = String(path || '').includes('?') ? '&' : '?';
    const q = new URLSearchParams();
    q.set('return_to', returnTo);
    q.set('return_label', label);
    return `${path}${separator}${q.toString()}`;
  }

  function sourceControlStrip(sourceControls) {
    const sources = Array.isArray(sourceControls) ? sourceControls : [];
    if (!sources.length) {
      return `<section class="kir-source-control">
        <div class="kir-source-control-title"><span class="kir-section-kicker">SOURCING</span><strong>Aucune source récurrente configurée</strong></div>
        <a href="/admin/workspaces/sourcing" class="kir-subtle-link">Configurer les sources →</a>
      </section>`;
    }

    return `<section class="kir-source-control" aria-label="Contrôle sourcing">
      <div class="kir-source-control-title">
        <span class="kir-section-kicker">SOURCING</span>
        <strong>Alimentation automatique</strong>
        <small>OFF → ON prépare automatiquement la source, certifie un premier import réel puis active l’autopilot.</small>
      </div>
      <div class="kir-source-control-list">
        ${sources.map(source => {
          const enabled = source.autopilot_enabled === true;
          const ready = source.autopilot_ready === true;
          const activationReady = source.activation_ready === true;
          const canToggle = enabled || activationReady;
          const stateTone = enabled && ready
            ? 'on'
            : enabled
              ? 'warning'
              : !activationReady
                ? 'blocked'
                : ready
                  ? 'off'
                  : 'prep';
          const stateLabel = enabled ? 'ON' : 'OFF';
          const last = source.last_capture_at ? fmtDate(source.last_capture_at) : 'Jamais';
          const preparation = Array.isArray(source.preparation_required) ? source.preparation_required : [];
          const readiness = !activationReady
            ? (source.blocker || 'Source non activable')
            : !ready
              ? `Préparation auto · ${preparation.join(' → ') || 'pré-certification'}`
              : enabled
                ? 'Actif'
                : 'Prêt';
          return `<div class="kir-source-pill is-${stateTone}" title="${esc(readiness)}">
            <span class="kir-source-dot" aria-hidden="true"></span>
            <span class="kir-source-name">${esc(source.label || source.supplier_name || source.source_ref)}</span>
            <small class="kir-source-last">${esc(last)}</small>
            <em class="kir-source-readiness">${esc(readiness)}</em>
            <button type="button"
              class="kir-source-switch is-${stateTone}"
              role="switch"
              aria-checked="${enabled ? 'true' : 'false'}"
              aria-label="${enabled ? 'Désactiver' : 'Activer'} le sourcing automatique ${esc(source.label || source.source_ref)}"
              data-source-toggle
              data-source-ref="${esc(source.source_ref)}"
              data-source-enabled="${enabled ? '1' : '0'}"
              ${canToggle ? '' : 'disabled'}>
              <span class="kir-source-switch-knob"></span>
              <strong>${stateLabel}</strong>
            </button>
          </div>`;
        }).join('')}
      </div>
      <a href="/admin/workspaces/sourcing" class="kir-subtle-link">Sources →</a>
    </section>`;
  }

  function lotStrip(lots, selectedRef) {
    const visibleLots = (lots || []).filter(lot => lot.business_status !== 'ARCHIVED' || lot.run_ref === selectedRef);
    const cards = visibleLots.map(lot => {
      const active = lot.run_ref === selectedRef;
      return `<a class="kir-lot-chip ${active ? 'is-selected' : ''}" href="${urlFor(lot.run_ref)}" data-cockpit-nav>
        <span class="kir-lot-ref">${esc(lot.run_ref)}</span>
        <strong class="kir-status is-${businessTone(lot.business_status)}">${esc(businessLabel(lot.business_status))}</strong>
        <small>${esc(lot.provider || 'Source')} · ${num(lot.source_total)} entrée(s)</small>
      </a>`;
    }).join('');
    return `<nav class="kir-lot-strip" aria-label="Lots d'import récents">
      <div class="kir-lot-strip-scroll">${cards || '<span class="kir-empty-inline">Aucun lot importé.</span>'}</div>
      <a class="kir-lot-all" href="${urlFor(selectedRef, 'registry')}" data-cockpit-nav>Tous les lots</a>
    </nav>`;
  }

  function businessJourney(run) {
    const lot = run.business || {};
    const d = lot.decisions || {};
    const closure = lot.closure || {};
    const items = [
      {
        label:'Catalogue',
        value:num(d.catalogue) > 0 ? `${num(d.catalogue)} à valider` : 'Validé',
        tone:num(d.catalogue) > 0 ? 'warning' : 'positive',
        href:urlFor(run.run_ref, 'catalogue'),
      },
      {
        label:'Prêts à vendre',
        value:num(d.commercial) > 0 ? `${num(d.commercial)} à décider` : '0',
        tone:num(d.commercial) > 0 ? 'blue' : 'neutral',
        href:urlFor(run.run_ref, 'commercial'),
      },
      {
        label:'En vente',
        value:String(num(d.approved_for_sale)),
        tone:num(d.approved_for_sale) > 0 ? 'positive' : 'neutral',
        href:withReturnTo('/admin/workspaces/catalog', urlFor(run.run_ref), 'Retour au lot'),
        external:true,
      },
      {
        label:'Non retenus',
        value:String(num(d.not_retained)),
        tone:num(d.not_retained) > 0 ? 'neutral' : 'neutral',
        href:urlFor(run.run_ref, 'closure'),
      },
      {
        label:'Clôture',
        value:closure.eligible ? 'Clos' : `${num(closure.remaining_products)} à décider`,
        tone:closure.eligible ? 'positive' : 'warning',
        href:urlFor(run.run_ref, 'closure'),
      },
    ];
    return `<section class="kir-business-journey" aria-label="Parcours métier du lot">
      <div class="kir-business-journey-head">
        <span class="kir-section-kicker">PARCOURS MÉTIER</span>
        <strong>Du Catalogue à la clôture</strong>
      </div>
      <div class="kir-business-journey-track">
        ${items.map(item => `<a class="kir-business-step is-${item.tone}" href="${item.href}" ${item.external ? '' : 'data-cockpit-nav'}>
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </a>`).join('')}
      </div>
    </section>`;
  }

  function actionCard({ key, count, title, helper, tone, href }) {
    return `<a class="kir-action-card is-${tone}" href="${href}" data-cockpit-nav>
      <div class="kir-action-count">${count}</div>
      <div class="kir-action-copy">
        <strong>${esc(title)}</strong>
        <span>${esc(helper)}</span>
      </div>
      <span class="kir-action-arrow">→</span>
    </a>`;
  }

  function renderOverview(run) {
    const lot = run.business || {};
    const d = lot.decisions || {};
    const cards = [];
    if (num(d.catalogue) > 0) cards.push(actionCard({
      key:'catalogue', count:num(d.catalogue), tone:'warning',
      title:'Validation Catalogue requise',
      helper:'Une action Catalogue est réellement nécessaire avant décision commerciale.',
      href:urlFor(run.run_ref, 'catalogue'),
    }));
    if (num(d.commercial) > 0) cards.push(actionCard({
      key:'commercial', count:num(d.commercial), tone:'blue',
      title:'Décisions de mise en vente',
      helper:'Produits certifiés prêts pour prix / exposition marché.',
      href:urlFor(run.run_ref, 'commercial'),
    }));
    if (num(d.exceptions) > 0) cards.push(actionCard({
      key:'exceptions', count:num(d.exceptions), tone:'critical',
      title:'Exceptions à traiter',
      helper:'Uniquement les écarts qui empêchent le lot d’avancer ou de se clore.',
      href:urlFor(run.run_ref, 'exceptions'),
    }));

    const noAction = lot.business_status === 'CLOSED'
      ? `<section class="kir-closed-panel"><span>✓</span><div><strong>Lot clos</strong><p>Tous les produits transmis ont une décision terminale. Aucun geste opérateur n’est attendu.</p></div></section>`
      : cards.length === 0
        ? '<section class="kir-neutral-panel">Aucune action calculable pour le moment. La vérité aval est en cours de lecture.</section>'
        : '';

    return `
      <section class="kir-decision-intro">
        <div>
          <span class="kir-section-kicker">À FAIRE MAINTENANT</span>
          <h2>${cards.length ? 'Décisions ouvertes' : lot.business_status === 'CLOSED' ? 'Aucune décision ouverte' : 'Situation du lot'}</h2>
          <p>Le cockpit masque les étapes automatiques lorsqu’elles sont saines. Seules les décisions humaines et exceptions remontent ici.</p>
        </div>
        <a href="${urlFor(run.run_ref, 'history')}" data-cockpit-nav class="kir-subtle-link">Voir l’historique technique →</a>
      </section>
      ${cards.length ? '<section class="kir-actions">' + cards.join('') + '</section>' : ''}
      ${noAction}
      ${businessJourney(run)}
    `;
  }

  function productRows(run, action, view) {
    const rows = (run.business?.products || []).filter(item => item.action === action);
    if (!rows.length) return '<div class="kir-empty">Aucun produit dans cette file.</div>';
    const returnTo = urlFor(run.run_ref, view);
    return `<div class="kir-table-wrap"><table class="kir-table">
      <thead><tr><th>Produit</th><th>Pourquoi ici ?</th><th>Action</th></tr></thead>
      <tbody>${rows.map(item => {
        const productHref = withReturnTo(
          `/admin/products/${encodeURIComponent(item.product_ref)}`,
          returnTo,
          'Retour au lot'
        );
        return `<tr>
        <td><a href="${productHref}">${esc(item.name || item.product_ref)}</a><small>${esc(item.product_ref)}</small></td>
        <td>${esc(item.reason || 'Décision attendue')}</td>
        <td><a class="kir-row-action" href="${productHref}">Ouvrir →</a></td>
      </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function drillHeader(run, title, copy) {
    return `<div class="kir-drill-head">
      <div>
        <a href="${urlFor(run.run_ref)}" data-cockpit-nav class="kir-back">← Retour au lot</a>
        <span class="kir-section-kicker">${esc(run.run_ref)}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(copy)}</p>
      </div>
    </div>`;
  }

  function renderCatalogue(run) {
    return drillHeader(
      run,
      'Validation Catalogue requise',
      'Uniquement les produits pour lesquels le Catalogue exige encore une intervention. Les produits déjà prêts ne sont pas affichés.'
    ) + productRows(run, 'CATALOGUE', 'catalogue');
  }

  function renderCommercial(run) {
    const rows = (run.business?.products || []).filter(item => item.action === 'COMMERCIAL');
    const list = rows.length ? `<div class="kir-table-wrap"><table class="kir-table">
      <thead><tr><th>Produit</th><th>Décision attendue</th><th>Destination</th></tr></thead>
      <tbody>${rows.map(item => {
        const returnTo = urlFor(run.run_ref, 'commercial');
        const productHref = withReturnTo(
          `/admin/products/${encodeURIComponent(item.product_ref)}`,
          returnTo,
          'Retour au lot'
        );
        const marketHref = withReturnTo(
          '/dashboards/canonical/market-catalog.html',
          returnTo,
          'Retour au lot'
        );
        return `<tr>
        <td><a href="${productHref}">${esc(item.name || item.product_ref)}</a><small>${esc(item.product_ref)}</small></td>
        <td>${esc(item.reason || 'Prix / exposition à décider')}</td>
        <td><a class="kir-row-action" href="${marketHref}">Prêts à vendre →</a></td>
      </tr>`;
      }).join('')}</tbody>
    </table></div>` : '<div class="kir-empty">Aucune décision commerciale ouverte.</div>';
    return drillHeader(
      run,
      'Décisions de mise en vente',
      'Ces produits ont déjà franchi la préparation amont. Le geste restant est commercial : prix local et mise en vente.'
    ) + list;
  }

  function renderExceptions(run) {
    const a = run.accounting || {};
    const rows = (run.business?.products || []).filter(item => item.action === 'EXCEPTION');
    const source = [
      num(a.quarantined) ? `${num(a.quarantined)} en quarantaine` : null,
      num(a.certification_blocked) ? `${num(a.certification_blocked)} certification(s) bloquée(s)` : null,
      run.status === 'FAILED' ? 'run technique en échec' : null,
    ].filter(Boolean);
    return drillHeader(
      run,
      'Exceptions à traiter',
      'Cette page ne montre pas les contrôles réussis : uniquement ce qui empêche une décision finale ou la clôture.'
    ) + (source.length ? `<div class="kir-exception-banner">${source.map(esc).join(' · ')}</div>` : '') +
      (rows.length ? productRows(run, 'EXCEPTION', 'exceptions') : source.length ? '' : '<div class="kir-empty">Aucune exception ouverte.</div>');
  }

  function renderRegistry(run, lots) {
    const rows = Array.isArray(lots) ? lots : [];
    return drillHeader(
      run,
      'Registre des lots',
      'Historique métier des KIR récents. Un lot clos reste consultable ; un lot ouvert remonte la décision qui manque.'
    ) + (rows.length ? `<div class="kir-table-wrap"><table class="kir-table">
      <thead><tr><th>Lot</th><th>Source</th><th>État métier</th><th>Décisions finales</th><th>Approuvés vente</th><th>Reste</th><th></th></tr></thead>
      <tbody>${rows.map(lot => `<tr>
        <td><a href="${urlFor(lot.run_ref)}" data-cockpit-nav>${esc(lot.run_ref)}</a><small>${fmtDate(lot.started_at)}</small></td>
        <td>${esc(lot.provider || '—')}</td>
        <td><span class="kir-status is-${businessTone(lot.business_status)}">${esc(businessLabel(lot.business_status))}</span></td>
        <td>${num(lot.closure?.decided_products)} / ${num(lot.closure?.total_products)}</td>
        <td>${num(lot.decisions?.approved_for_sale)}</td>
        <td>${num(lot.closure?.remaining_products)}</td>
        <td><a class="kir-row-action" href="${urlFor(lot.run_ref)}" data-cockpit-nav>Ouvrir →</a></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="kir-empty">Aucun lot dans le registre.</div>');
  }

  function renderClosure(run) {
    const lot = run.business || {};
    const d = lot.decisions || {};
    const closure = lot.closure || {};
    const pending = (lot.products || []).filter(item => item.action);
    const pendingRows = pending.length ? `<div class="kir-table-wrap"><table class="kir-table">
      <thead><tr><th>Produit</th><th>Décision restante</th><th>Destination</th></tr></thead>
      <tbody>${pending.map(item => `<tr>
        <td>${esc(item.name || item.product_ref)}<small>${esc(item.product_ref)}</small></td>
        <td>${esc(item.reason || 'Décision requise')}</td>
        <td><a class="kir-row-action" href="${item.action === 'CATALOGUE' ? urlFor(run.run_ref, 'catalogue') : item.action === 'COMMERCIAL' ? urlFor(run.run_ref, 'commercial') : urlFor(run.run_ref, 'exceptions')}" data-cockpit-nav>Ouvrir →</a></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="kir-empty">Aucune décision restante.</div>';

    return drillHeader(
      run,
      closure.eligible ? 'Lot clos' : 'Clôture du lot',
      'La clôture est une vérité métier : chaque produit transmis doit être soit approuvé à la vente, soit explicitement non retenu, sans exception ouverte.'
    ) + `
      <section class="kir-closure-summary">
        <div><span>Approuvés vente</span><strong>${num(d.approved_for_sale)}</strong></div>
        <div><span>Non retenus</span><strong>${num(d.not_retained)}</strong></div>
        <div><span>Reste à décider</span><strong>${num(closure.remaining_products)}</strong></div>
        <div><span>Statut</span><strong>${closure.eligible ? 'CLOS' : 'EN ATTENTE'}</strong></div>
      </section>
      ${pendingRows}
    `;
  }

  function renderHistory(run) {
    const stages = Array.isArray(run.stages) ? run.stages : [];
    const events = Array.isArray(run.events) ? run.events : [];
    return drillHeader(
      run,
      'Historique technique',
      'Preuve du parcours automatique. Cette information explique le lot mais n’occupe jamais le niveau de pilotage.'
    ) + `
      <section class="kir-history-stages">
        ${stages.map(stage => `<div class="kir-history-stage">
          <span class="kir-history-dot is-${stage.status === 'COMPLETED' ? 'done' : stage.status === 'FAILED' ? 'failed' : 'pending'}"></span>
          <div><strong>${esc(stage.key)}</strong><small>${esc(stage.status)} · ${num(stage.processed)} / ${num(stage.total)}</small></div>
        </div>`).join('')}
      </section>
      <div class="kir-history-events">
        ${events.length ? events.map(event => `<div><time>${fmtDate(event.at)}</time><span>${esc(event.stage)} · ${esc(event.kind)}</span></div>`).join('') : '<div class="kir-empty">Aucun événement technique enregistré.</div>'}
      </div>`;
  }

  function renderBody(run, view, lots) {
    if (view === 'catalogue') return renderCatalogue(run);
    if (view === 'commercial') return renderCommercial(run);
    if (view === 'exceptions') return renderExceptions(run);
    if (view === 'history') return renderHistory(run);
    if (view === 'registry') return renderRegistry(run, lots);
    if (view === 'closure') return renderClosure(run);
    return renderOverview(run);
  }

  function render(root, payload) {
    const sourceControls = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const lots = Array.isArray(payload?.lots) ? payload.lots : [];
    const run = payload?.selected || null;
    const { view } = params();
    root.className = 'kmc-import-runtime';

    if (!run) {
      root.innerHTML = `<section class="kir-page">
        <header class="kir-hero"><div><span class="kir-eyebrow">OPÉRATIONS · IMPORTS</span><h1>Cockpit des imports</h1><p>Aucun lot disponible.</p></div></header>
        ${sourceControlStrip(sourceControls)}
        ${lotStrip(lots, null)}
      </section>`;
      bindNavigation(root);
      bindSourceControls(root);
      return;
    }

    const lot = run.business || {};
    const status = businessLabel(lot.business_status);
    root.innerHTML = `<section class="kir-page">
      <header class="kir-hero">
        <div>
          <span class="kir-eyebrow">OPÉRATIONS · COCKPIT DES IMPORTS</span>
          <h1>${esc(run.run_ref)}</h1>
          <p>${esc(run.provider || 'Source')} · ${num(run.accounting?.source_total)} entrée(s) · import ${run.status === 'COMPLETED' ? 'terminé' : run.status === 'FAILED' ? 'en échec' : 'en cours'}</p>
        </div>
        <div class="kir-hero-actions">
          <span class="kir-status-large is-${businessTone(lot.business_status)}">${esc(status)}</span>
          <a href="${withReturnTo('/admin/workspaces/catalog', urlFor(run.run_ref, view), 'Retour au lot')}" class="kir-global-link">Catalogue global →</a>
        </div>
      </header>

      ${sourceControlStrip(sourceControls)}
      ${lotStrip(lots, run.run_ref)}

      <section class="kir-lot-summary">
        <div><span>Produits transmis</span><strong>${num(lot.promoted_products)}</strong></div>
        <div><span>Décisions finales</span><strong>${num(lot.closure?.decided_products)} / ${num(lot.closure?.total_products)}</strong></div>
        <div><span>Reste à décider</span><strong>${num(lot.closure?.remaining_products)}</strong></div>
        <div><span>Clôture</span><strong>${lot.closure?.eligible ? 'Prête' : 'En attente'}</strong></div>
      </section>

      <main class="kir-main">${renderBody(run, view, lots)}</main>
    </section>`;
    bindNavigation(root);
    bindSourceControls(root);
  }

  function renderLoading(root) {
    root.className = 'kmc-import-runtime';
    root.innerHTML = `<section class="kir-page kir-loading">
      <div class="kir-skeleton kir-skeleton-title"></div>
      <div class="kir-skeleton kir-skeleton-lots"></div>
      <div class="kir-skeleton kir-skeleton-summary"></div>
      <div class="kir-skeleton kir-skeleton-main"></div>
    </section>`;
  }

  function bindSourceControls(root) {
    root.querySelectorAll?.('[data-source-toggle]').forEach(button => {
      button.addEventListener('click', async () => {
        const sourceRef = button.getAttribute('data-source-ref');
        const enabled = button.getAttribute('data-source-enabled') === '1';
        if (!sourceRef || button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const action = enabled ? 'deactivate' : 'activate';
        try {
          await api(`/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/${action}`, {
            method:'POST',
            body:{},
          });
          await refresh({ preserve:true });
        } catch (error) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          const main = root.querySelector?.('.kir-main');
          if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Sourcing · ${esc(error.message)}</div>`);
        }
      });
    });
  }

  function bindNavigation(root) {
    root.querySelectorAll?.('[data-cockpit-nav]').forEach(link => {
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (!href) return;
        global.history.pushState({}, '', href);
        refresh({ preserve:true });
      });
    });
  }

  async function refresh({ preserve = false } = {}) {
    if (!mountedRoot || !global.document.contains(mountedRoot) || global.location.pathname !== '/admin/import-runtime') {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    if (!preserve && !lastPayload) renderLoading(mountedRoot);
    const { run, view } = params();
    const query = new URLSearchParams({ limit: view === 'registry' ? '30' : '12' });
    if (run) query.set('run', run);
    try {
      const payload = await api('/api/admin/workspaces/sourcing/import-cockpit?' + query.toString());
      lastPayload = payload;
      render(mountedRoot, payload);
    } catch (error) {
      if (lastPayload) {
        render(mountedRoot, lastPayload);
        const main = mountedRoot.querySelector?.('.kir-main');
        if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Actualisation impossible · ${esc(error.message)}</div>`);
      } else {
        mountedRoot.innerHTML = `<div class="kir-error">Cockpit indisponible · ${esc(error.message)}</div>`;
      }
    }
  }

  async function mount(options = {}) {
    if (!options.root) throw new Error('canonical_import_runtime_root_missing');
    mountedRoot = options.root;
    lastPayload = null;
    renderLoading(mountedRoot);
    if (timer) clearInterval(timer);
    global.addEventListener?.('popstate', () => refresh({ preserve:true }), { once:false });
    await refresh({ preserve:true });
    timer = setInterval(() => refresh({ preserve:true }), POLL_MS);
  }

  global.KomerceCanonicalImportRuntime = Object.freeze({ mount, render, businessLabel, urlFor, withReturnTo });
})(typeof window !== 'undefined' ? window : globalThis);
