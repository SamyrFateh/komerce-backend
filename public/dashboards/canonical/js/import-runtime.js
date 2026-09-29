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
  const ACTIVATION_POLL_MS = 900;
  const VIEWS = new Set(['overview', 'catalogue', 'commercial', 'exceptions', 'history', 'registry', 'closure']);
  let timer = null;
  let activationTimer = null;
  let activationState = null;
  let mountedRoot = null;
  let lastPayload = null;

  const RUN_STAGE_DEFS = Object.freeze([
    ['SOURCE_CONNECTED', 'Source'],
    ['RAW_IMPORT', 'Import'],
    ['REFINERY', 'Raffinerie'],
    ['TAXONOMY', 'Taxonomie'],
    ['CERTIFICATION', 'Certification'],
    ['CATALOGUE', 'Catalogue'],
  ]);

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

  function normalizedName(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  }

  function activationSourceMatches(source, lot) {
    const wanted = normalizedName(source?.supplier_name || source?.label || source?.source_ref);
    const provider = normalizedName(lot?.provider);
    return Boolean(wanted && provider && (wanted.includes(provider) || provider.includes(wanted)));
  }

  function stopActivationPolling() {
    if (activationTimer && typeof global.clearInterval === 'function') global.clearInterval(activationTimer);
    activationTimer = null;
  }

  function activationStages() {
    const actual = new Map((activationState?.run?.stages || []).map(stage => [stage.key, stage]));
    return RUN_STAGE_DEFS.map(([key, label], index) => ({
      key, label,
      status: actual.get(key)?.status || (index === 0 && !activationState?.done && !activationState?.error ? 'RUNNING' : 'PENDING'),
      processed: num(actual.get(key)?.processed),
      total: num(actual.get(key)?.total),
      reason: actual.get(key)?.reason || null,
    }));
  }

  function flowStageMeta(stage) {
    if (stage.key === 'CATALOGUE' && stage.reason === 'awaiting_explicit_operator_promotion') {
      return { state:'waiting', label:'À valider' };
    }
    if (stage.status === 'COMPLETED') return { state:'completed', label:'Terminé' };
    if (stage.status === 'FAILED') return { state:'failed', label:'Bloqué' };
    if (stage.status === 'RUNNING') return { state:'running', label:'En cours' };
    return { state:'pending', label:'En attente' };
  }

  function flowTrack(stages) {
    return `<div class="kir-run-flow-track">${stages.map((stage, index) => {
      const meta = flowStageMeta(stage);
      const count = stage.total ? `${stage.processed}/${stage.total}` : meta.label;
      const marker = meta.state === 'completed' ? '✓' : meta.state === 'failed' ? '!' : String(index + 1);
      return `<div class="kir-run-flow-step is-${meta.state}">
        <span class="kir-run-flow-marker">${marker}</span>
        <div><strong>${esc(stage.label)}</strong><small>${esc(count)}</small></div>
      </div>`;
    }).join('')}</div>`;
  }

  function activationStrip(sourceControls) {
    if (!activationState) return '';
    const source = (sourceControls || []).find(item => item.source_ref === activationState.sourceRef) || {};
    const label = source.label || source.supplier_name || activationState.label || activationState.sourceRef;
    const stages = activationStages();
    const completed = stages.filter(stage => stage.status === 'COMPLETED').length;
    const running = stages.some(stage => stage.status === 'RUNNING');
    const progress = Math.max(6, Math.min(100, Math.round(((completed + (running ? .45 : 0)) / stages.length) * 100)));
    const noResult = activationState.outcome === 'empty'
      || ['no_valid_product', 'supplier_source_empty', 'all_supplier_products_invalid'].includes(String(activationState.run?.failure_reason || ''));
    const failed = !noResult && (Boolean(activationState.error)
      || activationState.outcome === 'failed'
      || stages.some(stage => stage.status === 'FAILED'));
    const title = failed
      ? 'Passage interrompu'
      : noResult
        ? 'Passage terminé sans résultat'
        : activationState.done ? 'Premier passage terminé' : 'Passage en direct';
    const helper = failed
      ? (activationState.error || 'Le premier passage automatique a échoué.')
      : noResult
        ? `${label} · ${activationState.runRef || 'nouveau lot'} · aucun produit exploitable`
        : activationState.runRef
          ? `${label} · ${activationState.runRef} · le même lot avance de bout en bout`
          : `${label} · préparation de la source et création du premier lot`;
    return `<section class="kir-run-flow ${failed ? 'is-failed' : noResult ? 'is-empty' : activationState.done ? 'is-complete' : 'is-live'}" aria-live="polite">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU LOT</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
        <em>${progress}%</em>
      </div>
      <div class="kir-run-flow-progress"><span style="width:${progress}%"></span></div>
      ${flowTrack(stages)}
    </section>`;
  }

  function persistentRunFlow(run, sourceControls) {
    if (activationState) return activationStrip(sourceControls);
    if (!run) return '';

    const actual = new Map((run.stages || []).map(stage => [stage.key, stage]));
    const stages = RUN_STAGE_DEFS.map(([key, label]) => {
      const stage = actual.get(key) || {};
      return {
        key, label,
        status:stage.status || 'PENDING',
        processed:num(stage.processed),
        total:num(stage.total),
        reason:stage.reason || null,
      };
    });
    const failed = run.status === 'FAILED' || stages.some(stage => stage.status === 'FAILED');
    const catalogueWaiting = stages.some(stage => stage.key === 'CATALOGUE'
      && stage.reason === 'awaiting_explicit_operator_promotion');
    const automaticDone = stages
      .filter(stage => stage.key !== 'CATALOGUE')
      .every(stage => stage.status === 'COMPLETED');
    const progress = Math.max(0, Math.min(100, num(run.progress_pct) || Math.round(
      (stages.filter(stage => stage.status === 'COMPLETED').length / stages.length) * 100
    )));
    const title = failed
      ? 'Passage interrompu'
      : automaticDone && catalogueWaiting
        ? 'Import automatique terminé'
        : run.status === 'COMPLETED'
          ? 'Parcours du lot terminé'
          : 'Passage en cours';
    const helper = failed
      ? (run.failure_reason || 'Une étape du lot est bloquée.')
      : catalogueWaiting
        ? `${run.run_ref} · ${run.provider || 'Source'} · ${num(run.accounting?.awaiting_catalogue_promotion)} certifié(s) attendent la promotion Catalogue`
        : `${run.run_ref} · ${run.provider || 'Source'} · parcours conservé à l’écran`;
    const tone = failed ? 'is-failed' : catalogueWaiting ? 'is-waiting' : run.status === 'COMPLETED' ? 'is-complete' : 'is-live';

    return `<section class="kir-run-flow ${tone}" aria-label="Parcours du lot ${esc(run.run_ref)}">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU LOT</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
        <a href="${urlFor(run.run_ref, 'history')}" data-cockpit-nav>Historique →</a>
      </div>
      <div class="kir-run-flow-progress"><span style="width:${progress}%"></span></div>
      ${flowTrack(stages)}
    </section>`;
  }

  function runTruthStrip(run) {
    const a = run?.accounting || {};
    const values = [
      ['Entrées source', num(a.source_total)],
      ['Acceptées', num(a.accepted)],
      ['Raffinées', num(a.refined)],
      ['Taxonomisées', num(a.taxonomized)],
      ['Certifiées sourcing', num(a.certified)],
      ['Catalogue', num(a.catalogued)],
    ];
    const awaiting = num(a.awaiting_catalogue_promotion);
    const blockers = num(a.rejected) + num(a.quarantined) + num(a.deferred) + num(a.certification_blocked);
    const explanation = awaiting > 0
      ? `${awaiting} produit(s) certifié(s) sourcing ne sont pas encore matérialisés au Catalogue. Ils n’ont pas disparu : le compteur Catalogue ne compte que les promotions réellement effectuées.`
      : blockers > 0
        ? `${blockers} produit(s) sont hors du chemin Catalogue pour une raison explicite (rejet, quarantaine, différé ou certification bloquée).`
        : 'Tous les produits du lot sont comptabilisés dans le parcours réel.';
    return `<section class="kir-run-truth" aria-label="Comptabilité réelle du lot">
      <div class="kir-run-truth-head"><span class="kir-section-kicker">VÉRITÉ DU RUN</span><strong>Ce qui s’est réellement passé</strong></div>
      <div class="kir-run-truth-grid">${values.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div>
      <p>${esc(explanation)}</p>
    </section>`;
  }

  function attachActivationRun(payload) {
    if (!activationState || activationState.runRef) return;
    const source = (payload?.source_controls || []).find(item => item.source_ref === activationState.sourceRef) || null;
    const baseline = new Set(activationState.baselineRunRefs || []);
    const lot = (payload?.lots || []).find(item => !baseline.has(item.run_ref) && activationSourceMatches(source, item));
    if (lot?.run_ref) activationState.runRef = lot.run_ref;
  }

  async function pollActivation() {
    if (!activationState || activationState.done || activationState.error) return;
    try {
      const { run } = params();
      const q = new URLSearchParams({ limit:'12' });
      if (run) q.set('run', run);
      const payload = await api('/api/admin/workspaces/sourcing/import-cockpit?' + q.toString());
      attachActivationRun(payload);
      lastPayload = payload;
      if (activationState.runRef) activationState.run = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}`);
      if (mountedRoot) render(mountedRoot, payload);
    } catch (_) {
      // Feedback live best-effort: l'activation serveur reste l'autorité.
    }
  }

  function startActivationPolling() {
    stopActivationPolling();
    if (typeof global.setInterval !== 'function') return;
    activationTimer = global.setInterval(pollActivation, ACTIVATION_POLL_MS);
    pollActivation();
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
      error.details = body?.details || null;
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
      NO_RESULT:'Sans résultat',
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
      NO_RESULT:'neutral',
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
          const live = activationState?.sourceRef === source.source_ref ? activationState : null;
          const busy = Boolean(live && !live.done && !live.error);
          const displayEnabled = enabled || Boolean(live && !live.error);
          const canToggle = !live && (enabled || activationReady);
          const stateTone = busy ? 'live' : displayEnabled && ready ? 'on' : displayEnabled ? 'warning' : !activationReady ? 'blocked' : ready ? 'off' : 'prep';
          const stateLabel = displayEnabled ? 'ON' : 'OFF';
          const last = source.last_capture_at ? fmtDate(source.last_capture_at) : 'Jamais';
          const readiness = busy
            ? (live.runRef ? `Lot ${live.runRef} en cours` : 'Démarrage du premier import…')
            : !activationReady
              ? (source.blocker || 'Source non activable')
              : !ready
                ? 'Préparation automatique au clic'
                : enabled ? 'Actif' : 'Prêt';
          return `<div class="kir-source-pill is-${stateTone}" title="${esc(readiness)}">
            <span class="kir-source-dot" aria-hidden="true"></span>
            <div class="kir-source-copy">
              <span class="kir-source-name">${esc(source.label || source.supplier_name || source.source_ref)}</span>
              <small>${esc(readiness)} · ${esc(last)}</small>
            </div>
            <button type="button"
              class="kir-source-switch is-${stateTone}"
              role="switch"
              aria-checked="${displayEnabled ? 'true' : 'false'}"
              aria-label="${enabled ? 'Désactiver' : 'Activer'} le sourcing automatique ${esc(source.label || source.source_ref)}"
              data-source-toggle
              data-source-ref="${esc(source.source_ref)}"
              data-source-enabled="${enabled ? '1' : '0'}"
              ${busy ? 'aria-busy="true"' : ''}
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

    const connectorBlocked = lot.business_status === 'BLOCKED'
      && String(lot.failure_reason || '').startsWith('connector_failed:');
    const connectorMessage = connectorBlocked
      ? String(lot.failure_reason || '').replace(/^connector_failed:\s*/i, '')
      : null;
    const noAction = lot.business_status === 'CLOSED'
      ? `<section class="kir-closed-panel"><span>✓</span><div><strong>Lot clos</strong><p>Tous les produits transmis ont une décision terminale. Aucun geste opérateur n’est attendu.</p></div></section>`
      : lot.business_status === 'NO_RESULT'
        ? '<section class="kir-neutral-panel"><strong>Passage terminé sans résultat.</strong>&nbsp; La source n’a retourné aucun produit exploitable ; le lot reste visible pour garder la trace du passage.</section>'
        : connectorBlocked
          ? `<section class="kir-exception-banner"><strong>Connexion fournisseur interrompue.</strong> ${esc(connectorMessage || 'Le fournisseur n’a pas pu être interrogé.')}</section>`
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
      ${lot.business_status === 'NO_RESULT' || (connectorBlocked && num(lot.promoted_products) === 0) ? '' : businessJourney(run)}
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
        ${activationStrip(sourceControls)}
        ${lotStrip(lots, null)}
      </section>`;
      bindNavigation(root);
      bindSourceControls(root, payload);
      return;
    }

    const lot = run.business || {};
    const status = businessLabel(lot.business_status);
    root.innerHTML = `<section class="kir-page">
      <header class="kir-hero">
        <div>
          <span class="kir-eyebrow">OPÉRATIONS · COCKPIT DES IMPORTS</span>
          <h1>${esc(run.run_ref)}</h1>
          <p>${esc(run.provider || 'Source')} · ${num(run.accounting?.source_total)} entrée(s) · import ${lot.business_status === 'NO_RESULT' ? 'sans résultat' : run.status === 'COMPLETED' ? 'terminé' : run.status === 'FAILED' ? 'en échec' : 'en cours'}</p>
        </div>
        <div class="kir-hero-actions">
          <span class="kir-status-large is-${businessTone(lot.business_status)}">${esc(status)}</span>
          <a href="${withReturnTo('/admin/workspaces/catalog', urlFor(run.run_ref, view), 'Retour au lot')}" class="kir-global-link">Catalogue global →</a>
        </div>
      </header>

      ${sourceControlStrip(sourceControls)}
      ${persistentRunFlow(run, sourceControls)}
      ${runTruthStrip(run)}
      ${lotStrip(lots, run.run_ref)}

      <section class="kir-lot-summary">
        <div><span>Déjà au Catalogue</span><strong>${num(run.accounting?.catalogued)}</strong></div>
        <div><span>À promouvoir</span><strong>${num(run.accounting?.awaiting_catalogue_promotion)}</strong></div>
        <div><span>Décisions commerciales</span><strong>${num(lot.closure?.remaining_products)}</strong></div>
        <div><span>Clôture</span><strong>${lot.business_status === 'NO_RESULT' ? 'Sans objet' : lot.closure?.eligible ? 'Prête' : 'En attente'}</strong></div>
      </section>

      <main class="kir-main">${renderBody(run, view, lots)}</main>
    </section>`;
    bindNavigation(root);
    bindSourceControls(root, payload);
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

  function bindSourceControls(root, payload) {
    root.querySelectorAll?.('[data-source-toggle]').forEach(button => {
      button.addEventListener('click', async () => {
        const sourceRef = button.getAttribute('data-source-ref');
        const enabled = button.getAttribute('data-source-enabled') === '1';
        if (!sourceRef || button.disabled) return;
        const action = enabled ? 'deactivate' : 'activate';

        if (!enabled) {
          const source = (payload?.source_controls || []).find(item => item.source_ref === sourceRef) || {};
          activationState = {
            sourceRef, label:source.label || source.supplier_name || sourceRef, done:false, error:null,
            baselineRunRefs:(payload?.lots || []).map(lot => lot.run_ref), runRef:null, run:null, outcome:null,
          };
          render(root, payload);
          startActivationPolling();
        } else {
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
        }

        try {
          const response = await api(`/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/${action}`, { method:'POST', body:{} });
          if (!enabled && activationState?.sourceRef === sourceRef) {
            const result = response?.result || {};
            const responseRunRef = result?.certification_run?.run_ref || result?.first_run?.run_ref || null;
            if (responseRunRef) activationState.runRef = responseRunRef;
            activationState.outcome = result?.first_run?.status || result?.certification_run?.status || null;
            if (activationState.runRef) {
              try { activationState.run = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}`); } catch (_) {}
            }
            activationState.done = true;
            stopActivationPolling();
            if (activationState.runRef && params().run !== activationState.runRef) global.history.pushState({}, '', urlFor(activationState.runRef));
          }
          await refresh({ preserve:true });
          if (!enabled && activationState && typeof global.setTimeout === 'function') {
            global.setTimeout(() => {
              activationState = null;
              if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
            }, 5000);
          }
        } catch (error) {
          const emptyPass = !enabled
            && ['SUPPLIER_SOURCE_EMPTY', 'NO_VALID_SUPPLIER_PRODUCT'].includes(error.code);
          if (emptyPass && activationState?.sourceRef === sourceRef) {
            activationState.runRef = error.details?.run_ref || activationState.runRef;
            activationState.outcome = 'empty';
            activationState.done = true;
            activationState.error = null;
            stopActivationPolling();
            if (activationState.runRef) {
              try { activationState.run = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}`); } catch (_) {}
              if (params().run !== activationState.runRef) global.history.pushState({}, '', urlFor(activationState.runRef));
            }
            await refresh({ preserve:true });
          } else if (!enabled && activationState?.sourceRef === sourceRef) {
            activationState.error = error.message;
            activationState.done = true;
            stopActivationPolling();
            render(root, lastPayload || payload);
            const main = root.querySelector?.('.kir-main');
            if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Sourcing · ${esc(error.message)}</div>`);
          } else {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            const main = root.querySelector?.('.kir-main');
            if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Sourcing · ${esc(error.message)}</div>`);
          }
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
      attachActivationRun(payload);
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
    activationState = null;
    stopActivationPolling();
    renderLoading(mountedRoot);
    if (timer) clearInterval(timer);
    global.addEventListener?.('popstate', () => refresh({ preserve:true }), { once:false });
    await refresh({ preserve:true });
    timer = setInterval(() => refresh({ preserve:true }), POLL_MS);
  }

  global.KomerceCanonicalImportRuntime = Object.freeze({ mount, render, businessLabel, urlFor, withReturnTo });
})(typeof window !== 'undefined' ? window : globalThis);
