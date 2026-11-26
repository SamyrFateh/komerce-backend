/**
 * @komerce-arch
 * @role          canonical-hub-workstation
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_user, canonical_admin_context, purchasing_and_hub_read_models
 * @outputs       hub_two_branch_integrated_workstation
 * @depends       purchasing-workspace, operations-workspace, canonical shell, hub dossier
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      two_branches_one_hub_no_parallel_business_truth, server_permissions_authoritative
 * @impact-areas  admin-dashboard, hub, purchasing
 * @version       2026-11-hub-workstation-v2
 */
'use strict';

(function initHubWorkstation(global) {
  // Poste de travail : les deux panneaux sont des LECTURES. Les mutations
  // restent exclusivement dans Purchasing et OperationsWorkspace.
  const HUB_PATH = '/admin/hub';
  const BRANCHES = Object.freeze({
    administrative: { label: 'Administration', hint: 'Achats, fournisseurs et engagements' },
    operations: { label: 'Kanban', hint: 'Suivre les commandes et leurs prochaines actions' },
    // Vue de supervision, pas une troisième branche métier ni un nouveau writer.
    direction: { label: 'Direction Hub', hint: 'Décisions, paiements et arbitrages' },
  });
  const PO_STAGE = Object.freeze({
    draft: 'À préparer', notified: 'En cours', confirmed: 'En cours',
    shipped: 'Fournisseur expédié', hub_received: 'Réceptionnée', cancelled: 'Annulée',
    issued_not_sent: 'À envoyer', sent: 'Envoyée', partially_received: 'Partiellement reçue',
    received: 'Reçue',
  });
  const safe = value => String(value == null ? '' : value);
  const parseBranch = search => {
    const value = new URLSearchParams(safe(search)).get('branch');
    return Object.prototype.hasOwnProperty.call(BRANCHES, value) ? value : 'operations';
  };
  const href = (branch, search) => {
    const params = new URLSearchParams(safe(search));
    params.set('branch', branch);
    if (branch !== 'administrative') params.delete('po');
    // Changer de poste ferme le deep link ; le Kanban reste global.
    for(const key of ['market','sel','decision','atelier'])params.delete(key);
    return HUB_PATH + '?' + params.toString();
  };
  const make = (doc, tag, css, textContent) => {
    const node = doc.createElement(tag);
    if (css) node.className = css;
    if (textContent !== undefined) node.textContent = safe(textContent);
    return node;
  };
  // Une seule paire d'écouteurs par tableau : les rafraîchissements n'empilent pas
  // des handlers document (ouvertures/clics extérieurs) devenus obsolètes.
  const boardDisposers = new WeakMap();
  function installMenuDismiss(root, doc, menu, close, onMove, restoreFocus) {
    const previous = boardDisposers.get(root);
    if (previous) previous();
    const outside = event => {
      if (!menu.hidden && !menu.contains(event.target)) close();
    };
    const escape = event => {
      if (event.key === 'Escape' && !menu.hidden) {
        // Returning focus avoids leaving keyboard users on a hidden button.
        restoreFocus?.();
        close();
      }
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', escape);
    // Capture les scrolls horizontaux ET verticaux des parents du Kanban.
    // Le menu est positionné à partir de la cellule, jamais des anciennes coordonnées souris.
    // Scrolling the popup's own content must never reposition or dismiss it.
    const onContainerScroll = event => {
      if (event.target === menu || menu.contains(event.target)) return;
      onMove?.();
    };
    if(onMove) {
      doc.addEventListener('scroll', onContainerScroll, true);
      doc.defaultView?.addEventListener('resize',onMove);
      menu.addEventListener?.('hub:menu-state',onMove);
    }
    boardDisposers.set(root, () => {
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('keydown', escape);
      if(onMove) {
        doc.removeEventListener('scroll', onContainerScroll, true);
        doc.defaultView?.removeEventListener('resize',onMove);
        menu.removeEventListener?.('hub:menu-state',onMove);
      }
    });
  }

  function anchoredMenu(menu, scroll, doc, close) {
    let target=null;
    const move=()=>{
      if(menu.hidden || !target || menu.classList.contains('is-sourcing-inline'))return;
      const viewport=doc.defaultView;
      const width=viewport?.innerWidth||1440;
      const height=viewport?.innerHeight||900;
      if(menu.classList.contains('is-editing')) {
        // Saisie complexe : volet fixe à droite, en conservant la commande et l'étape en titre.
        const panel=Math.min(menu.offsetWidth||470,width-16);
        menu.style.left=Math.max(8,width-panel-12)+'px';
        menu.style.top='64px';
        return;
      }
      if(!target.isConnected){close();return;}
      const cell=target.getBoundingClientRect();
      const clip=scroll.getBoundingClientRect();
      const visible=cell.right>Math.max(clip.left,0)+2 &&
        cell.left<Math.min(clip.right,width)-2 &&
        cell.bottom>Math.max(clip.top,0)+2 &&
        cell.top<Math.min(clip.bottom,height)-2;
      if(!visible){close();return;}
      const popupWidth=Math.min(menu.offsetWidth||360,width-16);
      const popupHeight=Math.min(menu.offsetHeight||260,height-16);
      const x=Math.max(8,Math.min(cell.left,width-popupWidth-8));
      const below=cell.bottom+6;
      const above=cell.top-popupHeight-6;
      const y=below+popupHeight<=height-8?below:
        above>=8?above:Math.max(8,Math.min(below,height-popupHeight-8));
      menu.style.left=Math.round(x)+'px';
      menu.style.top=Math.round(y)+'px';
    };
    return {
      select(element){target=element;move();},
      move,
      restoreFocus(){if(target?.isConnected) target.focus?.({preventScroll:true});},
      clear(){target=null;}
    };
  }
  // Journal de suivi d'une étape : lecture de la vérité order_comments,
  // append-only, et jamais une preuve de transition métier.
  function mountStageJournal(menu, {doc, fetch:fetchFn, user, order, stageKey, isCurrent}) {
    if (!stageKey || !['admin','agent_hub','market_operator'].includes(user?.role)) return;
    const canWrite = ['admin','agent_hub'].includes(user?.role);
    const section = make(doc,'section','kmc-hub-stage-journal');
    section.setAttribute('data-hub-stage-journal',stageKey);
    const heading = make(doc,'button','kmc-hub-journal-toggle','Journal de suivi · Voir les notes');
    heading.type='button';
    heading.setAttribute('aria-expanded','false');
    heading.setAttribute('data-hub-stage-journal-toggle','');
    section.appendChild(heading);
    const content = make(doc,'div','kmc-hub-journal-content');
    content.hidden=true;
    section.appendChild(content);
    menu.appendChild(section);

    async function load() {
      content.replaceChildren();
      content.appendChild(make(doc,'p','kmc-hub-journal-hint','Chargement de la traçabilité…'));
      try {
        const detail=await requestJSON(fetchFn,'/api/hub-dash/orders/'+encodeURIComponent(order.id));
        if (!isCurrent()) return;
        const all=Array.isArray(detail.comments)?detail.comments:[];
        const entries=all.filter(note=>note.hub_stage_key===stageKey).slice(0,50);
        content.replaceChildren();
        content.appendChild(make(doc,'p','kmc-hub-journal-hint',
          entries.length ? entries.length+' note(s) enregistrée(s) · non modifiables'
            : 'Aucun commentaire sur cette étape pour le moment.'));
        if (entries.length) {
          const list=make(doc,'ol','kmc-hub-journal-list');
          list.setAttribute('aria-label','Historique immuable de cette étape');
          entries.forEach(note=>{
            const item=make(doc,'li','kmc-hub-journal-item');
            const stamp=note.created_at ? new Date(note.created_at).toLocaleString('fr-FR',{
              day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'
            }) : 'Date indisponible';
            item.appendChild(make(doc,'span','kmc-hub-journal-meta',
              (note.author_name || 'Équipe Hub')+' · '+stamp));
            item.appendChild(make(doc,'p','kmc-hub-journal-note',note.text||''));
            item.appendChild(make(doc,'small','kmc-hub-journal-seal','✓ Publiée · non modifiable'));
            list.appendChild(item);
          });
          content.appendChild(list);
        }
        if (!canWrite) {
          content.appendChild(make(doc,'p','kmc-hub-journal-hint',
            'Consultation seulement : publication réservée aux opérateurs Hub.'));
          return;
        }
        const form=make(doc,'form','kmc-hub-journal-form');
        form.setAttribute('data-hub-journal-form','');
        const lbl=make(doc,'label','kmc-hub-journal-label','Ajouter une note de suivi');
        const input=make(doc,'textarea','kmc-hub-journal-textarea');
        input.setAttribute('aria-label','Commentaire de suivi immuable');
        input.setAttribute('data-hub-journal-input','');
        input.rows=3;
        input.minLength=3;input.maxLength=1500;input.required=true;
        input.placeholder='Ex. : Fournisseur relancé, réponse attendue lundi…';
        lbl.appendChild(input);form.appendChild(lbl);
        form.appendChild(make(doc,'p','kmc-hub-journal-help',
          'Après publication, cette note ne pourra ni être modifiée ni supprimée. '+
          'Elle ne valide aucune étape physique ou financière.'));
        const footer=make(doc,'div','kmc-hub-journal-actions');
        const submit=make(doc,'button','kmc-hub-journal-publish','Publier la note');
        submit.type='submit';
        submit.setAttribute('data-hub-journal-publish','');
        footer.appendChild(submit);
        const status=make(doc,'span','kmc-hub-journal-feedback');
        status.setAttribute('role','status');status.setAttribute('aria-live','polite');
        footer.appendChild(status);form.appendChild(footer);
        form.addEventListener('submit',async event=>{
          event.preventDefault();
          const message=input.value.trim();
          if(message.length<3||message.length>1500){
            status.textContent='Saisir entre 3 et 1 500 caractères.';return;
          }
          submit.disabled=true;status.textContent='Publication…';
          try {
            const response=await fetchFn('/api/hub-dash/orders/'+encodeURIComponent(order.id)+'/comment',{
              method:'POST',credentials:'include',
              headers:{Accept:'application/json','Content-Type':'application/json'},
              body:JSON.stringify({content:message,hub_stage_key:stageKey}),
            });
            const result=await response.json().catch(()=>({}));
            if(!response.ok) throw new Error(result.error||'Publication refusée');
            if(!isCurrent())return;
            await load();
          }catch(err){
            if(!isCurrent())return;
            status.textContent=err.message||'Publication impossible';
            submit.disabled=false;
          }
        });
        content.appendChild(form);
      }catch(err){
        if(!isCurrent())return;
        content.replaceChildren();
        content.appendChild(make(doc,'p','kmc-hub-journal-error',
          'Journal indisponible : '+(err.message||'accès impossible')));
      }
    }
    const openJournal=()=>{
      if(!content.hidden) return;
      content.hidden=false;
      heading.setAttribute('aria-expanded','true');
      heading.textContent='Journal de suivi · Masquer les notes';
      void load();
    };
    heading.addEventListener('click',()=>{
      if(content.hidden) return openJournal();
      content.hidden=true;
      heading.setAttribute('aria-expanded','false');
      heading.textContent='Journal de suivi · Voir les notes';
    });
    return {open:openJournal, section};
  }
  const smallRef = value => safe(value).slice(0, 8);
  const getPO = location => new URLSearchParams(safe(location && location.search)).get('po') || '';

  function requestJSON(fetchFn, url) {
    return Promise.resolve(fetchFn(url, {
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
    })).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || 'Données indisponibles');
        error.status = response.status;
        throw error;
      }
      return body;
    });
  }


  // H4 #3998 : la directrice voit les tâches de TOUS les marchés sur /admin/hub.
  // Une seule file de supervision, intégrée aux branches existantes. Cette vue
  // ne déclenche aucune action métier : l'API serveur reste la seule vérité.
  async function renderDirectorQueue(host, { document:doc, fetch:fetchFn, user } = {}) {
    if (!['admin', 'agent_hub'].includes(user && user.role) || !doc || typeof fetchFn !== 'function') return null;
    const existing=host.querySelector?.('[data-hub-director-todo]') || null;
    const panel=make(doc,'details','hlc-director');
    panel.setAttribute('data-hub-director-todo','');
    panel.open=true;
    panel.setAttribute('data-hub-director-state','loading');
    const heading=make(doc,'summary','hlc-director-summary','Direction Hub · Tous marchés · Chargement…');
    panel.appendChild(heading);
    const body=make(doc,'div','hlc-director-body','Chargement des tâches et de leur ancienneté…');
    body.setAttribute('role','status');
    panel.appendChild(body);
    if (!existing) host.appendChild(panel);
    try {
      const payload=await requestJSON(fetchFn,'/api/hub/director-todo');
      // Une navigation a pu détruire le poste. Ne rien injecter dans l'ancien document.
      if (host.isConnected === false || (!existing && panel.isConnected === false)) return null;
      if (payload.scope !== 'ALL_MARKETS' || !Array.isArray(payload.tasks)) throw new Error('Réponse direction Hub invalide');
      // Ne pas repeindre les cartes si la vérité métier n'a pas changé.
      // La date de génération seule ne doit jamais déclencher un saut de page.
      const signature=JSON.stringify([payload.tasks, payload.overdue_count]);
      if (existing && existing._directorSignature === signature) {
        existing.removeAttribute('data-hub-director-stale');
        existing.querySelector?.('[data-hub-director-refresh-error]')?.remove?.();
        return payload;
      }
      if (existing) {
        // Un clic en cours reste prioritaire : le prochain tick relira la vérité.
        if (doc.activeElement && existing.contains?.(doc.activeElement) && doc.activeElement.matches?.('input, textarea, select, [contenteditable="true"]')) {
          existing.setAttribute('data-hub-director-update-pending','true');
          return payload;
        }
        panel.open=existing.open;
        host.replaceChildren(panel);
      }
      panel._directorSignature=signature;
      panel.setAttribute('data-hub-director-state','ready');
      const retiredKinds=new Set(['PREPARE_BAG','CLOSE_BAG','DEPOSIT_BAG','BOX_BAGS']);
      const activeTasks=payload.tasks.filter(task=>!retiredKinds.has(task.kind));
      const legacyCount=payload.tasks.length-activeTasks.length;
      heading.textContent='Direction Hub · Tous marchés · '+activeTasks.length+
        ' tâche(s) · '+activeTasks.filter(task=>task.overdue).length+' alerte(s) ≥ 48 h';
      body.replaceChildren();
      // Une seule identité par dossier et marché ; les tâches restent distinctes.
      const groupOf=task=>['AUTHORIZE_COMMITMENT','AUTHORIZE_PAYMENT'].includes(task.kind)?'decide'
        : task.severity==='anomaly'||task.kind==='REVIEW_ANOMALY'||task.kind==='BLOCKED_BY_SHORTFALL'||task.owner==='responsable_hub'?'resolve':'control';
      const cases=new Map();
      activeTasks.forEach((task,index)=>{
        const subject=task.subject||{}, market=safe(task.market?.code||'—');
        const identity=['po_id','order_id','box_unit_id','parcel_unit_id','batch_key'].find(key=>subject[key]!=null&&safe(subject[key])!=='');
        const key=market+':'+(identity?identity+':'+safe(subject[identity]):'task:'+safe(task.id||task.kind)+':'+index);
        if(!cases.has(key))cases.set(key,{key,market,identity,ref:identity?safe(subject[identity]):'',tasks:[]});
        cases.get(key).tasks.push(task);
      });
      const dossiers=[...cases.values()];
      const specs=[['all','Tous'],['decide','À décider'],['control','À contrôler'],['resolve','À résoudre']];
      const matches=(d,key)=>key==='all'||d.tasks.some(task=>groupOf(task)===key);
      const pilot=make(doc,'section','kmc-hub-v3-pilotage');
      pilot.setAttribute('data-hub-v3-pilotage','');
      const metrics=make(doc,'div','kmc-hub-admin-stats');
      const metric=make(doc,'div','kmc-hub-admin-stat');
      metric.append(make(doc,'strong','',String(dossiers.length)),make(doc,'span','','Dossiers actifs'));
      metrics.appendChild(metric);
      const alertMetric=make(doc,'div','kmc-hub-admin-stat');
      alertMetric.append(make(doc,'strong','',String(dossiers.filter(d=>d.tasks.some(t=>t.overdue)).length)),make(doc,'span','','Dossiers en alerte ≥ 48 h'));
      metrics.appendChild(alertMetric);pilot.appendChild(metrics);
      const gestion=make(doc,'section','kmc-hub-v3-gestion');
      gestion.setAttribute('data-hub-v3-gestion','');
      const tabs=make(doc,'nav','kmc-hub-admin-tabs kmc-hub-direction-tabs');
      tabs.setAttribute('aria-label','Direction Hub');
      const filters=make(doc,'div','kmc-hub-admin-tabs kmc-hub-director-filters');
      const list=make(doc,'div','hlc-director-list');
      list.setAttribute('data-hub-director-list','');
      const buttons=[],filterButtons=[],entries=[];
      let selectedGroup=specs.some(([key])=>key===host._directionGroup)?host._directionGroup:'all';
      let selectedView=host._directionView||'pilotage';
      const apply=()=>{
        host._directionView=selectedView;host._directionGroup=selectedGroup;
        pilot.hidden=selectedView!=='pilotage';gestion.hidden=selectedView!=='gestion';
        for(const [key,button] of buttons){button.classList.toggle('is-active',key===selectedView);button.setAttribute('aria-pressed',String(key===selectedView));}
        for(const [key,button] of filterButtons){button.classList.toggle('is-active',key===selectedGroup);button.setAttribute('aria-pressed',String(key===selectedGroup));}
        for(const [d,node] of entries)node.hidden=!matches(d,selectedGroup);
        empty.hidden=dossiers.some(d=>matches(d,selectedGroup));
      };
      for(const [key,label] of [['pilotage','Pilotage'],['gestion','Gestion']]){
        const b=make(doc,'button','kmc-hub-admin-tab',label);b.type='button';b.setAttribute('data-hub-v3-view',key);
        b.addEventListener('click',()=>{selectedView=key;apply();});tabs.appendChild(b);buttons.push([key,b]);
      }
      for(const [key,label] of specs){
        const count=dossiers.filter(d=>matches(d,key)).length;
        const b=make(doc,'button','kmc-hub-admin-tab',label+' ('+count+')');b.type='button';b.setAttribute('data-hub-v3-filter',key);
        b.addEventListener('click',()=>{selectedGroup=key;selectedView='gestion';apply();});filters.appendChild(b);filterButtons.push([key,b]);
        if(key!=='all'){
          const card=make(doc,'button','kmc-hub-admin-stat');card.type='button';card.setAttribute('data-hub-v3-pilot-filter',key);
          card.append(make(doc,'strong','',String(count)),make(doc,'span','',label));
          card.addEventListener('click',()=>{selectedGroup=key;selectedView='gestion';apply();});metrics.appendChild(card);
        }
      }
      if(legacyCount){
        const notice=make(doc,'p','kmc-hub-action-explanation',legacyCount+' dossier(s) historiques à rapprocher. Consulter les preuves existantes ; aucun ancien geste de préparation n’est disponible.');
        notice.setAttribute('data-hub-legacy-review','');gestion.appendChild(notice);
      }
      const proofs=make(doc,'a','kmc-hub-app-branch','Preuves et documents administratifs');
      proofs.setAttribute('href',HUB_PATH+'?branch=administrative');
      proofs.setAttribute('data-hub-v3-proofs','');
      gestion.append(filters,list,proofs);
      const opened=host._directionOpened||(host._directionOpened=new Set());
      for(const d of dossiers){
        const dossier=make(doc,'details','hlc-director-group');
        dossier.setAttribute('data-hub-v3-dossier',d.key);
        dossier.open=opened.has(d.key);
        dossier.addEventListener('toggle',()=>{if(dossier.open)opened.add(d.key);else opened.delete(d.key);});
        const summary=make(doc,'summary','hlc-director-group-heading');
        const identity=d.identity==='po_id'?'PO '+smallRef(d.ref):d.identity==='order_id'?'Commande '+smallRef(d.ref):d.tasks[0].missing||'Dossier Hub';
        summary.append(make(doc,'strong','',d.market+' · '+identity),make(doc,'span','hlc-director-group-count',d.tasks.length+' tâche(s)'));
        dossier.appendChild(summary);
        const rows=make(doc,'div','hlc-director-group-rows');
        for(const task of d.tasks){
          const row=make(doc,'div','hlc-director-task'+(task.overdue?' is-overdue':'')+
            (task.viewer_can_act===false?' is-readonly':''));
          row.setAttribute('data-hub-director-task',safe(task.kind||'TASK'));
          const market=safe(task.market&&task.market.code||'—');
          row.appendChild(make(doc,'strong','hlc-director-market',market));
          const detail=make(doc,'span','hlc-director-detail');
          detail.appendChild(make(doc,'strong','hlc-director-name',task.missing||task.kind||'Tâche Hub'));
          if (task.why) detail.appendChild(make(doc,'span','hlc-director-why',task.why));
          if (task.viewer_can_act===false) detail.appendChild(make(doc,'small','hlc-director-access',
            task.blocked_reason||'Action réservée à un profil habilité'));
          row.appendChild(detail);
          const age=task.age_hours == null?'Âge inconnu':
            task.age_hours>=48?Math.floor(task.age_hours/24)+' j':task.age_hours+' h';
          row.appendChild(make(doc,'span','hlc-director-age'+(task.overdue?' is-overdue':''),
            (task.overdue?'⚠ ':'')+age));
          if (/^[A-Z]{2}$/.test(market)) {
            const subject=task.subject||{};
            const id=(subject.po_id && /^[A-Za-z0-9-]{1,128}$/.test(String(subject.po_id)))
              ? 'po:'+String(subject.po_id)
              : (subject.order_id && /^[A-Za-z0-9-]{1,128}$/.test(String(subject.order_id)))
                ? 'order:'+String(subject.order_id) : '';
            const link=make(doc,'a','hlc-director-open',
              id.startsWith('po:')?(task.kind==='AUTHORIZE_COMMITMENT'?'Examiner l’engagement':task.kind==='AUTHORIZE_PAYMENT'?'Examiner le paiement':'Examiner la PO'):id.startsWith('order:')?'Examiner la commande':'Ouvrir le marché');
            const isDecision=['AUTHORIZE_COMMITMENT','AUTHORIZE_PAYMENT'].includes(task.kind)&&id.startsWith('po:');
            link.setAttribute('href',isDecision
              ? HUB_PATH+'?branch=operations&sel='+encodeURIComponent(id)+'&decision='+(task.kind==='AUTHORIZE_COMMITMENT'?'commitment':'payment')
              : '/admin/hub-live?view=execute&market='+encodeURIComponent(market)+(id?'&sel='+encodeURIComponent(id):''));
            row.appendChild(link);
          }

          rows.appendChild(row);
        }
        dossier.appendChild(rows);list.appendChild(dossier);entries.push([d,dossier]);
      }
      const empty=make(doc,'p','hlc-director-empty','Aucun dossier dans ce filtre.');
      list.appendChild(empty);
      body.append(tabs,pilot,gestion);apply();
      return payload;
    } catch(error) {
      if (error.status === 401 || error.status === 403) {
        // Autorité révoquée : le dernier Kanban est désormais interdit, pas simplement stale.
        host.replaceChildren();
        const notice=make(doc,'p','hlc-director-access-denied',
          'Accès expiré ou non autorisé. Rechargez votre session.');
        notice.setAttribute('role','alert');
        host.appendChild(notice);
      } else if (existing && existing.isConnected !== false) {
        // Conserver la dernière photo, clairement marquée périmée, jamais la remplacer par zéro.
        existing.setAttribute('data-hub-director-stale','true');
        let notice=existing.querySelector?.('[data-hub-director-refresh-error]');
        if (!notice) {
          notice=make(doc,'small','hlc-director-stale');
          notice.setAttribute('data-hub-director-refresh-error','');
          existing.appendChild(notice);
        }
        notice.textContent='Actualisation indisponible — données affichées non garanties à jour.';
      } else if (panel.isConnected !== false) {
        heading.textContent='Direction Hub · Tous marchés · Indisponible';
        body.textContent='La supervision ne peut pas être chargée : '+safe(error.message||error);
        panel.setAttribute('data-hub-director-state','error');
      }
      return null;
    }
  }

  // Le Hub est une entité centrale : ce tableau agrège TOUS les marchés
  // sans sélecteur de marché. Les opérations utilisent ensuite, si besoin,
  // le marché d'une commande pour cibler leur writer canonique.
  async function renderGlobalBoard(root, { document:doc, fetch:fetchFn, user, location = global.location } = {}) {
    if (!root || !doc || typeof fetchFn !== 'function') {
      throw new Error('hub_global_board_context_missing');
    }
    boardDisposers.get(root)?.();
    boardDisposers.delete(root);
    root.replaceChildren();
    const header = make(doc, 'div', 'kmc-hub-global-toolbar');
    const headerTitle = make(doc, 'strong', '', user?.role === 'market_operator'
      ? 'Commandes import · Mes marchés autorisés' : 'Toutes les commandes import · Tous les marchés');
    const headerCount = make(doc, 'span', 'kmc-hub-global-count', 'Chargement…');
    header.appendChild(headerTitle);
    header.appendChild(headerCount);
    root.appendChild(header);
    const search = make(doc, 'input', 'kmc-hub-app-search');
    search.type = 'search';
    search.placeholder = 'Rechercher une commande ou un marché';
    search.setAttribute('aria-label', search.placeholder);
    root.appendChild(search);
    const scroll = make(doc, 'div', 'kmc-hub-board-scroll');
    const table = make(doc, 'table', 'kmc-hub-board kmc-hub-global-table');
    table.setAttribute('aria-label', user?.role === 'market_operator'
      ? 'Suivi Hub, marchés autorisés' : 'Tableau central Hub, tous les marchés');
    const head = make(doc, 'thead');
    const titleRow = make(doc, 'tr');
    for (const label of ['Commande / Marché', 'PO', 'Fournisseur', 'Réception', 'Cartons', 'Départ', 'Reste à solder']) {
      titleRow.appendChild(make(doc, 'th', '', label));
    }
    head.appendChild(titleRow);
    table.appendChild(head);
    const body = make(doc, 'tbody');
    table.appendChild(body);
    scroll.appendChild(table);
    root.appendChild(scroll);

    const menu = make(doc, 'div', 'kmc-hub-board-menu');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Actions et preuves du Hub');
    menu.setAttribute('data-hub-global-menu', '');
    menu.hidden = true;
    root.appendChild(menu);

    const canOperate = ['admin', 'agent_hub'].includes(user && user.role);
    const marketReadOnly = user?.role === 'market_operator';
    let anchor;
    let menuSerial = 0;
    const closeMenu = () => {
      menu.hidden = true;
      menu.setAttribute('data-hub-request', String(++menuSerial));
      anchor?.clear();
    };
    const openMenu = (order, label, value, event) => {
      // Ce menu appartient à UNE étape. Aucun lien universel injecté à toutes
      // les cellules avant la lecture de l'autorité métier.
      const requestId = String(++menuSerial);
      menu.setAttribute('data-hub-request', requestId);
      menu.replaceChildren();
      menu.scrollTop = 0;
      menu.classList.remove('is-editing','is-sourcing-inline','is-purchasing-flow');
      menu.removeAttribute('data-hub-menu-stage-state');
      menu.appendChild(make(doc, 'strong', 'kmc-hub-board-menu-title',
        order.reference + ' · ' + label));
      menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary', value));
      const stageKey = ({ PO:'po', Fournisseur:'supplier', Réception:'reception', Cartons:'cartons', Départ:'departure', 'Reste à solder':'remaining' })[label];
      const state = stageKey && order.stage_states && order.stage_states[stageKey];
      const locked = state === 'locked' || state === 'complete';
      menu.setAttribute('data-hub-menu-stage-state', state || 'unknown');
      if (stageKey === order.current_key && order.current_phase) {
        menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-current',
          '▶ Étape actuelle · ' + order.current_phase + ' — ' + (order.current_status || 'À vérifier')));
        if (order.current_detail && !safe(order.remaining_detail).includes(order.current_detail)) {
          menu.appendChild(make(doc,'p','kmc-hub-board-menu-summary',order.current_detail));
        }
        if (order.current_expected) {
          menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-expected',
            'Attendu : ' + order.current_expected));
        }
      }
      if (stageKey && order.stage_notes && order.stage_notes[stageKey]) {
        menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary', order.stage_notes[stageKey]));
      }
      if (locked) {
        menu.appendChild(make(doc, 'p', 'kmc-hub-action-explanation',
          '✓ Étape terminée et verrouillée : consultation des faits uniquement. Aucune réouverture depuis ce tableau.'));
      }
      const close = make(doc, 'button', 'kmc-hub-board-menu-action is-dismiss', 'Fermer');
      close.type = 'button';
      close.addEventListener('click', closeMenu);
      menu.appendChild(close);
      menu.hidden = false;
      if (locked) {
        // Le geste physique attesté est irréversible ; le détail reste consultable.
      } else if (canOperate && global.KomerceHubContextActions) {
        global.KomerceHubContextActions.operations(menu, {
          doc, fetch:fetchFn, user, order, stage:label,
        });
      } else {
        menu.appendChild(make(doc, 'p', 'kmc-hub-action-explanation',
          !canOperate
            ? 'Consultation seule : cette étape ne peut pas être modifiée avec ce profil.'
            : 'Les actions de cette étape ne sont pas chargées. Actualiser la page.'));
      }
      const journal=mountStageJournal(menu, {doc, fetch:fetchFn, user, order, stageKey,
        isCurrent:()=>!menu.hidden && menu.getAttribute('data-hub-request')===requestId});
      if (locked && canOperate && journal) {
        // Un commentaire de suivi n'est jamais une réouverture d'étape.
        const comment=make(doc,'button','kmc-hub-board-menu-action is-comment','Ajouter un commentaire à cette étape');
        comment.type='button';
        comment.setAttribute('data-hub-completed-comment','');
        comment.addEventListener('click',()=>{
          menu.classList.add('is-editing');
          journal.open();
          anchor.move();
        });
        menu.insertBefore(comment,journal.section);
      }
      anchor.select(event?.currentTarget);
      menu.querySelector?.('a,button')?.focus?.({preventScroll:true});
    };
    anchor=anchoredMenu(menu,scroll,doc,closeMenu);
    installMenuDismiss(root, doc, menu, closeMenu, anchor.move, anchor.restoreFocus);

    let rows = [];
    let poRows = null;
    let poMode = false;
    let pilotRequest = 0;
    const receiveRefs=new Map();
    const boxCreateKeys=new Map(),hubVerifiedBoxes={};
    let activeBoxDetails=null;
    const updatePORows=new Map();
    const orderHeader = headerTitle.textContent;
    const setHeaders = labels => {
      titleRow.replaceChildren();
      labels.forEach(label => titleRow.appendChild(make(doc,'th','',label)));
    };
    const renderPOs = () => {
      body.replaceChildren();
      updatePORows.clear();
      const term=safe(search.value).trim().toLocaleLowerCase('fr');
      const filtered=(poRows || []).filter(p => !p.cancelled && [p.reference,p.market,p.supplier,...(p.order_references || [])]
        .some(v=>safe(v).toLocaleLowerCase('fr').includes(term)));
      headerCount.textContent=filtered.length+' PO';
      setHeaders(['PO / Fournisseur','Commandes associées','Achat','Réception','COMBOX','Départ']);
      if (!filtered.length) {
        const tr=make(doc,'tr'), td=make(doc,'td','','Aucune PO correspondante.');
        td.colSpan=6;tr.appendChild(td);body.appendChild(tr);return;
      }
      for (const p of filtered) {
        const tr=make(doc,'tr');tr.setAttribute('data-hub-pilot-po',p.id);
        const identity=make(doc,'td');
        identity.appendChild(make(doc,'strong','',p.reference));
        identity.appendChild(make(doc,'small','',p.market+' · '+(p.supplier||'Fournisseur non renseigné')));
        tr.appendChild(identity);
        const linked=make(doc,'td'), details=make(doc,'details');
        details.appendChild(make(doc,'summary','',p.order_count+' commande(s) · '+p.ordered+' unité(s)'));
        for(const ref of p.order_references || []) details.appendChild(make(doc,'div','',ref));
        linked.appendChild(details);tr.appendChild(linked);
        const purchase=make(doc,'td'), purchaseDetails=make(doc,'details');
        const purchaseLabel=({draft:'Engagement à valider',validation:'Engagement validé · à soumettre',engaged:'Envoi à attester',sent:'Suivi fournisseur',received:'Réception constatée'})[p.purchase_step] || PO_STAGE[p.purchase_stage] || 'À vérifier';
        const purchaseSummary=make(doc,'summary','',purchaseLabel);
        purchaseDetails.appendChild(purchaseSummary);
        const purchaseHost=make(doc,'div','kmc-hub-inline-purchase');
        purchaseHost.setAttribute('data-hub-inline-purchase',p.id);
        purchaseDetails.appendChild(purchaseHost);
        let handle=null, loading=false;
        purchaseDetails.addEventListener('toggle',async()=>{
          if(!purchaseDetails.open || loading || handle?.busy())return;
          loading=true;
          try{
            if(handle){await handle.reload();return;}
            const module=global.KomerceCanonicalOperationsWorkspace;
            if(!module?.mountPurchaseActions)throw new Error('Module achats indisponible');
            purchaseHost.replaceChildren(make(doc,'p','','Chargement du dossier…'));
            handle=await module.mountPurchaseActions(purchaseHost,{
              document:doc,fetch:fetchFn,user,marketCode:p.market,poId:p.id,
              onChange:refreshRow,
            });
          }catch(error){purchaseHost.replaceChildren(make(doc,'p','','Dossier achat indisponible : '+error.message));handle=null;}
          finally{loading=false;}
        });
        purchase.appendChild(purchaseDetails);tr.appendChild(purchase);
        const reception=make(doc,'td'), receiptDetails=make(doc,'details');
        const quantity=p.received+' / '+p.expected+' reçus';
        const receiptSummary=make(doc,'summary','',quantity+(p.missing?' · '+p.missing+' attendus':'')+(p.anomalies?' · '+p.anomalies+' écarts':''));
        receiptDetails.appendChild(receiptSummary);
        const receiptHost=make(doc,'div','kmc-hub-inline-reception');
        receiptHost.setAttribute('data-hub-inline-reception',p.id);
        receiptDetails.appendChild(receiptHost);
        let current=p, receiptHandle=null, receiptLoading=false;
        const refreshRow=async()=>{
          const data=await requestJSON(fetchFn,'/api/hub/board?view=po');
          if(data.scope!=='HUB_GLOBAL'||!Array.isArray(data.purchase_orders))throw Error('Projection PO indisponible');
          poRows=data.purchase_orders;
          for(const [id,update] of updatePORows)update(poRows.find(row=>row.id===id));
        };
        const updateRow=fresh=>{
          if(!fresh){purchaseSummary.textContent='PO indisponible';receiptSummary.textContent='PO indisponible';return;}
          current=fresh;
          purchaseSummary.textContent=({draft:'Engagement à valider',validation:'Engagement validé · à soumettre',engaged:'Envoi à attester',sent:'Suivi fournisseur',received:'Réception constatée'})[fresh.purchase_step] || PO_STAGE[fresh.purchase_stage] || 'À vérifier';
          receiptSummary.textContent=fresh.received+' / '+fresh.expected+' reçus'+(fresh.missing?' · '+fresh.missing+' attendus':'')+(fresh.anomalies?' · '+fresh.anomalies+' écarts':'');
          boxSummary.textContent=boxLabel(fresh);
          departureSummary.textContent=departureLabel(fresh);
        };
        receiptDetails.addEventListener('toggle',async()=>{
          if(!receiptDetails.open||receiptLoading||receiptHandle?.busy())return;
          if(!current.sent&&!(current.received>0)){
            receiptHost.replaceChildren(make(doc,'p','','Achat / envoi à vérifier.'));return;
          }
          receiptLoading=true;
          try{
            if(receiptHandle){await receiptHandle.reload();return;}
            const module=global.KomerceCanonicalOperationsWorkspace;
            if(!module?.mountReceptionActions)throw Error('Module réception indisponible');
            receiptHost.replaceChildren(make(doc,'p','','Chargement de la réception…'));
            receiptHandle=await module.mountReceptionActions(receiptHost,{
              document:doc,fetch:fetchFn,user,marketCode:p.market,poId:p.id,receiveRefs,onChange:refreshRow,
            });
          }catch(error){receiptHost.replaceChildren(make(doc,'p','','Réception indisponible : '+error.message));receiptHandle=null;}
          finally{receiptLoading=false;}
        });
        reception.appendChild(receiptDetails);tr.appendChild(reception);
        const boxCell=make(doc,'td'),boxDetails=make(doc,'details');
        const boxLabel=row=>row.boxed_quantity==null?'Préparation COMBOX':row.boxed_quantity+' / '+row.received+' en COMBOX · '+row.box_count+' carton(s)';
        const boxSummary=make(doc,'summary','',boxLabel(p));
        boxDetails.appendChild(boxSummary);
        const boxHost=make(doc,'div','kmc-hub-inline-boxes');
        boxHost.setAttribute('data-hub-inline-combox',p.id);
        boxDetails.appendChild(boxHost);
        let boxHandle=null,boxLoading=false;
        boxDetails.addEventListener('toggle',async()=>{
          if(!boxDetails.open||boxLoading||boxHandle?.busy())return;
          if(activeBoxDetails&&activeBoxDetails!==boxDetails)activeBoxDetails.open=false;
          activeBoxDetails=boxDetails;
          if(!(current.received>0)){
            boxHost.replaceChildren(make(doc,'p','','Aucun article reçu pour cette PO.'));return;
          }
          boxLoading=true;
          try{
            if(boxHandle){await boxHandle.reload();return;}
            const module=global.KomerceCanonicalOperationsWorkspace;
            if(!module?.mountBoxActions)throw Error('Module COMBOX indisponible');
            boxHost.replaceChildren(make(doc,'p','','Chargement des COMBOX…'));
            boxHandle=await module.mountBoxActions(boxHost,{
              document:doc,fetch:fetchFn,user,marketCode:p.market,poId:p.id,boxCreateKeys,hubVerifiedBoxes,onChange:refreshRow,
            });
          }catch(error){boxHost.replaceChildren(make(doc,'p','','COMBOX indisponibles : '+error.message));boxHandle=null;}
          finally{boxLoading=false;}
        });
        boxCell.appendChild(boxDetails);tr.appendChild(boxCell);
        const departure=make(doc,'td'),departureDetails=make(doc,'details');
        const departureLabel=row=>row.handed_quantity==null?'Départ Hub':row.handed_quantity+' / '+row.expected+' remis · '+row.dispatched_quantity+' sorti(s)';
        const departureSummary=make(doc,'summary','',departureLabel(p));
        departureDetails.appendChild(departureSummary);
        const departureHost=make(doc,'div','kmc-hub-inline-departure');
        departureHost.setAttribute('data-hub-inline-departure',p.id);
        departureDetails.appendChild(departureHost);
        let departureHandle=null,departureLoading=false;
        departureDetails.addEventListener('toggle',async()=>{
          if(!departureDetails.open||departureLoading||departureHandle?.busy())return;
          if(activeBoxDetails&&activeBoxDetails!==departureDetails)activeBoxDetails.open=false;
          activeBoxDetails=departureDetails;
          if(!(current.received>0)){
            departureHost.replaceChildren(make(doc,'p','','Aucun article reçu pour cette PO.'));return;
          }
          departureLoading=true;
          try{
            if(departureHandle){await departureHandle.reload();return;}
            const module=global.KomerceCanonicalOperationsWorkspace;
            if(!module?.mountDepartureActions)throw Error('Module départ indisponible');
            departureHost.replaceChildren(make(doc,'p','','Chargement du départ…'));
            departureHandle=await module.mountDepartureActions(departureHost,{
              document:doc,fetch:fetchFn,user,marketCode:p.market,poId:p.id,hubVerifiedBoxes,onChange:refreshRow,
            });
          }catch(error){departureHost.replaceChildren(make(doc,'p','','Départ indisponible : '+error.message));departureHandle=null;}
          finally{departureLoading=false;}
        });
        departure.appendChild(departureDetails);tr.appendChild(departure);
        updatePORows.set(p.id,updateRow);
        body.appendChild(tr);
      }
    };
    // Poste PO opérationnel par défaut ; ancienne lecture accessible en secours.
    // Les ateliers canoniques restent les seuls writers. Aucun état métier local.
    const visualPO = (canOperate || marketReadOnly) && new URLSearchParams(safe(location?.search)).get('ux')!=='legacy';
    let visualHost, visualTabs, visualBoard, visualPanels, visualChrome, visualControls, visualMarketSelect, visualActive=null,visualMarket='ALL',visualView='board',visualMarkets=[],visualWork=null;
    const visualOpen=new Map();
    const initialParams=new URLSearchParams(safe(location?.search));
    const initialPO=/^po:[A-Za-z0-9-]{1,128}$/.test(initialParams.get('sel')||'')?initialParams.get('sel').slice(3):null;
    const initialDecision=canOperate && ['commitment','payment','review','variance'].includes(initialParams.get('decision'))?initialParams.get('decision'):null;
    const initialMarket=initialParams.get('market');
    const marketQuery=marketReadOnly && initialMarket ? '&market='+encodeURIComponent(initialMarket) : '';
    const visualBoardEndpoint='/api/hub/board?view=po'+marketQuery;
    // Même route et même tableau des commandes en complément du Kanban ;
    // les commandes non encore rattachées à une PO restent consultables.
    const boardHref=HUB_PATH+'?branch=operations'+(marketReadOnly&&initialMarket?'&market='+encodeURIComponent(initialMarket):'');
    let initialSelectionHandled=false;
    const visualLanes=['Engagement','Soumission','Envoi fournisseur','Confirmation & suivi','Réception & QR','Bilan PO'];
    const workLanes=[{label:'Validation',stages:[0]},{label:'Achats',stages:[1,2,3]},{label:'Réception',stages:[4]},{label:'Emballage',kind:'boxes'},{label:'Expédition',kind:'departure'}];
    const visualStage=p=>{
      if(p.physical_settled===true)return 5;
      if(p.reception_complete)return 4;
      if(p.received>0 || p.purchase_step==='received' || ['confirmed','partially_received','hub_received'].includes(p.purchase_stage))return 4;
      const step=({draft:0,validation:1,engaged:2,sent:3})[p.purchase_step];
      if(step!=null)return step;
      // Le marché ne reçoit pas les autorisations centrales : les étapes
      // affichées sont les faits de la portion locale, sans faux engagement validé.
      return marketReadOnly ? ({draft:0,issued_not_sent:2,sent:3})[p.purchase_stage]??-1 : -1;
    };
    // Le focus d'un bouton ou d'un filtre ne doit jamais immobiliser le Kanban.
    const editingPO=()=>{
      const element=doc.activeElement;
      return Boolean(element && root.contains?.(element) &&
        element.closest?.('.kmc-hub-po-v8-actions') &&
        element.matches?.('input:not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]'));
    };
    let visualSignature=null, visualRead=null;
    const visualRefresh=async({background=false}={})=>{
      if(visualRead)return visualRead;
      visualRead=(async()=>{
        const data=await requestJSON(fetchFn,visualBoardEndpoint);
        if(data.scope!=='HUB_GLOBAL'||!Array.isArray(data.purchase_orders))throw Error('Projection PO indisponible');
        if(marketReadOnly && (data.audience!=='MARKET_SCOPED' ||
          data.purchase_orders.some(p=>p.market_scoped!==true)))throw Error('Projection marché invalide');
        if(root.isConnected===false)return null;
        const signature=JSON.stringify([data.purchase_orders,data.markets||[],data.logistics_work??null]);
        if(background&&signature===visualSignature&&!headerCount.hasAttribute('data-hub-v8-stale')&&!root.hasAttribute('data-hub-v8-access-denied'))return data;
        // Ne pas remplacer les actions pendant une saisie ou une mutation.
        const active=visualOpen.get(visualActive);
        if(background&&(active?.loading||active?.handle?.busy?.()||editingPO()))return null;
        poRows=data.purchase_orders;
        visualMarkets=Array.isArray(data.markets)?data.markets:[];
        visualWork=Array.isArray(data.logistics_work)?data.logistics_work:null;
        renderVisualPO();
        if(background&&active?.handle&&!active.loading&&!active.handle.busy?.()){
          await active.handle.reload?.();
        }
        visualSignature=signature;
        return data;
      })();
      try{return await visualRead;}
      catch(error){
        if(marketReadOnly){
          // Un refus ou une projection inattendue ne doit jamais laisser
          // consultable le dernier dossier d'un droit révoqué.
          poRows=[];rows=[];visualMarkets=[];visualWork=null;visualSignature=null;
          for(const entry of visualOpen.values())entry.panel.remove();
          visualOpen.clear();visualActive=null;
          if(visualHost)visualHost.hidden=true;
          header.hidden=false;search.hidden=true;
          root.setAttribute('data-hub-v8-access-denied','true');
        }
        throw error;
      }finally{visualRead=null;}
    };
    const visualSelect=id=>{
      visualActive=id;visualView='board';
      renderVisualPO();
    };
    // Un dossier logistique porte sur un marché, et non sur une PO.
    // Les groupes relais/rail sont construits par les adaptateurs canoniques.
    const openLogistics=(market,kind,railFilter,work)=>{
      const id='logistics:'+market+':'+kind+(railFilter===undefined?'':':'+railFilter)+(work?':'+work.group_key:'');
      if(!visualOpen.has(id)){
        const panel=make(doc,'section','kmc-hub-po-v8-panel');
        const summary=make(doc,'div','kmc-hub-po-v8-summary');
        const actions=make(doc,'div','kmc-hub-po-v8-actions');
        panel.append(summary,actions);visualPanels.appendChild(panel);
        visualOpen.set(id,{kind,market,railFilter,groupKey:work?.group_key,id,panel,summary,actions,handle:null,loading:false,
          po:{reference:(kind==='boxes'?'COMBOX':'Expédition')+' · '+market+(work?' · '+work.relay_code:'')+(railFilter===undefined?'':railFilter==='SEA_STANDARD'?' · Maritime':railFilter==='AIR_EXPRESS'?' · Aérien':' · À affecter')}});
      }
      visualSelect(id);
    };
    function renderLogistics(entry){
      entry.summary.replaceChildren(make(doc,'h2','',entry.po.reference));
      if(marketReadOnly){
        const work=(visualWork||[]).find(w=>w.market===entry.market && w.group_key===entry.groupKey);
        entry.actions.replaceChildren(make(doc,'h3','','Suivi logistique · Lecture seule'));
        if(work){
          const facts=entry.kind==='boxes'
            ? [['Articles à emballer',work.to_pack],['COMBOX en cours',work.boxes_in_progress]]
            : [['COMBOX à sortir',work.boxes_to_dispatch],['À rattacher',work.boxes_to_attach],['À remettre',work.boxes_to_handover]];
          for(const [label,value] of facts)entry.actions.appendChild(make(doc,'p','',label+' : '+value));
        }else entry.actions.appendChild(make(doc,'p','','Aucune tâche active dans ce périmètre.'));
        return;
      }
      if(visualActive!==entry.id||entry.loading||entry.handle)return;
      const module=global.KomerceCanonicalOperationsWorkspace;
      const mount=entry.kind==='boxes'?module?.mountBoxActions:module?.mountDepartureActions;
      if(!mount){entry.actions.replaceChildren(make(doc,'p','','Atelier canonique indisponible.'));return;}
      entry.loading=true;
      entry.actions.replaceChildren(make(doc,'p','','Chargement…'));
      Promise.resolve().then(()=>mount(entry.actions,{document:doc,fetch:fetchFn,user,
        marketCode:entry.market,marketWide:true,railFilter:entry.railFilter,groupKey:entry.groupKey,boxCreateKeys,hubVerifiedBoxes,
        // An automatic board refresh already awaits this atelier reload. Do not await it recursively.
        onChange:async()=>{if(!visualRead)await visualRefresh();}}))
        .then(handle=>{entry.handle=handle;})
        .catch(error=>{entry.actions.replaceChildren(make(doc,'p','','Action indisponible : '+error.message));})
        .finally(()=>{entry.loading=false;});
    }
    const poTabKey=p=>'po:'+p.market+':'+p.id;
    function createVisualEntry(p,decision=null){
          const key=poTabKey(p);
          if(!visualOpen.has(key)){
            const panel=make(doc,'section','kmc-hub-po-v8-panel');
            const summary=make(doc,'div','kmc-hub-po-v8-summary');
            const actions=make(doc,'div','kmc-hub-po-v8-actions');
            const content=make(doc,'div','kmc-hub-po-v8-content');
            const orders=make(doc,'div','kmc-hub-po-v8-order-card');
            const proofs=make(doc,'aside','kmc-hub-po-v8-proofs');
            const main=make(doc,'div','kmc-hub-po-v8-main');if(decision)main.append(orders,actions);else main.append(actions,orders);content.append(main,proofs);
            panel.append(summary,content);visualPanels.appendChild(panel);
            visualOpen.set(key,{decision,po:p,panel,summary,actions,orders,proofs,handle:null,mode:null,loading:false});
          }
          return key;
    }
    function renderVisualPO(){
      if(!visualHost){
        visualHost=make(doc,'section','kmc-hub-po-visual');
        visualHost.setAttribute('data-hub-po-v8','');
        if(initialDecision)visualHost.classList.add('is-direction-decision');
        visualTabs=make(doc,'nav','kmc-hub-po-v8-tabs');visualTabs.setAttribute('aria-label','Dossiers PO ouverts');
        visualBoard=make(doc,'div','kmc-hub-po-v8-board');
        visualPanels=make(doc,'div','kmc-hub-po-v8-panels');
        visualChrome=make(doc,'section','kmc-hub-po-v8-chrome');
        const top=make(doc,'div','kmc-hub-po-v8-topline');
        const heading=make(doc,'div','kmc-hub-po-v8-heading');
        heading.append(make(doc,'small','kmc-hub-po-v8-eyebrow','Hub / poste de travail'),make(doc,'h2','','Kanban opérationnel'),make(doc,'p','kmc-hub-po-v8-muted',marketReadOnly?'Cinq postes de travail · Suivi des marchés autorisés, sans geste physique.':'Cinq postes de travail · Chaque dossier avance indépendamment.'));
        top.appendChild(heading);
        visualControls=make(doc,'div','kmc-hub-po-v8-board-controls');top.appendChild(visualControls);
        const toolbar=make(doc,'div','kmc-hub-po-v8-toolbar');
        visualMarketSelect=make(doc,'select','');visualMarketSelect.setAttribute('aria-label','Filtrer les PO par marché');visualMarketSelect.setAttribute('data-hub-v8-market','');
        visualMarketSelect.addEventListener('change',()=>{visualMarket=visualMarketSelect.value;renderVisualPO();});
        search.remove();toolbar.append(visualMarketSelect,search);
        visualChrome.append(top,toolbar,headerCount);
        visualHost.append(visualTabs,visualChrome,visualBoard,visualPanels);
        root.insertBefore(visualHost,scroll);
      }
      scroll.hidden=true;visualHost.hidden=false;
      header.hidden=true;
      const all=(poRows||[]).filter(p=>!p.cancelled);
      if(!initialSelectionHandled){
        initialSelectionHandled=true;
        if(initialPO){
          const selected=all.find(p=>String(p.id)===initialPO&&(!initialMarket||p.market===initialMarket));
          if(selected){visualActive=createVisualEntry(selected,initialDecision);}
          else{const notice=make(doc,'p','kmc-hub-action-explanation','PO indisponible dans votre périmètre.');notice.setAttribute('role','alert');visualHost.insertBefore(notice,visualChrome);}
        }
      }
      const term=safe(search.value).trim().toLocaleLowerCase('fr');
      const filtered=all.filter(p=>(visualMarket==='ALL'||p.market===visualMarket)&&[p.reference,p.market,p.supplier,...(p.order_references||[])].some(v=>safe(v).toLocaleLowerCase('fr').includes(term)));
      const markets=[...new Set([...visualMarkets,...all.map(p=>p.market),...rows.map(o=>o.market)].filter(m=>/^[A-Z]{2}$/.test(String(m||''))))].sort();
      if(visualMarket!=='ALL'&&!markets.includes(visualMarket))visualMarket='ALL';
      visualMarketSelect.replaceChildren();
      for(const market of ['ALL',...markets]){const option=make(doc,'option','',market==='ALL'?(marketReadOnly?'Mes marchés autorisés':'Tous les marchés'):market);option.value=market;visualMarketSelect.appendChild(option);}
      visualMarketSelect.value=visualMarket;
      const exceptionPOs=filtered.filter(p=>p.anomalies>0||(p.exceptions||[]).length||visualStage(p)<0);
      const archived=filtered.filter(p=>p.physical_settled===true);
      headerCount.textContent=visualView==='board'?'Opérations · '+filtered.filter(p=>visualStage(p)>=0&&visualStage(p)<5).length+' PO actives':visualView==='exceptions'?'Exceptions · '+exceptionPOs.length+' PO':'Historique · '+archived.length+' PO soldée(s)';
      visualChrome.hidden=Boolean(visualActive);
      visualControls.replaceChildren();
      for(const [view,label] of [['board','Kanban'],['exceptions','Exceptions'+(exceptionPOs.length?' ('+exceptionPOs.length+')':'')],['archive','Historique PO soldées']]){
        if(view==='board'&&visualView==='board')continue;
        const button=make(doc,'button','kmc-hub-app-branch',label);button.type='button';button.setAttribute('data-hub-v8-view',view);button.setAttribute('aria-pressed',String(visualView===view));
        button.addEventListener('click',()=>{visualView=view;renderVisualPO();});visualControls.appendChild(button);
      }
      const ordersLink=make(doc,'a','kmc-hub-app-branch','Vue commandes');
      ordersLink.setAttribute('href',boardHref+'&ux=legacy');visualControls.appendChild(ordersLink);
      const reloadButton=make(doc,'button','kmc-hub-app-branch','Actualiser');
      reloadButton.type='button';reloadButton.addEventListener('click',async()=>{reloadButton.disabled=true;try{await visualRefresh();}catch(error){headerCount.textContent=error.message;}finally{reloadButton.disabled=false;}});visualControls.appendChild(reloadButton);
      visualTabs.replaceChildren();
      const back=make(doc,'button','kmc-hub-app-branch','Kanban');
      back.type='button';back.setAttribute('aria-pressed',String(!visualActive));back.addEventListener('click',()=>visualSelect(null));visualTabs.appendChild(back);
      for(const [id,entry] of visualOpen){
        const tab=make(doc,'button','kmc-hub-app-branch',entry.po.reference);
        tab.type='button';tab.setAttribute('aria-pressed',String(id===visualActive));tab.addEventListener('click',()=>visualSelect(id));
        const tabGroup=make(doc,'div','kmc-hub-po-v8-tab');tabGroup.appendChild(tab);
        const close=make(doc,'button','kmc-hub-po-v8-close','×');
        close.type='button';close.setAttribute('aria-label','Fermer '+entry.po.reference);
        close.disabled=Boolean(entry.loading||entry.handle?.busy?.());
        close.addEventListener('click',()=>{if(entry.loading||entry.handle?.busy?.())return;entry.panel.remove();visualOpen.delete(id);if(visualActive===id)visualActive=null;renderVisualPO();});
        tabGroup.appendChild(close);visualTabs.appendChild(tabGroup);
      }
      if(visualActive){
        if(visualOpen.get(visualActive)?.decision){
          const backDirection=make(doc,'a','kmc-hub-app-branch','Retour Direction Hub');backDirection.setAttribute('href',HUB_PATH+'?branch=direction');visualTabs.appendChild(backDirection);
        }
        const refreshTab=make(doc,'button','kmc-hub-app-branch','Actualiser le dossier');
        refreshTab.type='button';refreshTab.addEventListener('click',async()=>{
          const entry=visualOpen.get(visualActive);
          if(entry?.loading||entry?.handle?.busy?.())return;
          // Relecture du statut sans détruire le formulaire en cours.
          refreshTab.disabled=true;try{await visualRefresh();}catch(error){if(entry?.summary)entry.summary.appendChild(make(doc,'p','','Actualisation indisponible : '+error.message));}finally{refreshTab.disabled=false;}
        });visualTabs.appendChild(refreshTab);
      }
      visualBoard.hidden=Boolean(visualActive);
      visualBoard.className='kmc-hub-po-v8-board'+(visualView==='board'?'':' is-list');
      visualBoard.replaceChildren();
      function ticket(p,stage){
        const card=make(doc,'button','kmc-hub-po-v8-card');
        card.type='button';card.setAttribute('data-hub-po-v8-card',p.id);
        const status=stage===0?'Engagement à valider':stage===1?'À soumettre':stage===2?'Envoi à attester':stage===3?'Confirmation fournisseur':stage===5?'Bilan soldé':p.reception_complete?'Réception complète · bilan à vérifier':stage===4?'Réception / contrôle / QR':'Étape à vérifier';
        card.append(make(doc,'strong','',p.reference),make(doc,'small','kmc-hub-po-v8-muted',marketReadOnly?'Suivi de la PO':p.supplier||'Fournisseur non renseigné'),make(doc,'small','kmc-hub-po-v8-muted',p.market+' · '+p.ordered+' articles'),make(doc,'span','kmc-hub-po-v8-tag',status));
        if(stage===4)card.appendChild(make(doc,'small','',p.received+' / '+p.expected+' reçus'));
        if(visualView==='exceptions')for(const e of p.exceptions||[])card.appendChild(make(doc,'small','',e.reason||e.kind));
        card.addEventListener('click',()=>{
          visualSelect(createVisualEntry(p));
        });return card;
      }
      if(visualView==='board'){
        for(const [i,work] of workLanes.entries()){
          const lane=make(doc,'section','kmc-hub-po-v8-lane');
          lane.setAttribute('data-hub-v8-lane',String(i));
          const title=make(doc,'h3','kmc-hub-po-v8-lanehead');
          title.appendChild(make(doc,'span','',work.label));
          lane.appendChild(title);
          if(work.kind){
            // Accès direct aux ateliers : aucune quantité inventée sur le Kanban.
            const available=markets.filter(m=>visualMarket==='ALL'||m===visualMarket);
            const rails=work.kind==='departure'?[['SEA_STANDARD','Maritime'],['AIR_EXPRESS','Aérien'],[null,'À affecter']]:[[undefined,'Préparation COMBOX']];
            for(const [rail,label] of rails){
              const group=make(doc,'div','kmc-hub-po-v8-log-group');
              group.appendChild(make(doc,'strong','',label));
              if(visualWork!==null){
                const tasks=visualWork.filter(w=>available.includes(w.market)&&(rail===undefined||w.rail===rail)
                  &&(work.kind==='boxes'?w.to_pack+w.boxes_in_progress>0:w.boxes_to_dispatch+w.boxes_to_attach+w.boxes_to_handover>0)
                  &&(!term||[w.market,w.relay_code].some(v=>safe(v).toLocaleLowerCase('fr').includes(term))));
                for(const task of tasks){
                  const card=make(doc,'button','kmc-hub-po-v8-card');
                  card.type='button';card.setAttribute('data-hub-workshop',work.kind);
                  card.append(make(doc,'strong','',task.market+' · '+task.relay_code));
                  if(work.kind==='boxes'){
                    card.appendChild(make(doc,'small','',task.to_pack+' article(s) à emballer · '+task.boxes_in_progress+' COMBOX en cours'));
                    card.appendChild(make(doc,'small','',task.rail==='SEA_STANDARD'?'Maritime':task.rail==='AIR_EXPRESS'?'Aérien':'À affecter'));
                  }else{
                    card.appendChild(make(doc,'small','',(task.boxes_to_dispatch+task.boxes_to_attach+task.boxes_to_handover)+' COMBOX à traiter'));
                    card.appendChild(make(doc,'small','',task.boxes_to_dispatch+' sortie · '+task.boxes_to_attach+' à rattacher · '+task.boxes_to_handover+' à remettre'));
                  }
                  card.addEventListener('click',()=>openLogistics(task.market,work.kind,rail,task));
                  group.appendChild(card);
                }
                if(!tasks.length)group.appendChild(make(doc,'p','kmc-hub-po-v8-empty','Aucune tâche dans ce périmètre'));
              }else{
                // Compatibilité pendant déploiement : accès sans compteur, jamais faux zéro.
                group.appendChild(make(doc,'p','kmc-hub-po-v8-muted','Charge non disponible'));
                for(const market of (marketReadOnly?[]:available)){
                  const card=make(doc,'button','kmc-hub-po-v8-card');
                  card.type='button';card.setAttribute('data-hub-workshop',work.kind);
                  card.append(make(doc,'strong','',market),make(doc,'small','kmc-hub-po-v8-muted','Ouvrir l’atelier'));
                  card.addEventListener('click',()=>openLogistics(market,work.kind,rail));
                  group.appendChild(card);
                }
              }
              lane.appendChild(group);
            }
          }else{
            const list=filtered.filter(p=>work.stages.includes(visualStage(p)));
            title.appendChild(make(doc,'span','kmc-hub-po-v8-count',String(list.length)));
            for(const p of list)lane.appendChild(ticket(p,visualStage(p)));
            if(!list.length)lane.appendChild(make(doc,'p','kmc-hub-po-v8-empty','Aucun dossier'));
          }
          visualBoard.appendChild(lane);
        }
      }else{
        const list=visualView==='exceptions'?exceptionPOs:archived;
        for(const p of list)visualBoard.appendChild(ticket(p,visualStage(p)));
        if(!list.length)visualBoard.appendChild(make(doc,'p','kmc-hub-po-v8-empty',visualView==='archive'?'Aucun bilan physique soldé attesté par le moteur.':'Aucune exception PO dans ce périmètre.'));
      }
      for(const [id,entry] of visualOpen){
        entry.panel.hidden=visualActive!==id;
        if(entry.kind){renderLogistics(entry);continue;}
        const p=all.find(row=>row.id===entry.po.id&&row.market===entry.po.market);
        entry.summary.replaceChildren();
        if(!p){entry.summary.appendChild(make(doc,'p','','PO indisponible ou annulée.'));entry.actions.hidden=true;continue;}
        entry.po=p;entry.actions.hidden=false;
        const stage=visualStage(p);
        const dossierHead=make(doc,'div','kmc-hub-po-v8-dossier-head');
        const identity=make(doc,'div','');identity.append(make(doc,'small','kmc-hub-po-v8-eyebrow',(marketReadOnly?'Dossier PO · ':'Dossier fournisseur · ')+p.market),make(doc,'h2','',p.reference),make(doc,'strong','',marketReadOnly?'Périmètre du marché':p.supplier||'Fournisseur non renseigné'));
        dossierHead.append(identity,make(doc,'span','kmc-hub-po-v8-tag'+(stage===0?' is-neutral':stage===5?' is-green':''),visualLanes[stage]||'À vérifier'));entry.summary.appendChild(dossierHead);
        const metrics=make(doc,'div','kmc-hub-po-v8-metrics');
        for(const [label,value] of (stage<4?[['Attendus',p.ordered]]:[['Reçus',p.received],...(p.missing>0?[['Reliquat',p.missing]]:[])])){
          const metric=make(doc,'div','kmc-hub-po-v8-metric');metric.append(make(doc,'small','',label),make(doc,'strong','',String(value)));metrics.appendChild(metric);
        }entry.summary.appendChild(metrics);
        const progress=make(doc,'div','kmc-hub-po-v8-progress');
        const workStage=stage===0?0:stage>=1&&stage<=3?1:stage===4?2:stage===5?3:-1;
        workLanes.slice(0,3).forEach(({label},i)=>{const item=make(doc,'span',i===workStage?'is-current':i<workStage?'is-done':'',(i<workStage?'✓ ':'')+(i+1)+'. '+label);if(i===workStage)item.setAttribute('aria-current','step');progress.appendChild(item);});
        entry.summary.appendChild(progress);
        if(p.reception_complete&&stage!==5)entry.summary.appendChild(make(doc,'p','kmc-hub-po-v8-muted','Réception complète · contrôle qualité, QR et bilan à vérifier.'));
        const previousOpen=new Set(entry.openOrders||[]);
        const orders=entry.orders;orders.replaceChildren();
        orders.appendChild(make(doc,'h3','','Commandes ('+p.order_count+')'));
        orders.appendChild(make(doc,'p','kmc-hub-po-v8-muted',p.ordered+' articles · Cette PO'));
        for(const ref of p.order_references||[]){
          const lines=(p.order_lines||[]).filter(l=>l.order_ref===ref);
          const details=make(doc,'details','kmc-hub-po-v8-order');details.open=previousOpen.has(ref);
          const qty=lines.reduce((n,l)=>n+Number(stage<4?l.ordered:l.expected),0);
          const got=lines.reduce((n,l)=>n+Number(l.received),0);
          const title=ref+(lines.length?' · '+(stage<4?qty+' attendus':got+' / '+qty+' reçus'):'');
          details.appendChild(make(doc,'summary','',title));
          for(const line of lines){
            const q=stage<4?line.ordered+' attendus':line.received+' / '+line.expected+' reçus'+(line.missing?' · '+line.missing+' attendus':'');
            const fifo=stage>=4&&line.missing>0&&line.fifo_next?' · Prochaine attribution FIFO de cette référence':'';
            details.appendChild(make(doc,'p','', (line.product||'Article')+' · '+q+fifo));
          }
          details.addEventListener('toggle',()=>{const set=new Set(entry.openOrders||[]);if(details.open)set.add(ref);else set.delete(ref);entry.openOrders=[...set];});
          orders.appendChild(details);
        }
        const proofs=entry.proofs;proofs.replaceChildren(make(doc,'h3','','Décisions, preuves & historique'));
        for(const [label,proof] of [['Envoi fournisseur',p.sent_at?[p.sent_channel,p.sent_at].filter(Boolean).join(' · '):null],['Confirmation fournisseur',p.confirmed_at],...(p.receipt_evidence||[]).map(r=>['Réception · '+r.reference,[r.state,r.received_at].filter(Boolean).join(' · ')])]){
          if(!proof)continue;const disclosure=make(doc,'details');disclosure.append(make(doc,'summary','',label),make(doc,'p','',proof));proofs.appendChild(disclosure);
        }
        if(proofs.children.length===1)proofs.appendChild(make(doc,'p','kmc-hub-po-v8-muted','Aucune preuve de ces étapes disponible.'));
        if(visualActive!==id)continue;
        if(!canOperate){
          // Même dossier et mêmes composants de présentation, aucun montage
          // des ateliers writers ni chargement de preuves centrales.
          entry.actions.replaceChildren(make(doc,'h3','','Suivi opérationnel · Lecture seule'));
          for(const [label,value] of [['En COMBOX',p.boxed_quantity],['Sortis du Hub',p.dispatched_quantity],['Remis au transitaire',p.handed_quantity]]){
            if(value!=null)entry.actions.appendChild(make(doc,'p','',label+' : '+value));
          }
          continue;
        }
        // Quantités reçues complètes ne prouvent pas le contrôle qualité ni l'étiquetage.
        const mode=entry.decision==='variance'?'variance':entry.decision?'purchase':stage===4?'reception':stage>=0&&stage<4?'purchase':null;
        entry.panel.classList.toggle('is-direction-decision',Boolean(entry.decision));
        const actionLabel=entry.decision==='commitment'?'Validation de l’engagement':entry.decision==='payment'?'Autorisation de paiement':entry.decision==='review'?'Décisions PO':entry.decision==='variance'?'Arbitrage d’écart fournisseur':visualLanes[stage]||'À vérifier';
        if(entry.loading||entry.handle?.busy?.())continue;
        if(entry.mode===mode && entry.handle){
          if(entry.actionTitle)entry.actionTitle.textContent=actionLabel;
          if(entry.actionEyebrow)entry.actionEyebrow.textContent='Action en cours';
          continue;
        }
        entry.mode=mode;entry.handle=null;
        entry.actionEyebrow=make(doc,'small','kmc-hub-po-v8-eyebrow','Action en cours');
        entry.actionTitle=make(doc,'h3','',actionLabel);
        entry.actions.replaceChildren(entry.actionEyebrow,entry.actionTitle);
        const actionHost=make(doc,'div','kmc-hub-po-v8-action-host');entry.actions.appendChild(actionHost);
        if(!mode){entry.actions.appendChild(make(doc,'p','',stage===5?'Réception complète. Les opérations logistiques restent accessibles dans le parcours existant.':'Étape non déterminée par le serveur.'));continue;}
        const module=global.KomerceCanonicalOperationsWorkspace;
        const mount=mode==='variance'?module?.mountVarianceActions:mode==='purchase'?module?.mountPurchaseActions:module?.mountReceptionActions;
        if(!mount){entry.actions.appendChild(make(doc,'p','','Atelier canonique indisponible.'));continue;}
        entry.loading=true;
        actionHost.appendChild(make(doc,'p','','Chargement…'));
        const changed=async()=>{
          // Background refresh already awaits this PO's canonical reload.
          if(!visualRead)await visualRefresh();
          // Le writer canonique termine sa requête après onChange. Ne pas
          // démonter un formulaire en cours de POST ; attendre sa libération.
          const win=doc.defaultView;
          if(win?.setTimeout){
            let attempts=0;
            const settle=()=>{
              if(!root.contains(visualHost)||visualOpen.get(id)!==entry)return;
              if(entry.loading||entry.handle?.busy?.()){
                if(++attempts<40)win.setTimeout(settle,100);
                return;
              }
              if(poMode)renderVisualPO();
            };
            win.setTimeout(settle,0);
          }
        };
        Promise.resolve().then(()=>mount(actionHost,{document:doc,fetch:fetchFn,user,marketCode:p.market,poId:p.id,receiveRefs,compactPO:true,decisionOnly:entry.decision,onChange:changed})).then(handle=>{entry.handle=handle;}).catch(error=>{entry.actions.replaceChildren(make(doc,'p','','Action indisponible : '+error.message));}).finally(()=>{entry.loading=false;});
      }
    }

    const renderRows = () => {
      if(visualPO){if(poMode)renderVisualPO();return;}
      if(poMode){renderPOs();return;}
      if(visualHost)visualHost.hidden=true;
      header.hidden=false;scroll.hidden=false;
      setHeaders(['Commande / Marché','PO','Fournisseur','Réception','Cartons','Départ','Reste à solder']);
      body.replaceChildren();
      const term = safe(search.value).trim().toLocaleLowerCase('fr');
      const filtered = rows.filter(o => [o.reference, o.market, o.market_name, o.relay_name]
        .some(v => safe(v).toLocaleLowerCase('fr').includes(term)));
      headerCount.textContent = filtered.length + ' / ' + rows.length + ' commande(s)';
      if (!filtered.length) {
        const tr = make(doc, 'tr');
        const td = make(doc, 'td', '', term ? 'Aucune commande correspondante.' : 'Aucune commande import active.');
        td.colSpan = 7;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const order of filtered) {
        const tr = make(doc, 'tr');
        tr.setAttribute('data-hub-global-order', order.reference);
        const identity = make(doc, 'td');
        const idBox = make(doc, 'div', 'kmc-hub-board-identity');
        idBox.appendChild(make(doc, 'strong', '', order.reference));
        idBox.appendChild(make(doc, 'small', '', order.market + ' · ' + (order.market_name || order.market)));
        if (order.relay_name) {
          const relay=make(doc,'small','kmc-hub-destination','Relais · '+order.relay_name);
          relay.setAttribute('data-hub-relay-destination','');
          idBox.appendChild(relay);
        }
        if (order.current_key && !['locked','complete'].includes(order.stage_states?.[order.current_key])) {
          tr.classList.add('is-hub-active-order');
        }
        if (order.current_phase) {
          const phase = make(doc, 'div', 'kmc-hub-phase-summary');
          phase.appendChild(make(doc, 'span', 'kmc-hub-phase-title',
            order.current_phase + ' · ' + (order.current_status || 'Situation à vérifier')));
          // Le détail du prochain geste appartient au menu de l’étape ;
          // le reliquat et les anomalies restent visibles dans leur colonne.
          idBox.appendChild(phase);
        }
        if (order.next_action) {
          const next = make(doc, 'small', 'kmc-hub-next-action', order.next_action);
          next.setAttribute('data-hub-next-action','');
          idBox.appendChild(next);
        }
        identity.appendChild(idBox);
        tr.appendChild(identity);
        for (const [label, key] of [
          ['PO', 'po'], ['Fournisseur', 'supplier'], ['Réception', 'reception'],
          ['Cartons', 'cartons'], ['Départ', 'departure'], ['Reste à solder', 'remaining'],
        ]) {
          const td = make(doc, 'td');
          const button = make(doc, 'button', 'kmc-hub-board-cell');
          button.appendChild(make(doc, 'strong', 'kmc-hub-stage-primary', order[key] || '—'));
          button.type = 'button';
          button.setAttribute('data-hub-global-stage', label);
          button.setAttribute('aria-label', order.reference + ' · ' + label + ' · ' + (order[key] || '—'));
          const state = order.stage_states && order.stage_states[key];
          if (['muted','waiting','progress','warning','ready','complete','critical','locked'].includes(state)) {
            button.classList.add('is-stage-'+state);
          }
          if (order.current_key === key && !['locked','complete'].includes(state)) {
            button.classList.add('is-stage-current');
            button.setAttribute('aria-current', 'step');
            // Le texte porte le sens indépendamment du halo et de la couleur.
            const focusLabel = state === 'critical' ? 'INCIDENT À TRAITER'
              : state === 'warning' ? 'POINT À RÉSOUDRE'
              : state === 'waiting' ? 'EN ATTENTE'
              : state === 'ready' ? 'PRÊT À AGIR'
              : state === 'progress' ? 'EN COURS'
              : 'À TRAITER';
            const focusSignal = make(doc, 'span', 'kmc-hub-stage-focus-label', focusLabel);
            focusSignal.setAttribute('data-hub-focus-signal', state || 'unknown');
            button.insertBefore(focusSignal, button.firstChild);
          }
          if (state === 'locked') {
            button.setAttribute('aria-label', order.reference + ' · ' + label + ' · Terminée, verrouillée · ' + (order[key] || '—'));
            button.appendChild(make(doc, 'small', 'kmc-hub-stage-proof', '✓ Terminée · verrouillée · voir la preuve'));
          } else if (state === 'complete') {
            button.appendChild(make(doc, 'small', 'kmc-hub-stage-proof', '✓ Terminée · consulter'));
          } else if (order.current_key === key) {
            button.appendChild(make(doc, 'small', 'kmc-hub-stage-proof', '▶ À faire / suivre maintenant'));
          } else if (state === 'muted') {
            button.appendChild(make(doc, 'small', 'kmc-hub-stage-proof', 'À venir'));
          } else if (state === 'waiting') {
            button.appendChild(make(doc, 'small', 'kmc-hub-stage-proof', '◷ En attente'));
          }
          if (key === 'remaining' && order.attention) button.classList.add('is-attention');
          if (key === 'remaining' && order.remaining_detail) {
            button.appendChild(make(doc, 'small', '', order.remaining_detail));
          }
          button.addEventListener('click', event => openMenu(order, label, order[key], event));
          button.addEventListener('contextmenu', event => {
            event.preventDefault();
            openMenu(order, label, order[key], event);
          });
          const actions = make(doc,'div','kmc-hub-kanban-stage-actions');
          actions.appendChild(button);
          // Raccourci de navigation : ouvre les liens vers l’atelier canonique.
          const nextText = safe(order.next_action);
          const isWaitingOnly = /^(attendr|attente|suivre|consulter|aucune)/i.test(nextText);
          if (canOperate && order.current_key===key && !['locked','complete'].includes(state) && !isWaitingOnly) {
            const command = make(doc,'button','kmc-hub-kanban-action','Ouvrir l’atelier · '+label);
            command.type='button';
            command.setAttribute('data-hub-inline-action',key);
            command.setAttribute('aria-label',order.reference+' · Ouvrir l’atelier : '+label);
            command.addEventListener('click',event=>{
              event.stopPropagation();
              openMenu(order,label,order[key],event);
            });
            actions.appendChild(command);
          }
          td.appendChild(actions);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    };
    if(marketReadOnly && !visualPO){
      const kanbanLink=make(doc,'a','kmc-hub-app-branch','Vue PO · Kanban');
      kanbanLink.setAttribute('href',boardHref);header.appendChild(kanbanLink);
    }
    if(canOperate && !visualPO){
      const pilot=make(doc,'button','kmc-hub-app-branch','Vue PO · pilote');
      pilot.type='button';pilot.setAttribute('data-hub-po-pilot-toggle','');
      pilot.setAttribute('aria-pressed','false');
      header.replaceChildren(headerTitle,pilot,headerCount);
      pilot.addEventListener('click',async()=>{
        closeMenu();
        const serial=++pilotRequest;
        if(poMode){
          poMode=false;pilot.setAttribute('aria-pressed','false');pilot.textContent='Vue PO · pilote';
          headerTitle.textContent=orderHeader;search.placeholder='Rechercher une commande ou un marché';
          search.setAttribute('aria-label',search.placeholder);renderRows();return;
        }
        pilot.disabled=true;
        try{
          const data=await requestJSON(fetchFn,'/api/hub/board?view=po');
          if(serial!==pilotRequest)return;
          if(data.scope!=='HUB_GLOBAL'||!Array.isArray(data.purchase_orders))throw new Error('Projection PO indisponible');
          poRows=data.purchase_orders;poMode=true;
          pilot.setAttribute('aria-pressed','true');pilot.textContent='Revenir aux commandes';
          headerTitle.textContent=marketReadOnly?'PO · Mes marchés autorisés':'PO fournisseurs · Tous les marchés';
          search.placeholder='Rechercher PO, fournisseur, commande ou marché';search.setAttribute('aria-label',search.placeholder);
          renderRows();
        }catch(error){headerCount.textContent='Vue PO indisponible : '+error.message;}
        finally{pilot.disabled=false;}
      });
    }
    if(visualPO){
      const refresh=make(doc,'button','kmc-hub-app-branch','Actualiser les PO');
      refresh.type='button';
      refresh.setAttribute('data-hub-v8-retry','');
      refresh.addEventListener('click',async()=>{
        refresh.disabled=true;
        try{
          await visualRefresh();
          poMode=true;search.hidden=false;search.placeholder='Rechercher une PO ou un fournisseur';search.setAttribute('aria-label',search.placeholder);headerTitle.textContent=marketReadOnly?'PO · Mes marchés autorisés':'PO fournisseurs · Tous les marchés';
          const entry=visualOpen.get(visualActive);
          if(entry?.handle && !entry.loading && !entry.handle.busy?.())await entry.handle.reload?.();
        }catch(error){headerCount.textContent=error.message;}
        finally{refresh.disabled=false;}
      });
      header.appendChild(refresh);
      // Ouverture directe sur le Kanban PO depuis le menu normal.
      try{await visualRefresh();poMode=true;headerTitle.textContent=marketReadOnly?'PO · Mes marchés autorisés':'PO fournisseurs · Tous les marchés';search.placeholder='Rechercher une PO ou un fournisseur';search.setAttribute('aria-label',search.placeholder);renderVisualPO();
      }catch(error){if(visualHost)visualHost.hidden=true;scroll.hidden=true;header.hidden=false;search.hidden=true;headerTitle.textContent='Kanban opérationnel';headerCount.textContent='Vue PO indisponible : '+error.message;}
      // Même signal inter-instances que la Direction, mais relecture ciblée
      // du Kanban : aucun remontage du poste ni perte des onglets ouverts.
      global.KomerceDashboardFreshness?.watch?.({
        root, pollMs:30000,
        isBusy:()=>Boolean(visualRead||visualOpen.get(visualActive)?.loading||visualOpen.get(visualActive)?.handle?.busy?.()||editingPO()),
        refresh:async()=>{
          try{
            const data=await visualRefresh({background:true});
            if(data){poMode=true;search.hidden=false;headerCount.removeAttribute('data-hub-v8-stale');root.removeAttribute('data-hub-v8-access-denied');}
            return data;
          }catch(error){
            headerCount.setAttribute('data-hub-v8-stale','true');
            headerCount.textContent='Actualisation indisponible — données potentiellement périmées.';
            if(error.status===401||error.status===403){
              if(visualHost)visualHost.hidden=true;
              header.hidden=false;root.setAttribute('data-hub-v8-access-denied','true');
            }
            return null;
          }
        },
      });
    }
    search.addEventListener('input', ()=>{closeMenu();renderRows();});
    try {
      const payload = await requestJSON(fetchFn, '/api/hub/board'+(marketQuery?'?'+marketQuery.slice(1):''));
      if (payload.scope !== 'HUB_GLOBAL' || !Array.isArray(payload.orders)
        || (marketReadOnly && payload.audience!=='MARKET_SCOPED')) {
        throw new Error('Réponse globale Hub invalide');
      }
      if (user?.role === 'market_operator'
        && payload.audience === 'MARKET_SCOPED'
        && Array.isArray(payload.markets)) {
        const scopeLabel = doc.querySelector?.('.kmc-hub-global-scope');
        if (scopeLabel) {
          const markets = [...new Set(payload.markets.map(market => safe(market).trim()).filter(Boolean))];
          scopeLabel.textContent = markets.length
            ? 'Hub · ' + markets.join(', ')
            : 'Hub · Aucun marché autorisé';
        }
      }
      rows = payload.orders;
      renderRows();
      return payload;
    } catch (error) {
      if(visualPO)return null;
      body.replaceChildren();
      headerCount.textContent = 'Indisponible';
      const tr = make(doc, 'tr');
      const td = make(doc, 'td', 'kmc-hub-app-list-error',
        'Impossible de charger la vue centrale Hub : ' + error.message);
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
      return null;
    }
  }


  const ADMIN_PO_STAGE = Object.freeze({
    draft: 'Brouillon à préparer',
    issued_not_sent: 'Envoi à prouver',
    sent: 'En attente fournisseur',
    confirmed: 'Confirmée fournisseur',
    partially_received: 'Réception partielle',
    received: 'Réceptionnée',
    cancelled: 'Annulée',
  });

  async function renderAdministrationBoard(root, {document:doc, fetch:fetchFn, user} = {}) {
    if (!root || !doc || typeof fetchFn !== 'function') throw new Error('hub_admin_board_context_missing');
    if (!['admin','agent_hub'].includes(user && user.role)) throw new Error('hub_admin_board_role_not_allowed');
    boardDisposers.get(root)?.();
    boardDisposers.delete(root);
    root.replaceChildren();

    const top = make(doc, 'div', 'kmc-hub-global-toolbar');
    top.appendChild(make(doc, 'strong', '', 'Achats fournisseurs · Tous les marchés'));
    const count = make(doc, 'span', 'kmc-hub-global-count', 'Chargement…');
    top.appendChild(count);
    root.appendChild(top);
    const stats = make(doc, 'div', 'kmc-hub-admin-stats');
    stats.setAttribute('data-hub-admin-stats', '');
    root.appendChild(stats);

    const tools = make(doc, 'div', 'kmc-hub-admin-toolbar');
    const tabs = make(doc, 'div', 'kmc-hub-admin-tabs');
    const views = [
      {id:'engagements', label:'PO & engagements'},
      {id:'payments', label:'Paiements fournisseurs'},
    ];
    const buttons = [];
    let view = 'engagements';
    for (const option of views) {
      const button = make(doc, 'button', 'kmc-hub-admin-tab', option.label);
      button.type = 'button';
      button.setAttribute('data-hub-admin-view', option.id);
      button.addEventListener('click', () => {view=option.id; renderRows();});
      tabs.appendChild(button);
      buttons.push(button);
    }
    tools.appendChild(tabs);
    const search = make(doc, 'input', 'kmc-hub-app-search');
    search.type = 'search';
    search.placeholder = 'Rechercher PO, fournisseur ou marché';
    search.setAttribute('aria-label', search.placeholder);
    tools.appendChild(search);
    root.appendChild(tools);

    const scroll = make(doc, 'div', 'kmc-hub-board-scroll');
    const table = make(doc, 'table', 'kmc-hub-board kmc-hub-admin-table');
    table.setAttribute('aria-label', 'Ordres d’achat et engagements fournisseurs du Hub');
    const head = make(doc, 'thead');
    const body = make(doc, 'tbody');
    table.appendChild(head);
    table.appendChild(body);
    scroll.appendChild(table);
    root.appendChild(scroll);

    const note = make(doc, 'p', 'kmc-hub-admin-note',
      'Autorisation de la directrice : deux décisions distinctes (engagement d’achat, paiement fournisseur), ' +
      'tracées avec décideur, date, montant et pièce. Aucune validation n’est déduite du statut de PO ni d’un débit.');
    root.appendChild(note);

    const menu = make(doc, 'div', 'kmc-hub-board-menu');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Actions et justificatifs de la PO');
    menu.setAttribute('data-hub-admin-menu', '');
    menu.hidden = true;
    root.appendChild(menu);
    let anchor;
    const closeMenu = () => {
      menu.hidden = true;
      menu.setAttribute('data-hub-request', String(Date.now()) + '-closed');
      anchor?.clear();
    };
    anchor=anchoredMenu(menu,scroll,doc,closeMenu);
    installMenuDismiss(root, doc, menu, closeMenu, anchor.move, anchor.restoreFocus);
    const openMenu = (po, field, value, event) => {
      menu.replaceChildren();
      menu.scrollTop = 0;
      menu.classList.remove('is-editing','is-purchasing-flow');
      menu.appendChild(make(doc, 'strong', 'kmc-hub-board-menu-title',
        'PO ' + smallRef(po.id) + ' · ' + field));
      menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary', value));
      // Pas de lien "Ouvrir la PO" répété dans toutes les colonnes. Chaque
      // cellule exprime une action possible ou une dépendance précise.
      const close = make(doc, 'button', 'kmc-hub-board-menu-action is-dismiss', 'Fermer');
      close.type = 'button';
      close.addEventListener('click', closeMenu);
      menu.appendChild(close);
      menu.hidden = false;
      if (global.KomerceHubContextActions) {
        global.KomerceHubContextActions.administration(menu,{
          doc,fetch:fetchFn,user,po,field,grants:viewerGrants,
          refresh:()=>renderAdministrationBoard(root,{document:doc,fetch:fetchFn,user}),
        });
      } else {
        menu.appendChild(make(doc,'p','kmc-hub-action-explanation',
          'Les actions de cette étape ne sont pas chargées. Actualiser la page.'));
      }
      anchor.select(event?.currentTarget);
      menu.querySelector?.('a,button')?.focus?.({preventScroll:true});
    };
    // Échap et clic extérieur gérés par installMenuDismiss().

    let rows = [];
    let viewerGrants = {};
    const cellAction = (tr, po, field, value, hint) => {
      const td = make(doc, 'td');
      const button = make(doc, 'button', 'kmc-hub-board-cell', value || '—');
      button.type = 'button';
      button.setAttribute('data-hub-admin-stage', field);
      if (field==='Engagement'||field==='Autorisation') {
        button.classList.add('is-stage-decision');
      } else if (field==='Paiement') {
        button.classList.add(value==='Débit constaté'?'is-stage-complete':'is-stage-warning');
      } else if (field==='Fournisseur') {
        button.classList.add(po.sent_at?'is-stage-complete':'is-stage-warning');
      } else if (field==='Réception') {
        button.classList.add(po.received >= po.expected && po.expected>0?'is-stage-complete':
          po.received>0?'is-stage-progress':'is-stage-muted');
      }
      if (hint) button.appendChild(make(doc, 'small', '', hint));
      button.addEventListener('click', event => openMenu(po, field, value, event));
      button.addEventListener('contextmenu', event => {event.preventDefault(); openMenu(po,field,value,event);});
      td.appendChild(button);
      tr.appendChild(td);
    };
    const renderRows = () => {
      body.replaceChildren();
      head.replaceChildren();
      buttons.forEach((button, i) => {
        const active = views[i].id === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const labels = view === 'engagements'
        ? ['PO / Fournisseur','Marché','Commandes','Engagement','Envoi fournisseur','Réception','Paiement']
        : ['PO / Fournisseur','Marché','Débit fournisseur','Autorisation directrice','Preuve'];
      const hrow = make(doc,'tr');
      for (const label of labels) hrow.appendChild(make(doc,'th','',label));
      head.appendChild(hrow);
      const term = safe(search.value).trim().toLocaleLowerCase('fr');
      const matching = rows.filter(po => [po.id,po.supplier,po.market,po.stage,po.payment_evidence]
        .some(v=>safe(v).toLocaleLowerCase('fr').includes(term)));
      count.textContent = matching.length + ' / ' + rows.length + ' PO';
      if (!matching.length) {
        const tr = make(doc,'tr');
        const td = make(doc,'td','',term ? 'Aucune PO correspondante.' : 'Aucune PO fournisseur pour les marchés actifs.');
        td.colSpan=labels.length;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const po of matching) {
        const tr = make(doc,'tr');
        tr.setAttribute('data-hub-admin-po',po.id);
        const identity = make(doc,'td');
        const wrap = make(doc,'div','kmc-hub-board-identity');
        wrap.appendChild(make(doc,'strong','', 'PO ' + smallRef(po.id)));
        wrap.appendChild(make(doc,'small','', po.supplier));
        const next = po.stage==='draft'?'Préparer la PO':
          po.stage==='issued_not_sent'?'Attester l’envoi':
          po.stage==='sent'?'Suivre le fournisseur':
          po.payment_evidence==='Débit à rapprocher'?'Rapprocher le débit':'Suivre la réception';
        wrap.appendChild(make(doc,'small','kmc-hub-next-action',next));
        identity.appendChild(wrap);
        tr.appendChild(identity);
        tr.appendChild(make(doc,'td','',po.market || '—'));
        if (view === 'engagements') {
          tr.appendChild(make(doc,'td','',String(po.order_count || 0)));
          cellAction(tr,po,'Engagement', ADMIN_PO_STAGE[po.stage] || po.stage || 'À vérifier',
            po.commitment_authorization || 'À valider');
          cellAction(tr,po,'Fournisseur',po.sent_at ? 'Envoi enregistré' : 'Envoi non prouvé');
          cellAction(tr,po,'Réception',
            po.received ? po.received + ' / ' + po.expected + ' reçu(s)' : 'Non reçue',
            po.anomalies ? po.anomalies + ' à contrôler' : '');
          cellAction(tr,po,'Paiement',po.payment_evidence);
        } else {
          cellAction(tr,po,'Paiement',po.payment_evidence,
            po.payment_count ? po.verified_debit_count + ' / ' + po.payment_count + ' preuve(s) de débit' : '');
          cellAction(tr,po,'Autorisation',po.payment_authorization);
          cellAction(tr,po,'Justificatifs',
            po.payment_count ? po.payment_count + ' paiement(s) référencé(s)' : 'Aucun débit référencé');
        }
        body.appendChild(tr);
      }
    };
    search.addEventListener('input',renderRows);
    try {
      const payload = await requestJSON(fetchFn,'/api/hub/administration');
      if (payload.scope !== 'HUB_ADMINISTRATION_GLOBAL' || !Array.isArray(payload.purchase_orders))
        throw new Error('Réponse Administration Hub invalide');
      rows=payload.purchase_orders;
      viewerGrants=payload.viewer_grants || {};
      const metrics=[
        ['PO',payload.kpis?.purchase_orders],
        ['Brouillons',payload.kpis?.drafts],
        ['Envois à prouver',payload.kpis?.to_send],
        ['Suivis fournisseurs',payload.kpis?.supplier_waiting],
        ['Débits à rapprocher',payload.kpis?.payment_to_reconcile],
      ];
      stats.replaceChildren();
      for(const [label,value] of metrics){
        const box = make(doc,'div','kmc-hub-admin-stat');
        box.appendChild(make(doc,'strong','',String(Number(value)||0)));
        box.appendChild(make(doc,'span','',label));
        stats.appendChild(box);
      }
      renderRows();
      return payload;
    } catch (error) {
      count.textContent='Indisponible';
      const tr = make(doc,'tr');
      const td = make(doc,'td','kmc-hub-app-list-error','Administration indisponible : ' + error.message);
      td.colSpan=7;
      tr.appendChild(td);
      body.replaceChildren(tr);
      return null;
    }
  }

  function mount(options = {}) {
    const {root, user, document:doc, location, history, fetch:fetchFn,
      renderAdministrative, renderOperations} = options;
    if (!root || !doc || !user) throw new Error('hub_workstation_context_missing');
    if (typeof renderAdministrative !== 'function' || typeof renderOperations !== 'function')
      throw new Error('hub_workstation_renderers_missing');
    const role = safe(user.role);
    const visibleRoles=['admin','agent_hub','market_operator','agent_relais','finance','sourcing','support'];
    if(!visibleRoles.includes(role)) throw new Error('hub_workstation_role_not_allowed');
    const administrativeAllowed = role === 'admin' || role === 'agent_hub';
    const params = new URLSearchParams(safe(location?.search));
    const scopedPO=/^po:[A-Za-z0-9-]{1,128}$/.test(params.get('sel')||'')&&/^[A-Z]{2}$/.test(params.get('market')||'')&&parseBranch(safe(location?.search))==='operations'&&administrativeAllowed;
    const scopedMarketRead = role === 'market_operator' && params.has('market') && parseBranch(safe(location?.search))==='operations';
    if (params.has('market') && !scopedPO && !scopedMarketRead && history?.replaceState) {
      params.delete('market');
      history.replaceState(null,'',HUB_PATH + (params.toString() ? '?' + params.toString() : ''));
    }
    const requested=parseBranch(safe(location?.search));
    const branch=(requested === 'administrative' || requested === 'direction') ? (administrativeAllowed ? 'direction' : 'operations') : requested;
    root.replaceChildren();
    root.className='kmc-hub-app';
    const header=make(doc,'header','kmc-hub-app-header');
    const heading=make(doc,'div','kmc-hub-app-title');
    heading.appendChild(make(doc,'span','kmc-hub-app-eyebrow','KOMERCE · HUB'));
    heading.appendChild(make(doc,'h1','',role === 'market_operator' ? 'Hub · Mes marchés' : 'Hub · Tous les marchés'));
    heading.appendChild(make(doc,'p','','Achats fournisseurs, réception, préparation et expéditions'));
    header.appendChild(heading);
    // Mode plein poste : garder l'action dans le Kanban, libérer l'espace
    // occupé par le menu de navigation, sans perdre l'accès à ce menu.
    // Défaut pour les agents Hub sur la branche opérationnelle uniquement.
    const focusToggle=make(doc,'button','kmc-hub-focus-toggle');
    focusToggle.type='button';
    focusToggle.setAttribute('data-hub-focus-toggle','');
    let focusEnabled=role==='agent_hub' && branch==='operations';
    const applyFocus=() => {
      root.classList.toggle('is-focus-workspace',focusEnabled);
      doc.body?.classList?.toggle('kmc-hub-agent-focus',focusEnabled);
      focusToggle.setAttribute('aria-pressed',String(focusEnabled));
      focusToggle.textContent=focusEnabled?'↙ Réafficher la navigation':'⤢ Agrandir le Kanban';
      focusToggle.setAttribute('aria-label',focusEnabled
        ?'Quitter le mode concentré et réafficher la navigation':'Activer le mode concentré du Hub');
    };
    focusToggle.addEventListener('click',()=>{
      focusEnabled=!focusEnabled;
      applyFocus();
    });
    header.appendChild(focusToggle);
    applyFocus();
    root.appendChild(header);
    const nav=make(doc,'nav','kmc-hub-app-branches');
    nav.setAttribute('aria-label','Postes de travail Hub');
    for(const id of ['operations','direction']){
      if(id !== 'operations' && !administrativeAllowed)continue;
      const spec=BRANCHES[id];
      const link=make(doc,'a','kmc-hub-app-branch');
      const branchHref=href(id,safe(location?.search));
      const selectedMarket=params.get('market');
      link.setAttribute('href',scopedMarketRead&&id==='operations'&&selectedMarket
        ? branchHref+'&market='+encodeURIComponent(selectedMarket) : branchHref);
      link.setAttribute('data-hub-branch',id);
      if(id === branch){link.classList.add('is-active');link.setAttribute('aria-current','page');}
      const copy=make(doc,'span','kmc-hub-app-branch-copy');
      copy.appendChild(make(doc,'strong','',spec.label));
      copy.appendChild(make(doc,'small','',spec.hint));
      link.appendChild(copy);
      nav.appendChild(link);
    }
    root.appendChild(nav);
    const layout=make(doc,'div','kmc-hub-app-layout is-table');
    const content=make(doc,'section','kmc-hub-app-content');
    content.setAttribute('data-hub-active-branch',branch);
    // La Direction dispose d'un onglet de lecture propre. Le Kanban reste
    // le premier contenu de la vue Opérations, sans file déployée au-dessus.
    const host=make(doc,'div','kmc-hub-app-workspace');
    host.setAttribute('data-hub-branch-workspace',branch);
    content.appendChild(host);
    layout.appendChild(content);
    root.appendChild(layout);
    // Ancien lien direct conservé pour les preuves historiques, jamais un troisième onglet.
    const legacyAdministration=branch==='direction'&&requested==='administrative';
    const adminHost=legacyAdministration?make(doc,'div','kmc-hub-direction-administration'):null;
    const directorHost=make(doc,'div','kmc-hub-direction-decisions');
    if(branch==='direction'){
      if(legacyAdministration){
        const back=make(doc,'a','kmc-hub-app-branch','Retour à Direction Hub');
        back.setAttribute('href',HUB_PATH+'?branch=direction');
        host.append(back,adminHost);
      }else host.appendChild(directorHost);
    }
    const reloadCases=()=>Promise.resolve(
      branch === 'direction'
        ? (legacyAdministration?renderAdministrative(adminHost):renderDirectorQueue(directorHost,{document:doc,fetch:fetchFn,user}))
        :renderOperations(host)
    );
    const selected=reloadCases();
    const directorLoad=branch==='direction' ? selected : Promise.resolve(null);
    // Direction = vue read-only. SSE inter-instances + relecture de secours
    // restent strictement séparés des writers Achats/Opérations.
    const liveSync = branch==='direction' && !legacyAdministration && global.KomerceDashboardFreshness?.watch
      ? global.KomerceDashboardFreshness.watch({root:host, refresh:reloadCases, pollMs:60000})
      : null;
    selected.catch?.(()=>{});
    const selectPO=id=>{
      if(branch !== 'direction' || !adminHost)return;
      const cells=adminHost.querySelectorAll?.('[data-hub-admin-po]') || [];
      const row=[...cells].find(node=>node.getAttribute('data-hub-admin-po')===id);
      if(row?.scrollIntoView)row.scrollIntoView({block:'nearest'});
    };
    const selectOrder=id=>{
      if(branch !== 'operations')return;
      const rows=host.querySelectorAll?.('[data-hub-global-order]') || [];
      const row=[...rows].find(node=>node.getAttribute('data-hub-global-order')===id);
      if(row?.scrollIntoView)row.scrollIntoView({block:'nearest'});
    };
    return Object.freeze({branch,reloadCases,selectPO,selectOrder,directorLoad,liveSync});
  }

  global.KomerceCanonicalHubWorkstation = Object.freeze({
    mount, renderGlobalBoard, renderAdministrationBoard, renderDirectorQueue, parseBranch, href, BRANCHES, PO_STAGE,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
