Warning: truncated output (original token count: 45929)
Total output lines: 3115

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
                ? `${label} · ${activationState.runRef} · le même passage avance de…35929 tokens truncated…torAll('[data-wizard-back]').forEach(button => button.addEventListener('click', () => {
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
