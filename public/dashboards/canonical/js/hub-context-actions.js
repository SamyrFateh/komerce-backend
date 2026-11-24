/* Hub Live — Kanban de navigation et actions administratives distinctes.
 * Les liens du Kanban ne soumettent aucune mutation métier. */
(function initHubContextActions(global) {
  'use strict';
  const writableRoles = ['admin','agent_hub'];
  const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
  const text = value => String(value == null ? '' : value);
  const node = (doc, tag, css, value) => {
    const item = doc.createElement(tag);
    if (css) item.className = css;
    if (value != null) item.textContent = text(value);
    return item;
  };
  async function request(fetchFn, url, payload) {
    const options = {
      credentials:'include',method:payload == null ? 'GET' : 'POST',
      headers:{Accept:'application/json',...(payload == null ? {} : {'Content-Type':'application/json'})},
      ...(payload == null ? {} : {body:JSON.stringify(payload)}),
    };
    const res = await fetchFn(url, options);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(out.error || out.message || 'Opération refusée par le serveur');
      err.code = out.code || '';
      err.status = res.status;
      throw err;
    }
    return out;
  }

  // Le panneau est la confirmation de l'action : pas d'écriture sans validation.
  function form(menu, doc, title, fields, submit, refresh) {
    menu.replaceChildren();
    menu.scrollTop = 0;
    menu.classList.add('is-editing');
    menu.appendChild(node(doc,'strong','kmc-hub-board-menu-title',title));
    const panel = node(doc,'form','kmc-hub-action-form');
    const entries = {};
    const values = {};
    for (const field of fields) {
      const label = node(doc,'label','kmc-hub-action-field');
      label.appendChild(node(doc,'span','',field.label));
      const input = node(doc,field.choices ? 'select' : 'input','kmc-hub-action-input');
      input.name=field.name;
      input.required=!!field.required;
      if(field.type && !field.choices)input.type=field.type;
      if(field.placeholder)input.placeholder=field.placeholder;
      if(field.min != null)input.min=field.min;
      if(field.max != null)input.max=field.max;
      if(field.step != null)input.step=field.step;
      if(field.value != null)input.value=String(field.value);
      for(const opt of field.choices || []){
        const option=node(doc,'option','',opt.label);
        option.value=opt.value;
        input.appendChild(option);
      }
      entries[field.name]=input;
      label.appendChild(input);
      panel.appendChild(label);
    }
    const feedback=node(doc,'p','kmc-hub-action-feedback');
    feedback.setAttribute('aria-live','polite');
    panel.appendChild(feedback);
    const buttons=node(doc,'div','kmc-hub-action-buttons');
    const confirm=node(doc,'button','kmc-hub-action-confirm','Confirmer l’opération');
    confirm.type='submit';
    const cancel=node(doc,'button','kmc-hub-action-cancel','Annuler');
    cancel.type='button';
    cancel.addEventListener('click',()=>{
      menu.classList.remove('is-editing');
      menu.hidden=true;
    });
    buttons.appendChild(confirm);
    buttons.appendChild(cancel);
    panel.appendChild(buttons);
    panel.addEventListener('submit',async event=>{
      event.preventDefault();
      for(const [key,input] of Object.entries(entries))values[key]=input.value;
      confirm.disabled=true;
      feedback.textContent='Enregistrement en cours…';
      try {
        await submit(values);
        menu.hidden=true;
        menu.classList.remove('is-editing');
        await refresh?.();
      }catch(err){
        feedback.classList.add('is-error');
        feedback.textContent=err.message || 'Validation refusée';
        confirm.disabled=false;
      }
    });
    menu.appendChild(panel);
    menu.dispatchEvent(new doc.defaultView.Event('hub:menu-state'));
    entries[fields[0]?.name]?.focus?.({preventScroll:true});
  }

  function action(menu,doc,title,description,handler) {
    const button=node(doc,'button','kmc-hub-board-menu-action is-primary',title);
    button.type='button';
    button.setAttribute('data-hub-real-action',title);
    if(description)button.title=description;
    button.addEventListener('click',handler);
    menu.appendChild(button);
    return button;
  }
  function explanation(menu,doc,message) {
    const line=node(doc,'p','kmc-hub-action-explanation',message);
    menu.appendChild(line);
  }
  // Un lien de navigation n'est jamais une transition métier ni une validation.
  function workflowLink(menu,doc,label,url) {
    const link=node(doc,'a','kmc-hub-board-menu-action is-primary',label);
    link.href=url;
    link.setAttribute('data-hub-workflow-link','');
    menu.appendChild(link);
  }
  // Le dossier PO canonique est l’unique surface d’exécution des achats.
  function poLink(menu,doc,po,label,entry='operations'){
    if(!validUuid(po.id)||!(/^[A-Z]{2}$/.test(po.market||''))) {
      explanation(menu,doc,'Marché ou PO non identifié : accès au dossier indisponible.');
      return false;
    }
    workflowLink(menu,doc,label,'/admin/hub-live?'+new URLSearchParams({
      view:'execute',entry,market:po.market,atelier:'purchasing',sel:'po:'+po.id
    }).toString());
    return true;
  }
  // Kanban : lecture et liens uniquement. Aucun formulaire ni POST métier.
  // Le dossier serveur fournit les PO/COMBOX ; le marché et les identifiants
  // restent des paramètres de navigation, jamais une autorité de mutation.
  async function operations(menu,{doc,fetch:fetchFn,user,order,stage}) {
    if(!writableRoles.includes(user?.role))return false;
    const key=({PO:'po',Fournisseur:'supplier',Réception:'reception',Cartons:'cartons',Départ:'departure','Reste à solder':'remaining'})[stage];
    if(!key||['locked','complete'].includes(order.stage_states?.[key]))return false;
    const serial=menu.getAttribute('data-hub-request')||'';
    const isCurrent=()=>!menu.hidden && (menu.getAttribute('data-hub-request')||'')===serial;
    const busy=node(doc,'p','kmc-hub-action-loading','Lecture du dossier opérationnel…');
    menu.appendChild(busy);
    const url=(atelier,type,id)=>'/admin/hub-live?'+new URLSearchParams({
      view:'execute',entry:'operations',market:order.market,atelier,sel:type+':'+id
    }).toString();
    let links=0;
    const link=(label,atelier,type,id)=>{
      workflowLink(menu,doc,label,url(atelier,type,id));links++;
    };
    try {
      const data=await request(fetchFn,'/api/hub/dossier?market='+encodeURIComponent(order.market));
      if(!isCurrent())return false;
      const pos=(data.purchase_orders||[]).filter(po=>(po.lines||[]).some(l=>l.order_id===order.id));
      const needs=(data.needs||[]).filter(n=>n.order_id===order.id);
      const boxes=(data.boxes||[]).filter(box=>(box.contents||[]).some(c=>c.order_id===order.id));
      const received=pos.reduce((total,po)=>total+(po.lines||[]).filter(l=>l.order_id===order.id).reduce((n,l)=>n+(Number(l.received)||0),0),0);
      const poLinks=(label,atelier,rows)=>rows.forEach(po=>link(label+' · PO '+String(po.ref||po.id).slice(0,18),atelier,'po',po.id));
      if(stage==='PO'){
        link('Ouvrir le dossier d’achat','purchasing','order',order.id);
      }else if(stage==='Fournisseur'){
        poLinks('Ouvrir le suivi fournisseur','purchasing',pos);
      }else if(stage==='Réception'){
        poLinks('Ouvrir l’atelier Réception','reception',pos);
      }else if(stage==='Cartons' && received>0){
        link('Ouvrir la préparation COMBOX','boxes','order',order.id);
      }else if(stage==='Départ'){
        boxes.filter(b=>!b.shipment_ref).forEach(b=>link('Ouvrir le départ · '+b.reference,'shipments','box',b.unit_id));
        if(boxes.some(b=>b.shipment_ref)){
          workflowLink(menu,doc,'Consulter le transport · Expéditions & Douane',
            '/admin/workspaces/shipping-customs?'+new URLSearchParams({market:order.market}).toString());links++;
        }
      }else if(stage==='Reste à solder'){
        if(order.current_phase==='Remise client'){
          workflowLink(menu,doc,'Consulter le suivi des remises','/admin/relais-live?'+new URLSearchParams({market:order.market}).toString());links++;
        }else{
          if(needs.length||!pos.length)link('Ouvrir les achats restants','purchasing','order',order.id);
          poLinks('Ouvrir les réceptions restantes','reception',pos);
          explanation(menu,doc,'Une clôture ou un remboursement nécessite une décision métier traçable ; aucune validation depuis le Kanban.');
        }
      }
      busy.remove();
      if(!links)explanation(menu,doc,'Aucun atelier exécutable pour cette étape actuellement. Consulter les preuves et les quantités attendues.');
      return links>0;
    }catch(error){
      if(!isCurrent())return false;
      busy.remove();
      explanation(menu,doc,'Impossible de vérifier le dossier : '+error.message);
      return false;
    }
  }
  const decisionLine = (label,d) => label+' par '+(d.decided_by_name||'la directrice')+' le '+
    String(d.decided_at||'').slice(0,10)+' · '+d.amount+' '+d.currency+' · pièce '+d.proof_ref+'.';
  // Les deux décisions de la directrice sont indépendantes ; le serveur exige le droit actif et refuse sinon.
  function commitment(menu,doc,po,grants,fetchFn,refresh) {
    if(po.commitment_decision){
      explanation(menu,doc,decisionLine('Engagement d’achat validé',po.commitment_decision));
      if(validUuid(po.id)&&po.status==='draft') poLink(menu,doc,po,'Ouvrir la PO pour la soumettre');
      return true;
    }
    if(!validUuid(po.id)||po.status!=='draft'){
      explanation(menu,doc,'L’engagement se valide sur une PO en brouillon.');
      return false;
    }
    if(!grants.purchase_commitment){
      explanation(menu,doc,'Engagement d’achat à valider par la directrice. Votre compte ne détient pas cette autorisation (attribuée par l’Admin central) ; une PO préparée n’est pas un engagement.');
      return false;
    }
    poLink(menu,doc,po,'Ouvrir la PO · décision d’engagement','direction');
    return true;
  }
  function paymentAuthorization(menu,doc,po,grants,fetchFn,refresh) {
    if(po.payment_decision){
      explanation(menu,doc,decisionLine('Paiement fournisseur autorisé',po.payment_decision));
      return true;
    }
    if(!po.commitment_decision){
      explanation(menu,doc,'Le paiement ne peut être autorisé qu’après la validation de l’engagement d’achat.');
      return false;
    }
    if(!validUuid(po.id)||!['notified','confirmed'].includes(po.status)){
      explanation(menu,doc,'Le paiement s’autorise après la soumission de la PO. La soumission n’autorise rien par elle-même.');
      return false;
    }
    if(!grants.supplier_payment){
      explanation(menu,doc,'Paiement fournisseur à autoriser par la directrice. Votre compte ne détient pas cette autorisation (attribuée par l’Admin central).');
      return false;
    }
    poLink(menu,doc,po,'Ouvrir la PO · autorisation de paiement','direction');
    return true;
  }
  function varianceDecision(menu, doc, po, grants, fetchFn, refresh) {
    const variance = po.variance_decision;
    if (variance) {
      explanation(menu, doc, `Écart décidé · ${variance.amount} ${variance.currency} · ${variance.reason} · Pièce ${variance.proof_ref}`);
      return;
    }
    const authorization = po.payment_decision;
    if (!validUuid(po.id) || !grants.supplier_payment || !authorization?.currency || !['notified', 'confirmed', 'hub_received'].includes(po.status)) return;
    action(menu, doc, 'Décider un écart fournisseur', 'Plafond exceptionnel motivé dans la devise autorisée.', () => form(
      menu, doc, 'Décision d’écart fournisseur', [
        { name: 'approved_total', label: 'Total approuvé (' + authorization.currency + ')', type: 'number', min: '0.0001', max: authorization.amount, step: '0.0001', required: true },
        { name: 'reason', label: 'Motif précis de l’écart', required: true },
        { name: 'proof_ref', label: 'Référence du justificatif', required: true },
      ], values => request(fetchFn, '/api/purchasing/po/' + encodeURIComponent(po.id) + '/variance-decision', {
        approved_total: values.approved_total, currency: authorization.currency,
        reason: values.reason.trim(), proof_ref: values.proof_ref.trim(),
      }), refresh));
  }

  function administration(menu,{doc,fetch:fetchFn,user,po,field,refresh,grants = {}}) {
    if(!writableRoles.includes(user?.role))return false;
    if(field==='Fournisseur'){
      if(po.status==='notified'&&!po.sent_at) return poLink(menu,doc,po,'Ouvrir la PO · attester l’envoi fournisseur');
      explanation(menu,doc,po.sent_at?
        'Envoi déjà attesté : aucune seconde déclaration autorisée. La confirmation fournisseur ligne par ligne se saisit dans Achats fournisseurs.':
        'La PO doit être soumise (après validation de l’engagement) avant qu’un envoi réel puisse être enregistré.');
      if(po.sent_at&&po.status==='notified'){
        poLink(menu,doc,po,'Ouvrir la PO · confirmer les lignes fournisseur');
      }
    }else if(field==='Engagement'){
      commitment(menu,doc,po,grants,fetchFn,refresh);
    }else if(field==='Autorisation'){
      paymentAuthorization(menu,doc,po,grants,fetchFn,refresh);
    }else if(field==='Paiement'||field==='Justificatifs'){
      explanation(menu,doc,
        (po.payment_evidence||'Aucune preuve de débit')+
        ' · Une preuve de débit ne remplace pas l’autorisation de paiement.');
      if (field === 'Paiement') varianceDecision(menu, doc, po, grants, fetchFn, refresh);
    }else if(field==='Réception'){
      explanation(menu,doc,
        'Réception : utiliser le contrôle physique et le manifeste fournisseur dans Opérations. Le statut fournisseur ne suffit pas.');
    }else{
      explanation(menu,doc,'Aucune écriture possible à cette étape.');
    }
    return false;
  }
  global.KomerceHubContextActions=Object.freeze({operations,administration,request});
})(typeof globalThis !== 'undefined' ? globalThis : this);