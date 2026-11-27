/**
 * @komerce-arch
 * @role          canonical-pricing-economic-cockpit-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        pricing_workspace_projection, server_market_corridor_projection, server_market_decision_projection
 * @outputs       economic_cockpit_dom, explicit_market_price_decision_requests
 * @depends       public/dashboards/canonical/js/pricing-workspace.js, public/dashboards/canonical/js/pricing-equilibrium-panel.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      mock_is_ui_contract, variable_or_fixed_is_nature_direct_or_mutualized_is_perimeter, mutualized_quote_part_is_market_scoped, calculated_values_are_read_only, final_market_price_is_primary_product_lever, browser_never_recomputes_economic_truth
 * @impact-areas  admin-dashboard, pricing, economic-engine, market-autonomy
 * @version       2026-09
 */

'use strict';

(function initPricingEconomicCockpit(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingEconomicCockpit = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingEconomicCockpit() {
  const COCKPIT_ATTR = 'pricingEconomicCockpit';
  const MAX_CATEGORY_ROWS = 8;

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  // V7 consultation reads the persistent server model; no business math.
  function v7Money(value, currency = 'EUR') {
    if (typeof value !== 'string' || !(/^-?\d+(?:\.\d+)?$/).test(value)) return 'Non disponible';
    const [integer, fraction=''] = value.split('.');
    const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,'\u202f');
    const decimals=currency==='EUR'?fraction.slice(0,2).padEnd(2,'0'):fraction.replace(/0+$/,'');
    return grouped+(decimals?','+decimals:'')+' '+currency;
  }

  function canCost(model,action){return model?.central===true||model?.costCapabilities?.[action]===true;}

  function createV7CostCenters(doc, model, actions={}) {
    const host=el(doc,'section','kmc-v7-centers');
    host.dataset.v7Centers='';
    const state=actions.centerState||{centerId:null,familyId:null,postId:null};
    const centers=Array.isArray(model?.centers)?model.centers:[];
    const families=Array.isArray(model?.families)?model.families:[];
    const posts=Array.isArray(model?.posts)?model.posts:[];
    const resources=Array.isArray(model?.resources)?model.resources:[];
    function button(label,handler,className='kmc-v7-action'){
      const node=el(doc,'button',className,label);node.type='button';node.addEventListener('click',handler);return node;
    }
    function metric(label,value){
      const node=el(doc,'div','kmc-v7-metric');
      node.append(el(doc,'span','',label),el(doc,'strong','',value));return node;
    }
    function budgetText(summary){
      if(!summary)return 'Non disponible';
      if(summary.totalEur!=null)return v7Money(summary.totalEur);
      return summary.recordedEur==null?'Non renseigné':v7Money(summary.recordedEur)+' · partiel ('+summary.coveredPosts+'/'+summary.totalPosts+')';
    }
    function commitmentTotal(summary){
      if(!summary)return 'À rapprocher';
      if(summary.totalEur!=null)return v7Money(summary.totalEur);
      return summary.recordedEur==null?'À rapprocher':v7Money(summary.recordedEur)+' · partiel ('+summary.coveredCommitments+'/'+summary.totalCommitments+')';
    }
    function structureText(evidence){
      if(evidence?.amountEur!=null)return v7Money(evidence.amountEur,'EUR')+' · structure partielle';
      return evidence?.amountKmf!=null?v7Money(evidence.amountKmf,'KMF')+' · structure partielle (EUR indisponible)':'À rapprocher';
    }
    function balanceText(balance){return balance?.recordedAvailableEur!=null?v7Money(balance.recordedAvailableEur)+' · sur faits enregistrés':'Non calculable';}
    function metrics(summary,commitments,evidence,balance){
      const row=el(doc,'div','kmc-v7-kpis');
      row.append(metric('Budget enregistré (EUR)',budgetText(summary)),metric('Engagements ouverts (EUR)',commitmentTotal(commitments)),
        metric('Charges constatées',structureText(evidence)),metric('Disponible',balanceText(balance)));return row;
    }
    function commitmentText(p){
      const list=p.commitments||[];
      if(!list.length)return 'Aucun engagement enregistré';
      return list.map(k=>v7Money(k.remaining_native,k.currency)+(k.requires_reconciliation?' · correction à rapprocher':'')).join(' ; ');
    }
    function render(){
      host.replaceChildren();
      const center=centers.find(c=>c.id===state.centerId);
      const heading=el(doc,'div','kmc-v7-heading');
      heading.append(el(doc,'h3','',center?center.label:'Centres de coûts'),
        el(doc,'p','',model?.scope==='GROUP'?'Centres groupe · '+(model.periodStart||''):('Marché '+(model?.marketCode||'')+' · '+(model?.periodStart||''))));
      if(center)heading.append(button('Tous les centres',()=>{state.centerId=null;state.familyId=null;state.postId=null;render();}));
      host.append(heading,metrics(center?center.budgetSummary:model?.budgetSummary,center?center.commitmentSummary:model?.commitmentSummary,center?center.structureEvidence:model?.structureEvidence,center?center.recordedBalance:model?.recordedBalance));
      if(!center){
        if(canCost(model,'reference')&&typeof actions.initializeReferences==='function'){
          const feedback=el(doc,'p','kmc-v7-coverage');feedback.setAttribute('role','status');
          const initialize=button('Initialiser les centres et familles',async()=>{
            initialize.disabled=true;
            try{await actions.initializeReferences();}catch(e){feedback.textContent=e.message||'Initialisation refusée.';}finally{initialize.disabled=false;}
          });
          host.append(initialize,feedback);
          if(typeof actions.configureReference==='function')host.append(createV7ReferenceForm(doc,model,null,'CENTER',actions));
        }
        const overBudget=centers.filter(c=>c.recordedBalance?.status==='RECORDED_OVER_BUDGET');
        if(!overBudget.length)state.onlyOverBudget=false;
        if(overBudget.length){
          host.append(button(state.onlyOverBudget?'Tous les centres':'Centres en écart',()=>{
            state.onlyOverBudget=!state.onlyOverBudget;
            render();
          }));
        }
        const grid=el(doc,'div','kmc-v7-center-grid');
        for(const c of state.onlyOverBudget?overBudget:centers){
          const card=el(doc,'article','kmc-v7-center-card');
          card.append(el(doc,'h4','',c.label),el(doc,'p','',c.is_active?'Centre actif':'Centre à configurer'),
            metric('Charges constatées',structureText(c.structureEvidence)),metric('Budget enregistré (EUR)',budgetText(c.budgetSummary)),metric('Engagements ouverts (EUR)',commitmentTotal(c.commitmentSummary)),
            metric('Disponible',balanceText(c.recordedBalance)),el(doc,'p','kmc-v7-coverage',c.recordedBalance?.status==='RECORDED_OVER_BUDGET'?'Écart sur faits enregistrés':'Couverture économique non rapprochée'));
          card.append(button('Consulter',()=>{state.centerId=c.id;state.familyId=null;state.postId=null;render();}));
          grid.append(card);
        }
        if(!centers.length)grid.append(el(doc,'p','kmc-v7-empty','Aucun centre enregistré dans ce périmètre.'));
        host.append(grid);return;
      }
      host.append(metric('Responsable',center.responsible_label||'Non renseigné'));
      if(canCost(model,'reference')&&typeof actions.configureReference==='function')for(const kind of ['FAMILY','RESOURCE','RESPONSIBLE'])host.append(createV7ReferenceForm(doc,model,center,kind,actions));
      const fs=families.filter(f=>f.center_id===center.id);
      const family=fs.find(f=>f.id===state.familyId)||fs[0];
      state.familyId=family?.id||null;
      const selectors=el(doc,'div','kmc-v7-families');
      for(const f of fs){
        const btn=button(f.label,()=>{state.familyId=f.id;state.postId=null;render();},'kmc-v7-family');
        btn.setAttribute('aria-pressed',String(f.id===state.familyId));selectors.append(btn);
      }
      host.append(selectors);
      if(!family){host.append(el(doc,'p','kmc-v7-empty','Aucune famille enregistrée.'));return;}
      const ps=posts.filter(p=>p.center_id===center.id&&p.family_id===family.id);
      const table=el(doc,'table','kmc-v7-posts');
      const head=el(doc,'thead',''), hr=el(doc,'tr','');
      for(const label of ['Poste','Budget','Engagement restant','Réel','Situation']){
        const th=el(doc,'th','',label);th.scope='col';hr.append(th);
      }
      head.append(hr);table.append(head);
      const body=el(doc,'tbody','');
      for(const p of ps){
        const tr=el(doc,'tr',''),cell=el(doc,'td','');
        cell.append(button(p.label,()=>{state.postId=p.id;render();},'kmc-v7-post-button'));
        tr.append(cell,el(doc,'td','',p.budget?v7Money(p.budget.native,p.budget.currency):'Non renseigné'),
          el(doc,'td','',commitmentText(p)),el(doc,'td','',structureText(p.structureEvidence)),el(doc,'td','',p.recordedBalance?.status==='RECORDED_OVER_BUDGET'?'Écart enregistré':p.recordedBalance?.recordedAvailableEur!=null?balanceText(p.recordedBalance):'Non décisionnel'));
        body.append(tr);
      }
      table.append(body);host.append(table);
      if(canCost(model,'reference')&&typeof actions.createPost==='function')host.append(createV7PostForm(doc,model,family,resources.filter(r=>r.center_id===center.id),actions));
      if(!ps.length)host.append(el(doc,'p','kmc-v7-empty','Aucun poste dans cette famille.'));
      const post=ps.find(p=>p.id===state.postId);
      if(post){
        const detail=el(doc,'section','kmc-v7-post-detail');
        const resource=resources.find(r=>r.id===post.resource_id&&r.center_id===center.id);
        detail.append(el(doc,'h4','',post.label),metric('Ressource',resource?.label||'Non renseignée'),
          metric('Nature',({FIXED:'Fixe',VARIABLE:'Variable',MIXED:'Mixte'})[post.economic_nature]||'À qualifier'),
          metric('Périmètre',({DIRECT:'Direct',MUTUALIZED:'Mutualisé'})[post.allocation_perimeter]||'À qualifier'),
          metric('Clé d’imputation',post.allocation_basis||'Non renseignée'),
          metric('Budget',post.budget?v7Money(post.budget.native,post.budget.currency):'Non renseigné'),
          metric('Engagements',commitmentText(post)),metric('Charges constatées',structureText(post.structureEvidence)),metric('Disponible',balanceText(post.recordedBalance)),
          button('Fermer le détail',()=>{state.postId=null;render();}));
        if(canCost(model,'budget')&&typeof actions.reviseBudget==='function')detail.append(createV7BudgetForm(doc,model,post,actions));
        if((canCost(model,'commitment')||canCost(model,'actual'))&&typeof actions.openCommitment==='function'&&typeof actions.moveCommitment==='function')detail.append(createV7CommitmentForms(doc,model,post,actions));
        host.append(detail);
      }
    }
    render();return host;
  }

  function createV7ReferenceForm(doc,model,center,kind,actions){
    const labels={CENTER:'Ajouter un centre',FAMILY:'Ajouter une famille',RESOURCE:'Ajouter une ressource',RESPONSIBLE:'Affecter le responsable'};
    const details=el(doc,'details','kmc-v7-commitment'),form=el(doc,'form','kmc-v7-budget-form');
    details.append(el(doc,'summary','',labels[kind]),form);
    function field(label,name,choices){
      const wrap=el(doc,'label','kmc-v7-metric',label),input=el(doc,choices?'select':'input','');
      input.name=name;input.required=true;
      if(choices){for(const [v,t] of choices){const option=el(doc,'option','',t);option.value=v;input.append(option);}input.value=choices[0][0];}
      wrap.append(input);form.append(wrap);return input;
    }
    const fields={};
    if(kind==='RESPONSIBLE'){
      fields.responsibleUserId=field('Responsable','responsibleUserId',[['','Non affecté'],...(model.responsibleCandidates||[]).map(u=>[u.id,u.label||'Responsable'])]);
      fields.responsibleUserId.required=false;fields.responsibleUserId.value=center.responsible_user_id||'';
    }else{
      fields.code=field('Code','code');fields.label=field('Libellé','label');
      if(kind==='RESOURCE')fields.resourceKind=field('Nature','resourceKind');
    }
    fields.reason=field('Motif','reason');
    const submit=el(doc,'button','kmc-v7-action','Enregistrer'),feedback=el(doc,'p','kmc-v7-coverage');
    submit.type='submit';feedback.setAttribute('role','status');form.append(submit,feedback);
    let busy=false;
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(busy)return;
      const body={kind,centerId:center?.id||null,reason:fields.reason.value.trim()};
      if(kind==='RESPONSIBLE'){
        body.responsibleUserId=fields.responsibleUserId.value||null;body.expectedResponsibleUserId=center.responsible_user_id||null;
      }else{
        body.code=fields.code.value.trim().toUpperCase();body.label=fields.label.value.trim();
        if(kind==='RESOURCE')body.resourceKind=fields.resourceKind.value.trim();
        if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(body.code)||!body.label||(kind==='RESOURCE'&&!body.resourceKind)){feedback.textContent='Référence invalide.';return;}
      }
      if(body.reason.length<3){feedback.textContent='Motif obligatoire.';return;}
      busy=true;submit.disabled=true;
      try{await actions.configureReference(body);}catch(error){feedback.textContent=error.message||'Opération refusée.';}finally{busy=false;submit.disabled=false;}
    });
    return details;
  }

  function createV7PostForm(doc,model,family,resources,actions){
    const details=el(doc,'details','kmc-v7-commitment'),form=el(doc,'form','kmc-v7-budget-form');
    details.append(el(doc,'summary','','Ajouter un poste'),form);
    function field(label,name,choices){
      const wrap=el(doc,'label','kmc-v7-metric',label),input=el(doc,choices?'select':'input','');
      input.name=name;input.required=true;
      if(choices)for(const [value,title] of choices){const option=el(doc,'option','',title);option.value=value;input.append(option);}
      if(choices)input.value=choices[0][0];
      wrap.append(input);form.append(wrap);return input;
    }
    const label=field('Libellé','label'),code=field('Code','code'),nature=field('Nature','economicNature',[['FIXED','Fixe'],['VARIABLE','Variable'],['MIXED','Mixte']]);
    const perimeter=field('Attribution','allocationPerimeter',model.scope==='GROUP'?[['MUTUALIZED','Mutualisé'],['DIRECT','Direct']]:[['DIRECT','Direct'],['MUTUALIZED','Mutualisé']]);
    const basis=field('Clé d’imputation','allocationBasis');
    const source=field('Source du réel','source',[['CANONICAL_SOURCE','Source métier propriétaire (pas de ressaisie)'],['STRUCTURE','Journal des charges de structure']]);
    const resource=field('Ressource','resourceId',[['','Non renseignée'],...resources.map(r=>[r.id,r.label])]);resource.required=false;
    const reason=field('Motif','reason'),submit=el(doc,'button','kmc-v7-action','Créer le poste'),feedback=el(doc,'p','kmc-v7-coverage');
    submit.type='submit';feedback.setAttribute('role','status');form.append(submit,feedback);
    let busy=false;
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(busy)return;
      const body={label:label.value.trim(),code:code.value.trim().toUpperCase(),economicNature:nature.value,allocationPerimeter:perimeter.value,allocationBasis:basis.value.trim(),source:source.value,resourceId:resource.value||null,reason:reason.value.trim()};
      if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(body.code)||body.label.length<3||!body.allocationBasis||body.reason.length<3){feedback.textContent='Libellé, code, clé ou motif invalide.';return;}
      if(body.source==='STRUCTURE'&&(body.economicNature!=='FIXED'||body.allocationPerimeter!==(model.scope==='GROUP'?'MUTUALIZED':'DIRECT'))){feedback.textContent='La structure doit être fixe et respecter le périmètre du centre.';return;}
      busy=true;submit.disabled=true;
      try{await actions.createPost(family.id,body);feedback.textContent='Poste créé.';}catch(error){feedback.textContent=error.message||'Création refusée.';}finally{busy=false;submit.disabled=false;}
    });
    return details;
  }

  function createV7BudgetForm(doc,model,post,actions){
    const form=el(doc,'form','kmc-v7-budget-form');
    const heading=el(doc,'h4','','Réviser le budget du poste');
    const field=(label,name,value,placeholder)=>{
      const wrap=el(doc,'label','kmc-v7-metric',label);
      const input=el(doc,'input','');input.name=name;input.value=value;input.placeholder=placeholder;input.required=true;
      wrap.append(input);form.append(wrap);return input;
    };
    form.append(heading);
    // Keep integer amounts intact; strip only insignificant fractional zeros.
    const native=post.budget?.native||'';
    const amount=field('Montant natif','amountNative',native.includes('.')?native.replace(/0+$/,'').replace(/\.$/,''):native,'0.00');
    const currency=field('Devise ISO','currency',post.budget?.currency||'EUR','EUR');currency.maxLength=3;
    const reason=field('Motif de la révision','reason','','Justification');
    const submit=el(doc,'button','kmc-v7-action','Valider le budget');submit.type='submit';
    const feedback=el(doc,'p','kmc-v7-coverage');feedback.setAttribute('role','status');
    form.append(submit,feedback);
    let key=null,fingerprint=null,busy=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const body={periodStart:model.periodStart,expectedRevision:post.budget?.revision||0,currency:currency.value.trim().toUpperCase(),amountNative:amount.value.trim().replace(',','.'),reason:reason.value.trim()};
      if(!/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/.test(body.amountNative)||!/^[A-Z]{3}$/.test(body.currency)||body.reason.length<3){feedback.textContent='Montant, devise ou motif invalide.';return;}
      const nextFingerprint=JSON.stringify(body);
      if(fingerprint!==nextFingerprint){key=null;fingerprint=nextFingerprint;}
      if(!key){if(typeof globalThis.crypto?.randomUUID!=='function'){feedback.textContent='Identifiant de requête indisponible.';return;}key=globalThis.crypto.randomUUID();}
      busy=true;submit.disabled=true;
      try{await actions.reviseBudget(post.id,{...body,requestKey:key});feedback.textContent='Budget enregistré.';}
      catch(error){feedback.textContent=error.message||'Révision refusée.';}
      finally{busy=false;submit.disabled=false;}
    });
    return form;
  }

  function createV7CommitmentForms(doc,model,post,actions){
    const section=el(doc,'section','kmc-v7-commitment-actions');
    function operation(label,submitLabel,defaults,run,choices){
      const form=el(doc,'form','kmc-v7-budget-form');
      form.append(el(doc,'h4','',label));
      function field(label,name,value,readOnly=false){
        const wrap=el(doc,'label','kmc-v7-metric',label),input=el(doc,'input','');
        input.name=name;input.value=value;input.required=true;input.readOnly=readOnly;wrap.append(input);form.append(wrap);return input;
      }
      const amount=field('Montant natif','amountNative',''),currency=field('Devise ISO','currency',defaults.currency||'EUR',Boolean(defaults.fixedCurrency));
      currency.maxLength=3;
      const evidence=field('Référence du justificatif','evidenceRef','');
      let fact=null;
      if(choices){
        const wrap=el(doc,'label','kmc-v7-metric','Charge constatée à rapprocher');
        fact=el(doc,'select','');fact.required=true;fact.name='structureEventId';
        const empty=el(doc,'option','','Choisir une charge');empty.value='';fact.append(empty);
        for(const row of choices){const option=el(doc,'option','',(row.evidenceRef||'Fait canonique')+' · '+v7Money(row.remainingNative,row.currency));option.value=row.id;fact.append(option);}
        fact.value='';wrap.append(fact);form.append(wrap);
      }
      const submit=el(doc,'button','kmc-v7-action',submitLabel);submit.type='submit';
      const feedback=el(doc,'p','kmc-v7-coverage');feedback.setAttribute('role','status');form.append(submit,feedback);
      let key=null,fingerprint=null,busy=false;
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(busy)return;
        const body={periodStart:model.periodStart,amountNative:amount.value.trim().replace(',','.'),currency:currency.value.trim().toUpperCase(),evidenceRef:evidence.value.trim()};
        if(fact)body.structureEventId=fact.value;
        if(!/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/.test(body.amountNative)||!/[1-9]/.test(body.amountNative)||!/^[A-Z]{3}$/.test(body.currency)||body.evidenceRef.length<3||(fact&&!choices.some(f=>f.id===body.structureEventId))){feedback.textContent='Montant ou justificatif invalide.';return;}
        const next=JSON.stringify(body);if(next!==fingerprint){key=null;fingerprint=next;}
        if(!key){if(typeof globalThis.crypto?.randomUUID!=='function'){feedback.textContent='Identifiant de requête indisponible.';return;}key=globalThis.crypto.randomUUID();}
        busy=true;submit.disabled=true;
        try{await run({...body,requestKey:key});feedback.textContent='Opération enregistrée.';}catch(error){feedback.textContent=error.message||'Opération refusée.';}finally{busy=false;submit.disabled=false;}
      });
      return form;
    }
    if(canCost(model,'actual')&&post.acceptsStructureActual===true&&typeof actions.recordActual==='function'){
      section.append(operation('Charge constatée','Enregistrer la charge',{currency:post.budget?.currency},({requestKey,...body})=>actions.recordActual(post.id,body)));
    }else if(post.acceptsStructureActual===false){
      section.append(el(doc,'p','kmc-v7-coverage','Réel alimenté par la source propriétaire ; aucune ressaisie.'));
    }
    if(!canCost(model,'commitment'))return section;
    section.append(operation('Nouvel engagement','Enregistrer l’engagement',{currency:post.budget?.currency},body=>actions.openCommitment(post.id,body)));
    for(const k of post.commitments||[]){
      if(typeof k.remaining_native!=='string'||!/[1-9]/.test(k.remaining_native))continue;
      const block=el(doc,'details','kmc-v7-commitment');
      block.append(el(doc,'summary','',(k.evidence_ref||'Engagement')+' · reste '+v7Money(k.remaining_native,k.currency)));
      if(k.requires_reconciliation)block.append(el(doc,'p','kmc-v7-coverage','Correction à rapprocher avant consommation.'));
      block.append(operation('Libérer une partie','Libérer',{currency:k.currency,fixedCurrency:true},({currency,...body})=>actions.moveCommitment(k.id,{...body,kind:'RELEASE'})));
      const facts=(post.eligibleStructureFacts||[]).filter(f=>f.currency===k.currency);
      if(canCost(model,'consume')&&!k.requires_reconciliation&&facts.length)block.append(operation('Rapprocher une charge existante','Consommer l’engagement',{currency:k.currency,fixedCurrency:true},({currency,...body})=>actions.moveCommitment(k.id,{...body,kind:'CONSUME_STRUCTURE'}),facts));
      section.append(block);
    }
    return section;
  }

  // V6 activity: display only server projections; no browser aggregation.
  function createV6Activity(doc, model) {
    const host=el(doc,'section','kmc-v7-centers kmc-v6-activity');
    host.append(el(doc,'div','kmc-v7-heading','Activité'));
    const a=model?.activity;
    if(!a){host.append(el(doc,'p','kmc-v7-empty','Activité tous marchés non consolidée. Sélectionnez un marché autorisé.'));return host;}
    const amount=x=>v7Money(x,'KMF');
    const measure=(x,unit)=>typeof x==='string'?x.replace('.',',')+' '+unit:'Non disponible';
    const count=x=>x==null?'Non disponible':String(x);
    const coverage=(n,total)=>count(n)+' / '+count(total)+' expéditions';
    function metric(label,value,sub){
      const m=el(doc,'div','kmc-v7-metric');m.append(el(doc,'span','',label),el(doc,'strong','',value));
      if(sub)m.append(el(doc,'small','kmc-v7-coverage',sub));return m;
    }
    const kpis=el(doc,'div','kmc-v7-kpis');
    kpis.append(metric('Expéditions reçues',count(a.physicalClosedCount),count(a.financialClosedCount)+' clôturées financièrement'),
      metric('Poids / volume',measure(a.weightKg??a.measuredWeightSubtotalKg,'kg'),measure(a.volumeM3??a.volumeSubtotalM3,'m³')+' · poids '+coverage(a.measuredWeightCount,a.physicalClosedCount)+' · volume renseigné '+coverage(a.volumeCoveredCount,a.physicalClosedCount)),
      metric('Articles reçus / KOM-BOX',count(a.receivedArticles),count(a.expectedArticles)+' attendus · '+count(a.boxCount)+' KOM-BOX'),
      metric('Fret + douane constatés',amount(a.freightCustomsSubtotalKmf),coverage(a.financialClosedCount,a.physicalClosedCount)));
    host.append(kpis);
    const panel=el(doc,'section','kmc-v6-panel');panel.append(el(doc,'h4','','Expéditions de la période'),el(doc,'p','kmc-v7-coverage','Cohorte par réception relais UTC · montants sources KMF · clôture financière distincte.'));
    const table=el(doc,'table','kmc-v7-posts kmc-v6-shipments'),head=el(doc,'thead',''),hr=el(doc,'tr','');
    for(const label of ['Référence / rail','Poids','Achats','Fret + douane','Coût transport/kg','Volume / articles','Clôture']){
      const th=el(doc,'th','',label);th.scope='col';hr.append(th);
    }
    head.append(hr);table.append(head);
    const body=el(doc,'tbody','');
    for(const s of a.shipments||[]){
      const row=el(doc,'tr','');
      for(const value of [s.reference+' · '+({sea:'Maritime',air:'Aérien'}[s.rail]||'Rail non renseigné'),measure(s.weightKg,'kg'),amount(s.purchaseKmf),amount(s.freightCustomsKmf),amount(s.costPerKgKmf),measure(s.volumeM3,'m³')+' · '+count(s.receivedArticles)+' articles',s.financialStatus==='DOCUMENTED_CLOSED'?'Financièrement clôturée':'Financier à rapprocher'])row.append(el(doc,'td','',value));
      body.append(row);
    }
    table.append(body);
    const foot=el(doc,'tfoot',''),fr=el(doc,'tr','');
    for(const value of ['Total / pondéré',measure(a.weightKg,'kg'),amount(a.purchaseKmf),amount(a.coverage==='TRANSPORT_DOCUMENTED'?a.freightCustomsSubtotalKmf:null),amount(a.costPerKgKmf),measure(a.volumeM3,'m³')+' · '+count(a.receivedArticles)+' articles',coverage(a.weightedShipmentCount,a.physicalClosedCount)])fr.append(el(doc,'td','',value));
    foot.append(fr);table.append(foot);panel.append(table);
    if(!(a.shipments||[]).length)panel.append(el(doc,'p','kmc-v7-empty','Aucune expédition attestée sur la période.'));
    host.append(panel);
    const cards=el(doc,'div','kmc-v7-center-grid'),rec=el(doc,'article','kmc-v6-panel'),variation=el(doc,'article','kmc-v6-panel');
    const obs=a.purchaseTransportObservation||{};
    rec.append(el(doc,'h4','','Rapprochement des coûts'),metric('Achats réels',amount(obs.purchaseKmf)),metric('Fret + douane',amount(obs.freightCustomsKmf)),metric('Autres frais de transport',amount(obs.otherTransportKmf)),metric('Sous-total documenté',amount(obs.documentedSubtotalKmf),coverage(obs.observations,a.physicalClosedCount)),metric('Coût complet de période',amount(obs.fullEconomicCostKmf),'Autres charges et imputations à rapprocher'));
    variation.append(el(doc,'h4','','Variabilité du coût logistique/kg'),metric('Minimum',amount(a.minCostPerKgKmf)),metric('Maximum',amount(a.maxCostPerKgKmf)),metric('Pondéré',amount(a.costPerKgKmf),coverage(a.weightedShipmentCount,a.physicalClosedCount)),el(doc,'p','kmc-v7-coverage','Coût documenté / poids brut mesuré, sur la même cohorte.'));
    cards.append(rec,variation);host.append(cards);return host;
  }

  // Only geometry is computed in the browser. All coefficient values and
  // window totals are the authoritative server observations.
  function createObservedCurve(doc,points){
    if(typeof doc.createElementNS!=='function')return null;
    const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 760 220');svg.setAttribute('role','img');
    svg.setAttribute('aria-label','Courbes du coefficient partiel achat et transport ; valeurs détaillées dans le tableau.');
    const series=[['monthly','#8795a1','5 4'],['cumulative','#157e78',''],['rolling3','#bd8b2f','']];
    const value=(p,k)=>p[k]?.coefficient==null?null:Number(p[k].coefficient);
    const all=points.flatMap(p=>series.map(([k])=>value(p,k))).filter(Number.isFinite);
    if(!all.length)return null;
    const low=Math.min(...all),high=Math.max(...all),span=Math.max(high-low,0.01),x=i=>40+i*680/Math.max(1,points.length-1),y=v=>170-(v-low)/span*140;
    function elem(tag,attrs,content){
      const n=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(content!=null)n.textContent=content;svg.appendChild(n);return n;
    }
    elem('line',{x1:40,y1:170,x2:720,y2:170,stroke:'#dce3e9'});
    elem('text',{x:4,y:26,fill:'#526577','font-size':11},high.toFixed(4));
    elem('text',{x:4,y:168,fill:'#526577','font-size':11},low.toFixed(4));
    points.forEach((p,i)=>elem('text',{x:x(i),y:196,'text-anchor':'middle',fill:'#526577','font-size':11},p.periodStart.slice(5,7)));
    for(const [key,color,dash] of series){
      let prev=null;points.forEach((p,i)=>{const v=value(p,key);if(!Number.isFinite(v)){prev=null;return;}
        const point=[x(i),y(v)];if(prev)elem('line',{x1:prev[0],y1:prev[1],x2:point[0],y2:point[1],stroke:color,'stroke-width':2,'stroke-dasharray':dash});
        elem('circle',{cx:point[0],cy:point[1],r:3,fill:color});prev=point;});
    }
    return svg;
  }
  function createV6Profitability(doc,model,actions){
    const host=el(doc,'section','kmc-v7-centers kmc-v6-profitability'),data=model?.profitability;
    const groupResult = data?.groupPeriodResult;
    const closed = groupResult?.status === 'CLOSED';
    const reopened = groupResult?.status === 'REOPENED';
    const provisional = groupResult?.status === 'PROVISIONAL' || reopened;
    host.append(el(doc,'h3','','Rentabilité'),el(doc,'p','kmc-v7-coverage',closed
      ? 'Résultat définitif. Période validée par la Direction.'
      : reopened ? 'Rapprochement rouvert après modification des preuves.'
      : provisional
      ? 'Résultat provisoire sur les faits documentés. Clôture Direction en attente.'
      : 'Résultat économique non calculable : rapprochement des ventes, charges variables et structure à compléter.'));
    if(!data){
      const observation=model?.activity?.purchaseTransportObservation;
      if(observation?.coefficient!=null)host.append(el(doc,'p','','Observation partielle achat + transport : '+observation.coefficient.replace('.',',')+' · non décisionnelle'));
      return host;
    }
    const metric=(label,value,sub)=>{const n=el(doc,'div','kmc-v7-metric');n.append(el(doc,'span','',label),el(doc,'strong','',value));if(sub)n.append(el(doc,'small','kmc-v7-coverage',sub));return n;};
    const fmt=v=>v==null?'Non disponible':String(v).replace('.',',');
    const kpis=el(doc,'div','kmc-v7-kpis');
    const sales=data.salesEvidence;
    kpis.append(metric('Ventes nettes observées',v7Money(sales?.observedNetSalesKmf,'KMF'),sales?sales.coveredOrderCount+' / '+sales.paidOrderCount+' commandes payées · cohorte commandes du mois':'Non disponible'),metric('Contribution variable',v7Money(groupResult?.contributionKmf,'KMF')),metric('Résultat économique',v7Money(groupResult?.resultKmf,'KMF')),metric('Coefficient complet du mois','Non disponible'));
    host.append(kpis);
    if(sales)host.append(el(doc,'p','kmc-v7-coverage','Ventes : commandes créées au mois, avoirs wallet réintégrés, remboursements terminés déduits. '+sales.pendingRefundOrders+' commande(s) avec remboursement pendant ; '+sales.terminalExceptions+' exception(s) terminale(s) ; '+sales.invalidOrderCount+' montant(s) non rapproché(s). Cohorte distincte des expéditions, aucun résultat par soustraction.'));
    const recognition = data.recognitionEvidence;
    if (recognition) {
      const events = el(doc,'div','kmc-v7-kpis');
      events.append(
        metric('Articles remis avec preuve',String(recognition.attestedUnits),recognition.handoffParcelCount+' colis documentés ce mois'),
        metric('Ventes documentées à la remise',v7Money(recognition.documentedHandoffSalesKmf,'KMF'),
          recognition.pricedHandoffUnits+' / '+recognition.attestedUnits+' articles remis avec prix rapproché'),
        metric('Remboursements confirmés',v7Money(recognition.confirmedRefundKmf,'KMF'),'Nombre ce mois · '+recognition.confirmedRefundCount),
        metric('Coûts variables documentés des remises',v7Money(recognition.documentedParcelVariableCostKmf,'KMF'),
          recognition.parcelCostEvidenceCount+' / '+recognition.handoffParcelCount+' colis avec des coûts documentés')
      );
      host.append(events);
    }
    const panel=el(doc,'section','kmc-v6-panel'),controls=el(doc,'div','kmc-v7-families'),focus=el(doc,'div','kmc-v7-kpis'),chart=el(doc,'div','kmc-v6-chart');
    panel.append(el(doc,'h4','','Observation partielle achat + transport — non décisionnelle'),controls,focus,chart);
    const defs=[['month','Mois'],['quarter','Trimestre à date'],['ytd','Année à date']];const buttons=[];
    function render(key){
      const o=data.ranges[key],from=o.periodStart;
      for(const [k,b] of buttons)b.setAttribute('aria-pressed',String(k===key));
      const coverage=o.observations+' / '+o.physicalClosedCount+' expéditions';
      const dispersion=o.minCoefficient!=null&&o.maxCoefficient!=null
        ? coverage+' · min. '+fmt(o.minCoefficient)+' · max. '+fmt(o.maxCoefficient)
        : coverage;
      const weight=o.coefficientWeightKg;
      focus.replaceChildren();
      focus.append(metric('Coefficient observé',fmt(o.coefficient),dispersion),
        metric('Achats rapprochés',v7Money(o.purchaseKmf,'KMF')),
        metric('Transport documenté',v7Money(o.transportKmf,'KMF')),
        metric('Poids renseigné',fmt(weight)+(weight==null?'':' kg'),(o.coefficientWeightCount??0)+' / '+o.observations+' expéditions du coefficient'));
      chart.replaceChildren();const points=data.points.filter(p=>p.periodStart>=from);
      const svg=createObservedCurve(doc,points);if(svg)chart.append(svg);
      chart.append(el(doc,'p','kmc-v7-coverage','Mensuel (gris) · cumul année (teal) · glissant 3 mois (or). Lacunes non interpolées.'));
      const table=el(doc,'table','kmc-v7-posts'),head=el(doc,'thead',''),hr=el(doc,'tr','');
      for(const label of ['Mois','Mensuel','Cumul année','Glissant 3 mois','Couverture mensuelle']){
        const th=el(doc,'th','',label);th.scope='col';hr.append(th);}
      head.append(hr);table.append(head);const body=el(doc,'tbody','');
      for(const p of points){const tr=el(doc,'tr','');for(const v of [p.periodStart.slice(0,7),fmt(p.monthly.coefficient),fmt(p.cumulative.coefficient),fmt(p.rolling3.coefficient),p.monthly.observations+' / '+p.monthly.physicalClosedCount])tr.append(el(doc,'td','',v));body.append(tr);}
      table.append(body);chart.append(table);
    }
    for(const [key,label] of defs){const b=el(doc,'button','kmc-v7-family',label);b.type='button';b.addEventListener('click',()=>render(key));buttons.push([key,b]);controls.append(b);}
    render('ytd');host.append(panel);
    const cards=el(doc,'div','kmc-v7-center-grid'),result=el(doc,'article','kmc-v6-panel'),structure=el(doc,'article','kmc-v6-panel');
    const decision=data.periodDecisionEvidence,available=decision?.status==='AVAILABLE_ON_MATURE_COHORT';
    if(available){
      result.append(el(doc,'h4','','Formation du résultat — cohorte mature'),el(doc,'p','kmc-v7-coverage','Évaluation distincte du moteur canonique : '+fmt(decision.matureOrderCount)+' commandes matures · ce n’est pas le résultat complet du cockpit.'),
        metric('Ventes sur assiette du moteur',v7Money(decision.revenueBasisKmf,'KMF')),metric('Coûts variables transactionnels',v7Money(decision.variableCostsKmf,'KMF')),metric('Risque réel',v7Money(decision.actualRiskKmf,'KMF')),
        metric('Contribution rapprochée',v7Money(decision.contributionKmf,'KMF')),metric('Charges structurelles du moteur',v7Money(decision.structureKmf,'KMF')),metric('Résultat de la cohorte mature',v7Money(decision.resultKmf,'KMF')));
      structure.append(el(doc,'h4','','Couverture de structure — moteur canonique'),metric('Ratio de couverture',fmt(decision.coverageRatio)),metric('Reste à couvrir',v7Money(decision.remainingKmf,'KMF')),el(doc,'p','kmc-v7-coverage','Évaluation séparée de la cohorte expéditions. Aucun calcul de prix automatique.'));
    }else if(provisional||closed){
      result.append(el(doc,'h4','',closed?'Formation du résultat définitif':'Formation du résultat provisoire'),
        metric('Ventes nettes documentées',v7Money(groupResult.netSalesKmf,'KMF')),
        metric('Charges variables documentées',v7Money(groupResult.variableCostKmf,'KMF')),
        metric('Pertes sur périodes revues',v7Money(groupResult.actualRiskKmf,'KMF')),
        metric('Contribution variable',v7Money(groupResult.contributionKmf,'KMF')),
        metric('Charges de structure documentées',v7Money(groupResult.structureKmf,'KMF')),
        metric(closed?'Résultat définitif':'Résultat provisoire',v7Money(groupResult.resultKmf,'KMF')));
      structure.append(el(doc,'h4','','Couverture de structure'),metric('Clôture Direction',closed?'Validée':'À valider'));
    }else{
      result.append(el(doc,'h4','','Formation du résultat'),...['Ventes nettes','Achats du périmètre complet','Charges variables','Contribution variable','Charges de structure','Résultat économique'].map(k=>metric(k,'À rapprocher')));
      structure.append(el(doc,'h4','','Couverture de structure'),metric('Couverture','Non calculable'),metric('Reste à couvrir','Non calculable'),el(doc,'p','kmc-v7-coverage','Sous-activité : référence insuffisante. Le coefficient partiel ne détermine pas les prix.'));
      const documented=data.structureCoverage;
      if(documented?.recognizedKmf!=null)structure.append(
        metric('Charges de structure documentées',v7Money(String(documented.recognizedKmf),'KMF'),
          documented.evidenceCount+' événement(s) de période'),
        metric('Charges directes des marchés',v7Money(String(documented.marketDirectKmf),'KMF')),
        metric('Charges mutualisées du groupe',v7Money(String(documented.groupSharedKmf),'KMF')));
      if(decision)structure.append(el(doc,'p','kmc-v7-coverage','Motif moteur : '+(decision.reason==='MARKET_DECISION_POLICY_REQUIRED'?'Politique de marché absente':decision.reason==='DECISION_SCOPE_MISMATCH'?'Périmètre de décision incohérent':'Rapprochement canonique indisponible')));
    }
    if (provisional && model.central && actions?.closePeriod && groupResult.evidenceHash) {
      const evidence = el(doc,'input','');
      evidence.required = true;
      evidence.maxLength = 1000;
      const evidenceLabel = el(doc,'label','','Référence du justificatif');
      evidenceLabel.append(evidence);
      const attestation = el(doc,'input','');
      attestation.type = 'checkbox';
      const attestationLabel = el(doc,'label','',' Ventes, remboursements, coûts et pertes du mois vérifiés');
      attestationLabel.append(attestation);
      const close = el(doc,'button','kmc-v7-family','Valider la clôture');
      close.type = 'button';
      const feedback = el(doc,'p','kmc-v7-coverage');
      feedback.setAttribute('role','status');
      close.addEventListener('click',async()=>{
        if (!attestation.checked || evidence.value.trim().length < 3) {
          feedback.textContent='Confirmez la revue et renseignez le justificatif.';
          return;
        }
        close.disabled = true;
        try {
          await actions.closePeriod({periodStart:model.periodStart,evidenceHash:groupResult.evidenceHash,
            evidenceRef:evidence.value.trim(),attested:true});
        } catch (error) {
          feedback.textContent=error.message;
          close.disabled = false;
        }
      });
      result.append(evidenceLabel,attestationLabel,close,feedback);
    }
    cards.append(result,structure);host.append(cards);return host;
  }

  // Exclusive three-tab contract: one server snapshot for all views.
  function createV7V6Tabs(doc, model, initial='centers', onTabChange,actions){
    const shell=el(doc,'section','kmc-v7v6-tabs'),nav=el(doc,'nav','kmc-v7-families'),content=el(doc,'div','kmc-v7v6-content');
    nav.setAttribute('aria-label','Atelier économique');
    const defs=[['centers','Centres de coûts'],['activity','Activité'],['profit','Rentabilité']];
    let active=defs.some(d=>d[0]===initial)?initial:'centers';
    const tabs=[];
    function render(){
      for(const [key,btn] of tabs)btn.setAttribute('aria-pressed',String(key===active));
      content.replaceChildren();
      if(active==='centers')content.append(createV7CostCenters(doc,model,actions));
      else if(active==='activity')content.append(createV6Activity(doc,model));
      else content.append(createV6Profitability(doc,model,actions));
    }
    for(const [key,label] of defs){
      const btn=el(doc,'button','kmc-v7-family',label);btn.type='button';btn.addEventListener('click',()=>{active=key;render();if(typeof onTabChange==='function')onTabChange(key);});tabs.push([key,btn]);nav.append(btn);
    }
    shell.append(nav,content);render();return shell;
  }

  async function fetchV7V6Model(workspace, options, periodStart){
    if(typeof periodStart!=='string'||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodStart))throw new Error('Période mensuelle invalide');
    const endpoint=workspace.endpointFor({requestedMarket:options.requestedMarket});
    const result=await workspace.jsonRequest(options.fetch,endpoint+'/cost-centers?periodStart='+encodeURIComponent(periodStart));
    if(!result||result.periodStart!==periodStart||result.marketCode!==(options.requestedMarket||null))throw new Error('Périmètre économique incohérent');
    return result;
  }

  // Common read controller for the approved three-tab cockpit. The outer
  // workspace owns the market; never keep a model after a failed scope/period
  // change. Only the server supplies economic values.
  function createV7V6Session(doc, workspace, options, initialPeriod) {
    const host=el(doc,'section','kmc-v7v6-session');
    const status=el(doc,'p','kmc-v7-coverage');
    status.setAttribute('role','status');
    const content=el(doc,'div','kmc-v7v6-session-content');
    host.append(status,content);
    let generation=0, active='centers', disposed=false, currentModel=null;
    const context={...options,requestedMarket:options.requestedMarket||null};
    const centerState={centerId:null,familyId:null,postId:null};
    async function refresh(periodStart=initialPeriod){
      if(disposed)return false;
      const request=++generation;
      currentModel=null;
      content.replaceChildren();
      status.textContent='Chargement de la période '+periodStart+'…';
      host.setAttribute('aria-busy','true');
      try{
        const model=await fetchV7V6Model(workspace,context,periodStart);
        if(disposed||request!==generation)return false;
        currentModel=model;
        const mutate=async(action,path,body)=>{
          if(disposed||request!==generation||currentModel!==model||!canCost(model,action))throw new Error('Périmètre économique obsolète.');
          const endpoint=workspace.endpointFor({requestedMarket:context.requestedMarket});
          const result=await workspace.jsonRequest(context.fetch,endpoint+'/cost-centers'+path,{method:'POST',body});
          if(!disposed&&request===generation){
            const refreshed=await refresh(model.periodStart);
            if(refreshed)status.textContent='Opération enregistrée.';
          }
          return result;
        };
        const actions={centerState,
          closePeriod:body=>mutate('closePeriod','/close-period',body),
          reviseBudget:(id,body)=>mutate('budget','/posts/'+encodeURIComponent(id)+'/budget-revisions',body),
          openCommitment:(id,body)=>mutate('commitment','/posts/'+encodeURIComponent(id)+'/commitments',body),
          recordActual:(id,body)=>mutate('actual','/posts/'+encodeURIComponent(id)+'/actuals',body),
          createPost:(id,body)=>mutate('reference','/families/'+encodeURIComponent(id)+'/posts',body),
          initializeReferences:()=>mutate('reference','/initialize',{}),
          configureReference:body=>mutate('reference','/references',body),
          moveCommitment:(id,body)=>mutate(body.kind==='CONSUME_STRUCTURE'?'consume':'commitment','/commitments/'+encodeURIComponent(id)+'/movements',body)
        };
        content.append(createV7V6Tabs(doc,model,active,key=>{active=key;},actions));
        status.textContent='';
        return true;
      }catch(error){
        if(disposed||request!==generation)return false;
        content.replaceChildren();
        status.textContent='Données économiques indisponibles pour cette période.';
        return false;
      }finally{
        if(!disposed&&request===generation)host.setAttribute('aria-busy','false');
      }
    }
    function dispose(){
      disposed=true;generation++;currentModel=null;
      content.replaceChildren();
      status.textContent='';
      host.setAttribute('aria-busy','false');
    }
    return {element:host,refresh,dispose,get model(){return currentModel;}};
  }

  function finite(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value, digits = 0) {
    const number = finite(value);
    if (number == null) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(number);
  }

  function formatKmf(value) {
    return finite(value) == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatMoney(value, currency) {
    return finite(value) == null ? '—' : `${formatNumber(value, 2)} ${currency || ''}`.trim();
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  function economicNature(component = {}) {
    if (component.economic_nature) return component.economic_nature;
    if (component.family === 'landed_relay') return 'variable';
    if (component.family === 'business' && component.category === 'fixed_overhead') return 'fixed';
    if (component.family === 'business') return 'variable';
    return null;
  }

  function allocationPerimeter(component = {}) {
    return component.allocation_perimeter || 'direct';
  }

  function allocationLabel(method) {
    return ({
      none: '—', per_order: 'Commande', per_item: 'Article', by_value: 'Valeur',
      by_weight: 'Poids', by_volume: 'Volume', by_taxable_weight: 'Poids taxable',
      by_quantity: 'Quantité', by_category_risk: 'Risque catégorie', manual: 'Manuelle',
    })[method] || String(method || '—').replaceAll('_', ' ');
  }

  function unitLabel(unit) {
    return ({
      kmf: 'KMF', pct: '%', kmf_per_kg: 'KMF/kg', kmf_per_m3: 'KMF/m³',
      kmf_per_order: 'KMF/commande', kmf_per_parcel: 'KMF/colis', kmf_per_shipment: 'KMF/expédition',
      eur: 'EUR', usd: 'USD', aed: 'AED',
    })[unit] || unit || '';
  }

  function componentValue(component, useGlobal = false) {
    const value = useGlobal ? component.base_default_value : component.default_value;
    return finite(value) == null ? '—' : `${formatNumber(value, 2)} ${unitLabel(component.unit)}`.trim();
  }

  function categoryLabel(category) {
    return String(category || 'Autres').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
  }

  function marketFlagEmoji(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return '';
    const base = 0x1f1e6;
    return String.fromCodePoint(...[...normalized].map(letter => base + letter.charCodeAt(0) - 65));
  }

  function classifyComponents(components = []) {
    const active = components.filter(component => component.is_active !== false && !component.is_exceptional && component.family !== 'exceptional');
    return {
      variable: active.filter(component => economicNature(component) === 'variable'),
      fixedDirect: active.filter(component => economicNature(component) === 'fixed' && allocationPerimeter(component) === 'direct'),
      fixedMutualized: active.filter(component => economicNature(component) === 'fixed' && allocationPerimeter(component) === 'mutualized'),
      exceptional: components.filter(component => component.is_exceptional || component.family === 'exceptional'),
    };
  }

  function badge(doc, text, tone = '') {
    return el(doc, 'span', `kmc-cockpit-badge${tone ? ` is-${tone}` : ''}`, text);
  }

  function tableCell(doc, value, className = '') {
    return el(doc, 'div', `kmc-cockpit-cell${className ? ` ${className}` : ''}`, value);
  }

  function costCardHeader(doc, icon, title, subtitle, actionText, actionKey, disabledHint) {
    const head = el(doc, 'div', 'kmc-cockpit-cost-head');
    const identity = el(doc, 'div', 'kmc-cockpit-cost-identity');
    identity.appendChild(el(doc, 'span', 'kmc-cockpit-cost-icon', icon));
    const copy = el(doc, 'div', '');
    copy.appendChild(el(doc, 'strong', '', title));
    copy.appendChild(el(doc, 'small', '', subtitle));
    identity.appendChild(copy);
    head.appendChild(identity);
    if (actionText) {
      const action = el(doc, 'button', 'kmc-cockpit-outline-action', actionText);
      action.type = 'button';
      action.dataset.openCostDetail = actionKey;
      head.appendChild(action);
    }
    return head;
  }

  function variableMarketShare(component) {
    if (allocationPerimeter(component) !== 'mutualized') return '—';
    const explicit = finite(component.market_share_kmf ?? component.market_quote_kmf ?? component.effective_market_share_kmf);
    return explicit == null ? componentValue(component) : formatKmf(explicit);
  }

  // Preview cards intentionally reuse server-sourced figures; no totals from
  // mixed units and no implicit fallback to 0 for missing values.
  function economicPreview(doc, items, footer) {
    const preview = el(doc, 'div', 'kmc-economic-family-preview');
    preview.dataset.costFamilyPreview = '';
    const list = el(doc, 'div', 'kmc-economic-family-preview-list');
    items.forEach(item => {
      const row = el(doc, 'div', 'kmc-economic-family-preview-row');
      const label = el(doc, 'span', 'kmc-economic-family-preview-label', item.label);
      const value = el(doc, 'strong', 'kmc-economic-family-preview-value', item.value);
      row.appendChild(label);
      row.appendChild(value);
      if (item.note || item.descriptionChargeId) {
        const note = el(doc, 'small', 'kmc-economic-family-preview-note', item.note || 'Description à compléter');
        if (item.descriptionChargeId) {
          const editNote = el(doc,'button','kmc-inline-cost-note-action','Modifier libellé et description');
          editNote.type='button';
          editNote.dataset.editFixedDescription = String(item.descriptionChargeId);
          note.appendChild(editNote);
        }
        row.appendChild(note);
      }
      if (item.editKey) {
        row.dataset.inlineCostRow = item.editKey;
        const edit = el(doc, 'button', 'kmc-inline-cost-action', 'Modifier');
        edit.type = 'button';
        edit.dataset.editInlineCost = item.editKey;
        edit.setAttribute('aria-label', `Modifier ${item.label}, valeur actuelle ${item.value}`);
        row.appendChild(edit);
      } else if (item.chargeId) {
        row.dataset.inlineStructureRow = String(item.chargeId);
        const edit = el(doc, 'button', 'kmc-inline-cost-action', 'Modifier');
        edit.type = 'button';
        edit.dataset.editStructureCharge = String(item.chargeId);
        edit.dataset.structureScope = item.structureScope || 'fixed-direct';
        edit.setAttribute('aria-label', `Modifier ${item.label} (période et justificatif obligatoires)`);
        row.appendChild(edit);
      }
      if (item.readOnly) {
        const status = el(doc, 'span', 'kmc-inline-cost-readonly', 'Lecture seule');
        status.title = item.readOnlyHint || 'Modification non autorisée sur ce périmètre.';
        status.setAttribute('aria-label', status.title);
        row.appendChild(status);
      }
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(el(doc, 'p', 'kmc-economic-family-preview-empty', 'Données de période indisponibles.'));
    preview.appendChild(list);
    if (footer) preview.appendChild(el(doc, 'div', 'kmc-economic-family-preview-footer', footer));
    return preview;
  }

  function variableCostCard(doc, components, canManage) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-variable');
    card.dataset.costSummary = 'variable';
    card.appendChild(costCardHeader(doc, '🛒', 'Coûts variables', 'Valeur actuelle et modification directe de chaque poste.'));

    const previewItems = [
      { label: 'Achat fournisseur', value: 'Par produit', readOnly: true,
        readOnlyHint: 'Coût propre à chaque produit : modification depuis la source ou le produit, sans montant global inventé.',
        note: 'Sans montant forfaitaire inventé' },
      ...components.map(component => ({
        label: component.label || component.key,
        value: componentValue(component),
        editKey: canManage && component.key ? component.key : null,
        readOnly: !canManage || !component.key,
        readOnlyHint: !canManage
          ? 'Les paramètres variables sont en lecture seule pour ce profil.'
          : 'Aucune clé de composante modifiable disponible.',
        note: component.inherited === false
          ? (component.base_default_value != null
            ? `Paramètre marché · Base globale : ${componentValue(component, true)} (lecture seule)`
            : 'Paramètre marché')
          : component.inherited === true
            ? (component.base_default_value != null
              ? `Base globale héritée · Base globale : ${componentValue(component, true)} (lecture seule)`
              : 'Base globale héritée')
            : 'Origine à confirmer',
      })),
    ];
    card.appendChild(economicPreview(doc, previewItems, 'Coût variable complet calculé sur chaque produit'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-variable');
    ['Élément', 'Nature', 'Périmètre', 'Clé d’allocation', 'Valeur', 'Provenance', 'Quote-part marché'].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));

    // Le mock rappelle explicitement que l'achat fournisseur est un coût
    // variable direct. Sa valeur reste produit-spécifique : aucune moyenne
    // portefeuille n'est inventée ici.
    table.appendChild(tableCell(doc, 'Achat fournisseur'));
    const purchaseNature = tableCell(doc, '', 'is-badge-cell');
    purchaseNature.appendChild(badge(doc, 'Variable', 'variable'));
    table.appendChild(purchaseNature);
    const purchasePerimeter = tableCell(doc, '', 'is-badge-cell');
    purchasePerimeter.appendChild(badge(doc, 'Direct', 'direct'));
    table.appendChild(purchasePerimeter);
    table.appendChild(tableCell(doc, '—', 'is-derived'));
    table.appendChild(tableCell(doc, 'Par produit', 'is-derived'));
    table.appendChild(tableCell(doc, '—', 'is-derived'));
    table.appendChild(tableCell(doc, '—', 'is-derived'));

    components.forEach(component => {
      const perimeter = allocationPerimeter(component);
      table.appendChild(tableCell(doc, component.label || component.key));
      const natureCell = tableCell(doc, '', 'is-badge-cell');
      natureCell.appendChild(badge(doc, 'Variable', 'variable'));
      table.appendChild(natureCell);
      const perimeterCell = tableCell(doc, '', 'is-badge-cell');
      perimeterCell.appendChild(badge(doc, perimeter === 'mutualized' ? 'Mutualisé' : 'Direct', perimeter === 'mutualized' ? 'mutualized' : 'direct'));
      table.appendChild(perimeterCell);
      table.appendChild(tableCell(doc, allocationLabel(component.allocation_method), 'is-derived'));
      table.appendChild(tableCell(doc, componentValue(component), 'is-derived'));
      const provenance = component.inherited === false ? 'Surcharge pays' : component.inherited === true ? 'Global hérité' : '—';
      // L4/Q6 : un frais de paiement hérité du global n'est pas réputé applicable au marché tant que sa configuration n'est pas vérifiée.
      const paymentNotVerified = component.inherited === true && component.category === 'payment';
      const origin = tableCell(doc, paymentNotVerified ? `${provenance} · Applicabilité non vérifiée pour ce marché` : provenance, 'is-derived');
      if (component.base_default_value != null) origin.appendChild(el(doc, 'small', 'kmc-economic-global-value', `Base globale : ${componentValue(component, true)} · lecture seule`));
      table.appendChild(origin);
      table.appendChild(tableCell(doc, variableMarketShare(component), 'is-derived'));
    });

    const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
    totalRow.appendChild(tableCell(doc, 'Coût variable complet (ex. moyen)', 'is-total-label'));
    // Une somme de composantes hétérogènes (% / commande / poids / valeur)
    // serait économiquement fausse. Le total exact reste calculé par SKU dans
    // le portefeuille, comme dans le mock.
    totalRow.appendChild(tableCell(doc, 'Calculé par produit', 'is-total-value is-textual'));
    table.appendChild(totalRow);
    // No second detail table: the compact list is the sole view.
    return card;
  }

  function fixedDirectCard(doc, structure, canManage) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-direct');
    card.dataset.costSummary = 'fixed-direct';
    card.appendChild(costCardHeader(doc, '🏠', 'Charges fixes directes', 'Ajustements tracés par période et justificatif.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-direct');
    table.appendChild(tableCell(doc, 'Élément', 'is-head'));
    table.appendChild(tableCell(doc, 'Montant / mois', 'is-head'));
    const rows = Array.isArray(structure?.evidence)
      ? structure.evidence.filter(item => item.scope_kind === 'MARKET_DIRECT')
      : [];
    const directValid = rows.length > 0 && rows.every(item => finite(item.recognized_amount_kmf) != null);
    const directTotal = directValid ? rows.reduce((sum, item) => sum + Number(item.recognized_amount_kmf), 0) : null;
    const directPreview = rows.map(item => ({
      label: item.charge_name || item.charge_family || 'Charge structurelle',
      value: formatKmf(item.recognized_amount_kmf),
      chargeId: canManage ? item.charge_id : null,
      structureScope: 'fixed-direct',
      note: item.charge_description || null,
      descriptionChargeId: canManage && item.reference_is_market_owned ? item.charge_id : null,
      readOnly: !canManage || !item.charge_id,
      readOnlyHint: !canManage
        ? 'L’enregistrement des charges de période nécessite la permission structure.event.record.'
        : 'Référence de charge manquante : aucun événement ne peut être enregistré.',
    }));
    card.appendChild(economicPreview(doc, directPreview,
      directValid ? `Total direct : ${formatKmf(directTotal)}` : 'Total à confirmer pour la période'));
    if (canManage) {
      const add = el(doc,'button','kmc-inline-add-fixed','+ Ajouter une charge fixe');
      add.type='button'; add.dataset.addFixedDirect='';
      card.appendChild(add);
    }
    rows.forEach(item => {
      table.appendChild(tableCell(doc, item.charge_name || item.charge_family || 'Charge structurelle'));
      table.appendChild(tableCell(doc, formatKmf(item.recognized_amount_kmf), 'is-derived is-number'));
    });
    if (!rows.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
    else {
      const totalDirect = rows.reduce((sum, item) => sum + (Number(item.recognized_amount_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
      totalRow.appendChild(tableCell(doc, 'Total fixes directes', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalDirect), 'is-total-value'));
      table.appendChild(totalRow);
    }
    // No second detail table: the compact list is the sole view.
    return card;
  }

  function fixedMutualizedCard(doc, structure, marketLabel, canManageGroup = false) {
    const card = el(doc, 'section', `kmc-cockpit-cost-card is-fixed-mutualized${canManageGroup ? '' : ' is-readonly'}`);
    card.dataset.costSummary = 'fixed-mutualized';
    card.dataset.readOnly = String(!canManageGroup);
    card.setAttribute('aria-label', canManageGroup
      ? 'Charges fixes mutualisées · modification globale autorisée avec justificatif'
      : 'Charges fixes mutualisées · lecture seule sur ce marché');
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-mutualized');
    ['Élément', 'Coût global', 'Clé d’allocation', '%', `Quote-part ${marketLabel}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    const charges = Array.isArray(structure?.allocation?.charges) ? structure.allocation.charges : [];
    const mutualValid = charges.length > 0 && charges.every(charge => finite(charge.market_share_kmf) != null);
    const mutualTotal = mutualValid ? charges.reduce((sum, charge) => sum + Number(charge.market_share_kmf), 0) : null;
    const mutualPreview = charges.map(charge => ({
      label: charge.charge_name || charge.charge_family || 'Charge mutualisée',
      value: formatKmf(charge.market_share_kmf),
      chargeId: canManageGroup ? charge.charge_id : null,
      structureScope: 'fixed-mutualized',
      readOnly: !canManageGroup || !charge.charge_id,
      readOnlyHint: !canManageGroup
        ? 'La charge globale est gérée par un administrateur habilité ; la quote-part marché reste calculée.'
        : 'Référence de charge manquante : aucun événement ne peut être enregistré.',
      note: `Quote-part ${charge.market_allocation_ratio == null ? 'non précisée' : `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %`} · ${charge.policy?.basis_kind || 'Politique à confirmer'}`,
    }));
    card.appendChild(economicPreview(doc, mutualPreview,
      mutualValid ? `Quote-part marché : ${formatKmf(mutualTotal)}` : 'Quote-part marché à confirmer'));
    charges.slice(0, 6).forEach(charge => {
      table.appendChild(tableCell(doc, charge.charge_name || charge.charge_family || 'Charge mutualisée'));
      table.appendChild(tableCell(doc, formatKmf(charge.group_pool_kmf), 'is-derived'));
      const policy = charge.policy;
      table.appendChild(tableCell(doc, policy ? (policy.basis_kind || '—') : 'Politique manquante', 'is-derived'));
      const ratioText = charge.market_allocation_ratio != null ? `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %` : '—';
      table.appendChild(tableCell(doc, ratioText, 'is-derived'));
      const shareText = charge.market_share_kmf == null ? '—' : formatKmf(charge.market_share_kmf);
      table.appendChild(tableCell(doc, shareText, `is-derived ${charge.market_share_kmf == null ? '' : 'is-market-share'}`.trim()));
    });
    if (!charges.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
    if (charges.length) {
      const totalMut = charges.reduce((sum, c) => sum + (Number(c.market_share_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row is-mutualized');
      totalRow.appendChild(tableCell(doc, 'Total fixes mutualisées (imputé au marché)', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalMut), 'is-total-value'));
      table.appendChild(totalRow);
    }
    // No second detail table: the compact list is the sole view.
    return card;
  }

  function principleCard(doc, marketCode) {
    const card = el(doc, 'details', 'kmc-cockpit-principle kmc-economic-principles-detail');
    const head = el(doc, 'summary', 'kmc-cockpit-principle-head');
    head.appendChild(el(doc, 'span', 'kmc-cockpit-cost-icon', '💡'));
    head.appendChild(el(doc, 'strong', '', 'Voir les règles de répartition (détail)'));
    card.appendChild(head);
    const list = doc.createElement('ul');
    [
      'Le prix est borné par le marché.',
      'Les coûts variables déterminent l’espace de contribution.',
      'Les charges fixes sont couvertes collectivement par le portefeuille.',
      `Toute quote-part mutualisée est calculée par Market ID.`,
      'Les charges mutualisées peuvent aussi être variables (ex. fret, SAV).',
    ].forEach(text => {
      const item = doc.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    card.appendChild(list);
    // Pas de lien vers /admin/docs/pricing-doctrine : aucune route réelle ne le sert.
    // Garder la doctrine affichée dans cette carte plutôt qu'un cul-de-sac 404.
    return card;
  }

  const COST_FAMILIES = [
    ['variable', 'Coûts variables'],
    ['fixed-direct', 'Charges fixes directes'],
    ['fixed-mutualized', 'Charges fixes mutualisées'],
  ];

  // Une contribution par vente, une couverture collective par période.
  // Aucun pourcentage synthétique n'est construit à partir d'unités hétérogènes.
  function costReading(doc, decision) {
    const mix = decision?.coverage?.cost_mix;
    // No arithmetic from mixed units in the browser: the four shares must
    // arrive as a complete, reconciled, server-authored projection.
    const percentages = ['variable_pct', 'fixed_pct', 'direct_pct', 'mutualized_pct'];
    const ready = mix?.status === 'READY' && mix?.basis === 'RECONCILED_MARKET_PERIOD'
      && Boolean(mix.period?.from && mix.period?.to)
      && percentages.every(key => mix[key] !== null && mix[key] !== undefined
        && Number.isFinite(Number(mix[key])) && Number(mix[key]) >= 0 && Number(mix[key]) <= 100);
    const percent = value => `${formatNumber(value, 1)} %`;
    const section = el(doc, 'section', 'kmc-economic-reading');
    section.dataset.economicCostReading = '';
    section.setAttribute('aria-label', 'Comment lire les coûts et la contribution');
    const introduction = el(doc, 'div', 'kmc-economic-reading-heading');
    introduction.appendChild(el(doc, 'span', 'kmc-economic-reading-eyebrow', 'LOGIQUE ÉCONOMIQUE'));
    introduction.appendChild(el(doc, 'strong', '', 'Le produit contribue. Le portefeuille couvre.'));
    introduction.appendChild(el(doc, 'p', '', 'On mesure ce que chaque vente apporte, puis on compare les contributions réconciliées aux charges fixes de la même période.'));
    section.appendChild(introduction);
    const grid = el(doc, 'div', 'kmc-economic-reading-grid');
    [
      { icon: '↗', tone: 'variable', title: 'Contribution par vente', value: 'Prix − coûts variables (N1 + N2)', detail: 'Estimée avant vente ; réconciliée après achat, expédition, douane et livraison.' },
      { icon: '◈', tone: 'fixed', title: 'Structure à couvrir (N3)', value: 'Fixes directs + fixes mutualisés', detail: 'Charges de période couvertes collectivement, jamais une dette automatique par SKU.' },
      { icon: '%', tone: 'mix', title: 'Part des coûts totaux',
        value: ready ? `Variables ${percent(mix.variable_pct)} · Fixes ${percent(mix.fixed_pct)}` : 'Non encore calculable',
        detail: ready ? `Second axe — Directs ${percent(mix.direct_pct)} · Mutualisés ${percent(mix.mutualized_pct)}. Même période réconciliée.`
          : 'Les proportions exigent une même période, des unités compatibles et des données suffisamment réconciliées.' },
    ].forEach(item => {
      const card = el(doc, 'article', `kmc-economic-reading-item is-${item.tone}`);
      card.appendChild(el(doc, 'span', 'kmc-economic-reading-icon', item.icon));
      const copy = el(doc, 'div', 'kmc-economic-reading-copy');
      copy.appendChild(el(doc, 'span', 'kmc-economic-reading-label', item.title));
      copy.appendChild(el(doc, 'strong', 'kmc-economic-reading-value', item.value));
      copy.appendChild(el(doc, 'small', '', item.detail));
      if (item.tone === 'mix' && ready) {
        const track = el(doc, 'div', 'kmc-economic-reading-mix-track');
        track.setAttribute('role', 'img');
        track.setAttribute('aria-label', `Coûts variables ${percent(mix.variable_pct)}, charges fixes ${percent(mix.fixed_pct)}`);
        const variable = el(doc, 'span', 'kmc-economic-reading-mix-variable');
        variable.style.width = `${Number(mix.variable_pct)}%`;
        const fixed = el(doc, 'span', 'kmc-economic-reading-mix-fixed');
        fixed.style.width = `${Number(mix.fixed_pct)}%`;
        track.appendChild(variable);
        track.appendChild(fixed);
        copy.appendChild(track);
      }
      card.appendChild(copy);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    section.appendChild(el(doc, 'p', 'kmc-economic-reading-foot', 'Variable ou fixe décrit la nature ; direct ou mutualisé décrit la répartition. Un même coût n’est compté qu’une fois.'));
    return section;
  }

  function createCostPilotage(doc, payload, marketCode, decision, user, activeFamily) {
    const groups = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []);
    const structure = decision?.coverage?.structure || null;
    const marketLabel = payload.scope?.market_name || marketCode;
    const section = el(doc, 'section', 'kmc-cockpit-costs');
    section.dataset.atelierViews = 'costs';
    section.appendChild(el(doc, 'p', 'kmc-economic-cost-intro',
      `Coûts et paramètres · ${marketLabel}. Les valeurs héritées et les charges propres au marché sont indiquées séparément. Les montants conservent leur unité de calcul.`));
    const canEditVariables = payload.capabilities?.cost_overrides === true || payload.capabilities?.can_manage_costs === true;
    const canEditStructure = payload.capabilities?.can_manage_structure_events === true;
    const canManageGroup = payload.access?.role === 'global_admin'
      && user?.role === 'admin';
    const cards = [variableCostCard(doc, groups.variable, canEditVariables),
      fixedDirectCard(doc, structure, canEditStructure),
      fixedMutualizedCard(doc, structure, marketLabel, canManageGroup)];
    section.dataset.costLayout = 'columns';
    const centers = globalThis.KomercePricingWorkshopPresentation;
    if (centers && typeof centers.createCostCenters === 'function') {
      section.appendChild(centers.createCostCenters(doc, payload.cost_components || []));
    }
    section.appendChild(costReading(doc, decision));
    const families = el(doc, 'div', 'kmc-economic-family-grid');
    cards.forEach(card => families.appendChild(card));
    section.appendChild(families);
    section.appendChild(principleCard(doc, marketCode));
    return section;
  }

  function corridorAmount(point, currency) {
    if (!point) return '—';
    return formatMoney(point.observed_amount, point.currency || currency);
  }

  function selectedAmount(corridor) {
    const selected = corridor?.selected || {};
    if (selected.local_amount != null) return formatMoney(selected.local_amount, selected.local_currency || corridor?.market?.currency);
    // L4 : aucun repli sur price_kmf (un prix KMF n'est pas le prix décidé du marché).
    return 'Non décidé';
  }

  function createPortfolioShell(doc, payload) {
    const section = el(doc, 'section', 'kmc-cockpit-portfolio');
    section.dataset.cockpitPortfolio = '';
    const head = el(doc, 'div', 'kmc-cockpit-portfolio-head');
    head.appendChild(el(doc, 'h3', '', 'Portefeuille produits'));
    const headActions = el(doc, 'div', 'kmc-cockpit-portfolio-head-actions');
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un produit…';
    search.dataset.cockpitSearch = '';
    headActions.appendChild(search);
    head.appendChild(headActions);
    section.appendChild(head);

    const tabs = el(doc, 'div', 'kmc-cockpit-tabs');
    tabs.dataset.cockpitTabs = '';
    const products = Array.isArray(payload.simulation_products) ? payload.simulation_products : [];
    const counts = new Map();
    products.forEach(product => counts.set(product.category || 'Autres', (counts.get(product.category || 'Autres') || 0) + 1));
    [...counts.entries()].forEach(([category, count], index) => {
      const button = el(doc, 'button', `kmc-cockpit-tab${index === 0 ? ' is-active' : ''}`, `${categoryLabel(category)} (${count})`);
      button.type = 'button';
      button.dataset.cockpitCategory = category;
      tabs.appendChild(button);
    });
    section.appendChild(tabs);

    const table = el(doc, 'div', 'kmc-cockpit-portfolio-table');
    table.dataset.cockpitPortfolioTable = '';
    section.appendChild(table);
    const detail = el(doc, 'div', 'kmc-cockpit-product-detail');
    detail.dataset.cockpitProductDetail = '';
    detail.appendChild(el(doc, 'div', 'kmc-cockpit-loading', 'Sélectionnez un produit pour lire sa décision économique.'));
    section.appendChild(detail);
    section.__products = products;
    section.__corridors = new Map();
    section.__activeCategory = counts.size ? [...counts.keys()][0] : null;
    return section;
  }

  function portfolioHeader(doc) {
    const headers = [
      // L4 : l'unité est portée par chaque valeur (KMF moteur, devise du marché pour bornes et prix) : aucun en-tête n'en impose une.
      'SKU', 'Coût d\u2019achat', 'Coûts variables\nhors achat', 'Coût variable\ncomplet',
      'Borne marché\nBasse', 'Cible', 'Haute',
      'Prix retenu', 'Contribution\nunitaire', 'Qté vendue', 'Contribution totale', '',
    ];
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-head');
    headers.forEach(label => row.appendChild(tableCell(doc, label)));
    return row;
  }

  function portfolioLoadingRow(doc, product) {
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-loading');
    row.dataset.productRef = product.product_ref;
    row.appendChild(tableCell(doc, product.name || product.product_ref));
    for (let i = 0; i < 10; i += 1) row.appendChild(tableCell(doc, '…', 'is-derived'));
    row.appendChild(tableCell(doc, ''));
    return row;
  }

  function portfolioProductRow(doc, product, corridor) {
    const row = el(doc, 'div', 'kmc-cockpit-product-row');
    row.dataset.productRef = product.product_ref;
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    row.appendChild(tableCell(doc, product.name || corridor?.product?.name || product.product_ref, 'is-product'));
    row.appendChild(tableCell(doc, formatKmf(corridor?.product?.purchase_cost_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, formatKmf(economics.variable_cost_outside_purchase_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, formatKmf(economics.variable_cost_complete_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.low, currency), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.target, currency), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.high, currency), 'is-derived'));
    const priceCell = tableCell(doc, '', 'is-price-decision');
    const priceButton = el(doc, 'button', 'kmc-cockpit-price-button', `${selectedAmount(corridor)}  \u25be`);
    priceButton.type = 'button';
    priceButton.dataset.cockpitSelectProduct = product.product_ref;
    priceCell.appendChild(priceButton);
    row.appendChild(priceCell);
    const contribution = finite(economics.contribution_unit_kmf);
    const tone = contribution == null ? '' : contribution < 0 ? ' is-negative' : contribution === 0 ? ' is-zero' : '';
    row.appendChild(tableCell(doc, formatKmf(economics.contribution_unit_kmf), `is-derived is-contribution${tone}`));
    const qtySold = finite(economics.quantity_sold) ?? finite(product.quantity_sold);
    row.appendChild(tableCell(doc, qtySold == null ? '\u2014' : formatNumber(qtySold), 'is-derived'));
    // L4 : la contribution totale du portefeuille est servie par le serveur (E5) ; aucun calcul côté navigateur.
    const contribTotal = finite(economics.contribution_total_kmf) != null ? formatKmf(economics.contribution_total_kmf) : '\u2014';
    row.appendChild(tableCell(doc, contribTotal, 'is-derived is-contribution'));
    const menu = el(doc, 'button', 'kmc-cockpit-row-menu', '\u22ef');
    menu.type = 'button';
    menu.dataset.cockpitRowMenu = product.product_ref;
    row.appendChild(tableCell(doc, ''));
    row.lastChild.appendChild(menu);
    return row;
  }

  async function fetchCorridor(workspace, options, productRef) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    return workspace.jsonRequest(options.fetch, `${endpoint}/corridor?product_ref=${encodeURIComponent(productRef)}`);
  }

  async function fetchDecision(workspace, options, period) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    return workspace.jsonRequest(options.fetch, `${endpoint}/decision${qs}`);
  }

  function detailMetric(doc, label, value, editable = false) {
    const row = el(doc, 'div', `kmc-cockpit-detail-metric${editable ? ' is-editable' : ' is-derived'}`);
    row.appendChild(el(doc, 'span', '', label));
    row.appendChild(el(doc, 'strong', '', value));
    return row;
  }

  function sensitivityCard(doc, corridor) {
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-sensitivity');
    card.appendChild(el(doc, 'h4', '', 'Sensibilité prix'));
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const selectedContrib = finite(corridor?.selected?.economics?.contribution_unit_kmf);
    const points = [
      ['Basse', local.low], ['Cible', local.target], ['Haute', local.high],
    ];

    const table = el(doc, 'div', 'kmc-cockpit-sensitivity-table');
    const headerRow = el(doc, 'div', 'is-head');
    headerRow.appendChild(el(doc, 'span', '', 'Prix de vente'));
    headerRow.appendChild(el(doc, 'span', '', 'Contribution unitaire'));
    headerRow.appendChild(el(doc, 'span', '', 'Écart vs. actuel'));
    table.appendChild(headerRow);

    points.forEach(([label, point]) => {
      const price = finite(point?.observed_amount);
      const contrib = finite(point?.economics?.contribution_unit_kmf);
      const row = el(doc, 'div', '');
      row.appendChild(el(doc, 'strong', '', price != null ? formatKmf(price) : '—'));
      row.appendChild(el(doc, 'strong', 'is-positive', contrib != null ? formatKmf(contrib) : '—'));
      let ecartText = '—';
      let ecartCls = '';
      if (contrib != null && selectedContrib != null) {
        const diff = contrib - selectedContrib;
        ecartText = (diff >= 0 ? '+' : '') + formatKmf(diff);
        ecartCls = diff >= 0 ? 'is-positive' : 'is-negative';
      }
      row.appendChild(el(doc, 'span', ecartCls, ecartText));
      table.appendChild(row);
    });
    card.appendChild(table);
    card.appendChild(el(doc, 'p', 'kmc-cockpit-detail-note', 'Le prix marché retenu est le levier de décision sur cette page. La contribution varie en fonction du prix.'));
    return card;
  }

  function marketDataCard(doc, corridor) {
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-market');
    const cardTitle = el(doc, 'h4', 'kmc-cockpit-detail-card-title');
    cardTitle.appendChild(el(doc, 'span', 'kmc-cockpit-detail-card-icon is-blue', '📊'));
    cardTitle.appendChild(el(doc, 'span', '', 'Données marché'));
    card.appendChild(cardTitle);
    const local = corridor?.corridor?.local || {};
    const global = corridor?.corridor?.global_reference || {};
    const currency = corridor?.market?.currency || 'KMF';
    const localHead = el(doc, 'div', 'kmc-cockpit-market-head');
    const localIdentity = el(doc, 'strong', 'kmc-cockpit-market-identity');
    const flag = marketFlagEmoji(corridor?.market?.code);
    localIdentity.textContent = `${flag ? `${flag} ` : ''}${corridor?.market?.name || corridor?.market?.code || 'Marché'} (observé)`;
    localHead.appendChild(localIdentity);
    localHead.appendChild(badge(doc, local.sample_count ? 'Observé' : 'À alimenter', local.sample_count ? 'observed' : 'warning'));
    card.appendChild(localHead);
    card.appendChild(detailMetric(doc, 'Prix moyen observé', corridorAmount(local.target, currency)));
    card.appendChild(detailMetric(doc, 'Nb. observations', formatNumber(local.sample_count)));
    card.appendChild(detailMetric(doc, 'Dernière mise à jour', formatDate(local.observations?.[0]?.observed_at)));
    const globalBlock = el(doc, 'div', 'kmc-cockpit-global-reference');
    const globalTitle = el(doc, 'strong', 'kmc-cockpit-global-reference-title');
    globalTitle.appendChild(el(doc, 'span', 'kmc-cockpit-detail-card-icon is-blue', '🌐'));
    globalTitle.appendChild(el(doc, 'span', '', 'Référence globale (informative)'));
    globalBlock.appendChild(globalTitle);
    globalBlock.appendChild(detailMetric(doc, 'Prix moyen global', corridorAmount(global.target, 'KMF')));
    globalBlock.appendChild(el(doc, 'small', '', 'Non utilisée comme vérité locale.'));
    card.appendChild(globalBlock);
    return card;
  }

  function productDecisionCard(doc, corridor, canManage) {
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-product-decision');
    card.appendChild(el(doc, 'h4', '', 'Détail d’un produit'));

    const body = el(doc, 'div', 'kmc-cockpit-product-detail-body');
    const identity = el(doc, 'div', 'kmc-cockpit-product-identity');
    const imageUrl = corridor?.product?.image_url || corridor?.product?.thumbnail_url;
    if (imageUrl) {
      const img = doc.createElement('img');
      img.className = 'kmc-cockpit-product-image';
      img.src = imageUrl;
      img.alt = corridor?.product?.name || '';
      img.loading = 'lazy';
      identity.appendChild(img);
    } else {
      identity.appendChild(el(doc, 'div', 'kmc-cockpit-product-image-placeholder', '📦'));
    }
    const identityCopy = el(doc, 'div', 'kmc-cockpit-product-identity-copy');
    identityCopy.appendChild(el(doc, 'strong', '', corridor?.product?.name || corridor?.product?.product_ref || 'Produit'));
    identityCopy.appendChild(el(doc, 'small', '', `SKU : ${corridor?.product?.product_ref || ''}`));
    identityCopy.appendChild(el(doc, 'small', '', `Catégorie : ${categoryLabel(corridor?.product?.category)}`));
    const viewLink = el(doc, 'a', 'kmc-cockpit-product-link', 'Voir la fiche complète ↗');
    viewLink.href = `/admin/products/${encodeURIComponent(corridor?.product?.product_ref || '')}`;
    viewLink.target = '_blank';
    identityCopy.appendChild(viewLink);
    identity.appendChild(identityCopy);
    body.appendChild(identity);

    const metrics = el(doc, 'div', 'kmc-cockpit-detail-metrics');
    metrics.appendChild(detailMetric(doc, 'Coût d’achat', formatKmf(corridor?.product?.purchase_cost_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coûts variables hors achat', formatKmf(economics.variable_cost_outside_purchase_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf)));
    metrics.appendChild(detailMetric(doc, 'Borne marché basse', corridorAmount(local.low, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché cible', corridorAmount(local.target, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché haute', corridorAmount(local.high, currency)));

    const priceRow = el(doc, 'div', 'kmc-cockpit-detail-metric is-editable is-price-row');
    priceRow.appendChild(el(doc, 'span', '', 'Prix retenu'));
    if (canManage) {
      const form = doc.createElement('form');
      form.dataset.cockpitPriceForm = corridor?.product?.product_ref || '';
      form.className = 'kmc-cockpit-final-price-form is-inline';
      const input = doc.createElement('input');
      input.type = 'number';
      input.name = 'amount';
      input.min = '0.01';
      input.step = '0.01';
      input.required = true;
      input.value = corridor?.selected?.local_amount != null ? corridor.selected.local_amount : '';
      input.placeholder = `Prix ${currency}`;
      input.dataset.finalMarketPrice = '';
      input.dataset.originalValue = input.value;
      form.appendChild(input);
      priceRow.appendChild(form);
    } else {
      priceRow.appendChild(el(doc, 'strong', 'kmc-cockpit-readonly-price', selectedAmount(corridor)));
    }
    metrics.appendChild(priceRow);
    metrics.appendChild(detailMetric(doc, 'Contribution unitaire', formatKmf(economics.contribution_unit_kmf)));
    body.appendChild(metrics);
    card.appendChild(body);
    return card;
  }

  function renderProductDetail(doc, portfolio, corridor, canManage, reveal) {
    const detail = portfolio.querySelector('[data-cockpit-product-detail]');
    if (!detail) return;
    // Panneau secondaire : fermé par défaut, ouvert si l'opérateur l'a ouvert ou agit sur un produit.
    const previous = detail.querySelector('details.kmc-cockpit-secondary');
    const wasOpen = Boolean(reveal) || Boolean(previous && previous.open);
    detail.replaceChildren();
    const panel = el(doc, 'details', 'kmc-cockpit-secondary');
    panel.open = wasOpen;
    panel.appendChild(el(doc, 'summary', '', 'Détail produit, sensibilité et données de marché'));
    const grid = el(doc, 'div', 'kmc-cockpit-detail-grid');
    grid.appendChild(productDecisionCard(doc, corridor, canManage));
    grid.appendChild(sensitivityCard(doc, corridor));
    grid.appendChild(marketDataCard(doc, corridor));
    panel.appendChild(grid);
    detail.appendChild(panel);
    portfolio.__selectedProductRef = corridor?.product?.product_ref || null;
  }

  async function loadCategory(doc, workspace, options, payload, portfolio, category) {
    const table = portfolio.querySelector('[data-cockpit-portfolio-table]');
    if (!table) return;
    portfolio.__activeCategory = category;
    const searchValue = String(portfolio.querySelector('[data-cockpit-search]')?.value || '').trim().toLowerCase();
    const effectiveLimit = portfolio.__categoryLimitOverride || MAX_CATEGORY_ROWS;
    const products = (portfolio.__products || [])
      .filter(product => (product.category || 'Autres') === category)
      .filter(product => !searchValue || `${product.name || ''} ${product.product_ref || ''}`.toLowerCase().includes(searchValue))
      .slice(0, effectiveLimit);
    table.replaceChildren(portfolioHeader(doc));
    products.forEach(product => table.appendChild(portfolioLoadingRow(doc, product)));
    if (!products.length) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucun produit dans cette catégorie.'));
      return;
    }

    const results = await Promise.all(products.map(async product => {
      try {
        const corridor = portfolio.__corridors.get(product.product_ref) || await fetchCorridor(workspace, options, product.product_ref);
        portfolio.__corridors.set(product.product_ref, corridor);
        return { product, corridor };
      } catch (error) {
        return { product, error };
      }
    }));

    results.forEach(result => {
      const current = table.querySelector(`[data-product-ref="${result.product.product_ref}"]`);
      if (!current) return;
      if (result.corridor) current.replaceWith(portfolioProductRow(doc, result.product, result.corridor));
      else current.replaceChildren(tableCell(doc, result.product.name || result.product.product_ref), tableCell(doc, `Indisponible · ${result.error?.message || 'erreur'}`, 'is-error'));
    });

    // Totals row
    let totalQty = 0, totalContrib = 0;
    results.forEach(r => {
      if (!r.corridor) return;
      const eco = r.corridor?.selected?.economics || {};
      const qty = Number(eco.quantity_sold ?? r.product.quantity_sold ?? 0);
      const unit = Number(eco.contribution_unit_kmf ?? 0);
      totalQty += qty;
      totalContrib += unit * qty;
    });
    const totalsRow = el(doc, 'div', 'kmc-cockpit-product-row is-totals');
    for (let i = 0; i < 9; i++) totalsRow.appendChild(tableCell(doc, ''));
    totalsRow.appendChild(tableCell(doc, formatNumber(totalQty), 'is-total-value'));
    totalsRow.appendChild(tableCell(doc, formatKmf(totalContrib), 'is-total-value'));
    totalsRow.appendChild(tableCell(doc, ''));
    table.appendChild(totalsRow);

    // "Voir tous les produits" link
    const allProducts = (portfolio.__products || []).filter(p => (p.category || 'Autres') === category);
    if (allProducts.length > effectiveLimit) {
      const overflow = el(doc, 'div', 'kmc-cockpit-portfolio-overflow');
      overflow.appendChild(el(doc, 'span', '', `… ${allProducts.length - effectiveLimit} autres produits`));
      const viewAll = el(doc, 'a', 'kmc-cockpit-view-all', 'Voir tous les produits →');
      viewAll.href = '#';
      viewAll.dataset.cockpitViewAll = category;
      overflow.appendChild(viewAll);
      table.appendChild(overflow);
    }

    const first = results.find(result => result.corridor);
    if (first && (!portfolio.__selectedProductRef || !portfolio.__corridors.has(portfolio.__selectedProductRef))) {
      renderProductDetail(doc, portfolio, first.corridor, payload.capabilities?.local_strategy_owner === true);
    }
  }


  function moveEquilibriumIntoCockpit(rootNode, cockpit) {
    const equilibrium = rootNode.querySelector('[data-pricing-flow-equilibrium]');
    if (!equilibrium) return;
    equilibrium.classList.add('kmc-flow-equilibrium-panel--cockpit');
    const label = Array.from(equilibrium.querySelectorAll('.kmc-flow-equilibrium-label')).find(node => node.textContent.trim() === 'Charges à couvrir');
    if (label) label.textContent = 'Charges structurelles à couvrir';
    cockpit.appendChild(equilibrium);
  }

  function styleEquilibriumForCockpit(equilibrium) {
    if (!equilibrium) return equilibrium;
    equilibrium.classList.add('kmc-flow-equilibrium-panel--cockpit');
    const label = Array.from(equilibrium.querySelectorAll('.kmc-flow-equilibrium-label')).find(node => node.textContent.trim() === 'Charges à couvrir');
    if (label) label.textContent = 'Charges structurelles à couvrir';
    return equilibrium;
  }

  function buildCockpitHeader(doc, payload, decision) {
    const header = el(doc, 'div', 'kmc-cockpit-page-header');
    const left = el(doc, 'div', 'kmc-cockpit-page-header-left');
    left.appendChild(el(doc, 'h2', 'kmc-cockpit-page-title', 'Atelier économique'));
    left.appendChild(el(doc, 'p', 'kmc-cockpit-page-subtitle', 'Pilotez votre rentabilité en temps réel. Toute modification est automatiquement recalculée.'));
    header.appendChild(left);

    const right = el(doc, 'div', 'kmc-cockpit-page-header-right');
    const periodWrap = el(doc, 'div', 'kmc-cockpit-period-wrap');
    periodWrap.appendChild(el(doc, 'span', 'kmc-cockpit-period-label', 'Période'));
    const periodSelect = doc.createElement('select');
    periodSelect.className = 'kmc-cockpit-period-select';
    periodSelect.dataset.cockpitPeriod = '';
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);
      const opt = doc.createElement('option');
      opt.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      if (i === 0) opt.selected = true;
      periodSelect.appendChild(opt);
    }
    periodWrap.appendChild(periodSelect);
    right.appendChild(periodWrap);

    const badge = el(doc, 'div', 'kmc-cockpit-live-badge');
    badge.dataset.cockpitLiveBadge = '';
    const decisional = ['COVERED', 'UNCOVERED'].includes(decision?.decision_status)
      && decision?.coverage?.coverage_ratio != null && Number.isFinite(Number(decision.coverage.coverage_ratio));
    badge.classList.toggle('is-unavailable', !decisional);
    badge.appendChild(el(doc, 'strong', '', decisional ? 'Couverture réconciliée' : 'Couverture non décisionnelle'));
    const ts = decision?.evaluated_at;
    const ago = ts && !Number.isNaN(Date.parse(ts))
      ? `Dernière évaluation ${timeSince(new Date(ts))}` : 'Date d’évaluation indisponible';
    const badgeTime = el(doc, 'small', '', ago);
    badgeTime.dataset.cockpitLiveBadgeTime = '';
    badge.appendChild(badgeTime);
    right.appendChild(badge);
    header.appendChild(right);
    return header;
  }

  function timeSince(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'à l\'instant';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `il y a ${hours}h`;
  }

  function buildCockpit(doc, rootNode, payload, marketCode, decision, user) {
    const cockpit = el(doc, 'div', 'kmc-economic-cockpit');
    cockpit.dataset[COCKPIT_ATTR] = '';
    cockpit.appendChild(buildCockpitHeader(doc, payload, decision));
    moveEquilibriumIntoCockpit(rootNode, cockpit);
    cockpit.appendChild(createCostPilotage(doc, payload, marketCode, decision, user));
    cockpit.appendChild(createPortfolioShell(doc, payload));
    cockpit.appendChild(buildCockpitFooter(doc));
    return cockpit;
  }

  function buildCockpitFooter(doc) {
    const footer = el(doc, 'div', 'kmc-cockpit-footer');
    const info = el(doc, 'div', 'kmc-cockpit-footer-info');
    info.appendChild(el(doc, 'span', 'kmc-cockpit-footer-info-icon', 'ⓘ'));
    const note = el(doc, 'span', '', 'Les ajustements sont enregistrés automatiquement. Les valeurs grisées sont calculées par le moteur ; le prix final marché est le levier de décision.');
    note.dataset.cockpitFooterNote = '';
    info.appendChild(note);
    footer.appendChild(info);
    return footer;
  }

  // Ouvre le formulaire séparé pour un ajustement de charge structurelle
  // (N3) — jamais un champ inline dans l'Atelier économique. 'fixed-direct'
  // reste scopé au marché courant (manager du marché ou admin) ; le pool
  // 'fixed-mutualized' (GROUP) est admin only, il affecte tous les marchés.
  async function openStructureEventForm(rootObject, doc, workspace, options, detailKey, chargeId = null, inlineOptions = null) {
    const panelApi = rootObject && rootObject.KomerceCanonicalStructureEventPanel;
    if (!panelApi || typeof panelApi.open !== 'function') return;

    const isMutualized = detailKey === 'fixed-mutualized';
    const isAdmin = (options.user && options.user.role) === 'admin';
    if (isMutualized && !isAdmin) return; // bouton désactivé côté serveur de vérité — défense en profondeur

    const marketEndpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    const globalEndpoint = workspace.endpointFor({});
    const basePath = isMutualized ? globalEndpoint : marketEndpoint;

    await panelApi.open({
      document: doc,
      fetch: options.fetch,
      title: isMutualized ? 'Gérer les mutualisations' : 'Ajuster les charges fixes directes',
      subtitle: isMutualized
        ? 'Pool partagé entre marchés — l’ajustement s’applique à la quote-part de tous les marchés.'
        : `Charges propres au marché ${options.requestedMarket || ''}.`.trim(),
      chargesEndpoint: `${marketEndpoint}/charges`,
      eventsEndpoint: `${basePath}/structure-events`,
      submitEndpoint: `${basePath}/structure-events`,
      initialChargeId: chargeId,
      inline: Boolean(inlineOptions?.inlineContainer),
      container: inlineOptions?.inlineContainer || options.root,
      previousValue: inlineOptions?.previousValue || null,
      previousLabel: isMutualized ? 'Quote-part actuelle du marché' : 'Montant déjà enregistré',
      createChargeEndpoint: inlineOptions?.allowCreateMarketDirect && !isMutualized
        ? `${marketEndpoint}/structure-charges` : null,
      onClose: () => {
        if (typeof inlineOptions?.onClose === 'function') inlineOptions.onClose();
        const row = inlineOptions?.inlineContainer;
        const edit = row?.querySelector('[data-edit-structure-charge]');
        if (edit) { edit.hidden = false; }
      },
      onSaved: async () => {
        if (typeof rootObject.KomerceCanonicalPricingWorkspace?.mount === 'function') {
          await rootObject.KomerceCanonicalPricingWorkspace.mount({ ...options, refreshEconomicCockpit: true });
        }
      },
    });
  }


  async function openVariableCostPanel(rootObject, doc, workspace, options, payload) {
    const components = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []).variable
      .filter(component => component && component.key);
    const overlay = el(doc, 'div', 'kmc-structure-panel-overlay');
    overlay.dataset.variableCostPanel = '';
    const panel = el(doc, 'div', 'kmc-structure-panel kmc-variable-cost-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);

    const header = el(doc, 'div', 'kmc-structure-panel-header');
    const titles = el(doc, 'div', '');
    titles.appendChild(el(doc, 'h2', 'kmc-structure-panel-title', 'Ajuster les coûts variables'));
    titles.appendChild(el(doc, 'p', 'kmc-structure-panel-subtitle', `Valeurs effectives du marché ${options.requestedMarket || ''}. Le moteur recalcule ensuite automatiquement la contribution.`.trim()));
    header.appendChild(titles);
    const close = el(doc, 'button', 'kmc-structure-panel-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer');
    header.appendChild(close);
    panel.appendChild(header);

    const body = el(doc, 'div', 'kmc-structure-panel-body');
    const form = doc.createElement('form');
    form.className = 'kmc-variable-cost-panel-form';
    const error = el(doc, 'div', 'kmc-structure-panel-error');
    error.hidden = true;
    form.appendChild(error);

    if (!components.length) form.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucun coût variable actif à ajuster.'));

    components.forEach(component => {
      const row = el(doc, 'div', 'kmc-variable-cost-panel-row');
      const identity = el(doc, 'div', 'kmc-variable-cost-panel-identity');
      identity.appendChild(el(doc, 'small', '', `${allocationPerimeter(component) === 'mutualized' ? 'Mutualisé' : 'Direct'} · ${allocationLabel(component.allocation_method)}`));
      const editableIdentity = allocationPerimeter(component) !== 'mutualized';
      if (editableIdentity) {
        const labelEditor = doc.createElement('input');
        labelEditor.type = 'text';
        labelEditor.maxLength = 160;
        labelEditor.value = component.label || component.key;
        labelEditor.dataset.originalValue = labelEditor.value;
        labelEditor.dataset.variableCostLabel = component.key;
        labelEditor.setAttribute('aria-label', 'Libellé de ' + component.key);
        identity.appendChild(labelEditor);
        const descriptionEditor = doc.createElement('textarea');
        descriptionEditor.rows = 2;
        descriptionEditor.maxLength = 500;
        descriptionEditor.placeholder = 'Description courte du coût';
        descriptionEditor.value = component.description || '';
        descriptionEditor.dataset.originalValue = descriptionEditor.value;
        descriptionEditor.dataset.variableCostDescription = component.key;
        descriptionEditor.setAttribute('aria-label', 'Description de ' + component.key);
        identity.appendChild(descriptionEditor);
        identity.appendChild(el(doc, 'small', '', 'Libellé et description propres au marché : modification enregistrée automatiquement.'));
      } else {
        identity.appendChild(el(doc, 'strong', '', component.label || component.key));
        identity.appendChild(el(doc, 'small', '', 'Référence mutualisée en lecture seule ; modifiable au niveau global.'));
      }
      row.appendChild(identity);
      const control = el(doc, 'div', 'kmc-variable-cost-panel-control');
      const input = doc.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = component.default_value != null && Number.isFinite(Number(component.default_value)) ? String(component.default_value) : '';
      input.min = '0';
      input.required = true;
      input.dataset.originalValue = input.value;
      input.dataset.variableCostInput = component.key;
      input.setAttribute('aria-label', `Valeur de ${component.label || component.key}`);
      control.appendChild(input);
      control.appendChild(el(doc, 'span', '', unitLabel(component.unit) || component.unit || 'KMF'));
      const autosaveStatus = el(doc, 'small', 'kmc-autosave-status', '');
      autosaveStatus.dataset.autosaveStatus = '';
      autosaveStatus.setAttribute('aria-live', 'polite');
      control.appendChild(autosaveStatus);
      row.appendChild(control);
      form.appendChild(row);
    });
    body.appendChild(form);
    panel.appendChild(body);

    const footer = el(doc, 'div', 'kmc-structure-panel-footer');
    const cancel = el(doc, 'button', 'kmc-cockpit-outline-action', 'Annuler');
    cancel.type = 'button';
    const save = el(doc, 'button', 'kmc-cockpit-footer-save', 'Terminé');
    save.type = 'button';
    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(footer);

    function closePanel() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    close.addEventListener('click', closePanel);
    cancel.addEventListener('click', closePanel);
    overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });

    // Enregistrement automatique : chaque valeur validée (sortie du champ / Entrée) est écrite immédiatement.
    // Une valeur vide ou négative n'est jamais enregistrée (NULL ≠ 0) et l'erreur reste affichée.
    let autosaving = Promise.resolve();
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('change', event => {
      const input = event.target.closest('[data-variable-cost-label], [data-variable-cost-description]');
      if (!input || input.value === input.dataset.originalValue) return;
      const key = input.dataset.variableCostLabel || input.dataset.variableCostDescription;
      const property = input.dataset.variableCostLabel ? 'label' : 'description';
      if (property === 'label' && !input.value.trim()) {
        error.textContent = 'Le libellé ne peut pas être vide.';
        error.hidden = false;
        return;
      }
      autosaving = autosaving.then(async () => {
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        const status = input.closest('.kmc-variable-cost-panel-row')?.querySelector('[data-autosave-status]');
        if (status) status.textContent = 'Enregistrement…';
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(key)}/update`, {
            method: 'POST', body: { [property]: input.value.trim() },
          });
          input.dataset.originalValue = input.value;
          error.hidden = true;
          if (status) status.textContent = '✓ Libellé / description enregistré';
          await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
        } catch (err) {
          if (status) status.textContent = '';
          error.textContent = `Non enregistré : ${err.message}`;
          error.hidden = false;
        }
      });
    });

    form.addEventListener('change', event => {
      const input = event.target.closest('[data-variable-cost-input]');
      if (!input || input.value === input.dataset.originalValue) return;
      autosaving = autosaving.then(async () => {
        const value = Number(input.value);
        const status = input.closest('.kmc-variable-cost-panel-row')?.querySelector('[data-autosave-status]');
        if (!input.value.trim() || !Number.isFinite(value) || value < 0) {
          error.textContent = 'Chaque coût doit être un nombre positif ou nul : valeur non enregistrée.';
          error.hidden = false;
          return;
        }
        error.hidden = true;
        if (status) status.textContent = 'Enregistrement…';
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(input.dataset.variableCostInput)}/update`, {
            method: 'POST',
            body: { default_value: value, source: 'economic_cockpit_variable_cost_panel' },
          });
          input.dataset.originalValue = input.value;
          if (status) status.textContent = '✓ Enregistré automatiquement';
          await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
        } catch (err) {
          if (status) status.textContent = '';
          error.textContent = `Non enregistré : ${err.message}`;
          error.hidden = false;
        }
      });
    });

    save.addEventListener('click', async () => {
      await autosaving;
      const inputs = Array.from(form.querySelectorAll('[data-variable-cost-input]'));
      const changed = inputs.filter(input => input.value !== input.dataset.originalValue);
      if (!changed.length) { closePanel(); return; }
      save.disabled = true;
      save.textContent = 'Enregistrement…';
      error.hidden = true;
      const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
      try {
        for (const input of changed) {
          const value = Number(input.value);
          if (!input.value.trim() || !Number.isFinite(value) || value < 0) throw new Error('Chaque coût doit être un nombre positif ou nul.');
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(input.dataset.variableCostInput)}/update`, {
            method: 'POST',
            body: { default_value: value, source: 'economic_cockpit_variable_cost_panel' },
          });
        }
        closePanel();
        await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        save.textContent = 'Terminé';
      }
    });

    doc.body.appendChild(overlay);
    return overlay;
  }

  function bindCockpit(rootObject, workspace, options, payload, cockpit) {
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    if (!portfolio) return;
    const doc = options.document;
    const marketCode = options.requestedMarket || payload.scope?.market_code || 'Marché';

    cockpit.addEventListener('click', async event => {
      const editInline = event.target.closest('[data-edit-inline-cost]');
      if (editInline) {
        const row = editInline.closest('[data-inline-cost-row]');
        const key = editInline.dataset.editInlineCost;
        const component = (payload.cost_components || []).find(item => item.key === key);
        const canUpdate = payload.capabilities?.cost_overrides === true || payload.capabilities?.can_manage_costs === true;
        if (!row || !component || !canUpdate) return;
        cockpit.querySelectorAll('[data-inline-cost-form]').forEach(form => {
          const other = form.closest('[data-inline-cost-row]');
          form.remove();
          if (other) other.querySelector('[data-edit-inline-cost]').hidden = false;
        });
        const form = el(doc, 'form', 'kmc-inline-cost-form');
        form.dataset.inlineCostForm = key;
        form.noValidate = true; // Show our clear inline error instead of browser-only required popup.
        const last = el(doc, 'span', 'kmc-inline-cost-last', `Valeur actuelle : ${componentValue(component)}`);
        form.appendChild(last);
        const input = doc.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.min = '0';
        input.required = true;
        input.name = 'value';
        input.dataset.inlineCostValue = '';
        input.value = finite(component.default_value) == null ? '' : String(component.default_value);
        input.setAttribute('aria-label', `Nouvelle valeur de ${component.label || key}`);
        form.appendChild(input);
        form.appendChild(el(doc, 'span', 'kmc-inline-cost-unit', unitLabel(component.unit)));
        const save = el(doc, 'button', 'kmc-inline-cost-save', 'Enregistrer');
        save.type = 'submit';
        form.appendChild(save);
        const cancel = el(doc, 'button', 'kmc-inline-cost-cancel', 'Annuler');
        cancel.type = 'button';
        cancel.dataset.cancelInlineCost = '';
        form.appendChild(cancel);
        const message = el(doc, 'small', 'kmc-inline-cost-message');
        message.dataset.inlineCostMessage = '';
        message.setAttribute('aria-live', 'polite');
        form.appendChild(message);
        row.appendChild(form);
        editInline.hidden = true;
        input.focus();
        return;
      }
      const cancelInline = event.target.closest('[data-cancel-inline-cost]');
      if (cancelInline) {
        const row = cancelInline.closest('[data-inline-cost-row]');
        row?.querySelector('[data-inline-cost-form]')?.remove();
        const edit = row?.querySelector('[data-edit-inline-cost]');
        if (edit) { edit.hidden = false; edit.focus(); }
        return;
      }
      const editDescription = event.target.closest('[data-edit-fixed-description]');
      if (editDescription) {
        const row = editDescription.closest('[data-inline-structure-row]');
        if (!row || payload.capabilities?.can_manage_structure_events !== true) return;
        const chargeId = editDescription.dataset.editFixedDescription;
        if (row.querySelector('[data-edit-fixed-description-form]')) return;
        const current = row.querySelector('.kmc-economic-family-preview-note')?.firstChild?.textContent?.trim() || '';
        const currentName = row.querySelector('.kmc-economic-family-preview-label')?.textContent?.trim() || '';
        const form = el(doc,'form','kmc-inline-cost-form kmc-structure-reference-form');
        form.dataset.editFixedDescriptionForm=chargeId;
        const nameLabel = el(doc,'label','kmc-structure-reference-field','Libellé');
        const name = doc.createElement('input');
        name.type='text'; name.maxLength=120; name.required=true;
        name.value=currentName; name.setAttribute('aria-label','Libellé du poste fixe');
        name.dataset.editFixedLabel='';
        nameLabel.appendChild(name); form.appendChild(nameLabel);
        const descriptionLabel = el(doc,'label','kmc-structure-reference-field','Description');
        const value = doc.createElement('textarea');
        value.rows=2; value.maxLength=500; value.value=current === 'Description à compléter' ? '' : current;
        value.setAttribute('aria-label','Description du poste fixe');
        descriptionLabel.appendChild(value); form.appendChild(descriptionLabel);
        const save = el(doc,'button','kmc-inline-cost-save','Enregistrer');
        save.type='submit';form.appendChild(save);
        const cancel = el(doc,'button','kmc-inline-cost-cancel','Annuler');
        cancel.type='button';form.appendChild(cancel);
        const message=el(doc,'small','kmc-inline-cost-message','');
        form.appendChild(message);
        cancel.addEventListener('click',()=>{form.remove();editDescription.hidden=false;});
        form.addEventListener('submit',async e=>{
          e.preventDefault();
          const newName=name.value.trim();
          if(newName.length<3||newName.length>120){
            message.textContent='Le libellé doit contenir de 3 à 120 caractères.';return;
          }
          save.disabled=true;message.textContent='Enregistrement…';
          try{
            const endpoint=workspace.endpointFor({requestedMarket:options.requestedMarket});
            await workspace.jsonRequest(options.fetch,
              `${endpoint}/structure-charges/${encodeURIComponent(chargeId)}/description`,
              {method:'PATCH',body:{name:newName,description:value.value.trim()}});
            message.textContent='Libellé et description enregistrés.';
            await rootObject.KomerceCanonicalPricingWorkspace.mount({...options,refreshEconomicCockpit:true});
          }catch(err){
            message.textContent='Non enregistré : '+err.message;save.disabled=false;
          }
        });
        row.appendChild(form);
        editDescription.hidden=true;
        name.focus();
        return;
      }
      const addFixed = event.target.closest('[data-add-fixed-direct]');
      if (addFixed) {
        if (payload.capabilities?.can_manage_structure_events !== true) return;
        const card = addFixed.closest('[data-cost-summary="fixed-direct"]');
        if (!card || card.querySelector('[data-new-fixed-editor-host]')) return;
        const host = el(doc,'div','kmc-new-fixed-editor-host');
        host.dataset.newFixedEditorHost = '';
        card.appendChild(host);
        addFixed.hidden = true;
        try {
          await openStructureEventForm(rootObject,doc,workspace,options,
            'fixed-direct',null,{
              inlineContainer:host, previousValue:'—', allowCreateMarketDirect:true,
              onClose() { addFixed.hidden = false; host.remove(); },
            });
        } catch(error) {
          addFixed.hidden = false;
          host.remove();
          card.appendChild(el(doc,'small','kmc-inline-cost-message',
            'Impossible d’ajouter cette charge : '+error.message));
        }
        return;
      }
      const structureLine = event.target.closest('[data-edit-structure-charge]');
      if (structureLine) {
        // Same inline editing affordance as N1/N2, with an audited N3 event.
        // Market scope is guarded by structure.event.record; GROUP by global authority.
        const row = structureLine.closest('[data-inline-structure-row]');
        const scope = structureLine.dataset.structureScope;
        const isGroup = scope === 'fixed-mutualized';
        const allowed = isGroup
          ? payload.access?.role === 'global_admin' && options.user?.role === 'admin'
          : payload.capabilities?.can_manage_structure_events === true;
        if (!row || !allowed) return;
        const existing = row.querySelector('[data-structure-inline-editor]');
        if (existing) { existing.querySelector('[data-structure-inline-cancel]')?.click(); return; }
        const current = row.querySelector('.kmc-economic-family-preview-value')?.textContent || '—';
        try {
          await openStructureEventForm(rootObject, doc, workspace, options, scope,
            structureLine.dataset.editStructureCharge, { inlineContainer: row, previousValue: current });
          structureLine.hidden = true;
        } catch (error) {
          let message = row.querySelector('[data-inline-structure-error]');
          if (!message) {
            message = el(doc, 'small', 'kmc-inline-cost-message');
            message.dataset.inlineStructureError = '';
            row.appendChild(message);
          }
          message.textContent = `Impossible d’ouvrir la modification : ${error.message}`;
        }
        return;
      }
      const expand = event.target.closest('[data-expand-cost-family]');
      if (expand) {
        const card = expand.closest('[data-cost-summary]');
        if (card) {
          const expanded = card.dataset.expanded !== 'true';
          cockpit.querySelectorAll('.kmc-economic-family-grid > [data-cost-summary]').forEach(other => {
            other.dataset.expanded = 'false';
            other.querySelector('[data-expand-cost-family]')?.setAttribute('aria-expanded', 'false');
            const label = other.querySelector('[data-expand-cost-family]');
            if (label) label.textContent = 'Voir le détail';
          });
          card.dataset.expanded = String(expanded);
          expand.setAttribute('aria-expanded', String(expanded));
          expand.textContent = expanded ? 'Masquer le détail' : 'Voir le détail';
        }
        return;
      }
      const openCosts = event.target.closest('[data-open-cost-detail]');
      if (openCosts) {
        const detailKey = openCosts.dataset.openCostDetail;
        if (detailKey === 'variable') {
          await openVariableCostPanel(rootObject, doc, workspace, options, payload);
          return;
        }
        if (detailKey === 'fixed-direct') {
          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);
          return;
        }
        return;
      }

      const tab = event.target.closest('[data-cockpit-category]');
      if (tab) {
        cockpit.querySelectorAll('[data-cockpit-category]').forEach(node => node.classList.toggle('is-active', node === tab));
        portfolio.__categoryLimitOverride = null;
        await loadCategory(doc, workspace, options, payload, portfolio, tab.dataset.cockpitCategory);
        return;
      }

      const select = event.target.closest('[data-cockpit-select-product]');
      if (select) {
        const corridor = portfolio.__corridors.get(select.dataset.cockpitSelectProduct);
        if (corridor) {
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true, true);
          portfolio.querySelector('[data-cockpit-product-detail]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      const activate = event.target.closest('[data-cockpit-activate-price]');
      if (activate) {
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(activate.dataset.cockpitActivatePrice)}/local-price/activate`, {
            method: 'POST',
            body: { reason: 'Activation depuis Atelier économique après contrôle du gate serveur.', source: 'economic_cockpit' },
          });
          portfolio.__corridors.delete(activate.dataset.cockpitActivatePrice);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        } catch (error) {
          portfolio.querySelector('[data-cockpit-product-detail]')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Activation refusée : ${error.message}`));
        }
        return;
      }

      const viewAll = event.target.closest('[data-cockpit-view-all]');
      if (viewAll) {
        event.preventDefault();
        portfolio.__categoryLimitOverride = Infinity;
        await loadCategory(doc, workspace, options, payload, portfolio, viewAll.dataset.cockpitViewAll);
        return;
      }

      const rowMenu = event.target.closest('[data-cockpit-row-menu]');
      if (rowMenu) {
        const corridor = portfolio.__corridors.get(rowMenu.dataset.cockpitRowMenu);
        if (corridor) {
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true, true);
          portfolio.querySelector('[data-cockpit-product-detail]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      const saveAll = event.target.closest('[data-cockpit-save-all]');
      if (saveAll) {
        const dirtyForms = Array.from(cockpit.querySelectorAll('[data-cockpit-price-form].is-dirty'));
        const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
        if (!dirtyForms.length) {
          if (footerNote) footerNote.textContent = 'Aucun ajustement en attente.';
          return;
        }
        saveAll.disabled = true;
        const originalLabel = saveAll.textContent;
        saveAll.textContent = '⏳ Enregistrement…';
        let savedCount = 0;
        let firstError = null;
        for (const form of dirtyForms) {
          const data = new FormData(form);
          const amount = Number(data.get('amount'));
          const reason = String(data.get('reason') || '').trim() || 'Ajustement du prix final marché depuis Atelier économique';
          const productRef = form.dataset.cockpitPriceForm;
          const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
          try {
            await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price`, {
              method: 'POST', body: { amount, reason, source: 'economic_cockpit_final_market_price' },
            });
            portfolio.__corridors.delete(productRef);
            savedCount += 1;
          } catch (error) {
            firstError = error;
            break;
          }
        }
        saveAll.disabled = false;
        saveAll.textContent = originalLabel;
        await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        if (footerNote) {
          footerNote.textContent = firstError
            ? `Échec après ${savedCount} ligne${savedCount > 1 ? 's' : ''} enregistrée${savedCount > 1 ? 's' : ''} · ${firstError.message}`
            : `${savedCount} ajustement${savedCount > 1 ? 's' : ''} enregistré${savedCount > 1 ? 's' : ''}.`;
        }
        return;
      }
    });

    cockpit.addEventListener('input', event => {
      const priceInput = event.target.closest('[data-final-market-price]');
      if (!priceInput) return;
      const form = priceInput.closest('[data-cockpit-price-form]');
      if (!form) return;
      const isDirty = priceInput.dataset.originalValue !== priceInput.value;
      form.classList.toggle('is-dirty', isDirty);
      const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
      if (footerNote) footerNote.textContent = isDirty ? 'Modification en cours : enregistrée automatiquement à la validation du champ.' : 'Les ajustements sont enregistrés automatiquement. Les valeurs grisées sont calculées par le moteur ; le prix final marché est le levier de décision.';
    });

    // Enregistrement automatique du prix final : à la validation du champ (Entrée / sortie), jamais à la frappe.
    cockpit.addEventListener('change', event => {
      const priceInput = event.target.closest('[data-final-market-price]');
      if (!priceInput) return;
      const form = priceInput.closest('[data-cockpit-price-form]');
      const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
      if (!form || priceInput.dataset.originalValue === priceInput.value) return;
      const amount = Number(priceInput.value);
      if (!priceInput.value.trim() || !Number.isFinite(amount) || amount <= 0) {
        if (footerNote) footerNote.textContent = 'Montant invalide : prix non enregistré.';
        return;
      }
      if (footerNote) footerNote.textContent = 'Enregistrement automatique…';
      form.requestSubmit();
    });

    cockpit.addEventListener('submit', async event => {
      const inlineForm = event.target.closest('[data-inline-cost-form]');
      if (inlineForm) {
        event.preventDefault();
        const input = inlineForm.querySelector('[data-inline-cost-value]');
        const note = inlineForm.querySelector('[data-inline-cost-message]');
        const key = inlineForm.dataset.inlineCostForm;
        const rawValue = input.value.trim();
        const value = Number(rawValue);
        if (!rawValue || !Number.isFinite(value) || value < 0) {
          note.textContent = 'Valeur invalide : rien n’a été enregistré.';
          return;
        }
        const buttons = [...inlineForm.querySelectorAll('button')];
        buttons.forEach(button => { button.disabled = true; });
        note.textContent = 'Enregistrement…';
        try {
          const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(key)}/update`, {
            method: 'POST', body: { default_value: value, source: 'economic_cockpit_inline_row' },
          });
        } catch (error) {
          note.textContent = `Non enregistré : ${error.message}`;
          buttons.forEach(button => { button.disabled = false; });
          return;
        }
        // The backend has accepted the mutation. A subsequent read failure must
        // never be presented as a failed save (which could prompt duplicate writes).
        note.textContent = 'Enregistré. Actualisation…';
        try {
          await rootObject.KomerceCanonicalPricingWorkspace.mount({ ...options, refreshEconomicCockpit: true });
        } catch (error) {
          note.textContent = 'Enregistré côté serveur, mais actualisation indisponible. Rechargez cette page.';
        }
        return;
      }
      const priceForm = event.target.closest('[data-cockpit-price-form]');
      if (priceForm) {
        event.preventDefault();
        const data = new FormData(priceForm);
        const amount = Number(data.get('amount'));
        const reason = String(data.get('reason') || '').trim() || 'Ajustement du prix final marché depuis Atelier économique';
        const productRef = priceForm.dataset.cockpitPriceForm;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price`, {
            method: 'POST', body: { amount, reason, source: 'economic_cockpit_final_market_price' },
          });
          portfolio.__corridors.delete(productRef);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
          const note = cockpit.querySelector('[data-cockpit-footer-note]');
          if (note) note.textContent = '✓ Prix enregistré automatiquement.';
        } catch (error) {
          const note = cockpit.querySelector('[data-cockpit-footer-note]');
          if (note) note.textContent = `Prix non enregistré : ${error.message}`;
          priceForm.closest('.kmc-cockpit-detail-card')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Décision refusée : ${error.message}`));
        }
        return;
      }

    });

    const search = cockpit.querySelector('[data-cockpit-search]');
    search?.addEventListener('input', () => loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory));

    const periodSelect = cockpit.querySelector('[data-cockpit-period]');
    periodSelect?.addEventListener('change', async () => {
      const period = periodSelect.value;
      periodSelect.disabled = true;
      let newDecision;
      try {
        newDecision = await fetchDecision(workspace, options, period);
      } catch (error) {
        periodSelect.disabled = false;
        const badgeTime = cockpit.querySelector('[data-cockpit-live-badge-time]');
        if (badgeTime) badgeTime.textContent = `Erreur de chargement · ${error.message}`;
        return;
      }
      periodSelect.disabled = false;

      const badgeTime = cockpit.querySelector('[data-cockpit-live-badge-time]');
      if (badgeTime) {
        const ts = newDecision?.evaluated_at;
        badgeTime.textContent = `Mises à jour ${ts ? timeSince(new Date(ts)) : 'temps réel'}`;
      }

      const oldCosts = cockpit.querySelector('.kmc-cockpit-costs');
      if (oldCosts) {
        const newCosts = createCostPilotage(doc, payload, marketCode, newDecision, options.user, oldCosts.dataset.costLayout);
        newCosts.hidden = oldCosts.hidden;
        oldCosts.replaceWith(newCosts);
      }

      const oldEquilibrium = cockpit.querySelector('.kmc-flow-equilibrium-panel--cockpit');
      if (oldEquilibrium && rootObject.KomercePricingEquilibriumPanel?.buildPanel) {
        const newEquilibrium = styleEquilibriumForCockpit(rootObject.KomercePricingEquilibriumPanel.buildPanel(doc, workspace, newDecision));
        oldEquilibrium.replaceWith(newEquilibrium);
      }
    });
  }

  // Approved V7/V6 replaces the previous economic cockpit, rather than
  // wrapping it or mounting its write controls on a detached root.
  function createHubEconomyLinks(doc, { user, adminContext, requestedMarket }) {
    const role = user?.role;
    if (!['admin', 'market_operator'].includes(role)) return null;
    const nav = el(doc, 'nav', 'kmc-v7-families');
    nav.setAttribute('aria-label', 'Activité du Hub et refacturation marchés');
    const activity = el(doc, 'a', 'kmc-workspace-nav-link', 'Activité du Hub');
    activity.href = '/admin/hub';
    nav.append(activity);

    if (role !== 'admin') return nav;
    if (requestedMarket) {
      const invoice = el(doc, 'a', 'kmc-workspace-nav-link', 'Refacturation marchés');
      invoice.href = '#refacturation-marches';
      nav.append(invoice);
      return nav;
    }

    const markets = adminContext?.access?.allowedMarkets || [];
    if (!markets.length) return nav;
    const chooser = el(doc, 'details', '');
    chooser.append(el(doc, 'summary', 'kmc-workspace-nav-link', 'Refacturation marchés'));
    const links = el(doc, 'div', 'kmc-v7-families');
    for (const market of markets) {
      const link = el(doc, 'a', 'kmc-workspace-nav-link', market);
      link.href = '/admin/workspaces/pricing?market=' + encodeURIComponent(market) + '#refacturation-marches';
      links.append(link);
    }
    chooser.append(links);
    nav.append(chooser);
    return nav;
  }

  async function enhance(rootObject, workspace, options) {
    if (!options?.root || !options.document) return null;
    const doc=options.document, rootNode=options.root;
    rootNode.__economicV7V6Session?.dispose();
    const cockpit=el(doc,'div','kmc-economic-cockpit');
    cockpit.dataset[COCKPIT_ATTR]='';
    const header=el(doc,'div','kmc-cockpit-page-header');
    const copy=el(doc,'div','kmc-cockpit-page-header-left');
    copy.append(el(doc,'h2','kmc-cockpit-page-title','Atelier économique'),
      el(doc,'p','kmc-cockpit-page-subtitle',options.requestedMarket?'Marché '+options.requestedMarket:'Périmètre groupe · consolidation à rapprocher'));
    const controls=el(doc,'label','kmc-cockpit-period-wrap','Période');
    const period=el(doc,'select','kmc-cockpit-period-select');
    period.dataset.cockpitPeriod='';
    period.setAttribute('aria-label','Période économique');
    const now=new Date();
    const selected=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);
    for(let i=0;i<12;i++){
      const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));
      const opt=el(doc,'option','',new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(d));
      opt.value=d.toISOString().slice(0,10);
      period.append(opt);
    }
    period.value=selected;
    controls.append(period);header.append(copy,controls);
    const session=createV7V6Session(doc,workspace,options,selected);
    rootNode.__economicV7V6Session=session;
    period.addEventListener('change',()=>session.refresh(period.value));
    cockpit.append(header);
    const hubLinks = createHubEconomyLinks(doc, options);
    if (hubLinks) cockpit.append(hubLinks);
    cockpit.append(session.element);
    options.root.replaceChildren(cockpit);
    options.root.dataset.pricingMockContract = 'exclusive';
    await session.refresh(selected);
    return session.model;
  }

  function install(rootObject) {
    const workspace=rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if(!workspace||workspace.__economicCockpitInstalled||typeof workspace.mount!=='function')return false;
    workspace.mount=options=>enhance(rootObject,workspace,options);
    workspace.__economicCockpitInstalled=true;
    workspace.__economicV7V6Installed=true;
    return true;
  }

  return {
    createV7CostCenters,
    createV7BudgetForm,
    createV7PostForm,
    createV7CommitmentForms,
    createV6Activity,
    createHubEconomyLinks,
    createV6Profitability,
    createV7V6Tabs,
    fetchV7V6Model,
    createV7V6Session,
    v7Money,
    classifyComponents,
    economicNature,
    allocationPerimeter,
    createCostPilotage,
    createPortfolioShell,
    portfolioProductRow,
    renderProductDetail,
    enhance,
    install,
  };
});
