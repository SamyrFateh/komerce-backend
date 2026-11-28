/**
 * @komerce-arch
 * @role          canonical-action-center-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_action_center_operator, server_admin_context, canonical_action_center_projection
 * @outputs       canonical_action_center_dom, authorized_signal_lifecycle_requests
 * @depends       canonical primitives, /api/admin/dashboard/context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      action_center_handles_derived_signals_only, server_admin_context_selects_market_endpoint, browser_signal_ref_only, canonical_admin_no_legacy_imports, agent_view_is_same_surface_filtered_by_server_scope, agent_actions_acknowledge_snooze_only
 * @impact-areas  admin-dashboard, decision-signals, market-authorization
 * @version       2026-09
 */

'use strict';

(function initActionCenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalActionCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createActionCenter() {
  const ENDPOINT = '/api/admin/action-center';
  const CONTEXT_ENDPOINT = '/api/admin/dashboard/context';
  const AGENT_ENDPOINT = '/api/agent/action-center';
  const AGENT_ROLES = Object.freeze(['agent_hub', 'agent_relais', 'agent_transitaire']);

  function isAgentUser(user) {
    return Boolean(user && AGENT_ROLES.includes(user.role));
  }

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

  function selectedMarketCode(adminContext, locationLike) {
    const access = adminContext && adminContext.access ? adminContext.access : {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets.map(code => String(code).toUpperCase()) : [];
    if (!allowed.length || !['market','global'].includes(access.mode)) return null;

    let requested = null;
    try {
      if (locationLike && locationLike.href) requested = new URL(locationLike.href).searchParams.get('market');
    } catch (_) {}
    if (requested && allowed.includes(String(requested).toUpperCase())) return String(requested).toUpperCase();
    if (access.mode === 'global') return null;

    const preferred = access.defaultMarket ? String(access.defaultMarket).toUpperCase() : null;
    if (preferred && allowed.includes(preferred)) return preferred;
    return allowed[0] || null;
  }

  function severityFilterFromLocation(locationLike) {
    try {
      if (!locationLike || !locationLike.href) return null;
      const raw = new URL(locationLike.href).searchParams.get('severity');
      if (!raw) return null;
      // Liste blanche stricte — jamais une valeur arbitraire du navigateur
      // envoyée telle quelle au serveur au-delà de ce que le contrat
      // signals.severity accepte réellement.
      const allowed = new Set(['urgent', 'critical', 'warning', 'info']);
      const values = raw.split(',').map(s => s.trim()).filter(v => allowed.has(v));
      return values.length ? values.join(',') : null;
    } catch (_) {
      return null;
    }
  }

  async function resolveRuntimeScope(options) {
    const adminContext = options.adminContext || await jsonRequest(options.fetch, CONTEXT_ENDPOINT);
    const locationLike = options.location || (typeof globalThis !== 'undefined' ? globalThis.location : null);
    const marketCode = selectedMarketCode(adminContext, locationLike);
    const severity = severityFilterFromLocation(locationLike);
    const query = severity ? `?severity=${encodeURIComponent(severity)}` : '';
    if (marketCode || (adminContext && adminContext.access && adminContext.access.mode === 'market')) {
      if (!marketCode) {
        const error = new Error('Aucun Market ID autorisé pour le Centre d’actions');
        error.code = 'action_center_market_context_missing';
        throw error;
      }
      const endpoint = `${ENDPOINT}/market/${encodeURIComponent(marketCode)}`;
      return {
        mode: 'market',
        marketCode,
        severity,
        endpoint,
        loadEndpoint: `${endpoint}${query}`,
        adminContext,
      };
    }
    return {
      mode: 'global', marketCode: null, severity,
      endpoint: ENDPOINT, loadEndpoint: `${ENDPOINT}${query}`, adminContext,
    };
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-action-center-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function header(doc, payload, severity) {
    const node = doc.createElement('header');
    node.className = 'kmc-workspace-header';
    node.setAttribute('data-dashboard-role', 'hero');
    const market = payload && payload.scope && payload.scope.market;

    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'ACTION CENTER'));
    if (payload && payload.role) {
      copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Mes actions'));
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Ce qui demande votre intervention maintenant.'));
    } else {
      copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', market ? `Décisions · ${market.name || market.code}` : 'Décisions à traiter'));
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', market
        ? 'Les points qui demandent une décision sur ce marché.'
        : 'Les points qui demandent une décision maintenant.'));
    }

    if (severity) {
      const filterLine = doc.createElement('p');
      filterLine.className = 'kmc-workspace-subtitle kmc-action-center-filter';
      filterLine.appendChild(text(doc, 'strong', '', `Filtre · ${severity.split(',').map(severityLabel).join(', ')}`));
      filterLine.appendChild(doc.createTextNode(' · '));
      const clear = text(doc, 'a', 'kmc-workspace-nav-link', 'Tout afficher');
      clear.href = market ? `/admin/action-center?market=${encodeURIComponent(market.code)}` : '/admin/action-center';
      filterLine.appendChild(clear);
      copy.appendChild(filterLine);
    }
    node.appendChild(copy);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.dataset.actionCenterFeedback = '';
    feedback.setAttribute('role', 'status');
    node.appendChild(feedback);
    return node;
  }

  function metricItems(summary = {}) {
    const critical = Number(summary.urgent || 0);
    const warning = Number(summary.warning || 0);
    return [
      { key: 'urgent', label: 'Critiques', value: critical, tone: critical ? 'critical' : 'neutral' },
      { key: 'warning', label: 'Avertissements', value: warning, tone: warning ? 'warning' : 'neutral' },
      { key: 'total', label: 'Total à traiter', value: Number(summary.total_active || 0), tone: 'neutral' },
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

  // Retour vers l'Action Center (filtres conservés) depuis les fiches 360 et les PO.
  function withReturn(href, signalRef) {
    const nav = globalThis.KomerceCanonicalNavigation;
    const loc = globalThis.location;
    if (!nav || typeof nav.withEntityReturnTo !== 'function' || !loc) return href;
    const target=`${loc.pathname || '/admin/action-center'}${loc.search || ''}${/^KSG-\\d{6,}$/.test(signalRef||'')?'#signal-'+signalRef:''}`;
    return nav.withEntityReturnTo(href,target,'Retour à À traiter');
  }

  function ageLabel(value, now = Date.now()) {
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return '';
    const minutes = Math.max(0, Math.round((now - t) / 60000));
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
    return `${Math.round(minutes / 1440)} j`;
  }

  function ownerLabel(role) {
    return ({hub:'Hub',relais:'Relais',customs:'Douane / transitaire',transitaire:'Transitaire',logistics:'Logistique',purchasing:'Achats',finance:'Finance',admin:'Administration',sourcing:'Sourcing',support:'Support'})[role]||'Responsable métier';
  }

  function restoreSignal(rootNode,loc=globalThis.location) {
    const hash=String(loc?.hash||'');
    if(!/^#signal-KSG-\d{6,}$/.test(hash))return false;
    const card=rootNode.querySelector?.(hash);
    if(!card)return false;
    const group=card.closest?.('details.kmc-action-group');
    if(group)group.open=true;
    card.scrollIntoView?.({block:'nearest'});
    return true;
  }

  function renderSignal(doc, row) {
    const card = doc.createElement('article');
    const severity = ['urgent', 'critical', 'warning', 'info'].includes(String(row.severity || '').toLowerCase())
      ? String(row.severity).toLowerCase()
      : 'info';
    card.className = `kmc-action-signal is-${severity}`;
    card.dataset.signalRef = row.signal_ref;
    if(/^KSG-\\d{6,}$/.test(row.signal_ref||'')) card.id='signal-'+row.signal_ref;
    card.dataset.severity = severity;

    const refLabel = (row.entity && (row.entity.ref || row.entity.label)) || row.signal_ref;
    const top = doc.createElement('div');
    top.className = 'kmc-action-signal-top';
    top.appendChild(text(doc, 'strong', 'kmc-action-signal-ref', refLabel));
    top.appendChild(text(doc, 'span', 'kmc-action-signal-domain', FAMILY_LABELS[row.family] || ''));
    const age = ageLabel(row.created_at);
    if (age) top.appendChild(text(doc, 'span', 'kmc-action-signal-age', age));
    card.appendChild(top);

    card.appendChild(text(doc, 'p', 'kmc-action-signal-cause', row.summary || row.title));
    if (row.recommendation) card.appendChild(text(doc, 'p', 'kmc-action-signal-next', `Prochaine action · ${row.recommendation}`));
    if(row.work_item?.owner_role) card.appendChild(text(doc,'p','kmc-action-signal-age','Responsable · '+ownerLabel(row.work_item.owner_role)));
    if(row.exception_evidence) card.appendChild(text(doc,'p','kmc-action-signal-age',row.exception_evidence.closure==='source_reconciliation'?'Clôture sur constat métier réconcilié':'Contrôle distinct — preuve à établir'));

    const bar = doc.createElement('div');
    bar.className = 'kmc-action-signal-bar';
    if (row.work_item && row.work_item.actionable && row.work_item.href) {
      const work = text(doc, 'a', 'kmc-workspace-action', 'Traiter');
      work.href = withReturn(row.work_item.href,row.signal_ref);
      work.dataset.actionCenterWorkItem = row.signal_ref;
      bar.appendChild(work);
    } else if (row.entity && row.entity.href) {
      const link = text(doc, 'a', 'kmc-workspace-action', 'Traiter');
      link.href = withReturn(row.entity.href,row.signal_ref);
      bar.appendChild(link);
    }
    const allowed = new Set(row.actions || []);
    if (allowed.size) {
      const more = doc.createElement('details');
      more.className = 'kmc-action-signal-more';
      more.appendChild(text(doc, 'summary', '', '⋯'));
      const actions = doc.createElement('div');
      actions.className = 'kmc-workspace-nav';
      if (allowed.has('acknowledge')) actions.appendChild(actionButton(doc, 'Vu', 'acknowledge', row.signal_ref));
      if (allowed.has('snooze')) actions.appendChild(actionButton(doc, 'Reporter 24 h', 'snooze', row.signal_ref));
      if (allowed.has('resolve')) actions.appendChild(actionButton(doc, 'Résolu', 'resolve', row.signal_ref, false));
      more.appendChild(actions);
      bar.appendChild(more);
    }
    card.appendChild(bar);
    return card;
  }

  // Regroupe les incidents de même nature sans masquer les dossiers : le groupe se déplie.
  function renderSignalGroups(doc, host, rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = `${row.family || 'other'}|${row.title}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    groups.forEach(list => {
      if (list.length === 1) { host.appendChild(renderSignal(doc, list[0])); return; }
      const details = doc.createElement('details');
      details.className = 'kmc-action-group';
      const head = doc.createElement('summary');
      head.appendChild(text(doc, 'strong', '', `${list[0].title} · ${list.length}`));
      head.appendChild(text(doc, 'span', 'kmc-action-signal-domain', FAMILY_LABELS[list[0].family] || ''));
      details.appendChild(head);
      list.forEach(row => details.appendChild(renderSignal(doc, row)));
      host.appendChild(details);
    });
  }

  function renderAgentSignals(rootNode, ui, doc, payload) {
    const rows = payload.signals || [];
    const section = ui.Section.create({
      title: rows.length ? `Signaux de mon périmètre · ${rows.length}` : 'Aucun signal actif',
      description: rows.length
        ? 'Traitez uniquement ce qui demande votre intervention.'
        : 'Aucune décision n’est actuellement requise dans votre périmètre.',
    });
    rows.forEach(row => section.slot.appendChild(renderSignal(doc, row)));
    rootNode.appendChild(section.element);
  }

  function renderFamilies(rootNode, ui, doc, payload, state = {}) {
    const all = payload.signals || [];
    const domain = state.domain || '';
    const rows = all.filter(signal => !domain || (signal.family || 'other') === domain);

    const bar = doc.createElement('div');
    bar.className = 'kmc-action-filters';
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Filtrer par domaine');
    select.dataset.actionCenterDomain = '';
    [['', 'Tous les domaines'], ...Object.entries(FAMILY_LABELS)].forEach(([value, label]) => {
      const option = text(doc, 'option', '', label);
      option.value = value;
      if (value === domain) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => { if (state.onDomain) state.onDomain(select.value); });
    bar.appendChild(select);
    const markets = state.markets || [];
    if (markets.length) {
      const market = doc.createElement('select');
      market.setAttribute('aria-label', 'Filtrer par marché');
      market.dataset.actionCenterMarket = '';
      [['', 'Signaux centraux'], ...markets.map(code => [code, code])].forEach(([value, label]) => {
        const option = text(doc, 'option', '', label);
        option.value = value;
        if (value === (state.market || '')) option.selected = true;
        market.appendChild(option);
      });
      market.addEventListener('change', () => { if (state.onMarket) state.onMarket(market.value); });
      bar.appendChild(market);
    }
    bar.appendChild(text(doc, 'span', 'kmc-action-signal-age', 'Se ferme automatiquement quand la cause disparaît. Les contrôles manuels exigent une preuve.'));
    rootNode.appendChild(bar);

    const grid = doc.createElement('div');
    grid.className = 'kmc-action-columns';
    const columns = [
      ['Urgent / critique', signal => ['urgent', 'critical'].includes(String(signal.severity).toLowerCase()), 'critical'],
      ['Avertissements', signal => !['urgent', 'critical'].includes(String(signal.severity).toLowerCase()), 'warning'],
    ];
    columns.forEach(([title, pick, tone]) => {
      const list = rows.filter(pick);
      const col = doc.createElement('section');
      col.className = `kmc-action-column is-${tone}`;
      col.appendChild(text(doc, 'h2', 'kmc-action-column-title', `${title} · ${list.length} sur cette page`));
      if (!list.length) col.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Rien à traiter.'));
      else renderSignalGroups(doc, col, list);
      grid.appendChild(col);
    });
    rootNode.appendChild(grid);
  }

  async function runAction(context, button, path, body, successMessage) {
    if(context.actionPending)return null;
    context.actionPending=true;
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, path, { method: 'POST', body: body || {} });
      if(context.root.__dashboardViewIdentity===context.identity){
        try { await context.reload(); setFeedback(context.root, successMessage, 'positive'); }
        catch (_) { setFeedback(context.root, 'Action enregistrée ; actualisation indisponible.', 'warning'); }
      }
      return result;
    } catch (error) {
      if(context.root.__dashboardViewIdentity===context.identity)setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    } finally { context.actionPending=false; }
  }

  function bind(rootNode, context) {
    if (rootNode.__actionCenterClickHandler) rootNode.removeEventListener('click',rootNode.__actionCenterClickHandler);
    const handler = async event => {
      const button = event.target.closest('[data-action-center-action]');
      if (!button || button.disabled || context.actionPending || rootNode.__dashboardViewIdentity !== context.identity) return;
      const action = button.dataset.actionCenterAction;
      const signalRef = button.dataset.signalRef;

      if (action === 'generate') {
        if (context.scopeMode !== 'global') return;
        await runAction(context, button, `${ENDPOINT}/generate`, {}, 'Signaux régénérés.');
        return;
      }
      if (!signalRef) return;
      const signalPath = context.scopeMode === 'agent'
        ? `${context.endpoint}/${encodeURIComponent(signalRef)}`
        : `${context.endpoint}/signals/${encodeURIComponent(signalRef)}`;
      if (action === 'acknowledge') {
        await runAction(context, button, `${signalPath}/acknowledge`, {}, 'Signal acquitté.');
      }
      if (action === 'snooze') {
        await runAction(context, button, `${signalPath}/snooze`, { hours: 24 }, 'Signal reporté de 24 h.');
      }
      if (action === 'resolve') {
        const ask = context.prompt || (typeof globalThis.prompt === 'function' ? globalThis.prompt.bind(globalThis) : null);
        const note = ask ? String(ask('Preuve de résolution (obligatoire) : qu’est-ce qui a été fait ?', '') || '').trim() : '';
        if (note.length < 3) {
          setFeedback(context.root, 'Une note de résolution est obligatoire pour clore ce signal.', 'critical');
          return;
        }
        await runAction(context, button, `${signalPath}/resolve`, { note }, 'Signal résolu.');
      }
    };
    rootNode.__actionCenterClickHandler=handler;
    rootNode.addEventListener('click',handler);
  }

  // Un transitaire sans affectation marché ne peut pas voir les signaux.
  // Ce refus serveur reste fail-closed ; l'écran explique le blocage au lieu
  // de laisser une page vide ou d'attribuer un scope par défaut.
  function renderAgentScopeMissing(context, error) {
    if (context.user?.role !== 'agent_transitaire'
      || error?.status !== 403 || error?.code !== 'agent_action_center_market_scope_missing') {
      return false;
    }
    const root = context.root;
    root.replaceChildren();
    root.classList.add('kmc-action-center');
    root.dataset.actionCenterMode = 'blocked';
    const panel = text(context.document, 'section', 'kmc-workspace-feedback is-warning', '');
    panel.setAttribute('role', 'alert');
    panel.appendChild(text(context.document, 'h1', 'kmc-workspace-title', 'Affectation marché requise'));
    panel.appendChild(text(context.document, 'p', 'kmc-workspace-subtitle',
      'Ce compte transitaire n’est rattaché à aucun marché. Les signaux restent inaccessibles tant que son affectation n’est pas vérifiée par l’administration.'));
    root.appendChild(panel);
    return true;
  }

  function readListContext(loc) {
    try {
      const q=new URL(loc.href).searchParams;
      const domain=q.get('family')||'';
      const offset=Number(q.get('offset')||0);
      return {domain:Object.hasOwn(FAMILY_LABELS,domain)?domain:'',offset:Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000?offset:0};
    } catch (_) { return {domain:'',offset:0}; }
  }

  function listEndpoint(endpoint,domain,offset,mode) {
    const [path,search='']=endpoint.split('?');
    const q=new URLSearchParams(search);
    if(mode!=='agent'&&Object.hasOwn(FAMILY_LABELS,domain))q.set('family',domain);
    if(offset>0)q.set('offset',String(offset));
    const query=q.toString();
    return path+(query?'?'+query:'');
  }

  function syncListContext(context) {
    try {
      const url=new URL(globalThis.location.href);
      if(context.domain)url.searchParams.set('family',context.domain);else url.searchParams.delete('family');
      if(context.offset)url.searchParams.set('offset',String(context.offset));else url.searchParams.delete('offset');
      globalThis.history.replaceState(globalThis.history.state,'',url.pathname+url.search+url.hash);
    } catch (_) {}
  }

  function renderPagination(rootNode,context,payload) {
    const p=payload?.pagination;
    if(!p||!Number.isSafeInteger(p.total)||!Number.isSafeInteger(p.limit)||p.limit<1||!Number.isSafeInteger(p.offset)||p.offset<0)return;
    const count=(payload.signals||[]).length;
    if(p.total<=p.limit&&p.offset===0)return;
    const doc=context.document;
    const bar=doc.createElement('nav');
    bar.className='kmc-workspace-nav';
    bar.setAttribute('aria-label','Pagination des exceptions');
    bar.appendChild(text(doc,'span','kmc-action-signal-age',count?String(p.offset+1)+'–'+String(p.offset+count)+' / '+String(p.total):'Page vide · '+String(p.total)+' résultat(s)'));
    for(const [label,offset,disabled] of [['Précédent',Math.max(0,p.offset-p.limit),p.offset===0],['Suivant',p.offset+p.limit,p.offset+count>=p.total||count===0]]) {
      const button=text(doc,'button','kmc-workspace-action',label);
      button.type='button';button.disabled=disabled;
      button.addEventListener('click',()=>{context.offset=offset;syncListContext(context);context.reload();});
      bar.appendChild(button);
    }
    rootNode.appendChild(bar);
  }

  async function mount(options) {
    const runtime = isAgentUser(options.user)
      ? { mode: 'agent', marketCode: null, severity: null, endpoint: AGENT_ENDPOINT, loadEndpoint: AGENT_ENDPOINT }
      : await resolveRuntimeScope(options);
    const context = {
      root: options.root,
      user: options.user,
      document: options.document,
      fetch: options.fetch,
      ui: options.ui,
      endpoint: runtime.endpoint,
      loadEndpoint: runtime.loadEndpoint,
      severity: runtime.severity,
      scopeMode: runtime.mode,
      marketCode: runtime.marketCode,
      adminContext: runtime.adminContext || null,
      domain: readListContext(options.location || globalThis.location).domain,
      offset: readListContext(options.location || globalThis.location).offset,
      reload: null,
    };

    const rootNode = context.root;
    const identity = {};
    rootNode.__dashboardViewIdentity = identity;
    context.identity=identity;
    let requestSeq = 0;
    let restorePending=true;
    const workspaceBusy = () => {
      const focused = context.document.activeElement;
      return Boolean(context.actionPending || rootNode.querySelector?.('[aria-modal="true"], details.kmc-action-group[open], [data-action-center-action]:disabled') ||
        (focused && rootNode.contains?.(focused) &&
         focused.matches?.('input,textarea,select,button,[contenteditable="true"]')));
    };
    async function load({ background = false } = {}) {
      const currentRequest = ++requestSeq;
      let payload;
      try {
        payload = await jsonRequest(context.fetch, listEndpoint(context.loadEndpoint, context.domain, context.offset, context.scopeMode));
      } catch (error) {
        if (currentRequest !== requestSeq || rootNode.__dashboardViewIdentity !== identity) return {};
        if (renderAgentScopeMissing(context, error)) return { blocked: true };
        if (background || error.status === 401 || error.status === 403) {
          if (error.status === 401 || error.status === 403) {
            rootNode.replaceChildren();
            const notice = context.document.createElement('p');
            notice.setAttribute('role', 'alert');
            notice.textContent = 'Accès expiré ou non autorisé. Rechargez votre session.';
            rootNode.appendChild(notice);
            rootNode.removeAttribute?.('data-dashboard-stale');
          } else rootNode.setAttribute?.('data-dashboard-stale', 'true');
        }
        throw error;
      }
      if (currentRequest !== requestSeq || rootNode.__dashboardViewIdentity !== identity ||
          (background && (rootNode.isConnected === false || workspaceBusy()))) return payload;
      const expanded=new Set(Array.from(rootNode.querySelectorAll?.('details.kmc-action-group[open] [data-signal-ref]')||[]).map(el=>el.dataset.signalRef));
      rootNode.replaceChildren();
      rootNode.removeAttribute?.('data-dashboard-stale');
      rootNode.classList.add('kmc-action-center');
      rootNode.dataset.actionCenterMode = context.scopeMode;
      rootNode.appendChild(header(context.document, payload, context.severity));
      rootNode.appendChild(context.ui.KpiStrip.create(metricItems(payload.summary)).element);
      if (context.scopeMode === 'agent') {
        renderAgentSignals(rootNode, context.ui, context.document, payload);
        renderPagination(rootNode,context,payload);
        bind(rootNode, context);
        return payload;
      }



      const markets = ((context.adminContext && context.adminContext.access && context.adminContext.access.allowedMarkets) || []).map(String);
      renderFamilies(rootNode, context.ui, context.document, payload, {
        domain: context.domain || '',
        markets: context.adminContext?.access?.mode === 'global' ? markets : [],
        market: context.marketCode || '',
        onDomain: value => { context.domain = value; context.offset=0; syncListContext(context); load(); },
        onMarket: value => {
          const loc = globalThis.location;
          if (loc) {
            const url=new URL(loc.href);
            if(value) url.searchParams.set('market',value); else url.searchParams.delete('market');
            url.searchParams.delete('offset');
            loc.href=url.pathname+url.search+url.hash;
          }
        },
      });
      renderPagination(rootNode,context,payload);
      for(const card of Array.from(rootNode.querySelectorAll?.('[data-signal-ref]')||[])) {
        if(expanded.has(card.dataset.signalRef)){const group=card.closest?.('details.kmc-action-group');if(group)group.open=true;}
      }
      if(restorePending){restoreSignal(rootNode,options.location||globalThis.location);restorePending=false;}
      bind(rootNode, context);
      return payload;
    }

    context.reload = load;
    globalThis.KomerceDashboardFreshness?.watch?.({
      root: rootNode, pollMs: 60000, streamEnabled: options.user?.role === 'admin',
      isBusy: workspaceBusy,
      refresh: () => load({ background:true }),
    });
    return load();
  }

  return {
    ENDPOINT,
    AGENT_ENDPOINT,
    CONTEXT_ENDPOINT,
    isAgentUser,
    mount,
    jsonRequest,
    metricItems,
    severityLabel,
    selectedMarketCode,
    resolveRuntimeScope,
    readListContext,
    listEndpoint,
    bind,
    restoreSignal,
  };
});
