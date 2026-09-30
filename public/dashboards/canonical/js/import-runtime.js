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
  const COMMAND_POLL_MS = 2000;
  const VIEWS = new Set(['overview', 'catalogue', 'commercial', 'exceptions', 'history', 'registry', 'closure', 'population', 'source', 'control', 'handoff']);
  const POPULATION_KINDS = Object.freeze(['received', 'ready', 'discarded']);
  let timer = null;
  let activationTimer = null;
  let activationState = null;
  let commandState = null;
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

  // Niveau 1 : quatre étapes que l'utilisateur comprend. Les six étapes réelles du moteur
  // restent la vérité (projection serveur) ; ici on ne fait que les regrouper à l'affichage.
  const CONTROL_STAGES = Object.freeze(['REFINERY', 'TAXONOMY', 'CERTIFICATION']);
  const USER_STEPS = Object.freeze([
    { key:'SOURCE', label:'Source', stages:['SOURCE_CONNECTED'], drill:'SOURCE_CONNECTED' },
    { key:'RECEIVED', label:'Produits reçus', stages:['RAW_IMPORT'], drill:'RAW_IMPORT' },
    { key:'CONTROL', label:'Contrôle automatique', stages:CONTROL_STAGES, drill:'CONTROL' },
    { key:'CATALOGUE', label:'Catalogue', stages:['CATALOGUE'], drill:'CATALOGUE' },
  ]);
  const USER_STAGE_LABELS = Object.freeze({
    SOURCE_CONNECTED:'Source', RAW_IMPORT:'Produits reçus',
    REFINERY:'Contrôle automatique', TAXONOMY:'Contrôle automatique', CERTIFICATION:'Contrôle automatique',
    CATALOGUE:'Catalogue', CONTROL:'Contrôle automatique',
  });
  function userStageLabel(key) { return USER_STAGE_LABELS[key] || key || 'Étape'; }
  function userStageKey(key) { return CONTROL_STAGES.includes(key) ? 'CONTROL' : key; }


  const ICON_PATHS = {
    file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    accepted:'<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m7.8 12.2 3 3 5.4-6.2" stroke="#fff"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.2"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    box:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
    bookmark:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="m9.5 9 2 2 3.5-4"/>',
    chart:'<path d="M12 20V10M18 20V4M6 20v-4"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    clock:'<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 6.5V12l3.5 2" stroke="#fff"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    reject:'<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m8.5 8.5 7 7M15.5 8.5l-7 7" stroke="#fff"/>',
    refresh:'<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/>',
    stop:'<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    play:'<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    handoff:'<path d="M3 12h13"/><path d="m11 6 6 6-6 6"/><path d="M21 5v14"/>',
    alert:'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="currentColor" stroke="none"/><path d="M12 9v4M12 17h.01" stroke="#fff"/>',
  };
  function ico(name) {
    return `<i class="kir-ico kir-ico-${name}" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg></i>`;
  }

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
      return {
        state:'completed',
        label:'Terminé',
        manual_label:`${num(stage.total)} à valider`,
        reached_boundary:true,
      };
    }
    if (stage.status === 'COMPLETED') return { state:'completed', label:'Terminé' };
    if (stage.status === 'FAILED') return { state:'failed', label:'Bloqué' };
    if (stage.status === 'RUNNING') return { state:'running', label:'En cours' };
    return { state:'pending', label:'En attente' };
  }

  // Remise au Catalogue : certified = prêt côté Sourcing ; catalogued = réellement importé au Catalogue.
  // Ces deux vérités ne se confondent jamais : « remis » ne se déduit JAMAIS de certified.
  function handoffFacts(stages, accounting) {
    const list = Array.isArray(stages) ? stages : [];
    const certification = list.find(stage => stage.key === 'CERTIFICATION') || {};
    const certified = num(accounting?.certified);
    const catalogued = num(accounting?.catalogued);
    const controlDone = certification.status === 'COMPLETED';
    return {
      controlDone, certified, catalogued,
      remaining: Math.max(0, certified - catalogued),
      complete: controlDone && certified > 0 && catalogued >= certified,
    };
  }

  // Le pipeline ne montre que l'état du parcours, jamais un compteur (les chiffres vivent dans
  // « Résultat du lot »). Vert = terminé · bleu = travaille · orange = intervention humaine
  // attendue · rouge = Komerce ne peut plus avancer.
  function userSteps(stages, { runStatus = null, accounting = null } = {}) {
    const byKey = new Map((stages || []).map(stage => [stage.key, stage]));
    const handoff = handoffFacts(stages, accounting);
    const actionRequired = num(accounting?.action_required);
    return USER_STEPS.map((def, index) => {
      const subs = def.stages.map(key => byKey.get(key)).filter(Boolean);
      const metas = subs.map(flowStageMeta);
      const anyFailed = metas.some(meta => meta.state === 'failed');
      const anyRunning = metas.some(meta => meta.state === 'running');
      const allDone = subs.length === def.stages.length && metas.every(meta => meta.state === 'completed');
      const someDone = metas.some(meta => meta.state === 'completed');
      const live = !runStatus || runStatus === 'RUNNING';
      let state;
      if (def.key === 'CATALOGUE') {
        state = anyFailed ? 'failed'
          : handoff.complete || (handoff.controlDone && handoff.certified === 0) ? 'completed'
            : 'pending';
      } else if (def.key === 'CONTROL') {
        // Une action humaine attendue prime sur « bloqué » : Komerce n'est pas coincé, il attend.
        state = anyFailed && actionRequired === 0 ? 'failed'
          : anyRunning ? 'running'
            : actionRequired > 0 && (anyFailed || allDone || someDone) ? 'attention'
              : allDone ? 'completed'
                : someDone && live ? 'running'
                  : 'pending';
      } else {
        state = anyFailed ? 'failed' : allDone ? 'completed' : anyRunning || (someDone && live) ? 'running' : 'pending';
      }
      const words = def.key === 'SOURCE'
        ? { completed:'Connectée', running:'Connexion…', pending:'En attente', failed:'Bloquée' }
        : def.key === 'CATALOGUE'
          ? { completed:handoff.certified === 0 ? 'Terminé' : 'Remise terminée', running:'En cours', pending:'En attente', failed:'Bloqué' }
          : { completed:'Terminé', running:'En cours', pending:'En attente', failed:'Bloqué', attention:'Action requise' };
      return { ...def, index, state, count:words[state] || 'En attente' };
    });
  }

  function flowTrack(stages, runRef = null, opts = {}) {
    // Une seule étape est « courante » : la première réellement en cours. Elle seule respire.
    const steps = userSteps(stages, opts);
    const currentIndex = steps.findIndex(step => step.state === 'running');
    return `<div class="kir-run-flow-track">${steps.map((step, index) => {
      const marker = step.state === 'failed' ? '!' : step.state === 'attention' ? '!' : String(index + 1);
      const className = `kir-run-flow-step is-${step.state} ${step.state === 'attention' ? 'has-manual-action' : ''} ${index === currentIndex ? 'is-current' : ''}`;
      const attrs = `${index === currentIndex ? ' aria-current="step"' : ''}${runRef ? ` href="${drillUrl(runRef, step.drill)}" data-cockpit-nav` : ''}`;
      const body = `<span class="kir-run-flow-marker">${marker}</span><div><strong>${esc(step.label)}</strong><small>${esc(step.count)}</small></div>`;
      return runRef
        ? `<a class="${className}"${attrs}>${body}</a>`
        : `<div class="${className}"${attrs}>${body}</div>`;
    }).join('')}</div>`;
  }

  function runtimeCertificationBlocked(run) {
    const diagnostics = run?.diagnostics || {};
    return diagnostics.provider_runtime_status === 'BLOCKED'
      || (
        diagnostics.runtime_certified === false
        && diagnostics.pipeline_status === 'PARTIAL_BLOCKED'
      );
  }

  function runtimeCertificationSummary(run) {
    const a = run?.accounting || {};
    const parts = [
      `${num(a.source_total)} entrée(s)`,
      `${num(a.accepted)} acceptée(s)`,
    ];
    if (num(a.rejected) > 0) parts.push(`${num(a.rejected)} rejetée(s)`);
    if (num(a.deferred) > 0) parts.push(`${num(a.deferred)} différée(s)`);
    if (num(a.certification_blocked) > 0) parts.push(`${num(a.certification_blocked)} bloquée(s) contrat`);
    parts.push(`${num(a.certified)} certifiée(s) sourcing`);
    return parts.join(' · ') + ' · Production reste OFF';
  }

  function certificationReasonDetail(run) {
    const reasons = run?.diagnostics?.reject_reasons || {};
    const entries = Object.entries(reasons)
      .filter(([, count]) => num(count) > 0)
      .sort((a, b) => num(b[1]) - num(a[1]))
      .slice(0, 3);
    return entries.length
      ? entries.map(([reason, count]) => `${reason}: ${num(count)}`).join(' · ')
      : '';
  }

  function runtimeCertificationBlockTitle(run) {
    const provider = run?.provider || 'Source';
    return `${provider} non activé automatiquement`;
  }

  function runtimeCertificationBlockMessage(run) {
    const a = run?.accounting || {};
    const reasons = run?.diagnostics?.reject_reasons || {};
    const rejected = Math.max(1, num(a.rejected));
    const certified = num(a.certified);
    const deferred = num(a.deferred);
    const duplicateVariants = Object.entries(reasons)
      .filter(([reason]) => /combinaison d['’]options dupliquée/i.test(String(reason || '')))
      .reduce((sum, [, count]) => sum + num(count), 0);
    const missingMedia = Object.entries(reasons)
      .filter(([reason]) => /media absent/i.test(String(reason || '')))
      .reduce((sum, [, count]) => sum + num(count), 0);

    let issue = `${rejected} produit${rejected > 1 ? 's' : ''} présente${rejected > 1 ? 'nt' : ''} des données à corriger`;
    if (duplicateVariants > 0) {
      issue = rejected > 1 ? `${rejected} produits contiennent des variantes en double` : '1 produit contient des variantes en double';
    } else if (missingMedia > 0) {
      issue = rejected > 1 ? `${rejected} produits n’ont pas d’image exploitable` : '1 produit n’a pas d’image exploitable';
    }

    const parts = [
      `${issue}.`,
      `${certified} produit${certified > 1 ? 's' : ''} valide${certified > 1 ? 's' : ''} continue${certified > 1 ? 'nt' : ''} vers le Catalogue.`,
    ];
    if (deferred > 0) parts.push(`${deferred} produit${deferred > 1 ? 's' : ''} ont été mis de côté pour revue.`);
    parts.push('Corrigez le produit en erreur puis relancez l’activation automatique.');
    return parts.join(' ');
  }

  function automaticPipelineDone(run, stages) {
    const list = Array.isArray(stages) ? stages : [];
    if (run?.status === 'FAILED' || list.some(stage => stage.status === 'FAILED')) return false;
    const catalogue = list.find(stage => stage.key === 'CATALOGUE') || {};
    const automaticStages = list.filter(stage => stage.key !== 'CATALOGUE');
    const upstreamDone = automaticStages.length > 0
      && automaticStages.every(stage => stage.status === 'COMPLETED');
    const catalogueReached = catalogue.status === 'COMPLETED'
      || catalogue.reason === 'awaiting_explicit_operator_promotion';
    return run?.status === 'COMPLETED' || (upstreamDone && catalogueReached);
  }

  function activationStrip(sourceControls) {
    if (!activationState) return '';
    const source = (sourceControls || []).find(item => item.source_ref === activationState.sourceRef) || {};
    const label = source.label || source.supplier_name || activationState.label || activationState.sourceRef;
    const stages = activationStages();
    const completed = stages.filter(stage => stage.status === 'COMPLETED').length;
    const running = stages.some(stage => stage.status === 'RUNNING');
    const projectedProgress = num(activationState.run?.progress_pct);
    const automaticDone = automaticPipelineDone(activationState.run, stages);
    const progress = automaticDone
      ? 100
      : projectedProgress > 0
        ? Math.max(6, Math.min(100, projectedProgress))
        : Math.max(6, Math.min(100, Math.round(((completed + (running ? .45 : 0)) / stages.length) * 100)));
    const noResult = activationState.outcome === 'empty'
      || ['no_valid_product', 'supplier_source_empty', 'all_supplier_products_invalid'].includes(String(activationState.run?.failure_reason || ''));
    const providerGateBlocked = activationState.outcome === 'certification_incomplete'
      || runtimeCertificationBlocked(activationState.run);
    const failed = !noResult && !providerGateBlocked && (Boolean(activationState.error)
      || activationState.outcome === 'failed'
      || stages.some(stage => stage.status === 'FAILED'));
    const catalogueWaiting = stages.some(stage => stage.key === 'CATALOGUE'
      && stage.reason === 'awaiting_explicit_operator_promotion');
    const title = failed
      ? 'Passage interrompu'
      : noResult
        ? 'Passage terminé sans résultat'
        : automaticDone || providerGateBlocked || catalogueWaiting
          ? 'Import automatique terminé'
          : activationState.done ? 'Premier passage terminé' : 'Passage en direct';
    const helper = failed
      ? (activationState.error || 'Le premier passage automatique a échoué.')
      : noResult
        ? `${label} · ${activationState.runRef || 'nouveau lot'} · aucun produit exploitable`
        : providerGateBlocked
          ? `${label} · alimentation automatique arrêtée`
          : automaticDone && catalogueWaiting
            ? `${label} · le traitement automatique est terminé`
            : automaticDone
              ? `${label} · le traitement automatique a atteint le Catalogue`
              : activationState.runRef
                ? `${label} · ${activationState.runRef} · le même lot avance de bout en bout`
                : `${label} · préparation de la source et création du premier lot`;
    const tone = failed ? 'is-failed'
      : noResult ? 'is-empty'
        : automaticDone || catalogueWaiting || providerGateBlocked || activationState.done
          ? `is-complete ${catalogueWaiting ? 'has-manual-action' : ''}`.trim()
          : 'is-live';
    return `<section class="kir-run-flow ${tone}" aria-live="polite">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU LOT</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
        <em>${progress}%</em>
      </div>
      <div class="kir-run-flow-progress"><span style="width:${progress}%"></span></div>
      ${flowTrack(stages, activationState?.runRef || null, { runStatus:'RUNNING', accounting:activationState?.run?.accounting })}
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
        ? `${run.run_ref} · ${run.provider || 'Source'}`
        : `${run.run_ref} · ${run.provider || 'Source'} · parcours conservé à l’écran`;
    const tone = failed ? 'is-failed'
      : catalogueWaiting || run.status === 'COMPLETED' ? 'is-complete has-manual-action'
        : 'is-live';

    return `<section class="kir-run-flow ${tone}" aria-label="Parcours du lot ${esc(run.run_ref)}">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU LOT</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
      </div>
      ${flowTrack(stages, run.run_ref, { runStatus:run.status, accounting:run.accounting })}
    </section>`;
  }

  function runProgressPct(run) {
    const list = Array.isArray(run?.stages) ? run.stages : [];
    const completed = list.filter(stage => stage.status === 'COMPLETED').length;
    return Math.max(0, Math.min(100, num(run?.progress_pct) || Math.round((completed / RUN_STAGE_DEFS.length) * 100)));
  }

  // Ligne « Progression globale » : % pondéré par étapes (service) + ratio réel de l'étape active.
  function runProgressRow(run) {
    if (run?.status !== 'RUNNING') return '';
    const pct = runProgressPct(run);
    const list = Array.isArray(run?.stages) ? run.stages : [];
    const active = list.find(stage => stage.status === 'RUNNING' && num(stage.total) > 0);
    const detail = active
      ? `${userStageLabel(active.key)} · ${num(active.processed)} / ${num(active.total)}`
      : '';
    return `<section class="kir-run-progress" aria-label="Progression globale">
      <strong>Progression globale</strong>
      <div class="kir-run-progress-track"><span style="width:${pct}%"></span></div>
      <em>${pct} %</em>
      ${detail ? `<small>${esc(detail)}</small>` : ''}
    </section>`;
  }

  // Résultat du lot : quatre chiffres, chacun lu tel quel dans la comptabilité serveur.
  function sourcingOutcome(run) {
    const a = run?.accounting || {};
    const stages = Array.isArray(run?.stages) ? run.stages : [];
    const raw = stages.find(stage => stage.key === 'RAW_IMPORT') || {};
    const h = handoffFacts(stages, a);
    return {
      received:num(a.source_total),
      ready:h.certified,
      // Issues automatiques terminales : ni erreur ni intervention. DEFERRED reste une issue
      // comptabilisée (preuve de comptage), il n'est pas présenté comme un écart à traiter.
      discarded:num(a.duplicates) + num(a.rejected),
      actionRequired:num(a.action_required),
      unaccounted:num(a.unaccounted) + num(a.overflow),
      rawDone:raw.status === 'COMPLETED',
      handoff:h,
    };
  }

  function runTruthStrip(run) {
    const o = sourcingOutcome(run);
    const open = o.actionRequired > 0;
    const tiles = [
      ['Produits reçus', o.received, 'file', populationUrl(run.run_ref, 'received'), 'is-received', 'de la source'],
      ['Prêts pour le Catalogue', o.ready, 'accepted', populationUrl(run.run_ref, 'ready'), 'is-delivered', 'produits'],
      ['Écartés automatiquement', o.discarded, 'reject', populationUrl(run.run_ref, 'discarded'), 'is-discarded', 'selon les règles'],
      ['Action requise', o.actionRequired, 'alert', urlFor(run.run_ref, 'exceptions'), open ? 'is-review is-attention' : 'is-review', open ? 'Intervenir →' : 'rien à faire'],
    ];
    const proof = !o.rawDone || o.received === 0 ? ''
      : o.unaccounted > 0
        ? `<p class="kir-run-proof is-bad">${ico('alert')}${o.received - Math.min(o.received, o.unaccounted)}/${o.received} produits comptabilisés · ${o.unaccounted} produit${o.unaccounted > 1 ? 's' : ''} à retrouver</p>`
        : `<p class="kir-run-proof is-ok"><b aria-hidden="true">✓</b>${o.received}/${o.received} produits comptabilisés</p>`;
    return `<section class="kir-run-truth" aria-label="Résultat du lot">
      <div class="kir-run-truth-head"><span class="kir-section-kicker">RÉSULTAT DU LOT</span>${proof}</div>
      <div class="kir-run-truth-grid is-four">${tiles.map(([label, value, icon, href, cls, sub]) =>
        `<a class="${cls}" href="${href}" data-cockpit-nav aria-label="${esc(label)} — ouvrir le détail">${ico(icon)}<span>${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small></a>`
      ).join('')}</div>
    </section>`;
  }

  // Passage au Catalogue : uniquement l'état de la remise (les chiffres sont déjà au résultat du lot).
  function catalogueHandoff(run) {
    const h = sourcingOutcome(run).handoff;
    if (!h.controlDone || h.certified === 0) return '';
    const state = h.complete ? 'is-clean' : 'is-waiting';
    const text = h.complete ? 'Remise terminée'
      : h.catalogued === 0 ? 'En attente de remise'
        : `${h.remaining} ${h.remaining > 1 ? 'restent' : 'reste'} à remettre`;
    return `<section class="kir-handoff ${state}" aria-label="Passage au Catalogue">
      ${ico('handoff')}
      <div><span class="kir-section-kicker">PASSAGE AU CATALOGUE</span><strong>${h.complete ? '<b aria-hidden="true">✓</b> ' : ''}${esc(text)}</strong></div>
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
    const kind = query.get('kind');
    return {
      run,
      view: VIEWS.has(requestedView) ? requestedView : 'overview',
      kind: POPULATION_KINDS.includes(kind) ? kind : 'received',
      from: query.get('from') || null,
    };
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

  // Statut du header : uniquement Sourcing. Le statut global du lot (prix, marché, mise en vente,
  // décisions Catalogue) ne s'affiche jamais ici.
  function sourcingStatusView(run) {
    const status = run?.sourcing_status
      || (run?.status === 'FAILED' ? 'BLOCKED' : run?.status === 'COMPLETED' ? 'DONE' : 'RUNNING');
    return ({
      RUNNING:{ label:'LIVE', tone:'live' },
      DONE:{ label:'Terminé', tone:'positive' },
      ACTION_REQUIRED:{ label:'Action requise', tone:'warning' },
      BLOCKED:{ label:'Bloqué', tone:'critical' },
    })[status] || { label:'Terminé', tone:'positive' };
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

  function stageUrl(runRef, stageKey) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'history');
    if (stageKey) q.set('stage', stageKey);
    return '/admin/import-runtime?' + q.toString();
  }

  // Un clic répond à la question posée : un chiffre → les objets qui le composent ; une étape → ce qui s'y passe ;
  // le détail technique (six étapes du moteur) n'est atteint que par un lien secondaire.
  function populationUrl(runRef, kind) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'population');
    q.set('kind', kind);
    return '/admin/import-runtime?' + q.toString();
  }

  function drillUrl(runRef, drill) {
    if (drill === 'SOURCE_CONNECTED' || drill === 'SOURCE') return urlFor(runRef, 'source');
    if (drill === 'RAW_IMPORT') return populationUrl(runRef, 'received');
    if (drill === 'CONTROL') return urlFor(runRef, 'control');
    if (drill === 'CATALOGUE') return urlFor(runRef, 'handoff');
    return stageUrl(runRef, drill);
  }

  function technicalUrl(runRef, from = null) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'history');
    if (from) q.set('from', from);
    return '/admin/import-runtime?' + q.toString();
  }

  function elapsedLabel(startedAt, finishedAt = null) {
    const start = startedAt ? new Date(startedAt) : null;
    const end = finishedAt ? new Date(finishedAt) : new Date();
    if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
    const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours > 0
      ? `${hours} h ${String(minutes).padStart(2, '0')} min`
      : `${minutes} min ${String(rest).padStart(2, '0')} s`;
  }

  function stageLabel(key) {
    return RUN_STAGE_DEFS.find(([stageKey]) => stageKey === key)?.[1] || key || 'Étape';
  }

  function withReturnTo(path, returnTo, label = 'Retour au lot') {
    const separator = String(path || '').includes('?') ? '&' : '?';
    const q = new URLSearchParams();
    q.set('return_to', returnTo);
    q.set('return_label', label);
    return `${path}${separator}${q.toString()}`;
  }

  function sourceControlStrip(sourceControls, selectedRun = null) {
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
        <small>OFF → ON prépare la source, certifie le rail fournisseur sur un premier import réel puis active l’autopilot.</small>
      </div>
      <div class="kir-source-control-list">
        ${sources.map(source => {
          const enabled = source.autopilot_enabled === true;
          const ready = source.autopilot_ready === true;
          const activationReady = source.activation_ready === true;
          const live = activationState?.sourceRef === source.source_ref ? activationState : null;
          const busy = Boolean(live && !live.done && !live.error);
          const selectedSourceMatches = selectedRun
            && String(selectedRun.source_ref || '') === String(source.source_ref || '');
          const providerGateBlocked = Boolean(
            (live && live.done && live.outcome === 'certification_incomplete')
            || (selectedSourceMatches && runtimeCertificationBlocked(selectedRun))
          );
          const displayEnabled = enabled || busy;
          const canToggle = !busy && (enabled || activationReady);
          const stateTone = providerGateBlocked
            ? 'blocked'
            : busy ? 'live'
              : displayEnabled && ready ? 'on'
                : displayEnabled ? 'warning'
                  : !activationReady ? 'blocked'
                    : ready ? 'off' : 'prep';
          const stateLabel = displayEnabled ? 'ON' : 'OFF';
          const last = source.last_capture_at ? fmtDate(source.last_capture_at) : 'Jamais';
          const readiness = providerGateBlocked
            ? 'Source OFF · preuve runtime à corriger puis relancer'
            : busy
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

  // Source pilotée par le lot affiché. Le run n'expose pas toujours un source_ref identique à celui
  // de la carte source : on retombe sur l'activation en cours, puis le fournisseur, puis l'unique
  // source active. Jamais de barre manquante parce qu'une correspondance stricte a échoué.
  function sourceForRun(run, sourceControls) {
    const list = Array.isArray(sourceControls) ? sourceControls : [];
    if (!run || !list.length) return null;
    const norm = value => String(value || '').trim().toLowerCase();
    const byRef = ref => ref ? list.find(item => item.source_ref === ref) : null;
    const provider = norm(run.provider);
    const byProvider = provider
      ? list.filter(item => [item.label, item.supplier_name, item.source_ref].some(name => {
        const n = norm(name);
        return n && (n.includes(provider) || provider.includes(n));
      }))
      : [];
    const enabled = list.filter(item => item.autopilot_enabled === true);
    return byRef(run.source_ref)
      || byRef(activationState?.sourceRef)
      || (byProvider.length === 1 ? byProvider[0] : null)
      || (enabled.length === 1 ? enabled[0] : null)
      || (list.length === 1 ? list[0] : null);
  }

  // Trois gestes humains, branchés sur les commandes existantes (import-now / deactivate / activate).
  function commandBar(run, sourceControls) {
    const source = sourceForRun(run, sourceControls);
    if (!source) return '';
    const ref = esc(source.source_ref);
    const enabled = source.autopilot_enabled === true;
    const restarting = Boolean(activationState && activationState.sourceRef === source.source_ref && !activationState.done && !activationState.error);
    const pending = commandState?.sourceRef === source.source_ref ? commandState.action : restarting ? 'restart' : null;
    const running = run?.status === 'RUNNING';
    const active = enabled || restarting;
    const busyLabel = { update:'Mise à jour…', stop:'Arrêt…', restart:'Redémarrage…' };
    const button = (command, label, icon, disabled = false, title = '') => {
      const isBusy = pending === command;
      return `<button type="button" class="kir-cmd kir-cmd-${command} ${isBusy ? 'is-busy' : ''}" data-source-command="${command}" data-source-ref="${ref}"
        ${pending || disabled ? 'disabled' : ''} ${isBusy ? 'aria-busy="true"' : ''} ${title ? `title="${esc(title)}"` : ''}>${isBusy ? '<i class="kir-spin" aria-hidden="true"></i>' : ico(icon)}<span>${isBusy ? busyLabel[command] : label}</span></button>`;
    };
    const update = button('update', 'Mettre à jour maintenant', 'refresh', running && !pending, running ? 'Une mise à jour est déjà en cours' : '');
    const stop = button('stop', 'Arrêter', 'stop');
    const restart = button('restart', 'Redémarrer', 'play', !restarting && source.activation_ready !== true, source.blocker || '');
    const last = source.last_capture_at ? `Dernière mise à jour ${fmtDate(source.last_capture_at)}` : 'Aucune mise à jour pour l’instant';
    const state = pending === 'update' || running ? 'Mise à jour en cours' : active ? 'Alimentation automatique active' : 'Alimentation automatique arrêtée';
    return `<section class="kir-command-bar ${active ? 'is-active' : 'is-stopped'}" aria-label="Commandes de la source">
      <div class="kir-command-state"><span class="kir-source-dot" aria-hidden="true"></span>
        <div><strong>${esc(source.label || source.supplier_name || source.source_ref)}</strong><small>${esc(state)} · ${esc(last)}</small></div></div>
      <div class="kir-command-actions">${active ? update + stop : restart + update}</div>
    </section>`;
  }

  // Pastille de lot : état du passage Sourcing seulement (jamais « décisions attendues » du Catalogue).
  function lotChipView(lot) {
    return ({
      RUNNING:{ label:'En cours', tone:'live' },
      BLOCKED:{ label:'Bloqué', tone:'critical' },
      NO_RESULT:{ label:'Sans résultat', tone:'neutral' },
      ARCHIVED:{ label:'Archivé', tone:'neutral' },
      UNKNOWN:{ label:'État indisponible', tone:'neutral' },
    })[lot?.business_status] || { label:'Terminé', tone:'positive' };
  }

  function lotStrip(lots, selectedRef) {
    const visibleLots = (lots || []).filter(lot => lot.business_status !== 'ARCHIVED' || lot.run_ref === selectedRef);
    const cards = visibleLots.map(lot => {
      const active = lot.run_ref === selectedRef;
      return `<a class="kir-lot-chip ${active ? 'is-selected' : ''}" href="${urlFor(lot.run_ref)}" data-cockpit-nav>
        <span class="kir-lot-ref">${esc(lot.run_ref)}</span>
        <strong class="kir-status is-${lotChipView(lot).tone}">${esc(lotChipView(lot).label)}</strong>
        <small>${esc(lot.provider || 'Source')} · ${num(lot.source_total)} entrée(s)</small>
      </a>`;
    }).join('');
    const empty = `<div class="kir-empty-launch">
      <div class="kir-empty-launch-copy">
        <strong>Aucun lot importé</strong>
        <span>Activez une source pour lancer un premier passage réel et suivre sa progression ici.</span>
      </div>
    </div>`;
    return `<nav class="kir-lot-strip ${cards ? '' : 'is-empty'}" aria-label="Lots d'import récents">
      <div class="kir-lot-strip-scroll">${cards || empty}</div>
      <a class="kir-lot-all" href="${urlFor(selectedRef, 'registry')}" data-cockpit-nav>Tous les lots</a>
    </nav>`;
  }

  const CHANGE_KIND_LABELS = { created:'nouveau', updated:'mis à jour' };
  const ITEM_OUTCOME_LABELS = {
    ready_for_refinery:'accepté',
    deferred:'mis de côté',
    auto_rejected:'écarté',
    certification_blocked:'à examiner',
    error:'à examiner',
    processed:'traité',
  };

  function fmtMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1000) return `${Math.max(1, Math.round(n))} ms`;
    const s = n / 1000;
    if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
    return `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
  }

  function fmtPrice(value, currency) {
    const n = Number(value);
    if (value == null || !Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat('fr-FR', { style:'currency', currency: currency || 'EUR' }).format(n);
    } catch (_) {
      return `${n.toLocaleString('fr-FR')} ${currency || ''}`.trim();
    }
  }

  function liveEventLabel(event) {
    if (event?.kind === 'ITEM_FINISHED') return event.product_name || 'Produit';
    const stage = stageLabel(event?.stage);
    if (event?.kind === 'STAGE_FINISHED') return `${stage} terminé`;
    if (event?.kind === 'STAGE_STARTED') return `${stage} démarré`;
    return stage;
  }

  function fmtClock(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function durationLabel(startedAt, finishedAt) {
    const start = startedAt ? new Date(startedAt).getTime() : NaN;
    const end = finishedAt ? new Date(finishedAt).getTime() : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
    const seconds = Math.round((end - start) / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
  }

  // Phrase métier construite uniquement à partir des métriques d'étape déjà projetées par le service.
  function liveEventDetail(run, event) {
    if (event.kind === 'ITEM_FINISHED') {
      return [CHANGE_KIND_LABELS[event.change_kind], ITEM_OUTCOME_LABELS[event.outcome] || 'traité', fmtMs(event.duration_ms)].filter(Boolean).join(' · ');
    }
    const stage = (run.stages || []).find(item => item.key === event.stage) || {};
    const a = run.accounting || {};
    const finished = event.kind === 'STAGE_FINISHED';
    const done = num(stage.processed);
    const total = num(stage.total);
    let text = '';
    if (event.stage === 'SOURCE_CONNECTED') {
      text = run.provider ? `${run.provider} connecté` : '';
    } else if (event.stage === 'RAW_IMPORT') {
      text = finished
        ? `${num(a.source_total)} produit(s) récupéré(s)${num(a.duplicates) > 0 ? ` · ${num(a.duplicates)} doublon(s)` : ''}`
        : `${total} produit(s) à récupérer`;
    } else if (event.stage === 'REFINERY') {
      text = finished ? `${done} produit(s) raffiné(s)` : `${done} / ${total} raffinés`;
    } else if (event.stage === 'TAXONOMY') {
      text = finished ? `${done} produit(s) classé(s)` : `${done} / ${total} classés`;
    } else if (event.stage === 'CERTIFICATION') {
      text = finished ? `${done} produit(s) certifié(s)` : `${done} / ${total} certifiés`;
    } else if (event.stage === 'CATALOGUE') {
      text = stage.reason === 'awaiting_explicit_operator_promotion'
        ? `${total} certifié(s) à valider`
        : `${done} produit(s) au Catalogue`;
    }
    const duration = finished ? durationLabel(stage.started_at, stage.finished_at) : '';
    return [text, duration].filter(Boolean).join(' · ');
  }

  function itemHref(run, item) {
    if (item?.product_ref) {
      return withReturnTo(
        `/admin/products/${encodeURIComponent(item.product_ref)}`,
        urlFor(run.run_ref),
        'Retour au lot'
      );
    }
    return stageUrl(run.run_ref, item?.stage || run.current_stage);
  }

  // N1 : uniquement les événements qui aident à comprendre. Les étapes internes terminées
  // normalement (raffinage, classement…) ne produisent aucune ligne ; elles restent au détail.
  function humanEvent(run, event) {
    const stage = (run.stages || []).find(item => item.key === event.stage) || {};
    const a = run.accounting || {};
    if (event.kind === 'ITEM_FINISHED') return { label:liveEventLabel(event), detail:liveEventDetail(run, event), started:false };
    const started = event.kind === 'STAGE_STARTED';
    const finished = event.kind === 'STAGE_FINISHED';
    const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    if (event.stage === 'SOURCE_CONNECTED' && finished) return { label:'Source connectée', detail:run.provider || '', started:false };
    if (event.stage === 'RAW_IMPORT' && finished) {
      return { label:`${plural(num(a.source_total), 'produit reçu', 'produits reçus')}`, detail:num(a.duplicates) > 0 ? plural(num(a.duplicates), 'doublon écarté', 'doublons écartés') : '', started:false };
    }
    if (event.stage === 'REFINERY' && started) return { label:'Contrôle automatique démarré', detail:'', started:true };
    if (event.stage === 'CERTIFICATION' && finished) {
      return { label:`Contrôle terminé pour ${plural(num(stage.processed), 'produit', 'produits')}`, detail:durationLabel(stage.started_at, stage.finished_at), started:false };
    }
    if (event.stage === 'CATALOGUE' && finished) {
      return stage.reason === 'awaiting_explicit_operator_promotion'
        ? { label:`${plural(num(stage.total), 'produit prêt', 'produits prêts')} pour le Catalogue`, detail:'', started:false }
        : { label:`${plural(num(stage.processed), 'produit remis', 'produits remis')} au Catalogue`, detail:'', started:false };
    }
    return null;
  }

  function renderLiveActivity(run) {
    const events = Array.isArray(run.events) ? run.events : [];
    const items = events
      .map(event => ({ event, human:humanEvent(run, event) }))
      .filter(entry => entry.human)
      .slice(0, 8);
    return `<section class="kir-live-panel kir-live-activity" aria-label="Activité en temps réel">
      <header><div>${ico('clock')}<strong>Activité en temps réel</strong></div><a href="${urlFor(run.run_ref, 'history')}" data-cockpit-nav>Tout voir →</a></header>
      <div class="kir-live-event-list">
        ${items.length ? items.map(({ event, human }) => `<a href="${stageUrl(run.run_ref, userStageKey(event.stage))}" data-cockpit-nav class="kir-live-event ${human.started ? 'is-started' : 'is-finished'}">
          <time title="${esc(fmtDate(event.at))}">${fmtClock(event.at)}</time>
          <span class="kir-live-event-marker"></span>
          <div><strong>${esc(human.label)}</strong>${human.detail ? `<small>${esc(human.detail)}</small>` : ''}</div>
        </a>`).join('') : '<div class="kir-empty-inline">Aucun événement enregistré pour ce lot.</div>'}
      </div>
    </section>`;
  }

  // Le libellé suit la nature réelle de la donnée (service) : jamais « en cours » sans événement ouvert.
  function currentItemTitle(run) {
    if (run.current_item_kind === 'in_progress') return 'Produit en cours de traitement';
    if (run.current_item_kind === 'last_processed') return 'Dernier produit traité';
    return 'Dernier produit mis à jour';
  }

  function renderCurrentItem(run) {
    const item = run.current_item || null;
    if (!item) {
      return `<section class="kir-live-panel kir-current-item"><header><strong>${esc(currentItemTitle(run))}</strong></header><div class="kir-current-empty">Aucun produit pour ce lot.</div></section>`;
    }
    const href = itemHref(run, item);
    const image = item.image_url
      ? `<img src="${esc(item.image_url)}" alt="" loading="lazy">`
      : `<div class="kir-current-image-placeholder">${ico('box')}</div>`;
    return `<section class="kir-live-panel kir-current-item" aria-label="${esc(currentItemTitle(run))}">
      <header><div>${ico('box')}<strong>${esc(currentItemTitle(run))}</strong></div><a href="${href}" ${item.product_ref ? '' : 'data-cockpit-nav'}>Voir le détail →</a></header>
      <a class="kir-current-item-body" href="${href}" ${item.product_ref ? '' : 'data-cockpit-nav'}>
        <div class="kir-current-image">${image}</div>
        <div class="kir-current-copy">
          <h3>${esc(item.product_name || item.supplier_product_id || 'Produit')}</h3>
          <p><span>Source :</span> ${esc(item.supplier_product_id || '—')}</p>
          <p><span>Catégorie :</span> ${esc(item.komerce_category || 'À déterminer')}</p>
          <div class="kir-current-status">
            <span class="kir-current-chip ${item.in_progress ? 'is-live' : ''}">${item.in_progress ? '<i class="kir-spin" aria-hidden="true"></i>' : ''}${esc(item.in_progress ? `En cours — ${userStageLabel(item.stage)}` : (ITEM_OUTCOME_LABELS[item.outcome] || 'Traité').replace(/^./, c => c.toUpperCase()))}</span>
            ${[CHANGE_KIND_LABELS[item.change_kind], item.duration_ms != null ? fmtMs(item.duration_ms) : ''].filter(Boolean).length ? `<small>${esc([CHANGE_KIND_LABELS[item.change_kind], item.duration_ms != null ? fmtMs(item.duration_ms) : ''].filter(Boolean).join(' · '))}</small>` : ''}
          </div>
        </div>
      </a>
    </section>`;
  }

  function renderRecentItems(run) {
    const items = Array.isArray(run.recent_items) ? run.recent_items : [];
    return `<section class="kir-recent-items">
      <header><div>${ico('list')}<strong>Derniers produits traités</strong></div><a href="${urlFor(run.run_ref, 'history')}" data-cockpit-nav>Voir le parcours →</a></header>
      ${items.length ? `<div class="kir-live-table-wrap"><table class="kir-live-table">
        <thead><tr><th class="kir-live-seq-col">#</th><th class="kir-live-thumb-col">Image</th><th>Titre (source)</th><th>Étape actuelle</th><th>Statut</th><th class="kir-live-time-col">Temps</th></tr></thead>
        <tbody>${items.map((item, index) => {
          const href = itemHref(run, item);
          const status = item.in_progress
            ? '<span class="kir-status is-live"><i class="kir-spin" aria-hidden="true"></i>En cours…</span>'
            : `<span class="kir-status is-done"><b aria-hidden="true">✓</b>${esc([CHANGE_KIND_LABELS[item.change_kind], ITEM_OUTCOME_LABELS[item.outcome] || item.state].filter(Boolean).join(' · ') || 'OK')}</span>`;
          const time = item.duration_ms != null ? fmtMs(item.duration_ms) : fmtClock(item.updated_at);
          return `<tr data-stage="${esc(item.stage || '')}">
            <td class="kir-live-seq">${esc(item.seq != null ? item.seq : index + 1)}</td>
            <td class="kir-live-thumb">${item.image_url ? `<img src="${esc(item.image_url)}" alt="" loading="lazy">` : ico('box')}</td>
            <td><a href="${href}" ${item.product_ref ? '' : 'data-cockpit-nav'}>${esc(item.product_name || item.product_ref || 'Produit')}</a>${item.supplier_product_id ? `<small class="kir-live-sub">${esc(item.supplier_product_id)}</small>` : ''}</td>
            <td><a class="kir-stage-link" href="${stageUrl(run.run_ref, userStageKey(item.stage))}" data-cockpit-nav>${esc(userStageLabel(item.stage))}</a></td>
            <td>${status}</td>
            <td class="kir-live-time">${esc(time)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="kir-empty-inline">Aucun produit récent.</div>'}
    </section>`;
  }

  function renderLiveCore(run) {
    return `<section class="kir-live-grid">
        ${renderLiveActivity(run)}
        ${renderCurrentItem(run)}
      </section>
      ${renderRecentItems(run)}`;
  }

  // Écran calme : rien à afficher quand rien n'est à décider. Seuls un lot sans résultat ou une
  // connexion fournisseur interrompue justifient un message.
  function renderDecisions(run) {
    const lot = run.business || {};
    const connectorBlocked = lot.business_status === 'BLOCKED'
      && String(lot.failure_reason || '').startsWith('connector_failed:');
    if (lot.business_status === 'NO_RESULT') {
      return '<section class="kir-neutral-panel"><strong>Passage terminé sans résultat.</strong>&nbsp; La source n’a retourné aucun produit exploitable ; le lot reste visible pour garder la trace du passage.</section>';
    }
    if (connectorBlocked) {
      const message = String(lot.failure_reason || '').replace(/^connector_failed:\s*/i, '');
      return `<section class="kir-exception-banner"><strong>Connexion fournisseur interrompue.</strong> ${esc(message || 'Le fournisseur n’a pas pu être interrogé.')}</section>`;
    }
    return '';
  }

  function renderOverview(run) {
    return renderLiveCore(run) + renderDecisions(run);
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

  function drillHeader(run, title, copy, back = null) {
    const target = back || { href:urlFor(run.run_ref), label:'← Retour au lot' };
    return `<div class="kir-drill-head">
      <div>
        <a href="${target.href}" data-cockpit-nav class="kir-back">${esc(target.label)}</a>
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

  // Action requise : la liste filtrée des éléments qui attendent réellement l'utilisateur
  // (produit, raison compréhensible, action). Rien d'autre : ni logs, ni historique, ni vue technique.
  function renderExceptions(run) {
    const items = Array.isArray(run.action_items) ? run.action_items : [];
    const count = num(run.accounting?.action_required);
    const back = urlFor(run.run_ref, 'exceptions');
    const workspace = withReturnTo('/admin/workspaces/sourcing', back, 'Retour au cockpit');
    const rows = items.map(item => {
      const title = item.product_name || item.supplier_product_id || (item.reason === 'Anomalie de comptage' ? 'Comptage du lot' : 'Produit à examiner');
      const control = item.action === 'choose' && item.candidate_ref
        ? `<button type="button" class="kir-row-action" data-action-choose data-candidate-ref="${esc(item.candidate_ref)}">${esc(item.action_label)}</button>`
        : `<a class="kir-row-action" href="${workspace}">${esc(item.action_label)} →</a>`;
      return `<tr>
        <td>${item.image_url ? `<img class="kir-action-thumb" src="${esc(item.image_url)}" alt="" loading="lazy">` : ''}<strong>${esc(title)}</strong>${item.supplier_product_id ? `<small>${esc(item.supplier_product_id)}</small>` : ''}</td>
        <td>${esc(item.reason)}</td>
        <td>${control}</td>
      </tr>`;
    }).join('');
    return drillHeader(
      run,
      count > 0 ? `Action requise · ${count}` : 'Action requise',
      count > 0
        ? 'Uniquement ce que Komerce ne peut pas résoudre seul. Le cockpit se met à jour dès que la vérité change.'
        : 'Komerce travaille seul. Aucune intervention n’est nécessaire.'
    ) + (rows
      ? `<div class="kir-table-wrap"><table class="kir-table" data-action-list>
          <thead><tr><th>Produit</th><th>Pourquoi</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kir-empty">Aucune action requise.</div>');
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

  function stateWords(status) {
    return ({ COMPLETED:['completed', '✓ Terminé'], RUNNING:['running', 'En cours'], FAILED:['failed', 'Bloqué'] })[status] || ['pending', 'En attente'];
  }

  function statusRow(label, [state, text], hint = '') {
    return `<div class="kir-simple-row is-${state}"><span class="kir-simple-dot"></span><div><strong>${esc(label)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</div><em>${esc(text)}</em></div>`;
  }

  // Source : la source utilisée, pas un catalogue de produits.
  function renderSourceView(run, sourceControls) {
    const source = sourceForRun(run, sourceControls);
    const stage = (run.stages || []).find(item => item.key === 'SOURCE_CONNECTED') || {};
    const [state, text] = stateWords(stage.status);
    const auto = source ? (source.autopilot_enabled === true ? 'Activé (ON)' : 'Arrêté (OFF)') : '—';
    const last = source?.last_capture_at ? fmtDate(source.last_capture_at) : 'Aucune interrogation enregistrée';
    const blocker = source && source.autopilot_enabled !== true && source.blocker ? source.blocker : '';
    return drillHeader(run, 'Source', 'La source utilisée par ce lot.') + `<div class="kir-simple-list">
      ${statusRow('Source utilisée', [state, run.provider || source?.label || 'Source'])}
      ${statusRow('Connexion', [state, state === 'completed' ? 'Connectée' : text])}
      ${statusRow('Dernière interrogation', ['completed', last])}
      ${statusRow('Alimentation automatique', [source?.autopilot_enabled === true ? 'completed' : 'pending', auto])}
      ${blocker ? statusRow('Blocage', ['failed', blocker]) : ''}
    </div>`;
  }

  // Contrôle automatique : trois étapes en langage humain ; les étapes du moteur restent derrière un lien.
  const CONTROL_HUMAN = Object.freeze([
    { key:'REFINERY', label:'Préparation', hint:'Nettoyage et mise en forme des produits reçus' },
    { key:'TAXONOMY', label:'Classement', hint:'Rangement de chaque produit dans la bonne catégorie' },
    { key:'CERTIFICATION', label:'Validation', hint:'Vérification que chaque produit est complet et conforme' },
  ]);

  function renderControlView(run) {
    const byKey = new Map((run.stages || []).map(stage => [stage.key, stage]));
    const rows = CONTROL_HUMAN.map((def, index) => {
      const stage = byKey.get(def.key) || {};
      const prev = index > 0 ? byKey.get(CONTROL_HUMAN[index - 1].key) : null;
      let words = stateWords(stage.status);
      let hint = def.hint;
      if (stage.status === 'RUNNING' && stage.total > 0 && stage.processed < stage.total) hint = `${def.hint} · ${num(stage.processed)} / ${num(stage.total)}`;
      if ((stage.status || 'PENDING') === 'PENDING' && prev && prev.status !== 'COMPLETED') hint = 'Attend la fin de l’étape précédente';
      if (num(run.accounting?.action_required) > 0 && stage.status === 'FAILED') words = ['attention', 'Action requise'];
      return statusRow(def.label, words, hint);
    }).join('');
    return drillHeader(run, 'Contrôle automatique', 'Ce que Komerce vérifie seul avant de proposer les produits au Catalogue.')
      + `<div class="kir-simple-list">${rows}</div>
      <p class="kir-technical-link"><a href="${technicalUrl(run.run_ref, 'control')}" data-cockpit-nav>Voir le détail technique →</a></p>`;
  }

  function populationRows(population) {
    const items = Array.isArray(population?.items) ? population.items : [];
    return items.map(item => {
      const title = item.product_name || item.supplier_product_id || 'Produit sans titre';
      return `<tr data-population-item>
        <td>${item.image_url ? `<img class="kir-action-thumb" src="${esc(item.image_url)}" alt="" loading="lazy">` : '<span class="kir-action-thumb is-empty"></span>'}<strong>${esc(title)}</strong></td>
        <td>${esc(item.supplier_product_id || '—')}</td>
        <td><span class="kir-issue is-${esc(item.issue_key || 'control')}">${esc(item.issue_label || '—')}</span>${item.reason ? `<small>${esc(item.reason)}</small>` : ''}</td>
      </tr>`;
    }).join('');
  }

  const POPULATION_COPY = Object.freeze({
    received: ['Produits reçus', 'Les produits envoyés par la source pour ce lot et leur situation actuelle. Consultation : aucune action n’est nécessaire.', 'Situation'],
    ready: ['Prêts pour le Catalogue', 'Exactement les produits validés côté Sourcing et leur état de remise au Catalogue.', 'Remise'],
    discarded: ['Écartés automatiquement', 'Issues normales et auditables : un produit correctement écarté n’est pas une erreur.', 'Motif'],
  });

  function renderPopulation(run, population, kind) {
    const [title, copy, issueHead] = POPULATION_COPY[kind] || POPULATION_COPY.received;
    if (!population || population.kind !== kind) {
      return drillHeader(run, title, copy) + '<div class="kir-empty">Chargement des produits…</div>';
    }
    const rows = populationRows(population);
    const unlisted = Array.isArray(population.unlisted) ? population.unlisted : [];
    const extra = unlisted.map(group => `<tr class="is-group" data-population-group><td colspan="2"><strong>${num(group.count)} × ${esc(group.label)}</strong></td><td><small>Comptés à la réception, sans fiche produit</small></td></tr>`).join('');
    return drillHeader(run, `${title} · ${num(population.total)}`, copy)
      + (rows || extra
        ? `<div class="kir-table-wrap"><table class="kir-table" data-population-list="${esc(kind)}">
            <thead><tr><th>Produit</th><th>Identifiant source</th><th>${esc(issueHead)}</th></tr></thead><tbody>${rows}${extra}</tbody></table></div>`
        : '<div class="kir-empty">Aucun produit dans cette population.</div>');
  }

  // Catalogue : uniquement la frontière Sourcing → Catalogue (ni prix, ni marché, ni vente).
  function renderHandoffView(run, population) {
    const h = sourcingOutcome(run).handoff;
    const status = !h.controlDone || h.certified === 0 ? 'Rien n’est encore prêt à remettre'
      : h.complete ? '✓ Remise terminée'
        : h.catalogued === 0 ? 'En attente de remise'
          : `${h.remaining} ${h.remaining > 1 ? 'restent' : 'reste'} à remettre`;
    const list = population && population.kind === 'ready' && population.items?.length
      ? `<div class="kir-table-wrap"><table class="kir-table" data-population-list="ready">
          <thead><tr><th>Produit</th><th>Identifiant source</th><th>Remise</th></tr></thead><tbody>${populationRows(population)}</tbody></table></div>`
      : '';
    return drillHeader(run, 'Catalogue', 'La frontière Sourcing → Catalogue : où en est la remise des produits prêts.')
      + `<div class="kir-simple-list">${statusRow('Passage au Catalogue', [h.complete ? 'completed' : 'pending', status])}</div>${list}`;
  }

  // Détail technique : preuve / diagnostic. Volontairement hors du parcours métier.
  function renderHistory(run) {
    const stages = Array.isArray(run.stages) ? run.stages : [];
    const events = Array.isArray(run.events) ? run.events : [];
    const { from } = params();
    const selectedStage = new URLSearchParams(global.location.search).get('stage');
    const selectedLabel = selectedStage ? (selectedStage === 'CONTROL' ? 'Contrôle automatique' : stageLabel(selectedStage)) : null;
    const inSelection = key => !selectedStage || selectedStage === key || (selectedStage === 'CONTROL' && CONTROL_STAGES.includes(key));
    const back = from === 'control' ? { href:urlFor(run.run_ref, 'control'), label:'← Retour au contrôle automatique' } : null;
    // Jamais « COMPLETED · 0 / 12 » : un ratio n'est montré que pendant le travail ; une étape terminée dit « Terminé ».
    const stageText = stage => stage.status === 'COMPLETED' ? '✓ Terminé'
      : stage.status === 'RUNNING' && stage.reason === 'awaiting_explicit_operator_promotion' ? 'En attente de remise'
      : stage.status === 'RUNNING' ? `En cours · ${num(stage.processed)} / ${num(stage.total)}`
        : stage.status === 'FAILED' ? 'Bloqué' : 'En attente';
    return drillHeader(
      run,
      selectedLabel ? `Détail technique — ${selectedLabel}` : 'Détail technique du passage',
      'Preuve du parcours automatique, pour le diagnostic et l’audit. Cette information n’indique jamais quoi faire.',
      back
    ) + `
      <section class="kir-history-stages">
        ${stages.map(stage => `<a class="kir-history-stage ${selectedStage && inSelection(stage.key) ? 'is-selected' : ''}" href="${stageUrl(run.run_ref, stage.key)}" data-cockpit-nav>
          <span class="kir-history-dot is-${stage.status === 'COMPLETED' ? 'done' : stage.status === 'FAILED' ? 'failed' : 'pending'}"></span>
          <div><strong>${esc(stageLabel(stage.key))}</strong><small>${esc(stageText(stage))}</small></div>
        </a>`).join('')}
      </section>
      <div class="kir-history-events">
        ${events.length ? events
          .filter(event => inSelection(event.stage))
          .map(event => `<div><time>${fmtDate(event.at)}</time><span>${esc(liveEventLabel(event))}</span></div>`).join('') : '<div class="kir-empty">Aucun événement enregistré.</div>'}
      </div>`;
  }

  function renderBody(run, view, lots, ctx = {}) {
    if (view === 'population') return renderPopulation(run, ctx.population, ctx.kind);
    if (view === 'source') return renderSourceView(run, ctx.sourceControls);
    if (view === 'control') return renderControlView(run);
    if (view === 'handoff') return renderHandoffView(run, ctx.population);
    if (view === 'catalogue') return renderCatalogue(run);
    if (view === 'commercial') return renderCommercial(run);
    if (view === 'exceptions') return renderExceptions(run);
    if (view === 'history') return renderHistory(run);
    if (view === 'registry') return renderRegistry(run, lots);
    if (view === 'closure') return renderClosure(run);
    return renderDecisions(run);
  }

  function render(root, payload) {
    const sourceControls = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const lots = Array.isArray(payload?.lots) ? payload.lots : [];
    const run = payload?.selected || null;
    const { view, kind } = params();
    root.className = 'kmc-import-runtime kmc-domain-cockpit';
    root.setAttribute?.('data-cockpit-pattern', 'v1');
    root.setAttribute?.('data-cockpit-domain', 'imports');
    root.setAttribute?.('data-cockpit-language', 'live-ops');

    if (!run) {
      root.innerHTML = `<section class="kir-page">
        <header class="kir-hero"><div><span class="kir-eyebrow">OPÉRATIONS · IMPORTS</span><h1>Cockpit des imports</h1><p>Pilotez les sources et suivez chaque lot de bout en bout.</p></div></header>
        ${sourceControlStrip(sourceControls)}
        ${activationStrip(sourceControls)}
        ${lotStrip(lots, null)}
      </section>`;
      bindNavigation(root);
      bindSourceControls(root, payload);
      return;
    }

    const lot = run.business || {};
    root.innerHTML = `<section class="kir-page">
      <header class="kir-hero kir-live-hero">
        <div>
          <div class="kir-live-titleline"><span class="kir-eyebrow">OPÉRATIONS · SOURCING</span></div>
          <div class="kir-live-titlerow"><h1>Suivi d’import — Source → Catalogue</h1><span class="kir-live-badge ${run.status === 'RUNNING' ? 'is-live' : ''}">${run.status === 'RUNNING' ? 'LIVE' : 'RUN'}</span></div>
          <p>${esc(run.run_ref)} · ${esc(run.provider || 'Source')} · ${num(run.accounting?.source_total)} entrée(s)</p>
        </div>
        <div class="kir-hero-actions kir-live-hero-actions">
          <div class="kir-live-time"><span>Démarré ${fmtDate(run.started_at)}</span><strong>${elapsedLabel(run.started_at, run.finished_at)}</strong></div>
          <span class="kir-status-large is-${sourcingStatusView(run).tone}">${ico('clock')}${esc(sourcingStatusView(run).label)}</span>
          <a href="${withReturnTo('/admin/workspaces/catalog', urlFor(run.run_ref, view), 'Retour au lot')}" class="kir-global-link">Catalogue →</a>
        </div>
      </header>

      ${commandBar(run, sourceControls)}
      ${persistentRunFlow(run, sourceControls)}
      ${runTruthStrip(run)}
      ${catalogueHandoff(run)}
      ${activationState ? '' : runProgressRow(run)}
      ${view === 'overview' ? renderLiveCore(run) : ''}

      <div class="kir-secondary" data-cockpit-zone="secondary">
      ${sourceControlStrip(sourceControls, run)}
      ${lotStrip(lots, run.run_ref)}
      </div>

      <main class="kir-main">${renderBody(run, view, lots, { population:payload?.population || null, kind, sourceControls })}</main>
    </section>`;
    bindNavigation(root);
    bindSourceControls(root, payload);
    bindActionList(root);
    focusDrill(root);
  }

  function renderLoading(root) {
    root.className = 'kmc-import-runtime kmc-domain-cockpit';
    root.setAttribute?.('data-cockpit-pattern', 'v1');
    root.setAttribute?.('data-cockpit-domain', 'imports');
    root.setAttribute?.('data-cockpit-language', 'live-ops');
    root.innerHTML = `<section class="kir-page kir-loading">
      <div class="kir-skeleton kir-skeleton-title"></div>
      <div class="kir-skeleton kir-skeleton-lots"></div>
      <div class="kir-skeleton kir-skeleton-summary"></div>
      <div class="kir-skeleton kir-skeleton-main"></div>
    </section>`;
  }

  // Même mécanique que l'interrupteur historique : activer = activationState + polling live,
  // désactiver = POST deactivate. Les boutons Redémarrer / Arrêter l'appellent tel quel.
  async function toggleSource(root, payload, sourceRef, enabled, button) {
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
      const certificationIncomplete = !enabled
        && error.code === 'sourcing_source_certification_incomplete';
      if ((emptyPass || certificationIncomplete) && activationState?.sourceRef === sourceRef) {
        activationState.runRef = error.details?.run_ref || activationState.runRef;
        activationState.outcome = emptyPass ? 'empty' : 'certification_incomplete';
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
  }

  // Mettre à jour maintenant : réinterroge la source (endpoint existant import-now).
  async function updateSourceNow(root, sourceRef) {
    commandState = { sourceRef, action:'update' };
    if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
    const poll = typeof global.setInterval === 'function'
      ? global.setInterval(() => { refresh({ preserve:true }); }, COMMAND_POLL_MS) : null;
    try {
      await api(`/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/import-now`, { method:'POST', body:{} });
    } catch (error) {
      const main = root.querySelector?.('.kir-main');
      if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Mise à jour · ${esc(error.message)}</div>`);
    } finally {
      if (poll && typeof global.clearInterval === 'function') global.clearInterval(poll);
      commandState = null;
      await refresh({ preserve:true });
    }
  }

  function bindSourceControls(root, payload) {
    root.querySelectorAll?.('[data-source-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const sourceRef = button.getAttribute('data-source-ref');
        if (!sourceRef || button.disabled) return;
        toggleSource(root, payload, sourceRef, button.getAttribute('data-source-enabled') === '1', button);
      });
    });
    root.querySelectorAll?.('[data-source-command]').forEach(button => {
      button.addEventListener('click', async () => {
        const sourceRef = button.getAttribute('data-source-ref');
        const command = button.getAttribute('data-source-command');
        if (!sourceRef || button.disabled) return;
        if (command === 'update') return updateSourceNow(root, sourceRef);
        if (command === 'restart') return toggleSource(root, payload, sourceRef, false, button);
        if (command === 'stop') {
          commandState = { sourceRef, action:'stop' };
          if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
          try { await toggleSource(root, payload, sourceRef, true, button); }
          finally { commandState = null; if (mountedRoot && lastPayload) render(mountedRoot, lastPayload); }
        }
      });
    });
  }
  // « Choisir » : le classement se règle sur place avec l'endpoint candidat existant ; la projection
  // est ensuite relue (le compteur baisse sans rafraîchir la page).
  function bindActionList(root) {
    root.querySelectorAll?.('[data-action-choose]').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.getAttribute('data-candidate-ref');
        if (!ref || button.disabled) return;
        const category = global.prompt ? global.prompt('Catégorie Komerce pour ce produit', '') : null;
        if (category == null || !String(category).trim()) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
          await api(`/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(ref)}/update`, { method:'POST', body:{ komerce_category:String(category).trim() } });
          await refresh({ preserve:true });
        } catch (error) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          const main = root.querySelector?.('.kir-main');
          if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Action · ${esc(error.message)}</div>`);
        }
      });
    });
  }

  // Un clic sur une carte / une étape doit amener directement à la réponse, pas laisser l'utilisateur en haut de page.
  let scrollToDrill = false;
  function focusDrill(root) {
    if (!scrollToDrill) return;
    scrollToDrill = false;
    const head = root.querySelector?.('.kir-drill-head');
    if (head && typeof head.scrollIntoView === 'function') head.scrollIntoView({ block:'start' });
    else if (!head && typeof global.scrollTo === 'function') global.scrollTo(0, 0);
  }

  function bindNavigation(root) {
    root.querySelectorAll?.('[data-cockpit-nav]').forEach(link => {
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (!href) return;
        global.history.pushState({}, '', href);
        scrollToDrill = true;
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
      // Les populations (produits qui composent un chiffre) sont lues à la demande, à chaque rafraîchissement.
      const populationKind = view === 'population' ? params().kind : view === 'handoff' ? 'ready' : null;
      if (populationKind && payload?.selected?.run_ref) {
        try {
          payload.population = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(payload.selected.run_ref)}/population?kind=${populationKind}`);
        } catch (_) { payload.population = null; }
      }
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
    // Retour sur l'onglet après une correction ailleurs : la vérité est relue immédiatement.
    global.addEventListener?.('focus', () => refresh({ preserve:true }), { once:false });
    global.document?.addEventListener?.('visibilitychange', () => {
      if (global.document.visibilityState === 'visible') refresh({ preserve:true });
    }, { once:false });
    await refresh({ preserve:true });
    timer = setInterval(() => refresh({ preserve:true }), POLL_MS);
  }

  global.KomerceCanonicalImportRuntime = Object.freeze({ mount, render, businessLabel, urlFor, withReturnTo });
})(typeof window !== 'undefined' ? window : globalThis);
