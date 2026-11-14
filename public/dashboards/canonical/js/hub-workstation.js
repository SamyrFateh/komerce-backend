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
    operations: { label: 'Opérations', hint: 'Réception, contrôle et expéditions' },
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
    params.delete('market'); // Hub global : jamais de contexte marché sur la vue centrale.
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
  function installMenuDismiss(root, doc, menu, close, onMove) {
    const previous = boardDisposers.get(root);
    if (previous) previous();
    const outside = event => {
      if (!menu.hidden && !menu.contains(event.target)) close();
    };
    const escape = event => {
      if (event.key === 'Escape' && !menu.hidden) close();
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', escape);
    // Capture les scrolls horizontaux ET verticaux des parents du Kanban.
    // Le menu est positionné à partir de la cellule, jamais des anciennes coordonnées souris.
    if(onMove) {
      doc.addEventListener('scroll', onMove, true);
      doc.defaultView?.addEventListener('resize',onMove);
      menu.addEventListener?.('hub:menu-state',onMove);
    }
    boardDisposers.set(root, () => {
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('keydown', escape);
      if(onMove) {
        doc.removeEventListener('scroll', onMove, true);
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
    heading.addEventListener('click',()=>{
      const open=content.hidden;
      content.hidden=!open;
      heading.setAttribute('aria-expanded',String(open));
      heading.textContent=open?'Journal de suivi · Masquer les notes':'Journal de suivi · Voir les notes';
      if(open) void load();
    });
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
    const panel=make(doc,'details','hlc-director');
    panel.setAttribute('data-hub-director-todo','');
    panel.open=true;
    const heading=make(doc,'summary','hlc-director-summary','Direction Hub · Tous marchés · Chargement…');
    panel.appendChild(heading);
    const body=make(doc,'div','hlc-director-body','Chargement des tâches et de leur ancienneté…');
    body.setAttribute('role','status');
    panel.appendChild(body);
    host.appendChild(panel);
    try {
      const payload=await requestJSON(fetchFn,'/api/hub/director-todo');
      // Une navigation a pu détruire le poste. Ne rien injecter dans l'ancien document.
      if (panel.isConnected === false) return null;
      if (payload.scope !== 'ALL_MARKETS' || !Array.isArray(payload.tasks)) throw new Error('Réponse direction Hub invalide');
      heading.textContent='Direction Hub · Tous marchés · '+payload.tasks.length+
        ' tâche(s) · '+Number(payload.overdue_count||0)+' alerte(s) ≥ 48 h';
      body.replaceChildren();
      if (!payload.tasks.length) {
        body.appendChild(make(doc,'p','hlc-director-empty','Aucune tâche Hub en attente sur les marchés actifs.'));
        return payload;
      }
      const list=make(doc,'div','hlc-director-list');
      list.setAttribute('data-hub-director-list','');
      for(const task of payload.tasks) {
        const row=make(doc,'div','hlc-director-task'+(task.overdue?' is-overdue':''));
        row.setAttribute('data-hub-director-task',safe(task.kind||'TASK'));
        const market=safe(task.market&&task.market.code||'—');
        row.appendChild(make(doc,'strong','hlc-director-market',market));
        const detail=make(doc,'span','hlc-director-detail');
        detail.appendChild(make(doc,'strong','hlc-director-name',task.missing||task.kind||'Tâche Hub'));
        if (task.why) detail.appendChild(make(doc,'span','hlc-director-why',task.why));
        row.appendChild(detail);
        const age=task.age_hours == null?'Âge inconnu':
          task.age_hours>=48?Math.floor(task.age_hours/24)+' j':task.age_hours+' h';
        row.appendChild(make(doc,'span','hlc-director-age'+(task.overdue?' is-overdue':''),
          (task.overdue?'⚠ ':'')+age));
        if (/^[A-Z]{2}$/.test(market)) {
          const link=make(doc,'a','hlc-director-open','Ouvrir le marché');
          link.setAttribute('href','/admin/hub-live?view=execute&market='+encodeURIComponent(market));
          row.appendChild(link);
        }
        list.appendChild(row);
      }
      body.appendChild(list);
      return payload;
    } catch(error) {
      if (panel.isConnected !== false) {
        heading.textContent='Direction Hub · Tous marchés · Indisponible';
        body.textContent='La supervision ne peut pas être chargée : '+safe(error.message||error);
      }
      return null;
    }
  }

  // Le Hub est une entité centrale : ce tableau agrège TOUS les marchés
  // sans sélecteur de marché. Les opérations utilisent ensuite, si besoin,
  // le marché d'une commande pour cibler leur writer canonique.
  async function renderGlobalBoard(root, { document:doc, fetch:fetchFn, user } = {}) {
    if (!root || !doc || typeof fetchFn !== 'function') {
      throw new Error('hub_global_board_context_missing');
    }
    boardDisposers.get(root)?.();
    boardDisposers.delete(root);
    root.replaceChildren();
    const header = make(doc, 'div', 'kmc-hub-global-toolbar');
    header.appendChild(make(doc, 'strong', '', 'Toutes les commandes import · Tous les marchés'));
    header.appendChild(make(doc, 'span', 'kmc-hub-global-count', 'Chargement…'));
    root.appendChild(header);
    const search = make(doc, 'input', 'kmc-hub-app-search');
    search.type = 'search';
    search.placeholder = 'Rechercher une commande ou un marché';
    search.setAttribute('aria-label', search.placeholder);
    root.appendChild(search);
    const scroll = make(doc, 'div', 'kmc-hub-board-scroll');
    const table = make(doc, 'table', 'kmc-hub-board kmc-hub-global-table');
    table.setAttribute('aria-label', 'Tableau central Hub, tous les marchés');
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
    let anchor;
    let menuSerial = 0;
    const closeMenu = () => {
      menu.hidden = true;
      menu.setAttribute('data-hub-request', String(++menuSerial));
      anchor?.clear();
    };
    const openMenu = (order, label, value, event, launchSourcing = false) => {
      // Ce menu appartient à UNE étape. Aucun lien universel injecté à toutes
      // les cellules avant la lecture de l'autorité métier.
      const requestId = String(++menuSerial);
      menu.setAttribute('data-hub-request', requestId);
      menu.replaceChildren();
      menu.classList.remove('is-editing','is-sourcing-inline','is-purchasing-flow');
      menu.removeAttribute('data-hub-menu-stage-state');
      menu.appendChild(make(doc, 'strong', 'kmc-hub-board-menu-title',
        order.reference + ' · ' + label));
      menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary', value));
      const stageKey = ({ PO:'po', Fournisseur:'supplier', Réception:'reception', Cartons:'cartons', Départ:'departure', 'Reste à solder':'remaining' })[label];
      const state = stageKey && order.stage_states && order.stage_states[stageKey];
      const locked = state === 'locked';
      menu.setAttribute('data-hub-menu-stage-state', state || 'unknown');
      if (stageKey === order.current_key && order.current_phase) {
        menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-current',
          '▶ Étape actuelle · ' + order.current_phase + ' — ' + (order.current_status || 'À vérifier')));
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
          doc, fetch:fetchFn, user, order, stage:label, launchSourcing,
          refresh:()=>renderGlobalBoard(root,{document:doc,fetch:fetchFn,user}),
        });
      } else {
        menu.appendChild(make(doc, 'p', 'kmc-hub-action-explanation',
          !canOperate
            ? 'Consultation seule : cette étape ne peut pas être modifiée avec ce profil.'
            : 'Les actions de cette étape ne sont pas chargées. Actualiser la page.'));
      }
      mountStageJournal(menu, {doc, fetch:fetchFn, user, order, stageKey,
        isCurrent:()=>!menu.hidden && menu.getAttribute('data-hub-request')===requestId});
      anchor.select(event?.currentTarget);
      menu.querySelector?.('a,button')?.focus?.();
    };
    anchor=anchoredMenu(menu,scroll,doc,closeMenu);
    installMenuDismiss(root, doc, menu, closeMenu, anchor.move);

    let rows = [];
    const renderRows = () => {
      body.replaceChildren();
      const term = safe(search.value).trim().toLocaleLowerCase('fr');
      const filtered = rows.filter(o => [o.reference, o.market, o.market_name]
        .some(v => safe(v).toLocaleLowerCase('fr').includes(term)));
      header.lastChild.textContent = filtered.length + ' / ' + rows.length + ' commande(s)';
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
        if (order.current_key && !['locked','complete'].includes(order.stage_states?.[order.current_key])) {
          tr.classList.add('is-hub-active-order');
        }
        if (order.current_phase) {
          const phase = make(doc, 'div', 'kmc-hub-phase-summary');
          phase.appendChild(make(doc, 'span', 'kmc-hub-phase-title',
            order.current_phase + ' · ' + (order.current_status || 'Situation à vérifier')));
          if (order.current_detail) phase.appendChild(make(doc, 'small', 'kmc-hub-phase-detail', order.current_detail));
          if (order.current_expected) phase.appendChild(make(doc, 'small', 'kmc-hub-phase-expected',
            'Attendu : ' + order.current_expected));
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
          // Une action in situ : le bouton ouvre les contrôles et le formulaire
          // de l'étape. Aucune mutation ne part du simple clic.
          const nextText = safe(order.next_action);
          const isWaitingOnly = /^(attendr|attente|suivre|consulter|aucune)/i.test(nextText);
          if (canOperate && order.current_key===key && !['locked','complete'].includes(state) && !isWaitingOnly) {
            const launch = key==='po' && order.po==='Sourcing requis';
            const command = make(doc,'button','kmc-hub-kanban-action',key==='po'
              ?'Organiser l’achat fournisseur':nextText || 'Traiter l’étape');
            command.type='button';
            command.setAttribute('data-hub-inline-action',key);
            command.setAttribute('aria-label',order.reference+' · '+(launch
              ?'Créer la ligne d’achat':'Ouvrir les actions : '+(nextText||label)));
            command.addEventListener('click',event=>{
              event.stopPropagation();
              openMenu(order,label,order[key],event,launch);
            });
            actions.appendChild(command);
          }
          td.appendChild(actions);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    };
    search.addEventListener('input', ()=>{closeMenu();renderRows();});
    try {
      const payload = await requestJSON(fetchFn, '/api/hub/board');
      if (payload.scope !== 'HUB_GLOBAL' || !Array.isArray(payload.orders)) {
        throw new Error('Réponse globale Hub invalide');
      }
      rows = payload.orders;
      renderRows();
      return payload;
    } catch (error) {
      body.replaceChildren();
      header.lastChild.textContent = 'Indisponible';
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
    installMenuDismiss(root, doc, menu, closeMenu, anchor.move);
    const openMenu = (po, field, value, event) => {
      menu.replaceChildren();
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
      menu.querySelector?.('a,button')?.focus?.();
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
    if (params.has('market') && history?.replaceState) {
      params.delete('market');
      history.replaceState(null,'',HUB_PATH + (params.toString() ? '?' + params.toString() : ''));
    }
    const requested=parseBranch(safe(location?.search));
    const branch=requested === 'administrative' && !administrativeAllowed ? 'operations' : requested;
    root.replaceChildren();
    root.className='kmc-hub-app';
    const header=make(doc,'header','kmc-hub-app-header');
    const heading=make(doc,'div','kmc-hub-app-title');
    heading.appendChild(make(doc,'span','kmc-hub-app-eyebrow','KOMERCE · HUB'));
    heading.appendChild(make(doc,'h1','','Hub · Tous les marchés'));
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
    for(const id of ['administrative','operations']){
      if(id === 'administrative' && !administrativeAllowed)continue;
      const spec=BRANCHES[id];
      const link=make(doc,'a','kmc-hub-app-branch');
      link.setAttribute('href',href(id,safe(location?.search)));
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
    // La file direction reste visible dans le poste global, quel que soit l'onglet.
    const directorLoad=administrativeAllowed && typeof fetchFn === 'function'
      ? renderDirectorQueue(content,{document:doc,fetch:fetchFn,user}) : Promise.resolve(null);
    const host=make(doc,'div','kmc-hub-app-workspace');
    host.setAttribute('data-hub-branch-workspace',branch);
    content.appendChild(host);
    layout.appendChild(content);
    root.appendChild(layout);
    const reloadCases=()=>Promise.resolve(branch === 'administrative'
      ? renderAdministrative(host) : renderOperations(host));
    const selected=reloadCases();
    selected.catch?.(()=>{});
    const selectPO=id=>{
      if(branch !== 'administrative')return;
      const cells=host.querySelectorAll?.('[data-hub-admin-po]') || [];
      const row=[...cells].find(node=>node.getAttribute('data-hub-admin-po')===id);
      if(row?.scrollIntoView)row.scrollIntoView({block:'nearest'});
    };
    const selectOrder=id=>{
      if(branch !== 'operations')return;
      const rows=host.querySelectorAll?.('[data-hub-global-order]') || [];
      const row=[...rows].find(node=>node.getAttribute('data-hub-global-order')===id);
      if(row?.scrollIntoView)row.scrollIntoView({block:'nearest'});
    };
    return Object.freeze({branch,reloadCases,selectPO,selectOrder,directorLoad});
  }

  global.KomerceCanonicalHubWorkstation = Object.freeze({
    mount, renderGlobalBoard, renderAdministrationBoard, renderDirectorQueue, parseBranch, href, BRANCHES, PO_STAGE,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
