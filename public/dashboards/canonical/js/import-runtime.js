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
  // Une vue = une question. Live / Passages / Sources sont les trois vues du domaine ; les autres sont des
  // vues secondaires du lot courant. Une vue remplace la précédente, elle ne s'empile jamais dessous.
  const VIEWS = new Set(['overview', 'exceptions', 'history', 'population', 'item', 'source', 'control', 'handoff', 'passages', 'sources']);
  const LEGACY_VIEWS = Object.freeze({ registry:'passages' });
  const POPULATION_KINDS = Object.freeze(['received', 'ready', 'deferred', 'discarded']);
  let timer = null;
  // Écouteurs fenêtre / document : un seul jeu actif, retiré avant chaque montage (LIVE-01).
  let detachListeners = [];
  function releaseListeners() {
    detachListeners.forEach(fn => { try { fn(); } catch (_) { /* déjà retiré */ } });
    detachListeners = [];
    if (timer) clearInterval(timer);
    timer = null;
  }
  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    detachListeners.push(() => target.removeEventListener?.(type, handler));
  }
  let activationTimer = null;
  let activationState = null;
  let commandState = null;
  let categoryDialogState = null;
  // Premier import ponctuel : distinct de l'activation de l'alimentation automatique.
  let firstImportState = null;
  let prepareState = null;
  let wizardState = null;
  // Gestion d'une source : renommage ou confirmation d'archivage en cours (une seule à la fois).
  let manageState = null;
  // Identifiants : jamais de valeur secrète en mémoire JS. Seul l'état d'affichage est gardé ;
  // les champs sont lus dans le DOM au moment de l'envoi puis vidés.
  let credentialsState = null;
  let mountedRoot = null;
  let lastPayload = null;
  // Les refresh de navigation sont séquencés : seule la lecture la plus récente,
  // pour l'URL toujours affichée, peut publier un payload. Le polling d'activation
  // garde seulement son URL de départ afin de ne pas annuler un refresh de détail.
  let refreshEpoch = 0;

  function currentRouteKey() {
    return `${global.location?.pathname || ''}${global.location?.search || ''}`;
  }

  function beginRefreshRead() {
    return { id: ++refreshEpoch, route:currentRouteKey() };
  }

  function refreshStillCurrent(token) {
    return Boolean(token) && token.id === refreshEpoch && token.route === currentRouteKey();
  }

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
    { key:'CATALOGUE', label:'Remise au Catalogue', stages:['CATALOGUE'], drill:'CATALOGUE' },
  ]);
  const USER_STAGE_LABELS = Object.freeze({
    SOURCE_CONNECTED:'Source', RAW_IMPORT:'Produits reçus',
    REFINERY:'Contrôle automatique', TAXONOMY:'Contrôle automatique', CERTIFICATION:'Contrôle automatique',
    CATALOGUE:'Remise au Catalogue', CONTROL:'Contrôle automatique',
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
  // « Résultat du passage »). Vert = terminé · bleu = travaille · orange = intervention humaine
  // attendue · rouge = Komerce ne peut plus avancer.
  function userSteps(stages, { runStatus = null, accounting = null } = {}) {
    const byKey = new Map((stages || []).map(stage => [stage.key, stage]));
    const handoff = handoffFacts(stages, accounting);
    // Une tâche humaine ouverte ne réécrit pas l'état d'un contrôle automatique.
    // Les corrections restent dans le compteur « Action requise » (hors des 4 étapes).
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
            : anyRunning ? 'running'
              : 'pending';
      } else if (def.key === 'CONTROL') {
        // Le parcours technique a sa propre vérité : les tâches humaines peuvent
        // rester ouvertes APRÈS la fin de ce contrôle et du handoff Catalogue.
        state = anyFailed ? 'failed'
          : anyRunning ? 'running'
            : allDone ? 'completed'
              : someDone && live ? 'running'
                : 'pending';
      } else {
        state = anyFailed ? 'failed' : allDone ? 'completed' : anyRunning || (someDone && live) ? 'running' : 'pending';
      }
      const words = def.key === 'SOURCE'
        ? { completed:'Connectée', running:'Connexion…', pending:'En attente', failed:'Bloquée' }
        : def.key === 'CATALOGUE'
          ? { completed:handoff.certified === 0 ? 'Aucun produit à remettre' : 'Remise terminée', running:'Remise automatique', pending:'En attente', failed:'Bloqué' }
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
    return run?.status === 'COMPLETED' && catalogue.status === 'COMPLETED';
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
    const catalogueHandoffPending = stages.some(stage => stage.key === 'CATALOGUE'
      && stage.reason === 'automatic_catalogue_handoff_pending');
    const title = failed
      ? 'Passage interrompu'
      : noResult
        ? 'Passage terminé sans résultat'
        : catalogueHandoffPending
          ? 'Remise au Catalogue en cours'
          : automaticDone || providerGateBlocked
            ? 'Import automatique terminé'
            : activationState.done ? 'Premier passage terminé' : 'Passage en direct';
    const helper = failed
      ? (activationState.error || 'Le premier passage automatique a échoué.')
      : noResult
        ? `${label} · ${activationState.runRef || 'nouveau passage'} · aucun produit exploitable`
        : providerGateBlocked
          ? `${label} · alimentation automatique arrêtée`
          : catalogueHandoffPending
            ? `${label} · création automatique des brouillons Catalogue`
            : automaticDone
              ? `${label} · le traitement automatique a atteint le Catalogue`
              : activationState.runRef
                ? `${label} · ${activationState.runRef} · le même passage avance de bout en bout`
                : `${label} · préparation de la source et création du premier passage`;
    const tone = failed ? 'is-failed'
      : noResult ? 'is-empty'
        : catalogueHandoffPending ? 'is-live'
          : automaticDone || providerGateBlocked || activationState.done
            ? 'is-complete'
            : 'is-live';
    return `<section class="kir-run-flow ${tone}" aria-live="polite">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU PASSAGE</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
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
    const catalogueHandoffPending = stages.some(stage => stage.key === 'CATALOGUE'
      && stage.reason === 'automatic_catalogue_handoff_pending');
    const automaticDone = stages
      .filter(stage => stage.key !== 'CATALOGUE')
      .every(stage => stage.status === 'COMPLETED');
    const title = failed
      ? 'Passage interrompu'
      : automaticDone && catalogueHandoffPending
        ? 'Remise au Catalogue en cours'
        : run.status === 'COMPLETED'
          ? 'Traitement des produits terminé'
          : 'Passage en cours';
    const helper = failed
      ? (run.failure_reason || 'Une étape du passage est bloquée.')
      : catalogueHandoffPending
        ? `${run.run_ref} · création automatique des brouillons Catalogue`
        : `${run.run_ref} · ${run.provider || 'Source'} · parcours conservé à l’écran`;
    const tone = failed ? 'is-failed'
      : catalogueHandoffPending ? 'is-live'
        : run.status === 'COMPLETED' ? 'is-complete'
          : 'is-live';

    return `<section class="kir-run-flow ${tone}" aria-label="Parcours du passage ${esc(run.run_ref)}">
      <div class="kir-run-flow-head">
        <div><span class="kir-section-kicker">FLUX DU PASSAGE</span><strong>${esc(title)}</strong><small>${esc(helper)}</small></div>
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

  // Résultat du passage : cinq mesures serveur. Les actions sont un sous-ensemble
  // des populations, jamais un sixième groupe à additionner.
  function sourcingOutcome(run) {
    const a = run?.accounting || {};
    const stages = Array.isArray(run?.stages) ? run.stages : [];
    const raw = stages.find(stage => stage.key === 'RAW_IMPORT') || {};
    const h = handoffFacts(stages, a);
    return {
      received:num(a.source_total),
      ready:h.certified,
      deferred:num(a.deferred),
      deferredActionable:num(a.deferred_actionable),
      // Les décisions terminales DEFERRED restent dans leur population d'origine,
      // mais une décision WATCH à corriger peut aussi figurer dans « Action requise ».
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
      ['Retenus par Sourcing', o.ready, 'accepted', populationUrl(run.run_ref, 'ready'), 'is-delivered', 'qualifiés pour la suite'],
      // Quand chaque produit différé correspond à une action humaine identifiée, afficher
      // une seule liste opérateur ; conserver la population séparée dans les autres cas.
      ['Mis de côté', o.deferred, 'box', o.deferred > 0 && o.deferredActionable === o.deferred && o.actionRequired === o.deferred && (run.action_items || []).length === o.deferred && run.action_items.every(item => item.action_origin === 'deferred') ? urlFor(run.run_ref, 'exceptions') : populationUrl(run.run_ref, 'deferred'), 'is-deferred', o.deferredActionable ? `dont ${o.deferredActionable} à corriger` : 'non retenus pour ce passage'],
      ['Écartés automatiquement', o.discarded, 'reject', populationUrl(run.run_ref, 'discarded'), 'is-discarded', 'au contrôle de réception'],
      ['Action requise', o.actionRequired, 'alert', urlFor(run.run_ref, 'exceptions'), open ? 'is-review is-attention' : 'is-review', open ? 'Intervenir →' : 'rien à faire'],
    ];
    const proof = !o.rawDone || o.received === 0 ? ''
      : o.unaccounted > 0
        ? `<p class="kir-run-proof is-bad">${ico('alert')}${o.received - Math.min(o.received, o.unaccounted)}/${o.received} produits comptabilisés · ${o.unaccounted} produit${o.unaccounted > 1 ? 's' : ''} à retrouver</p>`
        : `<p class="kir-run-proof is-ok"><b aria-hidden="true">✓</b>${o.received}/${o.received} produits comptabilisés</p>`;
    return `<section class="kir-run-truth" aria-label="Résultat du passage">
      <div class="kir-run-truth-head"><span class="kir-section-kicker">RÉSULTAT DU PASSAGE</span>${proof}</div>
      <div class="kir-run-truth-grid is-five">${tiles.map(([label, value, icon, href, cls, sub]) =>
        `<a class="${cls}" href="${href}" data-cockpit-nav aria-label="${esc(label)} — ouvrir le détail">${ico(icon)}<span>${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small></a>`
      ).join('')}</div>
    </section>`;
  }

  // Passage au Catalogue : uniquement l'état de la remise (les chiffres sont déjà au résultat du passage).
  function catalogueHandoff(run) {
    const h = sourcingOutcome(run).handoff;
    if (!h.controlDone || h.certified === 0) return '';
    const state = h.complete ? 'is-clean' : 'is-waiting';
    const text = h.complete ? `Remise terminée · ${h.catalogued} produit${h.catalogued > 1 ? 's' : ''} remis au Catalogue`
      : h.catalogued === 0 ? 'Remise automatique en cours'
        : `${h.remaining} ${h.remaining > 1 ? 'restent' : 'reste'} à remettre automatiquement`;
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
    const routeAtStart = currentRouteKey();
    try {
      const { run } = params();
      const q = new URLSearchParams({ limit:'12' });
      if (run) q.set('run', run);
      const payload = await api('/api/admin/workspaces/sourcing/import-cockpit?' + q.toString());
      if (routeAtStart !== currentRouteKey()) return;
      attachActivationRun(payload);
      if (activationState.runRef) {
        activationState.run = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(activationState.runRef)}`);
        if (routeAtStart !== currentRouteKey()) return;
      }
      if (routeAtStart !== currentRouteKey()) return;
      if (activationState.runRef && params().run !== activationState.runRef) {
        global.history.pushState({}, '', urlFor(activationState.runRef));
      }
      lastPayload = payload;
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
    const rawView = query.get('view') || 'overview';
    // Historical handoff was a read-only duplicate of Catalogue. Preserve mock-only
    // technical fixtures, but make every real operator deep link land on Suivi.
    const requestedView = rawView === 'handoff' && global.__KOMERCE_LEGACY_PROOF__ !== true
      ? 'overview' : (LEGACY_VIEWS[rawView] || rawView);
    const kind = query.get('kind');
    return {
      run,
      view: VIEWS.has(requestedView) ? requestedView : 'overview',
      kind: POPULATION_KINDS.includes(kind) ? kind : 'received',
      item: query.get('item') || null,
      from: query.get('from') || null,
      origin: query.get('origin') || null,
      filters: {
        source: query.get('f_source') || '',
        state: query.get('f_state') || '',
        period: ['today', 'week'].includes(query.get('f_period')) ? query.get('f_period') : 'all',
        q: query.get('f_q') || '',
      },
      offset: Math.max(0, Number(query.get('offset')) || 0),
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
      DONE:{ label:'Traitement terminé', tone:'positive' },
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

  // Les filtres de Passages vivent dans l'URL : Back / Forward / rechargement les retrouvent.
  function passagesUrl(runRef, offset = 0, filters = null) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'passages');
    if (offset > 0) q.set('offset', String(offset));
    if (filters?.source) q.set('f_source', filters.source);
    if (filters?.state) q.set('f_state', filters.state);
    if (filters?.period && filters.period !== 'all') q.set('f_period', filters.period);
    if (filters?.q) q.set('f_q', filters.q);
    return '/admin/import-runtime?' + q.toString();
  }

  // Contexte d'origine d'un détail technique : il sert à savoir où revenir (contrôle, produit).
  function carryContext(q, ctx) {
    const c = typeof ctx === 'string' ? { from:ctx } : (ctx || {});
    if (!c.from) return;
    q.set('from', c.from);
    if (c.from === 'item') {
      if (c.item) q.set('item', c.item);
      if (c.kind) q.set('kind', c.kind);
      if (c.origin) q.set('origin', c.origin);
    }
  }

    function stageUrl(runRef, stageKey, ctx = null) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'history');
    if (stageKey) q.set('stage', stageKey);
    carryContext(q, ctx);
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

  // origin = 'handoff' quand le produit est ouvert depuis Remise au Catalogue (le retour y revient).
  function itemUrl(runRef, supplierProductId, kind = 'received', origin = null) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'item');
    q.set('kind', POPULATION_KINDS.includes(kind) ? kind : 'received');
    if (supplierProductId) q.set('item', supplierProductId);
    if (origin === 'handoff') q.set('origin', 'handoff');
    return '/admin/import-runtime?' + q.toString();
  }

  function drillUrl(runRef, drill) {
    if (drill === 'SOURCE_CONNECTED' || drill === 'SOURCE') return urlFor(runRef, 'source');
    if (drill === 'RAW_IMPORT') return populationUrl(runRef, 'received');
    if (drill === 'CONTROL') return urlFor(runRef, 'control');
    if (drill === 'CATALOGUE') return urlFor(runRef, 'handoff');
    return stageUrl(runRef, drill);
  }

  function technicalUrl(runRef, ctx = null) {
    const q = new URLSearchParams();
    if (runRef) q.set('run', runRef);
    q.set('view', 'history');
    carryContext(q, ctx);
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

  function withReturnTo(path, returnTo, label = 'Retour au suivi') {
    const separator = String(path || '').includes('?') ? '&' : '?';
    const q = new URLSearchParams();
    q.set('return_to', returnTo);
    q.set('return_label', label);
    return `${path}${separator}${q.toString()}`;
  }

  // Dernier passage d'une source : le passage affiché s'il lui appartient, sinon le plus récent
  // du même fournisseur (les passages n'exposent que le fournisseur). Jamais de donnée inventée.
  function lastRunOfSource(source, lots, selectedRun) {
    if (selectedRun?.source_ref && selectedRun.source_ref === source.source_ref) return selectedRun.run_ref;
    // History links must be backed by the exact source identity. No supplier-name fallback.
    const match = (Array.isArray(lots) ? lots : []).find(lot =>
      lot.source_ref && String(lot.source_ref) === String(source.source_ref));
    return match?.run_ref || null;
  }

  // Libellés des états canoniques calculés par le backend (projectSourceControl). Le frontend ne
  // recalcule jamais l'état : il le traduit. Un état inconnu est affiché BLOQUÉE (fail closed).
  const SOURCE_STATE_VIEW = Object.freeze({
    active:{ key:'active', label:'ACTIVE' },
    ready:{ key:'ready', label:'PRÊTE' },
    blocked:{ key:'blocked', label:'BLOQUÉE' },
    error:{ key:'error', label:'ERREUR' },
    to_configure:{ key:'blocked', label:'À CONFIGURER' },
    connection_to_test:{ key:'prep', label:'CONNEXION À TESTER' },
    to_certify:{ key:'prep', label:'À CERTIFIER' },
  });
  const SOURCE_STATE_REASONS = Object.freeze({
    to_configure:'Configurez la connexion fournisseur pour pouvoir tester la source.',
    connection_to_test:'Testez la connexion avant de préparer la source.',
    to_certify:'Préparez et certifiez la source pour pouvoir l’activer.',
    error:'Dernière capture fournisseur signalée en échec. Consultez le passage et ses preuves.',
  });

  // Lecture d'une source pour l'opérateur : badge, interrupteur et raison, issus de l'état backend.
  function sourceCardModel(source, selectedRun, lots) {
    const enabled = source.autopilot_enabled === true;
    const live = activationState?.sourceRef === source.source_ref ? activationState : null;
    const preparing = Boolean(prepareState && prepareState.sourceRef === source.source_ref);
    const firstImportPending = firstImportState?.sourceRef === source.source_ref && firstImportState.pending === true;
    const busy = Boolean(live && !live.done && !live.error) || preparing || firstImportPending;
    const selectedSourceMatches = selectedRun
      && String(selectedRun.source_ref || '') === String(source.source_ref || '');
    const providerGateBlocked = Boolean(
      (live && live.done && live.outcome === 'certification_incomplete')
      || (selectedSourceMatches && runtimeCertificationBlocked(selectedRun))
    );
    const displayEnabled = enabled;
    // L'interrupteur n'est actionnable que si le backend déclare la source prête (alignée sur
    // canRunAutomaticImport) ou déjà ON pour pouvoir l'arrêter.
    const canToggle = !busy && (enabled || source.autopilot_ready === true);
    const stateView = SOURCE_STATE_VIEW[source.state] || SOURCE_STATE_VIEW.blocked;
    let badge;
    if (providerGateBlocked && source.state !== 'error') badge = { key:'proof', label:'PREUVE À VÉRIFIER' };
    else if (busy) badge = { key:'prep', label:'PRÉPARATION' };
    else badge = stateView;
    const reason = providerGateBlocked
      ? `Passage ${selectedSourceMatches ? selectedRun.run_ref : live?.runRef || 'récent'} : preuve fournisseur non acquise. Consultez le diagnostic du passage.`
      : busy
        ? (live?.runRef ? `Passage ${live.runRef} en cours` : preparing ? 'Préparation : connexion fournisseur, premier passage, certification…' : 'Démarrage du premier import…')
        : source.state === 'blocked' || !SOURCE_STATE_VIEW[source.state]
          ? (source.blocker || 'Source non activable')
          : (SOURCE_STATE_REASONS[source.state] || '');
    const step = busy ? null
      : source.state === 'connection_to_test' ? { action:'test', label:'Tester la connexion' }
        : source.state === 'to_certify' ? { action:'prepare', label:'Préparer et certifier' }
          : null;
    const lastRun = lastRunOfSource(source, lots, selectedRun);
    return {
      enabled, displayEnabled, canToggle, busy, badge, reason, step, providerGateBlocked,
      name: source.label || source.supplier_name || source.source_ref,
      lastRun,
      canFirstImport: source.state === 'ready' && !enabled && (!busy || firstImportPending),
      firstImportPending,
    };
  }

  // Formulaire d'identifiants dérivé du contrat `auth` publié par le backend (registre des
  // connecteurs) : aucune branche par nom de fournisseur. Un secret n'est jamais relu ni
  // prérempli ; le champ est toujours vide à l'ouverture.
  function credentialFields(source) {
    const auth = source?.auth || {};
    if (!['api_key', 'client_credentials'].includes(auth.mode) || auth.scope !== 'source') return [];
    return Array.isArray(auth.fields) ? auth.fields.filter(field => field && field.key) : [];
  }

  function credentialsConfigured(source) {
    return !['missing', 'not_required'].includes(source?.credential_status || 'missing');
  }

  function onboardingRequirementLine(holder) {
    const onboarding = holder?.onboarding || {};
    if (onboarding.status === 'blocked') return 'Onboarding fournisseur à requalifier avant toute nouvelle connexion';
    if (holder?.onboarding_ready === false || onboarding.status === 'missing') {
      return 'Étude API requise avant toute demande d’identifiant';
    }
    const obtain = Array.isArray(onboarding.operator_must_obtain) ? onboarding.operator_must_obtain : [];
    const labels = obtain.map(item => item?.label).filter(Boolean);
    if (labels.length) return `À préparer : ${labels.join(' + ')}`;
    if (holder?.auth?.mode === 'oauth') return 'Autorisation du compte chez le fournisseur · aucun secret à transmettre';
    if (holder?.auth?.scope === 'platform') return 'Identifiants d’application gérés par Komerce';
    return 'Aucun identifiant à transmettre';
  }

  function onboardingGuidance(holder) {
    const onboarding = holder?.onboarding || {};
    if (!onboarding || onboarding.status !== 'defined') return '';
    const prerequisites = Array.isArray(onboarding.prerequisites) ? onboarding.prerequisites : [];
    const steps = Array.isArray(onboarding.setup_steps) ? onboarding.setup_steps : [];
    const forbidden = Array.isArray(onboarding.operator_must_not_request) ? onboarding.operator_must_not_request : [];
    const evidence = onboarding.evidence_url
      ? `<a class="kir-wizard-link" href="${esc(onboarding.evidence_url)}" target="_blank" rel="noopener noreferrer" data-provider-documentation>Documentation fournisseur ↗</a>`
      : '';
    return `<div class="kir-onboarding-guidance" data-onboarding-guidance>
      <strong>Avant de connecter</strong>
      ${prerequisites.length ? `<p>${esc(prerequisites.join(' · '))}</p>` : ''}
      ${steps.length ? `<ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}
      ${forbidden.length ? `<p class="kir-wizard-note"><strong>Ne pas demander :</strong> ${esc(forbidden.join(' · '))}</p>` : ''}
      ${onboarding.completion ? `<p class="kir-wizard-note">${esc(onboarding.completion)}</p>` : ''}
      ${evidence}
    </div>`;
  }

  function credentialsPanel(source, { context = 'card' } = {}) {
    const fields = credentialFields(source);
    if (!fields.length) return '';
    const ref = source.source_ref;
    if (source?.onboarding_ready === false) {
      const blocker = source?.onboarding?.blocker || 'Le contrat d’onboarding fournisseur doit être requalifié avant de collecter de nouveaux identifiants.';
      const evidence = source?.onboarding?.evidence_url
        ? `<a class="kir-wizard-link" href="${esc(source.onboarding.evidence_url)}" target="_blank" rel="noopener noreferrer" data-provider-documentation>Documentation fournisseur ↗</a>`
        : '';
      return `<section class="kir-credentials" data-credentials-panel="${esc(ref)}" data-credentials-context="${context}">
        <p class="kir-credentials-status">ONBOARDING À REQUALIFIER</p>
        <p class="kir-wizard-note" data-onboarding-blocker>${esc(blocker)}</p>
        ${evidence}
      </section>`;
    }
    const st = credentialsState && credentialsState.ref === ref ? credentialsState : null;
    const configured = credentialsConfigured(source);
    const open = !configured || Boolean(st?.open);
    const saving = Boolean(st?.saving);
    const inVault = source.credential_in_vault === true;
    const notice = st?.error
      ? `<p class="kir-wizard-error" role="alert" data-credentials-error>${esc(st.error)}</p>`
      : st?.notice ? `<p class="kir-wizard-ok" data-credentials-notice>${esc(st.notice)}</p>` : '';
    const status = `<p class="kir-credentials-status" data-credentials-status>${configured ? 'Configurée' : 'À configurer'}</p>`;
    if (!open) {
      return `<section class="kir-credentials" data-credentials-panel="${esc(ref)}" data-credentials-context="${context}">
        ${status}${notice}
        <button type="button" class="kir-wizard-secondary" data-credentials-open data-source-ref="${esc(ref)}">Modifier les identifiants</button>
      </section>`;
    }
    const inputs = fields.map(field => `<label class="kir-wizard-field">${esc(field.label || field.key)}
        <input type="${field.secret ? 'password' : 'text'}" data-credential-field="${esc(field.key)}" value=""
          autocomplete="${field.secret ? 'new-password' : 'off'}" autocapitalize="off" spellcheck="false" maxlength="4096" required ${saving ? 'disabled' : ''}>
      </label>`).join('');
    const submitLabel = saving ? 'Enregistrement…' : (configured ? 'Remplacer et tester' : 'Configurer la connexion');
    const guidance = onboardingGuidance(source);
    return `<section class="kir-credentials" data-credentials-panel="${esc(ref)}" data-credentials-context="${context}">
      ${status}${notice}
      ${guidance}
      <form class="kir-credentials-form" data-credentials-form data-source-ref="${esc(ref)}" data-credentials-mode="${inVault ? 'rotate' : 'configure'}" autocomplete="off">
        ${inputs}
        <p class="kir-wizard-note">Les identifiants sont chiffrés côté serveur et ne sont plus jamais affichés.</p>
        <button type="submit" class="kir-wizard-primary" ${saving ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button>
        ${configured ? `<button type="button" class="kir-wizard-secondary" data-credentials-cancel data-source-ref="${esc(ref)}" ${saving ? 'disabled' : ''}>Annuler</button>` : ''}
      </form>
    </section>`;
  }

  async function submitCredentials(form) {
    const ref = form.getAttribute('data-source-ref');
    const mode = form.getAttribute('data-credentials-mode') === 'rotate' ? 'rotate' : 'configure';
    const credentials = {};
    form.querySelectorAll('[data-credential-field]').forEach(input => {
      credentials[input.getAttribute('data-credential-field')] = String(input.value || '').trim();
      input.value = '';
    });
    credentialsState = { ref, open:true, saving:true, error:null, notice:null };
    rerenderWizard();
    try {
      const path = mode === 'rotate' ? 'credentials/rotate' : 'credentials';
      const response = await api(`${WIZARD_BASE}/${encodeURIComponent(ref)}/${path}`, { method:'POST', body:{ credentials } });
      const result = response?.result || {};
      if (mode === 'rotate' && result.ok === false) {
        // Remplacement refusé : l'ancienne connexion reste active, le formulaire reste ouvert (vide).
        credentialsState = { ref, open:true, saving:false, error:result.message || 'Identifiants refusés.', notice:null };
      } else {
        credentialsState = { ref, open:false, saving:false, error:null, notice:mode === 'rotate' ? '✓ Connexion valide' : 'Identifiants enregistrés.' };
      }
    } catch (error) {
      credentialsState = { ref, open:true, saving:false, error:error.message, notice:null };
    } finally {
      Object.keys(credentials).forEach(key => { credentials[key] = ''; });
    }
    await refresh({ preserve:true });
    rerenderWizard();
  }

  function bindCredentials(root) {
    root.querySelectorAll?.('[data-credentials-open]').forEach(button => button.addEventListener('click', () => {
      credentialsState = { ref:button.getAttribute('data-source-ref'), open:true, saving:false, error:null, notice:null };
      rerenderWizard();
    }));
    root.querySelectorAll?.('[data-credentials-cancel]').forEach(button => button.addEventListener('click', () => {
      credentialsState = null;
      rerenderWizard();
    }));
    root.querySelectorAll?.('[data-credentials-form]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      if (credentialsState?.saving) return;
      submitCredentials(form);
    }));
  }

  function sourceCard(source, selectedRun, lots) {
    const m = sourceCardModel(source, selectedRun, lots);
    const prepared = source.last_capture_at ? fmtDate(source.last_capture_at) : 'Jamais';
    const cert = source.production_runtime_certified ? 'Certifiée (historique)' : 'À certifier';
    const connection = source.connection?.verified ? 'Connectée ✓' : source.state === 'to_configure' ? 'À configurer' : 'À tester';
    const name = esc(m.name);
    const renaming = manageState?.kind === 'rename' && manageState.ref === source.source_ref;
    const archiving = manageState?.kind === 'archive' && manageState.ref === source.source_ref;
    const title = renaming
      ? `<form class="kir-manage-form" data-manage-form="rename-source" data-source-ref="${esc(source.source_ref)}">
          <input type="text" data-manage-input maxlength="80" value="${esc(manageState.value)}" aria-label="Nom de la source" required>
          <button type="submit" class="kir-wizard-primary">Enregistrer</button>
          <button type="button" class="kir-wizard-secondary" data-manage-cancel>Annuler</button>
        </form>`
      : `<h3>${name}</h3>`;
    const menu = m.busy || renaming ? '' : `<details class="kir-source-menu" data-source-menu>
        <summary aria-label="Gérer la source ${name}">⋯</summary>
        <div class="kir-source-menu-list">
          <button type="button" data-manage-rename data-source-ref="${esc(source.source_ref)}">Renommer</button>
          <button type="button" data-manage-archive data-source-ref="${esc(source.source_ref)}">Archiver</button>
        </div></details>`;
    const archiveBox = archiving
      ? `<div class="kir-manage-confirm" role="alertdialog" data-archive-confirm>
          <p>Archiver cette source ? ${m.enabled ? 'L’alimentation automatique sera arrêtée. ' : ''}L’historique des passages est conservé et la source reste restaurable.</p>
          <button type="button" class="kir-wizard-primary" data-manage-archive-confirm data-source-ref="${esc(source.source_ref)}">Archiver</button>
          <button type="button" class="kir-wizard-secondary" data-manage-cancel>Annuler</button>
        </div>` : '';
    return `<article class="kir-source-card is-${m.badge.key}${m.busy ? ' is-busy' : ''}" data-source-card="${esc(source.source_ref)}" tabindex="-1">
      <header class="kir-source-card-head">
        ${title}
        <span class="kir-source-badge is-${m.badge.key}">${m.badge.key === 'active' || m.busy ? '<i class="kir-source-dot" aria-hidden="true"></i>' : ''}${m.badge.label}</span>
        ${menu}
      </header>
      ${archiveBox}
      <div class="kir-source-autopilot">
        <div><strong>Alimentation automatique</strong><span class="kir-source-fact-label">${m.displayEnabled ? 'Active : le sourcing tourne seul' : 'Arrêtée : aucun import automatique'}</span></div>
        <button type="button"
          class="kir-source-switch is-${m.badge.key}"
          role="switch"
          aria-checked="${m.displayEnabled ? 'true' : 'false'}"
          aria-label="${m.enabled ? 'Désactiver' : 'Activer'} le sourcing automatique ${name}"
          data-source-toggle
          data-source-ref="${esc(source.source_ref)}"
          data-source-enabled="${m.enabled ? '1' : '0'}"
          ${m.busy ? 'aria-busy="true"' : ''}
          ${m.canToggle ? '' : 'disabled'}>
          <span class="kir-source-switch-label">${m.displayEnabled ? 'ON' : 'OFF'}</span>
          <span class="kir-source-switch-track" aria-hidden="true"><span class="kir-source-switch-knob"></span></span>
        </button>
      </div>
      <dl class="kir-source-facts">
        <div><dt>Connexion</dt><dd data-source-connection>${connection}</dd></div>
        <div><dt>Dernière préparation</dt><dd>${esc(prepared)}</dd></div>
        <div><dt>Dernier passage</dt><dd>${m.lastRun ? esc(m.lastRun) : 'Jamais'}</dd></div>
        <div><dt>Certification fournisseur</dt><dd>${esc(cert)}</dd></div>
        ${m.providerGateBlocked ? `<div class="kir-source-proof-status"><dt>Preuve du dernier passage</dt><dd>Non acquise · <a href="${urlFor(m.lastRun || selectedRun?.run_ref)}" data-cockpit-nav>Comprendre →</a></dd></div>` : ''}
      </dl>
      ${m.reason ? `<p class="kir-source-reason" data-source-reason>${esc(m.reason)}</p>` : ''}
      ${m.busy ? '' : credentialsPanel(source, { context:'card' })}
      ${m.step ? `<button type="button" class="kir-source-step" data-source-step="${m.step.action}" data-source-ref="${esc(source.source_ref)}">${m.step.label}</button>` : ''}
      ${m.canFirstImport ? `<button type="button" class="kir-source-first-import" data-source-first-import data-source-ref="${esc(source.source_ref)}" ${m.firstImportPending ? 'disabled aria-busy="true"' : ''}>${m.firstImportPending ? 'Lancement du passage…' : m.lastRun ? 'Lancer un nouveau passage' : 'Lancer le premier passage'}</button>` : ''}
      ${source.state === 'active' && !m.busy ? `<button type="button"
        class="kir-source-first-import" data-source-command="update"
        data-source-ref="${esc(source.source_ref)}"
        ${commandState?.sourceRef === source.source_ref ? 'disabled aria-busy="true"' : ''}>
        ${commandState?.sourceRef === source.source_ref ? 'Import en cours…' : 'Importer maintenant'}</button>` : ''}
      ${firstImportState?.sourceRef === source.source_ref && firstImportState.error ? `<p class="kir-source-first-error" role="alert">${esc(firstImportState.error)}</p>` : ''}
      ${m.lastRun ? `<a class="kir-source-follow" href="${urlFor(m.lastRun)}" data-cockpit-nav>Voir le suivi →</a>` : ''}
    </article>`;
  }

  // Fournisseur demandé sans connecteur : jamais une source (aucun interrupteur, aucun test).
  function sourceRequestCard(request) {
    const renaming = manageState?.kind === 'rename-request' && manageState.ref === request.request_ref;
    const removing = manageState?.kind === 'remove-request' && manageState.ref === request.request_ref;
    const title = renaming
      ? `<form class="kir-manage-form" data-manage-form="rename-request" data-request-ref="${esc(request.request_ref)}">
          <input type="text" data-manage-input maxlength="80" value="${esc(manageState.value)}" aria-label="Nom de la demande" required>
          <button type="submit" class="kir-wizard-primary">Enregistrer</button>
          <button type="button" class="kir-wizard-secondary" data-manage-cancel>Annuler</button>
        </form>`
      : `<h3>${esc(request.requested_label || request.provider_name)}</h3>`;
    const menu = renaming ? '' : `<details class="kir-source-menu" data-request-menu>
        <summary aria-label="Gérer la demande">⋯</summary>
        <div class="kir-source-menu-list">
          <button type="button" data-manage-rename-request data-request-ref="${esc(request.request_ref)}">Renommer</button>
          <button type="button" data-manage-remove-request data-request-ref="${esc(request.request_ref)}">Retirer</button>
        </div></details>`;
    const removeBox = removing
      ? `<div class="kir-manage-confirm" role="alertdialog" data-remove-confirm>
          <p>Retirer cette demande ? Aucune source n’existe pour ce fournisseur : rien d’autre n’est supprimé.</p>
          <button type="button" class="kir-wizard-primary" data-manage-remove-confirm data-request-ref="${esc(request.request_ref)}">Retirer</button>
          <button type="button" class="kir-wizard-secondary" data-manage-cancel>Annuler</button>
        </div>` : '';
    return `<article class="kir-source-card is-blocked" data-source-request-card="${esc(request.request_ref)}">
      <header class="kir-source-card-head">
        ${title}
        <span class="kir-source-badge is-blocked">CONNECTEUR REQUIS</span>
        ${menu}
      </header>
      ${removeBox}
      <dl class="kir-source-facts">
        <div><dt>Fournisseur</dt><dd>${esc(request.provider_name)}</dd></div>
        ${request.reference_url ? `<div><dt>Référence</dt><dd>${esc(request.reference_url)}</dd></div>` : ''}
      </dl>
      <p class="kir-source-reason" data-source-reason>Cette source est enregistrée mais ne peut pas encore alimenter Komerce automatiquement.</p>
    </article>`;
  }

  // Sources archivées : repliées, jamais comptées comme actives, restaurables.
  function archivedSourcesSection(archived) {
    if (!archived.length) return '';
    return `<details class="kir-sources-archived" data-sources-archived>
      <summary>Archivées (${archived.length})</summary>
      <ul>${archived.map(source => `<li data-archived-source="${esc(source.source_ref)}">
        <div><strong>${esc(source.label || source.source_ref)}</strong><span>Archivée · historique conservé</span></div>
        <button type="button" class="kir-wizard-secondary" data-manage-restore data-source-ref="${esc(source.source_ref)}">Restaurer</button>
      </li>`).join('')}</ul></details>`;
  }

  // Vue Sources : synthèse compacte + une carte opérateur par fournisseur (données de source_controls).
  function sourcesBoard(sourceControls, selectedRun = null, lots = [], requests = []) {
    const allSources = Array.isArray(sourceControls) ? sourceControls : [];
    const archived = allSources.filter(source => source.state === 'archived' || source.archived === true);
    const sources = allSources.filter(source => !archived.includes(source));
    const pending = Array.isArray(requests) ? requests : [];
    if (!sources.length && !pending.length && !archived.length) {
      return `<section class="kir-sources-empty"><strong>Aucune source récurrente configurée</strong>
        <span>Ajoutez un fournisseur pour alimenter automatiquement le Sourcing.</span></section>`;
    }
    const models = sources.map(source => sourceCardModel(source, selectedRun, lots));
    const count = key => sources.filter(source => source.state === key).length;
    const proofPending = models.filter(model => model.providerGateBlocked).length;
    const chips = [
      [sources.length, sources.length > 1 ? 'sources configurées' : 'source configurée', ''],
      [count('active'), count('active') > 1 ? 'actives' : 'active', 'is-active'],
      [count('ready'), count('ready') > 1 ? 'prêtes' : 'prête', 'is-ready'],
      [count('error'), 'en erreur', count('error') ? 'is-error' : ''],
    ];
    if (proofPending) chips.push([proofPending, 'preuve fournisseur à vérifier', 'is-proof']);
    if (count('blocked')) chips.push([count('blocked'), count('blocked') > 1 ? 'bloquées' : 'bloquée', 'is-blocked']);
    return `<section class="kir-sources-board" aria-label="Sources du Sourcing">
      <p class="kir-sources-summary" data-sources-summary>${chips.map(([n, label, cls]) => `<span class="${cls}"><strong>${n}</strong> ${label}</span>`).join('')}</p>
      <div class="kir-source-grid">${sources.map(source => sourceCard(source, selectedRun, lots)).join('')}${pending.map(sourceRequestCard).join('')}</div>
      ${archivedSourcesSection(archived)}
    </section>`;
  }

  // Source pilotée par le lot affiché. Le run n'expose pas toujours un source_ref identique à celui
  // de la carte source : on retombe sur l'activation en cours, puis le fournisseur, puis l'unique
  // source active. Jamais de barre manquante parce qu'une correspondance stricte a échoué.
  function sourceForRun(run, sourceControls) {
    // Security boundary: a mutation may only target an explicitly linked source_ref.
    if (!run?.source_ref) return null;
    return (Array.isArray(sourceControls) ? sourceControls : [])
      .find(source => source.state !== 'archived' &&
        source.source_ref === run.source_ref) || null;
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
    const update = button('update', 'Lancer un nouvel import', 'refresh', running && !pending, running ? 'Une mise à jour est déjà en cours' : '');
    const stop = button('stop', 'Suspendre l’automatisation', 'stop');
    const restart = button('restart', 'Activer l’automatisation', 'play', !restarting && source.activation_ready !== true, source.blocker || '');
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
        <strong>Aucun passage importé</strong>
        <span>Lancez un premier passage ponctuel depuis une source prête, sans activer l’alimentation automatique.</span>
      </div>
    </div>`;
    return `<nav class="kir-lot-strip ${cards ? '' : 'is-empty'}" aria-label="Passages d'import récents">
      <div class="kir-lot-strip-scroll">${cards || empty}</div>
      <a class="kir-lot-all" href="${urlFor(selectedRef, 'registry')}" data-cockpit-nav>Tous les passages</a>
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
      text = stage.reason === 'automatic_catalogue_handoff_pending'
        ? `${done} / ${total} remis automatiquement`
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
        'Retour au suivi'
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
      return stage.reason === 'automatic_catalogue_handoff_pending'
        ? { label:`Remise automatique de ${plural(num(stage.processed), 'produit', 'produits')} au Catalogue`, detail:'', started:false }
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
        </a>`).join('') : '<div class="kir-empty-inline">Aucun événement enregistré pour ce passage.</div>'}
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
      return `<section class="kir-live-panel kir-current-item"><header><strong>${esc(currentItemTitle(run))}</strong></header><div class="kir-current-empty">Aucun produit pour ce passage.</div></section>`;
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
  // Distinguer les anciens rejets de réception dus à l'autorité FX des
  // candidats désormais conservés en WATCH. Le taux doit être observé,
  // approuvé par une deuxième personne, puis la source relancée.
  function fxRemediation(run) {
    const reasons = Object.entries(run?.diagnostics?.reject_reasons || {});
    const legacyCount = reasons.reduce((count, [reason, n]) =>
      /taux\s+(?:usd|aed)_kmf\s+indisponible/i.test(reason) ? count + num(n) : count, 0);
    const pendingCount = num(run?.diagnostics?.fx_pending || run?.accounting?.fx_pending);
    if (legacyCount === 0 && pendingCount === 0) return '';
    const title = pendingCount > 0
      ? `${pendingCount} candidat(s) conservé(s) — cotation officielle EUR/USD attendue`
      : `${legacyCount} rejet(s) de réception liés au taux EUR/USD`;
    const detail = pendingCount > 0
      ? 'Les fiches fournisseurs restent dans « Mis de côté » avec leur prix d’origine. La synchronisation BCE fonctionne automatiquement ; un nouveau passage utilisera la dernière cotation officielle disponible.'
      : 'Ce passage a été enregistré avant la synchronisation automatique du taux. Après récupération du cours officiel, relancez la source pour récupérer ces produits.';
    return `<section class="kir-exception-banner" data-fx-remediation role="status">
      <strong>${esc(title)}</strong>
      <p>${esc(detail)}</p>
      <a href="/admin/workspaces/pricing#fx-authority">Consulter l’autorité des taux officiels →</a>
      <a href="${urlFor(run?.run_ref, 'sources')}" data-cockpit-nav>Retour aux sources →</a>
    </section>`;
  }

  function renderDecisions(run) {
    const fxNotice = fxRemediation(run);
    const lot = run.business || {};
    const connectorBlocked = lot.business_status === 'BLOCKED'
      && String(lot.failure_reason || '').startsWith('connector_failed:');
    if (lot.business_status === 'NO_RESULT') {
      return fxNotice || '<section class="kir-neutral-panel"><strong>Passage terminé sans résultat.</strong>&nbsp; La source n’a retourné aucun produit exploitable ; le passage reste visible pour garder sa trace.</section>';
    }
    if (connectorBlocked) {
      const message = String(lot.failure_reason || '').replace(/^connector_failed:\s*/i, '');
      return fxNotice + `<section class="kir-exception-banner"><strong>Connexion fournisseur interrompue.</strong> ${esc(message || 'Le fournisseur n’a pas pu être interrogé.')}</section>`;
    }
    return fxNotice;
  }

  // Une opération peut terminer les traitements sans produire la preuve de certification de son fournisseur.
  function providerRuntimeVerdict(run) {
    const d = run?.diagnostics || {};
    if (!run || run.source_type !== 'api') return '';
    const status = String(d.provider_runtime_status || 'PENDING');
    const blocked = status === 'BLOCKED';
    const pending = status === 'PENDING';
    const title = blocked ? 'Preuve fournisseur bloquée pour ce passage'
      : pending ? 'Preuve fournisseur non encore acquise'
        : status === 'CERTIFIED' ? 'Preuve fournisseur certifiée' : 'Preuve fournisseur indisponible';
    const detail = blocked
      ? 'Le traitement des produits peut être terminé, mais la résolution canonique n’est pas certifiée. Cela ne signifie pas que les produits reçus ont échoué.'
      : pending ? 'Le passage est enregistré, mais la preuve fournisseur attend encore sa certification.'
        : status === 'CERTIFIED' ? 'La preuve de ce passage est certifiée indépendamment du traitement des produits.'
          : 'Aucune preuve fournisseur applicable à ce passage.';
    const rejects = Object.entries(d.reject_reasons || {}).filter(([,count]) => num(count) > 0);
    return `<section class="kir-runtime-verdict ${blocked ? 'is-blocked' : pending ? 'is-pending' : 'is-certified'}" aria-label="Certification fournisseur du passage">
      <div class="kir-runtime-verdict-head"><strong>Certification du dernier passage fournisseur</strong><span>${esc(title)}</span></div>
      <p>${esc(detail)}</p>
      ${blocked || pending ? `<details><summary>Comprendre la preuve de ce passage</summary>
        <dl>
          <div><dt>État de résolution</dt><dd>${esc(d.pipeline_status || 'Non communiqué')}</dd></div>
          <div><dt>Résolution canonique</dt><dd>${d.canonical_resolved === true ? 'Confirmée' : 'Non confirmée'}</dd></div>
          <div><dt>Diagnostic fournisseur</dt><dd>${esc(d.provider_runtime_reason || 'Motif non communiqué')}</dd></div>
        </dl>
        ${rejects.length ? `<p>Rejets enregistrés : ${rejects.map(([reason,count]) => `${num(count)} × ${esc(reason)}`).join(' · ')}</p>` : ''}
        ${num(run.accounting?.rejected) > 0 ? `<a href="${populationUrl(run.run_ref, 'discarded')}" data-cockpit-nav>Consulter les rejets à la réception →</a>` : ''}
      </details>` : ''}
    </section>`;
  }

  function renderOverview(run) {
    return renderLiveCore(run) + renderDecisions(run);
  }

  const POPULATION_CRUMBS = Object.freeze({ received:'Produits reçus', ready:'Retenus par Sourcing', deferred:'Mis de côté', discarded:'Écartés automatiquement' });

  // Navigation d'une vue = fil d'Ariane + retour, calculés ensemble pour ne jamais diverger.
  // Le KIR n'est PAS un niveau : c'est le contexte du Suivi. Chaque écran a un parent unique et évident.
  function viewNav(run, p) {
    const ref = run?.run_ref;
    const domain = { label:'Sourcing', plain:true };
    const suivi = { label:'Suivi', href:urlFor(ref) };
    const backToSuivi = { href:suivi.href, label:'← Retour au suivi' };
    const leaf = label => ({ label });
    const popLabel = POPULATION_CRUMBS[p.kind] || 'Produits reçus';
    // Population d'origine d'un produit : Remise au Catalogue s'il en vient, sinon sa population.
    const popCrumb = p.origin === 'handoff'
      ? { label:'Remise au Catalogue', href:urlFor(ref, 'handoff') }
      : { label:popLabel, href:populationUrl(ref, p.kind) };
    const itemCrumb = { label:'Produit', href:itemUrl(ref, p.item, p.kind, p.origin) };
    if (p.view === 'passages') return { crumbs:[domain, leaf('Passages')], back:backToSuivi };
    if (p.view === 'sources') return { crumbs:[domain, leaf('Sources')], back:backToSuivi };
    const tail = {
      population: { crumbs:[leaf(popLabel)], back:backToSuivi },
      exceptions: { crumbs:[leaf('Action requise')], back:backToSuivi },
      source: { crumbs:[leaf('Source')], back:backToSuivi },
      control: { crumbs:[leaf('Contrôle automatique')], back:backToSuivi },
      handoff: { crumbs:[leaf('Remise au Catalogue')], back:backToSuivi },
      item: { crumbs:[popCrumb, leaf('Produit')], back:{ href:popCrumb.href, label:`← Retour à ${popCrumb.label}` } },
    }[p.view];
    if (p.view === 'history') {
      if (p.from === 'control') {
        const control = { label:'Contrôle automatique', href:urlFor(ref, 'control') };
        return { crumbs:[domain, suivi, control, leaf('Détail technique')], back:{ href:control.href, label:'← Retour au contrôle automatique' } };
      }
      if (p.from === 'item' && p.item) {
        return { crumbs:[domain, suivi, popCrumb, itemCrumb, leaf('Détail technique')], back:{ href:itemCrumb.href, label:'← Retour au produit' } };
      }
      return { crumbs:[domain, suivi, leaf('Détail technique')], back:backToSuivi };
    }
    if (!tail) return { crumbs:[domain, leaf('Suivi')], back:null };
    return { crumbs:[domain, suivi, ...tail.crumbs], back:tail.back };
  }

  function breadcrumb(run) {
    return `<nav class="kir-breadcrumb" aria-label="Fil d’Ariane">${viewNav(run, params()).crumbs.map(crumb =>
      crumb.href ? `<a href="${crumb.href}" data-cockpit-nav>${esc(crumb.label)}</a>`
        : crumb.plain ? `<span class="kir-crumb-domain">${esc(crumb.label)}</span>`
          : `<span aria-current="page">${esc(crumb.label)}</span>`
    ).join('<i aria-hidden="true">›</i>')}</nav>`;
  }

  function drillHeader(run, title, copy) {
    const { back } = viewNav(run, params());
    return `<div class="kir-drill-head">
      <div>
        ${breadcrumb(run)}
        ${back ? `<a href="${back.href}" data-cockpit-nav class="kir-back">${esc(back.label)}</a>` : ''}
        <span class="kir-drill-context">Passage ${esc(run.run_ref)}${run.provider ? ' · ' + esc(run.provider) : ''}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(copy)}</p>
      </div>
    </div>`;
  }

  function renderExceptions(run) {
    const items = Array.isArray(run.action_items) ? run.action_items : [];
    const count = num(run.accounting?.action_required);
    const back = urlFor(run.run_ref, 'exceptions');
    const workspace = withReturnTo('/admin/workspaces/sourcing', back, 'Retour à Action requise');
    const rows = items.map(item => {
      const title = item.product_name || item.supplier_product_id || (item.reason === 'Anomalie de comptage' ? 'Comptage du passage' : 'Produit à examiner');
      const candidateRef = item.candidate_ref || '';
      const isSupplierFact = ['purchase_price'].includes(item.correction_kind);
      const isAccounting = item.reason === 'Anomalie de comptage';
      const destination = isAccounting
        ? urlFor(run.run_ref, 'history')
        : !candidateRef ? urlFor(run.run_ref, 'control')
          : isSupplierFact
            ? '/admin/workspaces/sourcing?candidate_ref=' + encodeURIComponent(candidateRef)
            : '/admin/workspaces/catalog?search=' + encodeURIComponent(candidateRef);
      const label = isAccounting ? 'Voir le diagnostic'
        : isSupplierFact ? 'Corriger la donnée fournisseur'
          : candidateRef ? 'Corriger dans le Catalogue' : 'Voir le diagnostic';
      // Historical mocked proof remains available only for technical regression
      // tests. Mounted Sourcing Live and all operator links always use Catalogue.
      const legacyClassify = global.__KOMERCE_LEGACY_PROOF__ === true
        && item.action === 'choose' && candidateRef;
      const control = legacyClassify
        ? `<button type="button" class="kir-row-action kir-classify-btn" data-action-classify
            data-candidate-ref="${esc(candidateRef)}" data-product-name="${esc(title)}"
            data-action-reason="${esc(item.reason || '')}">Classer →</button>`
        : `<a class="kir-row-action" href="${esc(destination)}">${esc(label)} →</a>`;
      return `<tr>
        <td>${item.image_url ? `<img class="kir-action-thumb" src="${esc(item.image_url)}" alt="" loading="lazy">` : ''}<strong>${esc(title)}</strong>${item.supplier_product_id ? `<small>${esc(item.supplier_product_id)}</small>` : ''}</td>
        <td>${esc(item.reason)}${item.action_origin === 'deferred' ? '<small>Mis de côté · correction humaine possible</small>' : ''}</td>
        <td>${control}</td>
      </tr>`;
    }).join('');
    return drillHeader(
      run,
      count > 0 ? `Action requise · ${count}` : 'Action requise',
      count > 0
        ? 'Cette liste peut inclure des produits mis de côté pour une donnée corrigeable. Corrigez dans Sourcing puis relancez une analyse ; le lot source reste une preuve historique.'
        : 'Komerce ne signale aucune correction humaine nécessaire pour ce passage.'
    ) + (rows
      ? `<div class="kir-table-wrap"><table class="kir-table" data-action-list>
          <thead><tr><th>Produit</th><th>Pourquoi</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kir-empty">Aucune action requise.</div>');
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
    return drillHeader(run, 'Source', 'La source utilisée par ce passage.') + `<div class="kir-simple-list">
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
      // Un véritable échec technique reste « Bloqué », même si des corrections humaines existent.
      return statusRow(def.label, words, hint);
    }).join('');
    return drillHeader(run, 'Contrôle automatique', 'Ce que Komerce vérifie seul avant de proposer les produits au Catalogue.')
      + `<div class="kir-simple-list">${rows}</div>
      <p class="kir-technical-link"><a href="${technicalUrl(run.run_ref, 'control')}" data-cockpit-nav>Voir le détail technique →</a></p>`;
  }

  function populationRows(run, population, kind = 'received', origin = null) {
    const items = Array.isArray(population?.items) ? population.items : [];
    return items.map(item => {
      const title = item.product_name || item.supplier_product_id || 'Produit sans titre';
      const href = item.supplier_product_id ? itemUrl(run.run_ref, item.supplier_product_id, kind, origin) : null;
      const titleHtml = href
        ? `<a class="kir-population-item-link" href="${href}" data-cockpit-nav>${esc(title)}</a>`
        : `<strong>${esc(title)}</strong>`;
      return `<tr data-population-item>
        <td>${item.image_url ? `<img class="kir-action-thumb" src="${esc(item.image_url)}" alt="" loading="lazy">` : '<span class="kir-action-thumb is-empty"></span>'}${titleHtml}</td>
        <td>${esc(item.supplier_product_id || '—')}</td>
        <td><span class="kir-issue is-${esc(item.issue_key || 'control')}">${esc(item.issue_key === 'deferred' && item.decision ? (ITEM_DECISION_LABELS[item.decision] || item.issue_label) : item.issue_label || '—')}</span>${item.reason ? `<small>${esc(item.reason)}</small>` : item.issue_key === 'deferred' ? '<small>Motif détaillé non renseigné</small>' : ''}${item.needs_human_action ? `<small>À corriger · <a href="${urlFor(run.run_ref, 'exceptions')}" data-cockpit-nav>Voir l’action →</a></small>` : ''}</td>
      </tr>`;
    }).join('');
  }

  function traceSituation(trace) {
    const outcome = trace?.certification?.outcome;
    if (trace?.product_ref || trace?.catalogue_status === 'imported_to_catalog') return ['completed', 'Remis au Catalogue'];
    if (outcome === 'quarantined') return ['attention', 'À examiner'];
    if (outcome === 'rejected' || outcome === 'archived') return ['neutral', 'Écarté'];
    if (outcome === 'deferred') return ['deferred', 'Mis de côté'];
    if (trace?.certification?.sourcing_certified) return ['completed', 'Prêt pour le Catalogue'];
    return ['pending', 'En cours de traitement'];
  }

  // Libellés opérateur, sans jargon WATCH/DEFERRED ni motif déduit du seul statut.
  const ITEM_DECISION_LABELS = Object.freeze({
    WATCH:'À surveiller', AVOID:'À éviter', LOSS:'Non rentable',
    TEST:'À tester', PRIORITY:'Prioritaire', EXCLUDED:'Exclu',
  });
  function itemVerdict(trace, situation) {
    const outcome = trace?.certification?.outcome;
    const deferred = outcome === 'deferred';
    const discarded = outcome === 'rejected' || outcome === 'archived';
    const review = outcome === 'quarantined';
    const explanation = deferred
      ? 'Ce produit n’est pas retenu pour la suite de ce passage. Il reste consultable dans le Sourcing et n’a pas été transmis au Catalogue.'
      : discarded ? 'Ce produit a été écarté de ce passage et n’a pas été transmis au Catalogue.'
        : review ? 'Une vérification est nécessaire avant de poursuivre son traitement.'
          : trace?.product_ref ? 'Le produit a été transmis au Catalogue.'
            : trace?.certification?.sourcing_certified ? 'Le produit a été retenu pour la suite ; sa remise au Catalogue reste à confirmer.'
              : 'Le traitement de ce produit n’est pas encore terminé.';
    const code = trace?.certification?.decision;
    const decision = ITEM_DECISION_LABELS[code] || null;
    const reason = trace?.certification?.reason;
    const next = trace?.certification?.recommended_action;
    const humanAction = trace?.certification?.human_action;
    const showDecision = deferred || discarded || review;
    return `<section class="kir-item-verdict is-${esc(situation[0])}" aria-label="Statut du produit">
      <div class="kir-item-verdict-head"><span>STATUT DU PRODUIT</span><strong>${esc(situation[1])}</strong></div>
      <p>${esc(explanation)}</p>
      ${showDecision ? `<dl class="kir-item-verdict-details">
        <div><dt>Décision Sourcing</dt><dd>${esc(decision || 'Non renseignée')}</dd></div>
        <div><dt>Pourquoi ?</dt><dd>${esc(reason || 'Le motif détaillé n’est pas renseigné pour ce produit.')}</dd></div>
        ${next ? `<div><dt>Suite recommandée</dt><dd>${esc(next)}</dd></div>` : ''}
        ${humanAction ? `<div><dt>Intervention humaine</dt><dd>Correction à effectuer dans Sourcing, puis nouvelle analyse · <a href="${urlFor(trace.run_ref, 'exceptions')}" data-cockpit-nav>Voir Action requise →</a></dd></div>` : ''}
      </dl>` : ''}
    </section>`;
  }

  function renderItemView(run, trace, kind) {
    const { origin } = params();
    if (!trace) return drillHeader(run, 'Produit', 'Détail de l’objet sélectionné.') + '<div class="kir-empty">Produit introuvable dans ce passage.</div>';
    const title = trace.product_name || trace.supplier_product_id || 'Produit';
    const situation = traceSituation(trace);
    const deferred = trace?.certification?.outcome === 'deferred';
    const discarded = ['rejected', 'archived'].includes(trace?.certification?.outcome);
    const halted = deferred || discarded;
    const reviewed = trace?.certification?.outcome === 'quarantined';
    const certificationText = trace?.certification?.sourcing_certified ? '✓ Validée'
      : deferred ? 'Décision : mis de côté'
        : discarded ? 'Décision : écarté'
          : reviewed ? 'À examiner' : 'En cours ou en attente';
    const catalogueHref = trace.product_ref && viewer && viewer.role === 'admin'
      ? withReturnTo(`/admin/workspaces/catalog?product_ref=${encodeURIComponent(trace.product_ref)}`, itemUrl(run.run_ref, trace.supplier_product_id, kind, origin), 'Retour au produit Sourcing')
      : '';
    const catalogue = trace.product_ref
      ? `<a class="kir-subtle-link" href="${withReturnTo('/admin/products/' + encodeURIComponent(trace.product_ref), itemUrl(run.run_ref, trace.supplier_product_id, kind, origin), 'Retour au produit Sourcing')}">Ouvrir la fiche Catalogue →</a>${catalogueHref ? ` <a class="kir-subtle-link" data-next-step="catalogue" href="${catalogueHref}">Compléter dans le Catalogue global</a>` : ''}`
      : `<span class="kir-item-note">${halted ? 'Aucune fiche Catalogue créée pour ce passage.' : 'Aucune fiche Catalogue créée à ce stade.'}</span>`;
    return drillHeader(run, title, 'Détail métier de ce produit dans le passage sélectionné.')
      + itemVerdict(trace, situation)
      + `<div class="kir-simple-list">
          ${statusRow('Identifiant source', ['completed', trace.supplier_product_id || '—'])}
          ${statusRow('Préparation', [trace.refinery?.done ? 'completed' : 'pending', trace.refinery?.done ? '✓ Terminée' : 'Non terminée'])}
          ${statusRow('Classement', [trace.canonical_category ? 'completed' : 'pending', trace.canonical_category || (halted ? 'Non déterminé pour ce passage' : 'En attente')])}
          ${statusRow('Classement commercial', [trace.commercial_review?.status === 'PENDING_CLASSIFICATION' ? 'attention' : 'pending',
            trace.commercial_review?.status === 'PENDING_CLASSIFICATION' ? 'À confirmer dans Sourcing'
              : trace.commercial_review?.status ? trace.commercial_review.status : 'Non documenté pour ce passage'])}
          ${statusRow('Douane et calcul', [trace.customs_review?.status === 'REQUIRED' ? 'attention' : 'pending',
            trace.customs_review?.status === 'REQUIRED' ? 'À qualifier — calcul et publication interdits'
              : trace.customs_review?.status ? trace.customs_review.status : 'Non documenté pour ce passage'])}
          ${statusRow('Validation Sourcing', [trace.certification?.sourcing_certified ? 'completed' : reviewed ? 'attention' : 'pending', certificationText])}
          ${statusRow('Catalogue', [trace.product_ref ? 'completed' : 'pending', trace.product_ref ? '✓ Remis' : halted ? 'Non transmis pour ce passage' : reviewed ? 'En attente de vérification' : 'Pas encore remis'])}
        </div>
        <div class="kir-item-actions">${catalogue}</div>
        <p class="kir-technical-link"><a href="${technicalUrl(run.run_ref, { from:'item', item:trace.supplier_product_id, kind, origin })}" data-cockpit-nav>Voir la preuve technique →</a></p>`;
  }

    const POPULATION_COPY = Object.freeze({
    received: ['Produits reçus', 'Les produits envoyés par la source pour ce passage et leur situation actuelle. Consultation : aucune action n’est nécessaire.', 'Situation'],
    ready: ['Retenus par Sourcing', 'Produits validés par Sourcing pour la suite. Leur remise réelle au Catalogue est indiquée dans le suivi.', 'Remise'],
    deferred: ['Mis de côté', 'Produits non retenus pour ce passage. Certains WATCH peuvent exiger une correction ; les autres sont simplement surveillés ou non retenus.', 'Décision et motif'],
    discarded: ['Écartés automatiquement', 'Rejets dès la réception ou par règle. Le moteur distingue le rejet du blocage de certification fournisseur.', 'Motif'],
  });

  function renderPopulation(run, population, kind) {
    const [title, copy, issueHead] = POPULATION_COPY[kind] || POPULATION_COPY.received;
    if (!population || population.kind !== kind) {
      return drillHeader(run, title, copy) + '<div class="kir-empty">Chargement des produits…</div>';
    }
    const rows = populationRows(run, population, kind);
    const unlisted = Array.isArray(population.unlisted) ? population.unlisted : [];
    const extra = unlisted.map(group => `<tr class="is-group" data-population-group><td colspan="2"><strong>${num(group.count)} × ${esc(group.label)}</strong></td><td><small>Comptés à la réception, sans fiche individuelle</small></td></tr>`).join('');
    const rejectReasons = kind === 'discarded' && num(population.total) > 0
      ? `<section class="kir-reject-evidence" aria-label="Motifs techniques du rejet">
          <strong>Motifs enregistrés à la réception (niveau du lot)</strong>
          <p>Les motifs sont agrégés : un produit rejeté avant sa création ne dispose pas forcément d’une fiche individuelle.</p>
          ${Array.isArray(population.reject_reason_groups) && population.reject_reason_groups.length
            ? `<ul>${population.reject_reason_groups.map(entry => `<li>${num(entry.count)} × ${esc(entry.reason)}</li>`).join('')}</ul>`
            : '<p>Le motif détaillé du rejet de réception n’a pas été enregistré.</p>'}
        </section>` : '';
    return drillHeader(run, `${title} · ${num(population.total)}`, copy)
      + ((kind === 'discarded' || kind === 'deferred') ? fxRemediation(run) : '')
      + (rows || extra
        ? `<div class="kir-table-wrap"><table class="kir-table" data-population-list="${esc(kind)}">
            <thead><tr><th>Produit</th><th>Identifiant source</th><th>${esc(issueHead)}</th></tr></thead><tbody>${rows}${extra}</tbody></table></div>`
        : '<div class="kir-empty">Aucun produit dans cette population.</div>')
      + rejectReasons;
  }

  // Catalogue : uniquement la frontière Sourcing → Catalogue (ni prix, ni marché, ni vente).
  function renderHandoffView(run, population) {
    const h = sourcingOutcome(run).handoff;
    const status = !h.controlDone || h.certified === 0 ? 'Rien n’est encore prêt à remettre'
      : h.complete ? '✓ Remise terminée'
        : h.catalogued === 0 ? 'Remise automatique en cours'
          : `${h.remaining} ${h.remaining > 1 ? 'restent' : 'reste'} à remettre automatiquement`;
    const list = population && population.kind === 'ready' && population.items?.length
      ? `<div class="kir-table-wrap"><table class="kir-table" data-population-list="ready">
          <thead><tr><th>Produit</th><th>Identifiant source</th><th>Remise</th></tr></thead><tbody>${populationRows(run, population, 'ready', 'handoff')}</tbody></table></div>`
      : '';
    const state = h.complete ? 'completed' : h.controlDone && h.certified > 0 ? 'running' : 'pending';
    return drillHeader(run, 'Remise au Catalogue', 'Produits retenus par Sourcing et effectivement remis au Catalogue, où leur préparation et approbation se poursuivent.')
      + `<div class="kir-simple-list">${statusRow('Remise au Catalogue', [state, status])}</div>${list}`;
  }

  // Détail technique : preuve / diagnostic. Volontairement hors du parcours métier.
  function renderHistory(run) {
    const stages = Array.isArray(run.stages) ? run.stages : [];
    const events = Array.isArray(run.events) ? run.events : [];
    const { from, item, kind, origin } = params();
    const ctx = { from, item, kind, origin };
    const selectedStage = new URLSearchParams(global.location.search).get('stage');
    const selectedLabel = selectedStage ? (selectedStage === 'CONTROL' ? 'Contrôle automatique' : stageLabel(selectedStage)) : null;
    const inSelection = key => !selectedStage || selectedStage === key || (selectedStage === 'CONTROL' && CONTROL_STAGES.includes(key));
    // Jamais « COMPLETED · 0 / 12 » : un ratio n'est montré que pendant le travail ; une étape terminée dit « Terminé ».
    const stageText = stage => stage.status === 'COMPLETED' ? '✓ Terminé'
      : stage.status === 'RUNNING' && stage.reason === 'automatic_catalogue_handoff_pending' ? `Remise automatique · ${num(stage.processed)} / ${num(stage.total)}`
      : stage.status === 'RUNNING' ? `En cours · ${num(stage.processed)} / ${num(stage.total)}`
        : stage.status === 'FAILED' ? 'Bloqué' : 'En attente';
    return drillHeader(
      run,
      selectedLabel ? `Détail technique — ${selectedLabel}` : 'Détail technique du passage',
      'Preuve du parcours automatique, pour le diagnostic et l’audit. Cette information n’indique jamais quoi faire.'
    ) + `
      <section class="kir-history-stages">
        ${stages.map(stage => `<a class="kir-history-stage ${selectedStage && inSelection(stage.key) ? 'is-selected' : ''}" href="${stageUrl(run.run_ref, stage.key, ctx)}" data-cockpit-nav>
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

  // Navigation du domaine : Suivi (passage sélectionné) / Passages / Sources.
  function domainNav() {
    // The canonical shell owns the single Sourcing Live entry.
    // This legacy helper deliberately never adds a second tab bar.
    return '';
  }

  // Changer de lot sans rail permanent : précédent · liste compacte · suivant · tous les passages.
  function lotPicker(run, runNav, lots) {
    const list = (lots || []).filter(lot => lot.business_status !== 'ARCHIVED' || lot.run_ref === run.run_ref);
    if (!list.some(lot => lot.run_ref === run.run_ref)) {
      list.unshift({ run_ref:run.run_ref, provider:run.provider, started_at:run.started_at });
    }
    const older = runNav?.older_ref ? { run_ref:runNav.older_ref } : null;
    const newer = runNav?.newer_ref ? { run_ref:runNav.newer_ref } : null;
    const step = (lot, label) => lot
      ? `<a class="kir-lot-step" href="${urlFor(lot.run_ref)}" data-cockpit-nav>${label}</a>`
      : `<span class="kir-lot-step is-off">${label}</span>`;
    return `<div class="kir-lot-picker">
      ${step(older, '← passage précédent')}
      <select data-lot-select aria-label="Choisir un passage">${list.map(lot =>
        `<option value="${esc(lot.run_ref)}" ${lot.run_ref === run.run_ref ? 'selected' : ''}>${esc(lot.run_ref)}${lot.provider ? ' · ' + esc(lot.provider) : ''}</option>`).join('')}</select>
      ${step(newer, 'passage suivant →')}
      <a class="kir-lot-all" href="${passagesUrl(run.run_ref)}" data-cockpit-nav>Tous les passages →</a>
    </div>`;
  }

    // Passages : l'historique des runs, uniquement la vérité Sourcing. Toute la ligne ouvre Live sur ce lot.
  const passageFilters = { source:'', state:'', period:'all', q:'' };
  const PASSAGE_PERIODS = Object.freeze({ all:'Toute la période', today:'Aujourd’hui', week:'7 derniers jours' });

  function filteredPassages(passages) {
    const now = Date.now();
    const q = passageFilters.q.trim().toLowerCase();
    return (passages || []).filter(item => {
      if (passageFilters.source && item.provider !== passageFilters.source) return false;
      if (passageFilters.state && item.sourcing_status !== passageFilters.state) return false;
      if (passageFilters.period !== 'all') {
        const age = now - new Date(item.started_at).getTime();
        if (!(age >= 0) || age > (passageFilters.period === 'today' ? 86400000 : 7 * 86400000)) return false;
      }
      return !q || [item.run_ref, item.provider, item.state_label].some(value => String(value || '').toLowerCase().includes(q));
    });
  }

  function passageRows(passages) {
    const rows = filteredPassages(passages);
    if (!rows.length) return '<tr><td colspan="9" class="kir-empty">Aucun passage ne correspond à ces filtres.</td></tr>';
    return rows.map(item => {
      const tone = ({ RUNNING:'live', DONE:'positive', ACTION_REQUIRED:'warning', BLOCKED:'critical' })[item.sourcing_status] || 'neutral';
      return `<tr class="kir-passage-row" data-row-href="${urlFor(item.run_ref)}" tabindex="0">
        <td><a href="${urlFor(item.run_ref)}" data-cockpit-nav>${esc(item.run_ref)}</a></td>
        <td>${esc(item.provider || '—')}</td>
        <td>${fmtDate(item.started_at)}</td>
        <td><span class="kir-status is-${tone}">${esc(item.state_label)}</span></td>
        <td>${num(item.source_total)}</td><td>${num(item.certified)}</td><td>${num(item.discarded)}</td>
        <td>${num(item.action_required) > 0 ? `<strong class="kir-passage-action">${num(item.action_required)}</strong>` : '0'}</td>
        <td>${esc(item.handoff_label || '—')}</td>
      </tr>`;
    }).join('');
  }


  // Bande KPI agrégée des passages : uniquement des comptages sur les lots et sources déjà fournis par le serveur.
  // Une donnée non fournie s'affiche « Non disponible », jamais 0 (candidats détectés : aucun agrégat canonique).
  function passagesKpis(sourceControls, lots) {
    const sources = Array.isArray(sourceControls) ? sourceControls.filter(source => source.state !== 'archived' && source.archived !== true) : null;
    const list = Array.isArray(lots) ? lots : null;
    const NA = 'Non disponible';
    const last = list && list.length
      ? list.map(lot => lot.finished_at || lot.started_at).filter(Boolean).sort().pop()
      : null;
    const active = list ? list.filter(lot => lot.technical_status === 'RUNNING').length : null;
    const errors = list ? list.filter(lot => lot.technical_status === 'FAILED' || lot.business_status === 'BLOCKED').length : null;
    const cards = [
      ['last', 'Dernière synchro', last ? fmtDate(last) : NA, list ? `sur les ${list.length} derniers passages` : ''],
      ['active', 'Passages actifs', active == null ? NA : String(active), 'en cours (LIVE)'],
      ['sources', 'Sources suivies', sources ? String(sources.length) : NA, 'fournisseurs configurés'],
      ['candidates', 'Candidats détectés', NA, 'agrégat non fourni par le serveur'],
      ['errors', 'Passages en erreur', errors == null ? NA : String(errors), list ? `sur les ${list.length} derniers passages` : ''],
    ];
    return `<section class="kir-passages-kpis" data-passages-kpis aria-label="Indicateurs Sourcing">${cards.map(([key, label, value, sub]) =>
      `<article data-kpi="${key}"><span>${esc(label)}</span><strong${value === NA ? ' class="is-na"' : ''}>${esc(value)}</strong><small>${esc(sub)}</small></article>`).join('')}</section>`;
  }

  function renderPassages(run, passages, page = {}, sourceControls = null, lots = null) {
    const { back } = viewNav(run, params());
    const list = Array.isArray(passages) ? passages : null;
    const providers = [...new Set((list || []).map(item => item.provider).filter(Boolean))];
    const option = (value, label, current) => `<option value="${esc(value)}" ${current === value ? 'selected' : ''}>${esc(label)}</option>`;
    const states = { '':'Tous les états', RUNNING:'LIVE', DONE:'Terminé', ACTION_REQUIRED:'Action requise', BLOCKED:'Bloqué' };
    const offset = Math.max(0, Number(page?.offset) || 0);
    const nextOffset = page?.next_offset == null ? null : Math.max(0, Number(page.next_offset) || 0);
    const previousOffset = Math.max(0, offset - 50);
    const pager = list ? `<nav class="kir-passage-pagination" aria-label="Pagination des passages">
      ${offset > 0 ? `<a href="${passagesUrl(run?.run_ref, previousOffset, passageFilters)}" data-cockpit-nav>← Passages plus récents</a>` : '<span></span>'}
      <span>${list.length ? `${offset + 1}–${offset + list.length}` : '0'}</span>
      ${nextOffset != null ? `<a href="${passagesUrl(run?.run_ref, nextOffset, passageFilters)}" data-cockpit-nav>Passages plus anciens →</a>` : '<span></span>'}
    </nav>` : '';
    return `<div class="kir-drill-head"><div>
        ${breadcrumb(run)}
        ${back ? `<a href="${back.href}" data-cockpit-nav class="kir-back">${esc(back.label)}</a>` : ''}
        <h2>Historique des passages</h2>
        <p>Les passages Sourcing : ce qui a été reçu, ce qui est prêt pour le Catalogue et ce qui demande une action.</p>
      </div></div>
      ${passagesKpis(sourceControls, lots)}
      <div class="kir-passage-filters" data-passage-filters>
        <select data-passage-filter="source" aria-label="Source">${option('', 'Toutes les sources', passageFilters.source)}${providers.map(name => option(name, name, passageFilters.source)).join('')}</select>
        <select data-passage-filter="state" aria-label="État">${Object.entries(states).map(([value, label]) => option(value, label, passageFilters.state)).join('')}</select>
        <select data-passage-filter="period" aria-label="Période">${Object.entries(PASSAGE_PERIODS).map(([value, label]) => option(value, label, passageFilters.period)).join('')}</select>
        <input type="search" data-passage-filter="q" placeholder="Rechercher sur cette page" aria-label="Recherche" value="${esc(passageFilters.q)}">
      </div>
      ${list ? `<div class="kir-table-wrap"><table class="kir-table" data-passages-table>
        <thead><tr><th>Passage</th><th>Source</th><th>Date / heure</th><th>État Sourcing</th><th>Produits reçus</th><th>Retenus Sourcing</th><th>Écartés</th><th>Action requise</th><th>Remise au Catalogue</th></tr></thead>
        <tbody data-passages-body>${passageRows(list)}</tbody></table></div>${pager}`
        : '<div class="kir-empty">Chargement des passages…</div>'}`;
  }

  // Sources : inventaire et pilotage des fournisseurs (vue de 1er niveau, pas de lot).
  function renderSourcesView(run, sourceControls, lots, requests = []) {
    const { back } = viewNav(run, params());
    return `<div class="kir-drill-head kir-sources-head"><div>
        ${breadcrumb(run)}
        ${back ? `<a href="${back.href}" data-cockpit-nav class="kir-back">${esc(back.label)}</a>` : ''}
        <h2>Sources</h2>
        <p>Pilotez les fournisseurs connectés et leur alimentation automatique.</p>
        ${run?.run_ref ? `<p class="kir-sources-context">Passage courant : ${esc(run.run_ref)}</p>` : ''}
      </div>
      <button type="button" class="kir-add-source" data-add-source>+ Ajouter une source</button></div>
      ${sourcesBoard(sourceControls, run, lots, requests)}
      ${activationStrip(sourceControls)}
      ${wizardMarkup(sourceControls)}`;
  }

  function renderBody(run, view, ctx = {}) {
    if (view === 'population') return renderPopulation(run, ctx.population, ctx.kind);
    if (view === 'item') return renderItemView(run, ctx.itemTrace, ctx.kind);
    if (view === 'source') return renderSourceView(run, ctx.sourceControls);
    if (view === 'control') return renderControlView(run);
    if (view === 'handoff') return renderHandoffView(run, ctx.population);
    if (view === 'exceptions') return renderExceptions(run);
    if (view === 'history') return renderHistory(run);
    return renderDecisions(run);
  }

  // Un champ d'identifiant en cours de saisie ne doit jamais être effacé par un rafraîchissement
  // périodique : on reporte le rendu (le payload reste mémorisé) jusqu'à l'envoi ou l'annulation.
  function credentialInputInProgress(root) {
    if (credentialsState?.saving) return false;
    return Array.from(root?.querySelectorAll?.('[data-credential-field]') || [])
      .some(input => String(input.value || '') !== '');
  }

  // Compatibility for isolated, read-only-on-mock legacy proof tests only.
  // This is never selected from operator navigation or runtime mounting.
  // Keep the backend-detail assertions while new single-screen tests replace
  // historical mock screenshots. Remove after migration of legacy proofs.
  function legacyDomainNav(view, run) {
    // Le shell Canonical porte les trois onglets Sourcing dans sa barre supérieure.
    // Ne pas reproduire un second rail à l'intérieur du cockpit.
    if (global.document?.querySelector?.('#canonical-admin-domain-tabs [data-tab="sourcing-suivi"]')) return '';
    const active = view === 'passages' ? 'passages' : view === 'sources' ? 'sources' : 'live';
    const tab = (key, label, href) => `<a class="${active === key ? 'is-active' : ''}" href="${href}" data-cockpit-nav ${active === key ? 'aria-current="page"' : ''}>${label}</a>`;
    return `<nav class="kir-domain-nav" aria-label="Domaine Sourcing"><strong>Sourcing</strong>
      ${tab('live', 'Suivi', urlFor(run?.run_ref))}${tab('passages', 'Passages', urlFor(run?.run_ref, 'passages'))}${tab('sources', 'Sources', urlFor(run?.run_ref, 'sources'))}
    </nav>`;
  }


  function renderLegacyTechnicalProof(root, payload) {
    if (credentialInputInProgress(root)) return;
    const sourceControls = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const lots = Array.isArray(payload?.lots) ? payload.lots : [];
    const run = payload?.selected || null;
    const { view, kind, filters } = params();
    // L'assistant n'existe que sur la vue Sources.
    if (view !== 'sources') { wizardState = null; manageState = null; credentialsState = null; }
    // L'URL fait foi pour les filtres de Passages (Back / Forward / rechargement).
    if (view === 'passages') Object.assign(passageFilters, filters);
    root.className = 'kmc-import-runtime kmc-domain-cockpit';
    root.setAttribute?.('data-cockpit-pattern', 'v1');
    root.setAttribute?.('data-cockpit-domain', 'imports');
    root.setAttribute?.('data-cockpit-language', 'live-ops');

    // Vues exclusives : Passages et Sources remplacent le cockpit, avec ou sans passage sélectionné.
    if (view === 'passages' || view === 'sources') {
      root.innerHTML = `<section class="kir-page">
        ${legacyDomainNav(view, run)}
        <main class="kir-main">${view === 'passages' ? renderPassages(run, payload?.passages, payload?.passages_page, payload?.source_controls, payload?.lots) : renderSourcesView(run, sourceControls, lots, Array.isArray(payload?.source_requests) ? payload.source_requests : [])}</main>
      </section>`;
      bindAll(root, payload);
      return;
    }

    if (!run) {
      root.innerHTML = `<section class="kir-page">
        ${legacyDomainNav('overview', null)}
        <header class="kir-hero"><div><span class="kir-eyebrow">OPÉRATIONS · SOURCING</span><h1>Suivi d’import — Source → Catalogue</h1><p>Aucun passage pour l’instant.</p></div></header>
        <div class="kir-empty-launch">
          <div class="kir-empty-launch-copy"><strong>Aucun passage Sourcing</strong><span>Choisissez une source prête, puis lancez son premier passage depuis « Sources ».</span></div>
          <a class="kir-subtle-link" href="${urlFor(null, 'sources')}" data-cockpit-nav>Gérer les sources →</a>
        </div>
      </section>`;
      bindAll(root, payload);
      return;
    }

        // Vue secondaire : elle remplace entièrement le cockpit (jamais empilée dessous).
    if (view !== 'overview') {
      root.innerHTML = `<section class="kir-page">
        ${legacyDomainNav(view, run)}
        <main class="kir-main">${renderBody(run, view, { population:payload?.population || null, itemTrace:payload?.item_trace || null, kind, sourceControls })}</main>
      </section>`;
      bindAll(root, payload);
      return;
    }

    // LIVE : le cockpit du passage sélectionné, et rien d'autre.
    root.innerHTML = `<section class="kir-page">
      ${legacyDomainNav('overview', run)}
      <header class="kir-hero kir-live-hero">
        <div>
          <div class="kir-live-titleline"><span class="kir-eyebrow">OPÉRATIONS · SOURCING</span></div>
          <div class="kir-live-titlerow"><h1>Suivi d’import — Source → Catalogue</h1><span class="kir-live-badge ${run.status === 'RUNNING' ? 'is-live' : ''}">${run.status === 'RUNNING' ? 'LIVE' : 'RUN'}</span></div>
          ${lotPicker(run, payload?.run_nav || null, lots)}
          <p>${esc(run.provider || 'Source')} · ${num(run.accounting?.source_total)} entrée(s)</p>
        </div>
        <div class="kir-hero-actions kir-live-hero-actions">
          <div class="kir-live-time"><span>Démarré ${fmtDate(run.started_at)}</span><strong>${elapsedLabel(run.started_at, run.finished_at)}</strong></div>
          <span class="kir-status-large is-${sourcingStatusView(run).tone}">${ico('clock')}${esc(sourcingStatusView(run).label)}</span>
          <a href="${withReturnTo('/admin/workspaces/catalog', urlFor(run.run_ref), 'Retour au suivi')}" class="kir-global-link">Catalogue global →</a>
        </div>
      </header>

      ${commandBar(run, sourceControls)}
      ${persistentRunFlow(run, sourceControls)}
      ${runTruthStrip(run)}
      ${providerRuntimeVerdict(run)}
      ${catalogueHandoff(run)}
      ${activationState ? '' : runProgressRow(run)}
      ${renderLiveCore(run)}
      <main class="kir-main">${renderDecisions(run)}</main>
    </section>`;
    bindAll(root, payload);
  }


  // The one operator screen. Technically detailed KIR drill-downs remain available
  // for evidence, without becoming competing navigation tabs or writer owners.
  function unifiedSourcingIssues(run) {
    const items = Array.isArray(run?.action_items) ? run.action_items : [];
    const count = num(run?.accounting?.action_required);
    if (!count) return '';
    const rows = items.slice(0, 8).map(item => {
      const ref = item.candidate_ref || null;
      const supplierIssue = item.correction_kind === 'purchase_price';
      const accounting = item.reason === 'Anomalie de comptage';
      const href = accounting ? urlFor(run.run_ref, 'history')
        : !ref ? urlFor(run.run_ref, 'control')
          : supplierIssue
            ? '/admin/workspaces/sourcing?candidate_ref=' + encodeURIComponent(ref)
            : '/admin/workspaces/catalog?search=' + encodeURIComponent(ref);
      const label = accounting ? 'Diagnostic' : supplierIssue
        ? 'Corriger la source' : ref ? 'Compléter dans le Catalogue' : 'Diagnostic';
      return `<li class="kir-one-issue">
        <span><strong>${esc(item.product_name || ref || 'Anomalie du passage')}</strong>
        <small>${esc(item.reason || 'Contrôle à examiner')}</small></span>
        <a href="${esc(href)}">${esc(label)} →</a></li>`;
    }).join('');
    return `<section class="kir-one-issues" id="sourcing-actions" aria-label="Actions utiles">
      <h2>${count} action${count > 1 ? 's' : ''} signalée${count > 1 ? 's' : ''} sur ce passage</h2>
      <p>Une correction de fiche se fait au Catalogue global. Le passage reste une preuve historique.</p>
      <ul>${rows}</ul>
      ${items.length < count ? '<small>Liste partielle : consulter les détails techniques du passage.</small>' : ''}
    </section>`;
  }

  function unifiedPassageHistory(run, payload) {
    const historyMode = params().view === 'passages';
    const records = historyMode && Array.isArray(payload?.passages) ? payload.passages : payload?.lots;
    const list = Array.isArray(records) ? records.slice(0, historyMode ? 50 : 10) : [];
    const page = payload?.passages_page || {};
    const rows = list.map(lot => {
      const view = lot.state_label ? {label:lot.state_label} : lotChipView(lot);
      return `<li><a href="${urlFor(lot.run_ref)}" data-cockpit-nav>${esc(lot.run_ref)}</a>
        <span>${esc(lot.provider || 'Source inconnue')}</span>
        <small>${esc(view.label)}</small></li>`;
    }).join('');
    return `<details class="kir-one-panel" id="sourcing-passages" data-unified-passages
      ${params().view === 'passages' ? 'open' : 'hidden'}>
      <summary><strong>Passages</strong><span>Historique des acquisitions (${list.length} derniers affichés)</span></summary>
      <div class="kir-one-panel-body">
        <ul class="kir-one-passage-list">${rows || '<li>Aucun passage enregistré.</li>'}</ul>
        ${!historyMode ? `<a href="${urlFor(run?.run_ref, 'passages')}" data-cockpit-nav>Afficher tout l’historique →</a>` : ''}
        ${historyMode ? `<nav class="kir-passage-pagination">
          ${Number(page.offset) > 0 ? `<a href="${passagesUrl(run?.run_ref, Math.max(0, Number(page.offset)-50))}" data-cockpit-nav>← Plus récents</a>` : ''}
          ${page.next_offset != null ? `<a href="${passagesUrl(run?.run_ref, Number(page.next_offset))}" data-cockpit-nav>Plus anciens →</a>` : ''}
        </nav>` : ''}
      </div></details>`;
  }

  function unifiedSourceManagement(run, payload) {
    const sources = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const sourceRequests = Array.isArray(payload?.source_requests) ? payload.source_requests : [];
    const active = sources.filter(source => source.state === 'active').length;
    const open = params().view === 'sources';
    return `<details class="kir-one-panel" id="sourcing-sources" data-unified-sources
      ${open ? 'open' : 'hidden'}>
      <summary><strong>Sources & imports</strong>
        <span>${sources.length} configurée${sources.length > 1 ? 's' : ''} · ${active} active${active > 1 ? 's' : ''} · gérer les acquisitions</span></summary>
      <div class="kir-one-panel-body">
        <div class="kir-one-section-actions"><button type="button" data-add-source>+ Ajouter une source</button></div>
        ${sourcesBoard(sources, run, payload?.lots || [], sourceRequests)}
        ${activationStrip(sources)}
        ${wizardMarkup(sources)}
        <p class="kir-one-note">Importer = créer un nouveau passage KIR. Activer = autoriser l’alimentation automatique.</p>
        <p class="kir-one-note">
          <a href="/admin/workspaces/sourcing?mode=manual&tab=imports">Import manuel / CSV →</a>
          &nbsp;·&nbsp;
          <a href="/admin/workspaces/sourcing?mode=partners&tab=suppliers">Administration des partenaires →</a>
        </p>
      </div></details>`;
  }

  function unifiedSourcingTabs(run, view) {
    const active = ['sources', 'passages'].includes(view) ? view : 'overview';
    const labels = [['overview', 'Suivi'], ['sources', 'Sources'], ['passages', 'Passages']];
    return `<nav class="kir-one-tabs" data-sourcing-tabs aria-label="Onglets Sourcing Live">
      ${labels.map(([key,label]) => `<a href="${urlFor(run?.run_ref, key)}"
        data-cockpit-nav data-sourcing-tab="${key}" ${active === key ? 'aria-current="page"' : ''}>
        ${label}</a>`).join('')}
    </nav>`;
  }

  function unifiedSourcingDashboard(run, payload) {
    const view = params().view;
    const status = run ? sourcingStatusView(run) : null;
    const facts = run ? sourcingOutcome(run) : null;
    const handoff = facts?.handoff;
    const summary = run
      ? `<section class="kir-one-run" aria-label="Dernier passage sélectionné">
        <div class="kir-one-run-head"><div>
          <h2>${esc(run.run_ref)} · ${esc(run.provider || 'Source')}</h2>
          <p>${esc(status.label)} · démarré ${fmtDate(run.started_at)}</p></div>
          <a href="${urlFor(run.run_ref, 'history')}" data-cockpit-nav>Voir les détails techniques</a></div>
        <div class="kir-one-metrics">
          <div><strong>${facts.received}</strong><span>Reçus</span></div>
          <div><strong>${facts.ready}</strong><span>Retenus</span></div>
          <div><strong>${handoff?.catalogued ?? 0}</strong><span>Remis au Catalogue</span></div>
        </div>
        ${handoff && handoff.remaining > 0 ? `<p class="kir-one-handoff">
          ${handoff.remaining} produit${handoff.remaining > 1 ? 's' : ''} en attente de remise automatique au Catalogue. Aucune correction à effectuer ici.</p>` : ''}
        ${unifiedSourcingIssues(run)}
      </section>`
      : '<section class="kir-one-run"><h2>Aucun passage enregistré</h2><p>Configurez une source, puis lancez un import.</p></section>';
    return `<section class="kir-page kir-one-screen" data-sourcing-single-screen>
      <header class="kir-one-hero"><div><span class="kir-eyebrow">SOURCING</span>
        <h1>Sourcing Live</h1><p>Acquérir des produits et les remettre au Catalogue global.</p></div>
        <a href="/admin/workspaces/catalog">Catalogue global →</a></header>
      ${unifiedSourcingTabs(run, view)}
      <main class="kir-one-body" data-sourcing-active-view="${view}">
        <div class="kir-one-pane" data-sourcing-panel="overview" ${view === 'overview' ? '' : 'hidden'}>${summary}</div>
        ${unifiedSourceManagement(run, payload)}
        ${unifiedPassageHistory(run, payload)}
      </main></section>`;
  }

  function render(root, payload) {
    if (global.__KOMERCE_LEGACY_PROOF__ === true) return renderLegacyTechnicalProof(root, payload);
    if (credentialInputInProgress(root)) return;
    const sourceControls = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const lots = Array.isArray(payload?.lots) ? payload.lots : [];
    const run = payload?.selected || null;
    const { view, kind, filters } = params();
    // The same Sourcing Live screen owns source management and the wizard.
    // Only technical drill-downs close an open source editor.
    if (!['overview', 'sources'].includes(view)) { wizardState = null; manageState = null; credentialsState = null; }
    // L'URL fait foi pour les filtres de Passages (Back / Forward / rechargement).
    if (view === 'passages') Object.assign(passageFilters, filters);
    root.className = 'kmc-import-runtime kmc-domain-cockpit';
    root.setAttribute?.('data-cockpit-pattern', 'v1');
    root.setAttribute?.('data-cockpit-domain', 'imports');
    root.setAttribute?.('data-cockpit-language', 'live-ops');

    // Vues exclusives : Passages et Sources remplacent le cockpit, avec ou sans passage sélectionné.
    // Vue secondaire : elle remplace entièrement le cockpit (jamais empilée dessous).
    if (view !== 'overview' && view !== 'sources' && view !== 'passages') {
      root.innerHTML = `<section class="kir-page"><main class="kir-main">
        ${renderBody(run, view, { population:payload?.population || null,
          itemTrace:payload?.item_trace || null, kind, sourceControls })}</main></section>`;
      bindAll(root, payload);
      return;
    }

    // One Sourcing Live screen: current run, actionable exceptions, sources and history.
    root.innerHTML = unifiedSourcingDashboard(run, payload);
    bindAll(root, payload);
  }

  function bindAll(root, payload) {
    bindNavigation(root);
    bindSourceControls(root, payload);
    bindWizard(root, payload);
    bindManage(root, payload);
    bindCredentials(root);
    bindActionList(root);
    bindPassages(root, payload);
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

  // Passage manuel depuis une source prête, historique conservé et autopilot OFF.
  // Ne navigue jamais sur un passage imaginé : le run_ref vient de la réponse métier.
  async function startFirstImport(root, payload, sourceRef) {
    if (firstImportState?.pending) return;
    const source = (payload?.source_controls || []).find(item => item.source_ref === sourceRef);
    if (!source || source.state !== 'ready' || source.autopilot_enabled) return;
    firstImportState = { sourceRef, pending:true, error:null };
    render(root, lastPayload || payload);
    try {
      const response = await api(`/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/import-now`, { method:'POST', body:{} });
      const runRef = response?.result?.run_ref;
      if (!runRef) throw new Error('Aucune référence de passage retournée. Consultez les Passages avant de relancer.');
      firstImportState = null;
      goto(urlFor(runRef));
    } catch (error) {
      firstImportState = { sourceRef, pending:false, error:error?.message || 'Import impossible.' };
      render(root, lastPayload || payload);
    }
  }

  // Mettre à jour maintenant : réinterroge la source (endpoint existant import-now).
  async function updateSourceNow(root, sourceRef) {
    commandState = { sourceRef, action:'update' };
    if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
    const poll = typeof global.setInterval === 'function'
      ? global.setInterval(() => { refresh({ preserve:true }); }, COMMAND_POLL_MS) : null;
    try {
      const response = await api(`/api/admin/workspaces/sourcing/sources/${encodeURIComponent(sourceRef)}/import-now`, { method:'POST', body:{} });
      const runRef = response?.result?.run_ref;
      if (runRef) goto(urlFor(runRef));
      else showCommandError('Mise à jour', 'Aucune référence de passage retournée. Consultez les Passages.');
    } catch (error) {
      const main = root.querySelector?.('.kir-main');
      if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Mise à jour · ${esc(error.message)}</div>`);
    } finally {
      if (poll && typeof global.clearInterval === 'function') global.clearInterval(poll);
      commandState = null;
      await refresh({ preserve:true });
    }
  }

  // ── Registre opérateur : assistant « Ajouter une source » ─────────────────────────────────────
  // Ajouter → Connecter → Tester → Préparer → Certifier → Activer. Chaque étape appelle une route
  // backend qui reste l'autorité ; l'assistant n'invente ni état ni droit d'activation.
  const WIZARD_BASE = '/api/admin/workspaces/sourcing/sources';

  function newWizardState() {
    return {
      step:'type', kind:null, catalog:null, loading:false, error:null, existingRef:null,
      sourceRef:null, creating:null, testing:false, testResult:null, requestSaved:null, saving:false,
      form:{ provider_name:'', requested_label:'', reference_url:'' },
    };
  }

  function rerenderWizard() {
    if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
  }

  function closeWizard() {
    wizardState = null;
    rerenderWizard();
  }

  async function openWizard() {
    wizardState = newWizardState();
    rerenderWizard();
  }

  async function loadWizardCatalog() {
    if (!wizardState) return;
    wizardState.loading = true;
    wizardState.error = null;
    rerenderWizard();
    try {
      const catalog = await api(`${WIZARD_BASE}/catalog`);
      if (wizardState) wizardState.catalog = Array.isArray(catalog?.connectors) ? catalog.connectors : [];
    } catch (error) {
      if (wizardState) wizardState.error = error.message;
    } finally {
      if (wizardState) wizardState.loading = false;
      rerenderWizard();
    }
  }

  function connectorStatusLine(connector) {
    if (connector.existing_archived) return 'Archivée · restaurable';
    if (connector.existing_source_ref) return 'Déjà ajoutée';
    if (connector.available && connector.automatable) return 'Disponible · alimentation automatique possible';
    if (connector.available) return 'Connecteur présent · autopilot non certifié';
    return 'Connecteur présent · non disponible actuellement';
  }

  function connectorAuthLine(connector) {
    return onboardingRequirementLine(connector);
  }

  function focusSourceCard(sourceRef) {
    const card = Array.from(mountedRoot?.querySelectorAll?.('[data-source-card]') || [])
      .find(node => node.getAttribute('data-source-card') === sourceRef);
    if (!card) return;
    card.scrollIntoView?.({ block:'center' });
    card.focus?.();
  }

  function viewExistingSource(sourceRef) {
    wizardState = null;
    rerenderWizard();
    focusSourceCard(sourceRef);
  }

  async function createWizardSource(adapter) {
    if (!wizardState || wizardState.creating) return;
    wizardState.creating = adapter;
    wizardState.error = null;
    wizardState.existingRef = null;
    rerenderWizard();
    try {
      const response = await api(WIZARD_BASE, { method:'POST', body:{ adapter } });
      if (wizardState) {
        wizardState.sourceRef = response?.result?.source_ref || null;
        wizardState.step = 'connection';
        wizardState.testResult = null;
      }
    } catch (error) {
      if (wizardState) {
        wizardState.error = error.code === 'sourcing_source_already_exists' ? 'Cette source existe déjà.' : error.message;
        wizardState.existingRef = error.code === 'sourcing_source_already_exists' ? (error.details?.existing_source_ref || null) : null;
      }
    } finally {
      if (wizardState) wizardState.creating = null;
      await refresh({ preserve:true });
      rerenderWizard();
    }
  }

  function showCommandError(prefix, message) {
    const main = mountedRoot?.querySelector?.('.kir-main');
    if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">${esc(prefix)} · ${esc(message)}</div>`);
  }

  async function runConnectionTest(sourceRef) {
    if (wizardState) { wizardState.testing = true; wizardState.error = null; rerenderWizard(); }
    try {
      const response = await api(`${WIZARD_BASE}/${encodeURIComponent(sourceRef)}/test-connection`, { method:'POST', body:{} });
      const result = response?.result || {};
      if (wizardState) wizardState.testResult = { ok:result.ok === true, message:result.message || '' };
      else if (result.ok !== true) showCommandError('Connexion impossible', result.message || 'Le test a échoué.');
    } catch (error) {
      if (wizardState) wizardState.testResult = { ok:false, message:error.message };
      else showCommandError('Test de connexion', error.message);
    } finally {
      if (wizardState) wizardState.testing = false;
      await refresh({ preserve:true });
      rerenderWizard();
    }
  }

  async function runPrepare(sourceRef) {
    if (prepareState) return;
    const source = (lastPayload?.source_controls || []).find(item => item.source_ref === sourceRef) || {};
    prepareState = { sourceRef };
    activationState = {
      sourceRef,
      label: source.label || source.supplier_name || sourceRef,
      done: false,
      error: null,
      baselineRunRefs: (lastPayload?.lots || []).map(lot => lot.run_ref),
      runRef: null,
      run: null,
      outcome: null,
    };
    if (wizardState) wizardState.error = null;
    rerenderWizard();
    startActivationPolling();
    try {
      const response = await api(`${WIZARD_BASE}/${encodeURIComponent(sourceRef)}/prepare`, { method:'POST', body:{} });
      const result = response?.result || {};
      const runRef = result?.certification_run?.run_ref || null;
      if (wizardState) wizardState.firstRunRef = runRef;
      if (activationState?.sourceRef === sourceRef) {
        if (runRef) activationState.runRef = runRef;
        activationState.outcome = result?.certification_run?.status || null;
        activationState.done = true;
        if (activationState.runRef && params().run !== activationState.runRef) {
          global.history.pushState({}, '', urlFor(activationState.runRef));
        }
      }
    } catch (error) {
      const message = error.code === 'sourcing_source_certification_incomplete'
        ? 'Le premier passage n’a pas permis de certifier la source. Consultez le passage puis réessayez.'
        : error.message;
      const runRef = error.details?.run_ref || null;
      if (wizardState) { wizardState.error = message; wizardState.firstRunRef = runRef; }
      if (activationState?.sourceRef === sourceRef) {
        if (runRef) activationState.runRef = runRef;
        activationState.outcome = error.code === 'sourcing_source_certification_incomplete'
          ? 'certification_incomplete'
          : 'failed';
        activationState.error = error.code === 'sourcing_source_certification_incomplete' ? null : message;
        activationState.done = true;
        if (activationState.runRef && params().run !== activationState.runRef) {
          global.history.pushState({}, '', urlFor(activationState.runRef));
        }
      } else {
        showCommandError('Préparation', message);
      }
    } finally {
      stopActivationPolling();
      prepareState = null;
      await refresh({ preserve:true });
      rerenderWizard();
      if (activationState && typeof global.setTimeout === 'function') {
        global.setTimeout(() => {
          activationState = null;
          if (mountedRoot && lastPayload) render(mountedRoot, lastPayload);
        }, 5000);
      }
    }
  }

  async function saveConnectorRequest() {
    if (!wizardState || wizardState.saving) return;
    wizardState.saving = true;
    wizardState.error = null;
    rerenderWizard();
    try {
      const response = await api(`${WIZARD_BASE}/requests`, { method:'POST', body:{ ...wizardState.form } });
      if (wizardState) wizardState.requestSaved = response?.result || { status:'connector_required' };
    } catch (error) {
      if (wizardState) wizardState.error = error.message;
    } finally {
      if (wizardState) wizardState.saving = false;
      await refresh({ preserve:true });
      rerenderWizard();
    }
  }

  function wizardChecklist(source) {
    const caps = source?.capabilities || {};
    const row = (done, label) => `<li class="${done ? 'is-done' : 'is-todo'}"><span aria-hidden="true">${done ? '✓' : '○'}</span> ${label}</li>`;
    return `<ul class="kir-wizard-checklist" data-wizard-checklist>
      ${row(source?.connection?.verified === true, 'Connexion')}
      ${row(caps.discovery === true, 'Découverte fournisseur')}
      ${row(caps.sync === true, 'Synchronisation')}
      ${row(caps.import === true, 'Import')}
      ${row(source?.production_runtime_certified === true, 'Certification')}
    </ul>`;
  }

  function wizardConnectionStep(sourceControls) {
    const w = wizardState;
    const source = (sourceControls || []).find(item => item.source_ref === w.sourceRef) || null;
    const connector = (w.catalog || []).find(item => item.existing_source_ref === w.sourceRef || item.adapter === String(w.sourceRef || '').replace(/^api:/, '')) || null;
    const name = esc(source?.label || connector?.label || 'Source');
    const preparing = Boolean(prepareState && prepareState.sourceRef === w.sourceRef);
    const verified = source?.connection?.verified === true;
    const certified = source?.production_runtime_certified === true;
    const enabled = source?.autopilot_enabled === true;
    const onboarding = source?.onboarding || connector?.onboarding || null;
    const onboardingHolder = { onboarding, onboarding_ready: source?.onboarding_ready ?? connector?.onboarding_ready, auth: source?.auth || connector?.auth };
    const connect = connector?.connection_mode === 'oauth'
      ? `${onboardingGuidance(onboardingHolder)}
         <p class="kir-wizard-note">Reliez ensuite le compte fournisseur, puis testez la connexion.</p>
         <a class="kir-wizard-link" href="${esc(connector.connect_path || '#')}" target="_blank" rel="noopener" data-wizard-connect>Connecter le compte</a>`
      : credentialFields(source).length
        ? ''
        : `${onboardingGuidance(onboardingHolder)}
           <p class="kir-wizard-note">Aucun secret propre à cette source n’est saisi ni affiché ici.</p>`;
    const result = w.testResult
      ? (w.testResult.ok
        ? '<p class="kir-wizard-ok" data-wizard-test-result>✓ Connexion valide</p>'
        : `<p class="kir-wizard-error" role="alert" data-wizard-test-result>Connexion impossible<br><small>${esc(w.testResult.message)}</small></p>`)
      : '';
    let action;
    if (enabled) action = '<p class="kir-wizard-ok">Alimentation automatique active.</p>';
    else if (certified && source?.state === 'ready') {
      action = `<p class="kir-wizard-ok" data-wizard-ready>Source prête</p>
        <button type="button" class="kir-wizard-primary" data-wizard-activate data-source-ref="${esc(w.sourceRef)}">Activer l’alimentation automatique</button>`;
    } else if (preparing) {
      action = `<p class="kir-wizard-progress" data-wizard-preparing>PRÉPARATION → Connexion fournisseur → Premier passage → Certification</p>`;
    } else if (verified) {
      action = `<button type="button" class="kir-wizard-primary" data-wizard-prepare data-source-ref="${esc(w.sourceRef)}">Préparer et certifier</button>
        <p class="kir-wizard-note">Lance un premier passage borné réel pour certifier la source.</p>`;
    } else action = '';
    const follow = w.firstRunRef ? `<a class="kir-wizard-link" href="${urlFor(w.firstRunRef)}" data-wizard-follow>Voir le suivi du premier passage →</a>` : '';
    return `<p class="kir-wizard-ok" data-wizard-created>Source ajoutée · ${name}</p>
      <section class="kir-wizard-block"><h4>Connexion</h4>${connect}${source ? credentialsPanel(source, { context:'wizard' }) : ''}
        <button type="button" class="kir-wizard-secondary" data-wizard-test data-source-ref="${esc(w.sourceRef)}" ${w.testing || preparing ? 'disabled aria-busy="true"' : ''}>${w.testing ? 'Test en cours…' : 'Tester la connexion'}</button>
        ${result}</section>
      ${verified ? `<section class="kir-wizard-block"><h4>Préparation de la source</h4>${wizardChecklist(source)}${action}${follow}</section>` : ''}`;
  }

  function wizardMarkup(sourceControls) {
    if (!wizardState) return '';
    const w = wizardState;
    const error = w.error ? `<p class="kir-wizard-error" role="alert" data-wizard-error>${esc(w.error)}${w.existingRef ? ` <button type="button" class="kir-wizard-linkbtn" data-wizard-existing="${esc(w.existingRef)}">Voir la source existante</button>` : ''}</p>` : '';
    let body = '';
    if (w.step === 'type') {
      body = `<p class="kir-wizard-q">Quelle source souhaitez-vous ajouter ?</p>
        <div class="kir-wizard-choices">
          <button type="button" data-wizard-kind="api"><strong>API fournisseur</strong><span>Alimentation récurrente possible</span></button>
          <button type="button" data-wizard-kind="csv"><strong>CSV</strong><span>Import ponctuel d’un fichier</span></button>
          <button type="button" data-wizard-kind="manual"><strong>Saisie manuelle</strong><span>Produits saisis à la main</span></button>
        </div>`;
    } else if (w.step === 'manual_info') {
      body = `<p class="kir-wizard-q">${w.kind === 'csv' ? 'CSV' : 'Saisie manuelle'}</p>
        <p class="kir-wizard-note" data-wizard-manual-note>Cette source ne s’alimente pas automatiquement : elle se lance ponctuellement depuis l’import du Sourcing. Aucune alimentation automatique n’est créée.</p>
        <div class="kir-wizard-actions"><button type="button" class="kir-wizard-secondary" data-wizard-back>Retour</button><button type="button" class="kir-wizard-secondary" data-wizard-close>Fermer</button></div>`;
    } else if (w.step === 'provider') {
      const list = (w.catalog || []).map(connector => {
        const action = connector.existing_archived
          ? `<button type="button" class="kir-wizard-secondary" data-manage-restore data-source-ref="${esc(connector.existing_source_ref)}">Restaurer</button>`
          : connector.existing_source_ref
          ? `<button type="button" class="kir-wizard-secondary" data-wizard-existing="${esc(connector.existing_source_ref)}">Voir la source existante</button>`
          : connector.can_create
            ? `<button type="button" class="kir-wizard-primary" data-wizard-create="${esc(connector.adapter)}" ${w.creating ? 'disabled' : ''}>${w.creating === connector.adapter ? 'Ajout…' : 'Ajouter'}</button>`
            : '<span class="kir-wizard-unavailable">Indisponible</span>';
        return `<li data-wizard-connector="${esc(connector.adapter)}"><div><strong>${esc(connector.label)}</strong><span>${esc(connectorStatusLine(connector))}</span><small data-wizard-auth-requirement>${esc(connectorAuthLine(connector))}</small></div>${action}</li>`;
      }).join('');
      body = `<p class="kir-wizard-q">Quel fournisseur ?</p>
        ${w.loading ? '<p class="kir-wizard-note">Chargement des connecteurs…</p>' : `<ul class="kir-wizard-list">${list}
          <li data-wizard-connector="other"><div><strong>Autre fournisseur</strong><span>Étude API requise · aucun secret à demander tant que le contrat fournisseur n’est pas défini</span></div>
            <button type="button" class="kir-wizard-secondary" data-wizard-other>Choisir</button></li></ul>`}
        <div class="kir-wizard-actions"><button type="button" class="kir-wizard-secondary" data-wizard-back>Retour</button></div>`;
    } else if (w.step === 'other') {
      if (w.requestSaved) {
        body = `<p class="kir-wizard-q">Statut : <strong data-wizard-request-status>À étudier · connecteur requis</strong></p>
          <p class="kir-wizard-note">Prochaine étape : étudier l’API et formaliser le contrat fournisseur. Ne demandez aucun secret au partenaire tant que Komerce n’a pas défini ce qui est réellement requis.</p>
          <div class="kir-wizard-actions"><button type="button" class="kir-wizard-secondary" data-wizard-close>Configurer plus tard</button></div>`;
      } else {
        body = `<p class="kir-wizard-q">Autre fournisseur</p>
          <label class="kir-wizard-field">Nom du fournisseur<input type="text" data-wizard-field="provider_name" maxlength="80" value="${esc(w.form.provider_name)}" required></label>
          <label class="kir-wizard-field">Nom souhaité de la source<input type="text" data-wizard-field="requested_label" maxlength="80" value="${esc(w.form.requested_label)}"></label>
          <label class="kir-wizard-field">Site / référence (facultatif)<input type="text" data-wizard-field="reference_url" maxlength="300" value="${esc(w.form.reference_url)}"></label>
          <div class="kir-wizard-actions"><button type="button" class="kir-wizard-secondary" data-wizard-back>Retour</button>
            <button type="button" class="kir-wizard-primary" data-wizard-save-request ${w.saving ? 'disabled' : ''}>${w.saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>`;
      }
    } else if (w.step === 'connection') {
      body = wizardConnectionStep(sourceControls);
    }
    return `<div class="kir-wizard-backdrop" data-wizard-backdrop>
      <section class="kir-wizard" role="dialog" aria-modal="true" aria-label="Ajouter une source" data-source-wizard data-wizard-step="${esc(w.step)}">
        <header class="kir-wizard-head"><h3>Ajouter une source</h3><button type="button" class="kir-wizard-close" data-wizard-close aria-label="Fermer">×</button></header>
        ${error}${body}
      </section></div>`;
  }

  // Gestion des sources : renommer, archiver / restaurer, modifier / retirer une demande.
  // Aucune suppression de source : l'archive conserve captures, observations et KIR.
  async function manageCall(path, method, body) {
    try {
      await api(`${WIZARD_BASE}${path}`, { method, body });
      manageState = null;
    } catch (error) {
      manageState = null;
      showCommandError('Gestion de la source', error.message);
    }
    await refresh({ preserve:true });
    rerenderWizard();
  }

  function setManage(state) {
    manageState = state;
    rerenderWizard();
    const input = mountedRoot?.querySelector?.('[data-manage-input]');
    if (input) { input.focus?.(); input.select?.(); }
  }

  function bindManage(root, payload) {
    const sources = Array.isArray(payload?.source_controls) ? payload.source_controls : [];
    const requests = Array.isArray(payload?.source_requests) ? payload.source_requests : [];
    const each = (selector, handler) => root.querySelectorAll?.(selector).forEach(node => node.addEventListener('click', event => {
      event.preventDefault();
      handler(node);
    }));
    each('[data-manage-rename]', node => {
      const ref = node.getAttribute('data-source-ref');
      const source = sources.find(item => item.source_ref === ref);
      setManage({ kind:'rename', ref, value:source?.label || '' });
    });
    each('[data-manage-archive]', node => setManage({ kind:'archive', ref:node.getAttribute('data-source-ref') }));
    each('[data-manage-archive-confirm]', node => manageCall(`/${encodeURIComponent(node.getAttribute('data-source-ref'))}/archive`, 'POST', {}));
    each('[data-manage-restore]', async node => {
      const ref = node.getAttribute('data-source-ref');
      await manageCall(`/${encodeURIComponent(ref)}/restore`, 'POST', {});
      if (wizardState) viewExistingSource(ref);
    });
    each('[data-manage-rename-request]', node => {
      const ref = node.getAttribute('data-request-ref');
      const request = requests.find(item => item.request_ref === ref);
      setManage({ kind:'rename-request', ref, value:request?.requested_label || request?.provider_name || '' });
    });
    each('[data-manage-remove-request]', node => setManage({ kind:'remove-request', ref:node.getAttribute('data-request-ref') }));
    each('[data-manage-remove-confirm]', node => manageCall(`/requests/${encodeURIComponent(node.getAttribute('data-request-ref'))}`, 'DELETE'));
    each('[data-manage-cancel]', () => setManage(null));
    root.querySelectorAll?.('[data-manage-form]').forEach(form => {
      form.querySelector('[data-manage-input]')?.addEventListener('input', event => { if (manageState) manageState.value = event.target.value; });
      form.addEventListener('submit', event => {
        event.preventDefault();
        const value = String(form.querySelector('[data-manage-input]')?.value || '').trim();
        if (form.getAttribute('data-manage-form') === 'rename-request') {
          manageCall(`/requests/${encodeURIComponent(form.getAttribute('data-request-ref'))}`, 'PATCH', { requested_label:value });
        } else {
          manageCall(`/${encodeURIComponent(form.getAttribute('data-source-ref'))}`, 'PATCH', { label:value });
        }
      });
    });
  }

  function bindWizard(root, payload) {
    root.querySelectorAll?.('[data-add-source]').forEach(button => {
      button.addEventListener('click', () => openWizard());
    });
    root.querySelectorAll?.('[data-source-step]').forEach(button => {
      button.addEventListener('click', () => {
        const sourceRef = button.getAttribute('data-source-ref');
        if (!sourceRef || button.disabled) return;
        if (button.getAttribute('data-source-step') === 'test') runConnectionTest(sourceRef);
        else runPrepare(sourceRef);
      });
    });
    const wizard = root.querySelector?.('[data-source-wizard]');
    if (!wizard || !wizardState) return;
    root.querySelector('[data-wizard-backdrop]')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeWizard();
    });
    wizard.querySelectorAll('[data-wizard-close]').forEach(button => button.addEventListener('click', closeWizard));
    wizard.querySelectorAll('[data-wizard-back]').forEach(button => button.addEventListener('click', () => {
      wizardState.error = null;
      wizardState.existingRef = null;
      wizardState.step = wizardState.step === 'other' ? 'provider' : 'type';
      rerenderWizard();
    }));
    wizard.querySelectorAll('[data-wizard-kind]').forEach(button => button.addEventListener('click', () => {
      const kind = button.getAttribute('data-wizard-kind');
      wizardState.kind = kind;
      wizardState.error = null;
      if (kind === 'api') {
        wizardState.step = 'provider';
        loadWizardCatalog();
      } else {
        wizardState.step = 'manual_info';
        rerenderWizard();
      }
    }));
    wizard.querySelectorAll('[data-wizard-create]').forEach(button => button.addEventListener('click', () => createWizardSource(button.getAttribute('data-wizard-create'))));
    wizard.querySelectorAll('[data-wizard-existing]').forEach(button => button.addEventListener('click', () => viewExistingSource(button.getAttribute('data-wizard-existing'))));
    wizard.querySelectorAll('[data-wizard-other]').forEach(button => button.addEventListener('click', () => {
      wizardState.step = 'other';
      wizardState.error = null;
      rerenderWizard();
    }));
    wizard.querySelectorAll('[data-wizard-field]').forEach(input => input.addEventListener('input', () => {
      wizardState.form[input.getAttribute('data-wizard-field')] = input.value;
    }));
    wizard.querySelectorAll('[data-wizard-save-request]').forEach(button => button.addEventListener('click', saveConnectorRequest));
    wizard.querySelectorAll('[data-wizard-test]').forEach(button => button.addEventListener('click', () => runConnectionTest(button.getAttribute('data-source-ref'))));
    wizard.querySelectorAll('[data-wizard-prepare]').forEach(button => button.addEventListener('click', () => runPrepare(button.getAttribute('data-source-ref'))));
    wizard.querySelectorAll('[data-wizard-activate]').forEach(button => button.addEventListener('click', () => {
      const sourceRef = button.getAttribute('data-source-ref');
      wizardState = null;
      toggleSource(root, lastPayload || payload, sourceRef, false, button);
    }));
    wizard.querySelectorAll('[data-wizard-follow]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      const href = link.getAttribute('href');
      wizardState = null;
      if (href) goto(href);
    }));
  }

  function bindSourceControls(root, payload) {
    root.querySelectorAll?.('[data-source-first-import]').forEach(button => {
      button.addEventListener('click', () => {
        const sourceRef = button.getAttribute('data-source-ref');
        if (!sourceRef || button.disabled) return;
        startFirstImport(root, payload, sourceRef);
      });
    });
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
        if (command === 'update') {
          if (typeof global.confirm === 'function' &&
              !global.confirm('Démarrer un nouvel import fournisseur ? Un passage KIR sera créé.')) return;
          return updateSourceNow(root, sourceRef);
        }
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

  // Une tâche de production ne doit jamais demander une clé technique dans prompt().
  // Un seul panneau accessible : preuve produit → suggestions canoniques → choix humain → scan audité.
  function closeCategoryDialog() {
    const dialog = categoryDialogState;
    categoryDialogState = null;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.remove?.();
  }

  async function openCategoryDialog(root, button) {
    if (categoryDialogState || button.disabled) return;
    const ref = button.getAttribute('data-candidate-ref');
    if (!ref) return;
    const dialog = global.document.createElement('dialog');
    dialog.className = 'kir-category-dialog';
    dialog.setAttribute('data-category-remediation', '');
    dialog.setAttribute('aria-labelledby', 'kir-category-heading');
    dialog.innerHTML = `<div class="kir-category-dialog-inner">
      <h2 id="kir-category-heading">Classer ce produit</h2>
      <p>Chargement des catégories Komerce…</p>
      <button type="button" data-category-cancel>Fermer</button>
    </div>`;
    root.appendChild(dialog);
    categoryDialogState = dialog;
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute('open', '');
    const cancel = () => { if (!dialog.hasAttribute('data-category-saving')) closeCategoryDialog(); };
    dialog.querySelector('[data-category-cancel]')?.addEventListener('click', cancel);
    dialog.addEventListener('cancel', event => {
      if (dialog.hasAttribute('data-category-saving')) event.preventDefault();
      else { event.preventDefault(); closeCategoryDialog(); }
    });
    try {
      const data = await api(`/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(ref)}/category-options`);
      if (categoryDialogState !== dialog) return;
      const categories = Array.isArray(data.categories) ? data.categories : [];
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter(entry =>
        categories.some(category=>category.key===entry.key)).slice(0,3) : [];
      const suggestedKeys = new Set(suggestions.map(entry=>entry.key));
      const opts = cat => `<option value="${esc(cat.key)}" ${cat.key===data.current_category ? 'selected' : ''}>${esc(cat.label)} (${esc(cat.key)})</option>`;
      const first = suggestions.length ? `<optgroup label="Suggestions du moteur — à confirmer">${suggestions.map(entry => opts(categories.find(cat=>cat.key===entry.key))).join('')}</optgroup>` : '';
      const remaining = categories.filter(cat=>!suggestedKeys.has(cat.key));
      const rest = `<optgroup label="Toutes les autres catégories actives">${remaining.map(opts).join('')}</optgroup>`;
      dialog.innerHTML = `<form class="kir-category-form" data-category-form>
        <div class="kir-category-head">
          <span>REMÉDIATION SOURCING · ${esc(ref)}</span>
          <h2 id="kir-category-heading">Classer ce produit</h2>
          <p>Choisissez sa <b>catégorie de calcul Sourcing / Douane</b>. Ce n'est pas une rubrique de navigation de la boutique.</p>
        </div>
        <div class="kir-category-product">
          ${data.image_url ? `<img src="${esc(data.image_url)}" alt="" loading="lazy">` : ''}
          <div><strong>${esc(data.product_name || button.getAttribute('data-product-name') || ref)}</strong>
          <small>Catégorie fournisseur : ${esc(data.supplier_category || 'Non renseignée')}</small>
          <small>Pourquoi ? ${esc(button.getAttribute('data-action-reason') || 'Catégorie non déterminée')}</small></div>
        </div>
        ${suggestions.length ? `<div class="kir-category-suggestions"><strong>Suggestions calculées — à vérifier</strong>
          <div>${suggestions.map(entry=>`<button type="button" data-suggest-key="${esc(entry.key)}">${esc(entry.label)} · ${entry.confidence==='high' ? 'forte' : entry.confidence==='medium' ? 'moyenne' : 'faible'} correspondance</button>`).join('')}</div></div>` : '<p class="kir-category-no-suggestion">Aucune correspondance fiable détectée. Choisissez une catégorie dans la liste ; aucune valeur ne sera devinée.</p>'}
        <label for="kir-category-choice">Catégorie Komerce existante</label>
        <select id="kir-category-choice" data-category-choice required>
          <option value="">— Choisir une catégorie —</option>
          ${first}${rest}
        </select>
        <p class="kir-category-note">Le choix sera enregistré avec une trace d'audit puis le scanner réévaluera le produit. Aucune publication ni commande fournisseur automatique.</p>
        <p class="kir-category-feedback" data-category-feedback role="status" aria-live="polite"></p>
        <div class="kir-category-buttons"><button type="button" data-category-cancel>Annuler</button>
        <button type="submit" data-category-confirm>Confirmer et réanalyser</button></div>
      </form>`;
      const form=dialog.querySelector('[data-category-form]');
      const select=dialog.querySelector('[data-category-choice]');
      const feedback=dialog.querySelector('[data-category-feedback]');
      const submit=dialog.querySelector('[data-category-confirm]');
      dialog.querySelector('[data-category-cancel]')?.addEventListener('click', cancel);
      dialog.querySelectorAll('[data-suggest-key]').forEach(suggestion=>{
        suggestion.addEventListener('click',()=>{
          select.value=suggestion.getAttribute('data-suggest-key');
          select.focus();
        });
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const categoryKey=select.value;
        if (!categoryKey || !categories.some(category=>category.key===categoryKey)) {
          feedback.textContent='Sélectionnez une catégorie existante pour continuer.';
          select.focus();
          return;
        }
        if (dialog.hasAttribute('data-category-saving')) return;
        dialog.setAttribute('data-category-saving','');
        submit.disabled=true;
        select.disabled=true;
        feedback.textContent='Enregistrement et nouveau scan en cours…';
        try {
          const result=await api(`/api/admin/workspaces/sourcing/candidates/${encodeURIComponent(ref)}/resolve-category`,
            {method:'POST',body:{category_key:categoryKey}});
          if (categoryDialogState !== dialog) return;
          const saved=result.result || {};
          const success=`Catégorie « ${saved.category?.label || categoryKey} » enregistrée et produit réanalysé. Décision : ${saved.scan?.decision || 'à vérifier'}.`;
          closeCategoryDialog();
          await refresh({preserve:true});
          const main=mountedRoot?.querySelector?.('.kir-main');
          if(main) main.insertAdjacentHTML('afterbegin',`<div class="kir-category-success" role="status">${esc(success)} Aucun produit n'a été publié automatiquement.</div>`);
        } catch(error) {
          if (categoryDialogState !== dialog) return;
          feedback.textContent=error.message || 'La correction n’a pas pu être enregistrée.';
          dialog.removeAttribute('data-category-saving');
          submit.disabled=false;
          select.disabled=false;
        }
      });
      select.focus();
    } catch(error) {
      if (categoryDialogState !== dialog) return;
      const body=dialog.querySelector('.kir-category-dialog-inner');
      if (body) body.innerHTML=`<h2 id="kir-category-heading">Classement indisponible</h2>
        <p role="alert">${esc(error.message || 'Le référentiel ne peut pas être chargé.')}</p>
        <button type="button" data-category-cancel>Fermer</button>`;
      dialog.querySelector('[data-category-cancel]')?.addEventListener('click',cancel);
    }
  }

  function bindActionList(root) {
    root.querySelectorAll?.('[data-action-classify]').forEach(button => {
      button.addEventListener('click', () => openCategoryDialog(root, button));
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

  function goto(href) {
    global.history.pushState({}, '', href);
    scrollToDrill = true;
    refresh({ preserve:true });
  }

  function bindPassageRows(root) {
    root.querySelectorAll?.('[data-row-href]').forEach(row => {
      const open = () => goto(row.getAttribute('data-row-href'));
      row.addEventListener('click', event => { if (!event.target.closest?.('a')) open(); });
      row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
    });
  }

  function bindPassages(root, payload) {
    root.querySelectorAll?.('[data-lot-select]').forEach(select => {
      select.addEventListener('change', () => goto(urlFor(select.value)));
    });
    bindPassageRows(root);
    root.querySelectorAll?.('[data-passage-filter]').forEach(control => {
      control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => {
        passageFilters[control.getAttribute('data-passage-filter')] = control.value;
        // replaceState : le filtre fait partie de l'entrée d'historique courante sans la multiplier.
        const here = params();
        global.history.replaceState({}, '', passagesUrl(here.run, here.offset, passageFilters));
        const body = root.querySelector?.('[data-passages-body]');
        if (body) {
          body.innerHTML = passageRows(payload?.passages);
          bindPassageRows(root);
          bindNavigation(body);
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
        scrollToDrill = true;
        refresh({ preserve:true });
      });
    });
  }

  async function refresh({ preserve = false } = {}) {
    if (!mountedRoot || !global.document.contains(mountedRoot) || global.location.pathname !== '/admin/import-runtime') {
      releaseListeners();
      return;
    }
    const token = beginRefreshRead();
    if (!preserve && !lastPayload) renderLoading(mountedRoot);
    const { run, view, offset, item, kind } = params();
    const query = new URLSearchParams({ limit:'12' });
    if (run) query.set('run', run);
    try {
      const payload = await api('/api/admin/workspaces/sourcing/import-cockpit?' + query.toString());
      if (!refreshStillCurrent(token)) return;
      attachActivationRun(payload);
      // Les populations (produits qui composent un chiffre) sont lues à la demande, à chaque rafraîchissement.
      if (view === 'passages') {
        try {
          const page = await api(`/api/admin/workspaces/sourcing/import-passages?limit=50&offset=${offset}`);
          payload.passages = page.passages || [];
          payload.passages_page = page;
        } catch (_) {
          payload.passages = [];
          payload.passages_page = { offset, next_offset:null };
        }
        if (!refreshStillCurrent(token)) return;
      }
      const populationKind = view === 'population' ? params().kind : view === 'handoff' ? 'ready' : null;
      if (populationKind && payload?.selected?.run_ref) {
        try {
          payload.population = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(payload.selected.run_ref)}/population?kind=${populationKind}`);
        } catch (_) { payload.population = null; }
        if (!refreshStillCurrent(token)) return;
      }
      if (view === 'item' && item && payload?.selected?.run_ref) {
        try {
          payload.item_trace = await api(`/api/admin/workspaces/sourcing/import-runs/${encodeURIComponent(payload.selected.run_ref)}/items/${encodeURIComponent(item)}`);
        } catch (_) { payload.item_trace = null; }
        if (!refreshStillCurrent(token)) return;
      }
      if (!refreshStillCurrent(token)) return;
      lastPayload = payload;
      // Ne pas casser une saisie de filtre en cours : le prochain rafraîchissement la reprendra.
      const typing = global.document?.activeElement?.hasAttribute?.('data-passage-filter');
      const wizardTyping = Boolean(wizardState)
        && /^(INPUT|TEXTAREA)$/.test(String(global.document?.activeElement?.tagName || ''))
        && Boolean(global.document?.activeElement?.closest?.('[data-source-wizard]'));
      if (!(typing && view === 'passages') && !wizardTyping && !categoryDialogState) render(mountedRoot, payload);
    } catch (error) {
      // Une erreur issue d'une lecture devenue obsolète ne doit ni repeindre l'écran ni afficher une alerte.
      if (!refreshStillCurrent(token)) return;
      // Jamais réafficher le passage précédent sous l'URL d'un autre : le contexte suit le KIR demandé.
      const sameRun = !run || lastPayload?.selected?.run_ref === run;
      if (lastPayload && sameRun) {
        render(mountedRoot, lastPayload);
        const main = mountedRoot.querySelector?.('.kir-main');
        if (main) main.insertAdjacentHTML('afterbegin', `<div class="kir-error">Actualisation impossible · ${esc(error.message)}</div>`);
      } else {
        mountedRoot.innerHTML = `<div class="kir-error">Cockpit indisponible · ${esc(error.message)}</div>`;
      }
    }
  }

  // Utilisateur de la session : réserve le lien « Continuer → Raffinerie » au rôle qui a cet espace (admin).
  let viewer = null;

  async function mount(options = {}) {
    if (!options.root) throw new Error('canonical_import_runtime_root_missing');
    viewer = options.user || null;
    mountedRoot = options.root;
    if (global.__KOMERCE_LEGACY_PROOF__ !== true) {
      const locationQuery = new URLSearchParams(global.location?.search || '');
      if (locationQuery.get('view') === 'handoff') {
        locationQuery.delete('view');
        const next = '/admin/import-runtime' + (locationQuery.toString() ? '?' + locationQuery.toString() : '');
        global.history?.replaceState?.({}, '', next);
      }
    }
    lastPayload = null;
    // Invalide toute lecture encore en vol d'un montage précédent.
    refreshEpoch += 1;
    activationState = null;
    firstImportState = null;
    closeCategoryDialog();
    prepareState = null;
    wizardState = null;
    stopActivationPolling();
    renderLoading(mountedRoot);
    releaseListeners();
    listen(global, 'popstate', () => refresh({ preserve:true }));
    // Retour sur l'onglet après une correction ailleurs : la vérité est relue immédiatement.
    listen(global, 'focus', () => refresh({ preserve:true }));
    listen(global.document, 'visibilitychange', () => {
      if (global.document.visibilityState === 'visible') refresh({ preserve:true });
    });
    listen(global.document, 'keydown', event => {
      if (event.key === 'Escape' && wizardState) closeWizard();
    });
    await refresh({ preserve:true });
    // Onglet masqué : aucune relecture (elle reprend à la visibilité, ci-dessus).
    timer = setInterval(() => {
      if (global.document?.visibilityState === 'hidden') return;
      refresh({ preserve:true });
    }, POLL_MS);
  }

  global.KomerceCanonicalImportRuntime = Object.freeze({ mount, render, businessLabel, urlFor, withReturnTo });
})(typeof window !== 'undefined' ? window : globalThis);
