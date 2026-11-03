/* Hub Live — actions métier réelles depuis le tableau, sans état parallèle.
 * Les menus lisent les données canoniques et soumettent aux writers existants.
 * Aucun changement de statut n'est déclenché par l'ouverture d'un menu. */
(function initHubContextActions(global) {
  'use strict';
  const writableRoles = ['admin','agent_hub'];
  const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
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
    entries[fields[0]?.name]?.focus?.();
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
  function sent(menu, doc, po, fetchFn, refresh) {
    if(!validUuid(po.id)||po.status !== 'notified'||po.sent_at)return false;
    action(menu,doc,'Attester l’envoi fournisseur','La PO doit avoir été réellement transmise.',()=>form(
      menu,doc,'PO '+po.id.slice(0,8)+' · Preuve d’envoi',[
        {name:'channel',label:'Canal utilisé',required:true,choices:[
          {label:'WhatsApp',value:'whatsapp'},{label:'E-mail',value:'email'},
          {label:'Téléphone',value:'phone'},{label:'API fournisseur',value:'api'},
          {label:'Autre',value:'other'}]},
        {name:'supplier_order_id',label:'Référence fournisseur (facultative)'},
        {name:'note',label:'Justificatif / note de transmission'},
      ], values=>request(fetchFn,'/api/purchasing/po/'+encodeURIComponent(po.id)+'/sent',values),refresh
    ));
    return true;
  }
  async function prepare(menu,doc,order,fetchFn,refresh,isCurrent = () => true) {
    const data=await request(fetchFn,'/api/purchasing/open-lines');
    if(!isCurrent())return false;
    const candidates=(data.groups||[]).flatMap(group=>{
      const lines=(group.lines||[]).filter(l=>l.order_id===order.id && l.groupable && validUuid(l.line_id));
      if(!lines.length||!validUuid(group.supplier_id)||!group.procurement_hub_ref)return [];
      return [{...group,lines}];
    });
    for(const group of candidates){
      const lineIds=group.lines.map(l=>l.line_id);
      action(menu,doc,'Préparer PO · '+group.supplier_name+' ('+lineIds.length+' ligne(s))',
        'Créer un brouillon d’achat, sans validation d’engagement ni transmission.',()=>{
          form(menu,doc,'Préparer une PO fournisseur',[
            {name:'supplier',label:'Fournisseur',value:group.supplier_name,required:true},
            {name:'hub',label:'Hub d’approvisionnement',value:group.procurement_hub_ref,required:true},
            {name:'mode',label:'Mode d’exécution',choices:[{label:'Manuel',value:'manual'}]},
          ],async values=>{
            if(values.supplier!==group.supplier_name||values.hub!==group.procurement_hub_ref)
              throw new Error('Pour changer le fournisseur ou le Hub, modifier les lignes dans Achats fournisseurs.');
            return request(fetchFn,'/api/purchasing/po/prepare',{
              supplier_id:group.supplier_id,procurement_hub_ref:group.procurement_hub_ref,
              line_ids:lineIds,execution_mode:'manual',
            });
          },refresh);
        });
    }
    return candidates.length>0;
  }

  async function receive(menu,doc,poIds,fetchFn,refresh,isCurrent = () => true) {
    const data=await request(fetchFn,'/api/scans/hub/receivable');
    if(!isCurrent())return false;
    let count=0;
    for(const po of (data.purchase_orders || []).filter(p=>poIds.includes(p.purchase_order_id))){
      const available=(po.lines||[]).filter(l=>validUuid(l.product_sku_id)&&l.remaining_quantity>0);
      if(!available.length)continue;
      action(menu,doc,'Réceptionner un colis · PO '+po.purchase_order_id.slice(0,8),
        'Saisir les quantités réellement comptées, puis confirmer la réception physique.',()=>{
          const fields=[
            {name:'reference',label:'Référence physique du colis',placeholder:'Code-barres ou référence interne',required:true},
            {name:'external_ref',label:'Suivi transporteur (facultatif)'},
            ...available.map((line,i)=>({
              name:'quantity_'+i,
              label:line.product_name+' · restant '+line.remaining_quantity,
              type:'number',min:0,max:line.remaining_quantity,step:1,value:0,required:true,
            })),
          ];
          form(menu,doc,'Réception physique fournisseur',fields,async values=>{
            const contents=available.map((line,i)=>({
              purchase_order_id:po.purchase_order_id,
              product_sku_id:line.product_sku_id,
              quantity:Number(values['quantity_'+i]),
            })).filter(item=>item.quantity>0);
            if(!contents.length)throw new Error('Renseigner au moins une quantité réellement reçue.');
            if(contents.some((item)=>!Number.isInteger(item.quantity)))throw new Error('Les quantités doivent être entières.');
            return request(fetchFn,'/api/scans/hub/receive',{
              reference:values.reference.trim(),external_ref:values.external_ref.trim()||undefined,contents,
            });
          },refresh);
        });
      count++;
    }
    return count>0;
  }
  function ship(menu,doc,boxes,shipments,fetchFn,refresh) {
    const ready=(boxes||[]).filter(b=>b.state==='DISPATCHED'&&!b.shipment_ref&&validUuid(b.unit_id));
    if(!ready.length||!(shipments||[]).length)return false;
    for(const box of ready){
      action(menu,doc,'Affecter '+box.reference+' à un départ',
        'Rattacher une KOM-BOX réellement prête à une expédition ouverte du même marché.',()=>{
          form(menu,doc,'Affecter une KOM-BOX à une expédition',[
            {name:'shipment_reference',label:'Expédition ouverte',required:true,
              choices:shipments.map(s=>({label:s.reference+' · '+(s.forwarder_name||'Transitaire à confirmer'),value:s.reference}))},
          ],values=>request(fetchFn,'/api/hub/box/'+encodeURIComponent(box.unit_id)+'/shipment',{
            shipment_reference:values.shipment_reference,
          }),refresh);
        });
    }
    return true;
  }
  async function operations(menu,{doc,fetch:fetchFn,user,order,stage,refresh}) {
    if(!writableRoles.includes(user?.role))return false;
    // Une ouverture d'une autre cellule annule les requêtes de l'ancien menu.
    const serial=menu.getAttribute('data-hub-request')||'';
    const marker=serial+'|'+order.id+'|'+stage;
    menu.setAttribute('data-hub-action-key',marker);
    const isCurrent=()=>!menu.hidden &&
      menu.getAttribute('data-hub-request')===serial &&
      menu.getAttribute('data-hub-action-key')===marker;
    const busy=node(doc,'p','kmc-hub-action-loading',
      'Lecture des actions possibles pour « '+stage+' »…');
    menu.appendChild(busy);
    try {
      const data=await request(fetchFn,'/api/hub/dossier?market='+encodeURIComponent(order.market));
      if(!isCurrent())return false;
      const pos=(data.purchase_orders||[]).filter(po=>(po.lines||[]).some(l=>l.order_id===order.id));
      const poIds=pos.map(po=>po.id);
      const needs=(data.needs||[]).filter(n=>n.order_id===order.id);
      const boxes=(data.boxes||[]).filter(box=>(box.contents||[]).some(c=>c.order_id===order.id));
      const received=pos.reduce((total,po)=>total+(po.lines||[])
        .filter(l=>l.order_id===order.id).reduce((s,l)=>s+(Number(l.received)||0),0),0);
      let count=0;
      let unavailable='';
      if(stage==='PO'){
        if(needs.length){
          count+=Number(await prepare(menu,doc,order,fetchFn,refresh,isCurrent));
          unavailable='Les lignes d’achat ouvertes ne sont pas encore groupables : renseigner le fournisseur, le Hub et les références d’achat.';
        }else if(!pos.length){
          unavailable='Aucune ligne d’achat préparée pour cette commande. Il faut d’abord rattacher les articles au fournisseur avant de constituer la PO.';
        }else if(pos.some(p=>p.stage==='draft')){
          unavailable='PO brouillon existante : compléter les lignes et faire valider l’engagement avant de soumettre le bon.';
        }else{
          unavailable='PO déjà constituée : voir l’étape Fournisseur pour la preuve de transmission.';
        }
      }else if(stage==='Fournisseur'){
        for(const po of pos)if(sent(menu,doc,po,fetchFn,refresh))count++;
        unavailable=!pos.length?'Aucune PO fournisseur : constituer d’abord la PO.':
          pos.some(p=>p.stage==='draft')?'PO encore brouillon : l’envoi ne peut pas être attesté avant soumission.':
          pos.every(p=>p.sent_at)?'Transmission déjà enregistrée pour les PO de cette commande.':
          'Aucun envoi attestable : vérifier le statut de la PO et son engagement.';
      }else if(stage==='Réception'){
        if(poIds.length)count+=Number(await receive(menu,doc,poIds,fetchFn,refresh,isCurrent));
        unavailable=!poIds.length?'Aucune PO associée : la réception exige une commande fournisseur.':
          'Aucune quantité recevable actuellement : vérifier la PO et les quantités physiques restant à réceptionner.';
      }else if(stage==='Cartons'){
        // Une KOM-BOX vide ne prouve pas l'emballage. Ne pas proposer de création
        // trompeuse avant l'allocation physique et le contrôle du contenu.
        unavailable=received<=0?'Rien de réceptionné : préparer le carton seulement après le contrôle physique.':
          boxes.length?'Carton(s) présent(s) : contrôler le contenu et la preuve d’emballage avant la mise au départ.':
          'Articles réceptionnés : constituer et contrôler leur carton physique depuis les allocations réelles du Hub.';
      }else if(stage==='Départ'){
        count+=Number(ship(menu,doc,boxes,data.open_shipments,fetchFn,refresh));
        const ready=boxes.filter(box=>box.state==='DISPATCHED'&&!box.shipment_ref);
        unavailable=!boxes.length?'Aucun carton constitué : la préparation physique doit précéder le départ.':
          !ready.length?'Aucun carton prêt à rattacher : confirmer l’emballage et le scellage dans le Hub.':
          'Aucune expédition ouverte pour ce marché : créer le départ avant de rattacher le carton.';
      }else if(stage==='Reste à solder'){
        if(needs.length)count+=Number(await prepare(menu,doc,order,fetchFn,refresh,isCurrent));
        if(isCurrent()&&poIds.length)count+=Number(await receive(menu,doc,poIds,fetchFn,refresh,isCurrent));
        unavailable=needs.length?'Des articles restent à acheter : la préparation de PO nécessite des lignes fournisseur groupables.':
          poIds.length?'Le reliquat ne possède aucune réception admissible pour le moment.':
          'Aucun reliquat engagé en achat. Remboursement et clôture restent soumis à une décision métier traçable.';
      }else{
        unavailable='Étape inconnue : aucune action disponible.';
      }
      if(!isCurrent())return false;
      busy.remove();
      if(!count)explanation(menu,doc,unavailable);
      return count>0;
    }catch(error){
      if(!isCurrent())return false;
      busy.remove();
      explanation(menu,doc,
        'Impossible de vérifier les actions de « '+stage+' » : '+error.message);
      return false;
    }
  }
  function administration(menu,{doc,fetch:fetchFn,user,po,field,refresh}) {
    if(!writableRoles.includes(user?.role))return false;
    if(field==='Fournisseur'){
      if(sent(menu,doc,po,fetchFn,refresh))return true;
      explanation(menu,doc,po.sent_at?
        'Envoi déjà attesté : aucune seconde déclaration autorisée.':
        'La PO doit être soumise avant qu’un envoi réel puisse être enregistré.');
    }else if(field==='Engagement'){
      explanation(menu,doc,
        'Engagement d’achat : décision de la directrice non enregistrée dans le modèle actuel. Ne pas assimiler une PO soumise à une autorisation.');
    }else if(field==='Autorisation'){
      explanation(menu,doc,
        'Paiement fournisseur : autorisation indépendante de la directrice non enregistrée. Aucune validation fictive ne sera créée.');
    }else if(field==='Paiement'||field==='Justificatifs'){
      explanation(menu,doc,
        (po.payment_evidence||'Aucune preuve de débit')+
        ' · Une preuve de débit ne remplace pas l’autorisation de paiement.');
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