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
  async function prepare(menu,doc,order,fetchFn,refresh) {
    const data=await request(fetchFn,'/api/purchasing/open-lines');
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

  async function receive(menu,doc,poIds,fetchFn,refresh) {
    const data=await request(fetchFn,'/api/scans/hub/receivable');
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
    const marker=order.id+'|'+stage;
    menu.setAttribute('data-hub-action-key',marker);
    const busy=node(doc,'p','kmc-hub-action-loading','Vérification des actions disponibles…');
    menu.appendChild(busy);
    try {
      const market=encodeURIComponent(order.market);
      const data=await request(fetchFn,'/api/hub/dossier?market='+market);
      if(menu.hidden||menu.getAttribute('data-hub-action-key')!==marker)return false;
      busy.remove();
      const pos=(data.purchase_orders||[]).filter(po=>(po.lines||[]).some(l=>l.order_id===order.id));
      const poIds=pos.map(po=>po.id);
      const boxes=(data.boxes||[]).filter(b=>(b.contents||[]).some(c=>c.order_id===order.id));
      let actions=0;
      if(stage==='PO'||stage==='Reste à solder'){
        if((data.needs||[]).some(n=>n.order_id===order.id)){
          if(await prepare(menu,doc,order,fetchFn,refresh))actions++;
        }
      }
      if(stage==='Fournisseur'){
        for(const po of pos)if(sent(menu,doc,po,fetchFn,refresh))actions++;
      }
      if(stage==='Réception'||stage==='Reste à solder'){
        if(poIds.length&&await receive(menu,doc,poIds,fetchFn,refresh))actions++;
      }
      if(stage==='Cartons'||stage==='Départ'){
        if(ship(menu,doc,boxes,data.open_shipments,fetchFn,refresh))actions++;
      }
      if(menu.hidden||menu.getAttribute('data-hub-action-key')!==marker)return false;
      if(!actions)explanation(menu,doc,
        'Aucune transition directe autorisée ici : vérifier les dépendances et les preuves dans le dossier.');
      return actions>0;
    }catch(error){
      busy.remove();
      explanation(menu,doc,'Actions indisponibles : '+error.message);
      return false;
    }
  }
  function administration(menu,{doc,fetch:fetchFn,user,po,field,refresh}) {
    if(!writableRoles.includes(user?.role))return false;
    if(field==='Fournisseur'&&sent(menu,doc,po,fetchFn,refresh))return true;
    if(['Engagement','Autorisation'].includes(field))
      explanation(menu,doc,'Autorisation de la directrice non tracée : aucune approbation implicite possible.');
    else if(field==='Paiement'||field==='Justificatifs')
      explanation(menu,doc,'La preuve de débit ne vaut pas autorisation du paiement fournisseur.');
    else
      explanation(menu,doc,'Aucune mutation autorisée pour cette étape. Ouvrir la PO pour examiner ses preuves.');
    return false;
  }
  global.KomerceHubContextActions=Object.freeze({operations,administration,request});
})(typeof globalThis !== 'undefined' ? globalThis : this);