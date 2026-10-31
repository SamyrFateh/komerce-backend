/**
 * @komerce-arch
 * @role international-journey-workspace-panel
 * @domain logistics
 * @layer browser-ui
 * @inputs authorized_market_shipments, verified_details, authenticated_role
 * @outputs transport/arrival/relay tabs and documented forms
 * @doctrine server_owns_scope, no_implicit_customs_release, no_N1_double_booking
 */
'use strict';
(function init(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.KomerceInternationalJourneyPanel=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  const TABS=[
    ['transport','Transport & fret'],
    ['arrival','Arrivée & douane'],
    ['relay','Vers les relais'],
  ];
  const STAGES=['hub_ready','handed_over','forwarder_received','in_transit','arrived',
    'customs_released','local_delivery','relay_received'];
  const STAGE_LABEL={
    hub_ready:'Prêt au Hub',handed_over:'Remis au transitaire',
    forwarder_received:'Réceptionné par le transitaire',in_transit:'Expédié / en transit',
    arrived:'Arrivé',customs_released:'Mainlevée confirmée',
    local_delivery:'Transport local',relay_received:'Réception relais attestée',
  };
  const FEES=[['handling','Manutention'],['storage','Stockage'],
    ['forwarder','Frais de dossier transitaire'],['local_tax','Taxe locale hors droits de douane'],
    ['exceptional','Frais exceptionnel'],['other','Autre frais justifié'],
    ['local_transport','Transport local vers relais']];
  function text(doc,tag,cls,content){
    const n=doc.createElement(tag);if(cls)n.className=cls;
    n.textContent=content==null?'':String(content);return n;
  }
  function put(parent,node){parent.appendChild(node);return node;}
  function money(v){return v==null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(v))+' KMF';}
  function date(v){return v?String(v).slice(0,10):'—';}
  function endpoint(ctx,tail=''){
    return '/api/admin/workspaces/shipping-customs/market/'+encodeURIComponent(ctx.marketCode)+
      '/international'+(tail?'/'+tail:'');
  }
  function actorCan(ctx,roles){return Boolean(ctx.user&&roles.includes(ctx.user.role));}
  function field(doc,name,label,type='text',required=false,options=[]){
    const wrapper=text(doc,'label','kmc-journey-field','');
    put(wrapper,text(doc,'span','kmc-journey-label',label));
    const control=doc.createElement(options.length?'select':'input');
    control.name=name;control.required=required;
    if(!options.length)control.type=type;
    else for(const [v,l] of options){
      const opt=text(doc,'option','',l);opt.value=v;control.appendChild(opt);
    }
    control.className='kmc-journey-input';
    wrapper.appendChild(control);
    return {wrapper,control};
  }
  function task(doc,ctx,host,{title,action,fields,transform,disabled=false}){
    const outer=put(host,doc.createElement('details'));
    outer.className='kmc-journey-task';
    put(outer,text(doc,'summary','kmc-journey-task-heading',title));
    const form=put(outer,doc.createElement('form'));
    form.className='kmc-journey-form';
    const controls={};
    for(const def of fields){
      const f=field(doc,def.name,def.label,def.type,def.required,def.options);
      if(def.value!=null)f.control.value=def.value;
      if(def.placeholder)f.control.placeholder=def.placeholder;
      controls[def.name]=f.control;
      form.appendChild(f.wrapper);
    }
    const footer=put(form,doc.createElement('div'));footer.className='kmc-journey-task-actions';
    const submit=put(footer,text(doc,'button','kmc-workspace-action','Enregistrer'));
    submit.type='submit';submit.disabled=disabled;
    const note=put(form,text(doc,'p','kmc-journey-feedback',''));note.setAttribute('role','status');
    form.addEventListener('submit',async ev=>{
      ev.preventDefault();
      const raw={};
      for(const [name,control] of Object.entries(controls)){
        const value=String(control.value||'').trim();
        if(value)raw[name]=value;
      }
      const payload=transform?transform(raw):raw;
      submit.disabled=true;note.textContent='Enregistrement…';
      try{
        const response=await ctx.fetch(endpoint(ctx,action),{
          method:'POST',credentials:'include',
          headers:{'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify(payload),
        });
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(body.error||'Opération refusée');
        note.textContent='Fait enregistré.';
        await ctx.reload();
      }catch(error){note.textContent=error.message||'Erreur';submit.disabled=false;}
    });
    return outer;
  }
  const proof={name:'proof_ref',label:'Référence du justificatif / preuve',required:true};
  const note={name:'notes',label:'Note facultative'};
  function nextStage(s){
    const index=STAGES.indexOf(s.stage);
    return index>=0&&index<STAGES.length-1?STAGES[index+1]:null;
  }
  function canTransition(ctx,next){
    if(!next)return false;
    if(ctx.user?.role==='admin')return true;
    if(ctx.user?.role==='agent_hub')return ['handed_over','local_delivery','relay_received'].includes(next);
    if(ctx.user?.role==='agent_transitaire')return ['forwarder_received','in_transit','arrived'].includes(next);
    return false;
  }
  function render(doc,root,ctx,rows=[],detail=null,error=null){
    const section=put(root,doc.createElement('section'));
    section.className='kmc-journey-panel';
    section.setAttribute('data-international-journey','');
    put(section,text(doc,'h2','kmc-journey-title','Expéditions internationales · chaîne réelle'));
    put(section,text(doc,'p','kmc-journey-intro',
      'Hub → transitaire → fret → arrivée → douane → transport local → relais. Chaque étape nécessite une preuve.'));
    if(error){
      put(section,text(doc,'p','kmc-journey-error','Suivi international indisponible : '+String(error)));
      return section;
    }
    if(!TABS.some(t=>t[0]===ctx.journeyTab))ctx.journeyTab='transport';
    const tabs=put(section,doc.createElement('div'));tabs.className='kmc-journey-tabs';
    for(const [key,label] of TABS){
      const b=put(tabs,text(doc,'button','kmc-journey-tab'+(ctx.journeyTab===key?' is-active':''),label));
      b.type='button';b.setAttribute('aria-pressed',String(ctx.journeyTab===key));
      b.addEventListener('click',()=>{ctx.journeyTab=key;ctx.reload();});
    }
    const list=put(section,doc.createElement('div'));list.className='kmc-journey-table-wrap';
    if(!rows.length)put(list,text(doc,'p','kmc-workspace-empty','Aucune expédition internationale enregistrée pour ce marché.'));
    else{
      const table=put(list,doc.createElement('table'));table.className='kmc-workspace-table';
      const thead=put(table,doc.createElement('thead'));const tr=put(thead,doc.createElement('tr'));
      for(const h of ['Référence','Étape','Transitaire','Colis','Volume facturé','Fret réel','ETA','Dossier'])
        put(tr,text(doc,'th','',h));
      const tbody=put(table,doc.createElement('tbody'));
      for(const s of rows){
        const line=put(tbody,doc.createElement('tr'));
        for(const v of [s.reference,STAGE_LABEL[s.stage]||s.stage,s.forwarder_name,
          s.parcel_count,s.volume_m3==null?'—':s.volume_m3+' m³',money(s.freight_invoice_kmf),date(s.estimated_arrival_at)])
          put(line,text(doc,'td','',v));
        const cell=put(line,doc.createElement('td'));
        const button=put(cell,text(doc,'button','kmc-entity-360-action',ctx.journeyRef===s.reference?'Ouvert':'Consulter'));
        button.type='button';
        button.addEventListener('click',()=>{ctx.journeyRef=s.reference;ctx.reload();});
      }
    }
    if(ctx.journeyTab==='transport'&&actorCan(ctx,['admin'])){
      task(doc,ctx,section,{
        title:'Nouvelle expédition · colis remis par le Hub',
        action:'',
        fields:[
          {name:'reference',label:'Référence expédition',required:true},
          {name:'forwarder_name',label:'Transitaire',required:true},
          {name:'transport_mode',label:'Transport',required:true,
            options:[['sea','Bateau'],['air','Avion']]},
          {name:'parcel_refs',label:'Références colis (séparées par virgules)',required:true},
          {name:'volume_m3',label:'Volume facturable estimé (m³)',type:'number'},
          {name:'freight_rate_kmf_per_m3',label:'Tarif fret convenu (KMF/m³)',type:'number'},
          {name:'estimated_arrival_date',label:'ETA prévisionnelle',type:'date'},proof],
        transform:raw=>({...raw,parcel_refs:String(raw.parcel_refs||'').split(',').map(x=>x.trim()).filter(Boolean)}),
      });
    }
    const s=rows.find(item=>item.reference===ctx.journeyRef);
    if(!s)return section;
    const dossier=put(section,doc.createElement('div'));dossier.className='kmc-journey-dossier';
    put(dossier,text(doc,'h3','',s.reference+' · '+(STAGE_LABEL[s.stage]||s.stage)));
    const snapshot=put(dossier,doc.createElement('div'));snapshot.className='kmc-journey-facts';
    const facts=[
      ['Transport',s.transport_mode==='sea'?'Bateau':'Avion'],
      ['Suivi',s.tracking_reference||s.bill_of_lading_ref||'Non reçu'],
      ['Conteneur',s.container_reference||'Non communiqué'],
      ['Départ constaté',date(s.departed_at)],['Arrivée estimée',date(s.estimated_arrival_at)],
      ['Facture fret',s.freight_invoice_ref||'En attente'],
      ['Fret estimé',money(s.freight_estimated_kmf)],
      ['Fret réel',money(s.freight_invoice_kmf)],
      ['Frais annexes',money(s.supplementary_costs_kmf)],
      ['Dossier douane',s.customs_reference||'Non lié'],
    ];
    for(const [name,value] of facts){
      const item=put(snapshot,doc.createElement('div'));
      put(item,text(doc,'span','kmc-journey-label',name));
      put(item,text(doc,'strong','',value));
    }
    const alert=put(dossier,text(doc,'p','kmc-journey-cost-alert',
      'Coûts enregistrés comme faits documentaires. Non encore rapprochés du N1 : aucune double imputation automatique.'));
    alert.setAttribute('role','note');
    const ref=encodeURIComponent(s.reference);
    const step=nextStage(s);
    if(canTransition(ctx,step)&&(
       ctx.journeyTab==='transport'&&['handed_over','forwarder_received','in_transit','arrived'].includes(step)||
       ctx.journeyTab==='arrival'&&step==='customs_released'||
       ctx.journeyTab==='relay'&&['local_delivery','relay_received'].includes(step))){
      task(doc,ctx,dossier,{
        title:'Confirmer : '+STAGE_LABEL[step],
        action:ref+'/transition',fields:[proof,note],
        transform:raw=>({...raw,to_stage:step}),
      });
    }
    if(ctx.journeyTab==='transport'){
      if(actorCan(ctx,['admin','agent_transitaire']))task(doc,ctx,dossier,{
        title:'Suivi conteneur / connaissement et ETA',
        action:ref+'/tracking',fields:[
          {name:'tracking_reference',label:'Référence de suivi',value:s.tracking_reference},
          {name:'container_reference',label:'Conteneur (si connu)',value:s.container_reference},
          {name:'bill_of_lading_ref',label:'Connaissement / BL',value:s.bill_of_lading_ref},
          {name:'estimated_arrival_date',label:'Nouvelle ETA',type:'date',value:date(s.estimated_arrival_at)==='—'?'':date(s.estimated_arrival_at)},
          proof,
        ],
      });
      if(actorCan(ctx,['admin'])&&s.freight_invoice_kmf==null)task(doc,ctx,dossier,{
        title:'Enregistrer la facture réelle du fret (sans double imputation)',
        action:ref+'/freight',fields:[
          {name:'amount_kmf',label:'Montant facture (KMF)',type:'number',required:true},
          {name:'invoice_ref',label:'Référence facture',required:true},
          {name:'volume_m3',label:'Volume facturé (m³)',type:'number',value:s.volume_m3},
          {name:'rate_kmf_per_m3',label:'Tarif réel (KMF/m³)',type:'number',value:s.freight_rate_kmf_per_m3},
        ],
      });
    }
    if(ctx.journeyTab==='arrival'&&actorCan(ctx,['admin'])){
      if(!s.customs_reference)task(doc,ctx,dossier,{
        title:'Lier le dossier douane existant',action:ref+'/link-customs',
        fields:[{name:'customs_reference',label:'Référence douane',required:true},proof],
      });
      if(STAGES.indexOf(s.stage)>=STAGES.indexOf('arrived'))
        task(doc,ctx,dossier,{
          title:'Constater un frais à l’arrivée (justificatif obligatoire)',
          action:ref+'/costs',
          fields:[{name:'fee_type',label:'Nature',options:FEES.filter(x=>x[0]!=='local_transport')},
            {name:'amount_kmf',label:'Montant réel (KMF)',type:'number',required:true},
            {name:'idempotency_key',label:'Clé unique de la facture',required:true},proof,note],
        });
    }
    if(ctx.journeyTab==='relay'){
      put(dossier,text(doc,'p','kmc-workspace-note',
        'Transport local seulement après mainlevée. La réception relais physique continue d’être contrôlée dans Hub & Relais.'));
      if(actorCan(ctx,['admin'])&&STAGES.indexOf(s.stage)>=STAGES.indexOf('customs_released'))
        task(doc,ctx,dossier,{
          title:'Coût du transport local jusqu’au relais',action:ref+'/costs',
          fields:[{name:'fee_type',label:'Type',options:[['local_transport','Transport local']]},
            {name:'amount_kmf',label:'Montant réel (KMF)',type:'number',required:true},
            {name:'idempotency_key',label:'Clé unique facture',required:true},proof,note],
        });
    }
    if(detail){
      const extra=put(dossier,doc.createElement('details'));extra.className='kmc-journey-task';
      put(extra,text(doc,'summary','','Preuves et historique · '+(detail.events?.length||0)+' événement(s)'));
      for(const e of detail.events||[])
        put(extra,text(doc,'p','kmc-journey-history',date(e.occurred_at)+' · '+e.event_type+' · '+e.proof_ref));
      for(const c of detail.charges||[])
        put(extra,text(doc,'p','kmc-journey-history',c.fee_type+' · '+money(c.amount_kmf)+' · '+c.proof_ref));
    }
    return section;
  }
  return Object.freeze({render,STAGES,STAGE_LABEL,TABS,nextStage,endpoint});
});
